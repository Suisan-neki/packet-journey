#!/usr/bin/env bash
# Lima VM 内で擬似院内トラフィックを生成する（横展開・レート超過の検証用）。
# Mac ホストから実行する。
set -euo pipefail

LIMA_INSTANCE="${LIMA_INSTANCE:-ubuntu-lts}"

if ! command -v limactl >/dev/null 2>&1; then
  echo "limactl が PATH にありません。Lima をインストールしてください。" >&2
  exit 1
fi

usage() {
  echo "Usage: $0 [flood|lateral|http]" >&2
  echo "  flood    : 単一宛先へ ping 集中（レートアラート検証）" >&2
  echo "  lateral  : 複数宛先へ TCP SYN（初動判断グラフ検証）" >&2
  echo "  http     : 平文 HTTP GET（L7 検知の動作確認）" >&2
  exit 1
}

MODE="${1:-flood}"

limactl start "$LIMA_INSTANCE" >/dev/null

case "$MODE" in
  flood)
    echo "==> flood: ping burst to 10.10.0.1"
    limactl shell "$LIMA_INSTANCE" -- bash -lc '
      set -euo pipefail
      sudo ip netns add patient-a 2>/dev/null || true
      sudo ip link add veth-a type veth peer name veth-host-a 2>/dev/null || true
      sudo ip link set veth-a netns patient-a 2>/dev/null || true
      sudo ip addr add 10.10.0.1/24 dev veth-host-a 2>/dev/null || true
      sudo ip link set veth-host-a up 2>/dev/null || true
      sudo ip netns exec patient-a ip addr add 10.10.0.50/24 dev veth-a 2>/dev/null || true
      sudo ip netns exec patient-a ip link set veth-a up 2>/dev/null || true
      sudo ip netns exec patient-a ping -f -c 140 10.10.0.1
    '
    ;;
  lateral)
    echo "==> lateral: many destinations from 10.10.0.50"
    limactl shell "$LIMA_INSTANCE" -- bash -lc '
      set -euo pipefail
      sudo ip netns add patient-a 2>/dev/null || true
      sudo ip link add veth-a type veth peer name veth-host-a 2>/dev/null || true
      sudo ip link set veth-a netns patient-a 2>/dev/null || true
      sudo ip addr add 10.10.0.1/24 dev veth-host-a 2>/dev/null || true
      sudo ip link set veth-host-a up 2>/dev/null || true
      sudo ip netns exec patient-a ip addr add 10.10.0.50/24 dev veth-a 2>/dev/null || true
      sudo ip netns exec patient-a ip link set veth-a up 2>/dev/null || true
      for i in $(seq 2 20); do
        sudo ip netns exec patient-a bash -lc "timeout 0.2 bash -c \"</dev/tcp/10.10.0.${i}/445\" 2>/dev/null || true"
      done
      sleep 1
    '
    ;;
  http)
    echo "==> http: plain HTTP GET against temporary listener"
    limactl shell "$LIMA_INSTANCE" -- bash -lc '
      set -euo pipefail
      python3 - <<'"'"'PY'"'"' &
      from http.server import BaseHTTPRequestHandler, HTTPServer
      class H(BaseHTTPRequestHandler):
          def do_GET(self):
              self.send_response(200)
              self.end_headers()
              self.wfile.write(b"ok")
          def log_message(self, *args):
              pass
      HTTPServer(("10.10.0.1", 8081), H).serve_forever()
      PY
      SERVER_PID=$!
      sleep 0.5
      curl -s "http://10.10.0.1:8081/" >/dev/null || true
      kill $SERVER_PID 2>/dev/null || true
    '
    ;;
  *)
    usage
    ;;
esac

echo "==> Done. observation-hub / dashboard でイベントを確認してください。"
