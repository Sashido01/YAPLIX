import {test,expect} from '@playwright/test';
import type {FrameLocator} from '@playwright/test';

const state=async(game:FrameLocator)=>JSON.parse((await game.locator('[data-yaplix-state]').textContent())!);
function rotate(matrix:number[][]){return matrix[0].map((_,x)=>matrix.map(row=>row[x]).reverse());}
function placement(board:number[][],initial:number[][]){
  const height=board.length,width=board[0].length;let best={cost:Infinity,turns:0,x:0},matrix=initial;
  for(let turns=0;turns<4;turns++,matrix=rotate(matrix))for(let x=-2;x<width;x++){
    const collision=(y:number)=>matrix.some((row,dy)=>row.some((v,dx)=>v&&(x+dx<0||x+dx>=width||y+dy>=height||board[y+dy]?.[x+dx])));
    if(collision(0))continue;let y=0;while(!collision(y+1))y++;
    const copy=board.map(row=>row.slice());matrix.forEach((row,dy)=>row.forEach((v,dx)=>{if(v)copy[y+dy][x+dx]=1;}));
    const full=copy.flatMap((row,y)=>row.every(Boolean)?[y]:[]);for(const row of full)for(const adjacent of [row-1,row+1])if(adjacent>=0&&adjacent<height&&!full.includes(adjacent))copy[adjacent].fill(0);
    const remaining=copy.filter((_,y)=>!full.includes(y));while(remaining.length<height)remaining.unshift(Array(width).fill(0));
    let holes=0;const heights=Array.from({length:width},(_,x)=>{let first=height;for(let y=0;y<height;y++)if(remaining[y][x]){first=Math.min(first,y);}else if(first<height)holes++;return height-first;});
    const cost=holes*60+heights.reduce((a,b)=>a+b,0)*.8+heights.slice(1).reduce((a,v,i)=>a+Math.abs(v-heights[i]),0)*.5-full.length*12;
    if(cost<best.cost)best={cost,turns,x};
  }return best;
}

test('authored falling blocks: touch, rotation, collision, gravity, locking, lines/explosions, win/loss, restart and offline',async({page,context})=>{
  test.setTimeout(45000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('#gallery button').filter({hasText:'Искры'}).click();const game=page.frameLocator('#game iframe');
  await game.locator('[data-yaplix-start]').click();const start=await state(game);expect(start.piece.matrix).toHaveLength(1);
  await game.locator('#rotate').click();expect((await state(game)).piece.matrix).toHaveLength(4);
  await game.locator('#left').click();const moved=await state(game);expect(moved.piece.x).toBeLessThan(start.piece.x);
  const beforeGravity=moved.piece.y;await expect.poll(async()=>(await state(game)).piece.y).toBeGreaterThan(beforeGravity);
  await context.setOffline(true);
  for(let round=0;round<120;round++){
    const current=await state(game);if(current.phase!=='playing')break;
    const plan=placement(current.board,current.piece.matrix);
    await game.locator('body').evaluate((_,plan)=>{const click=(id:string)=>(document.querySelector('#'+id) as HTMLButtonElement).click();for(let i=0;i<plan.turns;i++)click('rotate');const read=()=>JSON.parse(document.querySelector('output')!.textContent!);for(let i=0;i<12&&read().piece.x!==plan.x;i++)click(read().piece.x<plan.x?'right':'left');click('drop');},plan);
  }
  const won=await state(game);expect(won.phase).toBe('won');expect(won.score).toBeGreaterThanOrEqual(600);expect(won.lines).toBeGreaterThan(0);expect(won.locks).toBeGreaterThan(1);expect(won.explosions).toBeGreaterThan(0);
  await game.locator('#restart').click();expect((await state(game)).score).toBe(0);
  await game.locator('body').evaluate(()=>{for(let i=0;i<45;i++)(document.querySelector('#drop') as HTMLButtonElement).click();});
  expect((await state(game)).phase).toBe('lost');await game.locator('#restart').click();expect((await state(game)).phase).toBe('playing');expect(errors).toEqual([]);
});

function path(walls:number[][],from:{x:number;y:number},target:{x:number;y:number},blocked:{x:number;y:number}[]=[]){
  const queue=[{...from,keys:[] as string[]}],seen=new Set([from.x+','+from.y]);
  for(let i=0;i<queue.length;i++){const item=queue[i];if(item.x===target.x&&item.y===target.y)return item.keys;for(const [key,dx,dy]of [['ArrowLeft',-1,0],['ArrowRight',1,0],['ArrowUp',0,-1],['ArrowDown',0,1]] as const){const x=item.x+dx,y=item.y+dy,k=x+','+y;if(walls[y]?.[x]===0&&!seen.has(k)&&!blocked.some(e=>e.x===x&&e.y===y)){seen.add(k);queue.push({x,y,keys:[...item.keys,key]});}}}return null;
}
test('authored maze: walls, real movement/score, pursuing enemies, attainable end, restart and offline',async({page,context})=>{
  await page.goto('/');await page.locator('#gallery button').filter({hasText:'лабиринт'}).click();const game=page.frameLocator('#game iframe');await game.locator('[data-yaplix-start]').click();
  await game.locator('#up').click();expect((await state(game)).player).toEqual({x:1,y:1});
  const initial=await state(game);await expect.poll(async()=>(await state(game)).enemies).not.toEqual(initial.enemies);
  const enemy=(await state(game)).enemies[0],current=await state(game),loss=path(current.walls,current.player,enemy)!;
  await game.locator('body').evaluate((_,keys)=>{for(const key of keys)dispatchEvent(new KeyboardEvent('keydown',{key}));},loss);
  expect((await state(game)).phase).toBe('lost');await game.locator('#restart').click();await context.setOffline(true);
  for(let i=0;i<6;i++){const current=await state(game),options=current.coins.map((coin:any)=>path(current.walls,current.player,coin,current.enemies)).filter(Boolean).sort((a:any,b:any)=>a.length-b.length);expect(options.length).toBeGreaterThan(0);await game.locator('body').evaluate((_,keys)=>{for(const key of keys as string[])dispatchEvent(new KeyboardEvent('keydown',{key}));},options[0]);}
  const collected=await state(game);expect(collected.score).toBe(6);const exitPath=path(collected.walls,collected.player,collected.exit,collected.enemies);expect(exitPath).not.toBeNull();await game.locator('body').evaluate((_,keys)=>{for(const key of keys!)dispatchEvent(new KeyboardEvent('keydown',{key}));},exitPath);
  expect((await state(game)).phase).toBe('won');await game.locator('#restart').click();expect((await state(game)).score).toBe(0);
});
