use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// 地上（このダッシュボード）が接続しに行く NDJSON ストリームの既定アドレス。
/// Lima のポート転送により VM 内の 127.0.0.1:9000 がホストにも出る。
const DEFAULT_STREAM_ADDR: &str = "127.0.0.1:9000";

fn default_stream_addr() -> String {
    std::env::var("XDP_STREAM_ADDR").unwrap_or_else(|_| DEFAULT_STREAM_ADDR.to_string())
}

/// フロントから表示用に既定アドレスを取得するためのコマンド。
#[tauri::command]
fn stream_addr() -> String {
    default_stream_addr()
}

/// TCP に繋ぎ、NDJSON を 1 行ずつ読んで `packet-event` としてフロントへ emit する。
/// 切断されても 2 秒後に自動再接続する（VM 起動前にダッシュボードを開いても良いように）。
fn spawn_stream(app: AppHandle, addr: String) {
    std::thread::spawn(move || {
        loop {
            let _ = app.emit(
                "stream-status",
                serde_json::json!({ "connected": false, "addr": addr }),
            );

            match TcpStream::connect(&addr) {
                Ok(stream) => {
                    let _ = app.emit(
                        "stream-status",
                        serde_json::json!({ "connected": true, "addr": addr }),
                    );

                    let reader = BufReader::new(stream);
                    for line in reader.lines() {
                        match line {
                            Ok(line) => {
                                let trimmed = line.trim();
                                if trimmed.is_empty() {
                                    continue;
                                }
                                if let Ok(value) =
                                    serde_json::from_str::<serde_json::Value>(trimmed)
                                {
                                    let _ = app.emit("packet-event", value);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                Err(_) => {}
            }

            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![stream_addr])
        .setup(|app| {
            let handle = app.handle().clone();
            spawn_stream(handle, default_stream_addr());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
