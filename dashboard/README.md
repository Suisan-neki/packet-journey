# XDP Sentinel Dashboard（画面A: 技術デモ）

XDP / eBPF が「どれだけ爆速で・的確に」働いているかを地上に引っ張り出して魅せる
リアルタイム可視化ダッシュボード（Tauri v2 + Vanilla JS + Canvas）。

医療従事者向けの業務画面（画面B / React 想定）は将来 Tauri のマルチウィンドウで
追加する前提。裏側（eBPF + Rust）はそのまま 100% 共有する。

## 構成と全体像

```
[Linux VM (Lima)]  XDP/eBPF → RingBuf → ユーザー空間 xdp-hello
                                          └ TCP 127.0.0.1:9000 へ NDJSON 配信
        Lima のポート転送で macOS ホスト 127.0.0.1:9000 に出る
              ↓
[macOS]   Tauri backend(TCPクライアント) → emit("packet-event") → このフロント
```

NDJSON のメッセージ種別:

| type    | 内容                                    | 主なフィールド                          |
| ------- | --------------------------------------- | --------------------------------------- |
| `stats` | 0.5 秒ごとの集計                        | `pps`, `total`                          |
| `flow`  | 1 パケット検問の記録（58 行目の出力）   | `protocol`, `src`, `src_port`, `dst`... |
| `alert` | パケットレート閾値の突破（盾が発動）    | `dst`, `rate`                           |

## 前提

- Node.js / npm（このリポジトリで確認済み）
- Rust stable（macOS 側で Tauri をビルド）
- 実データを流す場合: Lima の Ubuntu VM で `xdp-hello` を実行（別途）

## 起動（デモデータだけで動作確認）

```shell
cd dashboard
npm install
npm run tauri dev
```

ウィンドウ右上の「デモデータ: OFF」を押すと、合成トラフィックでタコメーター・
パケットの滝・アタックフラッシュ・CPU 比較が一斉に動く。VM が無くても審査員に見せられる。

## 実データ（eBPF）を流す

1. VM 側で eBPF ユーザー空間プログラムを起動（`scripts/lima-sync.sh --run` 等）。
   `xdp-hello` は `127.0.0.1:9000` で NDJSON を待受ける。
2. Lima は VM のリスンポートをホストへ自動転送するため、macOS の
   `127.0.0.1:9000` に出る。Tauri backend が自動接続し、`packet-event` を流す。
3. 接続先を変えたいときは環境変数で上書き:

```shell
XDP_STREAM_ADDR=127.0.0.1:9000 npm run tauri dev
```

右上のステータスピルが「接続中」になれば地上と裏側がつながった合図。
切断時は 2 秒ごとに自動再接続する。
