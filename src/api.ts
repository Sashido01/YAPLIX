import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { Fault, object, parseArtifact, parseEvent, parseSpec, uuid, MAX_EVENT_BYTES } from './contracts.ts';
import { boundedText, requiredMethod } from './bgen.ts';
import type { Generator } from './bgen.ts';
import { demoArtifact } from './demo.ts';
import type { Store } from './store.ts';
import { PROJECT_ROOT } from './store.ts';
import { resolve } from 'node:path';

export function createApp(store: Store, adapter?: Generator, diagnostics: () => unknown | Promise<unknown> = () => ({ liveConfigured: Boolean(adapter) })) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // Loopback service, same-origin UI only. Reject opaque sandbox/browser cross-site writes.
    const requestUrl = new URL(c.req.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname) || c.req.header('Host') && c.req.header('Host')!.toLowerCase() !== requestUrl.host.toLowerCase()) throw new Fault('HOST_FORBIDDEN', 403);
    const origin = c.req.header('Origin');
    if (origin && origin !== requestUrl.origin || c.req.header('Sec-Fetch-Site') === 'cross-site') throw new Fault('ORIGIN_FORBIDDEN', 403);
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
  app.get('/api/health', c => c.json({ ok: store.integrity(), schemaVersion: 1 }));
  app.get('/api/diagnostics', async c => c.json({ ok: store.integrity(), schemaVersion: 1, ...(await diagnostics() as object) }));
  app.get('/api/games', c => c.json({ games: store.list() }));
  app.post('/api/backups', async c => { object(await json(c.req.raw, 32), []); return c.json(await store.backup(), 201); });
  function mode(value: unknown) { if (value !== undefined && value !== 'demo' && value !== 'live') throw new Fault('INVALID_MODE'); return value; }
  app.post('/api/games', async c => {
    const body = object(await json(c.req.raw), ['spec', 'artifact', 'requiredMethod', 'mode']);
    const selected = mode(body.mode);
    const method = requiredMethod(body.requiredMethod) ?? (selected === 'live' ? 'llm_code' : undefined);
    if (selected === 'demo' && (method || body.artifact !== undefined)) throw new Fault('DEMO_CONTRACT_CONFLICT');
    if (method && body.artifact !== undefined) throw new Fault('IMPORT_PROVENANCE_UNVERIFIED');
    const spec = parseSpec(body.spec);
    if (!body.artifact && selected !== 'demo' && !adapter) throw new Fault('BGEN_NOT_CONFIGURED', 503);
    const artifact = selected === 'demo' ? demoArtifact(spec) : body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec, undefined, method);
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
    if (!body.artifact && selected !== 'demo' && !adapter) throw new Fault('BGEN_NOT_CONFIGURED', 503);
    const artifact = selected === 'demo' ? demoArtifact(spec) : body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec, previous, method);
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
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return c.html(await readFile(resolve(PROJECT_ROOT, 'assets/index.html'), 'utf8'));
  });
  app.get('/ui/style.css', async c => c.body(await readFile(resolve(PROJECT_ROOT, 'assets/style.css'), 'utf8'), 200, { 'Content-Type': 'text/css; charset=utf-8' }));
  for (const file of ['runtime', 'contracts', 'ui']) app.get(`/runtime/${file}.js`, async c => {
    try { return c.body(await readFile(resolve(PROJECT_ROOT, `build/src/${file}.js`), 'utf8'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' }); }
    catch { throw new Fault('RUNTIME_BUILD_REQUIRED', 503); }
  });
  app.onError((error, c) => {
    const fault = error instanceof Fault ? error : new Fault('INTERNAL_ERROR', 500);
    // Never echo upstream responses, game errors, prompts, or environment secrets.
    return c.json({ error: fault.code }, fault.status as 400);
  });
  return app;
}
