// Small, explicit clock/RNG/isolation experiment; no control-oracle import.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser } from './probe.mjs';
import { GAME_CSP } from '../../src/runtime.ts';
const out = resolve('.local/micro028-t1/clock-check');
assert(!existsSync(out), 'Keep first clock experiment'); mkdirSync(out, { recursive: true });
const browser = await launchBrowser(), results = [];
try {
  for (const timer of ['raf', 'interval', 'timeout']) for (const virtual of [false, true]) for (const hostMode of ['document', 'srcdoc']) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true });
    const p = await c.newPage(); p.setDefaultTimeout(1500);
    if (virtual) { await p.clock.install({ time: new Date('2026-01-01T00:00:00Z') }); await p.clock.pauseAt(new Date('2026-01-01T00:00:01Z')); }
    await c.addInitScript(() => { let n = 17; Math.random = () => ((n = (Math.imul(1664525, n) + 1013904223) >>> 0) / 4294967296); });
    const html = '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '"><body><output id="hud">0</output><output id="rng"></output><output id="security"></output><script>const rng=document.querySelector("#rng");rng.textContent=String(Math.random());let n=0;function tick(){document.querySelector("#hud").textContent=String(++n)};' + (timer === 'raf' ? 'function frame(){tick();requestAnimationFrame(frame)}requestAnimationFrame(frame);' : timer === 'interval' ? 'setInterval(tick,100);' : 'function loop(){tick();setTimeout(loop,100)}setTimeout(loop,100);') + 'let facts={};try{parent.document.body;facts.parent=false}catch{facts.parent=true}try{localStorage.setItem("x","x");facts.storage=false}catch{facts.storage=true}try{eval("1+1");facts.eval=false}catch{facts.eval=true}facts.origin=self.origin;document.querySelector("#security").textContent=JSON.stringify(facts)</script>';
    const host = '<iframe sandbox="allow-scripts" ' + (hostMode === 'document' ? 'src="/document"' : 'srcdoc="' + html.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '"') + '></iframe>';
    await c.route('**/*', r => r.request().url() === 'http://127.0.0.1:3278/host' ? r.fulfill({ contentType: 'text/html', body: host }) : hostMode === 'document' && r.request().url() === 'http://127.0.0.1:3278/document' ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort());
    await p.goto('http://127.0.0.1:3278/host'); const f = await (await p.locator('iframe').elementHandle()).contentFrame(); await f.waitForURL(hostMode === 'document' ? '**/document' : 'about:srcdoc');
    const before = Number(await f.locator('#hud').innerText()), began = performance.now();
    if (virtual) await p.clock.runFor(1000); else await p.waitForTimeout(1000);
    const after = Number(await f.locator('#hud').innerText());
    const row = { timer, virtual, hostMode, delta: after - before, wallMs: Math.round(performance.now() - began), rng: await f.locator('#rng').innerText(), security: JSON.parse(await f.locator('#security').innerText()) };
    results.push(row); writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    assert.deepEqual(row.security, { parent: true, storage: true, eval: true, origin: 'null' });
    if (hostMode === 'document') assert(timer === 'raf' ? row.delta >= 50 : row.delta >= 9 && row.delta <= 12);
    await c.close(); console.log(JSON.stringify(row));
  }
  assert.equal(new Set(results.filter(r => r.hostMode === 'document').map(r => r.rng)).size, 1, 'Seeded RNG installed before script');
} finally { await browser.close(); }
