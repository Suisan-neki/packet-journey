# xdp-hello

XDP / eBPF を学ぶためのリポジトリです。

学習メモは [docs/journal/](docs/journal/) の日付ファイルに書いています。

## ディレクトリ

- [xdp-hello/](xdp-hello/) — XDP/eBPF 本体と、RingBuf を読むユーザー空間プログラム。
  ユーザー空間は観測したフロー/レートアラートを `127.0.0.1:9000` へ NDJSON で配信する。
- [dashboard/](dashboard/) — Tauri 製のリアルタイム可視化ダッシュボード（画面A: 技術デモ）。
  上記 NDJSON に接続し、PPS タコメーター・パケットの滝・アタックフラッシュ・CPU 比較を表示する。
