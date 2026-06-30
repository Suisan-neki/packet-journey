use anyhow::Context as _;
use clap::Parser;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time;

#[derive(Debug, Parser)]
struct Opt {
    /// observation-hub の action 受信アドレス。
    #[arg(short, long, default_value = "127.0.0.1:9001")]
    hub: String,
    /// HTTP GET の宛先ホスト。
    #[arg(long, default_value = "127.0.0.1")]
    http_host: String,
    /// HTTP GET の宛先ポート。
    #[arg(long, default_value_t = 8080)]
    http_port: u16,
    #[arg(short, long, default_value = "booth-pi-1")]
    node_id: String,
    /// 相関用に hub へ送る送信元 IP（Pi の LAN アドレス）。
    #[arg(long)]
    src_ip: Option<String>,
    /// GPIO ボタン待ち（--features gpio でビルド時のみ有効）。
    #[arg(long, default_value_t = false)]
    gpio: bool,
    /// GPIO ピン番号。
    #[arg(long, default_value_t = 17)]
    gpio_pin: u8,
    /// ボタンのデバウンス（ミリ秒）。
    #[arg(long, default_value_t = 300)]
    debounce_ms: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let opt = Opt::parse();

    println!(
        "action-node: hub={} http={}:{}",
        opt.hub, opt.http_host, opt.http_port
    );
    println!("action-node: node={}", opt.node_id);

    #[cfg(feature = "gpio")]
    if opt.gpio {
        return run_gpio(&opt).await;
    }

    #[cfg(not(feature = "gpio"))]
    if opt.gpio {
        anyhow::bail!("--gpio は --features gpio でビルドしてください");
    }

    run_cli(&opt).await
}

async fn run_cli(opt: &Opt) -> anyhow::Result<()> {
    let mut hub = connect_hub(&opt.hub).await?;
    println!("action-node: Enter で「状態確認」アクションを送信（Ctrl+C で終了）");
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        if let Err(e) = trigger_action(
            &mut hub,
            opt,
            "check_status",
            "状態確認ボタン",
            "/api/ping?action=check_status",
        )
        .await
        {
            eprintln!("action-node: {e}");
            hub = connect_hub(&opt.hub).await?;
        }
    }

    Ok(())
}

#[cfg(feature = "gpio")]
async fn run_gpio(opt: &Opt) -> anyhow::Result<()> {
    use rppal::gpio::Gpio;
    use std::sync::{Arc, Mutex};

    let gpio = Gpio::new().context("failed to open GPIO")?;
    let mut pin = gpio
        .get(opt.gpio_pin)
        .with_context(|| format!("failed to open GPIO{}", opt.gpio_pin))?
        .into_input_pullup();

    println!("action-node: waiting on GPIO{} (LOW=pressed)", opt.gpio_pin);

    let hub_addr = opt.hub.clone();
    let http_host = opt.http_host.clone();
    let http_port = opt.http_port;
    let node_id = opt.node_id.clone();
    let src_ip = opt.src_ip.clone();
    let debounce = Duration::from_millis(opt.debounce_ms);
    let guard = Arc::new(Mutex::new(Debounce::new(debounce)));

    pin.set_async_interrupt_trigger(rppal::gpio::Trigger::FallingEdge, None, move |_| {
        let mut debounce = guard.lock().expect("lock");
        if !debounce.tick() {
            return;
        }

        let hub_addr = hub_addr.clone();
        let http_host = http_host.clone();
        let node_id = node_id.clone();
        let src_ip = src_ip.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            if let Err(e) = rt.block_on(trigger_action_standalone(
                &hub_addr,
                &http_host,
                http_port,
                &node_id,
                src_ip.as_deref(),
                "check_status",
                "状態確認ボタン",
                "/api/ping?action=check_status",
            )) {
                eprintln!("action-node: trigger failed: {e}");
            }
        });
    })?;

    loop {
        time::sleep(Duration::from_secs(3600)).await;
    }
}

#[cfg(feature = "gpio")]
struct Debounce {
    last: std::time::Instant,
    window: Duration,
}

#[cfg(feature = "gpio")]
impl Debounce {
    fn new(window: Duration) -> Self {
        Self {
            last: std::time::Instant::now() - window,
            window,
        }
    }

    fn tick(&mut self) -> bool {
        let now = std::time::Instant::now();
        if now.duration_since(self.last) < self.window {
            return false;
        }
        self.last = now;
        true
    }
}

async fn trigger_action(
    hub: &mut TcpStream,
    opt: &Opt,
    action: &str,
    label: &str,
    http_path: &str,
) -> anyhow::Result<()> {
    let line = serde_json::json!({
        "type": "physical_action",
        "node_id": opt.node_id,
        "action": action,
        "label": label,
        "src_ip": opt.src_ip,
    })
    .to_string();

    hub.write_all(line.as_bytes()).await?;
    hub.write_all(b"\n").await?;
    http_get(&opt.http_host, opt.http_port, http_path).await?;
    println!(
        "action-node: sent action={action} http={}:{}{http_path}",
        opt.http_host, opt.http_port
    );
    Ok(())
}

#[cfg(feature = "gpio")]
async fn trigger_action_standalone(
    hub_addr: &str,
    http_host: &str,
    http_port: u16,
    node_id: &str,
    src_ip: Option<&str>,
    action: &str,
    label: &str,
    http_path: &str,
) -> anyhow::Result<()> {
    let mut hub = connect_hub(hub_addr).await?;
    let line = serde_json::json!({
        "type": "physical_action",
        "node_id": node_id,
        "action": action,
        "label": label,
        "src_ip": src_ip,
    })
    .to_string();
    hub.write_all(line.as_bytes()).await?;
    hub.write_all(b"\n").await?;
    http_get(http_host, http_port, http_path).await?;
    println!("action-node: sent action={action} http={http_host}:{http_port}{http_path}");
    Ok(())
}

async fn connect_hub(target: &str) -> anyhow::Result<TcpStream> {
    for attempt in 1..=30 {
        match TcpStream::connect(target).await {
            Ok(stream) => return Ok(stream),
            Err(e) if attempt < 30 => {
                eprintln!("action-node: connect attempt {attempt} failed: {e}");
                time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => return Err(e).with_context(|| format!("failed to connect to {target}")),
        }
    }
    unreachable!()
}

async fn http_get(host: &str, port: u16, path: &str) -> anyhow::Result<()> {
    let mut stream = TcpStream::connect((host, port))
        .await
        .with_context(|| format!("failed to connect to {host}:{port}"))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n",
        path = path,
        host = host
    );
    stream.write_all(request.as_bytes()).await?;
    Ok(())
}
