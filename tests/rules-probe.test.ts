import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoal, progressOf, proveWin, snakeStep } from '../src/orchestrator/rules-probe.ts';
import type { Sample, PlayerAction } from '../src/orchestrator/rules-probe.ts';

const rules = (win: string, objective = 'for example 999 items') => ({ win, objective, loss: 'lose at 0 lives' });
test('rules probe: resolves arbitrary numeric targets without mining examples/loss', () => {
  for (const n of [3, 17, 647]) {
    assert.deepEqual(resolveGoal(rules(`collect ${n} apples`), {}).goal, { metric: 'items', target: n, source: 'rules.win' });
    assert.equal(resolveGoal(rules(`reach ${n} points`), {}).goal?.target, n);
    assert.equal(resolveGoal(rules(`clear ${n} lines`), {}).goal?.metric, 'lines');
    assert.equal(resolveGoal(rules(`complete ${n} waves`), {}).goal?.metric, 'waves');
  }
  assert.equal(resolveGoal(rules('Собрать целевое число предметов до поражения.'), { collected: '0/7' }).goal?.target, 7);
  assert.equal(resolveGoal(rules('Достичь целевого счёта до поражения.'), { score: 0, target: 371 }).goal?.target, 371);
  assert.equal(resolveGoal(rules('reach target score'), {}).goal, null);
});
test('rules probe: ambiguous, fractional, conflicting and unsupported rules stay unresolved', () => {
  for (const win of ['reach -7 points', 'не набрать 7 очков', 'reach 7 points unless hit', 'reach more than 7 points', 'do not reach 7 points', 'collect fewer than 7 apples', 'collect 3 apples or reach 10 points', 'collect 3 apples and survive', 'reach score 1.5', 'reach 0 points', 'win in 30 seconds', 'reach score 7 if alive', 'reach exactly 7 points', 'collect items, for example 10', 'reach score 1000001', 'be happy', 'clear all lines']) {
    assert.equal(resolveGoal(rules(win), {}).goal, null, win);
  }
  assert.equal(resolveGoal(rules('collect 7 apples'), { collected: '0/6' }).goal, null);
  for (const relation of ['>', '<', '=', '≤', '≥', '≠', '+']) assert.equal(resolveGoal(rules(`reach score ${relation} 7`), {}).goal, null);
  assert.equal(resolveGoal(rules('collect target items'), { target: 7, collected: '0/6' }).goal, null);
  assert.equal(progressOf({ score: 800, collected: '3/7' }, 'items'), 3);
  assert.equal(progressOf({ score: 800 }, 'items'), null);
  assert.equal(progressOf({ apples: 3, collected: '4/7' }, 'items'), null);
});
const action: PlayerAction[] = [{ ms: 0, kind: 'start', value: 'Start' }, { ms: 10, kind: 'key', value: 'ArrowRight' }];
function sample(progress: number, terminal = false, events = ['game_ready', 'game_started', 'score_changed', 'game_won', 'session_ended']): Sample {
  return { ms: progress * 100, actions: progress === 0 ? 1 : 2, hud: { score: progress }, progress,
    events: events.map(type => ({ type, ...(type === 'score_changed' ? { data: { score: progress } } : {}) })),
    terminal: { visible: terminal, text: terminal ? 'You win!' : '', score: `score: ${progress}` } };
}
const goal = { metric: 'score' as const, target: 17, source: 'rules.win' as const };
test('rules probe: requires real actions, progress, threshold and stable completed screen together', () => {
  const samples = [sample(0, false, ['game_ready', 'game_started']), sample(17, true), sample(17, true)];
  assert.equal(proveWin(goal, samples, action, []).level, 'VERIFIED');
  const reloaded = structuredClone(samples); reloaded.at(-1)!.events.unshift({type:'game_ready'},{type:'game_started'});
  assert.equal(proveWin(goal, reloaded, action, []).level, 'FAILED');
  assert.equal(proveWin(goal, samples, [], []).level, 'NOT_VERIFIED');
  assert.equal(proveWin(goal, samples.slice(1), action, []).level, 'NOT_VERIFIED', 'starting at threshold is not progress');
  assert.equal(proveWin(null, samples, action, []).level, 'NOT_VERIFIED');
  assert.equal(proveWin(goal, samples, action, ['JAVASCRIPT_EXCEPTION']).level, 'FAILED');
  const mismatch = structuredClone(samples); mismatch.at(-1)!.terminal.score = 'score: 9';
  assert.equal(proveWin(goal, mismatch, action, []).level, 'NOT_VERIFIED');
});
test('rules probe: false victory, threshold without completion, premature victory, stall and unreachable goal', () => {
  assert.equal(proveWin(goal, [sample(0), sample(0)], action, []).level, 'FAILED', 'false event');
  assert.equal(proveWin(goal, [sample(0, false, []), sample(17, false, ['game_started'])], action, []).level, 'FAILED');
  assert.equal(proveWin(goal, [sample(0), sample(3, true)], action, []).level, 'FAILED');
  assert.equal(proveWin(goal, [sample(0, false, []), sample(0, false, [])], action, []).level, 'NOT_VERIFIED');
  assert.equal(proveWin(goal, [sample(0, false, []), sample(16, false, [])], action, []).level, 'NOT_VERIFIED');
  const items = [sample(0, false, ['game_started']), sample(17, true), sample(17, true)].map(s => ({ ...s, contacts: 0 }));
  assert.equal(proveWin({ ...goal, metric: 'items' }, items, action, []).level, 'NOT_VERIFIED', 'rendered contacts must corroborate collection');
});
test('rules probe: shortest visible path avoids walls, body, enemies and ambiguous fields', () => {
  const palette = { head: 'H', body: 'B', apple: 'A', wall: 'W', enemy: 'E' };
  assert.equal(snakeStep({ cols: 4, rows: 3, cells: ['H','.','.','A','.','W','.','.','.','.','.','.'] }, palette), 'ArrowRight');
  assert.equal(snakeStep({ cols: 3, rows: 2, cells: ['H','W','A','W','W','.'] }, palette), null);
  assert.equal(snakeStep({ cols: 3, rows: 2, cells: ['H','H','A','.','.','.'] }, palette), null);
  assert.equal(snakeStep({ cols: 3, rows: 2, cells: ['H','.','A','.','E','.'] }, palette), null);
});
