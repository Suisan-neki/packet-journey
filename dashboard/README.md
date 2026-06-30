# Packet Journey ダッシュボード

Tauri 製 UI です。`observation-hub` が `127.0.0.1:9010` に送る NDJSON を読み、パケットの流れ・PPS・OSI 層の対応を表示します。

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
- 画面のボタンでラズパイの物理操作をシミュレートできます

## ポート

| ポート | 役割 |
|--------|------|
| 9000 | eBPF 観測プログラム（Lima VM）からの上流 |
| 9001 | action-node / mock-sensor からの入力 |
| 8080 | action-node 向け HTTP ping |
| 9010 | ダッシュボード向け統合ストリーム |
