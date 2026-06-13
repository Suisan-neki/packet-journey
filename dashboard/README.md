# XDP Hello ダッシュボード

Tauri 製 UI です。`observation-hub` が `127.0.0.1:9010` に送る NDJSON を読み、3 つの画面に反映します。

## 起動

```shell
cd dashboard
npm install
npm run tauri dev
```

Mac 単体の一括起動はリポジトリ直下の `./scripts/mac-dev.sh` でも可能です。

## 画面

| タブ | 意味 |
|------|------|
| 技術デモ | `flow` / `alert` / `stats` のリアルタイム可視化 |
| 初動判断 | `guidance` イベントに基づく医療従事者向け初動手順 |
| 縮退ビュー | `fhir_snapshot` による模擬診療データの隔離表示 |

## 前提

`observation-hub` が `9010` 番で待ち受けている必要があります。未起動のときは右上が「待機中」のままです。デモボタンで UI 単体の動作確認もできます。

## ポート

| ポート | 役割 |
|--------|------|
| 9000 | xdp-hello（Lima VM）からの上流 |
| 9001 | mock-sensor からのセンサー入力 |
| 9010 | ダッシュボード向け統合ストリーム |
