import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchBrowser, probeDocument, LIMITS, sha256 } from './probe.mjs';
const [mode, arg] = process.argv.slice(2);
assert(['dev', 'heldout', 'real'].includes(mode), 'Use dev <attempt>, heldout <frozenSHA>, real <frozenSHA>');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git(['rev-parse', 'HEAD']);
let docs = [], out;
if (mode === 'dev') {
  assert(/^[a-z0-9-]+$/.test(arg ?? ''), 'Explicit new attempt required');
  out = resolve('.local/micro028-t1/dev-' + arg);
  const { calibrationDocuments } = await import('../../tests/calibration-fixtures.ts');
  const { devCases } = await import('./dev-cases.mjs');
  docs = [...calibrationDocuments.map((html, i) => ({ id: 'calibration-' + String(i + 1).padStart(2, '0'), html })), ...devCases];
} else {
  assert.equal(arg, head, 'Must run on exact frozen probe HEAD');
  assert.equal(git(['diff', 'HEAD', '--', 'research/micro028-t1']), '', 'Probe/control tree must be frozen');
  out = resolve('.local/micro028-t1/' + mode + '-final');
}
if (mode === 'heldout') {
  const manifest = JSON.parse(readFileSync('research/micro028-t1/heldout/manifest.json', 'utf8'));
  assert.deepEqual(manifest.seeds, LIMITS.seeds);
  docs = manifest.entries.map(e => { const html = readFileSync('research/micro028-t1/heldout/' + e.file, 'utf8'); assert.equal(sha256(html), e.sha256); return { id: e.file.replace('.html', ''), html }; });
  assert.equal(docs.length, 6);
}
if (mode === 'real' || mode === 'dev') {
  docs.push({ id: 'real-kindness', html: readFileSync('.local/micro028/case-original.html', 'utf8') });
  docs.push({ id: 'real-micro027', html: readFileSync('.local/micro027/live/delivered-checkpoint.html', 'utf8') });
  const inv = JSON.parse(readFileSync('.local/micro028-t1/inventory.json', 'utf8'));
  for (const d of docs.filter(d => d.id.startsWith('real-'))) assert(inv.some(r => r.llm && r.sha === sha256(d.html)), 'Real source must match audited provenance');
}
assert(!existsSync(out), 'Preserve previous campaign; held-out may only run once');
mkdirSync(out, { recursive: true });
const plan = { mode, frozenCommit: head, controlCommit: git(['log', '--diff-filter=A', '--format=%H', '-1', '--', 'research/micro028-t1/heldout/manifest.json']), limits: LIMITS, documents: docs.map(d => ({ id: d.id, sha256: sha256(d.html) })), started: new Date().toISOString(), inferencePosts: 0, noOracleRead: true };
writeFileSync(resolve(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
const browser = await launchBrowser(), summaries = [];
try {
  for (const doc of docs) {
    const result = await probeDocument(browser, doc.html, resolve(out, doc.id));
    summaries.push({ id: doc.id, sha256: result.sha256, ...result.summary });
    writeFileSync(resolve(out, 'summaries.json'), JSON.stringify(summaries, null, 2) + '\n');
    console.log(JSON.stringify(summaries.at(-1)));
    if (mode === 'dev') {
      if (doc.noInputDifference) assert.equal(result.summary.aspects.inputNumericDifference, 'NOT_VERIFIED', doc.id);
      if (doc.noTerminal) assert.equal(result.summary.aspects.passiveTerminalInterface, 'NOT_VERIFIED', doc.id);
      if (doc.noReset) assert.equal(result.summary.aspects.restartObservedReset, 'NOT_VERIFIED', doc.id);
      assert.equal(result.summary.aspects.ruleWin, 'NOT_VERIFIED');
    }
  }
} finally { await browser.close(); }
