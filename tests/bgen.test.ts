import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BGenAdapter } from '../src/bgen.ts';
import { Store, PROJECT_ROOT } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { artifact, html, spec } from './helpers.ts';

async function mockServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }) };
}
const capabilities = { protocolVersion: 1, revision: 'a'.repeat(40), codeGeneration: true, tlsVerification: true, previousCode: true };
const codeResponse = { html, ok: true, fromCache: false, provider: 'openai', provenance: { protocolVersion: 1, method: 'llm_code', provider: 'openai', model: 'synthetic-test-model' } };
test('malformed configuration never exposes URL credentials and adapter refuses global TLS bypass', async () => {
  const privateUrl = 'https://test-user:synthetic-secret@';
  assert.throws(() => new BGenAdapter({ url: privateUrl }), /^Error: INVALID_BGEN_URL$/);
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/live-generation.ts'], { cwd: PROJECT_ROOT, env: { ...process.env, BGEN_URL: privateUrl } }), error => {
    const failure = error as Error & { stderr: string; stdout: string };
    assert.equal(failure.stderr.trim(), 'INVALID_BGEN_URL'); assert.equal(failure.stdout, '');
    assert.equal(failure.stderr.includes('synthetic-secret'), false); return true;
  });
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const adapter = new BGenAdapter({ url: 'https://example.test' });
    await assert.rejects(adapter.generate(spec), /INSECURE_TLS_CONFIGURATION/);
    await assert.rejects(adapter.liveCapabilities(), /INSECURE_TLS_CONFIGURATION/);
  } finally { if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original; }
});
test('strict live mode preflights, persists code, exports bytes and confirms iteration source', async t => {
  const bodies: Record<string, unknown>[] = [];
  const server = await mockServer((req, res) => {
    if (req.url === '/api/capabilities') { res.end(JSON.stringify(capabilities)); return; }
    let text = ''; req.on('data', d => text += d); req.on('end', () => {
      const body = JSON.parse(text); bodies.push(body);
      res.end(JSON.stringify({ ...codeResponse, ...(body.previousCode ? { previousCodeSha256: body.previousCodeSha256 } : {}) }));
    });
  }); t.after(server.close);
  const store = new Store(':memory:'); t.after(() => store.close());
  const app = createApp(store, new BGenAdapter({ url: server.url }));
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const firstResponse = await post('/api/games', { spec, requiredMethod: 'llm_code' });
  assert.equal(firstResponse.status, 201); const first = await firstResponse.json();
  const secondResponse = await post(`/api/games/${first.gameId}/versions`, { spec, previousVersionId: first.versionId, requiredMethod: 'llm_code' });
  assert.equal(secondResponse.status, 201); const second = await secondResponse.json();
  assert.equal(second.previousVersionId, first.versionId); assert.equal(second.gameId, first.gameId);
  assert.equal(bodies[0].requiredMethod, 'llm_code'); assert.equal(bodies[1].previousCodeSha256, first.sha256);
  const exported = await app.request(`/api/versions/${first.versionId}/export`);
  assert.equal(await exported.text(), html); assert.equal(exported.headers.get('X-Content-SHA256'), first.sha256);
  assert.match(exported.headers.get('Content-Disposition')!, /attachment/);
  assert.match(exported.headers.get('Content-Security-Policy')!, /sandbox allow-scripts/);
  assert.equal(first.validationStatus, 'unverified'); assert.equal(store.integrity(), true);
});
for (const [name, preflight, status, code] of [
  ['missing contract', capabilities, 404, 'BGEN_LIVE_CONTRACT_REQUIRED'],
  ['TLS bypass', { ...capabilities, tlsVerification: false }, 200, 'BGEN_UNSAFE_CAPABILITIES'],
  ['templates only', { ...capabilities, codeGeneration: false }, 200, 'BGEN_UNSAFE_CAPABILITIES'],
  ['unknown revision', { ...capabilities, revision: null }, 200, 'BGEN_UNSAFE_CAPABILITIES'],
  ['audited unsafe revision', { ...capabilities, revision: '419c64968d487068a2fbed2e4bd99489cc734430' }, 200, 'BGEN_AUDITED_REVISION_UNSAFE'],
  ['malformed contract', [], 200, 'BGEN_UNSAFE_CAPABILITIES'],
] as const) test(`strict mode rejects ${name} before any generation POST`, async t => {
  let posts = 0;
  const server = await mockServer((req, res) => { if (req.method === 'POST') posts++; res.writeHead(status); res.end(JSON.stringify(preflight)); }); t.after(server.close);
  await assert.rejects(new BGenAdapter({ url: server.url }).generate(spec, undefined, 'llm_code'), new RegExp(code));
  assert.equal(posts, 0);
});
test('unsupported iteration is rejected before POST; capabilities bodies are bounded and timed', async t => {
  const store = new Store(':memory:'); t.after(() => store.close()); const first = store.save(spec, artifact);
  for (const [mode, code] of [['iterate', 'BGEN_ITERATION_UNSUPPORTED'], ['json', 'BGEN_CAPABILITIES_INVALID'], ['size', 'BODY_TOO_LARGE'], ['timeout', 'BGEN_TIMEOUT']] as const) {
    let posts = 0;
    const server = await mockServer((req, res) => {
      if (req.method === 'POST') posts++;
      if (mode === 'timeout') { res.writeHead(200); res.write('{'); return; }
      res.end(mode === 'json' ? 'bad' : mode === 'size' ? 'x'.repeat(5000) : JSON.stringify({ ...capabilities, previousCode: false }));
    });
    try { await assert.rejects(new BGenAdapter({ url: server.url, timeoutMs: 100 }).generate(spec, first, 'llm_code'), new RegExp(code)); assert.equal(posts, 0); }
    finally { await server.close(); }
  }
});
test('synthetic demo runner preserves exact exports/lineage and stops before POST when iteration unsupported', async () => {
  for (const previousCode of [false, true]) {
    let posts = 0;
    const server = await mockServer((req, res) => {
      if (req.url === '/api/capabilities') { res.end(JSON.stringify({ ...capabilities, previousCode })); return; }
      posts++; let body = ''; req.on('data', d => body += d); req.on('end', () => {
        const request = JSON.parse(body);
        res.end(JSON.stringify({ ...codeResponse, previousCodeSha256: request.previousCodeSha256 }));
      });
    });
    let stdout = '';
    try {
      try {
        ({ stdout } = await promisify(execFile)(process.execPath, ['scripts/live-generation.ts'], { cwd: PROJECT_ROOT, env: { ...process.env, BGEN_URL: server.url, BGEN_INIT_DATA: '', BGEN_TIMEOUT_MS: '1000' }, timeout: 10_000 }));
        assert.equal(previousCode, true);
      } catch (error) {
        if (previousCode) throw error;
        assert.equal((error as { code: number }).code, 1);
        stdout = (error as { stdout: string }).stdout;
      }
      const result = JSON.parse(stdout);
      assert.match(result.run, /^\.local\/live\/[0-9a-f-]{36}$/);
      const run = resolve(PROJECT_ROOT, result.run), managed = resolve(PROJECT_ROOT, '.local/live');
      const rel = relative(managed, run); assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..'));
      try {
        const evidence = JSON.parse(readFileSync(resolve(run, 'evidence.json'), 'utf8'));
        assert.equal(evidence.status, previousCode ? 'generated_unverified' : 'blocked');
        assert.equal(evidence.versions.length, previousCode ? 3 : 0); assert.equal(posts, previousCode ? 3 : 0);
        assert.equal(evidence.browserValidation, 'not_run'); assert.equal(evidence.telemetry, 'not_observed');
        const persisted = new Store(resolve(run, 'yaplix.sqlite'));
        try {
          if (previousCode) {
            const [first, other, second] = evidence.versions;
            assert.equal(second.previousVersionId, first.versionId); assert.equal(second.gameId, first.gameId); assert.notEqual(other.gameId, first.gameId);
            for (const v of evidence.versions) { assert.equal(persisted.getVersion(v.versionId).html, readFileSync(resolve(run, `${v.versionId}.html`), 'utf8')); assert.equal(persisted.analytics(v.versionId).startedCount, 0); }
          }
          assert.equal(persisted.integrity(), true);
        } finally { persisted.close(); }
      } finally { rmSync(run, { recursive: true }); }
    } finally { await server.close(); }
  }
});
for (const [name, response, code] of [
  ['template substitution', { ...codeResponse, provider: 'engine+openai+json', provenance: { ...codeResponse.provenance, method: 'template_config' } }, 'BGEN_CODE_REQUIRED'],
  ['failed generation', { ...codeResponse, ok: false }, 'BGEN_GENERATION_FAILED'],
  ['unknown model', { ...codeResponse, provenance: { ...codeResponse.provenance, model: null } }, 'BGEN_CODE_REQUIRED'],
  ['mock substitution', { ...codeResponse, provenance: { ...codeResponse.provenance, provider: 'mock' } }, 'BGEN_CODE_REQUIRED'],
] as const) test(`strict API rejects ${name} without saving a game`, async t => {
  const server = await mockServer((req, res) => res.end(JSON.stringify(req.url === '/api/capabilities' ? capabilities : response))); t.after(server.close);
  const store = new Store(':memory:'); t.after(() => store.close());
  const app = createApp(store, new BGenAdapter({ url: server.url }));
  const result = await app.request('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, requiredMethod: 'llm_code' }) });
  assert.equal(result.status, 502); assert.deepEqual(await result.json(), { error: code });
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get()?.n, 0);
});
test('strict iteration cannot silently ignore previous HTML; imports cannot bypass live policy', async t => {
  const server = await mockServer((req, res) => res.end(JSON.stringify(req.url === '/api/capabilities' ? capabilities : codeResponse))); t.after(server.close);
  const store = new Store(':memory:'); t.after(() => store.close()); const first = store.save(spec, artifact);
  await assert.rejects(new BGenAdapter({ url: server.url }).generate(spec, first, 'llm_code'), /BGEN_ITERATION_UNCONFIRMED/);
  const app = createApp(store);
  for (const [method, expected] of [['llm_code', 'IMPORT_PROVENANCE_UNVERIFIED'], ['template_config', 'INVALID_REQUIRED_METHOD']]) {
    const result = await app.request('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec, artifact, requiredMethod: method }) });
    assert.equal(result.status, 400); assert.deepEqual(await result.json(), { error: expected });
  }
  assert.equal(store.history(first.gameId).length, 1);
});
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


test('client abort and server close cancel BGen preflight/body and never save cancelled output', async t => {
  for (const stage of ['preflight', 'body', 'close'] as const) {
    let reached!: () => void;
    const started = new Promise<void>(done => reached = done);
    const server = await mockServer((req, res) => {
      if (req.url === '/api/capabilities' && stage !== 'preflight') { res.end(JSON.stringify(capabilities)); return; }
      res.writeHead(200); res.write('{'); reached();
    });
    try {
      const adapter = new BGenAdapter({ url: server.url }), controller = new AbortController();
      const pending = adapter.generate(spec, undefined, 'llm_code', controller.signal);
      const rejected = assert.rejects(pending, stage === 'close' ? /BGEN_TIMEOUT/ : /REQUEST_CANCELLED/);
      await started;
      if (stage === 'close') adapter.close(); else controller.abort();
      await rejected;
      // A subsequent operation on the same adapter must not inherit cancellation.
      const already = new AbortController(); already.abort();
      await assert.rejects(adapter.generate(spec, undefined, 'llm_code', already.signal), /REQUEST_CANCELLED/);
    } finally { await server.close(); }
  }
  const store = new Store(':memory:'); t.after(() => store.close());
  const liveController = new AbortController();
  const live = createApp(store, { async generate() { liveController.abort(); return {...artifact,method:'llm_code',provider:'synthetic-test',model:'test'}; } });
  const cancelled = await live.request('/api/games', { method:'POST', signal:liveController.signal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({spec,mode:'live'}) });
  assert.equal(cancelled.status,499);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM games').get()?.n, 0);
});
