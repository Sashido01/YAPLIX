// Authored research substrate. Families are labels; behavior is composed from
// component registrations and a separately parsed browser-only logic module.
export const shell = `<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#101725;color:#f2f6ff;font:14px system-ui}body{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);display:grid;grid-template-rows:auto auto minmax(50px,1fr) auto;gap:4px;overflow:hidden}header{padding:4px 8px;display:flex;align-items:center;gap:8px}h1{font-size:16px;margin:0;flex:1}button{min-width:44px;min-height:44px;font:inherit;color:inherit;background:#253a51;border:1px solid #6387a8;border-radius:8px;touch-action:manipulation}button:active{background:#456a81}#hud{padding:2px 8px;min-height:20px}#world{min-height:0;display:flex;justify-content:center;align-items:center;overflow:hidden}canvas{display:block;touch-action:none;max-width:100%;max-height:100%;object-fit:contain;outline-offset:-3px}nav{display:flex;gap:6px;justify-content:center;padding:4px}nav button{flex:1;max-width:90px}#result{position:fixed;inset:0;background:#101725e8;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px}#result[hidden]{display:none}.note{font-size:11px;opacity:.8}img{width:20px;height:20px}body[data-theme=pixel-test] button{border-radius:0;border:2px solid #ead480}body[data-theme=pixel-test]{background:#24251e;color:#fff4c2}
</style><header><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cpath fill='%237cf5c3' d='M10 0 20 10 10 20 0 10Z'/%3E%3C/svg%3E"><h1 id="title"></h1><button id="start" data-yaplix-start>Start</button><button id="pause" data-yaplix-pause>Pause</button></header><div id="hud"></div><div id="world"><canvas tabindex="0" aria-label="Game board" data-yaplix-input></canvas></div><nav aria-label="Touch controls"><button data-action="left" aria-label="Left">←</button><button data-action="up" aria-label="Up">↑</button><button data-action="down" aria-label="Down">↓</button><button data-action="right" aria-label="Right">→</button><button data-action="select" aria-label="Select">●</button></nav><output data-yaplix-state hidden></output><div id="result" hidden><h2 id="resultText"></h2><p id="resultScore"></p><button id="restart" data-yaplix-restart>Restart</button><span class="note">Authored offline research fixture · no LLM inference</span></div>`;

export const coreSource = String.raw`
const B=blueprint, C=B.world.cols, R=B.world.rows, size=48;
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
canvas.width=C*size;canvas.height=R*size;
const components=[],listeners=new Map(),score=YAPscore(0);
let S,raf=0,last=null,disposed=false,reportedScore=0;
const clone=value=>JSON.parse(JSON.stringify(value));
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const cell=(x,y)=>y*C+x;
const inside=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<C&&y<R&&!B.world.walls.includes(cell(x,y));
const hit=(a,b)=>YAPhitRects({...a,w:1,h:1},{...b,w:1,h:1});
function snapshot(){return clone({...S,score:score.score,goal:S.goal});}
function emit(name,data={}){for(const fn of listeners.get(name)||[])fn(Object.freeze(clone(data)));}
function addScore(n){if(!finite(n,-10000,10000))throw Error('COMPONENT_SCORE');score.add(n);}
function damage(n){if(!finite(n,0,10))throw Error('MODULE_DAMAGE');S.health=Math.max(0,S.health-n);}
function spawn(e){
  if(!e||Object.keys(e).some(k=>!['id','kind','x','y','value','damage','behavior'].includes(k))||typeof e.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(e.id)||S.entities.length>=80||S.entities.some(v=>v.id===e.id)||!['item','enemy','obstacle'].includes(e.kind)||!inside(e.x,e.y)||!finite(e.value,0,100)||!finite(e.damage,0,10)||!['still','chase','scroll'].includes(e.behavior)||e.kind==='item'&&!B.components.includes('collect')||e.behavior==='chase'&&!B.components.includes('chase')||e.behavior==='scroll'&&!B.components.includes('scroll'))throw Error('MODULE_ENTITY');
  S.entities.push(clone(e));
}
function contacts(){
  for(const e of [...S.entities])if(hit(S.player,e)){
    if(e.kind==='item'){for(const c of components)if(c.contact)c.contact(e);}
    else{damage(e.damage);S.entities=S.entities.filter(v=>v.id!==e.id);emit('collision',e);}
  }
}
const api=Object.freeze({
  on(name,fn){if(!['start','step','collect','match','collision','tick'].includes(name)||typeof fn!=='function'||[...listeners.values()].reduce((n,v)=>n+v.length,0)>=32)throw Error('MODULE_LISTENER');const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);},
  state:()=>Object.freeze(snapshot()),entity:id=>{const e=S.entities.find(e=>e.id===id);return e?Object.freeze(clone(e)):null;},
  score(n){if(!finite(n,-1000,1000))throw Error('MODULE_SCORE');addScore(n);},damage,spawn,
  goal(metric,atLeast){if(!['score','collected','elapsed'].includes(metric)||!Number.isInteger(atLeast)||atLeast<1||atLeast>10000||metric==='elapsed'&&atLeast>=B.rules.loss.seconds)throw Error('MODULE_GOAL');S.goal={metric,atLeast};},
  behavior(id,behavior){if(!['still','chase','scroll'].includes(behavior)||behavior==='chase'&&!B.components.includes('chase')||behavior==='scroll'&&!B.components.includes('scroll'))throw Error('MODULE_BEHAVIOR');const e=S.entities.find(v=>v.id===id);if(e)e.behavior=behavior;},
  animate(id){if(S.entities.some(e=>e.id===id))S.flash={id,until:S.elapsed+.4};}
});
globalThis.constructorInstall=installer=>installer(api);
function reset(){
  const grid=YAPgrid(C,R,size);if(B.board)grid.restore(B.board.cells);
  score.reset();reportedScore=0;S={phase:'ready',health:B.player.health,elapsed:0,moves:0,collected:0,player:clone(B.player),entities:clone(B.entities),board:B.board?grid.cells:[],selected:null,cursor:0,goal:clone(B.rules.win),ticks:0,scrolls:0,flash:null,error:null};
  for(const c of components)if(c.reset)c.reset();
  document.querySelector('#result').hidden=true;document.querySelector('#start').hidden=false;document.querySelector('#pause').textContent='Pause';last=null;render();
}
function finish(won){if(S.phase!=='playing')return;S.phase=won?'won':'lost';report(won?'game_won':'game_lost');report('session_ended');document.querySelector('#resultText').textContent=won?'You win!':'Game over';document.querySelector('#resultScore').textContent='Score: '+score.score;document.querySelector('#result').hidden=false;}
function settle(){
  if(S.phase==='playing'){
    if(score.score!==reportedScore){reportedScore=score.score;report('score_changed',{score:score.score});}
    if(S.health<=0)finish(false);
    else if((S.goal.metric==='score'?score.score:S[S.goal.metric])>=S.goal.atLeast)finish(true);
    else if(S.elapsed>=B.rules.loss.seconds||S.moves>=B.rules.loss.moves)finish(false);
  }
  render();
}
function safe(fn){try{fn();}catch(e){S.error=String(e.message).slice(0,160);S.phase='error';report('game_error',{message:S.error});render();console.error(e);}}
function action(name){if(S.phase!=='playing')return;safe(()=>{for(const c of components)if(c.action)c.action(name);settle();});}
function render(){
  const pixel=B.theme==='pixel-test',bg=pixel?'#353a2b':'#122236',wall=pixel?'#8d804e':'#40566e';
  ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<R;y++)for(let x=0;x<C;x++){ctx.strokeStyle=pixel?'#575839':'#25394c';ctx.strokeRect(x*size,y*size,size,size);if(B.world.walls.includes(cell(x,y))){ctx.fillStyle=wall;ctx.fillRect(x*size+2,y*size+2,size-4,size-4);}}
  const colors=pixel?['#e49b64','#b1cb71','#91b8d0','#d9b2d6','#eed77c','#bec8bb']:['#ff8bba','#7cf5c3','#93acff','#ffe58f','#9af4ff','#e1a6ff'];
  if(B.board){S.board.forEach((n,i)=>{ctx.fillStyle=colors[n];ctx.fillRect(i%C*size+6,Math.floor(i/C)*size+6,size-12,size-12);});if(S.selected!==null){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(S.selected%C*size+3,Math.floor(S.selected/C)*size+3,size-6,size-6);ctx.lineWidth=1;}ctx.strokeStyle='#fff';ctx.strokeRect(S.cursor%C*size+10,Math.floor(S.cursor/C)*size+10,size-20,size-20);}
  else{
    for(const e of S.entities){ctx.fillStyle=e.kind==='item'?colors[1]:e.kind==='enemy'?colors[0]:wall;ctx.fillRect(e.x*size+7,e.y*size+7,size-14,size-14);ctx.fillStyle=bg;ctx.font='18px monospace';ctx.fillText(e.kind==='item'?'+':e.kind==='enemy'?'!':'X',e.x*size+18,e.y*size+31);if(S.flash&&S.flash.id===e.id&&S.elapsed<S.flash.until){ctx.strokeStyle='#fff';ctx.strokeRect(e.x*size+3,e.y*size+3,size-6,size-6);}}
    ctx.fillStyle=colors[2];ctx.fillRect(S.player.x*size+10,S.player.y*size+10,size-20,size-20);
  }
  document.querySelector('#hud').textContent='Goal '+S.goal.metric+' ≥ '+S.goal.atLeast+' · Score '+score.score+' · HP '+S.health+' · '+S.elapsed.toFixed(1)+'s · moves '+S.moves+' · '+S.phase;
  document.querySelector('[data-yaplix-state]').textContent=JSON.stringify(snapshot());
}
const events=new AbortController();
function boot(){
  document.querySelector('#title').textContent=B.title;document.body.dataset.theme=B.theme;reset();
  document.querySelector('#start').addEventListener('click',()=>safe(()=>{if(S.phase!=='ready')return;S.phase='playing';document.querySelector('#start').hidden=true;report('game_started');emit('start');canvas.focus();settle();}),{signal:events.signal});
  document.querySelector('#pause').addEventListener('click',()=>{if(!['playing','paused'].includes(S.phase))return;S.phase=S.phase==='paused'?'playing':'paused';document.querySelector('#pause').textContent=S.phase==='paused'?'Continue':'Pause';last=null;render();},{signal:events.signal});
  document.querySelector('#restart').addEventListener('click',()=>safe(reset),{signal:events.signal});
  document.addEventListener('keydown',e=>{const n={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',' ':'select',Enter:'select'}[e.key];if(n){e.preventDefault();if(!e.repeat)action(n);}},{signal:events.signal});
  document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);action(btn.dataset.action);},{signal:events.signal}));
  canvas.addEventListener('pointerdown',e=>{e.preventDefault();canvas.focus();if(S.phase!=='playing'||!B.board)return;const r=canvas.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/r.width*C),y=Math.floor((e.clientY-r.top)/r.height*R);if(inside(x,y))safe(()=>{select(cell(x,y));settle();});},{signal:events.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.phase==='playing'){S.phase='paused';document.querySelector('#pause').textContent='Continue';last=null;render();}},{signal:events.signal});
  addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);events.abort();listeners.clear();},{once:true});
  function frame(t){if(disposed)return;raf=requestAnimationFrame(frame);if(S.phase!=='playing'||document.hidden){last=null;return;}if(last===null)last=t;const dt=Math.min(.05,Math.max(0,(t-last)/1000));last=t;if(!dt)return;safe(()=>{S.elapsed+=dt;S.ticks+=dt;for(const c of components)if(c.tick)c.tick(dt);emit('tick',{dt});settle();});}
  raf=requestAnimationFrame(frame);
}
`;

export const componentSources = {
  move: String.raw`
components.push({action(name){const d={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[name];if(!d)return;const x=S.player.x+d[0],y=S.player.y+d[1];if(inside(x,y)){S.player.x=x;S.player.y=y;S.moves++;contacts();emit('step',{action:name});}}});
`,
  collect: "components.push({contact(e){S.entities=S.entities.filter(v=>v.id!==e.id);S.collected++;addScore(e.value);emit('collect',e);}});",
  chase: String.raw`
let chaseClock=0;
components.push({reset(){chaseClock=0;},tick(dt){chaseClock+=dt;if(chaseClock<2)return;chaseClock=0;for(const e of S.entities)if(e.behavior==='chase'){const dx=Math.sign(S.player.x-e.x),dy=Math.sign(S.player.y-e.y);if(dx&&inside(e.x+dx,e.y))e.x+=dx;else if(dy&&inside(e.x,e.y+dy))e.y+=dy;}contacts();}});
`,
  scroll: String.raw`
let scrollClock=0;
components.push({reset(){scrollClock=0;},tick(dt){scrollClock+=dt;if(scrollClock<.6)return;scrollClock=0;S.scrolls++;for(const e of S.entities)if(e.behavior==='scroll'){e.y++;if(e.y>=R)e.y=0;}contacts();}});
`,
  match3: String.raw`
let refillSeed=1;
function randomColor(){refillSeed=(Math.imul(refillSeed,1664525)+1013904223)>>>0;return refillSeed%B.board.colors;}
function matches(){const found=new Set();for(let y=0;y<R;y++)for(let x=0;x<C;x++)for(const[dx,dy]of[[1,0],[0,1]]){const run=[],color=S.board[cell(x,y)];let a=x,b=y;while(a<C&&b<R&&S.board[cell(a,b)]===color){run.push(cell(a,b));a+=dx;b+=dy;}if(run.length>=3)run.forEach(i=>found.add(i));}return [...found];}
function select(i){
  if(S.selected===null){S.selected=i;return;}
  const a=S.selected;S.selected=null;if(Math.abs(a%C-i%C)+Math.abs(Math.floor(a/C)-Math.floor(i/C))!==1)return;
  S.moves++;[S.board[a],S.board[i]]=[S.board[i],S.board[a]];
  let found=matches();if(!found.length){[S.board[a],S.board[i]]=[S.board[i],S.board[a]];return;}
  let cascades=0;
  while(found.length&&cascades++<8){addScore(found.length*10);emit('match',{count:found.length,cascade:cascades});for(const j of found)S.board[j]=-1;for(let x=0;x<C;x++){const col=[];for(let y=R-1;y>=0;y--)if(S.board[cell(x,y)]>=0)col.push(S.board[cell(x,y)]);for(let y=R-1;y>=0;y--)S.board[cell(x,y)]=col[R-1-y]??randomColor();}found=matches();}
  if(found.length)throw Error('MATCH_CASCADE_LIMIT');
}
components.push({reset(){refillSeed=1;},action(name){const d={left:-1,right:1,up:-C,down:C}[name];if(d!==undefined)S.cursor=Math.max(0,Math.min(C*R-1,S.cursor+d));else if(name==='select')select(S.cursor);}});
`,
};
