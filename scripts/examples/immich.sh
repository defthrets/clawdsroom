#!/usr/bin/env bash
# Immich → the photo wall. Run from cron every 10 minutes.
#   IMMICH_URL=http://192.168.1.253:2283 IMMICH_KEY=xxxx ./immich.sh
set -euo pipefail
IMMICH_URL="${IMMICH_URL:-http://localhost:2283}"
ROOM="${ROOM:-$(dirname "$0")/../room}"
STAMP="${STAMP:-/tmp/clawdsroom-immich-last}"
: "${IMMICH_KEY:?set IMMICH_KEY to an Immich API key}"

photos=$(curl -sS -H "x-api-key: $IMMICH_KEY" "$IMMICH_URL/api/server/statistics" | jq '.photos')
last=$(cat "$STAMP" 2>/dev/null || echo "$photos")
"$ROOM" state "immich.photos=$photos" >/dev/null
if (( photos > last )); then "$ROOM" event photo "count=$((photos - last))" >/dev/null; fi
echo "$photos" > "$STAMP"
