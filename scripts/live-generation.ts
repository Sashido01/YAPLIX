// Uses the existing API/adapter/store; never generates or substitutes game code.
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BGenAdapter } from '../src/bgen.ts';
import type { Generator } from '../src/bgen.ts';
import { configuredGenerator, LocalCodeAdapter, BGEN_REVISION } from '../src/live.ts';
import { createApp } from '../src/api.ts';
import { Fault } from '../src/contracts.ts';
import type { GameSpec, GameVersion } from '../src/contracts.ts';
import { Store, PROJECT_ROOT } from '../src/store.ts';

let adapter: Generator | undefined;
try { adapter = configuredGenerator(); if (!adapter) throw new Fault('BGEN_NOT_CONFIGURED'); }
catch (error) { console.error(error instanceof Fault ? error.code : 'LIVE_CONFIGURATION_INVALID'); process.exit(1); }
const run = `.local/live/${randomUUID()}`;
const store = new Store(`${run}/yaplix.sqlite`); // Same containment/link checks as the server.
const app = createApp(store, adapter);
const specs: GameSpec[] = [
  { prompt: 'Create a snake game: collect five apples to win, hit a wall to lose. Include Start and touch direction buttons.', genre: 'snake', mechanics: ['collect', 'win', 'lose'], audience: 'default', controls: ['keyboard', 'touch'], responsive: true, webview: true },
  { prompt: 'Create Signal Courier: rotate three mirrors to route a light beam from a lighthouse to a harbour. Each move spends energy; connect before energy runs out. Include Start, touch mirror buttons and restart.', genre: 'signal-routing', mechanics: ['rotate', 'energy', 'win', 'lose'], audience: 'default', controls: ['keyboard', 'touch'], responsive: true, webview: true },
];
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), provider: adapter instanceof LocalCodeAdapter ? adapter.provider : 'bgen', model: adapter instanceof LocalCodeAdapter ? adapter.model : null, bgenRevision: adapter instanceof LocalCodeAdapter ? BGEN_REVISION : null, specs, status: 'blocked', versions: [], browserValidation: 'not_run', telemetry: 'not_observed' };
const versions: Omit<GameVersion, 'html'>[] = [];
async function generate(spec: GameSpec, previous?: GameVersion) {
  const response = await app.request(previous ? `/api/games/${previous.gameId}/versions` : '/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, requiredMethod: 'llm_code', ...(previous ? { previousVersionId: previous.versionId } : {}) }),
  });
  if (!response.ok) { const failure = await response.json(); throw new Fault(failure.error, response.status); }
  const version: GameVersion = await response.json();
  const exported = await app.request(`/api/versions/${version.versionId}/export`);
  const html = await exported.text();
  if (createHash('sha256').update(html).digest('hex') !== version.sha256 || store.getVersion(version.versionId).html !== html) throw new Fault('EXPORT_HASH_MISMATCH', 500);
  writeFileSync(resolve(PROJECT_ROOT, run, `${version.versionId}.html`), html, { flag: 'wx' });
  const { html: _html, ...metadata } = version;
  versions.push(metadata); evidence.versions = versions;
  return version;
}
try {
  if (adapter instanceof BGenAdapter) {
    const capabilities = await adapter.liveCapabilities(); evidence.capabilities = capabilities;
    if (!capabilities.previousCode) throw new Fault('BGEN_ITERATION_UNSUPPORTED', 503);
  }
  const first = await generate(specs[0]);
  await generate(specs[1]);
  await generate({ ...specs[0], prompt: 'Modify the previous snake game: collect eight apples to win; preserve the controls, start, wall collision and offline operation.' }, first);
  evidence.status = 'generated_unverified';
} catch (error) {
  evidence.error = error instanceof Fault ? error.code : 'LIVE_RUN_FAILED';
  process.exitCode = 1;
} finally {
  evidence.integrity = store.integrity();
  evidence.finishedAt = new Date().toISOString();
  store.close();
  writeFileSync(resolve(PROJECT_ROOT, run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ run, status: evidence.status, error: evidence.error, versions: versions.length }));
}
