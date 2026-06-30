# PACKET JOURNEY

**見えない通信をつかまえよう。**

## 作品概要

ボタンを押す、ページが開く、メッセージが届く——いつもの操作の裏側では、小さな**パケット**というデータの荷物が生まれ、ネットワークを旅します。でもそれは目に見えない。だから「通信って、いま何が起きているんだろう？」と思っても、ピンとこない。

**PACKET JOURNEY** は、その**見えない旅**を追いかける展示作品です。

来場者に伝えたいのは、専門用語の暗記ではなく、**パケットを捕捉する面白さ**です。

- 自分の操作が、裏側ではこういうデータになるんだ
- パケットは出発地と目的地を持って、ネットワークを進んでいくんだ
- カーネルの入口で、XDP が通信をつかまえているんだ

という「あ、そういうことか」を体験してもらうのが、この作品の目的です。

**Web デモ:** https://suisan-neki.github.io/packet-journey/

（本番展示では机のラズパイの物理ボタンから通信を起こします。Web デモでは画面のボタンで同じ流れを再現できます。）

## 展示で見せること

大画面のディスプレイでは、操作からパケット捕捉までを**旅**としてたどります。

### 1. 旅のはじまり（L7）

机のボタンを押すと、操作が生まれます。「状態確認」のような、人がわかる動きがここから始まります。

### 2. 宛先を持って進む（L4 · L3）

操作はパケットという形に変わり、出発地と目的地を持ってネットワークを進みます。TCP や UDP といった届け方、IP アドレスという宛先が、旅の途中で現れます。

### 3. カーネルの入口で待つ（L2）

旅の途中、Linux カーネルの入口で **XDP / eBPF** がパケットを見張っています。通り過ぎる通信を捕捉し、「いま、何が流れたか」を記録します。

### つかまえたパケットの正体

ボタン操作から生まれた通信を XDP が見つけると、画面に**観測記録**が表示されます。どこから来て、どこへ向かったのか——画面に見えていた操作と、裏側で流れたパケットが、同じ出来事だとわかります。

そのほか、背景では「いま、この瞬間にも流れている通信」がリアルタイムで流れ続け、パケットの世界が生きていることを感じられます。

## 技術スタック

| 領域 | 技術 |
|------|------|
| パケット観測 | eBPF / XDP（Rust + Aya） |
| イベント統合 | `observation-hub`（操作と flow の相関・配信） |
| 物理入力 | ラズパイ + `action-node`（GPIO / HTTP） |
| 可視化 | 展示用ディスプレイ UI（Tauri / GitHub Pages デモ） |

学習メモは [docs/journal/](docs/journal/) の日付ファイルに書いています。

## ディレクトリ

| パス | 役割 |
|------|------|
| [xdp-hello/](xdp-hello/) | XDP/eBPF 本体とユーザー空間プログラム（Lima VM 上で実行） |
| [observation-core/](observation-core/) | 観測イベント型・物理操作と flow の相関 |
| [tools/](tools/) | `observation-hub` / `action-node` / `mock-sensor` |
| [dashboard/](dashboard/) | 展示用ディスプレイ UI（パケットの旅の可視化） |
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
                             ├── observation-hub ──9010── ディスプレイ
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
