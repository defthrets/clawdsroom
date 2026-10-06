#!/usr/bin/env bash
# Frigate → the TV and the window. Run from cron every minute, or loop it.
#   FRIGATE_URL=http://192.168.1.253:5000 ROOM_URL=http://localhost:8787 ./frigate.sh
# Needs curl + jq. Keeps the last seen event id in /tmp so each detection is pushed once.
set -euo pipefail
FRIGATE_URL="${FRIGATE_URL:-http://localhost:5000}"
ROOM="${ROOM:-$(dirname "$0")/../room}"
STAMP="${STAMP:-/tmp/clawdsroom-frigate-last}"

# cameras + how many are up (camera_fps > 0)
stats=$(curl -sS "$FRIGATE_URL/api/stats")
names=$(echo "$stats" | jq -r '.cameras | keys | join(",")')
online=$(echo "$stats" | jq '[.cameras[] | select(.camera_fps > 0)] | length')
names_json=$(echo "$stats" | jq -c '.cameras | keys')
curl -sS -X POST "${ROOM_URL:-http://localhost:8787}/api/state" -H 'content-type: application/json' \
  -d "{\"cams\": {\"names\": $names_json, \"online\": $online}}" >/dev/null

# newest event → a `cam` event in the room (once)
ev=$(curl -sS "$FRIGATE_URL/api/events?limit=1" | jq -c '.[0] // empty')
[[ -n "$ev" ]] || exit 0
id=$(echo "$ev" | jq -r .id)
last=$(cat "$STAMP" 2>/dev/null || true)
if [[ "$id" != "$last" ]]; then
  camera=$(echo "$ev" | jq -r .camera); label=$(echo "$ev" | jq -r .label)
  "$ROOM" event cam "camera=$camera" "label=$label" >/dev/null
  echo "$id" > "$STAMP"
fi
