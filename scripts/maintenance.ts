import { Store, managedPath, healthyDatabase } from '../src/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { configuredGenerator, LocalCodeAdapter, checkBGen, BGEN_REVISION } from '../src/live.ts';
import { boundedText } from '../src/bgen.ts';
import { Fault } from '../src/contracts.ts';
const command = process.argv[2];
let store: Store | undefined;
try {
  if (command === 'verify-backup') {
    const path = managedPath(process.argv[3] ?? '', false), expected = process.argv[4];
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Fault('BACKUP_SHA256_REQUIRED');
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (sha256 !== expected) throw new Fault('BACKUP_HASH_MISMATCH');
    const copy = new DatabaseSync(path, { readOnly: true });
    try { if (!healthyDatabase(copy)) throw new Fault('BACKUP_INVALID'); }
    finally { copy.close(); }
    console.log(JSON.stringify({ verified: true, sha256, schemaVersion: 1 }));
  } else if (command === 'backup') { store = new Store(process.env.YAPLIX_DB); console.log(JSON.stringify(await store.backup(), null, 2)); }
  else if (command === 'doctor') {
    store = new Store(process.env.YAPLIX_DB);
    const adapter = configuredGenerator(); let bgenReady = false, modelReady: boolean | null = null;
    try { checkBGen(); bgenReady = true; } catch { /* Optional in DEMO. */ }
    if (adapter instanceof LocalCodeAdapter) {
      try { const response = await fetch(`${adapter.url}/api/tags`, { redirect: 'error', signal: AbortSignal.timeout(3000) }); const data = JSON.parse(await boundedText(response, 100_000)); modelReady = response.ok && data.models?.some((m: { name: string }) => m.name === adapter.model) === true; }
      catch { modelReady = false; }
    }
    const ok = store.integrity();
    console.log(JSON.stringify({ ok, nodeVersion: process.version, demoReady: ok, liveConfigured: Boolean(adapter), provider: adapter instanceof LocalCodeAdapter ? adapter.provider : adapter ? 'bgen' : null, model: adapter instanceof LocalCodeAdapter ? adapter.model : null, modelReady, bgenReady, bgenRevision: bgenReady ? BGEN_REVISION : null }, null, 2));
    if (!ok || adapter instanceof LocalCodeAdapter && (!bgenReady || !modelReady)) process.exitCode = 1;
  } else throw new Fault('USAGE: npm run doctor | npm run backup | npm run verify:backup -- path sha256');
} catch (error) { console.error(error instanceof Fault ? error.code : 'MAINTENANCE_FAILED'); process.exitCode = 1; }
finally { store?.close(); }
