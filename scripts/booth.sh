#!/usr/bin/env bash
# 技育博・展示用: observation-hub + Tauri ダッシュボードを起動する。
# Lima / xdp-hello とラズパイ action-node は別途起動する。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/tools"
DASHBOARD_DIR="$REPO_ROOT/dashboard"

START_DASHBOARD=1
START_LIMA=0

usage() {
  echo "Usage: $0 [--no-dashboard] [--with-lima]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-dashboard) START_DASHBOARD=0 ;;
    --with-lima) START_LIMA=1 ;;
    -h | --help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  shift
done

cleanup() {
  [[ -n "${HUB_PID:-}" ]] && kill "$HUB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> building tools"
cargo build --release --manifest-path "$TOOLS_DIR/Cargo.toml"

echo "==> starting observation-hub"
"$TOOLS_DIR/target/release/observation-hub" \
  --sensor-listen 0.0.0.0:9001 \
  --http-listen 0.0.0.0:8080 &
HUB_PID=$!
sleep 1

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")"

echo ""
echo "展示ハブが起動しました。"
echo "  dashboard stream : 127.0.0.1:9010"
echo "  action ingest    : 0.0.0.0:9001  (ラズパイ action-node 向け)"
echo "  http ping        : http://${LAN_IP}:8080/api/ping"
echo "  ebpf upstream    : 127.0.0.1:9000  (Lima xdp-hello)"
echo ""
echo "ラズパイ action-node 起動例:"
echo "  action-node --hub ${LAN_IP}:9001 --http-host ${LAN_IP} --src-ip <PiのIP> --gpio"
echo ""
echo "Lima eBPF:"
echo "  cd $REPO_ROOT && ./scripts/lima-sync.sh --run"
echo ""

if [[ "$START_LIMA" -eq 1 ]]; then
  echo "==> starting Lima xdp-hello"
  "$REPO_ROOT/scripts/lima-sync.sh" --run &
fi

if [[ "$START_DASHBOARD" -eq 1 ]]; then
  if command -v npm >/dev/null 2>&1; then
    echo "==> starting dashboard (Tauri)"
    cd "$DASHBOARD_DIR"
    npm install
    npm run tauri dev
  else
    echo "npm がありません。dashboard/ から手動起動してください。"
    wait "$HUB_PID"
  fi
else
  echo "Ctrl+C で observation-hub を停止します。"
  wait "$HUB_PID"
fi
