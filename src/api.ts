import { Hono } from 'hono';
import { Fault, object, parseEvent, parseSpec, uuid, MAX_EVENT_BYTES } from './contracts.ts';
import { boundedText, providerMode } from './transport.ts';
import type { Generator } from './transport.ts';
import { GenerationFailure,GenerationEngine } from './live.ts';
import {generationTimeouts} from './generation-timeouts.ts';
import type { Store } from './store.ts';
import { AccessSessions } from './access.ts';
import type { NetworkPolicy } from './access.ts';
import { staticAssets } from './static.ts';
import { TelegramSessions } from './telegram.ts';
import { RateLimit } from './rate-limit.ts';
import { shareLink, validShare } from './sharing.ts';
import { GAME_CSP } from './runtime.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROJECT_ROOT, SCHEMA_VERSION } from './store.ts';
import type { RuntimeControl } from './runtime-control.ts';
import { RUNTIME_PROTOCOL } from './runtime-control.ts';
import { GenerationJobs } from './jobs.ts';
import type { PhoneConnection } from './phone.ts';
import type {ChatGptSession} from './chatgpt.ts';
import type { ArenaConnection } from './arena.ts';
import {OperationTrace} from '../scripts/operation-trace.mjs';
import {MODEL_CATALOG} from './model-catalog.ts';

const UI_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function mode(value:unknown):'live'|undefined { if(value===undefined)return undefined; if(value==='live')return 'live'; throw new Fault('INVALID_MODE'); }

export function createApp(store: Store, adapter?: Generator, diagnostics: () => unknown | Promise<unknown> = () => ({ liveConfigured: Boolean(adapter) }), policy?: NetworkPolicy, telegram = new TelegramSessions(), control?: RuntimeControl, jobs?:GenerationJobs, phone?:PhoneConnection,chatgpt?:ChatGptSession,arena?:ArenaConnection) {
  const app = new Hono();
  if (policy && policy.mode !== 'local' && !policy.key) throw new Fault('ACCESS_KEY_REQUIRED');
  const staticFile = staticAssets();
  if (policy?.mode === 'https' && telegram.multipleOwners()) throw new Fault('TELEGRAM_SINGLE_OWNER_REQUIRED');
  // Legacy synchronous API users do not acquire a worker until they use jobs.
  // The production server supplies its coordinator and starts it after bind.
  const jobManager=()=>jobs??=new GenerationJobs(store,adapter);
  let access = policy?.key ? new AccessSessions(policy.key, policy.mode === 'https') : undefined;
  let accessKey = policy?.key;
  const limit=new RateLimit();
  const telegramCsp=UI_CSP.replace("script-src 'self' 'unsafe-inline'","script-src 'self' 'unsafe-inline' https://telegram.org").replace("frame-ancestors 'none'","frame-ancestors https://web.telegram.org https://*.web.telegram.org");
  const principal=(cookie?:string,header?:string)=>telegram.user(cookie,header)?.toString()??'owner';
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // Explicit network modes retain exact Host/origin and opaque-frame checks.
    const requestUrl = new URL(c.req.url);
    if (control && c.req.path === '/api/runtime/tunnel') {
      if (requestUrl.hostname !== '127.0.0.1' || requestUrl.port !== String(policy!.port) || c.req.header('Origin') || c.req.header('X-Forwarded-Proto') || c.req.header('X-Forwarded-For') || c.req.header('Sec-Fetch-Site')) throw new Fault('RUNTIME_CONTROL_FORBIDDEN', 403);
      if (c.req.method === 'GET') return c.json({...control.identity(c.req.query('nonce') ?? ''),schemaVersion:SCHEMA_VERSION});
      if (c.req.method !== 'POST' || !control.authorized(c.req.header('X-Yaplix-Control'))) throw new Fault('RUNTIME_CONTROL_FORBIDDEN', 403);
      return c.json(control.update(object(await json(c.req.raw, 512), ['action','lease','origin','key'])));
    }
    if (control && c.req.path === '/api/runtime/shutdown') {
      if (requestUrl.hostname !== '127.0.0.1' || requestUrl.port !== String(policy!.port) || c.req.header('Origin') || c.req.header('X-Forwarded-Proto') || c.req.header('X-Forwarded-For') || c.req.header('Sec-Fetch-Site')) throw new Fault('RUNTIME_CONTROL_FORBIDDEN', 403);
      if (c.req.method !== 'POST' || !control.authorized(c.req.header('X-Yaplix-Control'))) throw new Fault('RUNTIME_CONTROL_FORBIDDEN', 403);
      control.requestShutdown();
      return c.json({ shuttingDown: true }, 202);
    }
    if (policy?.mode === 'local' && (c.req.header('X-Forwarded-Proto') || c.req.header('X-Forwarded-For'))) throw new Fault('HOST_FORBIDDEN', 403);
    if (control && !control.active()) throw new Fault('TUNNEL_LEASE_EXPIRED', 503);
    if (accessKey !== policy?.key) { accessKey = policy?.key; access = accessKey ? new AccessSessions(accessKey, policy?.mode === 'https') : undefined; }
    const expected = policy?.origin ? new URL(policy.origin) : requestUrl;
    if (policy?.origin ? requestUrl.host !== expected.host : !['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) throw new Fault('HOST_FORBIDDEN', 403);
    if (c.req.header('Host') && c.req.header('Host')!.toLowerCase() !== expected.host.toLowerCase()) throw new Fault('HOST_FORBIDDEN', 403);
    if (policy?.mode === 'https') {
      if (c.req.header('X-Forwarded-Proto') !== 'https') throw new Fault('HTTPS_REQUIRED', 403);
      c.header('Strict-Transport-Security', 'max-age=31536000');
    }
    const origin = c.req.header('Origin');
    const publicNavigation=c.req.method==='GET'&&['/','/telegram'].includes(c.req.path)||c.req.method==='GET'&&c.req.path.startsWith('/play/');
    if (origin && origin !== expected.origin || c.req.header('Sec-Fetch-Site') === 'cross-site'&&!publicNavigation) throw new Fault('ORIGIN_FORBIDDEN', 403);
    if (c.req.path === '/healthz' && c.req.method === 'GET') return c.json({ app: 'YAPLIX', protocol: RUNTIME_PROTOCOL, instance: control?.instance ?? null, ready: store.integrity() }, store.integrity() ? 200 : 503);
    const shared=policy?.mode==='https'&&c.req.method==='GET'&&validShare(c.req.path,policy.key!);
    if (access) {
      if(c.req.path==='/api/telegram/auth'&&c.req.method==='POST'){
        if (!telegram.singleOwner()) throw new Fault('TELEGRAM_SINGLE_OWNER_REQUIRED', 403);
        if(policy?.mode!=='https')throw new Fault('TELEGRAM_HTTPS_REQUIRED',409);
        limit.take('telegram-login',30);
        const body=object(await json(c.req.raw,10000),['initData']);const session=telegram.login(body.initData);
        c.header('Set-Cookie',session.cookie);return c.json({ok:true,sessionToken:session.sessionToken});
      }
      if (c.req.path === '/api/access' && c.req.method === 'POST') {
        const body = object(await json(c.req.raw, 256), ['key']);
        c.header('Set-Cookie', access.login(body.key)); return c.json({ ok: true });
      }
      if (!shared&&!access.allowed(c.req.header('Cookie'))&&!(policy?.mode==='https'&&telegram.user(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session')))) {
        if (c.req.path === '/' && c.req.method === 'GET') { c.header('Content-Security-Policy', UI_CSP); return staticFile(c, 'assets/access.html', 'text/html; charset=utf-8', false); }
        if (!['/telegram','/ui/style.css', '/runtime/access-ui.js','/runtime/ui.js','/runtime/telegram-ui.js','/runtime/connection-ui.js'].includes(c.req.path)) throw new Fault('ACCESS_REQUIRED', 401);
      }
    }
    await next();
  });
  async function json(request: Request, max = 1_210_000): Promise<unknown> {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Fault('JSON_REQUIRED', 415);
    try { return JSON.parse(await boundedText(new Response(request.body, { headers: request.headers }), max)); }
    catch (e) { if (e instanceof Fault) throw e; throw new Fault('INVALID_JSON'); }
  }
  app.get('/api/health', c => c.json({ ok: store.integrity(), schemaVersion: SCHEMA_VERSION }));
  app.get('/api/providers', c => c.json({timeouts:adapter instanceof GenerationEngine?adapter.timeouts:generationTimeouts(),providers:(['ollama-cloud','openrouter','chatgpt'] as const).map(mode=>{
    let configured=false;try{configured=adapter instanceof GenerationEngine&&Boolean(adapter.routesFor(mode).length);}catch{/* Missing route is configuration, not a network failure. */}
    return{mode,configured,state:configured?'needs_verification':'not_configured'};
  })}));
  app.get('/api/providers/:mode/check',async c=>{
    const mode=c.req.param('mode'),entry=MODEL_CATALOG.find(item=>item.mode===mode);
    if(!entry)throw new Fault('INVALID_PROVIDER_MODE');
    let routes: ReturnType<GenerationEngine['routesFor']> | undefined;
    try{routes=adapter instanceof GenerationEngine?adapter.routesFor(entry.mode):undefined;}catch{}
    if(!routes?.length)return c.json({mode,model:entry.model,configured:false,ready:false,state:'not_configured',reasonCode:'PROVIDER_NOT_CONFIGURED'});
    const route=routes[0];
    let state='unreachable';
    try{state=await route.readiness(AbortSignal.timeout(3000));}catch{}
    // OpenRouter's supported ID is a dynamic free-router alias, not a
    // concrete catalog model. A successful catalog GET is sufficient here;
    // inference and its eventual free upstream remain unverified.
    if(entry.mode==='openrouter'&&state==='model_missing')state='dynamic_upstream_ready';
    const ready=state==='ready'||state==='dynamic_upstream_ready';
    return c.json({mode,model:entry.model,configured:true,ready,state,reasonCode:ready?null:state==='model_missing'?'MODEL_NOT_AVAILABLE':state==='auth_required'||state==='authentication_failed'?'AUTH_REQUIRED':'PROVIDER_UNREACHABLE'});
  });
  app.post('/api/model-events',async c=>{
    const body=object(await json(c.req.raw,1024),['traceId','event','mode','model','configured','readiness','reasonCode','durationMs','jobId']);
    const entry=MODEL_CATALOG.find(item=>item.mode===body.mode),events=['model.catalog_loaded','model.selection_restored','model.selection_changed','model.connection_checked','model.generation_blocked','model.job_created'];
    if(!entry||body.model!==entry.model||typeof body.event!=='string'||!events.includes(body.event))throw new Fault('INVALID_MODEL_EVENT');
    if(body.configured!==undefined&&typeof body.configured!=='boolean'||body.readiness!==undefined&&(!['NOT_CHECKED','ready','dynamic_upstream_ready','unreachable','model_missing','auth_required','not_configured'].includes(String(body.readiness)))||body.reasonCode!==undefined&&(!/^[A-Z][A-Z0-9_]{1,63}$/.test(String(body.reasonCode))||/KEY|TOKEN|SECRET|PASSWORD/i.test(String(body.reasonCode)))||body.durationMs!==undefined&&(!Number.isSafeInteger(body.durationMs)||Number(body.durationMs)<0||Number(body.durationMs)>120000))throw new Fault('INVALID_MODEL_EVENT');
    if(body.jobId!==undefined)uuid(body.jobId);
    const id=uuid(body.traceId),trace=new OperationTrace({dataRoot:process.env.YAPLIX_DATA_HOME??'.local',operationId:id});
    const event=body.event as string,status=event==='model.generation_blocked'||body.configured===false?'SKIPPED':event==='model.connection_checked'&&body.readiness!=='ready'?'FAIL':'PASS';
    const recorded=trace.record('model',event,status,{durationMs:body.durationMs as number|undefined,errorCode:body.reasonCode as string|undefined,jobId:body.jobId as string|undefined,details:{mode:entry.mode,model:entry.model,...(body.configured===undefined?{}:{configured:body.configured}),...(body.readiness===undefined?{}:{readiness:body.readiness}),...(body.reasonCode===undefined?{}:{reasonCode:body.reasonCode})}});
    return c.json({recorded});
  });
  app.get('/api/diagnostics', async c => c.json({ ok: store.integrity(), schemaVersion: SCHEMA_VERSION, ...(await diagnostics() as object) }));
  const chatgptOwner=(c:{req:{url:string;header(name:string):string|undefined}},sensitive=true)=>{
    const url=new URL(c.req.url);
    if(!chatgpt||policy?.mode!=='local'||policy.host!=='127.0.0.1'||url.hostname!=='127.0.0.1'||c.req.header('X-Yaplix-Telegram-Session')||telegram.user(c.req.header('Cookie')))throw new Fault('CHATGPT_LOCAL_ONLY',403);
    if(sensitive&&(c.req.header('Origin')!==url.origin||c.req.header('X-Yaplix-ChatGPT')!=='owner'))throw new Fault('ORIGIN_FORBIDDEN',403);
    return chatgpt;
  };
  app.get('/api/chatgpt/status',c=>{
    try{return c.json(chatgptOwner(c,false).status());}
    catch{return c.json({available:false,state:'DISCONNECTED',connected:false,model:'gpt-6.1-sol',reauthorizationRequired:false,error:'CHATGPT_LOCAL_ONLY'});}
  });
  app.post('/api/chatgpt/connect',async c=>{const manager=chatgptOwner(c);object(await json(c.req.raw,32),[]);return c.json(manager.connect(),202);});
  app.post('/api/chatgpt/disconnect',async c=>{const manager=chatgptOwner(c);object(await json(c.req.raw,32),[]);return c.json(manager.disconnect());});
  const localPhone = () => {
    if (!phone || policy && policy.mode !== 'local') throw new Fault('PHONE_LOCAL_ONLY', 403);
    return phone;
  };
  app.get('/api/phone', async c => c.json({ ...(localPhone().status()), networks: await localPhone().networks() }));
  app.post('/api/phone', async c => {
    const manager = localPhone(), body = object(await json(c.req.raw, 512), ['versionId','address']);
    if (body.address !== undefined && typeof body.address !== 'string') throw new Fault('HOST_NOT_AVAILABLE');
    return c.json(await manager.enable(uuid(body.versionId), body.address as string | undefined));
  });
  app.delete('/api/phone', async c => { object(await json(c.req.raw, 32), []); return c.json(await localPhone().disable()); });
  app.get('/api/phone/qr.svg', c => c.body(localPhone().qr(), 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }));
  const localArena = (c:{req:{url:string;header(name:string):string|undefined}}) => {
    if (!arena || policy && policy.mode!=='local' || c.req.header('X-Yaplix-Telegram-Session') || telegram.user(c.req.header('Cookie'))) throw new Fault('ARENA_LOCAL_ONLY',403);
    return arena;
  };
  app.get('/api/arena',async c=>{
    const manager=localArena(c), versionId=uuid(c.req.query('versionId'));
    return c.json({status:manager.status(),rooms:manager.records.rooms(versionId),networks:await manager.networks()});
  });
  app.post('/api/arena',async c=>{
    const manager=localArena(c),body=object(await json(c.req.raw,512),['versionId','address','roomId']);
    if(body.address!==undefined&&typeof body.address!=='string')throw new Fault('HOST_NOT_AVAILABLE');
    assertUserVersion(uuid(body.versionId));
    return c.json(await manager.enable(uuid(body.versionId),body.address as string|undefined,body.roomId===undefined?undefined:uuid(body.roomId)),201);
  });
  app.delete('/api/arena',async c=>{object(await json(c.req.raw,32),[]);return c.json(await localArena(c).disable());});
  app.get('/api/arena/qr.svg',c=>c.body(localArena(c).qr(),200,{'Content-Type':'image/svg+xml; charset=utf-8'}));
  app.get('/api/arena/rooms/:roomId',c=>c.json(localArena(c).records.board(uuid(c.req.param('roomId')))));
  const owner=(c:{req:{header(name:string):string|undefined}})=>principal(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session'));
  const assertUserVersion=(versionId:string)=>{if(store.isSystemAuthoredVersion(versionId))throw new Fault('VERSION_NOT_FOUND',404);return store.getVersion(versionId);};
  app.post('/api/versions/:versionId/ui-trace',async c=>{
    const body=object(await json(c.req.raw,4096),['event','width','height','screen','panel','gameArea','frameVisible','orientation','inputAction','errorCode','reasonCode','providerMode','providerConfigured','providerReadiness','selectedVersion','uiBusy','activeEdit','instructionReady','stack']);
    const allowed=['ui.game_opened','ui.viewport_changed','ui.panel_changed','ui.editor_state','ui.host_error','ui.api_error','ui.state_error','ui.game_runtime_error','ui.game_activity','ui.export_opened'] as const;
    if(typeof body.event!=='string'||!allowed.includes(body.event as typeof allowed[number]))throw new Fault('INVALID_UI_TRACE_EVENT');
    const dimension=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=4096;
    if(!dimension(body.width)||!dimension(body.height))throw new Fault('INVALID_UI_TRACE_VIEWPORT');
    if(body.screen!==undefined&&!['create','library','arena'].includes(String(body.screen)))throw new Fault('INVALID_UI_TRACE_SCREEN');
    if(body.panel!==undefined&&!['game-focus','workspace'].includes(String(body.panel)))throw new Fault('INVALID_UI_TRACE_PANEL');
    if(body.gameArea!==undefined&&(!Array.isArray(body.gameArea)||body.gameArea.length!==4||!body.gameArea.every(dimension)))throw new Fault('INVALID_UI_TRACE_AREA');
    if(body.frameVisible!==undefined&&typeof body.frameVisible!=='boolean')throw new Fault('INVALID_UI_TRACE_FRAME');
    if(body.orientation!==undefined&&!['portrait','landscape','square'].includes(String(body.orientation)))throw new Fault('INVALID_UI_TRACE_ORIENTATION');
    if(body.inputAction!==undefined&&!['game_ready','game_started','score_changed','game_won','game_lost','session_ended','game_error'].includes(String(body.inputAction)))throw new Fault('INVALID_UI_TRACE_INPUT');
    if(body.errorCode!==undefined&&!['HOST_UI_ERROR','UI_API_ERROR','UI_ACTION_ERROR','GAME_RUNTIME_ERROR'].includes(String(body.errorCode)))throw new Fault('INVALID_UI_TRACE_ERROR');
    if(body.reasonCode!==undefined&&(typeof body.reasonCode!=='string'||!/^[A-Z][A-Z0-9_]{1,63}$/.test(body.reasonCode)))throw new Fault('INVALID_UI_TRACE_REASON');
    if(body.event==='ui.editor_state'){
      if(!['NO_VERSION_SELECTED','UI_ACTION_IN_PROGRESS','EDIT_IN_PROGRESS','INSTRUCTION_REQUIRED','PROVIDER_NOT_CONFIGURED','READY_PROVIDER_UNVERIFIED','READY'].includes(String(body.reasonCode)))throw new Fault('INVALID_UI_TRACE_REASON');
      if(body.providerMode!==undefined&&!['ollama-cloud','openrouter','chatgpt'].includes(String(body.providerMode)))throw new Fault('INVALID_UI_TRACE_PROVIDER');
      if(body.providerConfigured!==null&&typeof body.providerConfigured!=='boolean')throw new Fault('INVALID_UI_TRACE_PROVIDER');
      if(body.providerReadiness!==undefined&&!['UNKNOWN','NOT_CONFIGURED','NOT_CHECKED'].includes(String(body.providerReadiness)))throw new Fault('INVALID_UI_TRACE_PROVIDER');
      for(const key of ['selectedVersion','uiBusy','activeEdit','instructionReady'] as const)if(typeof body[key]!=='boolean')throw new Fault('INVALID_UI_TRACE_STATE');
    }
    if(body.stack!==undefined&&(body.event!=='ui.host_error'||typeof body.stack!=='string'||body.stack.length>4096))throw new Fault('INVALID_UI_TRACE_STACK');
    const details:Record<string,unknown>={screen:body.screen,panel:body.panel,gameArea:body.gameArea,frameVisible:body.frameVisible,orientation:body.orientation,inputAction:body.inputAction,reasonCode:body.reasonCode,providerMode:body.providerMode,providerConfigured:body.providerConfigured,providerReadiness:body.providerReadiness,selectedVersion:body.selectedVersion,uiBusy:body.uiBusy,activeEdit:body.activeEdit,instructionReady:body.instructionReady,versionId:uuid(c.req.param('versionId')),stack:body.stack};
    const failed=body.event==='ui.host_error'||body.event==='ui.api_error'||body.event==='ui.state_error'||body.event==='ui.game_runtime_error';
    const status=failed?'FAIL':body.event==='ui.editor_state'&&!String(body.reasonCode).startsWith('READY')?'SKIPPED':'PASS';
    jobManager().traceVersion(owner(c),uuid(c.req.param('versionId')),body.event as typeof allowed[number],{status,errorCode:body.errorCode as string|undefined,viewport:`${body.width}x${body.height}`,profileWidth:Number(body.width),profileHeight:Number(body.height),details});
    return c.json({recorded:true});
  });
  app.get('/api/jobs',c=>c.json({jobs:jobManager().list(owner(c))}));
  app.get('/api/jobs/:jobId/diagnostics',c=>{c.header('Content-Disposition','attachment; filename="yaplix-diagnostics.json"');return c.json(jobManager().report(owner(c),c.req.param('jobId')));});
  app.get('/api/jobs/:jobId/preview',c=>{const html=jobManager().preview(owner(c),c.req.param('jobId'));c.header('Content-Security-Policy',"sandbox allow-scripts; "+GAME_CSP);return c.html(html);});
  app.get('/api/jobs/:jobId',c=>c.json(jobManager().get(owner(c),c.req.param('jobId'))));
  app.post('/api/jobs',async c=>{
    const body=object(await json(c.req.raw,12000),['spec','mode','providerMode','previousVersionId','idempotencyKey','telegramConsent']);
    const selectedMode=mode(body.mode);
    if(body.providerMode==='chatgpt')chatgptOwner(c);
    const consent=body.telegramConsent===true;if(body.telegramConsent!==undefined&&typeof body.telegramConsent!=='boolean')throw new Fault('INVALID_JOB_REQUEST');
    if(consent&&!telegram.user(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session')))throw new Fault('TELEGRAM_CONSENT_REQUIRES_SESSION',403);
    const previousVersionId=body.previousVersionId?uuid(body.previousVersionId):undefined;
    if(previousVersionId&&store.isSystemAuthoredVersion(previousVersionId))throw new Fault('VERSION_NOT_FOUND',404);
    return c.json(jobManager().create(owner(c),body.idempotencyKey,{spec:parseSpec(body.spec,previousVersionId?1200:500),mode:selectedMode??'live',providerMode:providerMode(body.providerMode),...(previousVersionId?{previousVersionId}:{}),telegramConsent:consent}),202);
  });
  app.post('/api/jobs/:jobId/cancel',async c=>{object(await json(c.req.raw,32),[]);return c.json(jobManager().cancel(owner(c),c.req.param('jobId')));});
  app.post('/api/jobs/:jobId/continue',async c=>{if(jobManager().get(owner(c),c.req.param('jobId')).providerMode==='chatgpt')chatgptOwner(c);object(await json(c.req.raw,32),[]);return c.json(jobManager().continue(owner(c),c.req.param('jobId')));});
  app.post('/api/jobs/:jobId/notification',async c=>{object(await json(c.req.raw,32),[]);return c.json({claimed:jobManager().claim(owner(c),c.req.param('jobId'))});});
  app.get('/api/connection/qr.svg', async c => {
    if (!['lan','https'].includes(policy?.mode??'') || !policy?.origin) throw new Fault('LAN_QR_UNAVAILABLE', 409);
    const { connectionQr } = await import('./qr.ts');
    return c.body(connectionQr(policy.origin,policy.mode==='https'), 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
  });
  app.get('/api/games', c => c.json({ games: store.list() }));
  app.post('/api/versions/:versionId/share',async c=>{object(await json(c.req.raw,32),[]);if(policy?.mode!=='https')throw new Fault('HTTPS_SHARE_REQUIRED',409);const version=store.getVersion(c.req.param('versionId'));return c.json({url:shareLink(policy.origin!,policy.key!,version.versionId),expiresIn:604800,scope:'read-only-artifact'});});
  app.get('/play/:versionId/:expires/:signature',c=>{
    if(policy?.mode!=='https'||!validShare(c.req.path,policy.key!))throw new Fault('SHARE_INVALID_OR_EXPIRED',403);
    const version=store.getVersion(c.req.param('versionId'));c.header('Content-Security-Policy','sandbox allow-scripts; '+GAME_CSP);c.header('Referrer-Policy','no-referrer');return c.body(version.html,200,{'Content-Type':'text/html; charset=utf-8'});
  });
  app.post('/api/backups', async c => { object(await json(c.req.raw, 32), []); return c.json(await store.backup(), 201); });
  app.get('/api/games/:gameId', c => {const gameId=uuid(c.req.param('gameId')),versions=store.history(gameId);if(versions.some(v=>store.isSystemAuthoredVersion(v.versionId)))throw new Fault('VERSION_NOT_FOUND',404);return c.json({gameId,versions});});
  app.get('/api/versions/:versionId', c => c.json(assertUserVersion(c.req.param('versionId'))));
  app.get('/api/versions/:versionId/export', c => {
    const versionId=c.req.param('versionId');jobManager().traceVersion(owner(c),versionId,'version.export.started',{status:'STARTED'});
    try{const version = assertUserVersion(versionId);
      c.header('Content-Disposition', `attachment; filename="yaplix-${version.versionId}.html"`);
      c.header('X-Content-SHA256', version.sha256);
      c.header('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; base-uri 'none'; form-action 'none'");
      jobManager().traceVersion(owner(c),versionId,'version.export.completed',{status:'PASS',outputBytes:Buffer.byteLength(version.html),details:{exportSha256:version.sha256,exportBytes:Buffer.byteLength(version.html)}});
      return c.body(version.html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }catch(error){jobManager().traceVersion(owner(c),versionId,'version.export.failed',{status:'FAIL',errorCode:error instanceof Fault?error.code:'EXPORT_FAILED'});throw error;}
  });
  app.post('/api/versions/:versionId/sessions', async c => {
    object(await json(c.req.raw, 32), []);
    assertUserVersion(c.req.param('versionId'));
    return c.json(store.session(c.req.param('versionId')), 201);
  });
  app.post('/api/sessions/:sessionId/events', async c => {
    const event = parseEvent(await json(c.req.raw, MAX_EVENT_BYTES));
    if (event.sessionId !== uuid(c.req.param('sessionId'))) throw new Fault('SESSION_ID_MISMATCH', 409);
    const token = c.req.header('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
    if (!token) throw new Fault('SESSION_UNAUTHORIZED', 401);
    return c.json(store.event(event, token));
  });
  app.get('/api/versions/:versionId/analytics', c => {
    const baseline = c.req.query('baselineVersionId');
    return c.json(baseline ? store.compare(c.req.param('versionId'), baseline) : store.analytics(c.req.param('versionId')));
  });
  // Same-origin UI. srcdoc inherits parent CSP, so inline game code/styles must be
  // permitted here; the stricter GAME_CSP inside the opaque frame removes network.
  app.get('/', async c => {
    c.header('Content-Security-Policy', UI_CSP);
    return staticFile(c, 'assets/index.html', 'text/html; charset=utf-8', false);
  });
  app.get('/telegram',async c=>{
    if(policy?.mode!=='https')throw new Fault('TELEGRAM_HTTPS_REQUIRED',409);
    c.header('Content-Security-Policy',telegramCsp);
    const html=await readFile(resolve(PROJECT_ROOT,'assets/index.html'),'utf8');
    return c.html(html.replace('</head>','<script src="https://telegram.org/js/telegram-web-app.js"></script></head>').replace('<body','<body data-entry="telegram"'));
  });
  app.get('/ui/style.css', c => staticFile(c, 'assets/style.css', 'text/css; charset=utf-8'));
  app.get('/arena',c=>{if(policy&&policy.mode!=='local')throw new Fault('ARENA_LOCAL_ONLY',403);c.header('Content-Security-Policy',UI_CSP);return staticFile(c,'assets/arena-host.html','text/html; charset=utf-8',false);});
  app.get('/arena/style.css',c=>staticFile(c,'assets/arena.css','text/css; charset=utf-8',false));
  for (const file of ['ui', 'access-ui', 'connection-ui','phone-connect-ui','telegram-ui','arena-host-ui']) app.get(`/runtime/${file}.js`, async c => {
    try { return await staticFile(c, `build/public/${file}.js`, 'text/javascript; charset=utf-8'); }
    catch { throw new Fault('RUNTIME_BUILD_REQUIRED', 503); }
  });
  for (const file of ['runtime', 'contracts', 'browser-profiles', 'generation-limits']) app.get(`/runtime/${file}.js`, async c => {
    try { return await staticFile(c, `build/src/${file}.js`, 'text/javascript; charset=utf-8'); }
    catch { throw new Fault('RUNTIME_BUILD_REQUIRED', 503); }
  });
  app.onError((error, c) => {
    const fault = error instanceof Fault ? error : new Fault('INTERNAL_ERROR', 500);
    // Never echo upstream responses, game errors, prompts, or environment secrets.
    return c.json({ error: fault.code, ...(fault instanceof GenerationFailure?{attempts:fault.attempts}:{}) }, fault.status as 400);
  });
  return app;
}
