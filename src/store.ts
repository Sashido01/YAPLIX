import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fault, parseArtifact, parseEvent, parseSpec, uuid } from './contracts.ts';
import type { Artifact, GameEvent, GameSpec, GameVersion } from './contracts.ts';

const moduleParent = fileURLToPath(new URL('../', import.meta.url));
export const PROJECT_ROOT = existsSync(resolve(moduleParent, 'package.json')) ? moduleParent : resolve(moduleParent, '..');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type Session = { session_id: string; version_id: string; token_hash: string; expires_at: number; last_sequence: number; last_timestamp: number | null; started_at: number | null; ended_at: number | null; outcome: string | null; score: number | null };
type Metrics = { sessionCount: number; startedCount: number; completedCount: number; won: number; lost: number; meanDurationMs: number | null; meanScore: number | null };
const SCHEMA_V1 = [
  'CREATE TABLE games(game_id TEXT PRIMARY KEY, created_at TEXT NOT NULL) STRICT',
  'CREATE TABLE versions(version_id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(game_id), previous_version_id TEXT REFERENCES versions(version_id), html TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes<=200000), metadata TEXT NOT NULL, created_at TEXT NOT NULL) STRICT',
  'CREATE INDEX versions_game ON versions(game_id, created_at)',
  "CREATE TABLE sessions(session_id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(version_id), token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, last_sequence INTEGER NOT NULL DEFAULT -1, last_timestamp INTEGER, started_at INTEGER, ended_at INTEGER, outcome TEXT CHECK(outcome IN ('game_won','game_lost')), score REAL) STRICT",
  'CREATE INDEX sessions_version ON sessions(version_id)',
  'CREATE TABLE events(event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id), sequence INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(session_id,sequence)) STRICT',
];
export function validSchema(db: DatabaseSync): boolean {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) return false;
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const actual = db.prepare("SELECT sql FROM sqlite_schema WHERE substr(name,1,7) <> 'sqlite_' ORDER BY name").all().map(row => normalize(String(row.sql))).sort();
  const expected = SCHEMA_V1.map(normalize).sort();
  return actual.length === expected.length && actual.every((sql, i) => sql === expected[i]);
}
export function healthyDatabase(db: DatabaseSync): boolean {
  return validSchema(db) && db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok' && db.prepare('PRAGMA foreign_key_check').all().length === 0;
}
export function managedPath(path: string, createParents = true): string {
  const managed = resolve(PROJECT_ROOT, '.local');
  const target = resolve(PROJECT_ROOT, path);
  const rel = relative(managed, target);
  if (isAbsolute(rel) || rel.startsWith('..') || !rel) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
  // lstat catches dangling file links too; exists/realpath alone cannot do that.
  for (let part = target; relative(PROJECT_ROOT, part) !== ''; part = dirname(part)) {
    if (dirname(part) === part) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
    try { if (lstatSync(part).isSymbolicLink()) throw new Fault('DB_LINK_FORBIDDEN'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  // Verify the nearest existing parent before recursive mkdir can follow a junction.
  let parent = dirname(target);
  while (!existsSync(parent)) parent = dirname(parent);
  const nearest = relative(realpathSync(PROJECT_ROOT), realpathSync(parent));
  if (isAbsolute(nearest) || nearest.startsWith('..')) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
  if (createParents) mkdirSync(dirname(target), { recursive: true });
  if (existsSync(dirname(target))) {
    const actual = relative(realpathSync(PROJECT_ROOT), realpathSync(dirname(target)));
    if (isAbsolute(actual) || actual.startsWith('..')) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
  }
  // Existing DB symlinks may point outside even when the directory is safe.
  try { const r = relative(realpathSync(managed), realpathSync(target)); if (isAbsolute(r) || r.startsWith('..')) throw new Fault('DB_PATH_OUTSIDE_PROJECT'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return target;
}
export class Store {
  db: DatabaseSync;
  private backingUp = false;
  constructor(path = '.local/data/yaplix.sqlite') {
    if (path !== ':memory:') path = managedPath(path);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;');
      const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (version > 1) throw new Fault('SCHEMA_TOO_NEW', 500);
      if (version === 0) this.transaction(() => {
        this.db.exec(SCHEMA_V1.join(';\n') + '; PRAGMA user_version=1;');
      });
      if (!validSchema(this.db)) throw new Fault('SCHEMA_INVALID', 500);
    } catch (e) { this.db.close(); throw e; }
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
  integrity() { return healthyDatabase(this.db); }
  getVersion(id: string): GameVersion {
    const row = this.db.prepare('SELECT html,metadata FROM versions WHERE version_id=?').get(uuid(id));
    if (!row) throw new Fault('VERSION_NOT_FOUND', 404);
    return { ...JSON.parse(row.metadata as string), html: row.html } as GameVersion;
  }
  list() {
    return this.db.prepare("SELECT metadata,(SELECT json_extract(first.metadata,'$.spec.prompt') FROM versions first WHERE first.game_id=versions.game_id ORDER BY first.rowid LIMIT 1) title FROM versions WHERE rowid IN (SELECT MAX(rowid) FROM versions GROUP BY game_id) ORDER BY rowid DESC LIMIT 50").all().map(row => ({...JSON.parse(row.metadata as string),title:String(row.title)}));
  }
  async backup() {
    if (this.backingUp) throw new Fault('BACKUP_BUSY', 409);
    this.backingUp = true;
    try {
      const filename = `backup-${randomUUID()}.sqlite`;
      const target = managedPath(`.local/backups/${filename}`);
      if (readdirSync(dirname(target)).filter(name => /^backup-[0-9a-f-]+\.sqlite$/.test(name)).length >= 20) throw new Fault('BACKUP_QUOTA', 507);
      await backup(this.db, target);
      const copy = new DatabaseSync(target, { readOnly: true });
      try {
        if (!healthyDatabase(copy)) throw new Fault('BACKUP_INVALID', 500);
      } finally { copy.close(); }
      return { filename, sha256: createHash('sha256').update(readFileSync(target)).digest('hex'), schemaVersion: 1, verified: true };
    } finally { this.backingUp = false; }
  }
  history(id: string) {
    const gameId = uuid(id);
    if (!this.db.prepare('SELECT 1 FROM games WHERE game_id=?').get(gameId)) throw new Fault('GAME_NOT_FOUND', 404);
    // Metadata only: histories do not multiply the HTML response size.
    return this.db.prepare('SELECT metadata FROM versions WHERE game_id=? ORDER BY rowid').all(gameId).map(r => JSON.parse(r.metadata as string));
  }
  save(spec: GameSpec, artifact: Artifact, previousId?: string): GameVersion {
    spec = parseSpec(spec); artifact = parseArtifact(artifact);
    const previous = previousId ? this.getVersion(previousId) : null;
    const version: GameVersion = { ...artifact, spec, gameId: previous?.gameId ?? randomUUID(), versionId: randomUUID(), previousVersionId: previous?.versionId ?? null, sha256: hash(artifact.html), createdAt: new Date().toISOString() };
    this.transaction(() => {
      const count = this.db.prepare('SELECT COUNT(*) n,COALESCE(SUM(bytes),0) total FROM versions').get() as { n: number; total: number };
      if (count.n >= 10_000 || count.total + Buffer.byteLength(artifact.html) > 100_000_000) throw new Fault('ARTIFACT_QUOTA', 507);
      if (!previous) this.db.prepare('INSERT INTO games VALUES (?,?)').run(version.gameId, version.createdAt);
      const { html, ...metadata } = version;
      this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?)').run(version.versionId, version.gameId, version.previousVersionId, html, Buffer.byteLength(html), JSON.stringify(metadata), version.createdAt);
    });
    return version;
  }
  session(versionId: string) {
    versionId = this.getVersion(versionId).versionId;
    const sessionId = randomUUID(), token = randomBytes(32).toString('hex'), expiresAt = Date.now() + 3600_000;
    this.transaction(() => {
      if (Number(this.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n) >= 10_000) throw new Fault('SESSION_QUOTA', 507);
      this.db.prepare('INSERT INTO sessions(session_id,version_id,token_hash,expires_at) VALUES (?,?,?,?)').run(sessionId, versionId, hash(token), expiresAt);
    });
    return { sessionId, versionId, token, expiresAt, protocolVersion: 1 as const };
  }
  event(input: GameEvent, token: string): { duplicate: boolean } {
    const event = parseEvent(input);
    return this.transaction(() => {
      const s = this.db.prepare('SELECT * FROM sessions WHERE session_id=?').get(event.sessionId) as Session | undefined;
      if (!s || !timingSafeEqual(Buffer.from(s.token_hash), Buffer.from(hash(token)))) throw new Fault('SESSION_UNAUTHORIZED', 401);
      if (s.version_id !== event.versionId) throw new Fault('SESSION_VERSION_MISMATCH', 409);
      if (Date.now() > s.expires_at) throw new Fault('SESSION_EXPIRED', 401);
      const payload = JSON.stringify(event);
      const duplicate = this.db.prepare('SELECT payload FROM events WHERE event_id=?').get(event.eventId);
      if (duplicate) { if (duplicate.payload !== payload) throw new Fault('EVENT_ID_CONFLICT', 409); return { duplicate: true }; }
      if (s.ended_at !== null || event.sequence !== s.last_sequence + 1) throw new Fault('EVENT_ORDER', 409);
      if (Math.abs(event.timestamp - Date.now()) > 300_000 || s.last_timestamp !== null && event.timestamp < s.last_timestamp) throw new Fault('EVENT_TIME', 409);
      if (event.type === 'game_started' && s.started_at !== null || ['score_changed', 'game_won', 'game_lost', 'session_ended'].includes(event.type) && s.started_at === null || ['game_won', 'game_lost'].includes(event.type) && s.outcome !== null || event.type === 'score_changed' && s.outcome !== null || event.type === 'game_ready' && s.started_at !== null) throw new Fault('EVENT_STATE', 409);
      if (Number(this.db.prepare('SELECT COUNT(*) n FROM events').get()?.n) >= 100_000) throw new Fault('EVENT_QUOTA', 507);
      this.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(event.eventId, event.sessionId, event.sequence, payload);
      this.db.prepare('UPDATE sessions SET last_sequence=?,last_timestamp=?,started_at=?,ended_at=?,outcome=?,score=? WHERE session_id=?').run(event.sequence, event.timestamp, event.type === 'game_started' ? event.timestamp : s.started_at, event.type === 'session_ended' ? event.timestamp : s.ended_at, ['game_won', 'game_lost'].includes(event.type) ? event.type : s.outcome, event.type === 'score_changed' ? event.data.score! : s.score, event.sessionId);
      return { duplicate: false };
    });
  }
  analytics(versionId: string) {
    versionId = this.getVersion(versionId).versionId;
    const row = this.db.prepare(`SELECT COUNT(*) sessionCount,COUNT(started_at) startedCount,COUNT(ended_at) completedCount,
      COALESCE(SUM(outcome='game_won'),0) won,COALESCE(SUM(outcome='game_lost'),0) lost,
      AVG(CASE WHEN ended_at>=started_at THEN ended_at-started_at END) meanDurationMs,AVG(score) meanScore
      FROM sessions WHERE version_id=?`).get(versionId) as Metrics;
    return { versionId, ...row, winRate: row.startedCount ? row.won! / row.startedCount : null, trust: 'untrusted_client' as const };
  }
  compare(versionId: string, baselineId: string) {
    const v = this.getVersion(versionId), b = this.getVersion(baselineId);
    if (v.gameId !== b.gameId || v.versionId === b.versionId) throw new Fault('INVALID_COMPARISON');
    const current = this.analytics(versionId), baseline = this.analytics(baselineId);
    const evidence = Number(current.completedCount) >= 5 && Number(baseline.completedCount) >= 5 ? 'preliminary' : 'insufficient_data';
    return { current, baseline, evidence, minimumCompletedSessions: 5, winRateDelta: current.winRate !== null && baseline.winRate !== null ? current.winRate - baseline.winRate : null, meanDurationDeltaMs: current.meanDurationMs !== null && baseline.meanDurationMs !== null ? current.meanDurationMs - baseline.meanDurationMs : null, automaticCodeChanges: false, observations: evidence === 'insufficient_data' ? ['Collect at least five completed sessions per version.'] : ['Differences are descriptive; player populations and client telemetry are uncontrolled.'] };
  }
}
