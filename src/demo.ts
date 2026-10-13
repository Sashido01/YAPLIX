import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './store.ts';
import { parseArtifact } from './contracts.ts';
import type { GameSpec } from './contracts.ts';

export function demoArtifact(spec: GameSpec) {
  const goal = Math.min(20, Math.max(1, Number(spec.prompt.match(/\b(\d{1,2})\b/)?.[1] ?? 3)));
  const html = readFileSync(resolve(PROJECT_ROOT, 'assets/demo.html'), 'utf8').replaceAll('__GOAL__', String(goal));
  return parseArtifact({ html, method: 'mock', provider: 'yaplix-authored-demo', model: null, generationStatus: 'succeeded', validationStatus: 'unverified' });
}
