use anyhow::Context as _;
use aya::maps::RingBuf;
use aya::programs::{Xdp, XdpFlags};
use clap::Parser;
#[rustfmt::skip]
use log::{debug, warn};
use std::mem::size_of;
use tokio::signal;
use xdp_hello_common::FlowEvent;

#[derive(Debug, Parser)]
struct Opt {
    #[clap(short, long, default_value = "eth0")]
    iface: String,
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
    let ring_buf: RingBuf<_> = ebpf
        .take_map("EVENTS")
        .context("EVENTS ring buffer not found")?
        .try_into()?;
    let mut ring_buf =
        tokio::io::unix::AsyncFd::with_interest(ring_buf, tokio::io::Interest::READABLE)?;
    tokio::task::spawn(async move {
        loop {
            let mut guard = ring_buf.readable_mut().await.unwrap();
            while let Some(item) = guard.get_inner_mut().next() {
                match parse_flow_event(&item) {
                    Some(event) => print_flow_event(&event),
                    None => warn!("received malformed flow event: len={}", item.len()),
                }
            }
            guard.clear_ready();
        }
    });

    let Opt { iface } = opt;
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

fn parse_flow_event(bytes: &[u8]) -> Option<FlowEvent> {
    if bytes.len() != size_of::<FlowEvent>() {
        return None;
    }

    Some(FlowEvent {
        src_addr: bytes[0..4].try_into().ok()?,
        dst_addr: bytes[4..8].try_into().ok()?,
        src_port: u16::from_ne_bytes(bytes[8..10].try_into().ok()?),
        dst_port: u16::from_ne_bytes(bytes[10..12].try_into().ok()?),
        protocol: bytes[12],
        _pad: [0; 3],
    })
}

fn print_flow_event(event: &FlowEvent) {
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

fn protocol_name(protocol: u8) -> &'static str {
    match protocol {
        1 => "ICMP",
        6 => "TCP",
        17 => "UDP",
        _ => "OTHER",
    }
}
