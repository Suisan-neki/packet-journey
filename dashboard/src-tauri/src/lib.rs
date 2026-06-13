use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

const EVENT_STREAM_ADDR: &str = "127.0.0.1:9010";

fn spawn_packet_stream(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => {
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        };

        match TcpStream::connect(EVENT_STREAM_ADDR) {
            Ok(stream) => {
                let _ = window.emit("stream-status", "connected");
                let reader = BufReader::new(stream);

                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => {
                            let _ = window.emit("packet-event", line);
                        }
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
            }
            Err(_) => {
                let _ = window.emit("stream-status", "waiting");
                thread::sleep(Duration::from_secs(1));
            }
        }

        let _ = window.emit("stream-status", "disconnected");
        thread::sleep(Duration::from_secs(1));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            spawn_packet_stream(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
