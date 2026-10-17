/** Authored, offline, turn-based miniatures. No LLM output or production adapter.
 * The production checker receives only the resulting HTML, never this catalog. */
const shell=(title:string,rules:string,setup:string,move:string,board=false)=>`<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:8px;font:16px system-ui;background:#fafafa;color:#172238}main{max-width:400px;margin:auto}button{min-width:44px;min-height:44px;margin:2px}canvas{width:100%;max-width:280px;height:240px}output{display:block;overflow-wrap:anywhere}#board{display:grid;grid-template-columns:repeat(3,52px)}
</style></head><body><main><h1>${title}</h1><p>${rules}</p><button id="start">Start</button><button id="restart">Restart</button><p id="result">Ready</p><output id="hud"></output><canvas width="280" height="240"></canvas>${board?'<div id="board"></div>':''}<nav>${['Left','Right','Up','Down','Step'].map(a=>`<button data-action="${a.toLowerCase()}">${a}</button>`).join('')}</nav></main><script>
let state;const result=document.querySelector('#result'),hud=document.querySelector('#hud'),ctx=document.querySelector('canvas').getContext('2d');
function reset(){state={phase:'playing',score:0,health:1,turn:0,${setup}};render();}
function render(){result.textContent=state.phase;hud.textContent=JSON.stringify(state);ctx.clearRect(0,0,280,240);ctx.fillStyle='#172238';ctx.fillText('Score '+state.score+' / Health '+state.health,8,18);ctx.fillStyle='#236bc0';ctx.fillRect((state.x??state.lane??state.paddle??0)*40+8,(state.y??4)*35+30,25,25);for(const p of state.items??state.bricks??[]){ctx.fillStyle='#ce5030';ctx.fillRect(p[0]*40+8,p[1]*35+30,18,18);}if(state.ball){ctx.fillStyle='#b058bf';ctx.fillRect(state.ball[0]*40+10,state.ball[1]*35+30,12,12);}${board?`document.querySelector('#board').replaceChildren(...state.board.map((v,i)=>{const b=document.createElement('button');b.textContent=String(v);b.setAttribute('aria-label','Cell '+i);b.onclick=()=>act(String(i));return b;}));`:''}}
function act(action){if(!state||state.phase!=='playing')return;${move}render();}
document.querySelector('#start').onclick=reset;document.querySelector('#restart').onclick=()=>{reset();};
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>act(b.dataset.action);
addEventListener('keydown',e=>{const a={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Space:'step',Digit0:'0',Digit1:'1',Digit2:'2',Digit3:'3',Digit4:'4',Digit5:'5',Digit6:'6',Digit7:'7',Digit8:'8'}[e.code];if(a){e.preventDefault();act(a);}});
</script></body></html>`;

const snake=shell('Snake','Each arrow moves one cell. Eat three apples; wall or body contact loses.',
 'x:1,y:2,body:[[1,2]],items:[[2,2],[3,2],[4,2]]',`
const d={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[action];if(!d)return;
state.x+=d[0];state.y+=d[1];state.turn++;
if(state.x<0||state.x>5||state.y<0||state.y>4||state.body.some(p=>p[0]===state.x&&p[1]===state.y)){state.health=0;state.phase='lost';return render();}
state.body.unshift([state.x,state.y]);const i=state.items.findIndex(p=>p[0]===state.x&&p[1]===state.y);
if(i>=0){state.items.splice(i,1);state.score++;}else state.body.pop();
if(state.score>=3)state.phase='won';`);
const match=shell('Match three','Select adjacent cells with digits or touch. Match a horizontal trio in two moves. Invalid swaps cost a move.',
 'board:[1,2,1,2,1,2,3,3,2],selected:null,moves:2',`
if(!/^[0-8]$/.test(action))return;const i=Number(action);
if(state.selected===null){state.selected=i;return render();}const j=state.selected;state.selected=null;
if(Math.abs(i%3-j%3)+Math.abs(Math.floor(i/3)-Math.floor(j/3))!==1)return;
[state.board[i],state.board[j]]=[state.board[j],state.board[i]];state.moves--;state.turn++;
for(let row=0;row<3;row++){const k=row*3;if(state.board[k]!==0&&state.board[k]===state.board[k+1]&&state.board[k]===state.board[k+2]){state.board.splice(k,3,0,0,0);state.score+=3;}}
if(state.score>=3)state.phase='won';else if(state.moves<=0){state.health=0;state.phase='lost';}`,true);
const collection=shell('Collection','Collect three items. Arrows move one tile; the hazard at (0,1) loses.',
 'x:0,y:0,items:[[1,0],[2,0],[3,0]]',`
const d={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[action];if(!d)return;
state.x=Math.max(0,Math.min(5,state.x+d[0]));state.y=Math.max(0,Math.min(4,state.y+d[1]));state.turn++;
if(state.x===0&&state.y===1){state.health=0;state.phase='lost';}
const i=state.items.findIndex(p=>p[0]===state.x&&p[1]===state.y);if(i>=0){state.items.splice(i,1);state.score++;}
if(state.score>=3)state.phase='won';`);
const lane=shell('Lane dodger','Left/right steer between three lanes. Step (Space) advances the road. Dodge obstacles in lanes 1,0,2 to finish.',
 'lane:1,road:[1,0,2]',`
if(action==='left')state.lane=Math.max(0,state.lane-1);else if(action==='right')state.lane=Math.min(2,state.lane+1);else if(action==='step'){
if(state.lane===state.road[state.turn]){state.health--;if(state.health<=0)state.phase='lost';}else state.score++;
state.turn++;if(state.turn>=3&&state.health>0)state.phase='won';}`);
const breakout=shell('Breakout','Left/right steer the paddle; Up aims left before launch. Space/Step advances the ball one cell. Clear the brick at (1,0); missing the returning ball loses.',
 'paddle:1,ball:[1,3],dy:-1,bricks:[[1,0]]',`
if(action==='up'&&state.turn===0)state.ball[0]=Math.max(0,state.ball[0]-1);else if(action==='left')state.paddle=Math.max(0,state.paddle-1);else if(action==='right')state.paddle=Math.min(5,state.paddle+1);else if(action==='step'){
state.ball[1]+=state.dy;state.turn++;
const i=state.bricks.findIndex(p=>p[0]===state.ball[0]&&p[1]===state.ball[1]);if(i>=0){state.bricks.splice(i,1);state.score++;state.dy=1;}
if(state.ball[1]<=0)state.dy=1;
if(state.ball[1]>=4){if(state.paddle===state.ball[0])state.dy=-1;else{state.health=0;state.phase='lost';}}
if(state.bricks.length===0)state.phase='won';}`);

function change(source:string,from:string,to:string){if(source.split(from).length!==2)throw Error('Mutation must have exactly one source location');return source.replace(from,to);}
export const calibrationDocuments=[
 snake,change(snake,'state.x+=d[0];state.y+=d[1];',''),change(snake,"if(state.score>=3)state.phase='won';","if(state.score>=30)state.phase='won';"),
 match,change(match,"if(state.selected===null)","if(state.selected===null) throw Error('Cannot select cell');if(state.selected===null)"),change(match,'state.selected=null;','state.phase=\'resolving\';state.selected=null;'),
 collection,change(collection,'state.items.splice(i,1);state.score++;','state.items.splice(i,1);'),change(collection,'document.querySelector(\'#restart\').onclick=()=>{reset();};','document.querySelector(\'#restart\').onclick=()=>{};'),
 lane,change(lane,"if(state.health<=0)state.phase='lost';",''),change(lane,'state.lane===state.road[state.turn]','false'),
 breakout,change(breakout,'state.bricks.splice(i,1);state.score++;state.dy=1;','state.score++;state.dy=1;'),change(breakout,"if(state.bricks.length===0)state.phase='won';","if(state.score>=2)state.phase='won';"),
];
