function rotate(matrix:number[][]){return matrix[0].map((_,x)=>matrix.map(row=>row[x]).reverse());}
export function placement(board:number[][],initial:number[][]){
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

export function path(walls:number[][],from:{x:number;y:number},target:{x:number;y:number},blocked:{x:number;y:number}[]=[]){
  const queue=[{...from,keys:[] as string[]}],seen=new Set([from.x+','+from.y]);
  for(let i=0;i<queue.length;i++){const item=queue[i];if(item.x===target.x&&item.y===target.y)return item.keys;for(const [key,dx,dy]of [['ArrowLeft',-1,0],['ArrowRight',1,0],['ArrowUp',0,-1],['ArrowDown',0,1]] as const){const x=item.x+dx,y=item.y+dy,k=x+','+y;if(walls[y]?.[x]===0&&!seen.has(k)&&!blocked.some(e=>e.x===x&&e.y===y)){seen.add(k);queue.push({x,y,keys:[...item.keys,key]});}}}return null;
}
