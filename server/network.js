// Network collector for the HUD: throughput from /proc/net/dev and who the homelab is talking
// to from /proc/net/tcp + tcp6. A connection is "in" when its local port is one we listen on,
// otherwise "out". Loopback-to-loopback chatter is ignored. Everything is best-effort.
//
// Inside Docker, /proc/net is the container's own namespace: run with `network_mode: host`
// to see the homelab's real connections (see compose.yaml).

import fs from 'node:fs/promises';
import dns from 'node:dns/promises';

// Well-known ports → a short service name for the HUD.
export const SERVICES = {
  20: 'ftp', 21: 'ftp', 22: 'ssh', 25: 'smtp', 53: 'dns', 67: 'dhcp', 80: 'http', 110: 'pop3', 123: 'ntp',
  143: 'imap', 443: 'https', 445: 'smb', 465: 'smtps', 587: 'smtp', 853: 'dot', 993: 'imaps', 1883: 'mqtt',
  2283: 'immich', 3000: 'web', 3306: 'mysql', 5000: 'frigate', 5222: 'xmpp', 5353: 'mdns', 5432: 'postgres',
  6379: 'redis', 8080: 'http-alt', 8123: 'home-asst', 8443: 'https-alt', 8554: 'rtsp', 8787: 'clawd',
  8883: 'mqtts', 8971: 'frigate', 9000: 'starlink', 9090: 'prom', 9200: 'starlink', 9201: 'starlink',
  32400: 'plex', 51820: 'wireguard', 41641: 'tailscale', 554: 'rtsp', 1935: 'rtmp',
};

const TCP_STATE = { '01': 'ESTABLISHED', '0A': 'LISTEN' };

// "0100007F" (little-endian 32-bit word) → "127.0.0.1"
function hexToIPv4(h) {
  return [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join('.');
}

// 32 hex chars, four little-endian 32-bit words → compressed IPv6 (v4-mapped becomes plain v4).
function hexToIPv6(h) {
  const bytes = [];
  for (let w = 0; w < 4; w++) {
    const word = h.slice(w * 8, w * 8 + 8);
    for (let i = 6; i >= 0; i -= 2) bytes.push(parseInt(word.slice(i, i + 2), 16));
  }
  const isMapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) return bytes.slice(12).join('.');
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  // collapse the longest run of zero groups
  let best = [-1, 0], cur = [-1, 0];
  groups.forEach((g, i) => {
    if (g === '0') { if (cur[0] < 0) cur = [i, 0]; cur[1]++; if (cur[1] > best[1]) best = [...cur]; } else cur = [-1, 0];
  });
  if (best[1] < 2) return groups.join(':');
  const left = groups.slice(0, best[0]).join(':'), right = groups.slice(best[0] + best[1]).join(':');
  return `${left}::${right}`;
}

function parseAddr(s) {
  const [ip, port] = s.split(':');
  return { ip: ip.length > 8 ? hexToIPv6(ip) : hexToIPv4(ip), port: parseInt(port, 16) };
}

// Parse the text of /proc/net/tcp or /proc/net/tcp6 into [{local, remote, state}].
export function parseProcNetTcp(text) {
  const out = [];
  for (const line of (text || '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    out.push({ local: parseAddr(f[1]), remote: parseAddr(f[2]), state: TCP_STATE[f[3]] || f[3] });
  }
  return out;
}

export function isLoopback(ip) { return ip.startsWith('127.') || ip === '::1'; }

export function isPrivate(ip) {
  if (isLoopback(ip)) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT (Starlink, Tailscale)
  return /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

// Sockets → counts and the busiest peers.
export function summarise(sockets, { maxPeers = 16 } = {}) {
  const listening = new Set();
  for (const s of sockets) if (s.state === 'LISTEN') listening.add(s.local.port);
  let inbound = 0, outbound = 0;
  const peers = new Map();
  for (const s of sockets) {
    if (s.state !== 'ESTABLISHED') continue;
    if (isLoopback(s.local.ip) && isLoopback(s.remote.ip)) continue;
    const dir = listening.has(s.local.port) ? 'in' : 'out';
    if (dir === 'in') inbound++; else outbound++;
    const port = dir === 'in' ? s.local.port : s.remote.port;
    const key = `${dir}|${s.remote.ip}|${port}`;
    const p = peers.get(key) || { ip: s.remote.ip, port, dir, n: 0, svc: SERVICES[port] || '', scope: isPrivate(s.remote.ip) ? 'lan' : 'wan' };
    p.n++;
    peers.set(key, p);
  }
  const list = [...peers.values()].sort((a, b) => b.n - a.n || (a.scope === 'wan' ? -1 : 1)).slice(0, maxPeers);
  const ports = [...listening].sort((a, b) => a - b).slice(0, 24).map((port) => ({ port, svc: SERVICES[port] || '' }));
  return { conns_in: inbound, conns_out: outbound, listening: listening.size, ports, peers: list };
}

// /proc/net/dev → {iface: {rx, tx}} in bytes.
export function parseProcNetDev(text) {
  const out = {};
  for (const line of (text || '').split('\n').slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    out[m[1].trim()] = { rx: f[0], tx: f[8] };
  }
  return out;
}

// The interface carrying the default route, from /proc/net/route.
export function defaultIface(routeText) {
  for (const line of (routeText || '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] === '00000000' && f[7] === '00000000') return f[0];
  }
  return null;
}

async function readFile(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

// Reverse DNS for WAN peers, cached for an hour (failures too) so it never slows the collector.
const rdns = new Map();
function hostFor(ip) {
  const hit = rdns.get(ip);
  if (!hit || Date.now() - hit.at >= 3600e3) {
    rdns.set(ip, { name: hit?.name || '', at: Date.now() });
    const timeout = new Promise((r) => setTimeout(() => r([]), 1500).unref());
    Promise.race([dns.reverse(ip).catch(() => []), timeout]).then((names) => {
      if (names && names[0]) rdns.set(ip, { name: names[0], at: Date.now() });
    });
    if (rdns.size > 2000) rdns.delete(rdns.keys().next().value);
  }
  return hit?.name || '';
}

let prevDev = null;

export async function collectNetwork({ iface = process.env.NET_IFACE || '' } = {}) {
  const [tcp4, tcp6, dev, route] = await Promise.all([
    readFile('/proc/net/tcp'), readFile('/proc/net/tcp6'), readFile('/proc/net/dev'), readFile('/proc/net/route'),
  ]);
  const network = {};

  if (tcp4 || tcp6) {
    const sum = summarise([...parseProcNetTcp(tcp4), ...parseProcNetTcp(tcp6)]);
    for (const p of sum.peers) { const h = p.scope === 'wan' ? hostFor(p.ip) : ''; if (h) p.host = h; }
    Object.assign(network, sum);
  }

  const counters = parseProcNetDev(dev);
  const name = iface || defaultIface(route) || Object.keys(counters).find((n) => n !== 'lo' && !/^(docker|veth|br-|virbr)/.test(n));
  const c = name && counters[name];
  if (c) {
    const now = Date.now();
    network.iface = name;
    if (prevDev && prevDev.name === name && now > prevDev.at) {
      const dt = (now - prevDev.at) / 1000;
      network.rx_bps = Math.max(0, Math.round((c.rx - prevDev.rx) * 8 / dt));
      network.tx_bps = Math.max(0, Math.round((c.tx - prevDev.tx) * 8 / dt));
    }
    network.rx_total = c.rx;
    network.tx_total = c.tx;
    prevDev = { name, at: now, rx: c.rx, tx: c.tx };
  }
  return network;
}
