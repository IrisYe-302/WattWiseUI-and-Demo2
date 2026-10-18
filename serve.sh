#!/usr/bin/env bash
# Serve the UI locally and point it at the power node.
#
#   ./serve.sh                  -> http://powerbus.local  (mDNS, station mode)
#   ./serve.sh 192.168.4.1      -> the access point
#   ./serve.sh 10.0.0.42        -> a specific address
#
# Serving over http rather than opening index.html as a file keeps the origin
# sane, so the browser treats the fetch to the node as an ordinary cross-origin
# GET, which the node allows.
set -euo pipefail
HOST="${1:-powerbus.local}"
PORT="${PORT:-8770}"
cd "$(dirname "$0")"

echo "checking the power node at $HOST ..."
if curl -fsS --max-time 3 "http://$HOST/api/state" >/dev/null 2>&1; then
  echo "  reachable"
else
  echo "  NOT reachable — the page will run on simulated data until it answers."
  echo "  station mode: 'wifi <ssid> <pass>' then 'save' and 'reboot' on the node"
  echo "  access point: join powerbus-XXXX / powerbus, then ./serve.sh 192.168.4.1"
fi

URL="http://localhost:$PORT/index.html?live=$HOST"
echo
echo "  $URL"
echo
command -v open >/dev/null && (sleep 1; open "$URL") &
exec python3 -m http.server "$PORT"
