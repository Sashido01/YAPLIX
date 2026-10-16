import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { activePhoneAddresses, portError } from './network.ts';
import { Fault } from './contracts.ts';
import type { Store } from './store.ts';
import { staticAssets } from './static.ts';
import { connectionQr } from './qr.ts';

const hash = (value: string) => createHash('sha256').update(value).digest();
export const PHONE_TTL = 30 * 60_000;
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
async function probePage(origin: string) {
  const response = await fetch(origin + '/phone', { redirect: 'error', signal: AbortSignal.timeout(3000) });
  return response.ok && (await response.text()).includes('phone-ui.js');
}

/** A disposable listener, sharing the owner's Store. No owner API is mounted. */
export class PhoneConnection {
  private server?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { origin: string; url: string; versionId: string; expiresAt: number; token: Buffer; cookie?: Buffer; lastOpenedAt?: number };
  private busy = false;
  private stopped = false;
  private store: Store;
  private addresses: typeof activePhoneAddresses;
  private now: () => number;
  private probe: typeof probePage;
  constructor(store: Store, addresses = activePhoneAddresses, now = Date.now, probe = probePage) { this.store = store; this.addresses = addresses; this.now = now; this.probe = probe; }
  networks() { return this.addresses(); }
  status() {
    const a = this.active;
    return a && a.expiresAt > this.now() ? { enabled: true, url: a.url, versionId: a.versionId, expiresAt: a.expiresAt, lastOpenedAt: a.lastOpenedAt ?? null } : { enabled: false };
  }
  qr() {
    const a = this.active;
    if (!a || a.expiresAt <= this.now()) throw new Fault('PHONE_ACCESS_EXPIRED', 409);
    return connectionQr(a.url, false, true);
  }
  async enable(versionId: string, address?: string) {
    if (this.stopped) throw new Fault('PHONE_SERVER_STOPPED', 503);
    if (this.busy) throw new Fault('PHONE_BUSY', 409);
    this.busy = true;
    try {
      this.store.getVersion(versionId);
      const networks = await this.networks();
      if (this.stopped) throw new Fault('PHONE_SERVER_STOPPED', 503);
      if (!networks.length) throw new Fault('PHONE_NO_NETWORK', 409);
      if (!address && networks.length > 1) throw new Fault('PHONE_CHOOSE_NETWORK', 409);
      const host = address ?? networks[0].address;
      if (!networks.some(n => n.address === host)) throw new Fault('HOST_NOT_AVAILABLE', 409);
      await this.close();
      const token = randomBytes(32).toString('base64url');
      const app = this.mobileApp();
      this.server = await new Promise<Server>((done, fail) => {
        const server = serve({ fetch: app.fetch, hostname: host, port: 0 }, () => done(server as Server));
        server.once('error', fail);
      });
      if (this.stopped) throw new Fault('PHONE_SERVER_STOPPED', 503);
      const port = (this.server.address() as { port: number }).port;
      this.server.maxConnections = 32; this.server.requestTimeout = 5000; this.server.headersTimeout = 5000; this.server.keepAliveTimeout = 1000;
      const origin = `http://${host}:${port}`;
      this.active = { origin, url: origin + '/phone#' + token, versionId, expiresAt: this.now() + PHONE_TTL, token: hash(token) };
      // Confirm the actual bound page before returning a QR. This is PC evidence,
      // not a claim about a phone, router isolation, VPN or inbound firewall.
      if (!await this.probe(origin)) throw new Fault('PHONE_SERVER_UNREACHABLE', 503);
      if (this.stopped) throw new Fault('PHONE_SERVER_STOPPED', 503);
      this.timer = setTimeout(() => { void this.close(); }, PHONE_TTL); this.timer.unref();
      return this.status();
    } catch (error) {
      await this.close();
      if (error instanceof Fault) throw error;
      throw new Fault((error as NodeJS.ErrnoException).code ? portError(error as NodeJS.ErrnoException) : 'PHONE_SERVER_UNREACHABLE', 503);
    } finally { this.busy = false; }
  }
  async disable() {
    if (this.busy) throw new Fault('PHONE_BUSY', 409);
    await this.close(); return this.status();
  }
  async close() {
    clearTimeout(this.timer); this.timer = undefined; this.active = undefined;
    const server = this.server; this.server = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  }
  async shutdown() { this.stopped = true; await this.close(); }
  private mobileApp() {
    const app = new Hono(), asset = staticAssets();
    app.use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
      c.header('X-Content-Type-Options', 'nosniff'); c.header('Content-Security-Policy', CSP);
      const a = this.active, url = new URL(c.req.url);
      if (!a || a.expiresAt <= this.now()) throw new Fault('PHONE_ACCESS_EXPIRED', 401);
      if (url.origin !== a.origin || c.req.header('Host') !== url.host || c.req.header('X-Forwarded-For') || c.req.header('X-Forwarded-Proto')) throw new Fault('HOST_FORBIDDEN', 403);
      const navigation = c.req.method === 'GET' && c.req.path === '/phone';
      if (c.req.header('Origin') && c.req.header('Origin') !== a.origin || c.req.header('Sec-Fetch-Site') === 'cross-site' && !navigation) throw new Fault('ORIGIN_FORBIDDEN', 403);
      if (c.req.method === 'POST' && c.req.path === '/phone/access') {
        // Token arrives in a bounded body, never in HTTP URL, Referer or logs.
        if (Number(c.req.header('Content-Length') ?? 0) > 64) throw new Fault('ACCESS_DENIED', 401);
        const reader = c.req.raw.body?.getReader(); let token = '';
        if (!reader) throw new Fault('ACCESS_DENIED', 401);
        try { for (;;) { const part = await reader.read(); if (part.done) break; token += new TextDecoder().decode(part.value); if (token.length > 64) { await reader.cancel(); throw new Fault('ACCESS_DENIED', 401); } } } finally { reader.releaseLock(); }
        if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !timingSafeEqual(hash(token), a.token)) throw new Fault('ACCESS_DENIED', 401);
        const cookie = randomBytes(32).toString('base64url'); a.cookie = hash(cookie);
        c.header('Set-Cookie', `yaplix_phone=${cookie}; Path=/phone; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((a.expiresAt - this.now()) / 1000))}`);
        return c.json({ ok: true });
      }
      if (c.req.method === 'GET' && ['/phone','/phone/style.css','/phone/phone-ui.js'].includes(c.req.path)) { await next(); return; }
      const cookie = c.req.header('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('yaplix_phone='))?.slice(13);
      if (!cookie || cookie.length !== 43 || !a.cookie || !timingSafeEqual(hash(cookie), a.cookie)) throw new Fault('ACCESS_REQUIRED', 401);
      // Explicit allowlist; no API proxy, static directory or filesystem route.
      if (c.req.method !== 'GET' || c.req.path !== '/phone/version') throw new Fault('PHONE_READ_ONLY', 403);
      await next();
    });
    app.get('/phone', c => asset(c, 'assets/phone.html', 'text/html; charset=utf-8', false));
    app.get('/phone/style.css', c => asset(c, 'assets/phone.css', 'text/css; charset=utf-8', false));
    app.get('/phone/phone-ui.js', c => asset(c, 'build/public/phone-ui.js', 'text/javascript; charset=utf-8', false));
    app.get('/phone/version', c => {
      const a = this.active!, v = this.store.getVersion(a.versionId); a.lastOpenedAt = this.now();
      return c.json({ html: v.html, versionId: v.versionId, title: v.spec.prompt, expiresAt: a.expiresAt });
    });
    app.onError((error, c) => c.json({ error: error instanceof Fault ? error.code : 'PHONE_UNAVAILABLE' }, error instanceof Fault ? error.status as 400 : 500));
    return app;
  }
}
