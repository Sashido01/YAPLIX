import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './store.ts';
import { checkBGen, BGEN_REVISION, LocalCodeAdapter } from './live.ts';
import type { Generator } from './bgen.ts';

const productionFiles = ['assets/index.html', 'assets/access.html', 'assets/demo.html', 'assets/style.css', 'build/public/ui.js', 'build/public/access-ui.js', 'build/public/connection-ui.js'];
export function missingProductionFiles() { return productionFiles.filter(path => !existsSync(resolve(PROJECT_ROOT, path))); }
export async function liveReadiness(adapter?: Generator) {
  let bgenReady = false;
  try { checkBGen(); bgenReady = true; } catch { /* Optional for DEMO. */ }
  let llmState = 'not_configured';
  if (adapter instanceof LocalCodeAdapter) {
    const model = await adapter.modelState();
    llmState = model === 'ready' && !bgenReady ? 'bgen_missing' : model;
  } else if (adapter) llmState = 'not_verified';
  return { liveConfigured: Boolean(adapter), liveReady: llmState === 'ready', llmState, provider: adapter instanceof LocalCodeAdapter ? adapter.provider : adapter ? 'bgen' : null, model: adapter instanceof LocalCodeAdapter ? adapter.model : null, modelReady: llmState === 'ready' || llmState === 'bgen_missing', bgenReady, bgenRevision: bgenReady ? BGEN_REVISION : null };
}
