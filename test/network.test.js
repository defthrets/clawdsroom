import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProcNetTcp, parseProcNetDev, defaultIface, summarise, isPrivate } from '../server/network.js';

const HEAD = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
const row = (i, local, remote, st) => `   ${i}: ${local} ${remote} ${st} 00000000:00000000 00:00000000 00000000     0        0 1 1 0 100 0 0 10 0`;

test('parses /proc/net/tcp addresses and states', () => {
  const s = parseProcNetTcp(HEAD + row(0, '0100007F:1F90', '00000000:0000', '0A') + '\n' + row(1, 'FD01A8C0:0016', '2801A8C0:D431', '01'));
  assert.deepEqual(s[0], { local: { ip: '127.0.0.1', port: 8080 }, remote: { ip: '0.0.0.0', port: 0 }, state: 'LISTEN' });
  assert.deepEqual(s[1].local, { ip: '192.168.1.253', port: 22 });
  assert.deepEqual(s[1].remote, { ip: '192.168.1.40', port: 54321 });
  assert.equal(s[1].state, 'ESTABLISHED');
});

test('parses /proc/net/tcp6, including v4-mapped and loopback', () => {
  const s = parseProcNetTcp(HEAD
    + row(0, '0000000000000000FFFF0000FD01A8C0:2253', '0000000000000000FFFF00002801A8C0:C000', '01') + '\n'
    + row(1, '00000000000000000000000001000000:0016', '00000000000000000000000000000000:0000', '0A') + '\n'
    + row(2, 'B80D0120000000000000000001000000:01BB', '00000000000000000000000000000000:0000', '0A'));
  assert.equal(s[0].local.ip, '192.168.1.253');
  assert.equal(s[0].remote.ip, '192.168.1.40');
  assert.equal(s[1].local.ip, '::1');
  assert.equal(s[2].local.ip, '2001:db8::1');
});

test('summarise splits inbound from outbound and ranks peers', () => {
  const L = (ip, port) => ({ ip, port });
  const sockets = [
    { local: L('0.0.0.0', 22), remote: L('0.0.0.0', 0), state: 'LISTEN' },
    { local: L('0.0.0.0', 8787), remote: L('0.0.0.0', 0), state: 'LISTEN' },
    { local: L('192.168.1.253', 8787), remote: L('192.168.1.40', 50001), state: 'ESTABLISHED' },
    { local: L('192.168.1.253', 8787), remote: L('192.168.1.40', 50002), state: 'ESTABLISHED' },
    { local: L('192.168.1.253', 40000), remote: L('140.82.113.5', 443), state: 'ESTABLISHED' },
    { local: L('192.168.1.253', 40001), remote: L('140.82.113.5', 443), state: 'ESTABLISHED' },
    { local: L('192.168.1.253', 40002), remote: L('140.82.113.5', 443), state: 'ESTABLISHED' },
    { local: L('127.0.0.1', 8787), remote: L('127.0.0.1', 50003), state: 'ESTABLISHED' },
    { local: L('192.168.1.253', 40003), remote: L('1.1.1.1', 53), state: 'TIME_WAIT' },
  ];
  const s = summarise(sockets);
  assert.equal(s.conns_in, 2);
  assert.equal(s.conns_out, 3);
  assert.equal(s.listening, 2);
  assert.deepEqual(s.ports, [{ port: 22, svc: 'ssh' }, { port: 8787, svc: 'clawd' }]);
  assert.deepEqual(s.peers[0], { ip: '140.82.113.5', port: 443, dir: 'out', n: 3, svc: 'https', scope: 'wan' });
  assert.deepEqual(s.peers[1], { ip: '192.168.1.40', port: 8787, dir: 'in', n: 2, svc: 'clawd', scope: 'lan' });
  assert.equal(s.peers.length, 2);
});

test('interface counters and the default route', () => {
  const dev = 'Inter-|   Receive |  Transmit\n face |bytes packets|bytes\n    lo:  100 1 0 0 0 0 0 0  100 1 0 0 0 0 0 0\n  eth0: 5000 9 0 0 0 0 0 0  700 8 0 0 0 0 0 0\n';
  assert.deepEqual(parseProcNetDev(dev), { lo: { rx: 100, tx: 100 }, eth0: { rx: 5000, tx: 700 } });
  const route = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\nwlan0\t0001A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\neth0\t00000000\t0101A8C0\t0003\t0\t0\t0\t00000000\n';
  assert.equal(defaultIface(route), 'eth0');
});

test('private ranges include CGNAT (Starlink / Tailscale)', () => {
  for (const ip of ['10.0.0.1', '172.20.1.1', '192.168.1.1', '100.64.0.1', '100.101.7.12', 'fd00::1', '::1']) assert.ok(isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1']) assert.ok(!isPrivate(ip), ip);
});
