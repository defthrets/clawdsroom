// Linux system collector: fills state.system from /proc, /sys and `df` so the house
// shows live CPU / RAM / temp / disk / uptime without anything else being wired up.
// Everything is best-effort; a missing file just leaves that stat alone.

import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';

let prevCpu = null;

async function readFile(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function cpuPercent() {
  const stat = await readFile('/proc/stat');
  if (!stat) return null;
  const line = stat.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = n[3] + (n[4] || 0);
  const total = n.reduce((a, b) => a + b, 0);
  const cur = { idle, total };
  let pct = null;
  if (prevCpu) {
    const dt = cur.total - prevCpu.total;
    const di = cur.idle - prevCpu.idle;
    if (dt > 0) pct = Math.round(100 * (1 - di / dt));
  }
  prevCpu = cur;
  return pct;
}

async function ramPercent() {
  const mem = await readFile('/proc/meminfo');
  if (mem) {
    const get = (k) => {
      const m = mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'));
      return m ? Number(m[1]) : null;
    };
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (total && avail != null) return Math.round(100 * (1 - avail / total));
  }
  const t = os.totalmem();
  return t ? Math.round(100 * (1 - os.freemem() / t)) : null;
}

async function cpuTemp() {
  // Try thermal zones first, then hwmon. Values are millidegrees.
  const candidates = [];
  try {
    const zones = await fs.readdir('/sys/class/thermal');
    for (const z of zones) if (z.startsWith('thermal_zone')) candidates.push(`/sys/class/thermal/${z}/temp`);
  } catch { /* no thermal zones */ }
  try {
    const hw = await fs.readdir('/sys/class/hwmon');
    for (const h of hw) {
      const dir = `/sys/class/hwmon/${h}`;
      let files = [];
      try { files = await fs.readdir(dir); } catch { continue; }
      for (const f of files) if (/^temp\d+_input$/.test(f)) candidates.push(`${dir}/${f}`);
    }
  } catch { /* no hwmon */ }
  let best = null;
  for (const c of candidates) {
    const v = Number((await readFile(c) || '').trim());
    if (Number.isFinite(v) && v > 0) {
      const deg = v > 1000 ? v / 1000 : v;
      if (deg < 150 && (best == null || deg > best)) best = deg;
    }
  }
  return best == null ? null : Math.round(best);
}

function diskPercent(path) {
  return new Promise((resolve) => {
    execFile('df', ['-kP', path], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.trim().split('\n').pop();
      const m = line && line.match(/(\d+)%/);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

function diskUsedGb(path) {
  return new Promise((resolve) => {
    execFile('df', ['-kP', path], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const parts = (stdout.trim().split('\n').pop() || '').trim().split(/\s+/);
      if (parts.length < 4) return resolve(null);
      const used = Number(parts[2]) / 1024 / 1024;
      const total = Number(parts[1]) / 1024 / 1024;
      resolve({ used: Math.round(used), total: Math.round(total) });
    });
  });
}

export async function collectSystem({ diskRoot = '/', diskMnt = '/mnt' } = {}) {
  const [cpu, ram, temp, dRoot, dMnt, mnt] = await Promise.all([
    cpuPercent(), ramPercent(), cpuTemp(), diskPercent(diskRoot), diskPercent(diskMnt), diskUsedGb(diskMnt),
  ]);
  const system = {};
  if (cpu != null) system.cpu = cpu;
  if (ram != null) system.ram = ram;
  if (temp != null) system.temp = temp;
  if (dRoot != null) system.disk_root = dRoot;
  if (dMnt != null) system.disk_mnt = dMnt;
  system.uptime = Math.round(os.uptime());
  system.load = os.loadavg().map((n) => n.toFixed(2)).join(' ');
  const patch = { system };
  if (mnt && mnt.total > 0) patch.storage = { mnt_used_gb: mnt.used, mnt_total_gb: mnt.total };
  return patch;
}
