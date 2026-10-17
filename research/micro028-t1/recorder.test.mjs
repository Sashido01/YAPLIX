import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { collectOwnerAnswers } from './manual.mjs';
import { runRecorder, hash, replay, LIMITS, loadEntry } from './recorder.mjs';

// Authored deterministic safe document; assertions only read visible DOM.
const bytes = Buffer.from(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{height:50px;width:100px}canvas{display:block;width:200px;height:160px}</style><button id="start">Start</button><output id="score">0</output><canvas></canvas><input type="password" id="private"><textarea></textarea><div contenteditable="true"></div><script>
let n=0;document.querySelector('#start').onclick=()=>{n=1;document.querySelector('#score').textContent=n};
addEventListener('keydown',e=>{if(e.code==='ArrowRight')document.querySelector('#score').textContent=++n});
document.querySelector('canvas').addEventListener('pointerdown',()=>{document.querySelector('#score').textContent=++n});
document.querySelector('canvas').addEventListener('touchstart',()=>{document.querySelector('#score').dataset.touch='yes'},{passive:true});
try{eval('1');document.body.dataset.eval='allowed'}catch{document.body.dataset.eval='blocked'};
fetch('https://example.invalid/secret').then(()=>document.body.dataset.fetch='allowed',()=>document.body.dataset.fetch='blocked');
</script>`);
const entry = { id: 'synthetic-recorder', sha256: hash(bytes), provenance: 'AUTHORED_SYNTHETIC' };
const root = resolve('.local/micro028-t1/human/synthetic-tests');
const options = { entry, bytes, outRoot: root, timeoutMs: 15000 };
const events = r => readFileSync(resolve(r.out, 'actions.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
const resultFile = r => JSON.parse(readFileSync(resolve(r.out, 'human-record.json')));
const check = async (fn, extra = {}) => {
  let callbackError;
  const record=await runRecorder({ ...options, ...extra, interact: async s=>{try{await fn(s);}catch(e){callbackError=e;throw e;}} });
  if(callbackError?.code==='ERR_ASSERTION')throw callbackError;
  return record;
};

if (process.argv.includes('--crash-child')) {
  await check(async s => {
    s.phase('input'); await s.page.frameLocator('iframe').locator('#start').click();
    await s.answer('input', 'PASS synthetic pre-crash checkpoint');
    writeFileSync(resolve(root, 'crash-ready.json'), JSON.stringify({ out: s.out }));
    await new Promise(() => {});
  }, { timeoutMs: 1500 });
} else {
test('normal keyboard/mouse/touch, privacy, durable screenshots and sandbox export', async () => {
  const r = await check(async s => {
    const f = s.page.frames()[1], game = s.page.frameLocator('iframe');
    assert.equal(await s.page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await f.evaluate(() => { try { return parent.document.title; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(await f.evaluate(() => { try { localStorage.setItem('x','x'); return 'allowed'; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(await f.evaluate(() => typeof window.__t2_emit), 'undefined');
    // Probe was parsed as ordinary source; DevTools execution can bypass CSP.
    assert.equal(await game.locator('body').getAttribute('data-eval'), 'blocked');
    await game.locator('body[data-fetch="blocked"]').waitFor();
    s.phase('start'); await game.locator('#start').click(); await s.answer('start','VERIFIED synthetic owner-style claim');
    s.phase('input'); await s.page.keyboard.press('ArrowRight');
    await s.page.mouse.move(60,100); await s.page.mouse.down();
    for (let i=0;i<30;i++) await s.page.mouse.move(60+i,100);
    await s.page.mouse.up();
    await s.page.touchscreen.tap(70,110);
    assert.equal(await game.locator('#score').getAttribute('data-touch'),'yes');
    await game.locator('#private').click();
    const nativeInput=await s.context.newCDPSession(s.page);
    await nativeInput.send('Input.insertText',{text:'PRIVATE_SENTINEL'});
    await nativeInput.detach(); await s.page.keyboard.press('ArrowRight');
    await f.evaluate(() => dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowLeft'})));
    for(const width of [320,360,390,430,768,1366])await s.page.setViewportSize({width,height:844});
    await s.page.setViewportSize({width:568,height:320});
    await s.page.setViewportSize({width:320,height:568}); await s.answer('input','PASS synthetic controls');
    s.phase('progress'); await s.answer('progress','');
    await s.exportCopy(); s.phase('export'); await game.locator('#start').tap(); await s.answer('export','PASS sandbox copy only');
  }, {headless:false});
  assert.equal(r.completion,'COMPLETED'); assert.equal(r.actor,'SYNTHETIC');
  assert.equal(r.phases.start.status,'HUMAN_REPORTED'); assert.equal(r.phases.start.evidenceReview,'NOT_VERIFIED');
  assert.equal(r.phases.progress.status,'NOT_VERIFIED'); assert.equal(r.unverified.length,8);
  assert.equal(r.eventLog,'COMPLETE_BOUNDED_INPUT_LOG'); assert.equal(r.trace.status,'SAVED');
  assert.equal(r.offlineExport.status,'BYTE_EXACT'); assert.equal(hash(readFileSync(resolve(r.out,'export.html'))),entry.sha256);
  assert.equal(r.nativeFileExport,'NATIVE_FILE_EXPORT_NOT_VERIFIED');
  const log=events(r); assert(log.some(e=>e.type==='keydown'&&e.code==='ArrowRight'&&e.phase==='input'));
  assert(log.some(e=>e.type==='keyup')); assert(log.some(e=>e.pointer==='mouse')); assert(log.some(e=>e.pointer==='touch'));
  assert(log.some(e=>e.type==='viewport'&&e.width===320)); assert(!log.some(e=>e.code==='ArrowLeft'));
  assert.equal(log.filter(e=>e.type==='keydown').length,1); assert(log.filter(e=>e.type==='pointermove').length<30);
  assert(!JSON.stringify(log).includes('PRIVATE_SENTINEL')); assert(existsSync(resolve(r.out,'input.png')));
  const privacy=spawnSync('python',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert not any(b'PRIVATE_SENTINEL' in z.read(n) for n in z.namelist())`,resolve(r.out,'browser.zip')],{encoding:'utf8'});
  assert.equal(privacy.status,0,privacy.stderr);
  assert.equal(resultFile(r).sessionId,r.sessionId);
});

test('recorded native mouse/keyboard replay reproduces safe reference; mismatch never becomes PASS', async()=>{
  const first = await check(async s=>{s.phase('input');await s.page.frameLocator('iframe').locator('#start').click();await s.page.keyboard.press('ArrowRight');assert.equal(await s.page.frameLocator('iframe').locator('#score').textContent(),'2');await s.answer('input','PASS synthetic reference visible score 2');});
  assert.equal(first.completion,'COMPLETED');
  let replayResult;
  const second = await check(async s=>{replayResult=await replay(s,events(first),{complete:true,check:async()=>await s.page.frameLocator('iframe').locator('#score').textContent()==='2'});});
  assert.equal(second.completion,'COMPLETED'); assert.equal(replayResult.status,'REPLAY_REPRODUCED');
  const third = await check(async s=>{assert.equal((await replay(s,[],{complete:true,check:async()=>false})).status,'REPLAY_NOT_REPRODUCED');assert.equal((await replay(s,[{pointer:'touch'}],{complete:true})).status,'REPLAY_UNSUPPORTED');assert.equal((await replay(s,[],{})).status,'REPLAY_UNSUPPORTED');});
  assert.equal(third.completion,'COMPLETED');
});

test('input boundary loss and unexpected game reload are explicitly incomplete',async()=>{
  // Test focus loss directly using a trusted browser focus transition to a blank
  // second tab, without observing input in that tab.
  const lost=await check(async s=>{await s.page.frameLocator('iframe').locator('#start').click();await s.page.keyboard.down('ArrowRight');const other=await s.context.newPage();await other.bringToFront();await s.page.waitForTimeout(50);});
  assert.equal(lost.eventLog,'EVENT_LOG_INCOMPLETE');assert(events(lost).some(e=>e.type==='input_gap'));
  const navigated=await check(async s=>{await s.page.frames()[1].evaluate(()=>location.reload());await new Promise(()=>{});});
  assert.equal(navigated.completion,'GAME_NAVIGATED');assert.equal(navigated.eventLog,'EVENT_LOG_INCOMPLETE');
});

test('timeout, interrupt, window close, browser error and exception preserve partial evidence',async()=>{
  for (const mode of ['TIMEOUT','USER_INTERRUPTED','WINDOW_CLOSED','BROWSER_ERROR','RECORDER_ERROR']) {
    const r=await check(async s=>{
      s.phase('input');await s.page.frameLocator('iframe').locator('#start').tap();await s.answer('input','PASS synthetic partial');
      if(mode==='USER_INTERRUPTED')s.interrupt();
      else if(mode==='WINDOW_CLOSED')await s.page.close();
      else if(mode==='BROWSER_ERROR'){const cdp=await s.context.newCDPSession(s.page);void cdp.send('Page.crash').catch(()=>{});}
      else if(mode==='RECORDER_ERROR')throw Error('PRIVATE_ERROR_SENTINEL');
      await new Promise(()=>{});
    },{timeoutMs:mode==='TIMEOUT'?2000:15000,installSignals:true});
    assert.equal(r.completion,mode);assert.equal(r.eventLog,'EVENT_LOG_INCOMPLETE');
    assert(existsSync(resolve(r.out,'input.png')));assert(events(r).some(e=>e.type==='pointerdown'));
    assert.equal(resultFile(r).phases.input.status,'HUMAN_REPORTED');
    assert(r.trace.status==='SAVED'||r.trace.reason==='TRACE_FINALIZATION_FAILED');
    assert(!JSON.stringify(r).includes('PRIVATE_ERROR_SENTINEL'));
  }
});

test('hash mismatch fails before launch, final recheck catches change, log budget is incomplete',async()=>{
  const mismatch=await check(async()=>assert.fail('must not open'),{entry:{...entry,sha256:'0'.repeat(64)}});
  assert.equal(mismatch.completion,'SOURCE_HASH_CHANGED'); assert.equal(mismatch.trace.reason,'TRACE_NOT_STARTED');
  let verifications=0;
  const changed=await check(async()=>{}, {verifySource:()=>{if(++verifications===2)throw Error('changed');return {method:'synthetic'};}});
  assert.equal(changed.completion,'SOURCE_HASH_CHANGED');assert.equal(changed.sourceUnchanged,false);
  const limited=await check(async s=>{s.phase('input');await s.page.frameLocator('iframe').locator('#start').click();await s.page.keyboard.press('ArrowRight');},{limits:{...LIMITS,events:2}});
  assert.equal(limited.completion,'COMPLETED');assert.equal(limited.eventLog,'EVENT_LOG_INCOMPLETE');assert.equal(limited.eventCount,2);
});

test('actual readline EOF and interrupted question save partial responses without waiting for deadline',async()=>{
  for(const mode of ['INPUT_CLOSED','USER_INTERRUPTED']){
    const input=new PassThrough(),output=new PassThrough();let questions=0;
    const r=await check(async s=>{
      output.on('data',()=>{if(++questions===1)setImmediate(()=>input.write('UNKNOWN synthetic rules\n'));else if(questions===2)setImmediate(()=>mode==='INPUT_CLOSED'?input.end():s.interrupt());});
      await collectOwnerAnswers(s,{input,output});
    });
    assert.equal(r.completion,mode);assert.equal(r.rules.status,'HUMAN_REPORTED');assert.equal(r.phases.start.status,'NOT_VERIFIED');
    assert.equal(r.eventLog,'EVENT_LOG_INCOMPLETE');
  }
});

test('abrupt process death retains flushed journal/checkpoint and explicit incomplete marker',async()=>{
  mkdirSync(root,{recursive:true});const ready=resolve(root,'crash-ready.json');
  if(existsSync(ready))writeFileSync(ready,'{}');
  const child=spawn(process.execPath,[import.meta.filename,'--crash-child'],{cwd:process.cwd(),stdio:'ignore'});
  let out;
  try {
    const until=Date.now()+12000;
    while(Date.now()<until){try{out=JSON.parse(readFileSync(ready)).out;if(out)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    assert(out,'child ready');child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
    const record=JSON.parse(readFileSync(resolve(out,'human-record.json')));
    assert.equal(record.eventLog,'EVENT_LOG_INCOMPLETE');assert.equal(record.completion,'RUNNING_EVENT_LOG_INCOMPLETE');
    assert.equal(record.phases.input.status,'HUMAN_REPORTED');assert(readFileSync(resolve(out,'actions.jsonl'),'utf8').includes('pointerdown'));
  } finally { if(child.exitCode===null)child.kill('SIGKILL'); }
});

test('both saved real pilots match exact original provenance; no gameplay execution',()=>{
  const plan=JSON.parse(readFileSync('.local/micro028-t1/manual-plan.json'));
  for(const id of ['manual-02','manual-01']){const e=plan.games.find(e=>e.id===id);const loaded=loadEntry(e);assert.equal(hash(loaded.bytes),e.sha256);assert.equal(loaded.verifySource().model,'gemma4:31b');assert.equal(e.status,'HUMAN_ACCEPTANCE_PENDING');}
});
}
