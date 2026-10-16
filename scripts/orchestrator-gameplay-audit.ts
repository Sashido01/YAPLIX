// Offline TASK-017 audit. Reuses the exact TASK-016 HTML + recorded rules.
// No provider, environment file, production generator or database access.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gameplayCheck } from '../src/orchestrator/gameplay-check.ts';
import { validateDocument } from '../src/generation.ts';

const root = resolve(process.cwd(), '.local/task-016');
const out = resolve(process.cwd(), '.local/task-017', new Date().toISOString().replace(/[:.]/g, '-'));
const requested = process.argv.slice(2);
const names = requested.length ? requested : ['b-prompt-1', 'b-prompt-2'];
mkdirSync(out, { recursive: true });
for (const name of names) {
  if (!/^b-prompt-[12]$/.test(name)) throw new Error('Only the two reviewed TASK-016 artifacts are supported');
  const file = resolve(root, name + '.html'), metadata = resolve(root, name + '.evidence.json');
  if (!existsSync(file) || !existsSync(metadata)) throw new Error('Existing TASK-016 artifact + rules required');
  const html = readFileSync(file, 'utf8');
  const rules = JSON.parse(readFileSync(metadata, 'utf8')).rules;
  const sha256 = createHash('sha256').update(html).digest('hex');
  const start = Date.now();
  const report = await gameplayCheck(html, rules, {
    budgetSeconds: name === 'b-prompt-2' ? 150 : 30,
    rulesAware: {
      evidenceDir: resolve(out, name), maxActions: 900, stallMs: 10000,
      ...(name === 'b-prompt-2' ? { snake: {
        cols: 20, rows: 20, cell: 20, logicalWidth: 400, logicalHeight: 400,
        palette: { head: '#00ff00', body: '#00aa00', apple: '#ff0000', wall: '#555555', enemy: '#ff00ff' },
      } } : { grid: { cols: 10, rows: 20, cell: 20, logicalWidth: 320, logicalHeight: 480 }, sequence: ['left', 'right', 'drop', 'hurry'] as ('left' | 'right' | 'drop' | 'hurry')[] }),
    },
  });
  const result = { artifact: name, sha256, rules, staticIssues: validateDocument(html), totalMs: Date.now() - start, report };
  const output = resolve(out, name + '.json');
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ artifact: name, sha256, totalMs: result.totalMs, aspects: report.aspects, goal: report.evidence?.goal, maxProgress: Math.max(...(report.evidence?.samples.map(s => s.progress ?? 0) ?? [0])), actions: report.evidence?.actions.length, stop: report.evidence?.stopReason, evidence: output }));
}
