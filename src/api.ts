import { Hono } from 'hono';
import { Fault, object, parseArtifact, parseEvent, parseSpec, uuid, MAX_EVENT_BYTES } from './contracts.ts';
import { boundedText, requiredMethod, providerMode } from './transport.ts';
import type { Generator } from './transport.ts';
import { GenerationFailure } from './live.ts';
import { demoArtifact } from './demo.ts';
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
import { PROJECT_ROOT } from './store.ts';
import type { RuntimeControl } from './runtime-control.ts';
import { RUNTIME_PROTOCOL } from './runtime-control.ts';
import { GenerationJobs } from './jobs.ts';
import {gallery,openGallery} from './gallery.ts';
import type { PhoneConnection } from './phone.ts';

const UI_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createApp(store: Store, adapter?: Generator, diagnostics: () => unknown | Promise<unknown> = () => ({ liveConfigured: Boolean(adapter) }), policy?: NetworkPolicy, telegram = new TelegramSessions(), control?: RuntimeControl, jobs?:GenerationJobs, phone?:PhoneConnection) {
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
      if (c.req.method === 'GET') return c.json({...control.identity(c.req.query('nonce') ?? ''),schemaVersion:2});
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
  function importedArtifact(value: unknown) {
    const artifact = parseArtifact(value);
    // This local import is for known fixtures. Client assertions cannot certify LLM
    // provenance or playability. Real generator output must pass the server adapter.
    if (artifact.method !== 'mock' || artifact.validationStatus !== 'unverified') throw new Fault('IMPORT_PROVENANCE_UNVERIFIED');
    return artifact;
  }
  app.get('/api/health', c => c.json({ ok: store.integrity(), schemaVersion: 2 }));
  app.get('/api/diagnostics', async c => c.json({ ok: store.integrity(), schemaVersion: 2, ...(await diagnostics() as object) }));
  const localPhone = () => {
    if (!phone || policy && policy.mode !== 'local') throw new Fault('PHONE_LOCAL_ONLY', 403);
    return phone;
  };
  app.get('/api/phone', async c => c.json({ ...(localPhone().status()), port: localPhone().port, networks: await localPhone().networks() }));
  app.post('/api/phone', async c => {
    const manager = localPhone(), body = object(await json(c.req.raw, 512), ['versionId','address']);
    if (body.address !== undefined && typeof body.address !== 'string') throw new Fault('HOST_NOT_AVAILABLE');
    return c.json(await manager.enable(uuid(body.versionId), body.address as string | undefined));
  });
  app.delete('/api/phone', async c => { object(await json(c.req.raw, 32), []); return c.json(await localPhone().disable()); });
  app.get('/api/phone/qr.svg', c => c.body(localPhone().qr(), 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }));
  const owner=(c:{req:{header(name:string):string|undefined}})=>principal(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session'));
  app.get('/api/jobs',c=>c.json({jobs:jobManager().list(owner(c))}));
  app.get('/api/jobs/:jobId/diagnostics',c=>{c.header('Content-Disposition','attachment; filename="yaplix-diagnostics.json"');return c.json(jobManager().report(owner(c),c.req.param('jobId')));});
  app.get('/api/jobs/:jobId/preview',c=>{const html=jobManager().preview(owner(c),c.req.param('jobId'));c.header('Content-Security-Policy',"sandbox allow-scripts; "+GAME_CSP);return c.html(html);});
  app.get('/api/jobs/:jobId',c=>c.json(jobManager().get(owner(c),c.req.param('jobId'))));
  app.post('/api/jobs',async c=>{
    const body=object(await json(c.req.raw,12000),['spec','mode','providerMode','previousVersionId','idempotencyKey','telegramConsent']);
    const consent=body.telegramConsent===true;if(body.telegramConsent!==undefined&&typeof body.telegramConsent!=='boolean')throw new Fault('INVALID_JOB_REQUEST');
    if(consent&&!telegram.user(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session')))throw new Fault('TELEGRAM_CONSENT_REQUIRES_SESSION',403);
    return c.json(jobManager().create(owner(c),body.idempotencyKey,{spec:parseSpec(body.spec),mode:mode(body.mode)??'live',providerMode:providerMode(body.providerMode),...(body.previousVersionId?{previousVersionId:uuid(body.previousVersionId)}:{}),telegramConsent:consent}),202);
  });
  app.post('/api/jobs/:jobId/cancel',async c=>{object(await json(c.req.raw,32),[]);return c.json(jobManager().cancel(owner(c),c.req.param('jobId')));});
  app.post('/api/jobs/:jobId/continue',async c=>{object(await json(c.req.raw,32),[]);return c.json(jobManager().continue(owner(c),c.req.param('jobId')));});
  app.post('/api/jobs/:jobId/notification',async c=>{object(await json(c.req.raw,32),[]);return c.json({claimed:jobManager().claim(owner(c),c.req.param('jobId'))});});
  app.get('/api/connection/qr.svg', async c => {
    if (!['lan','https'].includes(policy?.mode??'') || !policy?.origin) throw new Fault('LAN_QR_UNAVAILABLE', 409);
    const { connectionQr } = await import('./qr.ts');
    return c.body(connectionQr(policy.origin,policy.mode==='https'), 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
  });
  app.get('/api/games', c => c.json({ games: store.list() }));
  app.get('/api/gallery',c=>c.json({games:gallery}));
  app.post('/api/gallery/:id',async c=>{object(await json(c.req.raw,32),[]);return c.json(openGallery(store,c.req.param('id')),201);});
  app.post('/api/versions/:versionId/share',async c=>{object(await json(c.req.raw,32),[]);if(policy?.mode!=='https')throw new Fault('HTTPS_SHARE_REQUIRED',409);const version=store.getVersion(c.req.param('versionId'));return c.json({url:shareLink(policy.origin!,policy.key!,version.versionId),expiresIn:604800,scope:'read-only-artifact'});});
  app.get('/play/:versionId/:expires/:signature',c=>{
    if(policy?.mode!=='https'||!validShare(c.req.path,policy.key!))throw new Fault('SHARE_INVALID_OR_EXPIRED',403);
    const version=store.getVersion(c.req.param('versionId'));c.header('Content-Security-Policy','sandbox allow-scripts; '+GAME_CSP);c.header('Referrer-Policy','no-referrer');return c.body(version.html,200,{'Content-Type':'text/html; charset=utf-8'});
  });
  app.post('/api/backups', async c => { object(await json(c.req.raw, 32), []); return c.json(await store.backup(), 201); });
  function mode(value: unknown) { if (value !== undefined && value !== 'demo' && value !== 'live') throw new Fault('INVALID_MODE'); return value; }
  app.post('/api/games', async c => {
    const body = object(await json(c.req.raw), ['spec', 'artifact', 'requiredMethod', 'mode']);
    const selected = mode(body.mode);
    const method = requiredMethod(body.requiredMethod) ?? (selected === 'live' ? 'llm_code' : undefined);
    if (selected === 'demo' && (method || body.artifact !== undefined)) throw new Fault('DEMO_CONTRACT_CONFLICT');
    if (method && body.artifact !== undefined) throw new Fault('IMPORT_PROVENANCE_UNVERIFIED');
    const spec = parseSpec(body.spec);
    if (!body.artifact && selected !== 'demo' && !adapter) throw new Fault('LLM_NOT_CONFIGURED', 503);
    if(!body.artifact&&selected!=='demo'){limit.take('generation-global',12);limit.take('generation-'+principal(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session')),6);}
    const artifact = selected === 'demo' ? demoArtifact(spec) : body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec, undefined, method, c.req.raw.signal);
    if (c.req.raw.signal.aborted) throw new Fault('REQUEST_CANCELLED', 499);
    return c.json(store.save(spec, artifact), 201);
  });
  app.get('/api/games/:gameId', c => c.json({ gameId: uuid(c.req.param('gameId')), versions: store.history(c.req.param('gameId')) }));
  app.post('/api/games/:gameId/versions', async c => {
    const body = object(await json(c.req.raw), ['spec', 'previousVersionId', 'artifact', 'requiredMethod', 'mode']);
    const selected = mode(body.mode);
    const method = requiredMethod(body.requiredMethod) ?? (selected === 'live' ? 'llm_code' : undefined);
    if (selected === 'demo' && (method || body.artifact !== undefined)) throw new Fault('DEMO_CONTRACT_CONFLICT');
    if (method && body.artifact !== undefined) throw new Fault('IMPORT_PROVENANCE_UNVERIFIED');
    const previous = store.getVersion(uuid(body.previousVersionId));
    if (previous.gameId !== uuid(c.req.param('gameId'))) throw new Fault('PARENT_GAME_MISMATCH', 409);
    const spec = parseSpec(body.spec);
    if (!body.artifact && selected !== 'demo' && !adapter) throw new Fault('LLM_NOT_CONFIGURED', 503);
    if(!body.artifact&&selected!=='demo'){limit.take('generation-global',12);limit.take('generation-'+principal(c.req.header('Cookie'),c.req.header('X-Yaplix-Telegram-Session')),6);}
    const artifact = selected === 'demo' ? demoArtifact(spec) : body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec, previous, method, c.req.raw.signal);
    if (c.req.raw.signal.aborted) throw new Fault('REQUEST_CANCELLED', 499);
    return c.json(store.save(spec, artifact, previous.versionId), 201);
  });
  app.get('/api/versions/:versionId', c => c.json(store.getVersion(c.req.param('versionId'))));
  app.get('/api/versions/:versionId/export', c => {
    const version = store.getVersion(c.req.param('versionId'));
    c.header('Content-Disposition', `attachment; filename="yaplix-${version.versionId}.html"`);
    c.header('X-Content-SHA256', version.sha256);
    c.header('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; base-uri 'none'; form-action 'none'");
    return c.body(version.html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
  });
  app.post('/api/versions/:versionId/sessions', async c => {
    object(await json(c.req.raw, 32), []);
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
  for (const file of ['ui', 'access-ui', 'connection-ui','phone-connect-ui','telegram-ui']) app.get(`/runtime/${file}.js`, async c => {
    try { return await staticFile(c, `build/public/${file}.js`, 'text/javascript; charset=utf-8'); }
    catch { throw new Fault('RUNTIME_BUILD_REQUIRED', 503); }
  });
  for (const file of ['runtime', 'contracts']) app.get(`/runtime/${file}.js`, async c => {
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
