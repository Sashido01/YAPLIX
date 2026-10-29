import { serve } from '@hono/node-server';
import { createApp } from './api.ts';
import {ChatGptSession,ChatGptTransport} from './chatgpt.ts';
import { configuredGenerator } from './live.ts';
import {boundedText} from './transport.ts';
import {generationTimeouts} from './generation-timeouts.ts';
import { Store } from './store.ts';
import { networkPolicy } from './access.ts';
import { checkHost, checkPort, portError } from './network.ts';
import { liveReadiness, missingProductionFiles } from './diagnostics.ts';
import { RuntimeControl, runtimeKey } from './runtime-control.ts';
import { TelegramSessions } from './telegram.ts';
import { GenerationJobs } from './jobs.ts';
import { TelegramBot } from './telegram-bot.ts';
import { PhoneConnection } from './phone.ts';
import { ArenaConnection } from './arena.ts';
import {LanSetup,type LanProbe} from './lan-setup.ts';
import { OperationTrace, operationId } from '../scripts/operation-trace.mjs';
import { checkerReady } from './browser-check.ts';

const operation = new OperationTrace({ dataRoot: process.env.YAPLIX_DATA_HOME ?? '.local', operationId: operationId() });
process.env.YAPLIX_OPERATION_ID=operation.id;
const startup = operation.begin('startup','operation.started',{nodeVersion:process.version,platform:process.platform,architecture:process.arch});
operation.record('startup','startup.runtime','PASS',{details:{nodeVersion:process.version,platform:process.platform,architecture:process.arch,dataHomeConfigured:Boolean(process.env.YAPLIX_DATA_HOME)}});
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') { startup('FAIL','TLS_DISABLED'); operation.record('startup','startup.failed','FAIL',{errorCode:'TLS_DISABLED'}); throw new Error('TLS verification must be enabled'); }
let policy:ReturnType<typeof networkPolicy>;
try{policy=networkPolicy();checkHost(policy);await checkPort(policy);operation.record('startup','startup.config_checked','PASS',{details:{platform:process.platform}});}
catch(error){const code=error instanceof Error&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.code)?error.code:'STARTUP_CONFIGURATION_FAILED';startup('FAIL',code);operation.record('startup','startup.failed','FAIL',{errorCode:code});console.error(code);process.exit(1);}
const { port } = policy;
const missingAssetsAtStartup=missingProductionFiles();
if (missingAssetsAtStartup.length) { startup('FAIL','RUNTIME_BUILD_REQUIRED');operation.record('startup','startup.failed','FAIL',{errorCode:'RUNTIME_BUILD_REQUIRED',details:{missingAssetCount:missingAssetsAtStartup.length}});console.error('RUNTIME_BUILD_REQUIRED: npm run build'); process.exit(1); }
let store: Store;
try { store = new Store(process.env.YAPLIX_DB); operation.record('startup','startup.database_opened','PASS'); }
catch { startup('FAIL','DATABASE_OPEN_FAILED'); operation.record('startup','startup.failed','FAIL',{errorCode:'DATABASE_OPEN_FAILED'}); throw new Error('DATABASE_OPEN_FAILED'); }
const phone = new PhoneConnection(store);
const arena = new ArenaConnection(store);
const lan=new LanSetup({probe:async()=>Promise.all(([['phone',phone.status()],['arena',arena.status()]] as const).map(async([kind,state])=>{
  const result:LanProbe={kind,state:'NOT_STARTED'};
  if(!state.enabled||!('url' in state)||!state.url)return result;
  const url=new URL(state.url);url.hash='';result.address=url.hostname;result.port=Number(url.port);
  try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(3000)});result.state=response.ok&&(await boundedText(response,32000)).includes(kind+'-ui.js')?'SELF_GET_PASS':'SELF_GET_FAILED';}catch{result.state='SELF_GET_FAILED';}
  return result;
}))});
const chatgpt=new ChatGptSession(policy);
const adapter = configuredGenerator(process.env,new ChatGptTransport(chatgpt));
const telegram = new TelegramSessions();
const control = new RuntimeControl(policy, runtimeKey(), () => telegram.singleOwner());
control.onShutdown = () => stop();
const jobs=new GenerationJobs(store,adapter,(owner,gameId,versionId)=>telegram.notifyReady(owner,gameId,versionId,policy.mode==='https'?policy.origin:undefined),false,{maxCalls:Number(process.env.LLM_MAX_ATTEMPTS??4),durationMs:generationTimeouts(process.env).jobMs,retryMs:Number(process.env.LLM_RETRY_MS??2000),automaticRetries:process.env.YAPLIX_DISABLE_AUTOMATIC_RETRIES!=='1'});
const bot=telegram.singleOwner()&&process.env.TELEGRAM_UPDATES!=='off'?new TelegramBot(store,jobs,process.env,{publicEndpoint:()=>control.active()&&policy.mode==='https'&&policy.origin&&policy.origin!=='https://pending.invalid'?{origin:policy.origin,instance:control.instance}:undefined}):undefined;
let botStartup:Promise<void>|undefined;
const app = createApp(store, adapter, async () => {
  const missingAssets = missingProductionFiles();
  const live = await liveReadiness(adapter);
  const healthy=store.integrity(); operation.record('startup','startup.database_integrity',healthy?'PASS':'FAIL',{errorCode:healthy?null:'DATABASE_INTEGRITY'});
  return { appReady: healthy && missingAssets.length === 0, missingAssets, mode: policy.mode, address: policy.host, port, connectionUrl: policy.mode !== 'local' ? policy.origin + '/' : null, accessRequired: Boolean(policy.key), ...live, lastSavedGeneration: store.lastSavedGeneration(live.provider), nodeVersion: process.version };
}, policy, telegram, control,jobs,phone,chatgpt,arena,lan);
const server = serve({ fetch: app.fetch, hostname: policy.host, port }, () => {
  try{jobs.start();}catch{startup('FAIL','JOB_WORKER_BUSY');operation.record('startup','startup.failed','FAIL',{errorCode:'JOB_WORKER_BUSY'});console.error('JOB_WORKER_BUSY: эта база уже используется другим backend; он сохранён.');process.exitCode=1;void stop();return;}
  console.log(`YAPLIX ${policy.origin ?? `http://127.0.0.1:${port}`}/ (${policy.mode})`);
  operation.record('startup','startup.api_ready','PASS'); operation.record('startup','startup.ui_ready','PASS');
  let browserReady=false; try{browserReady=checkerReady();}catch{/* Readiness is diagnostic only. */}
  operation.record('startup','startup.browser_checker','PASS',{details:{browserReady}});
  startup('PASS'); operation.record('startup','startup.completed','PASS');
  botStartup=bot?.startWithRetry().catch(error=>console.error(error instanceof Error&&'code' in error?String(error.code):'TELEGRAM_API_UNAVAILABLE'));
  if (policy.mode === 'lan' && process.env.YAPLIX_PRINT_LAN_KEY === '1') {
    console.log(`Ключ доступа: ${policy.key}\nОткройте адрес на компьютере → Диагностика → Показать QR. Телефон должен быть в той же Wi-Fi сети. Ключ вводится отдельно. Firewall не изменён.`);
  }
});
server.on('error', (error: NodeJS.ErrnoException) => {
  startup('FAIL',portError(error)); operation.record('startup','startup.failed','FAIL',{errorCode:portError(error)});
  lan.closeDiagnostics();chatgpt.disconnect();adapter?.close?.(); void jobs.close().then(()=>store.close());
  console.error(`${portError(error)}: ${policy.host}:${port}. Проверьте адрес; для занятого порта выберите другой PORT/--port.`);
  process.exitCode = 1;
});
if ('requestTimeout' in server) server.requestTimeout = 15_000;
if ('headersTimeout' in server) server.headersTimeout = 10_000;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  operation.record('startup','startup.stopped','PASS');
  await phone.shutdown();
  await arena.shutdown();
  lan.closeDiagnostics();chatgpt.disconnect();adapter?.close?.();
  await jobs.close();
  await bot?.close();await botStartup;
  const deadline = setTimeout(() => { if ('closeAllConnections' in server) server.closeAllConnections(); }, 5000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); store.close(); console.log('YAPLIX stopped; SQLite closed'); process.disconnect?.(); });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  // Hard timeout fallback: ensure process exits even if something holds the event loop.
  setTimeout(() => { process.exit(0); }, 12000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('disconnect', stop);
// Uses the same graceful path on Windows without a remote shutdown endpoint.
process.on('message', message => { if (message === 'shutdown') stop(); });
