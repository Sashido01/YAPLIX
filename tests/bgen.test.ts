import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BGenAdapter } from '../src/bgen.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { artifact, html, spec } from './helpers.ts';

async function mockServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }) };
}
for (const [provider, method] of [['engine+openai+json', 'template_config'], ['engine+default', 'fallback'], ['engine+mock+json', 'mock']] as const) {
  test(`legacy BGen ${provider} is honestly labeled ${method}`, async t => {
    const server = await mockServer((_req, res) => res.end(JSON.stringify({ html, ok: true, fromCache: false, provider })));
    t.after(server.close);
    const result = await new BGenAdapter({ url: server.url }).generate(spec);
    assert.equal(result.method, method); assert.equal(result.validationStatus, 'unverified'); assert.equal(result.model, null);
  });
}
test('proposed explicit provenance and iterate transport through platform API', async t => {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const server = await mockServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      requests.push({ path: req.url!, body: JSON.parse(body) });
      res.end(JSON.stringify({ html, ok: true, fromCache: false, provider: 'openai', provenance: { protocolVersion: 1, method: 'llm_code', provider: 'openai', model: 'test-model' } }));
    });
  }); t.after(server.close);
  const store = new Store(':memory:'); t.after(() => store.close());
  const app = createApp(store, new BGenAdapter({ url: server.url }));
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await (await post('/api/games', { spec })).json();
  const second = await post(`/api/games/${first.gameId}/versions`, { spec, previousVersionId: first.versionId });
  assert.equal(second.status, 201);
  assert.equal((await second.json()).method, 'llm_code');
  assert.deepEqual(requests.map(r => r.path), ['/api/generate', '/api/iterate']);
  assert.equal(requests[1].body.previousCode, html);
  assert.equal(requests[1].body.previousPrompt, spec.prompt);
  assert.equal(requests[0].body.audience, 'default');
});
for (const [name, response, code] of [
  ['cache', { html, ok: true, fromCache: true, provider: 'cache' }, 'BGEN_PROVENANCE_REQUIRED'],
  ['raw provider', { html, ok: true, fromCache: false, provider: 'openai' }, 'BGEN_PROVENANCE_REQUIRED'],
  ['manual', { html, ok: true, fromCache: false, provider: 'manual' }, 'BGEN_PROVENANCE_REQUIRED'],
  ['malformed', { html }, 'BGEN_INVALID_RESPONSE'],
  ['provenance conflict', { html, ok: true, fromCache: false, provider: 'engine+mock+json', provenance: { protocolVersion: 1, method: 'llm_code', provider: 'mock', model: null } }, 'BGEN_PROVENANCE_CONFLICT'],
  ['invalid html', { html: 'no game', ok: true, fromCache: false, provider: 'engine+default' }, 'BGEN_INVALID_ARTIFACT'],
  ['invalid provenance shape', { html, ok: true, fromCache: false, provider: 'openai', provenance: [] }, 'BGEN_INVALID_PROVENANCE'],
] as const) test(`reject ${name}`, async t => {
  const server = await mockServer((_req, res) => res.end(JSON.stringify(response))); t.after(server.close);
  await assert.rejects(new BGenAdapter({ url: server.url }).generate(spec), new RegExp(code));
});
for (const [status, code] of [[401, 'BGEN_AUTH'], [429, 'BGEN_RATE_LIMIT'], [500, 'BGEN_HTTP']] as const) test(`upstream ${status} is distinct`, async t => {
  const server = await mockServer((_req, res) => { res.writeHead(status); res.end('redacted upstream'); }); t.after(server.close);
  await assert.rejects(new BGenAdapter({ url: server.url }).generate(spec), new RegExp(code));
});
test('timeouts cover response bodies as well as headers', async t => {
  const server = await mockServer((_req, res) => { res.writeHead(200); res.write('{'); }); t.after(server.close);
  await assert.rejects(new BGenAdapter({ url: server.url, timeoutMs: 50 }).generate(spec), /BGEN_TIMEOUT/);
});
test('oversized Content-Length closes the upstream response instead of leaking a stalled socket', async t => {
  let closed!: () => void;
  const didClose = new Promise<void>(resolve => closed = resolve);
  const server = await mockServer((_req, res) => {
    res.on('close', closed); res.writeHead(200, { 'Content-Length': '9999999' }); res.write('{');
  }); t.after(server.close);
  await assert.rejects(new BGenAdapter({ url: server.url, timeoutMs: 50 }).generate(spec), /BODY_TOO_LARGE/);
  await Promise.race([didClose, new Promise<void>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('response not closed')), 500); timer.unref(); })]);
});
test('invalid JSON, streamed output overflow, redirects and network failures do not fall back', async t => {
  for (const scenario of ['json', 'size', 'redirect'] as const) {
    const server = await mockServer((_req, res) => {
      if (scenario === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' }); res.end(); }
      else res.end(scenario === 'json' ? 'bad' : 'x'.repeat(1_220_000));
    });
    try { await assert.rejects(new BGenAdapter({ url: server.url }).generate(spec), new RegExp(scenario === 'json' ? 'BGEN_INVALID_JSON' : scenario === 'size' ? 'BODY_TOO_LARGE' : 'BGEN_NETWORK')); }
    finally { await server.close(); }
  }
  await assert.rejects(new BGenAdapter({ url: 'http://127.0.0.1:1' }).generate(spec), /BGEN_NETWORK/);
  assert.throws(() => new BGenAdapter({ url: 'http://remote.example' }), /INSECURE_BGEN_URL/);
  assert.throws(() => new BGenAdapter({ url: 'https://example.test/?key=value' }), /INVALID_BGEN_URL/);
  assert.throws(() => new BGenAdapter({ url: 'http://localhost', timeoutMs: NaN }), /INVALID_TIMEOUT/);
  const store = new Store(':memory:'); t.after(() => store.close());
  const v = store.save(spec, artifact);
  await assert.rejects(new BGenAdapter({ url: 'http://localhost' }).generate({ ...spec, prompt: 'x'.repeat(490) }, v), /PROMPT_TOO_LARGE/);
});
