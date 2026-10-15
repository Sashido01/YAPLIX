// TASK-016 gameplay audit of generated artifacts: extends the TASK-013
// static+browser audit with the gameplay evidence checker. No LLM calls: loads
// .local/task-016/{name}.html artifacts (or .local/task-013 ones) and reports
// per-aspect evidence. Usage: node --experimental-strip-types
// scripts/orchestrator-gameplay-audit.ts [names...] --snake / --tetris
// Selects the drive profile by artifact naming heuristics (b-prompt-1 tetris,
// b-prompt-2 snake) unless --snake/--tetris given for the whole run.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameplayCheck } from '../src/orchestrator/gameplay-check.ts';
import { parseTarget } from '../src/orchestrator/gameplay-check.ts';
import { validateDocument } from '../src/generation.ts';

const root = resolve(process.cwd(), '.local/task-016');
const requested = process.argv.slice(2).filter(a => !a.startsWith('--'));
const force = process.argv.includes('--snake') ? 'snake' : process.argv.includes('--tetris') ? 'tetris' : null;
const names = requested.length ? requested : (existsSync(root) ? readdirSync(root).filter(n => n.endsWith('.html')).map(n => n.replace(/\.html$/, '')) : []);
if (!names.length) { console.log('no artifacts in ' + root); process.exit(0); }
for (const name of names) {
  const file = resolve(root, name + '.html');
  if (!existsSync(file)) { console.log('[' + name + '] missing'); continue; }
  const html = readFileSync(file, 'utf8');
  const issues = validateDocument(html);
  console.log('[' + name + '] static: ' + (issues.length ? issues.join(', ') : 'none'));
  const kind = force ?? (/snake|zm|змей/i.test(name) ? 'snake' : 'tetris');
  const rules = kind === 'snake'
    ? { win: 'collect 5 apples', loss: 'enemy catch', objective: '5 apples' }
    : { win: 'объявленный целевой счёт/линии (see report)', loss: 'stack overflow', objective: 'target score' };
  const options = kind === 'snake'
    ? { budgetSeconds: 90, scoreTarget: null, sequence: ([...Array(24).fill('up')] as string[]).flatMap((s, i) => i % 7 === 6 ? ['up', 'fire'] : [s]) as ('up' | 'fire')[] }
    : { budgetSeconds: 75, scoreTarget: parseTarget(rules.win), sequence: ['drop', 'hurry', 'drop', 'hurry'] as ('drop' | 'hurry')[] };
  try {
    const report = await gameplayCheck(html, rules, options);
    for (const a of report.aspects) console.log('  ' + a.aspect + ': ' + a.level + (a.detail ? ' — ' + a.detail : ''));
    if (report.notes.length) console.log('  notes: ' + report.notes.join(' | '));
    console.log('  events: ' + report.events.join(',') + ' finalScore=' + report.finalScore);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'UNKNOWN';
    console.log('  gameplay check FAILED: ' + code + ' — ' + String(error).slice(0, 160));
  }
}
