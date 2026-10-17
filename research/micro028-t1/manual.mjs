// Owner-operated T2 recorder. Does not automate play or invent human verdicts.
import { readFileSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createHash } from 'node:crypto';
import { GAME_CSP, UUID_COMPAT } from '../../src/runtime.ts';
const help = process.argv.includes('--help');
if (help) console.log('node research/micro028-t1/manual.mjs manual-01\nUses private manual-plan.json. Owner plays in visible offline Chromium, enters rules/actions/status and captures each stage. No generation.');
if (!help) {
const id = process.argv[2];
if (!/^manual-\d{2}$/.test(id ?? '')) throw Error('Select manual-01..manual-10');
const plan = JSON.parse(readFileSync('.local/micro028-t1/manual-plan.json', 'utf8'));
const entry = plan.games.find(g => g.id === id); if (!entry) throw Error('Missing selected entry');
const file = resolve('.local/micro028-t1/corpus', entry.sha256 + '.html');
const html = readFileSync(file, 'utf8');
if (createHash('sha256').update(html).digest('hex') !== entry.sha256) throw Error('SOURCE_HASH_CHANGED');
const out = resolve('.local/micro028-t1/human', id, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true }); mkdirSync('.local/tmp', { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
for (const k of ['TEMP', 'TMP', 'TMPDIR']) process.env[k] = resolve('.local/tmp');
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chromium', headless: false, chromiumSandbox: true, env });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, offline: true, serviceWorkers: 'block', acceptDownloads: false });
const rl = createInterface({ input: stdin, output: stdout });
const record = { ...entry, actor: 'OWNER', status: 'HUMAN_REPORTED_REQUIRES_EVIDENCE_REVIEW', clock: 'ordinary real time', seed: 'native RNG, not overridden', phases: [] };
const deadline = setTimeout(() => { console.log('Recorder 15-minute limit reached; incomplete phases remain pending.'); rl.close(); void browser.close(); }, 15 * 60000);
try {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const content = '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '"><script>' + UUID_COMPAT + '</script>' + html;
  await context.route('**/*', r => r.request().url() === 'http://127.0.0.1:3278/host' ? r.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" src="/document"></iframe>' }) : r.request().url() === 'http://127.0.0.1:3278/document' ? r.fulfill({ contentType: 'text/html', body: content }) : r.request().url() === pathToFileURL(file).href ? r.continue() : r.abort());
  const p = await context.newPage(); await p.goto('http://127.0.0.1:3278/host');
  const frame = await (await p.locator('iframe').elementHandle()).contentFrame(); await frame.waitForURL('**/document');
  await p.locator('iframe').evaluate(n => n.contentWindow.postMessage({ channel: 'yaplix_init', protocolVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' }, '*'));
  record.rules = await rl.question('Read the game. Enter human-established rules, controls, win/loss, or UNKNOWN: ');
  console.log('Play directly in the browser. For each phase enter VERIFIED / FAILED / NOT_VERIFIED, then exact actions and observations. A visible message alone does not prove its rule.');
  for (const phase of ['start', 'input', 'progress', 'win', 'loss', 'restart-and-next-action', 'repeat']) {
    const notes = await rl.question(phase + ' status / actions / evidence / reason (Enter keeps pending): ');
    const shot = phase + '.png'; await p.screenshot({ path: resolve(out, shot), timeout: 2000 });
    record.phases.push({ phase, status: /^(VERIFIED|FAILED|NOT_VERIFIED)\b/.exec(notes)?.[1] ?? 'HUMAN_ACCEPTANCE_PENDING', notes, screenshot: shot });
  }
  await p.goto(pathToFileURL(file).href);
  record.offlineExport = await rl.question('Standalone exact HTML is now open offline. Repeat controls/progress/end/restart; enter status and exact actions: ');
  await p.screenshot({ path: resolve(out, 'offline-export.png'), timeout: 2000 });
  await context.tracing.stop({ path: resolve(out, 'browser.zip') });
  const trace = resolve(out, 'browser.zip'); if (statSync(trace).size > 32 * 1024 * 1024) { unlinkSync(trace); record.trace = 'TRACE_BUDGET_LIMIT_DISCARDED'; }
} finally {
  clearTimeout(deadline); rl.close(); await browser.close().catch(() => {});
  writeFileSync(resolve(out, 'human-record.json'), JSON.stringify(record, null, 2) + '\n');
}
}
