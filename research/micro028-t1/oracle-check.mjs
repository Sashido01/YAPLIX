// Independent, rule-specific control validation BEFORE the generic checker exists.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_CSP } from '../../src/runtime.ts';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
for (const k of ['TEMP', 'TMP', 'TMPDIR']) process.env[k] = resolve('.local/tmp');
const { chromium } = await import('playwright-core');
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const b = await chromium.launch({ channel: 'chromium', chromiumSandbox: true, headless: true, env });
const results = [];
try {
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, offline: true });
    await c.addInitScript(() => { window.drawn = ''; const orig = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (s, ...args) { window.drawn = String(s); return orig.call(this, s, ...args); }; });
    const p = await c.newPage(); p.setDefaultTimeout(1200);
    await p.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await p.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const content = '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '">' + readFileSync('research/micro028-t1/heldout/' + name + '.html', 'utf8');
    const host = '<meta name="viewport" content="width=device-width,initial-scale=1"><iframe sandbox="allow-scripts" style="width:390px;height:844px" src="/document"></iframe>';
    await c.route('**/*', r => r.request().url() === 'http://127.0.0.1:3278/oracle' ? r.fulfill({ contentType: 'text/html', body: host }) : r.request().url() === 'http://127.0.0.1:3278/document' ? r.fulfill({ contentType: 'text/html', body: content }) : r.abort());
    await p.goto('http://127.0.0.1:3278/oracle');
    const f = await (await p.locator('iframe').elementHandle()).contentFrame(); await f.waitForURL('**/document');
    const read = () => f.evaluate(() => document.querySelector('output').textContent || window.drawn);
    await f.getByRole('button', { name: 'Begin', exact: true }).tap();
    const initial = await read(); const samples = [initial];
    if (name < 'd') {
      for (let i = 0; i < 3; i++) { await f.getByRole('button', { name: 'Toggle', exact: true }).tap(); await p.clock.runFor(20); samples.push(await read()); }
      assert.equal(samples.at(-1), name === 'c' ? 'Turns: 0' : 'Turns: 3');
      if (name === 'c') await p.clock.runFor(5100);
      assert.equal(await f.locator('#message').innerText(), 'Game over');
    } else { await p.clock.runFor(4100); samples.push(await read()); assert.equal(samples.at(-1), 'Pressure: -8'); }
    await f.getByRole('button', { name: 'Restart', exact: true }).tap(); samples.push(await read());
    assert.equal(samples.at(-1), name === 'f' ? 'Pressure: -8' : initial);
    await f.getByRole('button', { name: name < 'd' ? 'Toggle' : 'Vent', exact: true }).tap(); await p.clock.runFor(20); samples.push(await read());
    assert.equal(samples.at(-1), name < 'd' ? (name === 'c' ? 'Turns: 0' : 'Turns: 1') : (name === 'f' ? 'Pressure: -5' : 'Pressure: 3'));
    results.push({ name, samples, expectedBehaviorConfirmed: true }); await c.close();
  }
} finally { await b.close(); mkdirSync('.local/micro028-t1', { recursive: true }); writeFileSync('.local/micro028-t1/control-oracle.json', JSON.stringify(results, null, 2) + '\n'); }
console.log(JSON.stringify(results));
