// TASK-013 mechanics library: minimal reusable browser-game primitives.
// Authored inline JS strings with no external runtime dependencies. Generated
// game logic calls these factories; the library only provides technical
// substrate (canvas/loop/input/grid/physics/states/score/bridge), never a
// ready-made game and never a genre template.
export interface Primitive {
  key: string;
  title: string;
  api: string;
  source: string;
  bytes: number;
}

const CANVAS_SOURCE = `
let YAPsessionApi=null;
function YAPcrash(error){
  const message=error&&error.message||String(error);
  try{if(YAPsessionApi)YAPsessionApi.error(message);}catch(_){}
  try{console.error(error);}catch(_e){}
}
function YAPcreateCanvas(w,h,opts){
  const W=Math.max(64,Math.round(+w||320)),H=Math.max(64,Math.round(+h||480));
  const canvas=document.createElement('canvas'),frame=document.getElementById('yapCanvasHost');
  if(!frame)throw new Error('yapCanvasHost is missing');
  canvas.style.cssText='display:block;max-width:100%;max-height:100%'+(opts&&opts.bg?';background:'+opts.bg:'');
  frame.appendChild(canvas);
  const ctx=canvas.getContext('2d');let drawCb=null;
  const fit=()=>{
    const rect=frame.getBoundingClientRect();
    const cw=Math.max(1,Math.floor(Math.min(rect.width,rect.height*W/H)));
    const ch=Math.max(1,Math.floor(Math.min(rect.height,rect.width*H/W)));
    canvas.style.width=cw+'px';canvas.style.height=ch+'px';
    canvas.width=Math.max(1,Math.round(cw*devicePixelRatio));
    canvas.height=Math.max(1,Math.round(ch*devicePixelRatio));
    const scale=canvas.width/W;
    ctx.imageSmoothingEnabled=false;ctx.setTransform(scale,0,0,scale,0,0);
    ctx.clearRect(0,0,W,H);
    if(drawCb)try{drawCb(ctx);}catch(error){YAPcrash(error);}
  };
  addEventListener('resize',fit);fit();
  return{canvas,ctx,onDraw(fn){drawCb=fn;},redraw:fit,logicalW:W,logicalH:H};
}
`;

const LOOP_SOURCE = `
function YAPloop(options){
  const o=options||{};let last=null,playing=true,paused=false,raf=0;
  if(o.canvas&&o.draw)o.canvas.onDraw(o.draw);
  function frame(t){
    if(!playing)return;
    raf=requestAnimationFrame(frame);
    try{
      if(paused){last=null;}
      else{if(last===null)last=t;const dt=Math.min(Math.max((t-last)/1000,0),o.maxDt||0.05);last=t;if(o.update&&dt>0)o.update(dt,t/1000);}
      if(o.draw)o.draw();
    }catch(error){YAPcrash(error);playing=false;cancelAnimationFrame(raf);}
  }
  raf=requestAnimationFrame(frame);
  return{setPaused(v){if(paused===!!v)return;paused=!!v;last=null;if(o.draw&&!paused)setTimeout(o.draw,0);},isPaused(){return paused;},isPlaying(){return playing;},stop(){playing=false;cancelAnimationFrame(raf);}};
}
`;

const INPUT_SOURCE = `
const YAPinputs=[];
function YAPinput(handler){
  const held=new Set();
  const down=name=>{if(!held.has(name)){held.add(name);emit(name,'down');}};
  const up=name=>{if(held.has(name)){held.delete(name);emit(name,'up');}};
  function emit(name,phase){try{handler(name,phase);}catch(error){YAPcrash(error);}}
  const keyName=e=>({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Space:'space',Enter:'enter',KeyZ:'z',KeyX:'x',KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d'}[e.code]||(/^[a-z0-9]$/.test(e.key)?e.key.toLowerCase():null));
  addEventListener('keydown',e=>{const name=keyName(e);if(name){e.preventDefault();down(name);}});
  addEventListener('keyup',e=>{const name=keyName(e);if(name)up(name);});
  function bind(el,name){
    if(!el||el._yapAction)return;el._yapAction=name;
    el.addEventListener('pointerdown',e=>{e.preventDefault();down(name);},{passive:false});
    const release=()=>up(name);
    el.addEventListener('pointerup',release);el.addEventListener('pointercancel',release);el.addEventListener('pointerleave',release);
  }
  function scan(){
    document.querySelectorAll('[data-yaplix-action]').forEach(el=>{if(!el._yapAction)bind(el,el.getAttribute('data-yaplix-action'));});
  }
  const api={isHeld:name=>held.has(name),burst(name){down(name);setTimeout(()=>up(name),60);},scan};
  YAPinputs.push({bind,scan});
  return api;
}
function YAPscan(){
  for(const entry of YAPinputs)entry.scan();
}
function YAPtouchPad(buttons,place){
  const bar=document.createElement('div');bar.className='YAPpad';
  if(place==='top')bar.style.top='0';else bar.style.bottom='0';
  for(const b of buttons||[]){
    const btn=document.createElement('button');btn.type='button';btn.className='YAPbtn';
    btn.setAttribute('data-yaplix-action',b.action);btn.textContent=b.label;
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);YAPscan();
  return bar;
}
`;

const GRID_SOURCE = `
function YAPgrid(cols,rows,cell){
  const C=Math.max(1,Math.round(cols||8)),R=Math.max(1,Math.round(rows||8)),S=Math.max(4,Math.round(cell||24));
  const cells=new Array(C*R).fill(0);
  return{
    cols:C,rows:R,cell:S,cells,
    get(x,y){return x>=0&&y>=0&&x<C&&y<R?cells[y*C+x]:undefined;},
    set(x,y,v){if(x>=0&&y>=0&&x<C&&y<R)cells[y*C+x]=v;},
    clear(){cells.fill(0);},
    clone(){return cells.slice();},
    restore(snapshot){if(snapshot&&snapshot.length===cells.length)for(let i=0;i<cells.length;i++)cells[i]=snapshot[i];},
    forEach(fn){for(let y=0;y<R;y++)for(let x=0;x<C;x++)if(cells[y*C+x])fn(x,y,cells[y*C+x]);},
    neighbors(x,y,diagonal){
      const list=[];const dirs=diagonal?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
      for(const[dx,dy]of dirs){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<C&&ny<R)list.push([nx,ny,cells[ny*C+nx]]);}
      return list;
    },
    px(x){return x*S;},py(y){return y*S;}
  };
}
`;

const PHYSICS_SOURCE = `
function YAPhitRects(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function YAPhitCircles(a,b){const dx=a.x-b.x,dy=a.y-b.y,r=a.r+b.r;return dx*dx+dy*dy<r*r;}
function YAPmove(o,vx,vy,dt){o.x+=(+vx||0)*dt;o.y+=(+vy||0)*dt;return o;}
function YAPtoward(o,tx,ty,speed,dt){const dx=tx-o.x,dy=ty-o.y,d=Math.hypot(dx,dy)||1;o.x+=dx/d*speed*dt;o.y+=dy/d*speed*dt;return o;}
function YAPclamp(o,maxX,maxY){if(o.x<0)o.x=0;if(o.x>maxX)o.x=maxX;if(o.y<0)o.y=0;if(o.y>maxY)o.y=maxY;return o;}
function YAPwrap(o,maxX,maxY,margin){const k=margin||0;if(o.x<-k)o.x=maxX+k;if(o.x>maxX+k)o.x=-k;if(o.y<-k)o.y=maxY+k;if(o.y>maxY+k)o.y=-k;return o;}
function YAPbounce(o,maxX,maxY){if(o.x<0){o.x=0;o.vx=Math.abs(o.vx||0);}if(o.x>maxX){o.x=maxX;o.vx=-Math.abs(o.vx||0);}if(o.y<0){o.y=0;o.vy=Math.abs(o.vy||0);}if(o.y>maxY){o.y=maxY;o.vy=-Math.abs(o.vy||0);}return o;}
`;

const FSM_SOURCE = `
function YAPfsm(states,initial){
  let current=initial;
  return{
    get state(){return current;},
    is(s){return current===s;},
    set(next){if(next===current||!((states[current]||[]).includes(next)))return false;current=next;return true;}
  };
}
`;

const SCORE_SOURCE = `
function YAPscore(initial){
  let value=Math.round(+initial||0),best=0;
  return{
    get score(){return value;},
    add(n){const v=Math.round(+n||0);if(v)value+=v;return value;},
    reset(){value=0;},
    best(){best=Math.max(best,value);return best;}
  };
}
`;

const SESSION_SOURCE = `
function YAPsession(handlers){
  const h=handlers||{};const S={session:null,seq:0,started:false,ended:false,endedSent:false,score:0,lastScore:0};
  function send(type,data){
    if(!S.session||S.endedSent||window.parent===window)return;
    try{window.parent.postMessage({channel:'yaplix',event:{protocolVersion:1,eventId:crypto.randomUUID(),sessionId:S.session.sessionId,versionId:S.session.versionId,sequence:S.seq++,timestamp:Date.now(),type,data:data||{}}},'*');}catch(_){}
    if(type==='session_ended')S.endedSent=true;
  }
  addEventListener('message',e=>{
    if(S.session||e.source!==window.parent||!e.data||e.data.channel!=='yaplix_init'||e.data.protocolVersion!==1)return;
    if(typeof e.data.sessionId!=='string'||typeof e.data.versionId!=='string')return;
    S.session=e.data;send('game_ready');
    try{(h.onReady||function(){})(e.data);}catch(error){YAPcrash(error);}
  });
  function terminal(won,cb){
    if(!S.started||S.ended)return false;S.ended=true;
    if(S.score!==S.lastScore){S.lastScore=S.score;send('score_changed',{score:S.score});}
    send(won?'game_won':'game_lost');send('session_ended');
    try{(cb||function(){})(S.score);}catch(error){YAPcrash(error);}
    return true;
  }
  const api={
    get started(){return S.started;},get ended(){return S.ended;},get score(){return S.score;},
    start(){if(S.started||S.ended)return false;S.started=true;send('game_started');return true;},
    score(n){const v=Math.round(+n||0);if(!S.started||S.ended||v===S.lastScore)return false;S.lastScore=v;S.score=v;send('score_changed',{score:v});return true;},
    win(){return terminal(true,h.onWin);},
    lose(){return terminal(false,h.onLose);},
    restart(){if(!S.ended)return false;try{location.reload();}catch(_){}return true;},
    error(message){try{send('game_error',{message:String(message).slice(0,512)});}catch(_){}}
  };
  YAPsessionApi=api;return api;
}
`;

const PRIMITIVE_DEFS: { key: string; title: string; api: string; source: string }[] = [
  {
    key: 'canvas',
    title: 'Mobile Canvas 2D with letterbox scaling for any screen',
    api: 'YAPcreateCanvas(w,h,{pad,bg}) -> {canvas,ctx,onDraw(fn),redraw(),logicalW,logicalH}. Draws in logical coordinates w*h; canvas is sized responsively and marked data-yaplix-input automatically. pad = bottom padding px for a touch pad.',
    source: CANVAS_SOURCE,
  },
  {
    key: 'loop',
    title: 'requestAnimationFrame game loop with capped dt and pause',
    api: 'YAPloop({canvas,update(dt,t),draw(),maxDt}) -> {setPaused(bool),isPaused(),isPlaying(),stop()}. draw runs every frame including menus and pause; update only while playing. While paused the canvas stays frozen: draw must repaint the identical scene.',
    source: LOOP_SOURCE,
  },
  {
    key: 'input',
    title: 'Unified keyboard + touch input with optional on-screen button pad',
    api: 'const input=YAPinput((name,phase)=>{}) -> {isHeld(name),burst(name)}. Names: left,right,up,down,space,enter,z,x,w,a,s,d and single chars. Poll input.isHeld(name) inside update for continuous movement; phase "down" for discrete actions. YAPtouchPad([{action:"left",label:"<"},{action:"rotate",label:"R"},{action:"drop",label:"V"},...]) renders visible touch buttons (bottom, place:"top" for top) wired like keyboard keys; call YAPscan() after creating them. Tap the canvas itself via pointerdown on canvas.canvas for direct touch.',
    source: INPUT_SOURCE,
  },
  {
    key: 'grid',
    title: 'Integer grid with cell coordinates and neighbor walk',
    api: 'YAPgrid(cols,rows,cell) -> {cols,rows,cell,get(x,y),set(x,y,v),clear(),clone(),restore(snap),forEach(cb),neighbors(x,y,diagonal),px(x),py(y)} for board games, mazes and cell movement.',
    source: GRID_SOURCE,
  },
  {
    key: 'physics',
    title: 'Motion helpers and AABB/circle collision tests',
    api: 'YAPhitRects(a,b), YAPhitCircles(a,b) with {x,y,w|h|r}; YAPmove(o,vx,vy,dt), YAPtoward(o,tx,ty,speed,dt), YAPclamp(o,maxX,maxY), YAPwrap(o,maxX,maxY,margin), YAPbounce(o,maxX,maxY). Speeds are px/second.',
    source: PHYSICS_SOURCE,
  },
  {
    key: 'fsm',
    title: 'Game phase state machine',
    api: 'const fsm=YAPfsm({menu:["playing"],playing:["paused","win","lose"],paused:["playing","win","lose"]},"menu") -> {state,is(s),set(next)}; set only follows listed transitions.',
    source: FSM_SOURCE,
  },
  {
    key: 'score',
    title: 'Score counter and read-only diagnostic output element',
    api: 'const score=YAPscore(0) -> {score,add(n),reset(),best()}; _hud (created by the platform) -> _hud.show(jsonText) writes into a read-only output data-yaplix-state element. Call it after real updates.',
    source: SCORE_SOURCE,
  },
  {
    key: 'session',
    title: 'YAPLIX event bridge v1 plus start/score/win/lose lifecycle',
    api: 'Not created by you: use the platform instance _game -> _game.start(), _game.score(n), _game.win(), _game.lose(), _game.restart(), _game.started, _game.ended, _game.score. start() must be called exactly once inside your YAPonStart handler BEFORE any state update that can emit events; score/win/lose are ignored before start or after the session ended.',
    source: SESSION_SOURCE,
  },
];

export const primitives: Primitive[] = PRIMITIVE_DEFS.map(def => ({ ...def, bytes: Buffer.byteLength(def.source, 'utf8') }));
export const primitivesByKey = new Map(primitives.map(p => [p.key, p]));
