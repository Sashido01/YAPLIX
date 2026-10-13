import { serve } from '@hono/node-server';
import { createApp } from './api.ts';
import { configuredGenerator, BGEN_REVISION, checkBGen, LocalCodeAdapter } from './live.ts';
import { Store } from './store.ts';
import { networkPolicy } from './access.ts';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must be enabled');
const policy = networkPolicy(), { port } = policy;
const store = new Store(process.env.YAPLIX_DB);
const adapter = configuredGenerator();
const app = createApp(store, adapter, () => {
  let bgenReady = false; try { checkBGen(); bgenReady = true; } catch { /* DEMO remains available. */ }
  return { liveConfigured: Boolean(adapter), provider: adapter instanceof LocalCodeAdapter ? adapter.provider : adapter ? 'bgen' : null, model: adapter instanceof LocalCodeAdapter ? adapter.model : null, bgenReady, bgenRevision: bgenReady ? BGEN_REVISION : null, nodeVersion: process.version };
}, policy);
const server = serve({ fetch: app.fetch, hostname: policy.host, port }, () => console.log(`YAPLIX ${policy.origin ?? `http://127.0.0.1:${port}`}/ (${policy.mode})`));
if ('requestTimeout' in server) server.requestTimeout = 15_000;
if ('headersTimeout' in server) server.headersTimeout = 10_000;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  adapter?.close?.();
  const deadline = setTimeout(() => { if ('closeAllConnections' in server) server.closeAllConnections(); }, 5000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); store.close(); console.log('YAPLIX stopped; SQLite closed'); process.disconnect?.(); });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Uses the same graceful path on Windows without a remote shutdown endpoint.
process.on('message', message => { if (message === 'shutdown') stop(); });
