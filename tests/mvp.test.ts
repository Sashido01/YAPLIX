import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, PROJECT_ROOT } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { LocalCodeAdapter, checkBGen } from '../src/live.ts';
import { spec, html } from './helpers.ts';
import type { GameSpec } from '../src/contracts.ts';

test('key-free DEMO persists/reopens, changes goal, lists latest version and produces verified backup', async t => {
  const dir = mkdtempSync('.local/mvp-test-');
  let store = new Store(`${dir}/data.sqlite`), app = createApp(store);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/api/games', { mode: 'demo', spec }); assert.equal(response.status, 201); const first = await response.json();
  assert.equal(first.method, 'mock'); assert.equal(first.model, null); assert.match(first.html, /goal=3/);
  const second = await (await post(`/api/games/${first.gameId}/versions`, { mode: 'demo', spec: { ...spec, prompt: 'Collect 5 cargo' }, previousVersionId: first.versionId })).json();
  assert.equal(second.previousVersionId, first.versionId); assert.match(second.html, /goal=5/); assert.notEqual(second.sha256, first.sha256);
  assert.equal((await (await app.request('/api/games')).json()).games[0].versionId, second.versionId);
  const copy = await store.backup(); const path = resolve(PROJECT_ROOT, '.local/backups', copy.filename);
  t.after(() => rmSync(path));
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), copy.sha256);
  const verified = spawnSync(process.execPath, ['scripts/maintenance.ts', 'verify-backup', path, copy.sha256], { cwd: PROJECT_ROOT });
  assert.equal(verified.status, 0);
  const wrongHash = spawnSync(process.execPath, ['scripts/maintenance.ts', 'verify-backup', path, '0'.repeat(64)], { cwd: PROJECT_ROOT });
  assert.equal(wrongHash.status, 1); assert.match(wrongHash.stderr.toString(), /BACKUP_HASH_MISMATCH/);
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), copy.sha256);
  const backupStore = new Store(path); assert.deepEqual(backupStore.getVersion(second.versionId), second); backupStore.close();
  store.close(); store = new Store(`${dir}/data.sqlite`); app = createApp(store);
  assert.equal((await (await app.request(`/api/versions/${second.versionId}`)).json()).sha256, second.sha256);
  assert.equal(store.analytics(second.versionId).sessionCount, 0);
  const bad = await post('/api/games', { mode: 'demo', requiredMethod: 'llm_code', spec }); assert.equal(bad.status, 400);
  const missingLive = await post('/api/games', { mode: 'live', spec }); assert.equal(missingLive.status, 503); assert.equal(store.list().length, 1);
});

test('production server serves UI, restarts with persisted games and retains exact export', { timeout: 15_000 }, async () => {
  const directory = mkdtempSync('.local/restart-test-');
  const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
  const port = (listener.address() as any).port; await new Promise<void>(done => listener.close(() => done()));
  const url = `http://127.0.0.1:${port}`;
  let processHandle: ReturnType<typeof spawn> | undefined, closed: Promise<void>;
  async function start() {
    processHandle = spawn(process.execPath, ['src/server.ts'], { cwd: PROJECT_ROOT, env: { ...process.env, PORT: String(port), YAPLIX_DB: `${directory}/data.sqlite`, LIVE_PROVIDER: 'none' }, stdio: ['ignore', 'pipe', 'ignore'] });
    closed = new Promise<void>(done => processHandle!.once('close', () => done()));
    await new Promise<void>((done, fail) => { processHandle!.stdout!.once('data', () => done()); processHandle!.once('error', fail); processHandle!.once('exit', () => fail(new Error('SERVER_START_FAILED'))); });
  }
  async function stop() { processHandle?.kill('SIGTERM'); await closed; processHandle = undefined; }
  try {
    await start();
    assert.equal((await fetch(`${url}/`)).status, 200);
    assert.equal((await fetch(`${url}/runtime/ui.js`)).status, 200);
    const version = await (await fetch(`${url}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'demo', spec }) })).json();
    await stop(); await start();
    assert.equal((await (await fetch(`${url}/api/versions/${version.versionId}`)).json()).sha256, version.sha256);
    assert.equal((await (await fetch(`${url}/api/games`)).json()).games[0].versionId, version.versionId);
    const exported = await (await fetch(`${url}/api/versions/${version.versionId}/export`)).text();
    assert.equal(createHash('sha256').update(exported).digest('hex'), version.sha256);
    assert.equal((await (await fetch(`${url}/api/diagnostics`)).json()).ok, true);
  } finally { if (processHandle) await stop(); rmSync(directory, { recursive: true }); }
});

test('backup verification and startup reject an unrelated or altered schema even with version 1', () => {
  const directory = mkdtempSync('.local/schema-test-'), path = resolve(directory, 'unrelated.sqlite');
  try {
    const db = new DatabaseSync(path); db.exec('PRAGMA user_version=1'); db.close();
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    const result = spawnSync(process.execPath, ['scripts/maintenance.ts', 'verify-backup', path, sha256], { cwd: PROJECT_ROOT });
    assert.equal(result.status, 1); assert.match(result.stderr.toString(), /BACKUP_INVALID/);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), sha256);
    assert.throws(() => new Store(path), /SCHEMA_INVALID/);
    const store = new Store(':memory:');
    try {
      store.db.exec('CREATE TRIGGER sqlitex AFTER INSERT ON games BEGIN DELETE FROM games WHERE game_id=NEW.game_id; END');
      assert.equal(store.integrity(), false);
      store.db.exec('DROP TRIGGER sqlitex'); assert.equal(store.integrity(), true);
      store.db.exec('DROP INDEX versions_game'); assert.equal(store.integrity(), false);
    }
    finally { store.close(); }
  } finally { rmSync(directory, { recursive: true }); }
});

test('BGen compiler and explicit Ollama transport generate code with previous HTML and no template fallback (synthetic LLM)', async t => {
  checkBGen(); const bodies: any[] = [];
  const server = createServer((req, res) => { let text = ''; req.on('data', chunk => text += chunk); req.on('end', () => { bodies.push(JSON.parse(text)); res.end(JSON.stringify({ done: true, done_reason: 'stop', model: 'test-model', message: { content: html } })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const store = new Store(':memory:'); t.after(() => store.close());
  const adapter = new LocalCodeAdapter({ url: `http://127.0.0.1:${(server.address() as any).port}`, model: 'test-model' });
  const requested: GameSpec = { ...spec, genre: 'puzzle', mechanics: ['matching'], controls: ['touch'], webview: false };
  const first = store.save(requested, await adapter.generate(requested)); const second = store.save(spec, await adapter.generate(spec, first));
  assert.equal(first.method, 'llm_code'); assert.equal(second.model, 'test-model'); assert.equal(second.validationStatus, 'unverified');
  assert.equal(bodies[0].stream, false); assert.ok(bodies[1].messages[1].content.includes(first.html));
  assert.ok(bodies[1].messages[1].content.includes(first.spec.prompt));
  assert.ok(bodies[0].messages[0].content.includes('yaplix_init'));
  assert.ok(bodies[0].messages[1].content.includes(JSON.stringify(requested)));
});

for (const [name, response, expected] of [
  ['truncated', { done: true, done_reason: 'length', model: 'test-model', message: { content: html } }, 'LLM_INVALID_RESPONSE'],
  ['wrong model', { done: true, model: 'other-model', message: { content: html } }, 'LLM_INVALID_RESPONSE'],
  ['external script', { done: true, model: 'test-model', message: { content: html.replace('</html>', '<script src="https://example.test/code.js"></script></html>') } }, 'LLM_UNSAFE_ARTIFACT'],
  ['network game', { done: true, model: 'test-model', message: { content: html.replace('</html>', '<script>fetch("https://example.test")</script></html>') } }, 'LLM_UNSAFE_ARTIFACT'],
] as const) test(`Ollama rejects ${name} without fallback (synthetic LLM)`, async t => {
  const server = createServer((_req, res) => res.end(JSON.stringify(response)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  await assert.rejects(new LocalCodeAdapter({ url: `http://127.0.0.1:${(server.address() as any).port}`, model: 'test-model' }).generate(spec), new RegExp(expected));
});
