# xdp-hello

電子カルテ本体に触れず、低レイヤ（eBPF / 物理センサー）観測から初動判断を支援する観測コアの検証リポジトリです。

学習メモは [docs/journal/](docs/journal/) の日付ファイルに書いています。

## ディレクトリ

| パス | 役割 |
|------|------|
| [xdp-hello/](xdp-hello/) | XDP/eBPF 本体とユーザー空間プログラム（Lima VM 上で実行） |
| [observation-core/](observation-core/) | 決定論的な初動判断グラフ・イベント型・模擬 FHIR |
| [tools/](tools/) | `observation-hub`（統合配信）と `mock-sensor`（センサー模擬） |
| [dashboard/](dashboard/) | Tauri ダッシュボード（技術デモ / 初動判断 / 縮退ビュー） |
| [scripts/](scripts/) | Mac / Lima 向けの開発・検証スクリプト |

## Mac 一台でできること（ミニPC・ラズパイ不要）

```bash
# 1. observation-hub + mock-sensor + Tauri を一括起動
chmod +x scripts/mac-dev.sh
./scripts/mac-dev.sh

# 2. 別ターミナルで Lima の eBPF も繋ぎたい場合
./scripts/lima-sync.sh --run

# 3. Lima 内で擬似トラフィックを流す
chmod +x scripts/lima-netlab.sh
./scripts/lima-netlab.sh flood    # レートアラート
./scripts/lima-netlab.sh lateral  # 横展開っぽい通信
```

### データの流れ

```text
[Lima VM] xdp-hello ──9000──┐
                             ├── observation-hub ──9010── Tauri ダッシュボード
[Mac]     mock-sensor ──9001──┘
                ↓
         初動判断グラフ（observation-core）
                ↓
    画面: 技術デモ / 初動判断 / 縮退ビュー
```

### 各画面

- **技術デモ** — PPS・パケットの滝・レートアラート（開発者向け）
- **初動判断** — 医療従事者向けの具体的な初動手順（決定論的ルール生成）
- **縮退ビュー** — 複合障害時の模擬 FHIR 患者リスト（設計可能性の検証）

## まだ Mac だけではできないこと

- ポートミラーリング付きスイッチ経由のパッシブ全量キャプチャ（フェーズ2）
- 実センサー（4GPi / ラズパイ）からの物理データ取得（フェーズ2）
- 実病院ネットワークでの現場検証（フェーズ3）

## 個別起動

```bash
# observation-hub のみ
cargo run --release --manifest-path tools/Cargo.toml -p observation-hub

# 過熱シナリオの模擬センサー
cargo run --release --manifest-path tools/Cargo.toml -p mock-sensor -- --scenario overheat

# ダッシュボードのみ
cd dashboard && npm install && npm run tauri dev
```
