use anyhow::Context as _;
use clap::{Parser, ValueEnum};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time;

#[derive(Debug, Clone, ValueEnum)]
enum Scenario {
    /// 平時の温度・湿度を送信する。
    Normal,
    /// 診察室 AP の過熱を模擬する。
    Overheat,
    /// 過熱後にネットワーク異常が続く複合シナリオ用の高温を維持する。
    Combined,
}

#[derive(Debug, Parser)]
struct Opt {
    /// observation-hub のセンサー受信アドレス。
    #[arg(short, long, default_value = "127.0.0.1:9001")]
    target: String,
    #[arg(short, long, default_value = "ap-exam-1")]
    node_id: String,
    #[arg(short, long, default_value = "exam-room-ap")]
    tag: String,
    #[arg(short, long, value_enum, default_value_t = Scenario::Overheat)]
    scenario: Scenario,
    /// 送信間隔（ミリ秒）。
    #[arg(long, default_value_t = 500)]
    interval_ms: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let opt = Opt::parse();
    let mut stream = connect_with_retry(&opt.target).await?;
    println!(
        "mock-sensor: connected to {} (scenario={:?}, node={})",
        opt.target, opt.scenario, opt.node_id
    );

    let mut step: u32 = 0;
    let mut interval = time::interval(Duration::from_millis(opt.interval_ms));

    loop {
        interval.tick().await;
        step = step.saturating_add(1);

        let (temp_c, humidity) = temperature_for_step(&opt.scenario, step);
        send_sensor(
            &mut stream,
            &opt.node_id,
            &opt.tag,
            "temperature",
            temp_c,
            "C",
        )
        .await?;
        send_sensor(
            &mut stream,
            &opt.node_id,
            &opt.tag,
            "humidity",
            humidity,
            "%",
        )
        .await?;

        println!("mock-sensor: temp={temp_c:.1}C humidity={humidity:.0}% (step={step})");

        if matches!(opt.scenario, Scenario::Overheat) && step >= 20 {
            println!("mock-sensor: overheat scenario complete");
            break;
        }
    }

    Ok(())
}

async fn connect_with_retry(target: &str) -> anyhow::Result<TcpStream> {
    for attempt in 1..=30 {
        match TcpStream::connect(target).await {
            Ok(stream) => return Ok(stream),
            Err(e) if attempt < 30 => {
                eprintln!("mock-sensor: connect attempt {attempt} failed: {e}");
                time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => return Err(e).with_context(|| format!("failed to connect to {target}")),
        }
    }
    unreachable!()
}

fn temperature_for_step(scenario: &Scenario, step: u32) -> (f32, f32) {
    match scenario {
        Scenario::Normal => (26.0 + (step % 3) as f32 * 0.2, 48.0),
        Scenario::Overheat => {
            let temp = 30.0 + step as f32 * 1.1;
            (temp.min(52.0), 35.0)
        }
        Scenario::Combined => (47.5, 32.0),
    }
}

async fn send_sensor(
    stream: &mut TcpStream,
    node_id: &str,
    tag: &str,
    metric: &str,
    value: f32,
    unit: &str,
) -> anyhow::Result<()> {
    let line = serde_json::json!({
        "type": "sensor",
        "node_id": node_id,
        "tag": tag,
        "metric": metric,
        "value": value,
        "unit": unit,
    })
    .to_string();

    stream.write_all(line.as_bytes()).await?;
    stream.write_all(b"\n").await?;
    Ok(())
}
