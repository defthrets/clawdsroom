#!/usr/bin/env bash
# Starlink dish → the HUD's uplink panel (and the room's WWW signpost).
#   ./starlink.sh            push once (cron it every minute)
#   ./starlink.sh --loop 5   push every 5 seconds, forever (systemd / tmux / nohup)
#
# Needs grpcurl (https://github.com/fullstorydev/grpcurl) + jq + curl, on a machine that can reach
# the dish at 192.168.100.1 (in bypass mode, add a static route to 192.168.100.0/24 via the
# Starlink interface). The dish speaks gRPC with server reflection, so no .proto files are needed.
#   DISH=192.168.100.1:9200 ROOM_URL=http://localhost:8787 CLAWDSROOM_TOKEN=... ./starlink.sh
set -uo pipefail
DISH="${DISH:-192.168.100.1:9200}"
ROOM_URL="${ROOM_URL:-http://localhost:8787}"
AUTH=()
[[ -n "${CLAWDSROOM_TOKEN:-}" ]] && AUTH=(-H "Authorization: Bearer $CLAWDSROOM_TOKEN")

push_once() {
  local raw patch
  raw=$(grpcurl -plaintext -max-time 4 -d '{"get_status":{}}' "$DISH" SpaceX.API.Device.Device/Handle 2>/dev/null)
  if [[ -n "$raw" ]] && patch=$(echo "$raw" | jq -c '
      .dishGetStatus as $d | ($d.popPingLatencyMs // 0) as $ms | {
        starlink: {
          online: true,
          state: ($d.disablementCode // "OKAY"),
          latency_ms: ($ms * 10 | round / 10),
          drop_rate: ($d.popPingDropRate // 0),
          down_bps: ($d.downlinkThroughputBps // 0 | round),
          up_bps: ($d.uplinkThroughputBps // 0 | round),
          obstructed: ($d.obstructionStats.currentlyObstructed // false),
          fraction_obstructed: ($d.obstructionStats.fractionObstructed // 0),
          snr_ok: ($d.isSnrAboveNoiseFloor // true),
          gps_sats: ($d.gpsStats.gpsSats // 0),
          azimuth: ($d.boresightAzimuthDeg // 0),
          elevation: ($d.boresightElevationDeg // 0),
          uptime: ($d.deviceState.uptimeS // 0 | tonumber),
          software: ($d.deviceInfo.softwareVersion // ""),
          hardware: ($d.deviceInfo.hardwareVersion // ""),
          eth_mbps: ($d.ethSpeedMbps // 0),
          alerts: (($d.alerts // {}) | to_entries | map(select(.value == true) | .key | gsub("(?<a>[A-Z])"; "_\(.a)") | ascii_downcase)),
          updated: (now * 1000 | floor)
        },
        network: { wan: true, latency_ms: ($ms | round) }
      }' 2>/dev/null); then
    :
  else
    patch="{\"starlink\":{\"online\":false,\"updated\":$(date +%s)000}}"
  fi
  curl -sS -m 5 -X POST "$ROOM_URL/api/state" -H 'content-type: application/json' "${AUTH[@]}" -d "$patch" >/dev/null
}

if [[ "${1:-}" == "--loop" ]]; then
  every="${2:-5}"
  while true; do push_once; sleep "$every"; done
else
  push_once
fi
