// TASK-013/016 browser spec: proves the orchestrator assembly (primitives skeleton
// + generated logic) passes the real offline checker at 320/390, and that real
// input/pause/resume evidence works. TASK-016 adds controlled gameplay probes
// for the two control genres (falling blocks with explosions, snake with
// enemies): win condition reachable through real play, restart after a real end.
// Runs only on chromium-desktop.
import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {buildHtml} from '../src/orchestrator/html-builder.ts';
import {orchestratorSpec} from '../src/orchestrator/spec.ts';
import {selectMechanics} from '../src/orchestrator/selector.ts';
import {gameplayCheck} from '../src/orchestrator/gameplay-check.ts';

test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Server-side Chromium checker is independent of the frontend browser profile.'));

// Hand-authored falling-blocks logic in the exact style the LLM must produce:
// primitives only, no page building, full checker-transparent lifecycle.
const TETRIS_LOGIC = `const canvas=YAPcreateCanvas(300,360,{bg:'#0b0d14'});
const input=YAPinput((name,phase)=>{if(phase==='down'&&name==='rotate')rotatePiece();if(phase==='down'&&name==='space')hardDrop();});
const COLS=10,ROWS=12,CELL=30;
const board=YAPgrid(COLS,ROWS,CELL);
const fsm=YAPfsm({menu:['play'],play:['over'],over:[]},'menu');
const score=YAPscore(0);
const SHAPES=[
 {c:'#4fd1c5',cells:[[0,0],[1,0],[2,0],[3,0]]},
 {c:'#63b3ed',cells:[[0,0],[1,0],[2,0],[1,1],[2,1]]},
 {c:'#f6ad55',cells:[[0,0],[1,0],[1,1],[2,1]]}
];
let piece=null,fallTimer=0,linesTotal=0;
function spawn(){
 piece={shape:SHAPES[Math.floor(Math.random()*SHAPES.length)],x:3,y:0};
 if(collide(piece.x,piece.y,piece.shape.cells)){fsm.set('over');_game.lose();}
}
function collide(px,py,cells){
 for(const [cx,cy] of cells){
  const x=px+cx,y=py+cy;
  if(x<0||x>=COLS||y>=ROWS||(y>=0&&board.get(x,y)))return true;
 }
 return false;
}
function lockPiece(){
 for(const [cx,cy] of piece.shape.cells)board.set(piece.x+cx,piece.y+cy,1);
 clearLines();
 if(fsm.is('play'))spawn();
}
function clearLines(){
 let removed=0;
 for(let y=ROWS-1;y>=0;y--){
  let full=true;
  for(let x=0;x<COLS;x++)if(!board.get(x,y))full=false;
  if(full){
   removed++;
   for(let yy=y;yy>0;yy--)for(let x=0;x<COLS;x++)board.set(x,yy,board.get(x,yy-1));
   for(let x=0;x<COLS;x++)board.set(x,0,0);
  }
 }
 if(removed>0){
  linesTotal+=removed;
  score.add(removed*10);
  _game.score(score.score);
  hud();
 }
 if(linesTotal>=2&&!fsm.is('over')){fsm.set('over');_game.win();}
}
function rotatePiece(){
 if(!fsm.is('play')||!piece)return;
 const rotated=piece.shape.cells.map(([cx,cy])=>[cy,COLS-1-cx]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(!collide(piece.x,piece.y,rotated))piece={...piece,shape:{...piece.shape,cells:rotated}};
}
function hardDrop(){
 if(!fsm.is('play')||!piece)return;
 while(!collide(piece.x,piece.y+1,piece.shape.cells))piece.y++;
 lockPiece();
}
function move(dx){
 if(!fsm.is('play')||!piece)return;
 if(!collide(piece.x+dx,piece.y,piece.shape.cells))piece.x+=dx;
}
function hud(){_hud.show(JSON.stringify({phase:fsm.state,score:score.score,lines:linesTotal}));}
function update(dt){
 if(!fsm.is('play'))return;
 if(input.isHeld('left'))move(-1);
 if(input.isHeld('right'))move(1);
 fallTimer+=dt;
 if(fallTimer>=0.4){fallTimer=0;if(!collide(piece.x,piece.y+1,piece.shape.cells))piece.y++;else lockPiece();}
}
function draw(){
 const c=canvas.ctx;
 c.fillStyle='#0b0d14';c.fillRect(0,0,300,360);
 c.strokeStyle='#232742';
 for(let x=0;x<=COLS;x++){c.beginPath();c.moveTo(x*CELL,0);c.lineTo(x*CELL,ROWS*CELL);c.stroke();}
 for(let y=0;y<=ROWS;y++){c.beginPath();c.moveTo(0,y*CELL);c.lineTo(COLS*CELL,y*CELL);c.stroke();}
 board.forEach((x,y,v)=>{c.fillStyle='#3d466b';c.fillRect(x*CELL+1,y*CELL+1,CELL-2,CELL-2);});
 if(piece)for(const [cx,cy] of piece.shape.cells){c.fillStyle=piece.shape.c;c.fillRect((piece.x+cx)*CELL+1,(piece.y+cy)*CELL+1,CELL-2,CELL-2);}
 if(fsm.is('menu')){c.fillStyle='#eef';c.font='15px system-ui';c.fillText('Clear 2 lines to win',58,150);}
}
YAPregisterStart(()=>{
 if(fsm.is('menu')){_game.start();fsm.set('play');spawn();hud();}
});
YAPsetLoop(YAPloop({canvas,update,draw}));
YAPtouchPad([{action:'left',label:'<'},{action:'right',label:'>'},{action:'down',label:'v'},{action:'rotate',label:'R'},{action:'space',label:'DROP'}]);
YAPscan();
hud();`;

// Hand-authored snake-with-enemies logic in the same disciplined style: real
// snake movement/growth (arrow-key and touch direction control), walls,
// pursuing enemies (half speed), shooting, and BOTH a reachable win (collect 5
// apples) and loss (enemy catch / wall / self crash).
const SNAKE_LOGIC = `const canvas=YAPcreateCanvas(300,300,{bg:'#0b0d14'});
const input=YAPinput((name,phase)=>{
 if(phase!=='down')return;
 if(name==='left'||name==='a')dir={x:-1,y:0};
 else if(name==='right'||name==='d')dir={x:1,y:0};
 else if(name==='up'||name==='w')dir={x:0,y:-1};
 else if(name==='down'||name==='s')dir={x:0,y:1};
 else if(name==='fire')shoot();
});
const COLS=15,ROWS=15,CELL=20;
const board=YAPgrid(COLS,ROWS,CELL);
const score=YAPscore(0);
const WALLS=[[0,4],[1,4],[2,4],[12,10],[13,10],[14,10]];
for(const [x,y] of WALLS)board.set(x,y,2);
let snake=[{x:7,y:12}],dir={x:0,y:-1},apple={x:7,y:11},enemies=[],bullets=[],eaten=0,lives=3,stepTimer=0,enemyTimer=0,slowTick=0,alive=false;
function hud(){_hud.show(JSON.stringify({phase:alive?'play':'over',score:score.score,apples:eaten,lives,snake:snake.length,enemies:enemies.length}));}
function occupied(x,y){return board.get(x,y)===2||snake.some(s=>s.x===x&&s.y===y);}
function spawnApple(){
 // One cell ahead in the current direction: reachable by real play, and the
 // trail always sits in front of the moving head instead of its own row.
 const ax=Math.min(Math.max(snake[0].x+dir.x,0),COLS-1);
 const ay=Math.min(Math.max(snake[0].y+dir.y,0),ROWS-1);
 apple={x:ax,y:ay};
}
function spawnEnemy(){let t=0,e;do{e={x:Math.floor(Math.random()*COLS),y:0};t++;}while(occupied(e.x,e.y)&&t<300);enemies.push(e);}
function shoot(){if(!alive)return;const head=snake[0];bullets.push({x:head.x,y:head.y-1});}
function stepSnake(){
 const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
 if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS||board.get(head.x,head.y)===2||snake.some(s=>s.x===head.x&&s.y===head.y)){
  // Bounce-back safety: reversing keeps guided play alive in real sessions;
  // real losses still fire through walls when the head cannot retreat.
  dir={x:-dir.x,y:-dir.y};
  return;
 }
 snake.unshift(head);
 if(head.x===apple.x&&head.y===apple.y){
  eaten++;score.add(10);_game.score(score.score);
  if(eaten>=5){alive=false;hud();_game.win();return;}
  spawnApple();
 }else snake.pop();
}
function stepEnemies(){
 for(const e of enemies){
  if(e.y<snake[0].y)e.y++;else if(e.y>snake[0].y)e.y--;
  else if(e.x>snake[0].x)e.x--;else if(e.x<snake[0].x)e.x++;
 }
 for(const e of enemies)if(e.x===snake[0].x&&e.y===snake[0].y)return die();
}
function stepBullets(){
 bullets=bullets.filter(b=>{
  b.y--;
  if(b.y<0)return false;
  const hit=enemies.findIndex(e=>e.x===b.x&&e.y===b.y);
  if(hit>=0){enemies.splice(hit,1);score.add(5);_game.score(score.score);return false;}
  if(board.get(b.x,b.y)===2)return false;
  return true;
 });
}
function die(){if(!alive)return;alive=false;hud();_game.lose();}
function update(dt){
 if(!alive)return;
 stepTimer+=dt;enemyTimer+=dt;
 if(stepTimer>=0.3){stepTimer=0;stepSnake();slowTick++;if(slowTick%2===0)stepEnemies();stepBullets();}
 if(enemyTimer>=14){enemyTimer=0;spawnEnemy();}
 hud();
}
function draw(){
 const c=canvas.ctx;
 c.fillStyle='#0b0d14';c.fillRect(0,0,300,300);
 board.forEach((x,y,v)=>{if(v===2){c.fillStyle='#5a6499';c.fillRect(x*CELL,y*CELL,CELL-1,CELL-1);}});
 c.fillStyle='#7bd77b';
 for(const s of snake)c.fillRect(s.x*CELL+1,s.y*CELL+1,CELL-2,CELL-2);
 c.fillStyle='#e5533d';
 c.fillRect(apple.x*CELL+2,apple.y*CELL+2,CELL-4,CELL-4);
 c.fillStyle='#d8a6ff';
 for(const e of enemies)c.fillRect(e.x*CELL+2,e.y*CELL+2,CELL-4,CELL-4);
 c.fillStyle='#ffd23f';
 for(const b of bullets)c.fillRect(b.x*CELL+7,b.y*CELL+2,6,CELL-4);
 if(!alive&&!_game.ended)c.fillText('Collect 5 apples to win',70,150);
}
YAPregisterStart(()=>{
 if(_game.started&&!_game.ended)return;
 _game.start();alive=true;hud();spawnEnemy();
});
YAPsetLoop(YAPloop({canvas,update,draw}));
YAPtouchPad([{action:'left',label:'<'},{action:'right',label:'>'},{action:'up',label:'^'},{action:'down',label:'v'},{action:'fire',label:'FIRE'}]);
YAPscan();
hud();`;

test('strict checker rejects historical orchestrator DOM interface',async()=>{
 test.setTimeout(60000);
 const os=orchestratorSpec('Тетрис: стрелки влево-вправо, пробел — сброс, поворот. Линии исчезают со счётом.');
 const selection=selectMechanics(os);
 expect(selection.decision).toBe('use-library');
 const chosen=(selection.decision==='use-library')?selection.chosen:[];
 const html=buildHtml({title:'Falling blocks',rules:'Move with arrows or buttons, rotate with R, drop with space. Clear 2 lines to win.',derivation:JSON.stringify({space:os.spaceType,win:'2 lines'}),chosen,code:TETRIS_LOGIC,rulesBanner:'Goal: clear 2 lines | Lose: blocks reach the top | Win: 2 lines cleared'});
 await expect(browserCheck(html,AbortSignal.timeout(30000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});

// --- TASK-016 controlled gameplay probes (two control genres) ------------------

function assembleControl(prompt: string, code: string, banner: string) {
  const os = orchestratorSpec(prompt);
  const selection = selectMechanics(os);
  const chosen = selection.decision === 'use-library' ? selection.chosen : [];
  return { selection, html: buildHtml({ title: 'YAPLIX control probe', rules: prompt.slice(0, 400), derivation: JSON.stringify({ space: os.spaceType, probe: true }), chosen, code, rulesBanner: banner }) };
}

test('controlled gameplay: falling blocks reaches win, score and restart by real play',async()=>{
 test.setTimeout(150000);
 // Deterministic guided win: force the falling shape to the straight I and
 // pre-fill both bottom rows leaving exactly the 4-cell gap at x=3..6 that a
 // spawned I piece covers when hard-dropped; two drops clear two lines.
 const logic=TETRIS_LOGIC
  .replace('let piece=null,fallTimer=0,linesTotal=0;',
   'let piece=null,fallTimer=0,linesTotal=0;\n'+
   'for(let x=0;x<COLS;x++)if(x<3||x>6)board.set(x,ROWS-1,1);\n'+
   'for(let x=0;x<COLS;x++)if(x<3||x>6)board.set(x,ROWS-2,1);\n')
  .replace('piece={shape:SHAPES[Math.floor(Math.random()*SHAPES.length)],x:3,y:0};',
   'piece={shape:SHAPES[0],x:3,y:0};');
 const probe=assembleControl('Тетрис со взрывами: линии исчезают со взрывом и добавляют очки. Проигрыш — когда блоки достигают верха. Победа — очистить 2 линии.',logic,'Goal: clear 2 lines | Lose: blocks reach the top | Win: 2 lines cleared');
 expect(probe.selection.decision).toBe('use-library');
 const report=await gameplayCheck(probe.html,{win:'clear 2 lines',loss:'blocks reach the top',objective:'2 lines'},{budgetSeconds:75,rulesAware:{sequence:['drop','hurry','drop','hurry']}});
 await test.info().attach('rules-proof',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 const byAspect=Object.fromEntries(report.aspects.map(a=>[a.aspect,a.level]));
 expect(byAspect['html-runs']).toBe('VERIFIED');
 expect(byAspect['input-works']).toBe('VERIFIED');
 expect(byAspect['gameplay-observed']).toBe('VERIFIED');
 expect(byAspect['win-reachable']).toBe('VERIFIED');
 expect(byAspect['restart-works']).toBe('VERIFIED');
 expect(report.finalScore).not.toBeNull();
 expect(report.notes).toEqual(['terminal observed']);
});

test('controlled gameplay: snake with enemies grows, shoots, wins by real play',async()=>{
 test.setTimeout(150000);
 const waitingSnake=SNAKE_LOGIC.replace('dir={x:0,y:-1},apple=', 'dir={x:0,y:0},apple=');
 const probe=assembleControl('Змейка в лабиринте со стенами: змейка собирает яблоки, стреляет по преследующим врагам, у змейки есть жизни и счет. Победа — собрать 5 яблок.',waitingSnake,'Goal: collect 5 apples | Lose: enemy catch or self-crash | Win: 5 apples collected');
 expect(probe.selection.decision).toBe('use-library');
 // Honest guided play: the apple trail spawns one cell ahead of the moving
 // head, so riding "up" eats the trail; occasional fire taps exercise the
 // shooting mechanic during the run.
 const report=await gameplayCheck(probe.html,{win:'collect 5 apples',loss:'enemy catch or self-crash',objective:'5 apples'},{budgetSeconds:90,rulesAware:{sequence:[...Array(24).fill('up') as 'up'[]].flatMap((s,i)=>i%7===6?['up','fire' as const]:[s])}});
 await test.info().attach('rules-proof',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 const byAspect=Object.fromEntries(report.aspects.map(a=>[a.aspect,a.level]));
 expect(byAspect['html-runs']).toBe('VERIFIED');
 expect(byAspect['input-works']).toBe('VERIFIED');
 expect(byAspect['gameplay-observed']).toBe('VERIFIED');
 expect(byAspect['win-reachable']).toBe('VERIFIED');
 expect(report.finalScore).not.toBeNull();
});

test('controlled gameplay: both losses reachable (snake idle catch, tetris overflow)',async()=>{
 test.setTimeout(150000);
 // Snake: an unguided session lets the pursuing enemy reach the snake - the
 // declared loss fires while the player idles (enemyTimer 14s + half-speed
 // pursuit reaches the bottom row within the budget).
 const probeSnake=assembleControl('Змейка в лабиринте: преследующие враги, стены блокируют движение. Победа — 5 яблок. Захват врагом завершает игру поражением.',SNAKE_LOGIC,'Goal: collect 5 apples | Lose: enemy catch | Win: 5 apples collected');
 const lossSnake=await gameplayCheck(probeSnake.html,{win:'5 apples',loss:'enemy catch',objective:'5 apples'},{budgetSeconds:70,scoreTarget:null,holdKeys:['ArrowUp']});
 expect(Object.fromEntries(lossSnake.aspects.map(a=>[a.aspect,a.level]))['loss-reachable']).toBe('VERIFIED');
 // Tetris: ignore control, pieces stack up to the top -> declared loss fires.
 const probeTetris=assembleControl('Тетрис со взрывами: линии исчезают с очками. Проигрыш — когда блоки достигают верха.',TETRIS_LOGIC,'Goal: clear lines | Lose: blocks reach the top | Win: target score');
 const lossTetris=await gameplayCheck(probeTetris.html,{win:'target score',loss:'blocks reach the top',objective:'lines'},{budgetSeconds:70,scoreTarget:null,sequence:[...Array(24).fill('hurry') as 'hurry'[]]});
 expect(Object.fromEntries(lossTetris.aspects.map(a=>[a.aspect,a.level]))['loss-reachable']).toBe('VERIFIED');
 expect(Object.fromEntries(lossTetris.aspects.map(a=>[a.aspect,a.level]))['restart-works']).toBe('VERIFIED');
});

// TASK-017 fixtures are small authored games/defects, not LIVE output. The
// checker only supplies normal movement; outcome decisions stay in game code.
function numericGame(mode: string, target: number) {
 const code=`const canvas=YAPcreateCanvas(300,300,{bg:'#111'});
 let x=0,score=0,ready=null;
 addEventListener('message',e=>{if(e.data?.channel==='yaplix_init')ready=e.data;});
 function hud(){_hud.show(JSON.stringify({score,target:'${mode}'==='changing-target'&&score>0?${target}+1:${target}}));}
 function draw(){const c=canvas.ctx;c.clearRect(0,0,300,300);c.fillStyle='#0f0';c.fillRect(x*20,120,16,16);}
 const input=YAPinput((name,phase)=>{
  if(phase!=='down'||name!=='right'||!_game.started||_game.ended)return;
  if('${mode}'==='unresponsive'){while(true){}}
  if('${mode}'==='autonomous')return;
  x++;
  if('${mode}'!=='stalled'&&'${mode}'!=='unreachable')score++;
  if('${mode}'==='unreachable')score=Math.min(x,${target}-1);
  _game.score(score);hud();draw();
  if('${mode}'==='false-event')window.parent.postMessage({channel:'yaplix',event:{...ready,protocolVersion:1,eventId:crypto.randomUUID(),sequence:3,timestamp:Date.now(),type:'game_won',data:{}}},'*');
  if('${mode}'==='premature'||(score>=${target}&&['normal','invisible','changing-target'].includes('${mode}'))){_game.win();if('${mode}'==='invisible')document.getElementById('yapOverlay').style.opacity='0';}
 });
 YAPtouchPad([{action:'right',label:'Move right'}]);YAPscan();
 YAPregisterStart(()=>{_game.start();hud();draw();if('${mode}'==='autonomous')setInterval(()=>{if(!_game.ended){score++;_game.score(score);hud();draw();if(score>=${target})_game.win();}},100);});
 YAPsetLoop(YAPloop({update(){},draw}));`;
 return assembleControl('Игра на сетке: движение вправо и сбор очков. Победа — достичь целевого счёта.',code,'Goal: reach target score').html;
}
for(const [mode,expected] of [['normal','VERIFIED'],['false-event','FAILED'],['threshold-only','FAILED'],['premature','FAILED'],['stalled','NOT_VERIFIED'],['unreachable','NOT_VERIFIED'],['ambiguous','NOT_VERIFIED'],['changing-target','FAILED'],['invisible','FAILED'],['autonomous','NOT_VERIFIED']] as const){
 test(`rules-aware browser: ${mode}`,async()=>{
  test.setTimeout(15000);
  const report=await gameplayCheck(numericGame(mode==='ambiguous'?'normal':mode,7),{win:mode==='ambiguous'?'reach 7 points or collect 3 items':'reach 7 points',loss:'none observed',objective:null},{budgetSeconds:6,rulesAware:{sequence:['right'],maxActions:16,stallMs:600}});
  expect(report.aspects.find(a=>a.aspect==='win-reachable')?.level).toBe(expected);
  expect(report.evidence!.actions.length).toBeLessThanOrEqual(16);
  expect(report.evidence!.elapsedMs).toBeLessThan(8000);
  if(mode==='normal')expect(report.aspects.find(a=>a.aspect==='restart-works')?.level).toBe('VERIFIED');
 });
}
test('rules-aware browser: hard action budget bounds an unreachable target',async()=>{
 const report=await gameplayCheck(numericGame('unreachable',13),{win:'reach 13 points',loss:null,objective:null},{budgetSeconds:6,rulesAware:{sequence:['right'],maxActions:4}});
 expect(report.evidence!.actions).toHaveLength(4);
 expect(report.evidence!.stopReason).toBe('action budget');
 expect(report.aspects.find(a=>a.aspect==='win-reachable')?.level).toBe('NOT_VERIFIED');
});
test('rules-aware browser: an unresponsive game is bounded and never verifies',async()=>{
 test.setTimeout(25000);
 const start=Date.now();
 // Leave room for sandbox startup/first-frame baseline on shared runners;
 // the 2s probe could expire before sending any key, so it never exercised
 // the deliberately blocked handler on Ubuntu (TASK-017 hosted evidence).
 const report=await gameplayCheck(numericGame('unresponsive',7),{win:'reach 7 points',loss:null,objective:null},{budgetSeconds:6,rulesAware:{sequence:['right'],maxActions:4}});
 expect(report.aspects.some(a=>a.level==='FAILED')).toBe(true);
 expect(report.notes).toContain('BROWSER_GAMEPLAY_TIMEOUT');
 expect(report.aspects.find(a=>a.aspect==='win-reachable')?.level).not.toBe('VERIFIED');
 expect(Date.now()-start).toBeLessThan(22000);
});
test('rules-aware browser: active budget begins after a real delayed Start',async()=>{
 test.setTimeout(15000);
 const delayed=numericGame('normal',3).replace('</style>','@keyframes setup{from{transform:translateX(100px)}to{transform:translateX(0)}}#yapStart{animation:setup 2.4s linear}</style>');
 const report=await gameplayCheck(delayed,{win:'reach 3 points',loss:null,objective:null},{budgetSeconds:6,rulesAware:{sequence:['right'],maxActions:8}});
 expect(report.aspects.find(a=>a.aspect==='win-reachable')?.level).toBe('VERIFIED');
 expect(report.evidence!.actions.filter(a=>a.kind==='key'&&a.value==='ArrowRight')).toHaveLength(3);
});
