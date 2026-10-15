// TASK-013 playability audit of generated artifacts: architecture A vs B.
// No LLM calls: loads .local/task-013/{branch}-prompt-{id}.html in the checker
// and reports evidence plus static validation. Pass specific ids via argv,
// defaults to all found artifacts.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserCheck } from '../src/browser-check.ts';
import { validateDocument } from '../src/generation.ts';

const root = resolve(process.cwd(), '.local/task-013');
const requested = process.argv.slice(2);
const names = requested.length
  ? requested
  : readdirSync(root).filter(n => n.endsWith('.html')).map(n => n.replace(/\.html$/, '')).sort();
for (const name of names) {
  const file = resolve(root, name + '.html');
  if (!existsSync(file)) { console.log('[' + name + '] artifact missing'); continue; }
  const html = readFileSync(file, 'utf8');
  const issues = validateDocument(html);
  console.log('[' + name + '] static issues: ' + (issues.length ? issues.join(', ') : 'none'));
  try {
    const evidence = await browserCheck(html, AbortSignal.timeout(30000));
    console.log('[' + name + '] checker: ' + JSON.stringify(evidence));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'UNKNOWN';
    const feedback = error instanceof Error && 'feedback' in error ? (error as { feedback: string }).feedback : String(error);
    console.log('[' + name + '] checker FAILED: ' + code + ' — ' + feedback);
  }
}
