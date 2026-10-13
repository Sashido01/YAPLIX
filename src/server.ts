import { serve } from '@hono/node-server';
import { createApp } from './api.ts';
import { BGenAdapter } from './bgen.ts';
import { Store } from './store.ts';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must be enabled');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const store = new Store(process.env.YAPLIX_DB);
const adapter = process.env.BGEN_URL ? new BGenAdapter({ url: process.env.BGEN_URL, timeoutMs: Number(process.env.BGEN_TIMEOUT_MS ?? 30_000), initData: process.env.BGEN_INIT_DATA }) : undefined;
const server = serve({ fetch: createApp(store, adapter).fetch, hostname: '127.0.0.1', port }, () => console.log(`YAPLIX API http://127.0.0.1:${port}/api/health`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { store.close(); });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
