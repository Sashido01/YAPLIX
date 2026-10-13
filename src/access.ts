import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Fault } from './contracts.ts';

export type NetworkPolicy = { mode: 'local' | 'lan' | 'https'; host: string; port: number; origin?: string; key?: string };
export function privateIPv4(host: string) {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}
export function networkPolicy(env: NodeJS.ProcessEnv = process.env): NetworkPolicy {
  const port = Number(env.PORT ?? 3000), mode = env.YAPLIX_MODE ?? 'local';
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Fault('INVALID_PORT');
  if (!['local', 'lan', 'https'].includes(mode)) throw new Fault('INVALID_NETWORK_MODE');
  const host = env.YAPLIX_HOST ?? '127.0.0.1';
  if (mode === 'local') {
    if (host !== '127.0.0.1' || env.PUBLIC_URL) throw new Fault('LOCAL_MUST_USE_LOOPBACK');
    return { mode, host, port };
  }
  if (!env.YAPLIX_ACCESS_KEY || !/^[A-Za-z0-9_-]{32,128}$/.test(env.YAPLIX_ACCESS_KEY)) throw new Fault('ACCESS_KEY_REQUIRED');
  if (mode === 'lan') {
    if (!privateIPv4(host) || env.PUBLIC_URL) throw new Fault('LAN_PRIVATE_ADDRESS_REQUIRED');
    return { mode, host, port, origin: `http://${host}:${port}`, key: env.YAPLIX_ACCESS_KEY };
  }
  let url: URL;
  try { url = new URL(env.PUBLIC_URL ?? ''); } catch { throw new Fault('HTTPS_PUBLIC_URL_REQUIRED'); }
  if (host !== '127.0.0.1' || url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Fault('HTTPS_PROXY_CONFIGURATION_INVALID');
  return { mode: 'https', host, port, origin: url.origin, key: env.YAPLIX_ACCESS_KEY };
}
const digest = (key: string) => createHash('sha256').update(key).digest();
export class AccessSessions {
  private tokens = new Map<string, number>();
  private failures = 0;
  private window = Date.now();
  private key: string;
  private secure: boolean;
  constructor(key: string, secure: boolean) { this.key = key; this.secure = secure; }
  login(key: unknown): string {
    const now = Date.now();
    if (now - this.window > 60_000) { this.window = now; this.failures = 0; }
    // A remote caller cannot lock out the owner by exhausting the failure window.
    if (typeof key !== 'string' || key.length > 128 || !timingSafeEqual(digest(key), digest(this.key))) {
      if (this.failures >= 10) throw new Fault('ACCESS_RATE_LIMIT', 429);
      this.failures++; throw new Fault('ACCESS_DENIED', 401);
    }
    for (const [id, expiry] of this.tokens) if (expiry <= now) this.tokens.delete(id);
    if (this.tokens.size >= 1000) throw new Fault('ACCESS_SESSION_LIMIT', 503);
    const token = randomBytes(32).toString('hex');
    this.tokens.set(digest(token).toString('hex'), now + 8 * 3600_000);
    return `yaplix_access=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${this.secure ? '; Secure' : ''}`;
  }
  allowed(cookie = ''): boolean {
    const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('yaplix_access='))?.slice(14);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    return (this.tokens.get(digest(token).toString('hex')) ?? 0) > Date.now();
  }
}
