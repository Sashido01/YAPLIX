import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { managedPath } from './store.ts';
import { Fault } from './contracts.ts';
import type { NetworkPolicy } from './access.ts';
import {buildIdentity} from './build-identity.ts';

export const RUNTIME_PROTOCOL = 1;
export function runtimeKey() {
  const path = managedPath('.local/runtime-control.key');
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  const key = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Fault('RUNTIME_KEY_INVALID');
  return key;
}
export function proof(key: string, nonce: string, instance: string) {
  return createHmac('sha256', key).update(nonce + ':' + instance + ':' + RUNTIME_PROTOCOL).digest('hex');
}
export class RuntimeControl {
  readonly instance = randomBytes(16).toString('hex');
  private buildId=buildIdentity();
  private lease?: { id: string; expires: number };
  private original: NetworkPolicy;
  readonly policy: NetworkPolicy;
  readonly key: string;
  readonly publicReady: () => boolean;
  constructor(policy: NetworkPolicy, key: string, publicReady: () => boolean) {
    this.policy = policy; this.key = key; this.publicReady = publicReady;
    this.original = { ...policy };
  }
  identity(nonce: string) {
    if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Fault('RUNTIME_NONCE_INVALID');
    return { app: 'YAPLIX', protocol: RUNTIME_PROTOCOL, instance: this.instance, proof: proof(this.key, nonce, this.instance), mode: this.policy.mode,buildId:this.buildId };
  }
  authorized(value = '') {
    return value.length === this.key.length && timingSafeEqual(Buffer.from(value), Buffer.from(this.key));
  }
  active() { return !this.lease || this.lease.expires > Date.now(); }
  update(body: { action?: unknown; lease?: unknown; origin?: unknown; key?: unknown }) {
    if (body.action === 'prepare') {
      if (this.lease) throw new Fault('TUNNEL_ALREADY_ATTACHED', 409);
      if (this.original.mode !== 'local') throw new Fault('RUNTIME_LOCAL_REQUIRED', 409);
      if (!this.publicReady()) throw new Fault('TELEGRAM_SINGLE_OWNER_REQUIRED', 409);
      if (typeof body.key !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(body.key)) throw new Fault('ACCESS_KEY_REQUIRED');
      this.lease = { id: randomBytes(32).toString('hex'), expires: Date.now() + 120_000 };
      Object.assign(this.policy, { mode: 'https', origin: 'https://pending.invalid', key: body.key });
      return { lease: this.lease.id };
    }
    if (!this.lease || body.lease !== this.lease.id) throw new Fault('RUNTIME_LEASE_INVALID', 403);
    if (body.action === 'release') {
      // Local mode rejects forwarded traffic even if a connector outlives its parent.
      delete this.policy.origin; delete this.policy.key; Object.assign(this.policy, this.original); this.lease = undefined;
    } else if (body.action === 'activate') {
      if (typeof body.origin !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(body.origin)) throw new Fault('PUBLIC_URL_INVALID');
      this.policy.origin = body.origin; this.lease.expires = Date.now() + 20_000;
    } else if (body.action === 'heartbeat') this.lease.expires = Date.now() + 20_000;
    else throw new Fault('RUNTIME_ACTION_INVALID');
    return { ok: true };
  }
}
