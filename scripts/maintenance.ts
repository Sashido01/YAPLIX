import { Store, managedPath, healthyDatabase } from '../src/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { configuredGenerator } from '../src/live.ts';
import { liveReadiness, missingProductionFiles } from '../src/diagnostics.ts';
import { networkPolicy } from '../src/access.ts';
import { checkHost, checkPort } from '../src/network.ts';
import { Fault } from '../src/contracts.ts';
import { OperationTrace, operationId } from './operation-trace.mjs';
const command = process.argv[2];
const operation = new OperationTrace({dataRoot:process.env.YAPLIX_DATA_HOME??'.local',operationId:operationId()});
let store: Store | undefined;
try {
  if (command === 'verify-backup') {
    operation.record('maintenance','maintenance.verify_started','STARTED');
    const path = managedPath(process.argv[3] ?? '', false), expected = process.argv[4];
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Fault('BACKUP_SHA256_REQUIRED');
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (sha256 !== expected) throw new Fault('BACKUP_HASH_MISMATCH');
    const copy = new DatabaseSync(path, { readOnly: true });
    let schemaVersion;
    try { if (!healthyDatabase(copy)) throw new Fault('BACKUP_INVALID');schemaVersion=Number(copy.prepare('PRAGMA user_version').get()?.user_version); }
    finally { copy.close(); }
    console.log(JSON.stringify({ verified: true, sha256, schemaVersion }));
    operation.record('maintenance','maintenance.verify_completed','PASS',{details:{schemaVersion}});
  } else if (command === 'backup') { operation.record('maintenance','maintenance.backup_started','STARTED');store = new Store(process.env.YAPLIX_DB); const result=await store.backup();console.log(JSON.stringify(result, null, 2));operation.record('maintenance','maintenance.backup_completed','PASS',{details:{backupCreated:true}}); }
  else if (command === 'doctor') {
    operation.record('maintenance','maintenance.doctor_started','STARTED');
    const failures: string[] = [], code = (e: unknown) => e instanceof Fault ? e.code : 'DATABASE_OR_CONFIGURATION_ERROR';
    let mode: string | null = null, address: string | null = null, port: number | null = null;
    try { const policy = networkPolicy(); mode = policy.mode; address = policy.host; port = policy.port; checkHost(policy); await checkPort(policy); } catch (e) { failures.push(code(e)); }
    const missingAssets = missingProductionFiles(); if (missingAssets.length) failures.push('RUNTIME_BUILD_REQUIRED');
    let databaseReady = false;
    try { store = new Store(process.env.YAPLIX_DB); databaseReady = store.integrity(); if (!databaseReady) failures.push('DATABASE_INTEGRITY'); } catch (e) { failures.push(code(e)); }
    let live: Awaited<ReturnType<typeof liveReadiness>> | undefined;
    try { live = await liveReadiness(configuredGenerator()); if (live.liveConfigured && !live.liveReady) failures.push('LIVE_' + live.llmState.toUpperCase()); } catch (e) { failures.push(code(e)); }
    const ok = failures.length === 0;
    console.log(JSON.stringify({ ok, nodeVersion: process.version, mode, address, port, databaseReady, appReady: databaseReady && !missingAssets.length, missingAssets, ...live, failures, note: 'Порт проверяется для нового запуска. PORT_IN_USE может означать уже запущенный сервер. Доступность телефона и firewall не проверены.' }, null, 2));
    operation.record('maintenance',ok?'maintenance.doctor_completed':'maintenance.doctor_failed',ok?'PASS':'FAIL',{errorCode:ok?null:(failures[0]??'DOCTOR_FAILED')});
    if (!ok) process.exitCode = 1;
  } else throw new Fault('USAGE: npm run doctor | npm run backup | npm run verify:backup -- path sha256');
} catch (error) { const code=error instanceof Fault?error.code:'MAINTENANCE_FAILED';console.error(code);operation.record('maintenance',command==='backup'?'maintenance.backup_failed':command==='verify-backup'?'maintenance.verify_failed':'maintenance.doctor_failed','FAIL',{errorCode:code}); process.exitCode = 1; }
finally { store?.close(); }
