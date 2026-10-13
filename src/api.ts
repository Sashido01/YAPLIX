import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { Fault, object, parseArtifact, parseEvent, parseSpec, uuid, MAX_EVENT_BYTES } from './contracts.ts';
import { boundedText } from './bgen.ts';
import type { BGenAdapter } from './bgen.ts';
import type { Store } from './store.ts';
import { PROJECT_ROOT } from './store.ts';
import { resolve } from 'node:path';

export function createApp(store: Store, adapter?: BGenAdapter) {
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
  app.post('/api/games', async c => {
    const body = object(await json(c.req.raw), ['spec', 'artifact']);
    const spec = parseSpec(body.spec);
    if (!body.artifact && !adapter) throw new Fault('BGEN_NOT_CONFIGURED', 503);
    const artifact = body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec);
    return c.json(store.save(spec, artifact), 201);
  });
  app.get('/api/games/:gameId', c => c.json({ gameId: uuid(c.req.param('gameId')), versions: store.history(c.req.param('gameId')) }));
  app.post('/api/games/:gameId/versions', async c => {
    const body = object(await json(c.req.raw), ['spec', 'previousVersionId', 'artifact']);
    const previous = store.getVersion(uuid(body.previousVersionId));
    if (previous.gameId !== uuid(c.req.param('gameId'))) throw new Fault('PARENT_GAME_MISMATCH', 409);
    const spec = parseSpec(body.spec);
    if (!body.artifact && !adapter) throw new Fault('BGEN_NOT_CONFIGURED', 503);
    const artifact = body.artifact !== undefined ? importedArtifact(body.artifact) : await adapter!.generate(spec, previous);
    return c.json(store.save(spec, artifact, previous.versionId), 201);
  });
  app.get('/api/versions/:versionId', c => c.json(store.getVersion(c.req.param('versionId'))));
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
  // Small browser integration library, no competing frontend. Build with npm run build.
  for (const file of ['runtime', 'contracts']) app.get(`/runtime/${file}.js`, async c => {
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
