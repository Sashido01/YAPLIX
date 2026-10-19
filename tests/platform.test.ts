import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { parseArtifact, parseEvent, parseSpec, Fault } from '../src/contracts.ts';
import { acceptMessage } from '../src/runtime.ts';
import { artifact, event, spec } from './helpers.ts';

test('strict contracts reject bad values, unknown fields, multibyte overflow and oversized events', () => {
  assert.deepEqual(parseSpec(spec), spec);
  for (const value of [null, { ...spec, controls: [] }, { ...spec, webview: 1 }, { ...spec, prompt: 'x' }, { ...spec, secret: 'x' }]) assert.throws(() => parseSpec(value), Fault);
  assert.throws(() => parseArtifact({ ...artifact, method: 'llm' }), Fault);
  assert.throws(() => parseArtifact({ ...artifact, html: '<!DOCTYPE html><html>' + 'я'.repeat(100_000) + '</html>' }), Fault);
  const e = event({ sessionId: randomUUID(), versionId: randomUUID() }, 'score_changed', 0, Date.now(), { score: 1 });
  for (const bad of [{ ...e, protocolVersion: 2 }, { ...e, data: { score: Infinity } }, { ...e, data: { score: '1' } }, { ...e, type: 'game_error', data: { message: 'x'.repeat(5000) } }, { ...e, timestamp: -1 }, { ...e, eventId: 'bad' }]) assert.throws(() => parseEvent(bad), Fault);
});
test('migration, persistence, lineage, integrity and project containment', t => {
  const dir = mkdtempSync('.local/store-test-');
  t.after(() => rmSync(dir, { recursive: true }));
  let store = new Store(`${dir}/data.sqlite`);
  const first = store.save(spec, artifact);
  const second = store.save({ ...spec, prompt: 'Make it harder' }, artifact, first.versionId);
  assert.equal(first.sha256, createHash('sha256').update(artifact.html).digest('hex'));
  assert.equal(second.gameId, first.gameId);
  assert.equal(store.history(first.gameId).length, 2);
  assert.equal('html' in store.history(first.gameId)[0], false);
  assert.equal(store.integrity(), true);
  store.close();
  store = new Store(`${dir}/data.sqlite`);
  assert.deepEqual(store.getVersion(second.versionId), second);
  store.db.exec('PRAGMA user_version=3');
  store.close();
  assert.throws(() => new Store(`${dir}/data.sqlite`), /SCHEMA_TOO_NEW/);
  assert.throws(() => new Store('../escape.sqlite'), /DB_PATH_OUTSIDE_PROJECT/);
});
test('ordered sessions, idempotent retries, authentication, lifecycle and observed analytics', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const v = store.save(spec, artifact), s = store.session(v.versionId), now = Date.now();
  assert.equal(store.analytics(v.versionId).winRate, null);
  const ready = event(s, 'game_ready', 0, now);
  assert.throws(() => store.event(ready, 'wrong'), /UNAUTHORIZED/);
  assert.throws(() => store.event({ ...ready, versionId: randomUUID() }, s.token), /VERSION_MISMATCH/);
  assert.deepEqual(store.event(ready, s.token), { duplicate: false });
  assert.deepEqual(store.event(ready, s.token), { duplicate: true });
  assert.throws(() => store.event({ ...ready, timestamp: now + 1 }, s.token), /ID_CONFLICT/);
  assert.throws(() => store.event(event(s, 'game_won', 1, now), s.token), /EVENT_STATE/);
  store.event(event(s, 'game_started', 1, now), s.token);
  assert.throws(() => store.event(event(s, 'score_changed', 2, now - 1, { score: 9 }), s.token), /EVENT_TIME/);
  assert.throws(() => store.event(event(s, 'game_won', 3, now), s.token), /EVENT_ORDER/);
  store.event(event(s, 'score_changed', 2, now + 10, { score: 3 }), s.token);
  store.event(event(s, 'game_won', 3, now + 100), s.token);
  assert.throws(() => store.event(event(s, 'game_lost', 4, now + 100), s.token), /EVENT_STATE/);
  store.event(event(s, 'session_ended', 4, now + 200), s.token);
  assert.throws(() => store.event(event(s, 'game_error', 5, now + 200, { message: 'test' }), s.token), /EVENT_ORDER/);
  const stats = store.analytics(v.versionId);
  assert.deepEqual([stats.sessionCount, stats.startedCount, stats.completedCount, stats.won, stats.lost, stats.winRate, stats.meanDurationMs, stats.meanScore], [1, 1, 1, 1, 0, 1, 200, 3]);
  const expired = store.session(v.versionId);
  store.db.prepare('UPDATE sessions SET expires_at=0 WHERE session_id=?').run(expired.sessionId);
  assert.throws(() => store.event(event(expired, 'game_ready', 0), expired.token), /EXPIRED/);
  assert.equal(store.integrity(), true);
});
test('canonical UUIDs are shared by reads, session creation, analytics and comparison', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const v = store.save(spec, artifact), id = v.versionId.toUpperCase(), s = store.session(id);
  assert.equal(s.versionId, v.versionId);
  store.event(event(s, 'game_started', 0), s.token);
  assert.equal(store.analytics(id).startedCount, 1);
  assert.throws(() => store.compare(id, v.versionId), /INVALID_COMPARISON/);
});
test('DB directory junctions and dangling file links cannot redirect project writes', t => {
  const dir = mkdtempSync('.local/path-test-');
  t.after(() => rmSync(dir, { recursive: true }));
  const outsideManaged = resolve(dir, 'target'); mkdirSync(outsideManaged);
  const junction = resolve(dir, 'junction'); symlinkSync(outsideManaged, junction, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new Store(`${junction}/must-not-create/data.sqlite`), /DB_LINK_FORBIDDEN/);
  assert.equal(existsSync(resolve(outsideManaged, 'must-not-create')), false);
  unlinkSync(junction);
  if (process.platform !== 'win32') {
    const link = resolve(dir, 'dangling.sqlite'), target = resolve(dir, 'must-not-create.sqlite');
    symlinkSync(target, link);
    assert.throws(() => new Store(link), /DB_LINK_FORBIDDEN/);
    assert.equal(existsSync(target), false); unlinkSync(link);
  } else {
    const store = new Store(resolve(dir, 'case.sqlite').toLowerCase());
    assert.equal(store.integrity(), true); store.close();
    t.diagnostic('Dangling file symlink regression runs on Linux CI; Windows junction and case-variant absolute paths checked here.');
  }
});
test('deterministic evolution has an explicit sample boundary and same-game comparison', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const a = store.save(spec, artifact), b = store.save(spec, artifact, a.versionId);
  assert.equal(store.compare(b.versionId, a.versionId).evidence, 'insufficient_data');
  for (const v of [a, b]) for (let i = 0; i < 5; i++) {
    const s = store.session(v.versionId), now = Date.now();
    store.event(event(s, 'game_started', 0, now), s.token);
    store.event(event(s, v === a ? 'game_lost' : 'game_won', 1, now + 10), s.token);
    store.event(event(s, 'session_ended', 2, now + (v === a ? 100 : 200)), s.token);
  }
  const comparison = store.compare(b.versionId, a.versionId);
  assert.equal(comparison.evidence, 'preliminary');
  assert.equal(comparison.winRateDelta, 1);
  assert.equal(comparison.meanDurationDeltaMs, 100);
  assert.equal(comparison.automaticCodeChanges, false);
  assert.throws(() => store.compare(b.versionId, store.save(spec, artifact).versionId), /INVALID_COMPARISON/);
});
test('HTTP contracts: creation, versions, telemetry, readback, errors and hostile origins', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const app = createApp(store);
  const post = (path: string, body: unknown, headers = {}) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await app.request('/api/health')).status, 200);
  assert.equal((await post('/api/games', { spec })).status, 503);
  const created = await post('/api/games', { spec, artifact }); assert.equal(created.status, 201);
  assert.equal((await post('/api/games', { spec, artifact: { ...artifact, method: 'llm_code' } })).status, 400);
  assert.equal((await post('/api/games', { spec, artifact: { ...artifact, validationStatus: 'passed' } })).status, 400);
  const v = await created.json();
  assert.equal((await app.request(`/api/versions/${v.versionId}`)).headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await post(`/api/games/${v.gameId}/versions`, { spec, previousVersionId: v.versionId, artifact })).status, 201);
  assert.equal((await (await app.request(`/api/games/${v.gameId}`)).json()).versions.length, 2);
  const s = await (await post(`/api/versions/${v.versionId}/sessions`, {})).json();
  const e = event(s, 'game_started', 0);
  assert.equal((await post(`/api/sessions/${s.sessionId}/events`, e)).status, 401);
  assert.equal((await post(`/api/sessions/${s.sessionId}/events`, e, { Authorization: `Bearer ${s.token}` })).status, 200);
  assert.equal((await (await app.request(`/api/versions/${v.versionId}/analytics`)).json()).startedCount, 1);
  for (const origin of ['null', 'https://attacker.example']) assert.equal((await post('/api/games', { spec, artifact }, { Origin: origin })).status, 403);
  assert.equal((await app.request('http://attacker.example:3000/api/games', { method: 'POST', headers: { Origin: 'http://attacker.example:3000', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ spec, artifact }) })).status, 403);
  assert.equal((await post('/api/games', null)).status, 400);
  assert.equal((await app.request('/api/versions/bad')).status, 400);
  assert.equal((await app.request(`/api/versions/${randomUUID()}`)).status, 404);
  assert.equal((await app.request('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post('/api/games', { spec, artifact: { ...artifact, html: 'x'.repeat(1_300_000) } })).status, 413);
});
test('bridge rejects wrong window, origin, session, protocol, size and malformed messages', () => {
  const source = {} as Window, session = { sessionId: randomUUID(), versionId: randomUUID() };
  const payload = { channel: 'yaplix', event: event(session, 'game_ready', 0) };
  const message = { source, origin: 'null', data: payload } as MessageEvent;
  assert.deepEqual(acceptMessage(message, source, session), payload.event);
  for (const msg of [{ ...message, source: {} }, { ...message, origin: 'http://localhost' }, { ...message, data: null }, { ...message, data: { ...payload, event: { ...payload.event, sessionId: randomUUID() } } }, { ...message, data: { ...payload, event: { ...payload.event, protocolVersion: 2 } } }]) assert.equal(acceptMessage(msg as MessageEvent, source, session), null);
});

test('browser runtime ESM graph is served as JavaScript through the exact module allowlist', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const app = createApp(store), seen = new Set<string>();
  async function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /^text\/javascript/, path);
    const source = await response.text();
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('./'), `Unexpected browser import: ${match[1]}`);
      await visit(new URL(match[1], 'http://localhost' + path).pathname);
    }
  }
  await visit('/runtime/runtime.js');
  assert.deepEqual([...seen].sort(), ['/runtime/browser-profiles.js', '/runtime/contracts.js', '/runtime/runtime.js']);
  for (const path of ['/runtime/unknown.js', '/runtime/store.js', '/runtime/browser-profiles.ts',
    '/runtime/%2e%2e%2fsrc%2fstore.js', '/runtime/%2e%2e%5csrc%5cstore.js',
    '/runtime/../src/store.ts', '/runtime/%252e%252e%252fsrc%252fstore.ts']) {
    assert.equal((await app.request(path)).status, 404, path);
  }
});
