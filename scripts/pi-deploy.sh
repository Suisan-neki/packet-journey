#!/usr/bin/env bash
# ラズパイへ action-node をクロスコンパイルして配置する。
# 実行例: PI_HOST=pi@192.168.1.50 ./scripts/pi-deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${PI_HOST:-}"
PI_TARGET="${PI_TARGET:-aarch64-unknown-linux-gnu}"

if [[ -z "$PI_HOST" ]]; then
  echo "PI_HOST を指定してください。例: PI_HOST=pi@192.168.1.50 $0" >&2
  exit 1
fi

if ! rustup target list --installed | grep -q "$PI_TARGET"; then
  echo "==> rustup target add $PI_TARGET"
  rustup target add "$PI_TARGET"
fi

if ! command -v cross >/dev/null 2>&1; then
  echo "cross が見つかりません。cargo install cross するか、Pi 上で直接 cargo build --features gpio してください。" >&2
  exit 1
fi

echo "==> cross build action-node (gpio)"
cross build --release --manifest-path "$REPO_ROOT/tools/Cargo.toml" -p action-node --features gpio --target "$PI_TARGET"

BIN="$REPO_ROOT/tools/target/$PI_TARGET/release/action-node"
REMOTE_DIR="~/xdp-hello-bin"

echo "==> deploy to $PI_HOST"
ssh "$PI_HOST" "mkdir -p $REMOTE_DIR"
scp "$BIN" "$PI_HOST:$REMOTE_DIR/action-node"

ssh "$PI_HOST" "cat > $REMOTE_DIR/action-node.service << 'UNIT'
[Unit]
Description=xdp-hello action-node
After=network-online.target

[Service]
ExecStart=$REMOTE_DIR/action-node --gpio --hub HUB_IP:9001 --http-host HUB_IP --src-ip PI_IP
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
UNIT
echo '配置完了。action-node.service の HUB_IP / PI_IP を編集して systemctl enable --user してください。'"
