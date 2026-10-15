// TASK-013 HTML builder: assembles a standalone HTML5 artifact from verified
// primitives plus new LLM game logic. The skeleton provides Start/Pause
// controls, HUD, CSS and platform wiring; generated logic implements the game.
// TASK-016: the system prompt requires both reachable win AND loss conditions
// (user-stated rules win; a meaningful completion result is mandatory even for
// endless-style requests) and the skeleton paints a compact rules line.
import { primitives } from './primitives.ts';

export const ORCHESTRATOR_SYSTEM_PROMPT = `You write unique game logic code for YAPLIX's experimental orchestrator. Runtime helpers (canvas, loop, input, grid, physics, states, score, event bridge) are provided; only you implement the game itself.

Return ONLY game logic code: plain JavaScript, ES2023, no HTML/CSS/markup, no code fences, no commentary. Maximum 350 lines. It runs inside a provided HTML document; never build your own page structure.

Provided globals (do not redeclare): YAPcreateCanvas, YAPloop, YAPinput, YAPscan, YAPtouchPad, YAPgrid, YAPhitRects, YAPhitCircles, YAPmove, YAPtoward, YAPclamp, YAPwrap, YAPbounce, YAPfsm, YAPscore, YAPcrash, YAPregisterStart(handler), YAPsetLoop(loop), YAPsetPaused(bool). Platform instances also exist: _hud (-> show(jsonText) writes a read-only output element) and _game (YAPsession instance: start(), score(n), win(), lose(), restart(), started, ended, score).

Wired by the platform (do not rewire or duplicate): #yapStart calls your YAPregisterStart handler once per page; #yapPause toggles pause through YAPsetPaused and switches to Continue; the end overlay's data-yaplix-restart button reloads the page; visibilitychange auto-pauses while hidden.

Required structure (order matters):
1. const canvas=YAPcreateCanvas(W,H,{bg}) with explicit logical W and H sized for a >=320px phone; draw on canvas.ctx in logical coordinates. YAPcreateCanvas appends the canvas into #yapCanvasHost (already marked data-yaplix-input); do not create host elements yourself.
2. const input=YAPinput((name,phase)=>{...}) once; use input.isHeld(name) in update for smooth movement and phase 'down' for discrete actions. Attach pointerdown taps on canvas.canvas for direct touch. Call YAPtouchPad([{action:"left",label:"<"},...]) to show visible touch buttons at the bottom, then YAPscan().
3. Plan before writing: world, valid actions, collision rules, progression, reachable victory, avoidable loss. RULES ARE MANDATORY AND REAL: the task states win, loss, objective and progress - implement EXACTLY those as executable state checks. When the user named a rule it must be implemented verbatim; a derived default is a real requirement too. The session MUST be able to reach _game.win() through normal play (a reachable target: declared number of lines/waves/items/score) and _game.lose() through declared failure (collision, overflow, zero lives). Never ship loss-only games; if the request seems endless, use the given completion result (goal / level complete / score target or milestone) as the win condition. Grid games use YAPgrid; free movement uses the physics helpers; enemies behave for real (falling, pursuit, waves), never decorative. Never substitute a simpler clicker.
4. update(dt): only while the game is playing; advance gravity/movement, resolve collisions into real effects (board mutation, growth, removal, damage), check win/loss, _game.score(n) on real changes.
5. draw: render the full current scene every frame on canvas.ctx, including the pre-start menu view and the paused overlay text, so a paused page repaints the identical frozen frame.
6. Wire once: YAPregisterStart(()=>{ if already playing return; reset the world; _game.start() FIRST (it reports game_started); then start play; }); YAPsetLoop(YAPloop({update,draw})). Never auto-start. When the real terminal condition happens call _game.win() or _game.lose() exactly once; the platform shows the result overlay itself - do not draw your own game-over UI; stop world updates then (keep drawing the final frozen scene). The declared win/loss check must run every update: no hidden state shortcuts, no force-win hooks or test shortcuts.
7. The pause control freezes/resumes through YAPsetPaused; after resume the same input acts again, score and world retained, and no second loop starts. Restart (platform Reload on the end overlay) must return a fresh playable run of the same rules.
8. _hud.show(JSON.stringify({phase,score,...})) after real updates only, concise genre state: board and active piece for falling blocks; position/walls/collectibles/enemies for maze; waves/enemies for shooters. Include progress toward the win target (lines cleared, wave number, items collected, score/target). Read-only diagnostics.
9. Forbidden: eval, new Function, fetch, XMLHttpRequest, workers, localStorage, network, external assets, document.write, alert/confirm/prompt, reading window.parent or top, timers beyond requestAnimationFrame/setTimeout for game time, protected names/characters/copied assets, force-win hooks or test shortcuts.

The result executes in an offline sandboxed iframe; everything needed during play must be inside the code you return.`;

export interface PrimitiveRef { key: string; title: string; api: string; bytes: number }

export interface BuildTask {
  title: string;
  rules: string;
  derivation: string;
  chosen: PrimitiveRef[];
  code: string;
  /** TASK-016 mandatory rules banner: win/loss/controls, always visible, small. */
  rulesBanner: string;
}

const CSS = `html,body{margin:0;padding:0;height:100%;background:#101018;color:#eef;font:16px system-ui,sans-serif;overflow:hidden}
body>div,body>output{box-sizing:border-box}
button{font:inherit;min-height:44px;min-width:44px;padding:8px 12px;border-radius:8px;border:1px solid #445;background:#1c2030;color:#eef;touch-action:manipulation}
button:active{background:#2c3555}
#yapBar{position:fixed;left:0;right:0;top:0;display:flex;gap:8px;padding:6px;z-index:30}
#yapBar .spacer{flex:1}
.YAPpad{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;justify-content:center;padding:6px 4px calc(6px + env(safe-area-inset-bottom));z-index:30}
.YAPbtn{flex:1;max-width:130px;font-weight:600;user-select:none;-webkit-user-select:none}
.YAPhud{position:fixed;top:58px;left:50%;transform:translateX(-50%);max-width:96vw;font:11px ui-monospace,monospace;color:#8fd;padding:3px 9px;background:rgba(10,12,20,.82);border-radius:6px;white-space:pre-wrap;word-break:break-all;max-height:24vh;overflow:hidden;z-index:40}
.YAPoverlay{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(8,10,16,.78);z-index:50;text-align:center;padding:16px}
.YAPoverlay[hidden]{display:none}
#yapMenu{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:64px 16px;z-index:25;background:rgba(8,10,16,.72)}
#yapMenu.hidden{display:none}`;

const SKELETON = `<div id="yapBar"><span id="yapTitle" style="font-weight:600"></span><span class="spacer"></span><button id="yapPause" data-yaplix-pause>Pause</button></div>
<div id="yapMenu"><h1 id="yapHeading" style="margin:0;font-size:22px"></h1><p id="yapRules" style="margin:0;opacity:.85;max-width:90vw"></p><p id="yapBanner" style="margin:0;opacity:.75;max-width:90vw;font-size:13px"></p><button id="yapStart" data-yaplix-start>Start</button></div>
<output id="yapState" class="YAPhud" data-yaplix-state hidden></output>
<div id="yapCanvasHost" data-yaplix-input style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden"></div>
<div id="yapOverlay" class="YAPoverlay" hidden><h2 id="yapResult" style="margin:0"></h2><p id="yapResultScore" style="opacity:.85;margin:0"></p><button id="yapRestartBtn" data-yaplix-restart>Restart</button></div>`;

// Escapes a value for safe inline script placement: the compact form covers
// quotes and backslashes, plus explicit escapes for '<' so "</script" can never
// terminate the inline block early.
function jsString(value: string): string {
  const compact = JSON.stringify(value.slice(0, 4000));
  return compact.replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ' ');
}

export function buildHtml(task: BuildTask): string {
  const chosenKeys = [...new Set(task.chosen.map(p => p.key))];
  const runtime = primitives.filter(p => chosenKeys.includes(p.key)).map(p => p.source).join('\n');
  const title = task.title.trim().slice(0, 60) || 'YAPLIX game';
  const rules = task.rules.trim().slice(0, 400) || 'Reach the goal before the loss condition: arrows/WASD or the on-screen buttons.';
  // The rules banner is a plain visible summary (goal / loss / controls); JS
  // string so the JSON-ish content can never inject markup.
  const banner = jsString(task.rulesBanner.trim().slice(0, 400) || rules);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${jsString(title)}</title>
<style>${CSS}</style>
</head>
<body>
${SKELETON}
<script>
'use strict';
const _specTitle=${jsString(title)};
const _specRules=${jsString(rules)};
const _specBanner=${banner};
document.getElementById('yapTitle').textContent=_specTitle;
document.getElementById('yapHeading').textContent=_specTitle;
document.getElementById('yapRules').textContent=_specRules;
document.getElementById('yapBanner').textContent=_specBanner;
${runtime}
// ---------- platform wiring ----------
const _hud={show(text){document.getElementById('yapState').textContent=String(text==null?'':text).slice(0,2000);}};
function YAPfinishGame(won,finalScore){
  document.getElementById('yapResult').textContent=won?'You win!':'Game over';
  document.getElementById('yapResultScore').textContent='score: '+(+finalScore||0);
  document.getElementById('yapMenu').classList.add('hidden');
  document.getElementById('yapOverlay').hidden=false;
}
const _game=YAPsession({onReady(){document.getElementById('yapState').hidden=false;_hud.show('{"phase":"menu"}');},onWin(finalScore){YAPfinishGame(true,finalScore);},onLose(finalScore){YAPfinishGame(false,finalScore);}});
let YAPonStart=null;
function YAPregisterStart(handler){YAPonStart=handler;}
document.getElementById('yapStart').addEventListener('click',()=>{
  if(YAPonStart&&!_game.started){document.getElementById('yapMenu').classList.add('hidden');YAPonStart();}
});
let _loop=null;
function YAPsetLoop(loop){_loop=loop;}
const _pauseButton=document.getElementById('yapPause');
function YAPsetPaused(paused){
  const value=!!paused;
  if(_loop)_loop.setPaused(value);
  _pauseButton.dataset.yapPaused=value?'1':'';
  _pauseButton.textContent=value?'Continue':'Pause';
}
_pauseButton.addEventListener('click',()=>{YAPsetPaused(_pauseButton.dataset.yapPaused!=='1');});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&_game.started&&!_game.ended)YAPsetPaused(true);
});
document.getElementById('yapRestartBtn').addEventListener('click',()=>{if(_game.ended)_game.restart();});
// ---------- generated game logic ----------
${task.code}
</script>
</body>
</html>`;
}
