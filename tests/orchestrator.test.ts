import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primitives, primitivesByKey } from '../src/orchestrator/primitives.ts';
import { orchestratorSpec } from '../src/orchestrator/spec.ts';
import { selectMechanics } from '../src/orchestrator/selector.ts';
import { buildHtml } from '../src/orchestrator/html-builder.ts';
import { validateDocument } from '../src/generation.ts';
import { extractLogic, OrchestratorEngine, OrchestratorFailure } from '../src/orchestrator/engine.ts';
import type { OrchestratorArtifact } from '../src/orchestrator/engine.ts';
import { parseTarget, summarizeSession } from '../src/orchestrator/gameplay-check.ts';
import type { CodeTransport, Message, GenerationContext, TokenUsage } from '../src/transport.ts';
import { CloudOutputFailure, ProviderFailure } from '../src/transport.ts';
import { Fault } from '../src/contracts.ts';
import type { GameSpec } from '../src/contracts.ts';

// Static size budget: primitives are shipped into every orchestrator artifact.
test('orchestrator assembly: primitive sources are compact and unique', () => {
  assert.ok(primitives.length >= 6 && primitives.length <= 8, 'library must hold 6..8 primitives, got ' + primitives.length);
  assert.equal(new Set(primitives.map(p => p.source)).size, primitives.length, 'primitive sources must be unique');
  for (const p of primitives) {
    assert.ok(p.key && p.title && p.api && p.bytes > 0, p.key + ' metadata incomplete');
    assert.doesNotMatch(p.source, /<\s*\/\s*script/i, p.key + ' contains a closing script tag');
  }
});

function sampleLogic(): string {
  return [
    "const canvas=YAPcreateCanvas(320,240,{bg:'#0b0d14'});",
    "const input=YAPinput((name,phase)=>{});",
    'let score=0,phase="menu",x=160,y=220;',
    'YAPregisterStart(()=>{_game.start();phase="play";});',
    'YAPsetLoop(YAPloop({canvas,update(dt){if(phase==="play"){if(input.isHeld("left"))x-=120*dt;if(input.isHeld("right"))x+=120*dt;}},draw(){const c=canvas.ctx;c.fillStyle="#0b0d14";c.fillRect(0,0,320,240);c.fillStyle="#eee";c.fillRect(x-8,y-4,16,8);}}));',
    'YAPtouchPad([{action:"left",label:"<"},{action:"right",label:">"}]);',
  ].join('\n');
}

const CHOSEN = primitives.filter(p => ['canvas', 'loop', 'input', 'session', 'score', 'fsm'].includes(p.key));

test('orchestrator assembly: buildHtml embeds chosen primitives and generated logic', () => {
  const os = orchestratorSpec('Тетрис: стрелки влево-вправо, пробел — сброс. Линии взрываются.');
  assert.equal(os.spaceType, 'grid');
  const html = buildHtml({ title: 'Falling blocks', rules: 'Move with arrows, clear lines.', derivation: '{}', chosen: CHOSEN, code: sampleLogic(), rulesBanner: 'Goal: reach the target score | Lose: stack overflow | Win: target score' });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>$/);
  for (const p of CHOSEN) assert.ok(html.includes(p.source.trim().slice(0, 60)), 'primitive ' + p.key + ' missing from html');
  assert.ok(html.includes(sampleLogic().slice(0, 40)), 'generated logic missing');
  assert.ok(html.includes('Goal: reach the target score'), 'rules banner missing');
  assert.deepEqual(validateDocument(html), []);
  assert.ok(Buffer.byteLength(html) < 200000);
});

test('orchestrator assembly: skeleton marks exactly one required control per attribute', () => {
  const html = buildHtml({ title: 'T', rules: 'R', derivation: '{}', chosen: CHOSEN, code: sampleLogic(), rulesBanner: 'Goal G | Lose L | Win W' });
  assert.equal((html.match(/data-yaplix-start/g) || []).length, 1);
  assert.equal((html.match(/data-yaplix-pause/g) || []).length, 1);
  assert.equal((html.match(/data-yaplix-state/g) || []).length, 1);
  assert.equal((html.match(/data-yaplix-restart/g) || []).length, 1);
  assert.equal((html.match(/data-yaplix-input/g) || []).length, 1);
});

test('orchestrator extraction: accepts fenced plain js, rejects empty, oversized and markup payloads', () => {
  const code = 'const x=1;';
  assert.equal(extractLogic('```js\n' + code + '\n```'), code);
  assert.equal(extractLogic(code), code);
  assert.equal(extractLogic('  \n```html\n' + code + '\n```\n '), code);
  assert.throws(() => extractLogic('   '), /LLM_INVALID_RESPONSE/);
  assert.throws(() => extractLogic('```js\n\n```'), /LLM_INVALID_RESPONSE/);
  assert.throws(() => extractLogic('const x='.repeat(20000)), /ARTIFACT_TOO_LARGE/);
  assert.throws(() => extractLogic('</script><script>alert(1)</script>'), /LLM_UNSAFE_ARTIFACT/);
  assert.throws(() => extractLogic('<!-- drop -->'), /LLM_UNSAFE_ARTIFACT/);
});

function route(complete: CodeTransport['complete'], name: 'primary' | 'secondary' | 'local' = 'primary'): CodeTransport {
  return { route: name, provider: 'synthetic', model: 'requested-model', complete, readiness: async () => 'ready' };
}
function evidence(): Promise<{ profiles: number[]; offline: true; errors: 0; scope: 'startup-input-pause'; levels: string[] }> {
  return Promise.resolve({ profiles: [320, 390], offline: true, errors: 0, scope: 'startup-input-pause', levels: ['HTML_VALID', 'JS_EXECUTABLE', 'UI_VISIBLE', 'MOBILE_VERIFIED'] });
}
function specOf(prompt: string): GameSpec {
  return { prompt, audience: 'default', genre: 'custom/orchestrator', mechanics: [], controls: ['keyboard', 'touch'], responsive: true, webview: true };
}
function stubContext(patch: Partial<GenerationContext> = {}): GenerationContext {
  return { stage: () => {}, dispatch: () => {}, partial: () => {}, attempt: () => {}, ...patch };
}

function sampleDocument(): string {
  // Minimal but honest scratch-style document: static pages, real lifecycle.
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tap the dot</title></head><body style="margin:0;background:#101018;color:#eef;font:16px system-ui,sans-serif"><div style="position:fixed;left:0;right:0;top:0;display:flex;gap:8px;justify-content:center;padding:6px;z-index:30"><button id="pause" data-yaplix-pause style="min-height:44px">Pause</button></div><div id="menu" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(8,10,16,.72);z-index:25"><h1 style="margin:0">Tap the dot</h1><p style="margin:0">Tap the moving dot 3 times.</p><button id="s" data-yaplix-start style="min-height:44px">Start</button></div><output id="hud" data-yaplix-state hidden style="position:fixed;top:60px;left:8px;font:11px monospace;color:#8fd;z-index:40"></output><canvas id="c" data-yaplix-input width="300" height="260" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#161a2a"></canvas><div id="ov" style="position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(8,10,16,.85);z-index:50"><h2 id="r" style="margin:0"></h2><p id="rs" style="margin:0;opacity:.85"></p><button id="again" data-yaplix-restart style="min-height:44px">Restart</button></div><script>\'use strict\';const telemetry={session:null,next:0,ended:false};function report(type,data={}){if(!telemetry.session||telemetry.ended||parent===window)return;parent.postMessage({channel:\'yaplix\',event:{protocolVersion:1,eventId:crypto.randomUUID(),sessionId:telemetry.session.sessionId,versionId:telemetry.session.versionId,sequence:telemetry.next++,timestamp:Date.now(),type,data}},\'*\');if(type===\'session_ended\')telemetry.ended=true;}addEventListener(\'message\',({source,data})=>{if(source===parent&&data&&data.channel===\'yaplix_init\'&&data.protocolVersion===1&&!telemetry.session){telemetry.session=data;report(\'game_ready\');document.getElementById(\'hud\').hidden=false;document.getElementById(\'hud\').textContent=\'{"phase":"menu"}\';}});let phase="menu",target=null,score=0,last=null,requestId=0;const canvas=document.getElementById("c"),ctx=canvas.getContext("2d");function place(){target={x:30+Math.random()*240,y:30+Math.random()*200};}function frame(t){if(phase!=="play"){requestId=requestAnimationFrame(frame);return;}if(last===null)last=t;const dt=Math.min(0.05,(t-last)/1000);last=t;ctx.fillStyle="#161a2a";ctx.fillRect(0,0,300,260);if(target){ctx.fillStyle="#8fd";ctx.beginPath();ctx.arc(target.x,target.y,10,0,Math.PI*2);ctx.fill();}requestId=requestAnimationFrame(frame);}requestAnimationFrame(frame);function hudUpdate(){document.getElementById("hud").textContent=JSON.stringify({phase,score});}canvas.addEventListener("pointerdown",e=>{if(phase!=="play"||!target)return;const rect=canvas.getBoundingClientRect();const x=(e.clientX-rect.left)*(canvas.width/rect.width),y=(e.clientY-rect.top)*(canvas.height/rect.height);if(Math.hypot(x-target.x,y-target.y)<=14){score+=1;hudUpdate();report("score_changed",{score});if(score>=3){phase="won";hudUpdate();report("game_won");report("session_ended");document.getElementById("r").textContent="You win!";document.getElementById("rs").textContent="score: "+score;document.getElementById("ov").style.display="flex";}else place();}});addEventListener("keydown",e=>{if(e.code==="Space"&&phase==="play"&&target){score+=1;hudUpdate();report("score_changed",{score});if(score>=3){phase="won";hudUpdate();report("game_won");report("session_ended");document.getElementById("r").textContent="You win!";document.getElementById("rs").textContent="score: "+score;document.getElementById("ov").style.display="flex";}else place();}});document.getElementById("s").addEventListener("click",()=>{if(phase!=="menu"||!telemetry.session)return;document.getElementById("menu").style.display="none";score=0;phase="play";last=null;hudUpdate();report("game_started");place();});document.getElementById("pause").addEventListener("click",()=>{const p=document.getElementById("pause");if(phase==="play"){p.textContent="Continue";}else if(p.textContent==="Continue"){p.textContent="Pause";}});document.getElementById("again").addEventListener("click",()=>{if(telemetry.ended)location.reload();});<\/script></body></html>';
}

test('orchestrator engine: library path assembles LLM logic with full metadata in one call', async () => {
  let calls = 0;
  const seen: Message[][] = [];
  const engine = new OrchestratorEngine([route(async m => { calls++; seen.push(structuredClone(m)); return { code: sampleLogic(), model: 'actual-model' }; })], { check: evidence, repairs: 2 });
  const result = (await engine.generate(specOf('Тетрис с линиями: стрелки, пробел.'))) as unknown as OrchestratorArtifact;
  assert.equal(result.model, 'actual-model');
  assert.equal(result.method, 'llm_code');
  assert.equal(result.validationStatus, 'passed');
  assert.equal(calls, 1, 'verified logic must not trigger a repair');
  const run = result.orchestrator;
  assert.equal(run.selection, 'use-library');
  assert.ok(run.primitiveKeys.includes('grid'));
  assert.ok(!run.scratchFallback);
  assert.equal(run.llmCodeSha256.length, 64);
  assert.ok(run.specPrepMs >= 0 && run.selectMs >= 0 && run.buildMs >= 0);
  assert.equal(result.generation!.attempts.length, 1);
  assert.deepEqual(result.generation!.browser.levels, ['HTML_VALID', 'JS_EXECUTABLE', 'UI_VISIBLE', 'MOBILE_VERIFIED']);
  assert.ok(String(seen[0][0].content).includes('game logic'), 'system prompt present');
  assert.ok(String(seen[0][1].content).includes('Тетрис'), 'verbatim prompt forwarded');
});

test('orchestrator engine: novel mechanics fall back to full-document scratch path', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; return { code: sampleDocument(), model: 'actual-model' }; })], { check: evidence, repairs: 2 });
  const result = (await engine.generate(specOf('Ритм-игра: жми пробел в такт, счёт растёт'))) as unknown as OrchestratorArtifact;
  assert.equal(result.orchestrator.selection, 'scratch');
  assert.equal(result.orchestrator.scratchFallback, true);
  assert.ok(result.orchestrator.llmCodeChars >= 200, 'whole document counts as generated code');
  assert.equal(calls, 1);
});

test('orchestrator engine: browser/static feedback drives exactly one bounded repair (library path)', async () => {
  let calls = 0;
  const seen: Message[][] = [];
  const engine = new OrchestratorEngine([route(async m => { calls++; seen.push(structuredClone(m)); return { code: calls === 1 ? 'const broken=true;' : sampleLogic(), model: 'actual-model' }; })], {
    check: async () => { if (calls === 1) throw new Fault('LLM_UNSAFE_ARTIFACT', 502); return evidence(); },
    repairs: 2,
  });
  const result = (await engine.generate(specOf('змейка в лабиринте: стреляет, жизни'))) as unknown as OrchestratorArtifact;
  assert.equal(calls, 2, 'one repair attempt');
  assert.equal(result.validationStatus, 'passed');
  assert.equal(result.generation!.attempts.length, 2);
  assert.equal(result.generation!.attempts[0].errorCode, 'LLM_UNSAFE_ARTIFACT');
  assert.ok(seen[1].length >= 4, 'repair turn appended');
  assert.ok(String(seen[1][seen[1].length - 2].content).includes('const broken=true;'), 'assistant raw reply echoed');
  assert.ok(String(seen[1][seen[1].length - 1].content).includes('Verification rejected this game code'), 'repair feedback present');
});

test('orchestrator engine: scratch path repair asks for a complete document', async () => {
  let calls = 0;
  const seen: Message[][] = [];
  const engine = new OrchestratorEngine([route(async m => { calls++; seen.push(structuredClone(m)); return { code: calls === 1 ? 'broken fragment' : sampleDocument(), model: 'actual-model' }; })], {
    check: async () => { if (calls === 1) throw new Fault('LLM_INVALID_HTML', 502); return evidence(); },
    repairs: 1,
  });
  const result = (await engine.generate(specOf('Ритм-игра с уникальным геймплеем и счётом'))) as unknown as OrchestratorArtifact;
  assert.equal(calls, 2);
  assert.ok(String(seen[1][seen[1].length - 1].content).includes('one complete fresh HTML document'), 'document-level repair wording');
  assert.equal(result.orchestrator.scratchFallback, true);
});

test('orchestrator engine: exhausted repairs yield OrchestratorFailure with attempts', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; return { code: 'const broken=true;', model: 'actual-model' }; })], {
    check: async () => { throw new Fault('LLM_UNSAFE_ARTIFACT', 502); },
    repairs: 1,
  });
  await assert.rejects(engine.generate(specOf('тетрис: линии')), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'LLM_UNSAFE_ARTIFACT' && error.attempts.length === 2);
  assert.equal(calls, 2);
});

test('orchestrator engine: fallback route used when primary fails, accepted attempt on secondary', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; throw new Fault('LLM_NETWORK_OR_RESPONSE'); }), route(async () => { calls++; return { code: sampleLogic(), model: 'actual-model' }; }, 'secondary')], { check: evidence, repairs: 1 });
  const result = (await engine.generate(specOf('тетрис'))) as unknown as OrchestratorArtifact;
  assert.equal(calls, 2);
  assert.equal(result.generation!.fallback, true);
  assert.equal(result.generation!.attempts.at(-1)!.route, 'secondary');
});

test('orchestrator engine: quota cooldown stops repairs and fallback without saving', async () => {
  let calls = 0;
  const cooldowns: { provider: string; until: number; code: string }[] = [];
  const blocked: string[] = [];
  const engine = new OrchestratorEngine([route(async () => { calls++; throw new Fault('LLM_QUOTA', 502); }), route(async () => { calls++; throw new Fault('LLM_QUOTA', 502); }, 'secondary')], { check: evidence, repairs: 1 });
  await assert.rejects(engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext({
    cooldownRoute: (r, until, code) => cooldowns.push({ provider: r.provider, until, code }),
    blockRoute: r => blocked.push(r.provider),
  })), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'LLM_QUOTA');
  assert.equal(calls, 2, 'cooldown mirrors live.ts: one attempt per route, then break');
  assert.equal(cooldowns.length, 2, 'cooldown recorded for each route');
  assert.equal(blocked.length, 2);
});

test('orchestrator engine: rate limit surfaces ProviderFailure retryAt', async () => {
  let calls = 0;
  const retryMarks: number[] = [];
  const engine = new OrchestratorEngine([route(async () => { calls++; throw new ProviderFailure('LLM_RATE_LIMIT', 'requested-model', '', {}, 123456); })], { check: evidence, repairs: 1 });
  await assert.rejects(engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext({ retryAt: at => retryMarks.push(at) })), /LLM_RATE_LIMIT/);
  assert.equal(calls, 1);
  assert.ok(retryMarks.includes(123456));
});

test('orchestrator engine: truncated output prompts one compact repair request', async () => {
  let calls = 0;
  const seen: Message[][] = [];
  const engine = new OrchestratorEngine([route(async m => { calls++; seen.push(structuredClone(m)); if (calls === 1) throw new CloudOutputFailure('actual-model', '<!DOCTYPE html><html>trunc', { outputTokens: 12000 }); return { code: sampleLogic(), model: 'actual-model' }; })], { check: evidence, repairs: 1 });
  const result = (await engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext())) as unknown as OrchestratorArtifact;
  assert.equal(calls, 2, 'one bounded repair after truncation, mirrors live.ts');
  assert.equal(result.generation!.attempts[0].errorCode, 'LLM_OUTPUT_TRUNCATED');
  assert.equal(result.generation!.attempts[0].outputTokens, 12000, 'truncation usage attributed to the failed attempt');
  const lastUser = String(seen[1].at(-1)!.content);
  assert.ok(lastUser.length > 0, 'repair feedback present');
});

test('orchestrator engine: sandbox fatal stops everything without repair/fallback', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; return { code: sampleLogic(), model: 'actual-model' }; }), route(async () => { calls++; return { code: sampleLogic(), model: 'actual-model' }; }, 'secondary')], {
    check: async () => { throw new Fault('BROWSER_SANDBOX_UNAVAILABLE', 503); },
    repairs: 2,
  });
  await assert.rejects(engine.generate(specOf('тетрис')), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'BROWSER_SANDBOX_UNAVAILABLE');
  assert.equal(calls, 1, 'no fallback after sandbox misconfiguration');
});

test('orchestrator engine: single active slot and input guards', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(done => { release = done; });
  const engine = new OrchestratorEngine([route(async () => { await gate; return { code: sampleLogic(), model: 'm' }; })], { check: evidence });
  const first = engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext());
  await assert.rejects(engine.generate(specOf('тетрис')), /LLM_BUSY/);
  release();
  await first;
  await assert.rejects(engine.generate(specOf('тетрис'), { spec: specOf('x'), html: '<html></html>' } as never), /ORCHESTRATOR_NO_EDITS/);
  await assert.rejects(engine.generate(specOf('тетрис'), undefined, 'mock' as never), /INVALID_REQUIRED_METHOD/);
  await assert.rejects(engine.generate({ prompt: 'x' } as never), /INVALID_BOOLEAN|INVALID_STRING/);
  assert.throws(() => new OrchestratorEngine([]), /INVALID_LLM_CONFIGURATION/);
  assert.throws(() => new OrchestratorEngine([route(async () => ({ code: '', model: 'm' }))], { repairs: 5 }), /INVALID_LLM_CONFIGURATION/);
  assert.throws(() => new OrchestratorEngine([route(async () => ({ code: '', model: 'm' }))], { timeoutMs: 50 }), /INVALID_LLM_CONFIGURATION/);
});

test('orchestrator engine: timings recorded without a context', async () => {
  const engine = new OrchestratorEngine([route(async () => ({ code: sampleLogic(), model: 'actual-model' }))], { check: evidence });
  const result = (await engine.generate(specOf('падающие блоки, линии взрываются'))) as unknown as OrchestratorArtifact;
  const attempt = result.generation!.attempts.at(-1)!;
  assert.equal(attempt.outcome, 'accepted');
  assert.ok(attempt.elapsedMs >= (attempt.requestMs ?? 0));
  assert.ok(attempt.elapsedMs >= (attempt.validationMs ?? 0));
});

test('orchestrator engine: per-attempt token usage from transport response', async () => {
  const engine = new OrchestratorEngine([route(async () => ({ code: sampleLogic(), model: 'actual-model', outputTokens: 4321, reasoningTokens: 12 }))], { check: evidence });
  const result = (await engine.generate(specOf('тетрис'))) as unknown as OrchestratorArtifact;
  assert.equal(result.generation!.attempts.at(-1)!.outputTokens, 4321);
  assert.equal(result.generation!.attempts.at(-1)!.reasoningTokens, 12);
});

test('orchestrator engine: partial streaming updates flow through the context', async () => {
  const partials: string[] = [];
  const engine = new OrchestratorEngine([route(async (_m, _s, context) => {
    context?.partial('first chunk', 'stream-model');
    context?.partial('second chunk', 'stream-model', { outputTokens: 7 });
    return { code: sampleLogic(), model: 'stream-model', outputTokens: 10 };
  })], { check: evidence });
  const captured: string[] = [];
  const result = (await engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext({ partial: code => { captured.push(code); } }))) as unknown as OrchestratorArtifact;
  assert.deepEqual(partials, []);
  assert.ok(captured.includes('second chunk'));
  assert.equal(result.model, 'stream-model');
});

test('orchestrator engine: timeout abort marks attempt LLM_TIMEOUT and maps failure', async () => {
  const engine = new OrchestratorEngine([route((_m, signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Fault('LLM_TIMEOUT', 504))); }))], { check: evidence, repairs: 0, requestTimeoutMs: 1000, timeoutMs: 3000 });
  await assert.rejects(engine.generate(specOf('тетрис')), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'LLM_TIMEOUT');
});

test('orchestrator engine: external abort cancels inside a request', async () => {
  const external = new AbortController();
  const engine = new OrchestratorEngine([route((_m, signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Fault('LLM_TIMEOUT', 504))); }))], { check: evidence, repairs: 0, requestTimeoutMs: 60000, timeoutMs: 180000 });
  const pending = engine.generate(specOf('тетрис'), undefined, undefined, external.signal);
  setTimeout(() => external.abort(), 30);
  await assert.rejects(pending, (error: unknown) => error instanceof OrchestratorFailure && error.code === 'REQUEST_CANCELLED');
});

test('orchestrator engine: blocked routes in context are skipped without calls', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; return { code: sampleLogic(), model: 'actual-model' }; })], { check: evidence });
  await assert.rejects(engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext({ blockedRoutes: ['synthetic/requested-model'] })), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'LLM_ROUTES_UNAVAILABLE');
  assert.equal(calls, 0);
});

test('orchestrator engine: maxCalls honored before dispatch', async () => {
  let calls = 0;
  const engine = new OrchestratorEngine([route(async () => { calls++; return { code: 'const stillBroken=true;', model: 'actual-model' }; })], {
    check: async () => { throw new Fault('LLM_UNSAFE_ARTIFACT', 502); },
    repairs: 2,
  });
  await assert.rejects(engine.generate(specOf('тетрис'), undefined, undefined, undefined, stubContext({ maxCalls: 1 })), (error: unknown) => error instanceof OrchestratorFailure && error.code === 'LLM_UNSAFE_ARTIFACT');
  assert.equal(calls, 1);
});

test('orchestrator spec: derived spec stays verbatim-faithful, nothing invented', () => {
  const s = orchestratorSpec('Тетрис на клетчатом поле: стрелки влево-вправо, поворот, линии взрываются, проигрыш при переполнении.');
  assert.match(s.originalRequest, /Тетрис/);
  assert.equal(s.spaceType, 'grid');
  assert.ok(s.movement.includes('rotation') || s.movement.includes('gravity'), 'rotation or gravity recognized');
  assert.ok(s.interactions.includes('leveling') || s.lossRule !== null, 'progression or explicit loss captured');
});

test('orchestrator spec: snake mixed and arcade free classification', () => {
  assert.equal(orchestratorSpec('Змейка в лабиринте, стреляет, есть жизни').spaceType, 'mixed');
  assert.equal(orchestratorSpec('Космический корабль стреляет в астероиды').spaceType, 'free');
  const s = orchestratorSpec('Космический корабль стреляет в астероиды');
  assert.ok(s.movement.includes('shooting'), 'shooting recognized');
  assert.ok(s.entities.includes('projectiles'), 'projectiles recognized');
  assert.ok(s.entities.includes('obstacles'), 'asteroids are obstacles');
});

test('orchestrator spec: arrows imply movement, not shooting', () => {
  const s = orchestratorSpec('Тетрис: стрелки влево-вправо, поворот, линии взрываются.');
  assert.ok(!s.entities.includes('projectiles'), 'arrows must not classify as projectiles');
  assert.ok(!s.movement.includes('shooting'), 'arrow movement is not shooting');
});

test('orchestrator spec: unresolved prompts produce no invented rules', () => {
  const s = orchestratorSpec('Собери три точки');
  assert.equal(s.spaceType, 'unresolved');
  assert.equal(s.winRule, null);
  assert.equal(s.lossRule, null);
  assert.equal(s.rules.win, null, 'unresolved space invents no default win');
  assert.equal(s.rules.objective, null);
  assert.equal(selectMechanics(s).decision, 'scratch');
});

// --- TASK-016: mandatory rules -------------------------------------------------

test('task-016 rules: explicit user conditions win and set userRulesPriority', () => {
  const tetris = orchestratorSpec('Тетрис: стрелки влево-вправо, вращение, пробел — сброс. Линии из блоков исчезают со взрывом и добавляют очки. Проигрыш — когда блоки достигают верха.');
  assert.match(tetris.rules.loss!, /блоки достигают верха/, 'verbatim user loss captured');
  assert.ok(tetris.rules.userRulesPriority, 'user-stated conditions claim priority');
  assert.ok(tetris.rules.actions.includes('вращать (rotate)'), 'rotation listed as an action');
  assert.ok(tetris.rules.actions.some(a => a.includes('двигаться')), 'movement listed as an action');
  assert.ok(tetris.rules.restart && tetris.rules.mobile, 'restart and mobile always required');
});

test('task-016 rules: endless-style prompts get a documented default completion result', () => {
  const endless = orchestratorSpec('Змейка в лабиринте со стенами: змейка собирает яблоки, стреляет по преследующим врагам, у змейки есть жизни и счет.');
  assert.equal(endless.rules.win, 'Собрать целевое число предметов до поражения.', 'collectibles imply a finite target');
  assert.equal(endless.rules.loss, 'Потеря всех жизней завершает игру поражением.', 'lives imply a life loss rule without inventing text');
  assert.ok(endless.rules.interactions.length >= 3, 'mechanic interactions documented');
  assert.ok(!endless.rules.userRulesPriority, 'heuristic defaults do not claim user priority');
  const tetris = orchestratorSpec('Тетрис со взрывами: линии исчезают с очками, проигрыш при переполнении');
  assert.ok(tetris.rules.win, 'grid game still receives a reachable default win target');
  assert.match(tetris.rules.loss ?? '', /переполнени/i, 'loss text preserved');
});

test('task-016 rules: unresolved space stays rule-free, resolved spaces always complete', () => {
  const unresolved = orchestratorSpec('Собери три точки');
  assert.equal(unresolved.rules.win, null);
  assert.equal(unresolved.rules.loss, null);
  assert.equal(unresolved.rules.objective, null);
  for (const prompt of ['тетрис с линиями', 'корабль стреляет в астероиды', 'змейка собирает яблоки']) {
    const s = orchestratorSpec(prompt);
    assert.ok(s.rules.win, 'resolved space completes win: ' + prompt);
    assert.ok(s.rules.loss, 'resolved space completes loss: ' + prompt);
    assert.ok(s.rules.objective, 'resolved space completes objective: ' + prompt);
  }
});

test('orchestrator selector: library choices follow space and mechanics', () => {
  const grid = selectMechanics(orchestratorSpec('тетрис: линии, стрелки'));
  assert.equal(grid.decision, 'use-library');
  if (grid.decision === 'use-library') {
    assert.deepEqual([...grid.chosen.map(p => p.key)].sort(), ['canvas', 'fsm', 'grid', 'input', 'loop', 'score', 'session'].sort());
    assert.equal(grid.basis, 'grid');
  }
  const free = selectMechanics(orchestratorSpec('корабль стреляет в астероиды'));
  assert.equal(free.decision, 'use-library');
  if (free.decision === 'use-library') {
    assert.ok(free.chosen.some(p => p.key === 'physics'), 'shooter needs physics helpers');
    assert.ok(!free.chosen.some(p => p.key === 'grid'), 'free space has no grid');
  }
  const mixed = selectMechanics(orchestratorSpec('змейка в лабиринте, стреляет, преследует'));
  assert.equal(mixed.decision, 'use-library');
  if (mixed.decision === 'use-library') {
    const keys = mixed.chosen.map(p => p.key);
    assert.ok(keys.includes('grid') && keys.includes('physics'), 'mixed space selects both grid and physics');
    assert.equal(new Set(keys).size, keys.length, 'no duplicate primitives');
  }
});

// --- TASK-016: gameplay evidence checker ---------------------------------------

test('task-016 gameplay: parseTarget reads declared numeric and word targets', () => {
  assert.equal(parseTarget('Целевое число предметов (например, 10) до поражения'), 10);
  assert.equal(parseTarget('Достичь целевого счёта, например 200 очков'), 200);
  assert.equal(parseTarget('Clear 3 lines to win'), null, 'English prose with no target keyword is not a parsed target');
  assert.equal(parseTarget('target line count'), null);
  assert.equal(parseTarget('Проигрыш — когда блоки достигают верха.'), null);
  assert.equal(parseTarget(null), null);
  assert.equal(parseTarget('Win: collect 5 apples | Lose: enemy touches the head'), null, 'digits after keywords only; bare counts are not targets');
});

test('task-016 gameplay: summarizeSession maps observations to honest evidence levels', () => {
  const full = summarizeSession({ startWorks: true, inputChanged: true, hudStates: 5, scoreEvents: 7, ended: true, won: true, lost: false, finalScore: 200, errors: [], restartWorks: true, eventTypes: ['game_ready', 'game_started', 'score_changed', 'game_won', 'session_ended'] }, 200);
  const byAspect = Object.fromEntries(full.aspects.map(a => [a.aspect, a.level]));
  assert.equal(byAspect['html-runs'], 'VERIFIED');
  assert.equal(byAspect['input-works'], 'VERIFIED');
  assert.equal(byAspect['gameplay-observed'], 'VERIFIED');
  assert.equal(byAspect['win-reachable'], 'VERIFIED');
  assert.equal(byAspect['loss-reachable'], 'NOT_VERIFIED', 'unproven loss stays NOT VERIFIED, never PASS');
  assert.equal(byAspect['restart-works'], 'VERIFIED');

  const thin = summarizeSession({ startWorks: true, inputChanged: false, hudStates: 1, scoreEvents: 0, ended: false, won: false, lost: false, finalScore: null, errors: ['JAVASCRIPT_EXCEPTION'], restartWorks: null, eventTypes: ['game_ready'] }, null);
  const thinAspect = Object.fromEntries(thin.aspects.map(a => [a.aspect, a.level]));
  assert.equal(thinAspect['html-runs'], 'FAILED');
  assert.equal(thinAspect['input-works'], 'NOT_VERIFIED', 'static menu is not input proof but not a proven failure of input');
  assert.equal(thinAspect['gameplay-observed'], 'NOT_VERIFIED');
  assert.equal(thinAspect['win-reachable'], 'NOT_VERIFIED');
  assert.equal(thinAspect['loss-reachable'], 'NOT_VERIFIED');
  assert.equal(thinAspect['restart-works'], 'NOT_VERIFIED');
  assert.ok(thin.notes.some(n => n.includes('browser errors')), 'errors surface in notes');
});

test('task-016 gameplay: pixel-only sessions never claim gameplay or win', () => {
  const pixels = summarizeSession({ startWorks: true, inputChanged: true, hudStates: 1, scoreEvents: 0, ended: false, won: false, lost: false, finalScore: null, errors: [], restartWorks: null, eventTypes: ['game_ready', 'game_started'] }, null);
  const byAspect = Object.fromEntries(pixels.aspects.map(a => [a.aspect, a.level]));
  assert.equal(byAspect['gameplay-observed'], 'NOT_VERIFIED', 'canvas movement alone is not mechanics proof');
  assert.equal(byAspect['win-reachable'], 'NOT_VERIFIED');
  assert.equal(byAspect['loss-reachable'], 'NOT_VERIFIED');
});
