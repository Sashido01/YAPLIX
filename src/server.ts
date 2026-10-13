import { serve } from '@hono/node-server';
import { createApp } from './api.ts';
import { configuredGenerator, BGEN_REVISION, checkBGen, LocalCodeAdapter } from './live.ts';
import { Store } from './store.ts';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must be enabled');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const store = new Store(process.env.YAPLIX_DB);
const adapter = configuredGenerator();
const app = createApp(store, adapter, () => {
  let bgenReady = false; try { checkBGen(); bgenReady = true; } catch { /* DEMO remains available. */ }
  return { liveConfigured: Boolean(adapter), provider: adapter instanceof LocalCodeAdapter ? adapter.provider : adapter ? 'bgen' : null, model: adapter instanceof LocalCodeAdapter ? adapter.model : null, bgenReady, bgenRevision: bgenReady ? BGEN_REVISION : null, nodeVersion: process.version };
});
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => console.log(`YAPLIX http://127.0.0.1:${port}/`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { store.close(); });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
