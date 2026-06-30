# Packet Journey ディスプレイ

展示用の大画面 UI です。`observation-hub` が `127.0.0.1:9010` に送る NDJSON を読み、**パケットの旅**——操作の発生から XDP による捕捉まで——をリアルタイムで映し出します。

## 画面の構成

- **旅のはじまり（L7）** — ボタン操作がどこで生まれたか
- **宛先を持って進む（L4 · L3）** — パケットの行き先と届け方
- **カーネルの入口（L2）** — XDP が通信を見張っている地点
- **つかまえたパケットの正体** — 操作とパケットの対応がわかる観測記録
- **いま流れている通信** — 背景のライブストリーム

詳しい情報（OSI 層・通信量・履歴）は「旅の奥をもう少し見る」から開けます。

## 起動

### Web デモだけ見る（いちばん手軽）

```shell
cd dashboard
npm install
npm run dev
```

ブラウザが自動で開きます。開かない場合は **http://127.0.0.1:1420/** をアドレスバーに貼り付けてください。

### 本番ビルドの確認

```shell
npm run build
npm run preview   # → http://127.0.0.1:4173/
```

GitHub Pages と同じパスで試す場合:

```shell
npm run build:pages
npm run preview:pages   # → http://127.0.0.1:4173/packet-journey/
```

### Tauri（ライブデータ接続）

```shell
npm run tauri dev
```

Mac 単体の一括起動はリポジトリ直下の `./scripts/mac-dev.sh` でも可能です。

## GitHub Pages（デモ版）

`main` へ push すると静的ビルドがデプロイされます。

**公開 URL:** https://suisan-neki.github.io/packet-journey/

- ライブ eBPF には接続しません
- 「通信を起こす」ボタンで、本番の物理ボタン操作を再現できます

## ポート

| ポート | 役割 |
|--------|------|
| 9000 | eBPF 観測プログラム（Lima VM）からの上流 |
| 9001 | action-node / mock-sensor からの入力 |
| 8080 | action-node 向け HTTP ping |
| 9010 | ディスプレイ向け統合ストリーム |
