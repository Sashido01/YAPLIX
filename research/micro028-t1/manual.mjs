// Owner-operated only. No inference, repair, database mutation or automatic verdict.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { loadEntry, runRecorder, PHASES } from './recorder.mjs';

export async function collectOwnerAnswers(session, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  let asking = false;
  rl.on('close', () => { if (asking) session.inputClosed(); });
  const question = async prompt => {
    if (rl.closed) { session.inputClosed(); throw Error('INPUT_CLOSED'); }
    asking = true;
    try { return await rl.question(prompt, { signal: session.signal }); }
    finally { asking = false; }
  };
  try {
    console.log('Play directly in the game window. Do not enter secrets. PASS/FAIL are HUMAN_REPORTED, never automatically VERIFIED. Empty/UNKNOWN leaves NOT_VERIFIED. Native file export is not tested.');
    session.rules(await question('Human-established rules / controls / win / loss, or UNKNOWN: '));
    for (const phase of PHASES) {
      if (phase === 'export') await session.exportCopy();
      session.phase(phase);
      const notes = await question(phase + ': play now, then PASS / FAIL / UNKNOWN and brief observations (Enter keeps pending): ');
      await session.answer(phase, notes);
    }
  } finally { asking = false; rl.close(); }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
if (process.argv.includes('--help')) {
  console.log('node research/micro028-t1/manual.mjs manual-NN\nOwner plays in visible offline sandbox; no generation. Answer PASS / FAIL / UNKNOWN (human report only). Ctrl+C saves partial evidence. Results: .local/micro028-t1/human/');
} else {
  const id = process.argv[2];
  if (!/^manual-\d{2}$/.test(id ?? '')) throw Error('Select an ID from manual-plan.json');
  const plan = JSON.parse(readFileSync('.local/micro028-t1/manual-plan.json', 'utf8'));
  const entry = plan.games.find(g => g.id === id);
  if (!entry) throw Error('Missing selected entry');
  const source = loadEntry(entry);
  const result = await runRecorder({ ...source, entry, actor: 'OWNER', headless: false,
    outRoot: resolve('.local/micro028-t1/human', id), installSignals: true,
    interact: collectOwnerAnswers
  });
  console.log(JSON.stringify({ directory: result.out, completion: result.completion, status: result.status, pending: result.unverified }));
  if (result.completion !== 'COMPLETED') process.exitCode = 1;
}
}
