import { serve } from '@hono/node-server';
import { createApp } from './api.ts';
import { configuredGenerator } from './live.ts';
import { Store } from './store.ts';
import { networkPolicy } from './access.ts';
import { checkHost, checkPort, portError } from './network.ts';
import { liveReadiness, missingProductionFiles } from './diagnostics.ts';
import { RuntimeControl, runtimeKey } from './runtime-control.ts';
import { TelegramSessions } from './telegram.ts';
import { GenerationJobs } from './jobs.ts';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must be enabled');
const policy = networkPolicy(), { port } = policy;
checkHost(policy);
try{await checkPort(policy);}catch(error){console.error(error instanceof Error?error.message:'PORT_CHECK_FAILED');process.exit(1);}
if (missingProductionFiles().length) { console.error('RUNTIME_BUILD_REQUIRED: npm run build'); process.exit(1); }
const store = new Store(process.env.YAPLIX_DB);
const adapter = configuredGenerator();
const telegram = new TelegramSessions();
const control = new RuntimeControl(policy, runtimeKey(), () => telegram.singleOwner());
const jobs=new GenerationJobs(store,adapter,(owner,gameId,versionId)=>telegram.notifyReady(owner,gameId,versionId,policy.mode==='https'?policy.origin:undefined),false);
const app = createApp(store, adapter, async () => {
  const missingAssets = missingProductionFiles();
  return { demoReady: store.integrity() && missingAssets.length === 0, missingAssets, mode: policy.mode, address: policy.host, port, connectionUrl: policy.mode !== 'local' ? policy.origin + '/' : null, accessRequired: Boolean(policy.key), ...(await liveReadiness(adapter)), nodeVersion: process.version };
}, policy, telegram, control,jobs);
const server = serve({ fetch: app.fetch, hostname: policy.host, port }, () => {
  try{jobs.start();}catch{console.error('JOB_WORKER_BUSY: эта база уже используется другим backend; он сохранён.');process.exitCode=1;void stop();return;}
  console.log(`YAPLIX ${policy.origin ?? `http://127.0.0.1:${port}`}/ (${policy.mode})`);
  if (policy.mode === 'lan' && process.env.YAPLIX_PRINT_LAN_KEY === '1') {
    console.log(`Ключ доступа: ${policy.key}\nОткройте адрес на компьютере → Диагностика → Показать QR. Телефон должен быть в той же Wi-Fi сети. Ключ вводится отдельно. Firewall не изменён.`);
  }
});
server.on('error', (error: NodeJS.ErrnoException) => {
  adapter?.close?.(); void jobs.close().then(()=>store.close());
  console.error(`${portError(error)}: ${policy.host}:${port}. Проверьте адрес; для занятого порта выберите другой PORT/--port.`);
  process.exitCode = 1;
});
if ('requestTimeout' in server) server.requestTimeout = 15_000;
if ('headersTimeout' in server) server.headersTimeout = 10_000;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  adapter?.close?.();
  await jobs.close();
  const deadline = setTimeout(() => { if ('closeAllConnections' in server) server.closeAllConnections(); }, 5000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); store.close(); console.log('YAPLIX stopped; SQLite closed'); process.disconnect?.(); });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('disconnect', stop);
// Uses the same graceful path on Windows without a remote shutdown endpoint.
process.on('message', message => { if (message === 'shutdown') stop(); });
