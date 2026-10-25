# The state contract

Everything the room shows comes from one JSON document, the **state**, plus a stream of
**events**. The homelab (or Clawd himself) pushes into both over plain HTTP. The room renders.

* `GET  /api/state`  → the whole state
* `POST /api/state`  → deep-merge a patch (JSON body, form body, or `?dotted.keys=values`)
* `PUT  /api/state`  → replace the whole state
* `POST /api/event`  → push an event `{"type": "...", ...}`
* `GET  /api/events` → the last 60 events
* `GET  /api/history` → up to 6h of cpu/ram/temp/disk/battery/solar/network/Starlink samples (one per 30s), for the trend charts
* `GET  /api/stream` → Server-Sent Events (`state` and `event` messages). The iPad listens here.
* `GET  /api/health` → `{ok: true, clients: n}`

Defaults live in [`public/js/defaults.js`](../public/js/defaults.js); the server deep-merges
whatever you send on top of them. Objects merge recursively, arrays and scalars replace,
`null` deletes a key. Timestamps are milliseconds since the epoch (`date +%s000`).

If `CLAWDSROOM_TOKEN` is set, writes need `Authorization: Bearer <token>` (or `?token=`).

## Patching state

```bash
# JSON body, nested
curl -s -X POST localhost:8787/api/state -H 'content-type: application/json' \
  -d '{"clawd": {"activity": "terminal", "status": "Restarting Frigate."}}'

# dotted keys (same thing, handy from shell)
curl -s -X POST 'localhost:8787/api/state?clawd.activity=terminal&clawd.status=Restarting+Frigate.'

# form-encoded also works
curl -s -X POST localhost:8787/api/state -d 'power.battery=42' -d 'power.solar_w=1850' -d 'power.charging=true'
```

## State reference

| Key | What the room does with it |
|---|---|
| `meta.name`, `meta.host` | Title bar. |
| `clawd.activity` | Where Clawd goes and what he does. One of `idle`, `sleeping`, `terminal`, `coding`, `watching`, `monitoring`, `remote`, `reading`, `searching`, `researching`, `tinkering`, `browsing`, `delegating`, `writing`, `planning`, `chatting`, `deploying`, `playing`, `speaking`, `looking`, `thinking`. While `idle` he potters: looks out of the window, chills on the couch, pets the dog, checks the post, waters the plant, browses the shelves, has a dance (see `PASTIMES` in `public/js/actors.js`). |
| `clawd.status` | Short text. Shown in the title bar and in Clawd's speech bubble when it changes. |
| `clawd.mood` | His face: `happy`, `calm`, `focused`, `excited`, `surprised`, `alert`, `worried`, `sad`, `angry`, `bored`, `sleepy`. The room also works some out itself: worried when the battery is low, the watchdog is unhappy or the CPU is cooking; bored after a long quiet idle; focused at the desk; short flashes of excited/angry/happy on events. The title bar and his tap card say what he is feeling. |
| `clawd.dream` | Thought bubble while he sleeps. |
| `clawd.last_active` | ms. With `settings.sleep_after_min`, a stale `idle` becomes `sleeping`. `idle` is also shown as sleeping between 23:00 and 06:30. |
| `system.cpu`, `system.ram`, `system.temp`, `system.fan`, `system.disk_root`, `system.disk_mnt`, `system.load`, `system.uptime` | HUD tiles, the thermometer, the cupboard LEDs and fan, chimney smoke, the monitor. **Filled automatically** when the server runs on Linux (`COLLECT_SYSTEM=1`, the default). |
| `power.battery`, `power.solar_w`, `power.load_w`, `power.grid_w`, `power.charging`, `power.low_at` | Battery gauge in the garage, solar readout on the roof, HUD tile. Below `low_at` percent the lights dim and flicker. |
| `cams.names`, `cams.online`, `cams.events_today`, `cams.last` | TV feeds (one per name, up to four), window label, HUD. |
| `bus.online`, `bus.messages_today`, `bus.last` | HUD tile; the bus itself is driven by `bus` events. |
| `telegram.unread`, `telegram.last` | Mailbox flag + count. Set `unread` back to 0 when Clawd has read them. |
| `chirpa.species_today`, `chirpa.detections_today`, `chirpa.last` | HUD. The bird sings on `bird` events. |
| `watchdog.state` (`ok`/`warning`/`alert`), `watchdog.alerts`, `watchdog.last_bark` | The dog sleeps when `ok`, sits up otherwise. Barks on `bark` events. |
| `memory.notes`, `memory.skills`, `memory.last_diary`, `memory.last_consolidation` | Books on the shelves (up to 60 spines, scaled), the number on the filing cabinet. |
| `storage.mnt_used_gb`, `storage.mnt_total_gb`, `storage.games`, `storage.movies` | Boxes on the garage shelf, RetroShelf label. `mnt_*` is auto-filled on Linux from `DISK_MNT`. |
| `immich.photos`, `immich.last_upload` | Photo wall caption, HUD. |
| `sdr.planes`, `sdr.sensors`, `sdr.last_plane` | Radio pings and planes crossing the sky while `planes > 0`. |
| `cron[]` | `{name, at: "HH:MM"}` or `{name, every: minutes}`. Red ticks on the clock, "next:" in the title bar. |
| `subagents.active`, `subagents.names` | Lit helper bots in the garage (3 docks, "+N" beyond). |
| `network.wan`, `network.latency_ms`, `network.devices` | The WWW signpost turns red when `wan` is false. HUD tile. |
| `network.iface`, `network.rx_bps`, `network.tx_bps`, `network.rx_total`, `network.tx_total` | HUD: RX/TX (bits/s) on the default-route interface. **Filled automatically** on Linux (`NET_IFACE` to pick another). |
| `network.conns_in`, `network.conns_out`, `network.listening`, `network.ports[]`, `network.peers[]` | HUD radar and peer list. Established TCP connections: `in` when the local port is one we listen on, otherwise `out`. `peers` are `{ip, port, dir, n, svc, scope: lan\|wan, host?}`, busiest first. **Filled automatically** on Linux. |
| `starlink.online`, `starlink.state`, `starlink.latency_ms`, `starlink.drop_rate` (0..1), `starlink.down_bps`, `starlink.up_bps` | HUD uplink panel: the numbers, the packet stream in the sky, the charts. Pushed by `scripts/examples/starlink.sh`. |
| `starlink.obstructed`, `starlink.fraction_obstructed` (0..1), `starlink.snr_ok`, `starlink.gps_sats`, `starlink.azimuth`, `starlink.elevation`, `starlink.uptime`, `starlink.software`, `starlink.hardware`, `starlink.eth_mbps`, `starlink.alerts[]`, `starlink.updated` | HUD chips and alerts. The HUD calls the dish stale when `updated` is more than 2 minutes old. |
| `crew.<name>.online`, `crew.<name>.emoji` | The crew photo: bright when home, grey when away. |
| `weather.condition` (`clear`/`cloudy`/`rain`), `weather.sunrise`, `weather.sunset` | Clouds, rain, and when the sky turns. |
| `settings.sleep_after_min`, `settings.reload_hours` | Auto-sleep; the page reloads itself every N hours (24). |

## Events

`POST /api/event` with a JSON body. `type` is required; everything else is optional.
Events also bump the related counters in the state (see `applyEvent` in `public/js/reducer.js`).

| `type` | Fields | What happens |
|---|---|---|
| `bird` | `species`, `confidence`, `new_species` | Chirpa sings, notes float up, the species name appears over the tree. `detections_today` +1 (`species_today` +1 if `new_species`). |
| `bark` | `reason`, `level` (`warning`/`alert`) | The dog stands up and barks the reason. `watchdog.state` follows `level`. |
| `telegram` | `from`, `text` | An envelope flies into the mailbox, the flag goes up, `unread` +1. From `you` → hearts. |
| `bus` | `from`, `text` | The crew bus pulls up with the sender's name and the message. `messages_today` +1; marks `crew.<from>` online. |
| `cam` | `camera`, `label` | Window flashes with the label, the TV highlights that feed, Clawd's eyes go wide. `events_today` +1. |
| `photo` | `count` | A frame on the photo wall flashes and changes. `photos` += count. |
| `plane` | `callsign`, `alt` | A plane crosses the sky with its callsign. |
| `sensor` | `name`, `value` | The radio pings. |
| `cron` | `name` | The wall clock rings and shows the job name. |
| `subagent` | `action` (`spawn`/`done`), `name` | A helper bot walks out of the garage (or back in). `active` ±1; `spawn` sets `clawd.activity` to `delegating`. |
| `say` | `text` | Speech bubble + sound waves from the speaker. Sets `clawd.status`. |
| `look` | `what` | Eyes wide open, an eye icon over his head. |
| `dream` | `text` | Thought bubble over the bed. Sets `clawd.dream`. |
| `diary` | `excerpt` | The journal on the nightstand glows. `memory.last_diary` = now, `notes` +1. |
| `solar` | `note` | Bolt on the battery with the note. |
| `note` | `text` | Just the ticker (and a bubble if there's text). |

Daily counters (`cams.events_today`, `bus.messages_today`, `chirpa.*_today`) reset at midnight (server local time).

## Mapping (what each thing in the house is)

| In the house | On the homelab |
|---|---|
| The house | The homelab in the cupboard (`system.*`) |
| Solar panels + battery in the garage | FoxESS (`power.*`) |
| Mailbox + front door | Telegram DMs + the crew bus (`telegram`, `bus`) |
| Computer desk + monitor | The terminal (`clawd.activity = terminal`) |
| TV | Frigate cams and the homelab dashboard (`cams`) |
| Laptop | SSH / Telegram, remote reach (`remote`) |
| Bed + dream journal | Idle = asleep = memory consolidation + nightly diary (`sleeping`, `writing`, `dream`, `diary`) |
| Bookshelves + filing cabinet | Memory + skills (`memory`) |
| Garage shelves + RetroShelf | `/mnt` and the games (`storage`) |
| Photo wall | Immich (`immich`) |
| Radio on the shelf | RTL-SDR: ADS-B + 433MHz (`sdr`) |
| Wall clock | Cron (`cron`) |
| The big plant | Watered at sunrise and sunset (`weather.sunrise` / `weather.sunset`); droops when it has gone without |
| The TV banner | The cameras' view (`cam` events) |
| Workbench | Scripts and tinkering (`tinkering`) |
| The bird in the tree | Chirpa (`bird` events) |
| The dog under the stairs | clawd-watchdog (`watchdog`, `bark`) |
| Eyes | Vision (`look`) |
| Speaker on the cupboard | TTS (`say`) |
| The road out the back (WWW) | Web search / browser (`browsing`, `network`) |
| Helper bots in the garage | Subagents (`subagents`, `subagent` events) |
| The crew photo | Who's home (`crew`) |
| The loft (console, hammock, telescope, punchbag, records) | RetroShelf (`storage.games`), ADS-B (`sdr.planes`), and plain downtime |
| Whiteboard | `planning` |
| Wardrobe, dog bowl, broom, guitar | Idle pastimes only |
