export interface CanvasTextMeasurement {
  x:number;y:number;
  actualBoundingBoxLeft:number;actualBoundingBoxRight:number;
  actualBoundingBoxAscent:number;actualBoundingBoxDescent:number;
  transform:{a:number;b:number;c:number;d:number;e:number;f:number};
  canvas:{width:number;height:number;cssWidth:number;cssHeight:number};
  maxWidth?:boolean;clipActive?:boolean;paintCertain?:boolean;
}
export interface CanvasTextBounds {
  status:'VISIBLE'|'CLIPPED'|'NOT_VERIFIED';
  edges:('left'|'right'|'top'|'bottom')[];
  bounds:{left:number;top:number;right:number;bottom:number}|null;
  clippedCss:{left:number;top:number;right:number;bottom:number};
}

export interface CanvasTextInkDraw {
  textHash:string;
  drawOrder:number;
  bounds:{left:number;top:number;right:number;bottom:number};
  /** Absolute backing-store pixel indexes from a rasterized glyph mask. */
  inkPixels:number[]|null;
}
export interface CanvasTextOverlap {
  earlierTextHash:string;laterTextHash:string;drawOrder:[number,number];
  earlierBounds:CanvasTextInkDraw['bounds'];laterBounds:CanvasTextInkDraw['bounds'];
  intersectionPixels:number;overlapRatio:number;status:'CONFIRMED';
}
export function detectCanvasTextOverlaps(draws:CanvasTextInkDraw[]){
  const conflicts:CanvasTextOverlap[]=[];let uncertain=false;
  if(draws.some(draw=>!draw.inkPixels||draw.inkPixels.length===0))return{status:'NOT_VERIFIED' as const,conflicts};
  const ordered=draws.slice().sort((a,b)=>a.drawOrder-b.drawOrder);
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const earlier=ordered[i],later=ordered[j];
    // A duplicate paint of the same label is commonly used for an outline or
    // emphasis pass. It is not independent UI evidence.
    const a=new Set(earlier.inkPixels!),b=new Set(later.inkPixels!);
    const small=a.size<=b.size?a:b,large=small===a?b:a;
    let intersectionPixels=0;for(const pixel of small)if(large.has(pixel))intersectionPixels++;
    const overlapRatio=intersectionPixels/Math.min(a.size,b.size);
    // Ignore edge-touching/antialias noise. The threshold requires both a
    // visible number of shared glyph pixels and a material share of one label.
    if(earlier.textHash===later.textHash){if(intersectionPixels>=4&&overlapRatio>=0.05)uncertain=true;continue;}
    if(intersectionPixels>=4&&overlapRatio>=0.05)conflicts.push({
      earlierTextHash:earlier.textHash,laterTextHash:later.textHash,
      drawOrder:[earlier.drawOrder,later.drawOrder],earlierBounds:earlier.bounds,laterBounds:later.bounds,
      intersectionPixels,overlapRatio,status:'CONFIRMED',
    });
  }
  return{status:uncertain?'NOT_VERIFIED' as const:'VERIFIED' as const,conflicts};
}

/**
 * Estimates glyph ink bounds from the browser's actual TextMetrics and the
 * Canvas 2D affine transform. Only definite backing-store overflow is a
 * violation; maxWidth shaping, custom clip paths, or uncertain paint stay
 * NOT_VERIFIED. This function is observational and never changes game state.
 */
export function measureCanvasTextBounds(m:CanvasTextMeasurement):CanvasTextBounds {
  const empty:CanvasTextBounds={status:'NOT_VERIFIED',edges:[],bounds:null,clippedCss:{left:0,top:0,right:0,bottom:0}};
  const values=[m.x,m.y,m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent,m.transform.a,m.transform.b,m.transform.c,m.transform.d,m.transform.e,m.transform.f,m.canvas.width,m.canvas.height,m.canvas.cssWidth,m.canvas.cssHeight];
  if(values.some(v=>!Number.isFinite(v))||m.canvas.width<=0||m.canvas.height<=0||m.canvas.cssWidth<=0||m.canvas.cssHeight<=0||m.maxWidth||m.clipActive||m.paintCertain===false)return empty;
  const local=[
    [m.x-m.actualBoundingBoxLeft,m.y-m.actualBoundingBoxAscent],
    [m.x+m.actualBoundingBoxRight,m.y-m.actualBoundingBoxAscent],
    [m.x-m.actualBoundingBoxLeft,m.y+m.actualBoundingBoxDescent],
    [m.x+m.actualBoundingBoxRight,m.y+m.actualBoundingBoxDescent],
  ];
  const points=local.map(([x,y])=>({x:m.transform.a*x+m.transform.c*y+m.transform.e,y:m.transform.b*x+m.transform.d*y+m.transform.f}));
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return empty;
  const bounds={left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};
  const clippedCss={left:Math.max(0,-bounds.left)*m.canvas.cssWidth/m.canvas.width,top:Math.max(0,-bounds.top)*m.canvas.cssHeight/m.canvas.height,right:Math.max(0,bounds.right-m.canvas.width)*m.canvas.cssWidth/m.canvas.width,bottom:Math.max(0,bounds.bottom-m.canvas.height)*m.canvas.cssHeight/m.canvas.height};
  // A one-device-pixel tolerance absorbs floating point edge noise but does
  // not turn a materially clipped label into an unverified guess.
  const edges=(Object.keys(clippedCss) as (keyof typeof clippedCss)[]).filter(edge=>clippedCss[edge]>1);
  return{status:edges.length?'CLIPPED':'VISIBLE',edges,bounds,clippedCss};
}
