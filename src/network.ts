import { networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { privateIPv4 } from './access.ts';
import type { NetworkPolicy } from './access.ts';
import { managedPath } from './store.ts';
import { Fault } from './contracts.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function lanAddresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? []).filter(e => !e.internal && e.family === 'IPv4' && privateIPv4(e.address)).map(e => ({ name, address: e.address })));
}
// OS enumeration order is never a preference for a VPN or virtual adapter.
export function phoneAddresses(interfaces = networkInterfaces(), physicalNames?: string[]) {
  const virtual = /loopback|vpn|tun(?:nel)?|tap|wireguard|tailscale|zerotier|docker|wsl|vethernet|virtual|vmware|vbox|hyper-v|hamachi|utun|^br-|^veth/i;
  return lanAddresses(interfaces).filter(e => !virtual.test(e.name) &&
    (physicalNames ? physicalNames.includes(e.name) : /^(wi-?fi|wlan|wl\w|ethernet|eth\d|en\w|беспровод|подключение по локальной)/i.test(e.name)))
    .filter((e, i, all) => all.findIndex(x => x.address === e.address) === i);
}
export async function activePhoneAddresses() {
  if (process.platform !== 'win32') return phoneAddresses();
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ConvertTo-Json -Compress -InputObject @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object Status -eq Up | Select-Object -ExpandProperty Name)'], { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
    const names: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) throw new Error();
    return phoneAddresses(networkInterfaces(), names);
  } catch { throw new Fault('PHONE_NETWORK_CHECK_FAILED', 503); }
}
export function checkHost(policy: NetworkPolicy) {
  if (policy.mode === 'lan' && !lanAddresses().some(e => e.address === policy.host)) throw new Fault('HOST_NOT_AVAILABLE');
}
export function portError(error: NodeJS.ErrnoException) {
  return error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : error.code === 'EADDRNOTAVAIL' ? 'HOST_NOT_AVAILABLE' : error.code === 'EACCES' ? 'PORT_ACCESS_DENIED' : 'SERVER_LISTEN_FAILED';
}
export async function checkPort(policy: NetworkPolicy) {
  await new Promise<void>((done, fail) => {
    const probe = createServer();
    probe.once('error', error => fail(new Fault(portError(error))));
    probe.listen({ host: policy.host, port: policy.port, exclusive: true }, () => probe.close(() => done()));
  });
}
export function persistentLanKey(env: NodeJS.ProcessEnv = process.env) {
  if (env.YAPLIX_ACCESS_KEY) return env.YAPLIX_ACCESS_KEY;
  const path = managedPath('.local/lan-access.key');
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const key = readFileSync(path, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new Fault('ACCESS_KEY_REQUIRED');
  return key;
}
