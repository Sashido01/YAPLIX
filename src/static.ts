import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Context } from 'hono';
import { PROJECT_ROOT } from './store.ts';

export function staticAssets() {
  const cache = new Map<string, Promise<{ raw: Buffer; gzip: Buffer; etag: string }>>();
  return async (c: Context, path: string, type: string, revalidate = true) => {
    if (!cache.has(path)) cache.set(path, readFile(resolve(PROJECT_ROOT, path)).then(raw => ({ raw, gzip: gzipSync(raw), etag: '"' + createHash('sha256').update(raw).digest('hex') + '"' })).catch(error => { cache.delete(path); throw error; }));
    const asset = await cache.get(path)!;
    c.header('Vary', 'Accept-Encoding');
    c.header('Cache-Control', revalidate ? 'private, max-age=0, must-revalidate' : 'no-store');
    c.header('ETag', asset.etag);
    if (revalidate && c.req.header('If-None-Match') === asset.etag) return c.body(null, 304);
    c.header('Content-Type', type);
    if (/\bgzip\b/.test(c.req.header('Accept-Encoding') ?? '') && !/gzip\s*;\s*q=0(?:\.0*)?(?:\s*,|$)/.test(c.req.header('Accept-Encoding') ?? '')) {
      c.header('Content-Encoding', 'gzip'); return c.body(new Uint8Array(asset.gzip));
    }
    return c.body(new Uint8Array(asset.raw));
  };
}
