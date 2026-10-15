// TASK-013 browser spec: proves the orchestrator assembly (primitives skeleton
// + generated logic) passes the real offline checker at 320/390, and that real
// input/pause/resume evidence works. Runs only on chromium-desktop.
import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {buildHtml} from '../src/orchestrator/html-builder.ts';
import {orchestratorSpec} from '../src/orchestrator/spec.ts';
import {selectMechanics} from '../src/orchestrator/selector.ts';

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
 if(fsm.is('menu')){_game.start();fsm.set('play');spawn();}
});
YAPsetLoop(YAPloop({canvas,update,draw}));
YAPtouchPad([{action:'left',label:'<'},{action:'right',label:'>'},{action:'down',label:'v'},{action:'rotate',label:'R'},{action:'space',label:'DROP'}]);
YAPscan();
hud();`;

test('real checker accepts orchestrator-assembly falling-blocks artifact at 320/390 offline',async()=>{
 test.setTimeout(60000);
 const os=orchestratorSpec('Тетрис: стрелки влево-вправо, пробел — сброс, поворот. Линии исчезают со счётом.');
 const selection=selectMechanics(os);
 expect(selection.decision).toBe('use-library');
 const chosen=(selection.decision==='use-library')?selection.chosen:[];
 const html=buildHtml({title:'Falling blocks',rules:'Move with arrows or buttons, rotate with R, drop with space. Clear 2 lines to win.',derivation:JSON.stringify({space:os.spaceType,win:'2 lines'}),chosen,code:TETRIS_LOGIC});
 const evidence=await browserCheck(html,AbortSignal.timeout(30000));
 expect(evidence).toEqual({profiles:[320,390],offline:true,errors:0,scope:'startup-input-pause',levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED']});
});
