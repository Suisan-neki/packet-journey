#!/usr/bin/env bash
# Mac 単体で observation-hub + mock-sensor + Tauri を起動する開発用スクリプト。
# Lima / xdp-hello は別ターミナルで動かす（./scripts/lima-sync.sh --run）。
# 物理ボタン模擬: 別ターミナルで cargo run -p action-node --manifest-path tools/Cargo.toml
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/tools"
DASHBOARD_DIR="$REPO_ROOT/dashboard"

usage() {
  echo "Usage: $0 [--scenario normal|overheat|combined|none] [--no-dashboard]" >&2
  echo "  既定: overheat シナリオで mock-sensor を起動し、observation-hub を常駐させる。" >&2
  exit 1
}

SCENARIO="overheat"
START_DASHBOARD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)
      shift
      [[ $# -gt 0 ]] || usage
      SCENARIO="$1"
      ;;
    --no-dashboard)
      START_DASHBOARD=0
      ;;
    -h | --help) usage ;;
    *)
      echo "unknown option: $1" >&2
      usage
      ;;
  esac
  shift
done

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo が見つかりません。Rust ツールチェーンをインストールしてください。" >&2
  exit 1
fi

cleanup() {
  [[ -n "${HUB_PID:-}" ]] && kill "$HUB_PID" 2>/dev/null || true
  [[ -n "${SENSOR_PID:-}" ]] && kill "$SENSOR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> building observation-core + tools"
cargo build --release --manifest-path "$TOOLS_DIR/Cargo.toml"

echo "==> starting observation-hub (127.0.0.1:9010, http :8080)"
"$TOOLS_DIR/target/release/observation-hub" &
HUB_PID=$!

sleep 1

if [[ "$SCENARIO" != "none" ]]; then
  echo "==> starting mock-sensor (scenario=$SCENARIO)"
  "$TOOLS_DIR/target/release/mock-sensor" --scenario "$SCENARIO" &
  SENSOR_PID=$!
fi

echo ""
echo "Mac 検証環境が起動しました。"
echo "  observation-hub : 127.0.0.1:9010"
echo "  action ingest   : 127.0.0.1:9001"
echo "  http ping       : http://127.0.0.1:8080/api/ping"
echo "  ebpf upstream   : 127.0.0.1:9000 (Lima で xdp-hello 起動時に接続)"
echo ""
echo "物理ボタン模擬 (別ターミナル):"
echo "  cargo run --release --manifest-path $TOOLS_DIR/Cargo.toml -p action-node"
echo "  # Enter で physical_action + HTTP を送信"
echo ""
echo "別ターミナルで Lima の eBPF を動かす場合:"
echo "  cd $REPO_ROOT && ./scripts/lima-sync.sh --run"
echo ""

if [[ "$START_DASHBOARD" -eq 1 ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm がないためダッシュボードは起動しません。手動で dashboard/ から npm run tauri dev を実行してください。"
  else
    echo "==> starting Tauri dashboard"
    cd "$DASHBOARD_DIR"
    npm install
    npm run tauri dev
  fi
else
  echo "ダッシュボードは起動していません。必要なら:"
  echo "  cd $DASHBOARD_DIR && npm run tauri dev"
  echo ""
  echo "Ctrl+C で observation-hub / mock-sensor を停止します。"
  wait "$HUB_PID"
fi
