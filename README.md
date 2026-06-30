# xdp-hello

eBPF / XDP でパケットをカーネル層から観測し、リアルタイムに可視化する作品です。技育博向けにラズパイの物理ボタンから実トラフィックを発生させ、捕捉結果を大画面に表示できます。

学習メモは [docs/journal/](docs/journal/) の日付ファイルに書いています。

## ディレクトリ

| パス | 役割 |
|------|------|
| [xdp-hello/](xdp-hello/) | XDP/eBPF 本体とユーザー空間プログラム（Lima VM 上で実行） |
| [observation-core/](observation-core/) | 観測イベント型・物理操作と flow の相関 |
| [tools/](tools/) | `observation-hub` / `action-node` / `mock-sensor` |
| [dashboard/](dashboard/) | Tauri ダッシュボード（パケット滝・PPS・アラート） |
| [scripts/](scripts/) | Mac / Lima / ラズパイ / 展示向けスクリプト |

## Mac 一台でできること

```bash
# 1. observation-hub + mock-sensor + Tauri を一括起動
./scripts/mac-dev.sh

# 2. 別ターミナルで物理ボタン模擬（Enter で HTTP + physical_action）
cargo run --release --manifest-path tools/Cargo.toml -p action-node

# 3. 別ターミナルで Lima の eBPF
./scripts/lima-sync.sh --run

# 4. Lima 内で擬似トラフィック
./scripts/lima-netlab.sh flood
```

### データの流れ

```text
[Lima VM] xdp-hello ──9000──┐
                             ├── observation-hub ──9010── ダッシュボード
[Mac/Pi]  action-node ──9001─┘        │
         HTTP :8080 ──────────────────┘（実パケット → XDP が観測）
```

## 技育博・展示

```bash
./scripts/booth.sh
```

ラズパイへ `action-node` を配置する場合:

```bash
PI_HOST=pi@192.168.1.50 ./scripts/pi-deploy.sh
# Pi 上: --gpio --hub <MacのIP>:9001 --http-host <MacのIP> --src-ip <PiのIP>
```

## 個別起動

```bash
cargo run --release --manifest-path tools/Cargo.toml -p observation-hub
cargo run --release --manifest-path tools/Cargo.toml -p action-node
cargo run --release --manifest-path tools/Cargo.toml -p mock-sensor -- --scenario overheat
cd dashboard && npm install && npm run tauri dev
```
