import { readFileSync, mkdirSync, writeFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { GAME_CSP, UUID_COMPAT } from '../../src/runtime.ts';

export const PHASES = ['start', 'input', 'progress', 'win', 'loss', 'restart', 'repeat', 'export'];
export const LIMITS = { events: 12000, bytes: 2 * 1024 * 1024, trace: 32 * 1024 * 1024, duration: 15 * 60000 };
const HOST = 'http://127.0.0.1:3278/host', DOCUMENT = 'http://127.0.0.1:3278/document';
const WORLD = 'yaplix_t2_observer', BINDING = '__t2_emit';
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function privatePath(path) {
  const root = resolve('.local'), full = resolve(path), rel = relative(root, full);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw Error('PRIVATE_PATH_REQUIRED');
  return full;
}
export function loadEntry(entry) {
  if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('INVALID_HASH');
  const file = privatePath('.local/micro028-t1/corpus/' + entry.sha256 + '.html');
  const bytes = readFileSync(file);
  const verifySource = () => {
    if (hash(readFileSync(file)) !== entry.sha256) throw Error('SOURCE_HASH_CHANGED');
    if (typeof entry.source === 'string') {
      if (hash(readFileSync(privatePath(entry.source))) !== entry.sha256) throw Error('ORIGINAL_HASH_CHANGED');
      const job = JSON.parse(readFileSync(privatePath(entry.provenance.source), 'utf8'));
      const metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
      if (hash(Buffer.from(metadata?.originalCheckpoint ?? '')) !== entry.sha256) throw Error('CHECKPOINT_PROVENANCE_MISMATCH');
      const origin = metadata.checkpointOrigin;
      if (origin?.provider !== 'ollama.com' || origin.model !== 'gemma4:31b') throw Error('LLM_PROVENANCE_MISSING');
      return { method: 'originalCheckpoint', provider: origin.provider, model: origin.model, htmlHashMatched: true, originalHashMatched: true };
    }
    const dbPath = privatePath(entry.source.db);
    // Immutable archive read cannot update WAL/SHM. Refuse pending WAL content,
    // since immutable reads intentionally ignore it. Never checkpoint the source.
    if (existsSync(dbPath + '-wal') && statSync(dbPath + '-wal').size) throw Error('SOURCE_DATABASE_HAS_WAL');
    const uri = pathToFileURL(dbPath); uri.search = '?mode=ro&immutable=1';
    const db = new DatabaseSync(uri.href, { readOnly: true });
    try {
      const row = db.prepare('SELECT html,metadata,game_id FROM versions WHERE version_id=?').get(entry.source.version);
      if (!row || row.game_id !== entry.source.game || hash(Buffer.from(row.html)) !== entry.sha256) throw Error('VERSION_PROVENANCE_MISMATCH');
      const metadata = JSON.parse(row.metadata);
      if (metadata.method !== 'llm_code' || metadata.provider !== entry.provenance.provider || metadata.model !== entry.provenance.model) throw Error('LLM_PROVENANCE_MISMATCH');
      return { method: metadata.method, provider: metadata.provider, model: metadata.model, htmlHashMatched: true };
    } finally { db.close(); }
  };
  return { bytes, verifySource };
}

// Installed before owner input, in a separate JS world. No DOM text, game variables,
// RNG/timer overrides, event cancellation or propagation changes.
function observe() {
  if (window === window.top || window.parent !== window.top) return;
  const emit = value => window.__t2_emit(JSON.stringify(value));
  const keys = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter','Escape','KeyR']);
  const editable = e => e.composedPath().some(n => n instanceof Element && n.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  let count = 0, lastMove = -Infinity;
  const pressed = new Set(), pointers = new Set();
  const send = value => { if (count++ <= 12000) emit(value); };
  for (const type of ['keydown','keyup']) addEventListener(type, e => {
    if (e.isTrusted && !editable(e) && keys.has(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (type === 'keydown') pressed.add(e.code); else pressed.delete(e.code);
      send({ type, code: e.code, repeat: e.repeat });
    }
  }, { capture: true, passive: true });
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) addEventListener(type, e => {
    if (!e.isTrusted || editable(e)) return;
    if (e.clientX < 0 || e.clientY < 0 || e.clientX >= innerWidth || e.clientY >= innerHeight) {
      if (pointers.has(e.pointerId)) { send({ type: 'input_gap', reason: 'POINTER_LEFT_VIEWPORT' }); pointers.delete(e.pointerId); }
      return;
    }
    if (type === 'pointerdown') pointers.add(e.pointerId);
    if (type === 'pointerup' || type === 'pointercancel') pointers.delete(e.pointerId);
    if (type === 'pointermove') {
      if (!e.buttons || performance.now() - lastMove < 50) return;
      lastMove = performance.now();
    }
    send({ type, x: Math.round(e.clientX), y: Math.round(e.clientY), pointer: e.pointerType, id: e.pointerId, button: e.button });
  }, { capture: true, passive: true });
  const viewport = () => send({ type: 'viewport', width: innerWidth, height: innerHeight });
  addEventListener('blur', () => {
    if (pressed.size || pointers.size) send({ type: 'input_gap', reason: 'FOCUS_LOST_WITH_ACTIVE_INPUT' });
    pressed.clear(); pointers.clear();
  }, { passive: true });
  addEventListener('resize', viewport, { passive: true }); viewport();
}

function durableJSON(path, value) {
  const temp = path + '.tmp', fd = openSync(temp, 'w');
  try { writeSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export async function runRecorder({ entry, bytes, verifySource = () => ({ method: 'synthetic' }), outRoot, actor = 'SYNTHETIC', headless = true, timeoutMs = LIMITS.duration, interact, installSignals = false, limits = LIMITS }) {
  const sessionId = randomUUID(), out = privatePath(resolve(outRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + sessionId));
  mkdirSync(out, { recursive: true }); mkdirSync('.local/tmp', { recursive: true });
  const record = { schema: 1, sessionId, out, entry, actor, startedAt: new Date().toISOString(), sha256: hash(bytes), provenanceCheck: null,
    clock: 'ordinary real time; Node monotonic receipt timestamps', seed: 'native RNG; unchanged', status: 'HUMAN_ACCEPTANCE_PENDING',
    completion: 'RUNNING_EVENT_LOG_INCOMPLETE', eventLog: 'EVENT_LOG_INCOMPLETE', eventCount: 0, dropped: 0,
    trace: { status: 'NOT_AVAILABLE', reason: 'TRACE_NOT_STARTED' }, phases: Object.fromEntries(PHASES.map(p => [p, { status: 'NOT_VERIFIED', reason: 'NOT_ATTEMPTED' }])),
    nativeFileExport: 'NATIVE_FILE_EXPORT_NOT_VERIFIED', unverified: [...PHASES] };
  const save = () => durableJSON(resolve(out, 'human-record.json'), record);
  save();
  const fd = openSync(resolve(out, 'actions.jsonl'), 'wx');
  const previousTemp = Object.fromEntries(['TEMP','TMP','TMPDIR'].map(k => [k, process.env[k]]));
  // Playwright creates the disposable profile in the controller's temp, not just
  // the child's environment. Keep both inside this repository.
  for (const k of Object.keys(previousTemp)) process.env[k] = resolve('.local/tmp');
  let browser, context, page, tracing = false, finished = false, opening = true, documentIndex = 0, stage = 'setup', eventBytes = 0, budgetHit = false, inputGap = false, timer, fail;
  const controller = new AbortController(), start = performance.now();
  const failure = new Promise((_, reject) => { fail = code => reject(Error(code)); });
  void failure.catch(() => {});
  const interrupt = () => fail('USER_INTERRUPTED');
  const append = event => {
    if (finished || budgetHit) return;
    if (event.type === 'input_gap') inputGap = true;
    const item = { ...event, t: Math.round(performance.now() - start), phase: stage, document: documentIndex };
    const line = JSON.stringify(item) + '\n';
    if (record.eventCount >= limits.events || eventBytes + Buffer.byteLength(line) > limits.bytes) {
      budgetHit = true; record.dropped++; record.eventLog = 'EVENT_LOG_INCOMPLETE'; save(); return;
    }
    writeSync(fd, line); fsyncSync(fd); eventBytes += Buffer.byteLength(line); record.eventCount++;
  };
  if (installSignals) { process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt); }
  timer = setTimeout(() => fail('TIMEOUT'), timeoutMs);
  const bound = promise => Promise.race([promise, failure]);
  try {
    if (record.sha256 !== entry.sha256) throw Error('SOURCE_HASH_CHANGED');
    record.provenanceCheck = verifySource(); save();
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
    const env = Object.fromEntries(['PATH','Path','SystemRoot','USERPROFILE','LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    for (const k of ['TEMP','TMP','TMPDIR']) env[k] = resolve('.local/tmp');
    const { chromium } = await import('playwright-core');
    // Await launch itself so a signal cannot orphan a late browser process.
    browser = await chromium.launch({ channel: 'chromium', headless, chromiumSandbox: true, env, timeout: Math.min(timeoutMs, 15000) });
    browser.on('disconnected', () => { if (!finished) fail('BROWSER_ERROR'); });
    context = await bound(browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, offline: true, serviceWorkers: 'block', acceptDownloads: false }));
    // Disable trace DOM snapshots/screenshots: editable contents must not leak.
    await bound(context.tracing.start({ screenshots: false, snapshots: false, sources: false })); tracing = true;
    const wrap = source => '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '"><script>' + UUID_COMPAT + '</script>' + source.toString('utf8');
    let content = wrap(bytes);
    await context.route('**/*', r => r.request().url() === HOST && r.request().isNavigationRequest() && r.request().frame() === page?.mainFrame()
      ? r.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style><iframe sandbox="allow-scripts" allow="camera \'none\'; microphone \'none\'; geolocation \'none\'; payment \'none\'; usb \'none\'" referrerpolicy="no-referrer" src="/document"></iframe>' })
      : r.request().url() === DOCUMENT && r.request().isNavigationRequest() && r.request().frame().parentFrame() === page?.mainFrame()
        ? r.fulfill({ contentType: 'text/html', body: content }) : r.abort());
    page = await bound(context.newPage()); page.setDefaultTimeout(3000); page.setDefaultNavigationTimeout(5000);
    page.on('close', () => { if (!finished) fail('WINDOW_CLOSED'); });
    page.on('crash', () => fail('BROWSER_ERROR'));
    page.on('framenavigated', () => { if (!opening && !finished) fail('GAME_NAVIGATED'); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    let observerSession;
    const open = async () => {
      opening = true; documentIndex++;
      await observerSession?.detach().catch(() => {});
      await bound(page.goto(HOST));
      const frame = page.frames().find(f => f.parentFrame() === page.mainFrame());
      if (!frame) throw Error('GAME_FRAME_MISSING');
      await bound(frame.waitForURL(DOCUMENT));
      await bound(frame.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
      // Opaque cross-site iframe can be a separate renderer target. Attach to the
      // actual frame, not only the parent Page target. Install before owner input.
      const cdp = observerSession = await bound(context.newCDPSession(frame));
      await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
      await cdp.send('Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const { executionContextId: worldId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: WORLD });
      cdp.on('Runtime.bindingCalled', ({ name, payload, executionContextId }) => {
        if (name !== BINDING || executionContextId !== worldId || payload.length > 256) return;
        try { append(JSON.parse(payload)); } catch { fail('JOURNAL_WRITE_ERROR'); }
      });
      const installed = await cdp.send('Runtime.evaluate', { expression: '(' + observe.toString() + ')()', contextId: worldId });
      if (installed.exceptionDetails) throw Error('OBSERVER_INSTALL_FAILED');
      await bound(page.locator('iframe').evaluate((n, ids) => n.contentWindow.postMessage({ channel: 'yaplix_init', protocolVersion: 1, ...ids }, '*'), { sessionId, versionId: '00000000-0000-4000-8000-000000000002' }));
      opening = false;
    };
    const session = { page, context, out, signal: controller.signal, interrupt, inputClosed: () => fail('INPUT_CLOSED'),
      phase: p => { if (!PHASES.includes(p)) throw Error('UNKNOWN_PHASE'); stage = p; append({ type: 'phase' }); save(); },
      rules: text => { record.rules = { status: 'HUMAN_REPORTED', notes: text.slice(0, 2000) }; save(); },
      answer: async (p, notes) => {
        record.phases[p] = { status: notes.trim() && !/^UNKNOWN\b/i.test(notes) ? 'HUMAN_REPORTED' : 'NOT_VERIFIED', reportedOutcome: /^(PASS|FAIL|VERIFIED|FAILED)\b/i.exec(notes)?.[1] ?? 'UNKNOWN', notes: notes.slice(0, 2000), evidenceReview: 'NOT_VERIFIED', eventEnd: record.eventCount };
        save();
        const screenshot = p + '.png';
        await bound(page.screenshot({ path: resolve(out, screenshot), timeout: 2000, mask: [page.frameLocator('iframe').locator(EDITABLE)] }));
        record.phases[p].screenshot = screenshot; save();
      },
      exportCopy: async () => {
        const exported = resolve(out, 'export.html'); writeFileSync(exported, bytes, { flag: 'wx' });
        if (hash(readFileSync(exported)) !== entry.sha256) throw Error('EXPORT_HASH_CHANGED');
        content = wrap(readFileSync(exported));
        record.offlineExport = { status: 'BYTE_EXACT', sha256: hash(readFileSync(exported)), execution: 'OFFLINE_OPAQUE_IFRAME_ONLY' }; save();
        await open();
      }
    };
    await open(); stage = 'start'; await bound(interact(session));
    record.completion = 'COMPLETED';
  } catch (error) {
    const known = ['TIMEOUT','USER_INTERRUPTED','INPUT_CLOSED','WINDOW_CLOSED','BROWSER_ERROR','GAME_NAVIGATED','SOURCE_DATABASE_HAS_WAL','SOURCE_HASH_CHANGED','ORIGINAL_HASH_CHANGED','VERSION_PROVENANCE_MISMATCH','CHECKPOINT_PROVENANCE_MISMATCH','LLM_PROVENANCE_MISMATCH','LLM_PROVENANCE_MISSING','JOURNAL_WRITE_ERROR'];
    record.completion = known.includes(error.message) ? error.message : 'RECORDER_ERROR';
    record.recorderStatus = 'RECORDER_ERROR'; // No raw errors/URLs/HTML/secrets.
  } finally {
    finished = true; clearTimeout(timer); controller.abort();
    if (installSignals) { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
    if (record.completion !== 'COMPLETED' && page && !page.isClosed()) {
      try {
        await page.screenshot({ path: resolve(out, 'partial-final.png'), timeout: 1000, mask: [page.frameLocator('iframe').locator(EDITABLE)] });
        record.terminationScreenshot = 'partial-final.png';
      } catch { record.terminationScreenshotReason = 'SCREENSHOT_UNAVAILABLE'; }
    }
    if (tracing) {
      try {
        await context.tracing.stop({ path: resolve(out, 'browser.zip') });
        if (statSync(resolve(out, 'browser.zip')).size > limits.trace) { unlinkSync(resolve(out, 'browser.zip')); record.trace = { status: 'NOT_AVAILABLE', reason: 'TRACE_BUDGET_LIMIT_DISCARDED' }; }
        else record.trace = { status: 'SAVED', file: 'browser.zip', contents: 'Playwright operations only; no native-input replay or DOM snapshots' };
      } catch { record.trace = { status: 'NOT_AVAILABLE', reason: 'TRACE_FINALIZATION_FAILED' }; }
    }
    await browser?.close().catch(() => {});
    try { record.finalProvenanceCheck = verifySource(); record.sourceUnchanged = hash(bytes) === entry.sha256; }
    catch { record.sourceUnchanged = false; record.completion = 'SOURCE_HASH_CHANGED'; record.recorderStatus = 'RECORDER_ERROR'; }
    fsyncSync(fd); closeSync(fd);
    record.eventLog = record.completion === 'COMPLETED' && !budgetHit && !inputGap ? 'COMPLETE_BOUNDED_INPUT_LOG' : 'EVENT_LOG_INCOMPLETE';
    record.unverified = PHASES.filter(p => record.phases[p].evidenceReview !== 'EVIDENCE_REVIEWED');
    record.endedAt = new Date().toISOString(); save();
    for (const [k, value] of Object.entries(previousTemp)) {
      if (value === undefined) delete process.env[k]; else process.env[k] = value;
    }
  }
  return record;
}

// Native mouse/keyboard only; no game variables, selectors or RNG patches.
export async function replay(session, events, { complete = false, check } = {}) {
  const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter','Escape','KeyR'];
  const types = ['phase','viewport','keydown','keyup','pointerdown','pointermove','pointerup'];
  let previous = 0;
  if (!complete || events.length > LIMITS.events || new Set(events.map(e=>e.document)).size > 1 || events.some(e => {
    const invalidTime = !Number.isFinite(e.t) || e.t < previous || e.t > LIMITS.duration; previous = e.t;
    return invalidTime || !types.includes(e.type) || e.pointer === 'touch' || e.pointer === 'pen' || e.repeat
      || (e.type.startsWith('key') && !keys.includes(e.code))
      || (e.type === 'viewport' && (![e.width,e.height].every(v=>Number.isInteger(v)&&v>=1&&v<=4096)))
      || (e.type.startsWith('pointer') && (![e.x,e.y].every(v=>Number.isInteger(v)&&v>=0&&v<=4096)));
  })) return { status: 'REPLAY_UNSUPPORTED', reason: 'INCOMPLETE_OR_UNSUPPORTED_INPUT' };
  const start = performance.now();
  for (const e of events) {
    session.signal.throwIfAborted();
    const wait = Math.max(0, e.t - (performance.now() - start));
    if (wait) await delay(wait, undefined, { signal: session.signal });
    if (e.type === 'viewport') await session.page.setViewportSize({ width: e.width, height: e.height });
    else if (e.type === 'keydown') await session.page.keyboard.down(e.code);
    else if (e.type === 'keyup') await session.page.keyboard.up(e.code);
    else if (e.type.startsWith('pointer')) {
      await session.page.mouse.move(e.x, e.y);
      const button = ['left','middle','right'][e.button];
      if (e.type === 'pointerdown' && button) await session.page.mouse.down({ button });
      if (e.type === 'pointerup' && button) await session.page.mouse.up({ button });
    }
  }
  return { status: check && await check() ? 'REPLAY_REPRODUCED' : 'REPLAY_NOT_REPRODUCED', boundary: 'native RNG/timing; comparison supplied separately, never gameplay certification' };
}
