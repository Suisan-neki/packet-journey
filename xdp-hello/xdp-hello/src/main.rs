use anyhow::Context as _;
use aya::maps::RingBuf;
use aya::programs::{Xdp, XdpFlags};
use clap::Parser;
#[rustfmt::skip]
use log::{debug, warn};
use std::mem::size_of;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::signal;
use tokio::sync::broadcast;
use xdp_hello_common::{EVENT_KIND_RATE_ALERT, FlowEvent};

#[derive(Debug, Parser)]
struct Opt {
    #[clap(short, long, default_value = "eth0")]
    iface: String,
    /// 地上（Tauri ダッシュボード）へ NDJSON を配信する TCP の待受アドレス。
    /// Lima のポート転送で macOS ホストの同ポートに出る。
    #[clap(short, long, default_value = "127.0.0.1:9000")]
    listen: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let opt = Opt::parse();

    env_logger::init();

    // Bump the memlock rlimit. This is needed for older kernels that don't use the
    // new memcg based accounting, see https://lwn.net/Articles/837122/
    let rlim = libc::rlimit {
        rlim_cur: libc::RLIM_INFINITY,
        rlim_max: libc::RLIM_INFINITY,
    };
    let ret = unsafe { libc::setrlimit(libc::RLIMIT_MEMLOCK, &rlim) };
    if ret != 0 {
        debug!("remove limit on locked memory failed, ret is: {ret}");
    }

    // This will include your eBPF object file as raw bytes at compile-time and load it at
    // runtime. This approach is recommended for most real-world use cases. If you would
    // like to specify the eBPF program at runtime rather than at compile-time, you can
    // reach for `Bpf::load_file` instead.
    let mut ebpf = aya::Ebpf::load(aya::include_bytes_aligned!(concat!(
        env!("OUT_DIR"),
        "/xdp-hello"
    )))?;
    match aya_log::EbpfLogger::init(&mut ebpf) {
        Err(e) => {
            // This can happen if you remove all log statements from your eBPF program.
            warn!("failed to initialize eBPF logger: {e}");
        }
        Ok(logger) => {
            let mut logger =
                tokio::io::unix::AsyncFd::with_interest(logger, tokio::io::Interest::READABLE)?;
            tokio::task::spawn(async move {
                loop {
                    let mut guard = logger.readable_mut().await.unwrap();
                    guard.get_inner_mut().flush();
                    guard.clear_ready();
                }
            });
        }
    }

    // 地上へ流す NDJSON 行をブロードキャストするチャネル。
    // 1イベント = 1行。複数のダッシュボードが同時接続してもよい。
    let (tx, _rx) = broadcast::channel::<String>(4096);

    spawn_event_server(opt.listen.clone(), tx.clone()).await?;

    // PPS 算出用の累積カウンタ（flow イベントのみ数える）。
    let flow_total = Arc::new(AtomicU64::new(0));
    spawn_stats_ticker(tx.clone(), flow_total.clone());

    let ring_buf: RingBuf<_> = ebpf
        .take_map("EVENTS")
        .context("EVENTS ring buffer not found")?
        .try_into()?;
    let mut ring_buf =
        tokio::io::unix::AsyncFd::with_interest(ring_buf, tokio::io::Interest::READABLE)?;
    {
        let tx = tx.clone();
        let flow_total = flow_total.clone();
        tokio::task::spawn(async move {
            loop {
                let mut guard = ring_buf.readable_mut().await.unwrap();
                while let Some(item) = guard.get_inner_mut().next() {
                    match parse_flow_event(&item) {
                        Some(event) => {
                            print_flow_event(&event);
                            if event.kind != EVENT_KIND_RATE_ALERT {
                                flow_total.fetch_add(1, Ordering::Relaxed);
                            }
                            // 黒い画面に出していたデータを、そのまま地上へ投函する。
                            let _ = tx.send(event_to_json(&event));
                        }
                        None => warn!("received malformed flow event: len={}", item.len()),
                    }
                }
                guard.clear_ready();
            }
        });
    }

    let Opt { iface, .. } = opt;
    let program: &mut Xdp = ebpf.program_mut("xdp_hello").unwrap().try_into()?;
    program.load()?;
    program.attach(&iface, XdpFlags::default())
        .context("failed to attach the XDP program with default flags - try changing XdpFlags::default() to XdpFlags::SKB_MODE")?;

    let ctrl_c = signal::ctrl_c();
    println!("Waiting for Ctrl-C...");
    ctrl_c.await?;
    println!("Exiting...");

    Ok(())
}

/// NDJSON を配信する TCP サーバを起動する。接続ごとにブロードキャストを購読し、
/// 受け取った行をそのままソケットへ書き出す。
async fn spawn_event_server(listen: String, tx: broadcast::Sender<String>) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&listen)
        .await
        .with_context(|| format!("failed to bind event server on {listen}"))?;
    println!("event stream listening on {listen} (NDJSON)");

    tokio::task::spawn(async move {
        loop {
            let (mut socket, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    warn!("event server accept failed: {e}");
                    continue;
                }
            };
            println!("dashboard connected: {peer}");
            let mut rx = tx.subscribe();
            tokio::task::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(line) => {
                            if socket.write_all(line.as_bytes()).await.is_err()
                                || socket.write_all(b"\n").await.is_err()
                            {
                                break;
                            }
                        }
                        // ダッシュボードの読み取りが遅れて溢れたぶんは捨てて継続する。
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                println!("dashboard disconnected: {peer}");
            });
        }
    });

    Ok(())
}

/// 500ms ごとに PPS（1秒あたり処理パケット数）と累計を stats イベントとして配信する。
fn spawn_stats_ticker(tx: broadcast::Sender<String>, flow_total: Arc<AtomicU64>) {
    tokio::task::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut prev = flow_total.load(Ordering::Relaxed);
        loop {
            interval.tick().await;
            let total = flow_total.load(Ordering::Relaxed);
            let delta = total.saturating_sub(prev);
            prev = total;
            // 500ms ぶんの観測なので 2 倍して 1 秒あたりに換算する。
            let pps = delta * 2;
            let line = serde_json::json!({
                "type": "stats",
                "pps": pps,
                "total": total,
            })
            .to_string();
            let _ = tx.send(line);
        }
    });
}

fn parse_flow_event(bytes: &[u8]) -> Option<FlowEvent> {
    if bytes.len() != size_of::<FlowEvent>() {
        return None;
    }

    Some(FlowEvent {
        kind: bytes[0],
        protocol: bytes[1],
        _pad: [0; 2],
        src_addr: bytes[4..8].try_into().ok()?,
        dst_addr: bytes[8..12].try_into().ok()?,
        src_port: u16::from_ne_bytes(bytes[12..14].try_into().ok()?),
        dst_port: u16::from_ne_bytes(bytes[14..16].try_into().ok()?),
        rate: u32::from_ne_bytes(bytes[16..20].try_into().ok()?),
    })
}

fn print_flow_event(event: &FlowEvent) {
    if event.kind == EVENT_KIND_RATE_ALERT {
        println!(
            "rate alert: dst={}.{}.{}.{}, rate={}/s",
            event.dst_addr[0], event.dst_addr[1], event.dst_addr[2], event.dst_addr[3], event.rate
        );
        return;
    }

    println!(
        "flow event: proto={}, src={}.{}.{}.{}:{}, dst={}.{}.{}.{}:{}",
        protocol_name(event.protocol),
        event.src_addr[0],
        event.src_addr[1],
        event.src_addr[2],
        event.src_addr[3],
        event.src_port,
        event.dst_addr[0],
        event.dst_addr[1],
        event.dst_addr[2],
        event.dst_addr[3],
        event.dst_port
    );
}

/// FlowEvent を 1 行の JSON 文字列に変換する。
fn event_to_json(event: &FlowEvent) -> String {
    if event.kind == EVENT_KIND_RATE_ALERT {
        return serde_json::json!({
            "type": "alert",
            "dst": ipv4_string(event.dst_addr),
            "rate": event.rate,
        })
        .to_string();
    }

    serde_json::json!({
        "type": "flow",
        "protocol": protocol_name(event.protocol),
        "src": ipv4_string(event.src_addr),
        "src_port": event.src_port,
        "dst": ipv4_string(event.dst_addr),
        "dst_port": event.dst_port,
    })
    .to_string()
}

fn ipv4_string(addr: [u8; 4]) -> String {
    format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3])
}

fn protocol_name(protocol: u8) -> &'static str {
    match protocol {
        1 => "ICMP",
        6 => "TCP",
        17 => "UDP",
        _ => "OTHER",
    }
}
