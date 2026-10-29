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
import { spec, artifact } from './helpers.ts';
import type { GameSpec } from '../src/contracts.ts';

test('user versions persist and export; production has no DEMO or synchronous write API', async t => {
  const dir = mkdtempSync('.local/mvp-test-');
  let store = new Store(`${dir}/data.sqlite`), app = createApp(store);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const version=store.save(spec,artifact);
  assert.equal((await(await app.request('/api/games')).json()).games[0].versionId,version.versionId);
  assert.equal((await app.request('/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',spec})})).status,404);
  assert.equal((await app.request('/api/games/'+version.gameId+'/versions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',spec})})).status,404);
  assert.equal((await app.request('/api/gallery')).status,404);
  const demoJob=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo'})});assert.equal(demoJob.status,400);assert.equal((await demoJob.json()).error,'INVALID_MODE');
  const copy = await store.backup(); const path = resolve(PROJECT_ROOT, '.local/backups', copy.filename);
  t.after(() => rmSync(path));
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), copy.sha256);
  const verified = spawnSync(process.execPath, ['scripts/maintenance.ts', 'verify-backup', path, copy.sha256], { cwd: PROJECT_ROOT });assert.equal(verified.status, 0);
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), copy.sha256);
  const backupStore = new Store(path); assert.deepEqual(backupStore.getVersion(version.versionId), version); backupStore.close();
  store.close(); store = new Store(`${dir}/data.sqlite`); app = createApp(store);
  assert.equal((await (await app.request(`/api/versions/${version.versionId}`)).json()).sha256, version.sha256);
  assert.equal(store.analytics(version.versionId).sessionCount, 0);
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
    const setup=new Store(`${directory}/data.sqlite`);const version=setup.save(spec,artifact);setup.close();
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
