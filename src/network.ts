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
import { fileURLToPath } from 'node:url';

export type PhoneAddress = { name: string; address: string; kind?: 'hotspot' };

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
/** Positive WinRT On + a unique active Microsoft Wi-Fi Direct adapter, then
 * cross-check its preferred IPv4 against Node's current interface inventory.
 * A name, common hotspot IP, ICS setting or arbitrary virtual adapter is insufficient.
 */
export function windowsPhoneAddresses(value: unknown, interfaces = networkInterfaces()): PhoneAddress[] {
  if (!value || typeof value !== 'object') throw new Fault('PHONE_NETWORK_CHECK_FAILED', 503);
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.physical) || v.physical.some(n => typeof n !== 'string') ||
      !['On','Off','Unavailable'].includes(String(v.hotspotState)) || !Array.isArray(v.hotspot)) throw new Fault('PHONE_NETWORK_CHECK_FAILED', 503);
  const physical = phoneAddresses(interfaces, v.physical as string[]);
  const candidates: PhoneAddress[] = [];
  if (v.hotspotState === 'On') {
    for (const raw of v.hotspot) {
      if (!raw || typeof raw !== 'object') throw new Fault('PHONE_NETWORK_CHECK_FAILED', 503);
      const h = raw as Record<string, unknown>;
      if (typeof h.name !== 'string' || typeof h.guid !== 'string' || !/^\{?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?$/i.test(h.guid) ||
          !Array.isArray(h.addresses) || h.addresses.some(a => typeof a !== 'string')) throw new Fault('PHONE_NETWORK_CHECK_FAILED', 503);
      if (h.hardware !== false || h.status !== 'Up' || h.interfaceType !== 71 || typeof h.description !== 'string' ||
          !/^Microsoft Wi-Fi Direct Virtual Adapter(?: #\d+)?$/.test(h.description)) continue;
      const preferredAddresses = h.addresses as string[];
      const addresses = lanAddresses(interfaces).filter(n => n.name === h.name && preferredAddresses.includes(n.address));
      for (const entry of addresses) candidates.push({ ...entry, kind: 'hotspot' });
    }
  }
  // Ambiguous Wi-Fi Direct inventory never picks the first virtual address.
  return candidates.length === 1 ? [candidates[0], ...physical.filter(n => n.address !== candidates[0].address)] : physical;
}
export async function activePhoneAddresses(): Promise<PhoneAddress[]> {
  if (process.platform !== 'win32') return phoneAddresses();
  try {
    const script = readFileSync(fileURLToPath(new URL('./windows-phone-network.ps1', import.meta.url)), 'utf8');
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000, maxBuffer: 65536 });
    return windowsPhoneAddresses(JSON.parse(stdout.replace(/^\uFEFF/, '')));
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
