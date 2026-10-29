import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE = /^[A-Z0-9_.:-]{1,64}$/;
const STAGE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const MAX_FILE = 128 * 1024, MAX_TOTAL = 16 * 1024 * 1024, RETENTION = 7 * 86400000;
const EVENTS = new Set(['operation.started','startup.runtime','startup.config_checked','startup.database_opened','startup.database_integrity','startup.api_ready','startup.ui_ready','startup.browser_checker','startup.completed','startup.failed','startup.stopped','bootstrap.started','bootstrap.node_ready','bootstrap.dependencies_ready','bootstrap.build_ready','bootstrap.app_started','bootstrap.failed','desktop.started','desktop.runtime_verified','desktop.identity_checked','desktop.backend_ready','desktop.instance_reused','desktop.stop_requested','desktop.stopped','desktop.restart','desktop.failed','install.started','install.platform_checked','install.planned','install.prepared','install.backup_ready','install.installed','install.verified','install.launched','install.completed','install.rollback_started','install.rolled_back','install.failed','install.recovery_checked','maintenance.doctor_started','maintenance.doctor_completed','maintenance.doctor_failed','maintenance.backup_started','maintenance.backup_completed','maintenance.backup_failed','maintenance.verify_started','maintenance.verify_completed','maintenance.verify_failed','generation.job_linked','model.catalog_loaded','model.selection_restored','model.selection_changed','model.connection_checked','model.generation_blocked','model.job_created']);
const DETAIL_KEYS = new Set(['nodeVersion','platform','architecture','dataHomeConfigured','schemaVersion','integrity','missingAssetCount','browserReady','browserTarget','action','componentCount','backupCreated','apiReady','uiReady','sandboxReady','durationMs','jobId','errorCode','reason','mode','model','configured','readiness','reasonCode']);

function safeDetails(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(value) && !/secret|token|key|password|https?:/i.test(value)) out[key] = value;
  }
  return out;
}

export function operationId(env = process.env) { return UUID.test(env.YAPLIX_OPERATION_ID ?? '') ? env.YAPLIX_OPERATION_ID : randomUUID(); }

export class OperationTrace {
  constructor({ dataRoot, operationId: id = randomUUID(), clock = () => Date.now() } = {}) {
    this.id = UUID.test(id) ? id : randomUUID();
    this.clock = clock;
    this.writes = 0;
    this.directory = resolve(dataRoot ?? process.env.YAPLIX_DATA_HOME ?? '.local', 'diagnostics', 'operations');
    try {
      for (let parent = this.directory; ; parent = dirname(parent)) {
        if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw Error('TRACE_PATH_INVALID');
        if (dirname(parent) === parent) break;
      }
      mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700); this.prune();
    }
    catch { this.directory = null; }
  }
  get available() { return Boolean(this.directory); }
  record(stage, event, status, data = {}) {
    try {
      if (!this.directory || !STAGE.test(stage) || !EVENTS.has(event) || !['STARTED','PASS','FAIL','SKIPPED'].includes(status)) return false;
      const row = { timestamp: new Date(this.clock()).toISOString(), operationId: this.id, stage, event, status,
        durationMs: Number.isFinite(data.durationMs) && data.durationMs >= 0 ? Math.round(data.durationMs) : null,
        errorCode: SAFE.test(data.errorCode ?? '') ? data.errorCode : null };
      const details = safeDetails(data.details);
      if (data.jobId && UUID.test(data.jobId)) details.jobId = data.jobId;
      if (Object.keys(details).length) row.details = details;
      const file = resolve(this.directory, `${this.id}.jsonl`), rotated = `${file}.1`;
      this.regular(file); this.regular(rotated);
      const line = JSON.stringify(row) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > MAX_FILE) { if (existsSync(rotated)) unlinkSync(rotated); renameSync(file, rotated); }
      appendFileSync(file, line, { flag: 'a', mode: 0o600 }); chmodSync(file, 0o600);
      if (existsSync(rotated)) chmodSync(rotated, 0o600);
      if (++this.writes % 64 === 0) this.prune();
      return true;
    } catch { return false; }
  }
  begin(stage, event, details = {}) {
    const start = this.clock(); this.record(stage, event, 'STARTED', { details }); let done = false;
    return (status = 'PASS', errorCode = null, extra = {}) => {
      if (done) return false; done = true;
      return this.record(stage, event, status, { durationMs: Math.max(0, this.clock() - start), errorCode, details: { ...details, ...extra } });
    };
  }
  linkJob(jobId) { return this.record('generation', 'generation.job_linked', 'PASS', { jobId }); }
  regular(path) { try { const info = lstatSync(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('TRACE_PATH_INVALID'); } catch(error) { if (error?.code !== 'ENOENT') throw error; } }
  prune() {
    const files = readdirSync(this.directory).filter(name => /^[0-9a-f-]{36}\.jsonl(?:\.1)?$/i.test(name)).map(name => resolve(this.directory, name));
    let total = 0;
    for (const file of files) { this.regular(file); total += statSync(file).size; }
    for (const file of files) { const info = statSync(file); if (this.clock() - info.mtimeMs > RETENTION || total > MAX_TOTAL) { unlinkSync(file); total -= info.size; } }
  }
}
