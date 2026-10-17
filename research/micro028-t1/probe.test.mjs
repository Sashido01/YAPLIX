import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { numericRows, differingNumbers, summarize, LIMITS } from './probe.mjs';
const snap = n => ({ dom: ['Count: ' + n], canvas: [], terminalInterface: false, terminalCandidate: null });
const dataset = ({ input = true, unstable = false, errors = [], uncontrolledRandom = false } = {}) => LIMITS.seeds.flatMap(seed => [0, 1].flatMap(repeat => ['A', 'B'].map(arm => ({ seed, repeat, arm, status: 'OBSERVED', startUiTransition: true, clockReady: true, uncontrolledRandom, gameErrors: errors, errors: [], actions: [{ type: 'start' }], samples: [snap(0), snap(0), snap(arm === 'B' && input ? (unstable && repeat ? 2 : 1) : 0)], observations: [snap(arm === 'B' && input ? 1 : 0)], wallMs: 1 }))));
test('Canvas coordinates are metadata, never numeric HUD tokens', () => {
  assert.deepEqual(numericRows({ dom: [], canvas: ['0@10,20:Hello'] }), {});
  assert.deepEqual(Object.values(numericRows({ dom: [], canvas: ['0@10,20:Score 7'] })), [['7']]);
});
test('Idle/autonomous number changes cannot establish input A/B difference', () => {
  const r = dataset({ input: false }); r.forEach(x => { x.observations = [snap(20)]; });
  assert.equal(summarize(r).aspects.inputNumericDifference, 'NOT_VERIFIED');
});
test('Same seed repeat and matched initial conditions gate causal statements', () => {
  assert.equal(summarize(dataset()).aspects.inputNumericDifference, 'VERIFIED');
  assert.equal(summarize(dataset({ unstable: true })).aspects.inputNumericDifference, 'NOT_VERIFIED');
  const mismatched = dataset(); mismatched[1].samples[1] = snap(99);
  assert.equal(summarize(mismatched).aspects.inputNumericDifference, 'NOT_VERIFIED');
  assert.equal(summarize(dataset({ uncontrolledRandom: true })).determinism, 'NON_DETERMINISTIC');
});
test('Missing observations, unsupported instrumentation and tool errors fail closed', () => {
  assert.equal(summarize(dataset().slice(1)).aspects.inputNumericDifference, 'NOT_VERIFIED');
  const r = dataset(); r[0].status = 'PROBE_UNSUPPORTED';
  assert.equal(summarize(r).outcome, 'PROBE_UNSUPPORTED');
  r[0].status = 'CHECKER_ERROR'; assert.equal(summarize(r).outcome, 'CHECKER_ERROR');
});
test('Lying win events and HUD alone never certify T2 or full reset', () => {
  const r = dataset(); r.forEach(x => { x.events = [{ type: 'game_won' }]; x.samples[2].terminalCandidate = 'You win!'; });
  const s = summarize(r);
  for (const a of ['ruleWin', 'ruleLoss', 'gameplayProgress', 'fullRestart', 'restartObservedReset', 'passiveTerminalInterface']) assert.equal(s.aspects[a], 'NOT_VERIFIED');
});
test('Only reproducible attributed critical exceptions yield FAILED', () => {
  assert.equal(summarize(dataset({ errors: ['Critical callback error'] })).outcome, 'FAILED');
  const r = dataset(); r[1].gameErrors = ['one error'];
  assert.notEqual(summarize(r).outcome, 'FAILED');
});
test('Changing a number is distinct from assigning a metric or proving progress', () => {
  assert.equal(differingNumbers(snap(1), snap(2)).length, 1);
  assert.equal(summarize(dataset()).aspects.gameplayProgress, 'NOT_VERIFIED');
});
test('Probe has no oracle, fixture catalog, provider, production checker or storage dependency', () => {
  const source = readFileSync(new URL('./probe.mjs', import.meta.url), 'utf8');
  assert(!/from\s+['"][^'"]*(?:oracle|fixture|live|store|validation|full-html-check)|fetch\s*\(|\.request\.post|DatabaseSync/.test(source));
  assert(!/allow-same-origin|--no-sandbox/.test(source));
});
