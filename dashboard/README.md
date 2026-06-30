# Packet Observatory ダッシュボード

Tauri 製 UI です。`observation-hub` が `127.0.0.1:9010` に送る NDJSON を読み、パケット滝・PPS・アラートを表示します。

## 起動

### Web デモだけ見る（いちばん手軃）

```shell
cd dashboard
npm install
npm run dev
```

ブラウザが自動で開きます。開かない場合は **http://127.0.0.1:1420/** をアドレスバーに貼り付けてください（ターミナルのリンクは環境によってクリックできません）。

### 本番ビルドの確認

```shell
npm run build
npm run preview   # → http://127.0.0.1:4173/
```

GitHub Pages と同じパスで試す場合:

```shell
npm run preview:pages   # → http://127.0.0.1:4173/xdp-hello/
```

### Tauri（ライブデータ接続）

```shell
npm run tauri dev
```

Mac 単体の一括起動はリポジトリ直下の `./scripts/mac-dev.sh` でも可能です。

## 画面

- **パケット滝** — `flow` イベントのリアルタイム可視化
- **PPS メーター** — `stats` による秒間パケット数
- **レートアラート** — eBPF の閾値超過検知
- **物理操作トースト** — ラズパイボタン（`physical_action`）と相関パケット（`action_correlated`）

## GitHub Pages（デモ版）

`main` へ push すると [GitHub Pages](https://github.com) に静的ビルドがデプロイされます。

- ライブ eBPF には接続しません
- **「状態確認」ボタン**でラズパイの物理操作をシミュレート
- 背景ではダミーのパケット流量が流れ続けます

## ポート

| ポート | 役割 |
|--------|------|
| 9000 | xdp-hello（Lima VM）からの上流 |
| 9001 | action-node / mock-sensor からの入力 |
| 8080 | action-node 向け HTTP ping |
| 9010 | ダッシュボード向け統合ストリーム |
