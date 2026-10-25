# Installing Clawd's Room and the HUD (for Clawd)

Hi Clawd. This is the runbook for setting up your room, the ops HUD and the neural link on the homelab yourself.
Work through it top to bottom, run the checks after each step, and stop to ask before anything marked **ASK**.

* Repo: https://github.com/defthrets/clawdsroom (the HUD is on branch `ccr-ac557b06-2x6egw` until PR #1 is merged)
* Installs to `/opt/clawdsroom`, runs as a systemd service on port **8787** (HTTP) and **8788** (HTTPS, for the mic)
* The room: `http://<homelab>:8787/` · the HUD: `http://<homelab>:8787/hud/` · with the mic: `https://<host>:8788/hud/`
* No npm install: it is one Node server with no dependencies. Needs Node 18 or newer.

## 1. Get the code

```bash
node --version                     # must be v18 or newer
sudo mkdir -p /opt/clawdsroom && sudo chown "$USER" /opt/clawdsroom
git clone https://github.com/defthrets/clawdsroom /opt/clawdsroom
cd /opt/clawdsroom
git checkout ccr-ac557b06-2x6egw   # skip once PR #1 is merged; then the default branch has it
npm test                           # all tests should pass
```

## 2. Run it as a service

```bash
sudo useradd --system --home /opt/clawdsroom --shell /usr/sbin/nologin clawd 2>/dev/null || true
sudo chown -R clawd: /opt/clawdsroom/data
sudo cp deploy/clawdsroom.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clawdsroom
```

Check:

```bash
curl -s localhost:8787/api/health                 # {"ok":true,...}
curl -s localhost:8787/api/state | head -c 300     # system.cpu etc. filling in
curl -s localhost:8787/hud/ | grep -c NEURAL       # 1 or more: the HUD is served
```

If `/mnt` is not the big disk, set `DISK_MNT` in the unit. CPU, RAM, temperature, disks and the network/connection
radar fill themselves in from `/proc` and `/sys`.

## 3. Link the HUD to you (Hermes Agent)

The neural link talks to you through Hermes Agent's API server.

1. **ASK** before changing your own Hermes config. Then in `~/.hermes/.env`:
   ```bash
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<generate: openssl rand -hex 32>
   ```
   Restart `hermes gateway`; its log should say `API server listening on http://127.0.0.1:8642`.
   (If the room ever runs on a different machine or in Docker, also set `API_SERVER_HOST=0.0.0.0`, and only on a trusted network.)
2. Give the room the same key, outside git:
   ```bash
   cat > /opt/clawdsroom/data/room.env <<'ENV'
   HERMES_API_SERVER_KEY=<the same key>
   ENV
   chmod 600 /opt/clawdsroom/data/room.env && sudo chown clawd: /opt/clawdsroom/data/room.env
   cp scripts/examples/agents.example.json data/agents.json
   sudo systemctl restart clawdsroom
   ```
3. Check:
   ```bash
   curl -s localhost:8787/api/comms/agents          # clawd: ready true, type hermes, online true
   curl -s localhost:8787/api/hermes/overview | head -c 400
   curl -s -X POST localhost:8787/api/comms/send -H 'content-type: application/json' \
     -d '{"to":"clawd","text":"HUD link test, reply with one word."}'
   sleep 15; curl -s 'localhost:8787/api/comms/log?agent=clawd' | tail -c 600   # your reply is in there
   ```
   The HUD uses the session `clawd-hud` (Hermes keeps that conversation), and uses the Runs API when
   `/v1/capabilities` offers it, so approvals and clarifying questions show on the wall for the owner to answer.

## 4. HTTPS, so the iPad mic works

iPad Safari only allows the microphone on HTTPS. Pick one; **ASK** which the owner prefers.

* **Tailscale** (nothing to install on the iPad, if it is on the tailnet):
  ```bash
  sudo mkdir -p /opt/clawdsroom/data/tls && cd /opt/clawdsroom/data/tls
  sudo tailscale cert --cert-file cert.pem --key-file key.pem "$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
  sudo chown -R clawd: /opt/clawdsroom/data/tls
  ```
  The iPad opens `https://<homelab>.<tailnet>.ts.net:8788/hud/`. Certs last 90 days: renew monthly from cron.
* **mkcert** (LAN address): `mkcert -cert-file data/tls/cert.pem -key-file data/tls/key.pem 192.168.1.253`, then the owner
  installs mkcert's `rootCA.pem` on the iPad and trusts it (Settings → General → About → Certificate Trust Settings).
  The iPad opens `https://192.168.1.253:8788/hud/`.

Then add to `data/room.env` and restart:

```bash
TLS_CERT=/opt/clawdsroom/data/tls/cert.pem
TLS_KEY=/opt/clawdsroom/data/tls/key.pem
```

Check: `curl -sk https://localhost:8788/api/health` and `journalctl -u clawdsroom -n 20` shows `HTTPS on port 8788`.

## 5. Speech to text (so your voice messages arrive as words)

Your API server takes text, not audio. Safari sometimes transcribes on the iPad, but for reliable transcripts run a
Whisper server and point the room at it. If your own voice mode already uses faster-whisper, the same engine works:

```bash
docker run -d --name speaches --restart unless-stopped -p 127.0.0.1:8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
echo 'STT_URL=http://127.0.0.1:8000/v1/audio/transcriptions' >> /opt/clawdsroom/data/room.env
echo 'STT_MODEL=Systran/faster-whisper-small' >> /opt/clawdsroom/data/room.env
sudo systemctl restart clawdsroom
```

Optional nicer reply voices: any OpenAI-style `/v1/audio/speech` endpoint as `TTS_URL` (plus `TTS_KEY`, `TTS_VOICE`).

## 6. Starlink

Needs `grpcurl` and `jq`, and a route to the dish (`192.168.100.1`; in bypass mode add a route to
`192.168.100.0/24` via the Starlink interface).

```bash
grpcurl -plaintext -d '{"get_status":{}}' 192.168.100.1:9200 SpaceX.API.Device.Device/Handle | head   # should print dishGetStatus
```

Run it forever with a small unit (or `@reboot` cron, see `scripts/examples/crontab.example`):

```bash
sudo tee /etc/systemd/system/clawdsroom-starlink.service >/dev/null <<'UNIT'
[Unit]
Description=Starlink → Clawd's Room
After=clawdsroom.service
[Service]
ExecStart=/opt/clawdsroom/scripts/examples/starlink.sh --loop 5
Environment=ROOM_URL=http://localhost:8787
EnvironmentFile=-/opt/clawdsroom/data/room.env
Restart=always
RestartSec=10
User=clawd
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now clawdsroom-starlink
```

Check: `curl -s localhost:8787/api/state | jq .starlink` shows `online: true` and a recent `updated`.

## 7. Keep the room alive (your hooks)

The room shows what you are doing. Use `scripts/room` (add it to your PATH, e.g.
`sudo ln -s /opt/clawdsroom/scripts/room /usr/local/bin/room`):

```bash
room do terminal "Restarting Frigate."      # when you start something (see README for all activities)
room do idle                                # when you finish
room say "Fan curve sorted."                # speech bubble
room state memory.notes=212 memory.skills=27
room event cron "name=morning brief"        # first line of each cron job
room reply clawd "Done, cache cleared."     # answer on the HUD later, out loud
room inbox clawd                            # what the owner said to you from the HUD
```

The full list of state keys and events is in `docs/STATE.md`. The Frigate and Immich collectors are in `scripts/examples/`.

## 8. Hand-over to the owner

Tell the owner:

1. On the HUD iPad: open the HUD address (HTTPS one for the mic), Share → **Add to Home Screen** ("Clawd HUD").
2. Settings → Display & Brightness → Auto-Lock → **Never**; keep it plugged in. Optionally Guided Access.
3. Tap **COMMS** to talk to you, **HERMES** for your systems. Approvals for risky commands pop up on the wall.
4. Recommend setting `CLAWDSROOM_TOKEN` in `data/room.env` if anything untrusted can reach port 8787/8788; then open
   the HUD once with `?token=<it>` so the iPad remembers it.

## Updating later

```bash
cd /opt/clawdsroom && git pull && npm test && sudo systemctl restart clawdsroom
```

## If something is off

* `journalctl -u clawdsroom -f`: the server logs every collector, comms and HTTPS problem.
* COMMS card says **OFFLINE**: Hermes' `/health` on 8642 isn't answering, or the key is wrong.
* Messages say **QUEUED · NO LINK**: `data/agents.json` is missing or has no `type`.
* Tool steps or approvals look blank: Hermes sent a payload shape the HUD doesn't know yet. Save a sample with
  `curl -N -H "Authorization: Bearer $KEY" localhost:8642/v1/runs/<run_id>/events` and report it.
* Connections radar empty in Docker: use `network_mode: host` (see `compose.yaml`).
