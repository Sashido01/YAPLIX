import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fault, parseArtifact, parseEvent, parseSpec, uuid } from './contracts.ts';
import type { Artifact, GameEvent, GameSpec, GameVersion } from './contracts.ts';
import { SCHEMA_V3 } from './arena-schema.ts';
import {arenaMetric} from './arena-contract.ts';

export const SCHEMA_VERSION = 3;

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
const SCHEMA_V2 = [
  'CREATE TABLE generation_worker(slot INTEGER PRIMARY KEY CHECK(slot=1), instance TEXT NOT NULL, expires_at INTEGER NOT NULL, pid INTEGER NOT NULL CHECK(pid>0)) STRICT',
  "CREATE TABLE generation_jobs(job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','generating','validating','repairing','completed','needs_attention','cancelled','failed')), attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 12), checkpoint TEXT NOT NULL CHECK(length(CAST(checkpoint AS BLOB))<=200000), metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version_id TEXT REFERENCES versions(version_id), notified INTEGER NOT NULL DEFAULT 0 CHECK(notified IN (0,1)), UNIQUE(owner_id,idempotency_key)) STRICT",
  'CREATE INDEX generation_jobs_owner ON generation_jobs(owner_id,created_at)',
  'CREATE INDEX generation_jobs_status ON generation_jobs(status)',
];
export function validSchema(db: DatabaseSync): boolean {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (version !== 1 && version !== 2 && version !== 3) return false;
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const actual = db.prepare("SELECT sql FROM sqlite_schema WHERE substr(name,1,7) <> 'sqlite_' ORDER BY name").all().map(row => normalize(String(row.sql))).sort();
  const expected = [...SCHEMA_V1,...(Number(version)>=2?SCHEMA_V2:[]),...(version===3?SCHEMA_V3:[])].map(normalize).sort();
  return actual.length === expected.length && actual.every((sql, i) => sql === expected[i]);
}
export function healthyDatabase(db: DatabaseSync): boolean {
  return validSchema(db) && db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok' && db.prepare('PRAGMA foreign_key_check').all().length === 0;
}
// Installed builds keep mutable files outside the read-only application tree.
// Development retains the existing .local contract, including traversal checks.
export const DATA_ROOT = process.env.YAPLIX_DATA_HOME
  ? resolve(process.env.YAPLIX_DATA_HOME) : resolve(PROJECT_ROOT, '.local');
export function managedPath(path: string, createParents = true): string {
  const legacy = resolve(PROJECT_ROOT, '.local');
  const rel = relative(legacy, resolve(PROJECT_ROOT, path));
  if (isAbsolute(rel) || rel.startsWith('..') || !rel) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
  const target = resolve(DATA_ROOT, rel);
  // Check every ancestor before mkdir: never follow links into another tree.
  for (let part = target; ; part = dirname(part)) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Fault('DB_LINK_FORBIDDEN'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (dirname(part) === part) break;
  }
  if (createParents) mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    const r = relative(realpathSync(DATA_ROOT), realpathSync(target));
    if (isAbsolute(r) || r.startsWith('..')) throw new Fault('DB_PATH_OUTSIDE_PROJECT');
  }
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
      if (version > SCHEMA_VERSION) throw new Fault('SCHEMA_TOO_NEW', 500);
      if (version === 0) {
        if(this.db.prepare("SELECT 1 FROM sqlite_schema WHERE substr(name,1,7)<>'sqlite_' LIMIT 1").get())throw new Fault('SCHEMA_INVALID',500);
        this.transaction(() => this.db.exec([...SCHEMA_V1,...SCHEMA_V2,...SCHEMA_V3].join(';\n') + '; PRAGMA user_version=3;'));
      }
      if (!validSchema(this.db)) throw new Fault('SCHEMA_INVALID', 500);
      if (this.db.prepare('PRAGMA user_version').get()?.user_version === 1) {
        if (!healthyDatabase(this.db)) throw new Fault('SCHEMA_INVALID',500);
        // Preserve a verified pre-migration snapshot; never replace the user's DB.
        if (path !== ':memory:') {
          const snapshot=managedPath(`.local/backups/before-v2-${randomUUID()}.sqlite`);
          this.db.prepare('VACUUM INTO ?').run(snapshot);
          const copy=new DatabaseSync(snapshot,{readOnly:true});
          try { if(!healthyDatabase(copy))throw new Fault('BACKUP_INVALID',500); } finally {copy.close();}
        }
        this.transaction(()=>this.db.exec(SCHEMA_V2.join(';\n')+'; PRAGMA user_version=2;'));
        if (!validSchema(this.db)) throw new Fault('SCHEMA_INVALID',500);
      }
      if (this.db.prepare('PRAGMA user_version').get()?.user_version === 2) {
        if (!healthyDatabase(this.db)) throw new Fault('SCHEMA_INVALID',500);
        if (path !== ':memory:') {
          const snapshot=managedPath(`.local/backups/before-v3-${randomUUID()}.sqlite`);
          this.db.prepare('VACUUM INTO ?').run(snapshot);
          const copy=new DatabaseSync(snapshot,{readOnly:true});
          try { if(!healthyDatabase(copy))throw new Fault('BACKUP_INVALID',500); } finally {copy.close();}
        }
        this.transaction(()=>this.db.exec(SCHEMA_V3.join(';\n')+'; PRAGMA user_version=3;'));
        if (!validSchema(this.db)) throw new Fault('SCHEMA_INVALID',500);
      }
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
    const metadata=JSON.parse(row.metadata as string);
    const artifact=parseArtifact({html:row.html,method:metadata.method,provider:metadata.provider,model:metadata.model,generationStatus:metadata.generationStatus,validationStatus:metadata.validationStatus,...(metadata.generation?{generation:metadata.generation}:{})},'saved-metadata');
    return { ...metadata, ...artifact } as GameVersion;
  }
  isSystemAuthoredVersion(id:string):boolean {
    const metadata=this.db.prepare('SELECT metadata FROM versions WHERE version_id=?').get(uuid(id))?.metadata;
    if(typeof metadata!=='string')return false;
    const value=JSON.parse(metadata) as {method?:string;provider?:string;model?:string;sha256?:string};
    const hashes:Record<string,string>={
      'ember-blocks':'18b0ae7925cf163ac685c7d97a5e1d99d4cb60b8b24dc94864672ef2903807ca',
      'prism-maze':'ac7b470f1d4e9658c0956f8358c86464a0cb0385e5f6fd91e6955c54516f3856',
      'arena-target':'808ed0e52b41ec0dd825d5f0afa174d69ccb9b1836f2a2dc315dbe53207c2cac'
    };
    return value.method==='authored'&&value.provider==='YAPLIX'&&typeof value.model==='string'&&value.sha256===hashes[value.model];
  }
  list() {
    return this.db.prepare("SELECT metadata,(SELECT json_extract(first.metadata,'$.spec.prompt') FROM versions first WHERE first.game_id=versions.game_id ORDER BY first.rowid LIMIT 1) title FROM versions WHERE rowid IN (SELECT MAX(rowid) FROM versions GROUP BY game_id) AND NOT EXISTS(SELECT 1 FROM versions system WHERE system.game_id=versions.game_id AND json_extract(system.metadata,'$.method')='authored' AND json_extract(system.metadata,'$.provider')='YAPLIX' AND ((json_extract(system.metadata,'$.model')='ember-blocks' AND json_extract(system.metadata,'$.sha256')='18b0ae7925cf163ac685c7d97a5e1d99d4cb60b8b24dc94864672ef2903807ca') OR (json_extract(system.metadata,'$.model')='prism-maze' AND json_extract(system.metadata,'$.sha256')='ac7b470f1d4e9658c0956f8358c86464a0cb0385e5f6fd91e6955c54516f3856') OR (json_extract(system.metadata,'$.model')='arena-target' AND json_extract(system.metadata,'$.sha256')='808ed0e52b41ec0dd825d5f0afa174d69ccb9b1836f2a2dc315dbe53207c2cac'))) ORDER BY rowid DESC LIMIT 50").all().map(row => ({...JSON.parse(row.metadata as string),title:String(row.title)}));
  }
  lastSavedGeneration(provider?: string | null) {
    const row = this.db.prepare("SELECT metadata FROM versions WHERE json_extract(metadata,'$.method')='llm_code' AND json_extract(metadata,'$.provider')=? ORDER BY rowid DESC LIMIT 1").get(provider ?? '');
    if (!row) return null;
    const v = JSON.parse(String(row.metadata));
    return { provider: v.provider, model: v.model, createdAt: v.createdAt, source: 'saved-version' };
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
      return { filename, sha256: createHash('sha256').update(readFileSync(target)).digest('hex'), schemaVersion: SCHEMA_VERSION, verified: true };
    } finally { this.backingUp = false; }
  }
  history(id: string) {
    const gameId = uuid(id);
    if (!this.db.prepare('SELECT 1 FROM games WHERE game_id=?').get(gameId)) throw new Fault('GAME_NOT_FOUND', 404);
    // Metadata only: histories do not multiply the HTML response size.
    return this.db.prepare('SELECT metadata FROM versions WHERE game_id=? ORDER BY rowid').all(gameId).map(r => JSON.parse(r.metadata as string));
  }
  save(spec: GameSpec, artifact: Artifact, previousId?: string): GameVersion {
    return this.transaction(()=>this.insertVersion(spec,artifact,previousId));
  }
  saveAndCompleteJob(jobId:string,ownerId:string,spec:GameSpec,artifact:Artifact,previousId?:string,workerInstance?:string):GameVersion {
    return this.transaction(()=>{
      if(workerInstance&&!this.db.prepare('SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?').get(workerInstance,Date.now()))throw new Fault('JOB_WORKER_BUSY',409);
      const row=this.db.prepare('SELECT status,version_id,metadata FROM generation_jobs WHERE job_id=? AND owner_id=?').get(uuid(jobId),ownerId);
      if(!row||!['generating','validating','repairing'].includes(String(row.status)))throw new Fault('JOB_STATE',409);
      const deadline=JSON.parse(String(row.metadata)).deadlineAt;
      const withinDeadline=()=>{if(typeof deadline==='number'&&Date.now()>=deadline)throw new Fault('JOB_DURATION_LIMIT',409);};
      withinDeadline();
      const version=this.insertVersion(spec,artifact,previousId);
      this.db.prepare("UPDATE generation_jobs SET status='completed',version_id=?,updated_at=? WHERE job_id=? AND owner_id=?").run(version.versionId,new Date().toISOString(),jobId,ownerId);
      withinDeadline(); // Roll back the version and completion together if SQLite used the remaining budget.
      return version;
    });
  }
  private insertVersion(spec:GameSpec,artifact:Artifact,previousId?:string):GameVersion {
    spec = parseSpec(spec,previousId?1200:500); artifact = parseArtifact(artifact);
    const previous = previousId ? this.getVersion(previousId) : null;
    const version: GameVersion = { ...artifact, spec, gameId: previous?.gameId ?? randomUUID(), versionId: randomUUID(), previousVersionId: previous?.versionId ?? null, sha256: hash(artifact.html), createdAt: new Date().toISOString() };
      const count = this.db.prepare('SELECT COUNT(*) n,COALESCE(SUM(bytes),0) total FROM versions').get() as { n: number; total: number };
      if (count.n >= 10_000 || count.total + Buffer.byteLength(artifact.html) > 100_000_000) throw new Fault('ARTIFACT_QUOTA', 507);
      if (!previous) this.db.prepare('INSERT INTO games VALUES (?,?)').run(version.gameId, version.createdAt);
      const { html, ...metadata } = version;
      this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?)').run(version.versionId, version.gameId, version.previousVersionId, html, Buffer.byteLength(html), JSON.stringify(metadata), version.createdAt);
    return version;
  }
  session(versionId: string, onCreated?: (sessionId: string) => void) {
    versionId = this.getVersion(versionId).versionId;
    const sessionId = randomUUID(), token = randomBytes(32).toString('hex'), expiresAt = Date.now() + 3600_000;
    this.transaction(() => {
      if (Number(this.db.prepare('SELECT COUNT(*) n FROM sessions').get()?.n) >= 10_000) throw new Fault('SESSION_QUOTA', 507);
      this.db.prepare('INSERT INTO sessions(session_id,version_id,token_hash,expires_at) VALUES (?,?,?,?)').run(sessionId, versionId, hash(token), expiresAt);
      onCreated?.(sessionId);
    });
    return { sessionId, versionId, token, expiresAt, protocolVersion: 1 as const };
  }
  event(input: GameEvent, token: string, onAccepted?: () => void): { duplicate: boolean } {
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
      if (event.type === 'game_started' && s.started_at !== null || ['score_changed', 'result_changed', 'game_won', 'game_lost', 'session_ended'].includes(event.type) && s.started_at === null || ['game_won', 'game_lost'].includes(event.type) && s.outcome !== null || ['score_changed','result_changed'].includes(event.type) && s.outcome !== null || event.type === 'game_ready' && s.started_at !== null) throw new Fault('EVENT_STATE', 409);
      if (Number(this.db.prepare('SELECT COUNT(*) n FROM events').get()?.n) >= 100_000) throw new Fault('EVENT_QUOTA', 507);
      this.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(event.eventId, event.sessionId, event.sequence, payload);
      this.db.prepare('UPDATE sessions SET last_sequence=?,last_timestamp=?,started_at=?,ended_at=?,outcome=?,score=? WHERE session_id=?').run(event.sequence, event.timestamp, event.type === 'game_started' ? event.timestamp : s.started_at, event.type === 'session_ended' ? event.timestamp : s.ended_at, ['game_won', 'game_lost'].includes(event.type) ? event.type : s.outcome, event.type === 'result_changed' ? event.data.value! : event.type === 'score_changed' ? event.data.score! : s.score, event.sessionId);
      // Arena finalization shares this transaction: no completed event without its record.
      onAccepted?.();
      return { duplicate: false };
    });
  }
  analytics(versionId: string) {
    versionId = this.getVersion(versionId).versionId;
    const row = this.db.prepare(`SELECT COUNT(*) sessionCount,COUNT(started_at) startedCount,COUNT(ended_at) completedCount,
      COALESCE(SUM(outcome='game_won'),0) won,COALESCE(SUM(outcome='game_lost'),0) lost,
      AVG(CASE WHEN ended_at>=started_at THEN ended_at-started_at END) meanDurationMs,AVG(score) meanScore
      FROM sessions WHERE version_id=?`).get(versionId) as Metrics;
    const resultMetric=arenaMetric(this.getVersion(versionId).html);
    return { versionId, ...row,meanScore:resultMetric&&resultMetric.id!=='score'?null:row.meanScore,meanResult:row.meanScore,resultMetric,winRate: row.startedCount ? row.won! / row.startedCount : null, trust: 'untrusted_client' as const };
  }
  compare(versionId: string, baselineId: string) {
    const v = this.getVersion(versionId), b = this.getVersion(baselineId);
    if (v.gameId !== b.gameId || v.versionId === b.versionId) throw new Fault('INVALID_COMPARISON');
    const current = this.analytics(versionId), baseline = this.analytics(baselineId);
    const evidence = Number(current.completedCount) >= 5 && Number(baseline.completedCount) >= 5 ? 'preliminary' : 'insufficient_data';
    return { current, baseline, evidence, minimumCompletedSessions: 5, winRateDelta: current.winRate !== null && baseline.winRate !== null ? current.winRate - baseline.winRate : null, meanDurationDeltaMs: current.meanDurationMs !== null && baseline.meanDurationMs !== null ? current.meanDurationMs - baseline.meanDurationMs : null, automaticCodeChanges: false, observations: evidence === 'insufficient_data' ? ['Collect at least five completed sessions per version.'] : ['Differences are descriptive; player populations and client telemetry are uncontrolled.'] };
  }
}
