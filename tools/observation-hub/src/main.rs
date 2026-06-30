use anyhow::Context as _;
use clap::Parser;
use observation_core::{
    parse_upstream_line, CorrelationEngine, CorrelationOutput, StreamEvent, UpstreamEvent,
};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::time;

#[derive(Debug, Parser)]
struct Opt {
    /// xdp-hello の NDJSON 配信先（上流 TCP サーバ）。
    #[arg(long, default_value = "127.0.0.1:9000")]
    ebpf_source: String,
    /// action-node / mock-sensor 等のイベント受信アドレス。
    #[arg(long, default_value = "127.0.0.1:9001")]
    sensor_listen: String,
    /// ダッシュボード向け統合ストリーム。
    #[arg(short, long, default_value = "127.0.0.1:9010")]
    listen: String,
    /// action-node が叩く HTTP エンドポイント（GET /api/ping）。
    #[arg(long, default_value = "127.0.0.1:8080")]
    http_listen: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let opt = Opt::parse();
    let (tx, _) = broadcast::channel::<String>(4096);
    let engine = std::sync::Arc::new(tokio::sync::Mutex::new(CorrelationEngine::default()));

    spawn_dashboard_server(opt.listen.clone(), tx.clone()).await?;
    spawn_sensor_server(opt.sensor_listen.clone(), tx.clone(), engine.clone()).await?;
    spawn_http_server(opt.http_listen.clone()).await?;
    spawn_ebpf_client(opt.ebpf_source.clone(), tx.clone(), engine);

    println!("observation-hub:");
    println!("  dashboard stream: {}", opt.listen);
    println!("  action ingest:    {}", opt.sensor_listen);
    println!("  http ping:        http://{}/api/ping", opt.http_listen);
    println!("  ebpf upstream:    {}", opt.ebpf_source);

    loop {
        time::sleep(Duration::from_secs(3600)).await;
    }
}

async fn spawn_dashboard_server(
    listen: String,
    tx: broadcast::Sender<String>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&listen)
        .await
        .with_context(|| format!("failed to bind dashboard stream on {listen}"))?;
    println!("observation-hub: dashboard listening on {listen}");

    tokio::spawn(async move {
        loop {
            let (mut socket, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("observation-hub: dashboard accept failed: {e}");
                    continue;
                }
            };
            println!("observation-hub: dashboard connected: {peer}");
            let mut rx = tx.subscribe();
            tokio::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(line) => {
                            if socket.write_all(line.as_bytes()).await.is_err()
                                || socket.write_all(b"\n").await.is_err()
                            {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                println!("observation-hub: dashboard disconnected: {peer}");
            });
        }
    });

    Ok(())
}

async fn spawn_sensor_server(
    listen: String,
    tx: broadcast::Sender<String>,
    engine: std::sync::Arc<tokio::sync::Mutex<CorrelationEngine>>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&listen)
        .await
        .with_context(|| format!("failed to bind action ingest on {listen}"))?;
    println!("observation-hub: action ingest listening on {listen}");

    tokio::spawn(async move {
        loop {
            let (socket, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("observation-hub: action accept failed: {e}");
                    continue;
                }
            };
            println!("observation-hub: action connected: {peer}");
            let tx = tx.clone();
            let engine = engine.clone();
            tokio::spawn(async move {
                if let Err(e) = ingest_lines(socket, tx, engine).await {
                    eprintln!("observation-hub: action stream ended: {e}");
                }
            });
        }
    });

    Ok(())
}

async fn spawn_http_server(listen: String) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&listen)
        .await
        .with_context(|| format!("failed to bind http ping on {listen}"))?;
    println!("observation-hub: http ping listening on {listen}");

    tokio::spawn(async move {
        loop {
            let (mut socket, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("observation-hub: http accept failed: {e}");
                    continue;
                }
            };
            tokio::spawn(async move {
                if let Err(e) = serve_http_ping(&mut socket).await {
                    eprintln!("observation-hub: http request from {peer} failed: {e}");
                }
            });
        }
    });

    Ok(())
}

async fn serve_http_ping(socket: &mut TcpStream) -> anyhow::Result<()> {
    let mut buf = vec![0u8; 1024];
    let n = socket.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or("");

    let (status, body) = if first_line.starts_with("GET /api/ping") {
        ("200 OK", r#"{"ok":true}"#)
    } else {
        ("404 Not Found", r#"{"ok":false}"#)
    };

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    socket.write_all(response.as_bytes()).await?;
    Ok(())
}

fn spawn_ebpf_client(
    source: String,
    tx: broadcast::Sender<String>,
    engine: std::sync::Arc<tokio::sync::Mutex<CorrelationEngine>>,
) {
    tokio::spawn(async move {
        loop {
            match TcpStream::connect(&source).await {
                Ok(stream) => {
                    println!("observation-hub: connected to ebpf source {source}");
                    if let Err(e) = ingest_lines(stream, tx.clone(), engine.clone()).await {
                        eprintln!("observation-hub: ebpf stream ended: {e}");
                    }
                }
                Err(e) => {
                    eprintln!("observation-hub: ebpf source unavailable ({source}): {e}");
                }
            }
            time::sleep(Duration::from_secs(2)).await;
        }
    });
}

async fn ingest_lines(
    stream: TcpStream,
    tx: broadcast::Sender<String>,
    engine: std::sync::Arc<tokio::sync::Mutex<CorrelationEngine>>,
) -> anyhow::Result<()> {
    let mut lines = BufReader::new(stream).lines();

    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Some(upstream) = parse_upstream_line(line) else {
            continue;
        };

        publish_upstream(&tx, &engine, &upstream).await;
    }

    Ok(())
}

async fn publish_upstream(
    tx: &broadcast::Sender<String>,
    engine: &std::sync::Arc<tokio::sync::Mutex<CorrelationEngine>>,
    upstream: &UpstreamEvent,
) {
    let mut engine = engine.lock().await;
    for output in engine.ingest(upstream) {
        let line = match output {
            CorrelationOutput::Passthrough(event) => event.to_json_line(),
            CorrelationOutput::Correlated(correlated) => {
                StreamEvent::ActionCorrelated(correlated).to_json_line()
            }
        };
        let _ = tx.send(line);
    }
}
