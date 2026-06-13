use anyhow::Context as _;
use clap::Parser;
use observation_core::{
    JudgmentEngine, JudgmentOutput, StreamEvent, UpstreamEvent, parse_upstream_line,
};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::time;

#[derive(Debug, Parser)]
struct Opt {
    /// xdp-hello の NDJSON 配信先（上流 TCP サーバ）。
    #[arg(long, default_value = "127.0.0.1:9000")]
    ebpf_source: String,
    /// mock-sensor 等のセンサーイベント受信アドレス。
    #[arg(long, default_value = "127.0.0.1:9001")]
    sensor_listen: String,
    /// Tauri ダッシュボード向け統合ストリーム。
    #[arg(short, long, default_value = "127.0.0.1:9010")]
    listen: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let opt = Opt::parse();
    let (tx, _) = broadcast::channel::<String>(4096);
    let engine = std::sync::Arc::new(tokio::sync::Mutex::new(JudgmentEngine::default()));

    spawn_dashboard_server(opt.listen.clone(), tx.clone()).await?;
    spawn_sensor_server(opt.sensor_listen.clone(), tx.clone(), engine.clone()).await?;
    spawn_ebpf_client(opt.ebpf_source.clone(), tx.clone(), engine);

    println!("observation-hub:");
    println!("  dashboard stream: {}", opt.listen);
    println!("  sensor ingest:    {}", opt.sensor_listen);
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
    engine: std::sync::Arc<tokio::sync::Mutex<JudgmentEngine>>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(&listen)
        .await
        .with_context(|| format!("failed to bind sensor ingest on {listen}"))?;
    println!("observation-hub: sensor ingest listening on {listen}");

    tokio::spawn(async move {
        loop {
            let (socket, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("observation-hub: sensor accept failed: {e}");
                    continue;
                }
            };
            println!("observation-hub: sensor connected: {peer}");
            let tx = tx.clone();
            let engine = engine.clone();
            tokio::spawn(async move {
                if let Err(e) = ingest_lines(socket, tx, engine).await {
                    eprintln!("observation-hub: sensor stream ended: {e}");
                }
            });
        }
    });

    Ok(())
}

fn spawn_ebpf_client(
    source: String,
    tx: broadcast::Sender<String>,
    engine: std::sync::Arc<tokio::sync::Mutex<JudgmentEngine>>,
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
    engine: std::sync::Arc<tokio::sync::Mutex<JudgmentEngine>>,
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
    engine: &std::sync::Arc<tokio::sync::Mutex<JudgmentEngine>>,
    upstream: &UpstreamEvent,
) {
    let passthrough = upstream.to_stream_event().to_json_line();
    let _ = tx.send(passthrough);

    let mut engine = engine.lock().await;
    for output in engine.ingest(upstream) {
        let line = match output {
            JudgmentOutput::Guidance(guidance) => {
                StreamEvent::Guidance(guidance).to_json_line()
            }
            JudgmentOutput::FhirSnapshot(snapshot) => {
                StreamEvent::FhirSnapshot(snapshot).to_json_line()
            }
        };
        let _ = tx.send(line);
    }
}
