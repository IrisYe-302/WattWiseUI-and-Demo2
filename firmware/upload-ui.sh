#!/usr/bin/env bash
# Build the UI into a LittleFS image and flash it to the power node's
# filesystem partition, so the board serves the whole dashboard itself and the
# demo needs no laptop.
#
#   ./upload-ui.sh [port]
set -euo pipefail

UI_DIR="${UI_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="${1:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
CORE="$HOME/Library/Arduino15/packages/esp32"
MKLITTLEFS="$(find "$CORE/tools/mklittlefs" -name mklittlefs -type f | head -1)"
ESPTOOL="$(find "$CORE/tools/esptool_py" -name esptool -type f | head -1)"

# from default_8MB.csv: spiffs, data, spiffs, 0x670000, 0x180000
OFFSET=0x670000
SIZE=0x180000

[ -n "$PORT" ] || { echo "no board found — plug the power node in"; exit 1; }
[ -d "$UI_DIR" ] || { echo "UI not found at $UI_DIR"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# Everything the page needs, and nothing else — no git history, no tests, no docs.
for f in index.html info.html styles.css info.css app.js live.js estimates.js; do
  [ -f "$UI_DIR/$f" ] && cp "$UI_DIR/$f" "$STAGE/"
done
cp -R "$UI_DIR/assets" "$STAGE/assets"
find "$STAGE" -name '.DS_Store' -delete

USED=$(du -sk "$STAGE" | cut -f1)
echo "staging $USED KB for a $((SIZE/1024)) KB partition"
[ "$USED" -lt $((SIZE/1024)) ] || { echo "too big for the partition"; exit 1; }

"$MKLITTLEFS" -c "$STAGE" -b 4096 -p 256 -s "$SIZE" "$STAGE/../ui.bin"
echo "flashing filesystem to $PORT at $OFFSET"
"$ESPTOOL" --chip esp32s3 --port "$PORT" --baud 921600 write-flash "$OFFSET" "$STAGE/../ui.bin"
rm -f "$STAGE/../ui.bin"
echo
echo "done — reboot the node; it should report 'full UI from flash'"
