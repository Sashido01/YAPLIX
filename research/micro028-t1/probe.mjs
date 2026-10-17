// Isolated observation experiment. No oracle, fixtures, jobs, storage or LLM imports.
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GAME_CSP, UUID_COMPAT } from '../../src/runtime.ts';
export const LIMITS = Object.freeze({ wallMs: 20000, simulatedMs: 30000, actions: 100, snapshots: 12, jsonBytes: 262144, screenshotBytes: 2097152, traceBytes: 8388608, horizonMs: 6000, seeds: [17, 101, 991], repeats: 2, viewport: { width: 390, height: 844 } });
const URL = 'http://127.0.0.1:3278';
const START = /^(start|play|begin|activate|go|начать(?: игру)?|играть|старт)[!.\s]*$/i;
const RESTART = /restart|retry|play again|try again|заново|ещ[её] раз|повтор|перезапус/i;
const EXCLUDE = /pause|resume|exit|menu|quit|пауза|меню|выход|продолж/i;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function numericRows(snapshot) {
  const result = {}; const occurrences = {};
  for (const [source, rows] of [['dom', snapshot.dom], ['canvas', snapshot.canvas]]) {
    for (const row of rows ?? []) {
      const split = source === 'canvas' ? row.indexOf(':') : -1;
      const text = split >= 0 ? row.slice(split + 1) : row;
      const position = split >= 0 ? row.slice(0, split) + ':' : '';
      const values = text.match(/-?\d+(?:[.,]\d+)?/g);
      if (!values) continue;
      const label = source + ':' + position + text.replace(/-?\d+(?:[.,]\d+)?/g, '#');
      const n = occurrences[label] = (occurrences[label] ?? 0) + 1;
      result[label + ':' + n] = values;
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export function differingNumbers(a, b) {
  const x = numericRows(a), y = numericRows(b);
  return Object.keys(x).filter(k => k in y && JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}
function sameNumbers(a, b) { const x = numericRows(a); return Object.keys(x).length > 0 && JSON.stringify(x) === JSON.stringify(numericRows(b)); }
function semanticSignature(run) {
  return JSON.stringify({ start: run.startUiTransition, samples: run.samples?.map(s => ({ numbers: numericRows(s), terminal: s.terminalInterface, candidate: s.terminalCandidate })), restart: run.restart && { reset: run.restart.reset, response: run.restart.response }, errors: run.gameErrors, status: run.status });
}
export function summarize(runs) {
  const groups = LIMITS.seeds.map(seed => ({ seed, a: runs.filter(r => r.seed === seed && r.arm === 'A'), b: runs.filter(r => r.seed === seed && r.arm === 'B') }));
  const complete = groups.every(g => g.a.length === 2 && g.b.length === 2);
  const repeatable = complete && groups.every(g => semanticSignature(g.a[0]) === semanticSignature(g.a[1]) && semanticSignature(g.b[0]) === semanticSignature(g.b[1]));
  const initialMatched = complete && groups.every(g => g.a.every((r, i) => JSON.stringify(numericRows(r.samples?.[1] ?? {})) === JSON.stringify(numericRows(g.b[i].samples?.[1] ?? {}))));
  const operational = runs.length === 12 && runs.every(r => r.status === 'OBSERVED' && r.clockReady && !r.uncontrolledRandom);
  const deterministic = repeatable && initialMatched && operational;
  const perSeed = groups.map(g => ({ seed: g.seed, inputDifference: g.a.length === 2 && g.b.length === 2 && g.a.every((a, i) => a.observations?.slice(0, 5).some((s, n) => differingNumbers(s, g.b[i].observations?.[n] ?? {}).length > 0)) }));
  const input = deterministic && perSeed.every(s => s.inputDifference);
  const passive = deterministic && groups.every(g => g.a.every(r => r.passiveTerminal));
  const start = deterministic && runs.every(r => r.startUiTransition) && (input || passive);
  const restarted = deterministic && groups.every(g => g.a.every(r => r.restart?.reset && r.restart?.response));
  const criticalException = complete && groups.every(g => g.b.every(r => r.gameErrors?.length)) && repeatable;
  const level = flag => flag ? 'VERIFIED' : 'NOT_VERIFIED';
  return {
    outcome: criticalException ? 'FAILED' : runs.some(r => r.status === 'CHECKER_ERROR') ? 'CHECKER_ERROR' : runs.some(r => r.status === 'PROBE_UNSUPPORTED') ? 'PROBE_UNSUPPORTED' : 'ASPECTS_ONLY',
    determinism: deterministic ? 'CONTROLLED_REPEATABLE' : 'NON_DETERMINISTIC', repeatable, initialMatched, perSeed,
    aspects: { startUiTransition: level(start), inputNumericDifference: level(input), numericTokenObserved: level(runs.some(r => r.samples?.some(s => Object.keys(numericRows(s)).length))), numericTokenChanged: level(runs.some(r => r.samples?.slice(1).some(s => differingNumbers(r.samples[1], s).length))), passiveTerminalInterface: level(passive), restartObservedReset: level(restarted), gameplayProgress: 'NOT_VERIFIED', ruleWin: 'NOT_VERIFIED', ruleLoss: 'NOT_VERIFIED', fullRestart: 'NOT_VERIFIED' },
    reasons: { start: start ? 'Candidate UI transition corroborated by controlled activity.' : 'No common observable Start transition corroborated across all controlled runs.', input: input ? 'Matched seeded A/B rendered numeric difference, repeated for all three seeds.' : deterministic ? 'No rendered numeric A/B difference common to all three seeds in the action budget.' : 'NON_DETERMINISTIC_OR_INCOMPLETE: causal conclusion withheld.', passive: passive ? 'Stable terminal interface without gameplay input.' : 'No stable terminal interface established within the bounded passive observation.', restart: restarted ? 'Available numeric fields reset and next real action differed from passive initial baseline.' : 'No common observed terminal -> numeric reset -> subsequent input response proof.', presumedMetric: 'UNESTABLISHED: labels and numeric tokens are diagnostic candidates, not rule metrics.' },
    limitations: ['Numeric differences describe rendered text, not rule correctness.', 'No pixel equality or event can certify win/loss.', 'Observed reset covers available numeric text and one subsequent action only.', 'Math.random and clock are test conditions; crypto randomness, rendering gaps and physical devices are not controlled.'],
    wallMs: runs.reduce((n, r) => n + r.wallMs, 0), actions: runs.reduce((n, r) => n + r.actions.length, 0), maxArmWallMs: Math.max(...runs.map(r => r.wallMs)), hudSources: [...new Set(runs.flatMap(r => r.samples?.flatMap(s => { const keys = Object.keys(numericRows(s)); return [keys.some(k => k.startsWith('dom:')) ? 'DOM' : null, keys.some(k => k.startsWith('canvas:')) ? 'Canvas' : null].filter(Boolean); }) ?? []))],
  };
}
export async function launchBrowser() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.local/playwright');
  mkdirSync('.local/tmp', { recursive: true });
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) process.env[k] = resolve('.local/tmp');
  const { chromium } = await import('playwright-core');
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'DISPLAY', 'LANG'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  if (process.platform === 'linux') {
    const helper = process.env.CHROME_DEVEL_SANDBOX ?? '/opt/google/chrome/chrome-sandbox';
    if (existsSync(helper)) { const s = statSync(helper); if (!s.isFile() || s.uid !== 0 || !(s.mode & 0o4000) || s.mode & 0o022) throw Error('BROWSER_SANDBOX_CONFIGURATION'); env.CHROME_DEVEL_SANDBOX = helper; }
  }
  return chromium.launch({ channel: 'chromium', chromiumSandbox: true, headless: true, env, timeout: 8000 });
}
// Only test-context interception. Never inserted into an exported document.
function installObservation({ seed, seedRandom }) {
  let state = seed >>> 0;
  if (seedRandom) Math.random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
  const data = { canvases: new Map(), clockReady: Date.isFake === true, calls: 0, capped: false, canvasOrdinal: 0 };
  Object.defineProperty(window, '__yaplixT1Lab', { value: data });
  for (const name of ['fillText', 'strokeText']) {
    const original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (text, x, y, ...rest) {
      let item = data.canvases.get(this.canvas);
      if (!item && data.canvases.size < 4) { item = { index: data.canvasOrdinal++, text: new Map() }; data.canvases.set(this.canvas, item); }
      if (item) { const key = String(x) + ',' + String(y); if (item.text.has(key) || item.text.size < 64) item.text.set(key, String(text).slice(0, 180)); else data.capped = true; }
      data.calls = Math.min(1000000, data.calls + 1);
      return original.call(this, text, x, y, ...rest);
    };
  }
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
    if (x <= 0 && y <= 0 && w >= this.canvas.width && h >= this.canvas.height) data.canvases.get(this.canvas)?.text.clear();
    return clear.call(this, x, y, w, h);
  };
}
async function snapshot(frame) {
  return frame.evaluate(() => {
    const visible = e => { const b = e.getBoundingClientRect(), s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0; };
    const dom = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && dom.length < 128) {
      const p = node.parentElement, text = node.textContent.trim();
      if (p && text && !p.closest('script,style,button,nav,[role=button]') && visible(p)) dom.push(text.slice(0, 180));
    }
    for (const e of [...document.querySelectorAll('[aria-valuenow],progress,meter,output[value]')].slice(0, 16)) if (visible(e)) dom.push((e.getAttribute('aria-label') ?? e.tagName) + ': ' + (e.getAttribute('aria-valuenow') ?? e.getAttribute('value')));
    const data = window.__yaplixT1Lab;
    const canvas = data ? [...data.canvases].filter(([el]) => visible(el)).flatMap(([, v]) => [...v.text].map(([at, text]) => v.index + '@' + at + ':' + text)).slice(0, 128) : [];
    const buttons = [...document.querySelectorAll('button,[role=button],input[type=button]')].filter(visible).map(e => ({ label: (e.getAttribute('aria-label') ?? e.textContent ?? e.value ?? '').trim().slice(0, 100), enabled: !e.disabled }));
    const c = [...document.querySelectorAll('canvas')].find(visible), b = c?.getBoundingClientRect();
    const covered = !!c && b.y >= 0 && b.y + b.height / 2 < innerHeight && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) !== c;
    const terminalCandidate = [...dom, ...canvas.map(t => t.slice(t.indexOf(':') + 1))].find(t => /^(?:game over[!.]?|you (?:win|lose)[!.]?|won|lost|победа[!.].*|поражение[!.]?.*|вы проиграли[!.]?.*)$/i.test(t.trim())) ?? null;
    const restart = buttons.some(b => b.enabled && /restart|retry|play again|try again|заново|ещ[её] раз|повтор|перезапус/i.test(b.label));
    const active = buttons.filter(b => b.enabled && !/start|play|begin|restart|retry|заново|повтор|начать|старт|pause|menu|пауза|меню/i.test(b.label));
    return { dom, canvas, buttons, covered, terminalCandidate, terminalInterface: !!terminalCandidate && restart && (covered || active.length === 0), clockReady: data?.clockReady ?? false, instrumentationCapped: data?.capped ?? true, drawCalls: data?.calls ?? 0 };
  });
}
async function candidate(frame, mode) {
  const elements = frame.locator('button,[role=button],input[type=button]'); const found = [];
  for (let i = 0, n = Math.min(32, await elements.count()); i < n; i++) {
    const el = elements.nth(i); if (!await el.isVisible() || !await el.isEnabled()) continue;
    const label = ((await el.getAttribute('aria-label')) ?? (await el.textContent()) ?? '').trim();
    if (mode === 'restart' ? RESTART.test(label) : mode === 'start' ? START.test(label) : !START.test(label) && !RESTART.test(label) && !EXCLUDE.test(label)) found.push({ index: i, label });
  }
  if (mode === 'start' && found.length === 0) {
    const visible = await elements.filter({ visible: true }).count();
    if (visible === 1 && await frame.locator('canvas:visible').count()) {
      for (let i = 0; i < await elements.count(); i++) if (await elements.nth(i).isVisible() && await elements.nth(i).isEnabled()) { const label = (await elements.nth(i).textContent() ?? '').trim(); if (!RESTART.test(label) && !EXCLUDE.test(label)) return { index: i, label, reason: 'single visible initial button beside game surface; unconfirmed until independent activity' }; }
    }
  }
  return mode === 'input' ? found : found.length === 1 ? found[0] : null;
}
async function pressCandidate(frame, item) { await frame.locator('button,[role=button],input[type=button]').nth(item.index).tap({ timeout: 650 }); }
async function genericInput(page, frame, step, actions) {
  const choices = await candidate(frame, 'input');
  if (choices.length && step % 2 === 0) { const pick = choices[Math.floor(step / 2) % choices.length]; await pressCandidate(frame, pick); actions.push({ type: 'tap', label: pick.label }); }
  const key = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'Space'][step % 12];
  await page.keyboard.down(key); actions.push({ type: 'keyDown', key });
  return key;
}
export async function runArm(browser, html, { seed, arm, virtual = true, seedRandom = true, evidenceDir = null, trace = false, hostMode = 'document' }) {
  const began = performance.now(), actions = [], samples = [], gameErrors = [], errors = [], events = [];
  const result = { seed, arm, actions, samples, observations: [], gameErrors, errors, events, status: 'OBSERVED', startUiTransition: false, clockReady: false, uncontrolledRandom: /crypto\s*\.\s*getRandomValues/.test(html) };
  const context = await browser.newContext({ viewport: LIMITS.viewport, hasTouch: true, isMobile: true, offline: true, serviceWorkers: 'block', acceptDownloads: false });
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; void context.close().catch(() => {}); }, LIMITS.wallMs);
  let simulated = 0;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(1000); page.setDefaultNavigationTimeout(3000);
    page.on('pageerror', e => { if (/\/document:\d|about:srcdoc:\d/.test(e.stack ?? '')) { if (gameErrors.length < 4) gameErrors.push(e.message.slice(0, 250)); } else { if (errors.length < 4) errors.push('UNATTRIBUTED_EXCEPTION: ' + e.message.slice(0, 250)); result.status = 'CHECKER_ERROR'; } });
    page.on('dialog', d => void d.dismiss());
    context.on('page', p => { if (p !== page) void p.close(); });
    if (virtual) { await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') }); await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z')); }
    await context.addInitScript(installObservation, { seed, seedRandom });
    const content = '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '"><script>' + UUID_COMPAT + '</script>' + html;
    const escaped = content.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const host = '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" ' + (hostMode === 'srcdoc' ? 'srcdoc="' + escaped + '"' : 'src="/document"') + '></iframe>';
    await context.route('**/*', r => r.request().url() === URL + '/host' ? r.fulfill({ contentType: 'text/html', body: host }) : hostMode === 'document' && r.request().url() === URL + '/document' ? r.fulfill({ contentType: 'text/html', body: content }) : r.abort());
    if (trace && evidenceDir) await context.tracing.start({ screenshots: false, snapshots: true, sources: false });
    await page.goto(URL + '/host');
    const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
    if (!frame) throw Error('FRAME_MISSING');
    await frame.waitForURL(hostMode === 'srcdoc' ? 'about:srcdoc' : '**/document');
    await page.evaluate(() => { window.__t1Events = []; addEventListener('message', e => { if (e.source === document.querySelector('iframe').contentWindow && e.data?.channel === 'yaplix' && e.data.event?.protocolVersion === 1 && window.__t1Events.length < 64) window.__t1Events.push({ type: String(e.data.event.type).slice(0, 40), sequence: e.data.event.sequence }); }); });
    await page.locator('iframe').evaluate(n => n.contentWindow.postMessage({ channel: 'yaplix_init', protocolVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' }, '*'));
    const tick = async ms => { simulated += ms; if (simulated > LIMITS.simulatedMs) throw Error('SIMULATION_BUDGET'); if (virtual) await page.clock.runFor(ms); else await page.waitForTimeout(ms); };
    samples.push(await snapshot(frame));
    result.clockReady = !virtual || samples[0].clockReady;
    const start = await candidate(frame, 'start'); result.startCandidate = start; result.startReason = start ? 'Accessible candidate; transition still requires corroboration.' : 'NO_UNAMBIGUOUS_ACCESSIBLE_START';
    if (start) { await pressCandidate(frame, start); actions.push({ type: 'start', label: start.label }); }
    samples.push(await snapshot(frame));
    result.startUiTransition = !!start && !samples[1].buttons.some(b => b.label === start.label && b.enabled) && (samples[0].covered || samples[0].buttons.length !== samples[1].buttons.length || JSON.stringify(samples[0].dom) !== JSON.stringify(samples[1].dom));
    await tick(32); const baseline = await snapshot(frame); samples.push(baseline);
    for (let i = 0; i < 12; i++) {
      let key;
      if (arm === 'B' && start && !samples.at(-1).terminalInterface) key = await genericInput(page, frame, i, actions);
      await tick(400);
      if (key) { await page.keyboard.up(key); actions.push({ type: 'keyUp', key }); }
      if ((i + 1) % 3 === 0) { const s = await snapshot(frame); samples.push(s); result.observations.push(s); }
    }
    await tick(1200); samples.push(await snapshot(frame));
    await tick(250); samples.push(await snapshot(frame));
    result.observations.push(...samples.slice(-2));
    result.passiveTerminal = samples.at(-1).terminalInterface && samples.at(-2).terminalInterface && sameNumbers(samples.at(-1), samples.at(-2));
    if (start && samples.at(-1).terminalInterface && samples.at(-2).terminalInterface && sameNumbers(samples.at(-1), samples.at(-2))) {
      const restart = await candidate(frame, 'restart');
      if (restart) {
        await pressCandidate(frame, restart); actions.push({ type: 'restart', label: restart.label });
        const reset = await snapshot(frame); samples.push(reset);
        const key = await genericInput(page, frame, 0, actions); await tick(32); await page.keyboard.up(key); actions.push({ type: 'keyUp', key });
        const after = await snapshot(frame); samples.push(after);
        result.restart = { reset: !reset.terminalInterface && sameNumbers(samples[1], reset), response: differingNumbers(reset, after).length > 0 && differingNumbers(baseline, after).length > 0, caution: 'Only observed numeric fields at reset and an action at the same 32ms clock offset as the passive initial baseline; no full world reset proof.' };
      }
    }
    events.push(...await page.evaluate(() => window.__t1Events));
    result.passiveObservation = {
      activity: result.observations.some((s, i) => i > 0 && (differingNumbers(result.observations[0], s).length > 0 || s.drawCalls > result.observations[0].drawCalls)),
      visibleLossLabel: result.observations.some(s => /lose|lost|поражен|проиграл/i.test(s.terminalCandidate ?? '')),
      lossEventObserved: events.some(e => e.type === 'game_lost'),
      eventOrder: events.map(e => e.type),
      ruleLoss: 'NOT_VERIFIED',
      note: arm === 'A' ? 'No gameplay input before terminal observation; bounded absence of loss proves no defect.' : 'Intervention arm, not passive-loss evidence.',
    };
    if (virtual && !result.clockReady) result.status = 'PROBE_UNSUPPORTED';
    if (samples.some(s => s.instrumentationCapped)) { result.observationCap = true; result.status = 'PROBE_UNSUPPORTED'; }
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      const png = await page.screenshot({ animations: 'disabled', timeout: 1000 });
      if (png.length <= LIMITS.screenshotBytes) writeFileSync(resolve(evidenceDir, 'final.png'), png); else result.screenshotBudget = 'BUDGET_LIMIT';
      if (trace) { const path = resolve(evidenceDir, 'browser.zip'); await context.tracing.stop({ path }); if (statSync(path).size > LIMITS.traceBytes) { unlinkSync(path); result.traceBudget = 'BUDGET_LIMIT_DISCARDED'; } }
    }
  } catch (e) {
    errors.push(String(e).replace(/\u001b\[[\d;]*m/g, '').slice(0, 400));
    result.status = timedOut ? 'PROBE_UNSUPPORTED' : e?.name === 'TimeoutError' ? 'PROBE_UNSUPPORTED' : 'CHECKER_ERROR';
    if (timedOut) result.budgetReason = 'WALL_BUDGET_LIMIT';
  } finally { clearTimeout(timer); await context.close().catch(() => {}); }
  result.wallMs = Math.round(performance.now() - began); result.simulatedMs = simulated;
  if (actions.length > LIMITS.actions || samples.length > LIMITS.snapshots) result.status = 'CHECKER_ERROR';
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > LIMITS.jsonBytes) return { ...result, samples: [], status: 'PROBE_UNSUPPORTED', budgetReason: 'LOG_BUDGET_LIMIT' };
  return result;
}
export async function probeDocument(browser, html, evidenceDir) {
  const runs = [];
  for (const seed of LIMITS.seeds) for (let repeat = 0; repeat < LIMITS.repeats; repeat++) for (const arm of ['A', 'B']) {
    const run = await runArm(browser, html, { seed, arm, evidenceDir: seed === LIMITS.seeds[0] && repeat === 0 ? resolve(evidenceDir, arm) : null, trace: seed === LIMITS.seeds[0] && repeat === 0 });
    runs.push({ ...run, repeat });
  }
  const result = { sha256: sha256(html), limits: LIMITS, summary: summarize(runs), runs };
  mkdirSync(evidenceDir, { recursive: true }); writeFileSync(resolve(evidenceDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
export function readDocument(file) { return readFileSync(file, 'utf8'); }
