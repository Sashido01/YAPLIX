import { mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { Frame, Page } from 'playwright-core';
import { PROJECT_ROOT } from '../store.ts';
import type { GameplayReport, GameplayRules, SequenceStep } from './gameplay-check.ts';
import { progressOf, resolveGoal, proveWin, snakeStep } from './rules-probe.ts';
import type { Goal, PlayerAction, ProbeEvent, Sample, SnakePalette } from './rules-probe.ts';

export interface GridGeometry {
  cols: number; rows: number; cell: number; logicalWidth: number; logicalHeight: number;
}
export interface VisualGrid extends GridGeometry {
  palette: SnakePalette;
}
export interface RulesProbeOptions {
  grid?: GridGeometry;
  /** Explicit supported visual adapter, calibrated from the rendered artifact. */
  snake?: VisualGrid;
  /** Real game controls only. No test controls or forced outcomes. */
  sequence?: SequenceStep[];
  maxActions?: number;
  /** Lack of progress is a probe limitation, not proof of impossibility. */
  stallMs?: number;
  evidenceDir?: string;
}
export interface RulesEvidence {
  goal: Goal | null; goalReason: string; rules: GameplayRules;
  actions: PlayerAction[]; samples: Sample[]; stopReason: string;
  elapsedMs: number; startedAt: string; restart: { level: string; detail: string };
  screenshots: string[];
}

export async function runRulesGameplay(
  page: Page, frame: () => Frame, readEvents: () => Promise<ProbeEvent[]>,
  rules: GameplayRules, options: RulesProbeOptions, remaining: () => number, errors: string[],
): Promise<GameplayReport> {
  const begin = Date.now(), startedAt = new Date().toISOString();
  const actions: PlayerAction[] = [{ ms: 0, kind: 'start', value: 'Start' }];
  const samples: Sample[] = [], screenshots: string[] = [];
  const maxActions = Math.min(1000, Math.max(1, options.maxActions ?? 400));
  const stallMs = Math.min(30000, Math.max(500, options.stallMs ?? 8000));
  let goal: Goal | null = null, goalReason = '', stopReason = 'time budget';
  let paused = false, lastChange = Date.now(), previousPixels = '', previousProgress: number | null = null;
  let evidenceDir: string | null = null;
  if (options.evidenceDir) {
    const root = resolve(PROJECT_ROOT, '.local'), dir = resolve(options.evidenceDir), rel = relative(root, dir);
    if (rel.startsWith('..') || isAbsolute(rel) || !rel) throw new Error('Evidence directory must be inside repository .local');
    evidenceDir = dir; mkdirSync(dir, { recursive: true });
  }
  const log = (kind: PlayerAction['kind'], value: string) => actions.push({ ms: Date.now() - begin, kind, value });
  const screenshot = async (name: string) => {
    if (evidenceDir && remaining() > 100) { const path = resolve(evidenceDir, name + '.png'); await page.screenshot({ path, timeout: Math.min(2000, remaining()) }); screenshots.push(path); }
  };
  const readView = () => frame().evaluate(profile => {
      let hud: Record<string, unknown> = {};
      try { hud = JSON.parse(document.querySelector('output[data-yaplix-state]')?.textContent ?? '{}'); } catch { /* unsupported HUD */ }
      const overlay = document.querySelector<HTMLElement>('#yapOverlay');
      const result = document.querySelector<HTMLElement>('#yapResult');
      const rendered = (el: HTMLElement | null) => {
        if (!el) return false;
        for (let node: HTMLElement | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (node.hidden || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
        const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
        return hit === el || !!hit && el.contains(hit);
      };
      const visible = rendered(overlay) && rendered(result);
      const terminal = { visible, text: document.querySelector('#yapResult')?.textContent ?? '', score: document.querySelector('#yapResultScore')?.textContent ?? '' };
      let pixels: string[] | undefined;
      const canvas = document.querySelector('canvas');
      if (profile && canvas) {
        const ctx = canvas.getContext('2d')!;
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        pixels = [];
        for (let y = 0; y < profile.rows; y++) for (let x = 0; x < profile.cols; x++) {
          const px = Math.min(canvas.width - 1, Math.floor((x + .5) * profile.cell / profile.logicalWidth * canvas.width));
          const py = Math.min(canvas.height - 1, Math.floor((y + .5) * profile.cell / profile.logicalHeight * canvas.height));
          const i = (py * canvas.width + px) * 4;
          pixels.push('#' + [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!].map(v => v.toString(16).padStart(2, '0')).join(''));
        }
      }
      return { hud, terminal, pixels };
    }, options.snake ?? options.grid ?? null);
  const observe = async (): Promise<Sample> => {
    if (samples.length >= 2048) return samples.at(-1)!;
    const view = await readView();
    const resolution = resolveGoal(rules, view.hud);
    if (goal && (!resolution.goal || resolution.goal.metric !== goal.metric || resolution.goal.target !== goal.target)) {
      errors.push('GOAL_CHANGED_DURING_RUN');
    }
    if (!goal) { goal = resolution.goal; goalReason = resolution.reason; }
    const sample: Sample = { ms: Date.now() - begin, actions: actions.length, ...view, progress: goal ? progressOf(view.hud, goal.metric) : null, events: await readEvents() };
    if (sample.events.some(e => e.type === 'game_error') && !errors.includes('GAME_ERROR')) errors.push('GAME_ERROR');
    const previous = samples.at(-1);
    if (options.snake && previous?.pixels && sample.pixels) {
      const oldApple = previous.pixels.indexOf(options.snake.palette.apple);
      const newHead = sample.pixels.indexOf(options.snake.palette.head);
      sample.contacts = (previous.contacts ?? 0) + (oldApple >= 0 && newHead === oldApple && previous.pixels.indexOf(options.snake.palette.head) !== newHead ? 1 : 0);
    } else if (options.snake) sample.contacts = 0;
    samples.push(sample);
    const pixels = JSON.stringify(view.pixels ?? view.hud);
    if (pixels !== previousPixels || sample.progress !== previousProgress) { lastChange = Date.now(); previousPixels = pixels; previousProgress = sample.progress; }
    return sample;
  };
  const terminalPending = async () => (await readEvents()).some(e => ['game_won', 'game_lost', 'session_ended'].includes(e.type));
  const pause = async (value: boolean) => {
    if (paused === value || actions.length >= maxActions || remaining() < 200) return;
    if (await terminalPending()) return;
    try { await frame().locator('[data-yaplix-pause]').click({ timeout: Math.min(1500, remaining()) }); }
    catch (error) { if (await terminalPending()) return; throw error; }
    paused = value; log('button', value ? 'pause' : 'continue');
  };
  const control = async (value: string) => {
    if (actions.length >= maxActions || remaining() < 200) return;
    if (await terminalPending()) return;
    const button = frame().locator('[data-yaplix-action="' + value + '"]');
    if (await button.count() !== 1 || !await button.isVisible()) { stopReason = 'unsupported or missing real control: ' + value; return; }
    try { await button.click({ timeout: Math.min(1500, remaining()) }); log('button', value); }
    catch (error) {
      // The game can finish while Playwright checks actionability. A real
      // terminal overlay cancels the pending input; proof is still evaluated
      // from goal/progress/screen below. Never force a click through it.
      if (!await terminalPending()) throw error;
    }
  };
  let current = await observe();
  // Initial HUD can legitimately be written on the first rAF after Start.
  if (!goal && remaining() > 250) { await page.waitForTimeout(180); current = await observe(); }
  // Observe a no-input interval. Autonomous score changes cannot establish
  // that the subsequent input caused progress in the generic adapter.
  const baselineProgress = current.progress;
  if (remaining() > 600) { await page.waitForTimeout(350); current = await observe(); }
  const autonomousProgress = baselineProgress !== null && current.progress !== baselineProgress;
  await screenshot('start');
  const sequence = options.sequence ?? ['left', 'right', 'drop', 'hurry'];
  let index = 0, picturedProgress = current.progress ?? 0;
  while (remaining() > 700 && actions.length < maxActions && samples.length < 2048) {
    if (current.terminal.visible || current.events.some(e => ['game_won', 'game_lost', 'session_ended'].includes(e.type))) { stopReason = 'terminal observed'; break; }
    if (errors.length) { stopReason = 'browser error'; break; }
    if (Date.now() - lastChange > stallMs) { stopReason = 'observation stalled within bounded probe'; break; }
    if (options.snake && current.pixels) {
      await pause(true);
      current = await observe();
      if (current.terminal.visible || await terminalPending()) { stopReason = 'terminal observed'; break; }
      const key = snakeStep({ ...options.snake, cells: current.pixels! }, options.snake.palette);
      if (!key) { stopReason = 'no observable safe path to a single visible collectible'; break; }
      // Fire is a normal gameplay action; this adapter can only use it when the
      // artifact actually exposes the visible control. No injected callbacks.
      if (await frame().locator('[data-yaplix-action="fire"]').count() === 1) await control('fire');
      if (actions.length >= maxActions || remaining() < 400) break;
      const oldHead = current.pixels!.indexOf(options.snake.palette.head);
      await page.keyboard.down(key); log('key', key);
      await pause(false);
      const stepEnd = Date.now() + Math.min(700, remaining() - 250);
      try {
        do {
          await page.waitForTimeout(18);
          current = await observe();
        } while (!current.terminal.visible && current.pixels?.indexOf(options.snake.palette.head) === oldHead && Date.now() < stepEnd);
      } finally { await page.keyboard.up(key); }
      if (!current.terminal.visible) await pause(true);
      current = await observe();
    } else {
      const step = sequence[index++ % sequence.length];
      if (step === 'hurry') { log('wait', '250ms'); await page.waitForTimeout(Math.min(250, remaining())); }
      else if (['left', 'right', 'up', 'down'].includes(step!)) {
        const key = 'Arrow' + step![0]!.toUpperCase() + step!.slice(1);
        await page.keyboard.press(key); log('key', key);
      } else {
        const action = step === 'fire' ? 'fire' : step === 'rotate' ? 'rotate' : await frame().locator('[data-yaplix-action="drop"]').count() === 1 ? 'drop' : 'space';
        await control(action);
      }
      await page.waitForTimeout(Math.min(100, remaining()));
      current = await observe();
    }
    if (current.progress !== null && current.progress > picturedProgress) {
      await screenshot('progress-' + current.progress); picturedProgress = current.progress;
    }
  }
  if (actions.length >= maxActions) stopReason = 'action budget';
  else if (samples.length >= 2048) stopReason = 'observation budget';
  // A terminal event can arrive one render before its visible overlay. After
  // settling, collect two consecutive visible confirmations so a delayed
  // overlay is not left NOT_VERIFIED after an otherwise complete real play.
  if (paused && !current.terminal.visible) await pause(false);
  if (remaining() > 350) {
    await page.waitForTimeout(300);
    let terminalConfirmations = 0;
    for (let i = 0; i < 4 && remaining() > 150 && terminalConfirmations < 2; i++) {
      current = await observe();
      const ended = current.events.some(e => e.type === 'game_won' || e.type === 'session_ended');
      terminalConfirmations = current.terminal.visible && ended ? terminalConfirmations + 1 : 0;
      if (terminalConfirmations < 2 && remaining() > 150) await page.waitForTimeout(100);
    }
  }
  await screenshot('final');
  const proof = proveWin(goal, samples, actions, errors);
  if (proof.level === 'VERIFIED' && samples.length >= 2048) { proof.level = 'NOT_VERIFIED'; proof.reason = 'observation budget exhausted before final corroboration'; }
  if (proof.level === 'VERIFIED' && autonomousProgress && !options.snake) { proof.level = 'NOT_VERIFIED'; proof.reason = 'autonomous baseline progress; generic input attribution is unproven'; }
  let restart = { level: 'NOT_VERIFIED', detail: 'no completed session / insufficient budget' };
  const endEvents = current.events;
  const won = endEvents.some(e => e.type === 'game_won'), lost = endEvents.some(e => e.type === 'game_lost');
  const inputChanged = samples.some(s => s.progress !== samples[0]?.progress || JSON.stringify(s.pixels ?? s.hud) !== JSON.stringify(samples[0]?.pixels ?? samples[0]?.hud));
  const initialProgress = samples.find(s => s.progress !== null)?.progress;
  // Reserve separate bounded time for restart; run-local evidence above is
  // sealed before reload. A second game can never donate progress to the first.
  if (current.terminal.visible && endEvents.some(e => e.type === 'session_ended') && remaining() > 2500 && actions.length + 3 < maxActions) {
    try {
      const before = (await readEvents()).length;
      await frame().locator('[data-yaplix-restart]').click(); log('restart', 'Restart');
      await page.waitForFunction(n => (window as any).checkEvents.slice(n).some((e: ProbeEvent) => e.type === 'game_ready'), before, { timeout: Math.min(1800, remaining()) });
      await frame().locator('[data-yaplix-start]').click(); log('start', 'Start after restart');
      await page.waitForTimeout(180);
      const finalGoal = goal as Goal | null;
      let freshView = await readView();
      let reset = finalGoal ? progressOf(freshView.hud, finalGoal.metric) : null;
      const hudDeadline = Date.now() + Math.min(700, remaining());
      while (reset === null && Date.now() < hudDeadline) {
        await page.waitForTimeout(40); freshView = await readView();
        reset = finalGoal ? progressOf(freshView.hud, finalGoal.metric) : null;
      }
      const evs = (await readEvents()).slice(before);
      const playable = evs.some(e => e.type === 'game_started') && !evs.some(e => ['game_won', 'game_lost', 'session_ended'].includes(e.type)) && reset === samples.find(s => s.progress !== null)?.progress;
      // Exercise a real action in the new realm too.
      const beforeInput = await frame().evaluate(() => document.querySelector('canvas')?.toDataURL() ?? '');
      const freshKey = options.snake && freshView.pixels ? snakeStep({ ...options.snake, cells: freshView.pixels }, options.snake.palette) : 'ArrowRight';
      if (!freshKey) throw new Error('No observable safe restart action');
      await page.keyboard.down(freshKey); log('key', freshKey + ' after restart');
      await page.waitForTimeout(220);
      await page.keyboard.up(freshKey);
      const afterInput = await frame().evaluate(() => document.querySelector('canvas')?.toDataURL() ?? '');
      const stillPlaying = !(await readEvents()).slice(before).some(e => ['game_won', 'game_lost', 'session_ended'].includes(e.type));
      restart = { level: playable && beforeInput !== afterInput && stillPlaying && errors.length === 0 ? 'VERIFIED' : 'NOT_VERIFIED', detail: 'fresh run: ' + JSON.stringify({ playable, reset, baseline: samples.find(s => s.progress !== null)?.progress, renderedChange: beforeInput !== afterInput, stillPlaying }) };
      await screenshot('restart');
    } catch { restart = { level: 'FAILED', detail: 'restart did not produce fresh ready/start/reset progress' }; }
  }
  const evidence: RulesEvidence = { goal, goalReason, rules, actions, samples, stopReason, elapsedMs: Date.now() - begin, startedAt, restart, screenshots };
  return {
    aspects: [
      { aspect: 'html-runs', level: errors.length ? 'FAILED' : 'VERIFIED' },
      { aspect: 'input-works', level: inputChanged && (!autonomousProgress || !!options.snake) ? 'VERIFIED' : 'NOT_VERIFIED' },
      { aspect: 'gameplay-observed', level: samples.some(s => s.progress !== null && initialProgress !== undefined && s.progress !== initialProgress) ? 'VERIFIED' : 'NOT_VERIFIED' },
      { aspect: 'win-reachable', level: proof.level, detail: proof.reason },
      { aspect: 'loss-reachable', level: lost && current.terminal.visible && /^game over$/i.test(current.terminal.text.trim()) && endEvents.some(e => e.type === 'session_ended') ? 'VERIFIED' : 'NOT_VERIFIED', detail: 'observed loss screen/end only; causal loss rule not independently verified' },
      { aspect: 'restart-works', level: restart.level as 'VERIFIED' | 'FAILED' | 'NOT_VERIFIED', detail: restart.detail },
    ],
    events: endEvents.map(e => e.type), finalScore: endEvents.filter(e => e.type === 'score_changed').at(-1)?.data?.score ?? null,
    notes: [stopReason, ...errors, ...(won && proof.level !== 'VERIFIED' ? [proof.reason] : [])], evidence,
  };
}
