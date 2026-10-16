// Offline research runner: no .env, backend, Store, transports or inference.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { buildSync } from 'esbuild';
import type { Frame, Page } from 'playwright-core';
import { compileBlueprint } from '../src/research/constructor/compiler.ts';
import { cleanHouse, fixtures, matchThree } from '../src/research/constructor/fixtures.ts';
import { blueprintSchema } from '../src/research/constructor/blueprint.ts';
import { browserCheck } from '../src/browser-check.ts';

// browser-check configures repository-local browser/temp paths before import.
const { chromium } = await import('playwright-core');

const out = '.local/micro026'; mkdirSync(out, { recursive: true });
const compiled = Object.fromEntries(Object.entries(fixtures).map(([name, b]) => [name, compileBlueprint(b)]));
compiled['house-pixel'] = compileBlueprint({ ...cleanHouse, theme: 'pixel-test' });
writeFileSync(out + '/blueprint.schema.json', JSON.stringify(blueprintSchema, null, 2) + '\n');
for (const [name, c] of Object.entries(compiled)) writeFileSync(out + '/' + name + '.html', c.html);
const bundle = buildSync({ entryPoints: ['src/runtime.ts'], bundle: true, platform: 'browser', format: 'esm', write: false }).outputFiles[0].text;
const counts = { get: 0, post: 0, securityNetwork: 0 }, errors: string[] = [], rows: unknown[] = [];
const server = createServer((req, res) => {
  if (req.method !== 'GET') { counts.post++; res.writeHead(405).end(); return; }
  counts.get++;
  const path = req.url ?? '/';
  if(path==='/security-network'){counts.securityNetwork++;res.end('controlled reachable endpoint');return;}
  if (path === '/runtime.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
  const name = path.split('/')[2], artifact = compiled[name];
  if (!artifact) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (path.startsWith('/game/')) { res.end(artifact.html); return; }
  res.end('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#host{margin:0;height:100%}</style><div id="host"></div><script type="module">import{mountGame}from"/runtime.js";const html=await(await fetch("/game/' + name + '")).text();window.events=[];mountGame(document.querySelector("#host"),html,' + JSON.stringify({ sessionId: randomUUID(), versionId: randomUUID() }) + ',event=>window.events.push(event));</script>');
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address(); if (!address || typeof address === 'string') throw Error('NO_LISTENER');
const base = 'http://127.0.0.1:' + address.port;
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'DISPLAY', 'XDG_RUNTIME_DIR', 'LANG', 'CHROME_DEVEL_SANDBOX'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]!]));
const browser = await chromium.launch({ chromiumSandbox: true, env });
type State = { phase: string; score: number; health: number; collected: number; moves: number; elapsed: number; cursor: number; player: { x: number; y: number }; board: number[]; entities: { id: string; x: number; y: number; behavior: string }[]; goal: { metric: string; atLeast: number }; scrolls: number; error: string | null };
const state = async (f: Frame): Promise<State> => JSON.parse(await f.locator('[data-yaplix-state]').textContent() ?? '{}');
let actions: unknown[] = [];
async function waitState(f: Frame, predicate: (s: State) => boolean, timeout = 7000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { const s = await state(f); if (s.error) throw Error(s.error); if (predicate(s)) return s; await new Promise(done => setTimeout(done, 40)); }
  throw Error('STATE_TIMEOUT ' + JSON.stringify(await state(f)));
}
async function open(page: Page, name: string) {
  await page.goto(base + '/host/' + name);
  await page.locator('iframe').waitFor();
  const f = (await (await page.locator('iframe').elementHandle())!.contentFrame())!;
  await f.locator('[data-yaplix-start]').waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  await page.waitForFunction(() => (window as any).events.some((e: any) => e.type === 'game_ready'));
  return f;
}
async function boardTap(f: Frame, page: Page, i: number, touch: boolean) {
  const box = (await f.locator('canvas').boundingBox())!;
  const x = box.x + (i % 4 + .5) * box.width / 4, y = box.y + (Math.floor(i / 4) + .5) * box.height / 4;
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  actions.push({ action: 'board-cell', i, touch, observed: await state(f) });
}
async function direction(f: Frame, page: Page, name: string, touch: boolean) {
  if (touch) await f.locator('[data-action="' + name + '"]').tap();
  else await page.keyboard.press({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[name]!);
  actions.push({ action: name, touch, observed: await state(f) });
}
async function restart(f: Frame, touch: boolean) {
  const btn = f.locator('[data-yaplix-restart]'); if (touch) await btn.tap(); else await btn.click();
  const s = await state(f); assert.equal(s.phase, 'ready'); assert.equal(s.score, 0); assert.equal(s.moves, 0);
  if(touch)await f.locator('[data-yaplix-start]').tap();else await f.locator('[data-yaplix-start]').click(); assert.equal((await state(f)).phase, 'playing');
}
try {
  for (const touch of [false, true]) for (const name of ['house', 'house-pixel', 'match3', 'race', 'variant']) {
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1280, height: touch ? 844 : 800 }, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
    await context.route('**/*', route => { if (!route.request().url().startsWith(base + '/') || route.request().frame().parentFrame()) { errors.push('NETWORK_ATTEMPT'); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    try {
      actions = []; let victory: State;
      const f = await open(page, name);
      if (touch) await f.locator('#start').tap(); else await f.locator('#start').click();
      assert.equal((await state(f)).phase, 'playing');
      // Pause/resume using actual controls; read-only clock observation.
      if(touch)await f.locator('#pause').tap();else await f.locator('#pause').click(); const paused = await state(f); await page.waitForTimeout(120); assert.equal((await state(f)).elapsed, paused.elapsed); if(touch)await f.locator('#pause').tap();else await f.locator('#pause').click();
      if (name.startsWith('house')) {
        for (const d of ['right', 'down', 'down', 'right', 'right', 'right', 'up', 'up']) await direction(f, page, d, touch);
        const s = await waitState(f, s => s.phase === 'won'); victory=s; assert.equal(s.collected, 2); assert.equal(s.entities.filter(e => ['paper', 'bottle'].includes(e.id)).length, 0); assert.equal(s.score, 7);
        assert.equal(await f.locator('#resultText').textContent(), 'You win!');
        await page.screenshot({ path: out + '/' + name + '-' + (touch ? 'touch' : 'desktop') + '-win.png' });
        await restart(f, touch);
        // Move to the pursuer with real controls; collision removes health.
        for (const d of ['down', 'down', 'right', 'right', 'right', 'right', 'right', 'down', 'down', 'down']) { if ((await state(f)).phase !== 'playing') break; await direction(f, page, d, touch); }
        const loss = await waitState(f, s => s.phase === 'lost', 14000); assert.equal(loss.health, 0);
      } else if (name === 'match3') {
        const before = (await state(f)).board;
        if (touch) { await boardTap(f, page, 1, true); await boardTap(f, page, 5, true); }
        else { await direction(f, page, 'right', false); await page.keyboard.press('Space'); await direction(f, page, 'down', false); await page.keyboard.press('Space'); }
        const s = await waitState(f, s => s.phase === 'won'); victory=s; assert.ok(s.score >= 30); assert.notDeepEqual(s.board, before); assert.equal(s.board.length, 16); assert.ok(s.board.every(n => n >= 0)); assert.equal(s.moves, 1);
        await page.screenshot({ path: out + '/match3-' + (touch ? 'touch' : 'desktop') + '-win.png' });
        await restart(f, touch);
        for (let n = 0; n < 3; n++) { await boardTap(f, page, 2, touch); await boardTap(f, page, 3, touch); }
        const loss = await waitState(f, s => s.phase === 'lost'); assert.equal(loss.moves, 3); assert.equal(loss.score, 0);
      } else if (name === 'race') {
        await direction(f, page, 'left', touch);
        const s = await waitState(f, s => s.phase === 'won'); victory=s; assert.ok(s.elapsed >= 4); assert.ok(s.scrolls >= 6); assert.equal(s.score, 10); assert.equal(s.collected, 1); assert.equal(s.health, 2);
        await page.screenshot({ path: out + '/race-' + (touch ? 'touch' : 'desktop') + '-win.png' });
        await restart(f, touch);
        const loss = await waitState(f, s => s.phase === 'lost'); assert.equal(loss.health, 0); assert.ok(loss.elapsed < 4);
      } else {
        await direction(f, page, 'right', touch);
        const s = await state(f); assert.equal(s.goal.atLeast, 6); assert.equal(s.entities.find(e => e.id === 'bug')?.behavior, 'chase'); assert.ok(s.entities.some(e => e.id === 'recycling-token'));
        for (let n = 0; n < 3; n++) await direction(f, page, 'right', touch);
        const win = await waitState(f, s => s.phase === 'won'); victory=win; assert.equal(win.score, 6); assert.equal(win.collected, 4);
      }
      await page.waitForFunction(() => (window as any).events.some((e: any) => e.type === 'game_won'));
      const events = await page.evaluate(() => (window as any).events.map((e: any) => e.type));
      assert.ok(events.indexOf('game_started') > events.indexOf('game_ready')); assert.ok(events.indexOf('game_won') > events.indexOf('game_started')); assert.ok(events.indexOf('session_ended') > events.indexOf('game_won'));
      rows.push({ name, input: touch ? 'touch' : 'desktop', win: 'VERIFIED', loss: name === 'variant' ? 'NOT_VERIFIED' : 'VERIFIED', restart: name === 'variant' ? 'NOT_VERIFIED' : 'VERIFIED', victory, state: await state(f), events, actions });
      console.log('GAMEPLAY PASS', name, touch ? 'touch' : 'desktop');
    } finally { await context.close(); }
  }
  // Layout/input smoke for required narrow sizes, tablet, landscape and short
  // keyboard-like viewport. Same mechanics; no physical-device claim.
  for (const [width, height] of [[320, 568], [360, 800], [430, 932], [768, 1024], [844, 390], [390, 320]]) for (const name of ['house', 'match3', 'race']) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    try {
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      const f = await open(page, name); await f.locator('#start').tap();
      assert.equal(await f.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const btn of await f.locator('nav button').all()) { const r = (await btn.boundingBox())!; assert.ok(r.height >= 44 && r.y >= 0 && r.y + r.height <= height + 1 && r.width >= 44); }
      const before=await state(f);await f.locator('[data-action="right"]').tap();
      const after=await state(f);assert.ok(name==='match3'?after.cursor!==before.cursor:after.player.x!==before.player.x);
      assert.equal((await state(f)).phase, 'playing');
      await page.setViewportSize({ width: height, height: width });
      const r = (await f.locator('canvas').boundingBox())!; assert.ok(r.width > 20 && r.height > 20 && r.x >= 0 && r.y >= 0);
      rows.push({ name, viewport: [width, height], layoutAndRotation: 'VERIFIED' });
    } finally { await context.close(); }
  }
  // Standalone, truly offline export, two themes and browser isolation probes.
  for (const name of Object.keys(compiled)) {
    const context = await browser.newContext({ offline: true, hasTouch: true, viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => {errors.push('EXPORT_NETWORK_ATTEMPT');return route.abort();});
    try { const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.setContent(compiled[name].html); await p.locator('#start').tap(); assert.equal((await state(p.mainFrame())).phase, 'playing'); } finally { await context.close(); }
  }
  // Regression: a legal 12x12 board can match >100 cells in one swap. Internal
  // component scoring must not inherit the smaller per-call module API cap.
  const large = compileBlueprint({ ...matchThree, world: { cols:12,rows:12,walls:[] }, board:{colors:5,cells:new Array(144).fill(0)} });
  const largeContext=await browser.newContext({offline:true,hasTouch:true,viewport:{width:390,height:844}});
  try{
    const p=await largeContext.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setContent(large.html);await p.locator('#start').tap();
    const rect=(await p.locator('canvas').boundingBox())!;
    for(const x of [.5,1.5])await p.touchscreen.tap(rect.x+x*rect.width/12,rect.y+.5*rect.height/12);
    const s=await waitState(p.mainFrame(),s=>s.phase==='won');assert.ok(s.score>=1440);assert.equal(s.board.length,144);rows.push({largeBoard:'VERIFIED',score:s.score});
  }finally{await largeContext.close();}
  const isolation = await browser.newContext();
  try {
    // CSP must be probed by an ordinary game script. DevTools evaluate can
    // bypass unsafe-eval restrictions and is only used to read this receipt.
    const probe = async () => {
      const violations:string[]=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));
      let parentDenied = false, storageDenied = false, networkDenied = false, dynamicDenied = false;
      try { void parent.document.body; } catch { parentDenied = true; }
      try { localStorage.getItem('x'); } catch { storageDenied = true; }
      try { await fetch('__PROBE__'); } catch { networkDenied = true; }
      try { (0, eval)('1+1'); } catch { dynamicDenied = true; }
      await new Promise(done=>setTimeout(done,50));
      document.documentElement.dataset.isolation = JSON.stringify({ parentDenied, storageDenied, networkDenied, networkBlockedByCsp:violations.includes('connect-src'), dynamicDenied, nodeAbsent: typeof (window as any).process === 'undefined' && typeof (window as any).require === 'undefined' });
    };
    // Strip TypeScript without executing the function; its body runs in the
    // ordinary iframe script under the game CSP, never in Node or DevTools.
    const probeJs=buildSync({stdin:{contents:'('+probe.toString()+')()',loader:'ts'},write:false}).outputFiles[0].text.replace('__PROBE__',base+'/security-network');
    compiled['security-probe'] = { ...compiled.house, html: compiled.house.html.replace('</body>', '<script>' + probeJs + '</script></body>') };
    const page = await isolation.newPage(), f = await open(page, 'security-probe');
    await f.waitForFunction(() => document.documentElement.dataset.isolation);
    const result = JSON.parse((await f.locator('html').getAttribute('data-isolation'))!);
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));assert.equal(counts.securityNetwork,0); rows.push({ isolation: result });
    delete compiled['security-probe'];
  } finally { await isolation.close(); }
  const validation = [];
  for (const name of ['house', 'match3', 'race']) {
    const begin = performance.now(); const result = await browserCheck(compiled[name].html, AbortSignal.timeout(20000));
    validation.push({ name, ms: performance.now() - begin, result }); console.log('EXISTING BROWSER CHECK PASS', name);
  }
  const measurements = [];
  if (!process.argv.includes('--quick')) for (const name of ['house', 'match3', 'race']) for (let run = 0; run < 7; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const begin = performance.now(); await page.goto(base + '/game/' + name); await page.locator('#start').waitFor();
      const loadMs = performance.now() - begin, start = performance.now(); await page.locator('#start').tap();
      assert.equal((await state(page.mainFrame())).phase, 'playing');
      const startMs = performance.now() - start;
      const renderingMs = await page.evaluate(() => new Promise<number>(done => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - t))); }));
      const build = compileBlueprint(fixtures[name as keyof typeof fixtures]);
      measurements.push({ name, run, compileMs: build.metrics.compileMs, loadMs, startMs, interactiveMs: loadMs + startMs, renderingMs });
    } finally { await context.close(); }
  }
  assert.equal(errors.length, 0, errors.join(';')); assert.equal(counts.post, 0);
  const receipt = { kind: 'AUTHORED_OFFLINE_ONLY', browser: browser.version(), inferencePosts: 0, requests: counts, errors, rows, validation, measurements, profile: 'fresh context, cache disabled, 390x844 DPR2, CPU x4, RTT150ms 1.6Mbps/750kbps, warm local static server; no production shell/API/LLM', artifacts: Object.fromEntries(Object.entries(compiled).map(([name, c]) => [name, { ...c.metrics, gzipBytes: gzipSync(c.html).length }])) };
  writeFileSync(out + (process.argv.includes('--quick') ? '/quick-receipt.json' : '/receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ gameplay: rows.length, errors: errors.length, measurementRuns: measurements.length, inferencePosts: 0, artifacts: receipt.artifacts }));
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
