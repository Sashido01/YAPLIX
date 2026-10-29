import type {Frame} from 'playwright-core';
import {Fault} from './contracts.ts';

/** Runs before game scripts, only in the disposable validation browser. Native
 * calls retain their receiver/arguments/results. No game source is rewritten. */
export function observeCanvas({key,html}:{key:string;html:string}) {
 // DOMParser is inert and retains declarative shadow templates. Native parser
 // roots can bypass attachShadow, so their contents cannot earn strict evidence.
 const parserRoot=!!new DOMParser().parseFromString(html,'text/html').querySelector('template[shadowrootmode]');
 const records=new Map<HTMLCanvasElement,{context:string;draws:number;image:string;meaningful:boolean;sampling?:{width:number;height:number;colorBuckets:number;significantColors:number;largestColorPixels:number};preserved:boolean;drawFrame:number;textFrame:number;textDrawCount:number;texts:any[];seen:Map<string,number>;overlapSeen:Map<string,{count:number;lastFrame:number}>;unverifiedText:number;overlapUnverified:number}>();
 const clipStates=new WeakMap<CanvasRenderingContext2D,{active:boolean;stack:boolean[]}>();
 const contexts=new WeakMap<HTMLCanvasElement,CanvasRenderingContext2D>();
 // Expire non-preserved evidence even when the game stops scheduling frames.
 // This observer never draws or changes the game's context options.
 let frame=0;const nativeFrame=window.requestAnimationFrame.bind(window);
 const advance=()=>{frame++;nativeFrame(advance);};nativeFrame(advance);
 const dirty=new Set<HTMLCanvasElement>();let pending=false;
 const ids=new WeakMap<HTMLCanvasElement,number>();let nextId=0;
 const nativeGet=HTMLCanvasElement.prototype.getContext;
 const nativeDraw=CanvasRenderingContext2D.prototype.drawImage;
 const nativePixels=CanvasRenderingContext2D.prototype.getImageData;
 const nativeMeasure=CanvasRenderingContext2D.prototype.measureText;
 const nativeTransform=CanvasRenderingContext2D.prototype.getTransform;
 let glyphCanvas:OffscreenCanvas|undefined,glyphContext:OffscreenCanvasRenderingContext2D|null=null;
 const sample=(canvas:HTMLCanvasElement,record:{context:string;image:string;meaningful:boolean;sampling?:{width:number;height:number;colorBuckets:number;significantColors:number;largestColorPixels:number}})=>{
  try{
   // A non-preserved WebGL buffer must be read after every draw, before the
   // next frame discards it. Keep 2D detail at 256 px and bound GPU readback.
   const edge=record.context==='2d'?256:128;
   const scale=Math.min(1,edge/Math.max(canvas.width,canvas.height));
   const probe=document.createElement('canvas');probe.width=Math.max(1,Math.round(canvas.width*scale));probe.height=Math.max(1,Math.round(canvas.height*scale));
   const ctx=Reflect.apply(nativeGet,probe,['2d']) as CanvasRenderingContext2D;
   Reflect.apply(nativeDraw,ctx,[canvas,0,0,probe.width,probe.height]);
   const pixels=Reflect.apply(nativePixels,ctx,[0,0,probe.width,probe.height]).data;
   const colors=new Map<number,number>();let hash=2166136261;
   for(let i=0;i<pixels.length;i+=4){
    const color=pixels[i+3]<16?0:1+(pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4);
    colors.set(color,(colors.get(color)??0)+1);
    hash=Math.imul(hash^color,16777619);
   }
   record.image=String(hash>>>0);
   // A blank/solid clear, a lone pixel or a thin decorative line is insufficient.
   const significantColors=[...colors.values()].filter(n=>n>=8).length;
   record.meaningful=significantColors>=2;
   record.sampling={width:probe.width,height:probe.height,colorBuckets:colors.size,significantColors,largestColorPixels:Math.max(0,...colors.values())};
  }catch{record.image='';record.meaningful=false;record.sampling=undefined;}
 };
 const rasterizeInk=(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,bounds:{left:number;top:number;right:number;bottom:number},stroke:boolean,maxWidth:boolean,clipActive:boolean,paintCertain:boolean):number[]|null=>{
  // Rasterize isolated glyphs using the browser's own font rasterizer. A
  // TextMetrics rectangle intersection alone never establishes a conflict.
  if(typeof OffscreenCanvas==='undefined'||maxWidth||clipActive||!paintCertain||ctx.globalAlpha<.5||ctx.globalCompositeOperation!=='source-over')return null;
  const left=Math.max(0,Math.floor(bounds.left)),top=Math.max(0,Math.floor(bounds.top));
  const right=Math.min(ctx.canvas.width,Math.ceil(bounds.right)),bottom=Math.min(ctx.canvas.height,Math.ceil(bounds.bottom));
  const width=right-left,height=bottom-top;if(width<1||height<1||width>2048||height>2048)return null;
  try{
   if(!glyphCanvas){glyphCanvas=new OffscreenCanvas(width,height);glyphContext=glyphCanvas.getContext('2d',{willReadFrequently:true});}
   else if(glyphCanvas.width!==width||glyphCanvas.height!==height){glyphCanvas.width=width;glyphCanvas.height=height;}
   const ink=glyphContext;if(!ink)return null;
   const m=ctx.getTransform();ink.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);
   ink.font=ctx.font;ink.textAlign=ctx.textAlign;ink.textBaseline=ctx.textBaseline;ink.direction=ctx.direction;
   for(const property of ['fontKerning','fontStretch','fontVariantCaps','letterSpacing','wordSpacing','textRendering','lang'] as const){const source=(ctx as any)[property];if(source!==undefined&&property in ink)(ink as any)[property]=source;}
   ink.setLineDash(ctx.getLineDash());ink.lineDashOffset=ctx.lineDashOffset;
   ink.fillStyle='#fff';ink.strokeStyle='#fff';ink.globalAlpha=1;ink.globalCompositeOperation='source-over';ink.shadowColor='transparent';ink.shadowBlur=0;ink.shadowOffsetX=0;ink.shadowOffsetY=0;ink.filter='none';
   if(stroke){ink.lineWidth=ctx.lineWidth;ink.lineJoin=ctx.lineJoin;ink.miterLimit=ctx.miterLimit;ink.strokeText(text,x,y);}
   else ink.fillText(text,x,y);
   const pixels=ink.getImageData(0,0,width,height).data,result:number[]=[];
   for(let py=0;py<height;py++)for(let px=0;px<width;px++)if(pixels[(py*width+px)*4+3]>=96)result.push((top+py)*ctx.canvas.width+left+px);
   return result;
  }catch{return null;}
 };
 HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<HTMLCanvasElement['getContext']>){
  const result=Reflect.apply(nativeGet,this,args);
  if(!result&&(args[0]==='webgl'||args[0]==='webgl2'))(window as any).__yaplixWebglUnavailable=args[0];
  if(result&&['2d','webgl','webgl2'].includes(args[0])&&!records.has(this)&&records.size<32)
   records.set(this,{context:args[0],draws:0,image:'',meaningful:false,sampling:undefined,drawFrame:-10,textFrame:-10,textDrawCount:0,texts:[],seen:new Map(),overlapSeen:new Map(),unverifiedText:0,overlapUnverified:0,
    preserved:args[0]==='2d'||!!(result as WebGLRenderingContext).getContextAttributes()?.preserveDrawingBuffer});
  if(result&&args[0]==='2d'&&!clipStates.has(result as CanvasRenderingContext2D)){clipStates.set(result as CanvasRenderingContext2D,{active:false,stack:[]});contexts.set(this,result as CanvasRenderingContext2D);}
  return result;
 } as HTMLCanvasElement['getContext'];
 const wrap=(prototype:object,names:string[],draw=true)=>{
  for(const name of names){
   const native=(prototype as Record<string,Function>)[name];if(typeof native!=='function')continue;
   Object.defineProperty(prototype,name,{configurable:true,writable:true,value:function(this:{canvas:HTMLCanvasElement},...args:unknown[]){
    const result=Reflect.apply(native,this,args),record=records.get(this.canvas);
    if(record){
     if(draw){record.draws++;record.drawFrame=frame;if(record.context==='2d'&&record.textFrame!==frame){record.textFrame=frame;record.textDrawCount=0;record.texts=[];record.unverifiedText=0;record.overlapUnverified=0;}}
     if(record.context==='2d'&&(name==='fillText'||name==='strokeText')){
      try{
       const ctx=this as CanvasRenderingContext2D,canvas=this.canvas,text=String(args[0]??''),x=Number(args[1]),y=Number(args[2]);
       const metrics=Reflect.apply(nativeMeasure,ctx,[text]) as TextMetrics,transform=Reflect.apply(nativeTransform,ctx,[]) as DOMMatrix,box=canvas.getBoundingClientRect();
       const maxWidth=args.length>=4,clipActive=clipStates.get(ctx)?.active??true;
       const paintStyle=ctx[name==='fillText'?'fillStyle':'strokeStyle'],opaque=typeof paintStyle==='string'&&paintStyle!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(paintStyle)&&!/^#(?:[\da-f]{3}0|[\da-f]{6}00)$/i.test(paintStyle)&&!/^hsla\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(paintStyle)&&!/^color\([^)]*\/\s*0(?:\.0+)?\s*\)$/i.test(paintStyle);
       const fill=ctx.globalAlpha>0&&ctx.globalCompositeOperation==='source-over'&&opaque&&(name==='fillText'||ctx.lineWidth>0);
       const dims={width:canvas.width,height:canvas.height,cssWidth:box.width,cssHeight:box.height};
       const measured=[x,y,metrics.actualBoundingBoxLeft,metrics.actualBoundingBoxRight,metrics.actualBoundingBoxAscent,metrics.actualBoundingBoxDescent,transform.a,transform.b,transform.c,transform.d,transform.e,transform.f,dims.width,dims.height,dims.cssWidth,dims.cssHeight];
       if(!text||measured.some(value=>!Number.isFinite(value))||dims.width<=0||dims.height<=0||dims.cssWidth<=0||dims.cssHeight<=0||metrics.width<=0||metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent<=0||!fill){record.unverifiedText++;record.overlapUnverified++;}
       else {
        const local=[[x-metrics.actualBoundingBoxLeft,y-metrics.actualBoundingBoxAscent],[x+metrics.actualBoundingBoxRight,y-metrics.actualBoundingBoxAscent],[x-metrics.actualBoundingBoxLeft,y+metrics.actualBoundingBoxDescent],[x+metrics.actualBoundingBoxRight,y+metrics.actualBoundingBoxDescent]];
        const points=local.map(([lx,ly])=>({x:transform.a*lx+transform.c*ly+transform.e,y:transform.b*lx+transform.d*ly+transform.f}));
        const bounds={left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};
        const clippedCss={left:Math.max(0,-bounds.left)*dims.cssWidth/dims.width,top:Math.max(0,-bounds.top)*dims.cssHeight/dims.height,right:Math.max(0,bounds.right-dims.width)*dims.cssWidth/dims.width,bottom:Math.max(0,bounds.bottom-dims.height)*dims.cssHeight/dims.height};
        const edges=(Object.keys(clippedCss) as (keyof typeof clippedCss)[]).filter(edge=>clippedCss[edge]>1),certain=!maxWidth&&!clipActive;
        let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
        const rounded=Object.fromEntries(Object.entries(bounds).map(([key,value])=>[key,Math.round(value/2)*2]));
        const simplePaint=typeof paintStyle==='string'&&!/(?:rgba|hsla|color\(|gradient|pattern)/i.test(paintStyle);
        const inkPixels=record.textDrawCount++<24?rasterizeInk(ctx,text,x,y,bounds,name==='strokeText',maxWidth,clipActive,simplePaint):null;
        if(!inkPixels?.length)record.overlapUnverified++;
        record.texts.push({key:String(hash>>>0)+':'+JSON.stringify(rounded)+':'+edges.join(','),textHash:String(hash>>>0),length:text.length,edges,bounds,clippedCss,textAlign:ctx.textAlign,textBaseline:ctx.textBaseline,transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f],canvas:{width:dims.width,height:dims.height,cssWidth:Math.round(dims.cssWidth),cssHeight:Math.round(dims.cssHeight)},stableSamples:0,status:!certain?'NOT_VERIFIED':edges.length?'CLIPPED':'VISIBLE',drawOrder:record.texts.length+1,inkPixels,reason:!certain?(maxWidth?'max-width':'active-clip'):undefined});
        if(record.texts.length>24)record.texts.shift();
       }
      }catch{record.unverifiedText++;record.overlapUnverified++;}
     }
     if(record.context!=='2d'){
      // Read after synchronous draws, before the non-preserved frame is lost.
      dirty.add(this.canvas);
      if(!pending){pending=true;queueMicrotask(()=>{
       pending=false;for(const canvas of dirty){const current=records.get(canvas);if(current)sample(canvas,current);}dirty.clear();
      });}
     }
    }
    return result;
   }});
  }
 };
 const nativeSave=CanvasRenderingContext2D.prototype.save,nativeRestore=CanvasRenderingContext2D.prototype.restore,nativeClip=CanvasRenderingContext2D.prototype.clip;
 CanvasRenderingContext2D.prototype.save=function(this:CanvasRenderingContext2D){const result=Reflect.apply(nativeSave,this,[]),state=clipStates.get(this);if(state)state.stack.push(state.active);return result;};
 CanvasRenderingContext2D.prototype.restore=function(this:CanvasRenderingContext2D){const result=Reflect.apply(nativeRestore,this,[]),state=clipStates.get(this);if(state?.stack.length)state.active=state.stack.pop()!;return result;};
 Object.defineProperty(CanvasRenderingContext2D.prototype,'clip',{configurable:true,writable:true,value:function(this:CanvasRenderingContext2D,...args:unknown[]){const result=Reflect.apply(nativeClip,this,args);const state=clipStates.get(this);if(state)state.active=true;return result;}});
 if(typeof CanvasRenderingContext2D.prototype.reset==='function'){const nativeReset=CanvasRenderingContext2D.prototype.reset;CanvasRenderingContext2D.prototype.reset=function(this:CanvasRenderingContext2D){const result=Reflect.apply(nativeReset,this,[]),state=clipStates.get(this);if(state){state.active=false;state.stack=[];}return result;};}
 wrap(CanvasRenderingContext2D.prototype,['fillRect','strokeRect','fill','stroke','drawImage','putImageData','fillText','strokeText']);
 wrap(WebGLRenderingContext.prototype,['drawArrays','drawElements']);
 if(typeof WebGL2RenderingContext!=='undefined')wrap(WebGL2RenderingContext.prototype,['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']);
 // Explicit clears change the presented frame, but do not count as draws.
 wrap(WebGLRenderingContext.prototype,['clear'],false);
 if(typeof WebGL2RenderingContext!=='undefined')wrap(WebGL2RenderingContext.prototype,['clear','clearBufferfv','clearBufferiv','clearBufferuiv','clearBufferfi'],false);
 // Assigning either backing dimension clears pixels even when unchanged.
 for(const name of ['width','height']){
  const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name)!;
  Object.defineProperty(HTMLCanvasElement.prototype,name,{...descriptor,set(this:HTMLCanvasElement,value:number){
   Reflect.apply(descriptor.set!,this,[value]);
   const record=records.get(this);if(record){record.draws=0;record.drawFrame=-10;record.image='';record.meaningful=false;record.sampling=undefined;record.textDrawCount=0;record.texts=[];record.seen.clear();record.unverifiedText=0;record.overlapUnverified=0;const ctx=contexts.get(this);if(ctx)clipStates.set(ctx,{active:false,stack:[]});}
  }});
 }
 // Include closed shadow roots created by game scripts. No DOM is modified.
 const roots=new Set<ShadowRoot>();const attach=Element.prototype.attachShadow;
 const parent=(el:Element):Element|null=>el.parentElement??(el.getRootNode() instanceof ShadowRoot?(el.getRootNode() as ShadowRoot).host:null);
 const rendered=(el:Element)=>{
  if(getComputedStyle(el).visibility!=='visible')return false;
  for(let p:Element|null=el;p;p=parent(p)){const s=getComputedStyle(p);if(s.display==='none'||Number(s.opacity)===0||s.contentVisibility==='hidden')return false;}
  return true;
 };
 const fixedBlock=(s:CSSStyleDeclaration)=>s.transform!=='none'||s.perspective!=='none'||s.filter!=='none'||s.backdropFilter!=='none'||/paint|layout|strict|content/.test(s.contain)||/transform|perspective|filter/.test(s.willChange);
 const visibleRect=(el:Element,r:DOMRect,position:'absolute'|'fixed'|null=null)=>{
  let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
  let escaping=position;
  for(let p:Element|null=el;p;p=parent(p)){
   const s=getComputedStyle(p),box=p.getBoundingClientRect();
   if(escaping&&(fixedBlock(s)||escaping==='absolute'&&s.position!=='static'))escaping=null;
   if(!escaping){
    if(s.overflowX!=='visible'){left=Math.max(left,box.left);right=Math.min(right,box.right);}
    if(s.overflowY!=='visible'){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
    if(s.position==='absolute'||s.position==='fixed')escaping=s.position;
   }
  }
  return right>left&&bottom>top;
 };
 const visible=(el:Element)=>{
  if(!rendered(el))return false;
  return visibleRect(el,el.getBoundingClientRect());
 };
 const elements=()=>[...document.querySelectorAll('*'),...[...roots].filter(r=>r.host.isConnected).flatMap(r=>[...r.querySelectorAll('*')])];
 const color=(v:string)=>v!=='transparent'&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(v);
 const hasDom=()=>{
  const nodes=elements();if(nodes.length>4096)return -1;
  for(const el of nodes){
   if(el.matches('canvas,canvas *')||!rendered(el))continue;
   const s=getComputedStyle(el);
   if(s.display.split(' ').includes('list-item')){
    const marker=getComputedStyle(el,'::marker');
    const generated=marker.content!=='none'&&marker.content!=='\"\"'&&marker.content!=="''";
    const normal=marker.content==='normal';
    const image=normal?s.listStyleImage!=='none':marker.content.includes('url(');
    const type=!['none','\"\"',"''"].includes(s.listStyleType);
    const text=(!normal||type)&&parseFloat(marker.fontSize)>0&&(color(marker.color)||marker.textShadow!=='none');
    // Marker boxes have no native Range/rect API. Host clipping/offscreen rects
    // cannot certify outside markers (including inherited types/images).
    if(generated&&(image||text)&&marker.visibility==='visible'&&Number(marker.opacity)!==0)return -1;
   }
   // A generated box can be visible even when its host has zero dimensions.
   for(const pseudo of ['::before','::after']){
    const p=getComputedStyle(el,pseudo);
    if(p.display==='none'||p.visibility!=='visible'||Number(p.opacity)===0||p.content==='none'||p.content==='normal')continue;
    const text=p.content!=='\"\"'&&(p.content.startsWith('url(')||parseFloat(p.fontSize)>0&&color(p.color)||p.textShadow!=='none');
    if(!text&&!color(p.backgroundColor)&&p.backgroundImage==='none'&&p.borderStyle==='none'&&p.boxShadow==='none'&&p.outlineStyle==='none')continue;
    if(p.position==='absolute'||p.position==='fixed'){
     let origin={left:0,top:0};
     for(let ancestor:Element|null=el;ancestor;ancestor=parent(ancestor)){
      const style=getComputedStyle(ancestor);
      if(fixedBlock(style)||p.position==='absolute'&&style.position!=='static'){origin=ancestor.getBoundingClientRect();break;}
     }
     const [x,y,w,h]=[p.left,p.top,p.width,p.height].map(parseFloat);
     if(![x,y,w,h].every(Number.isFinite))return -1;
     if(w===0||h===0){
      const horizontal=parseFloat(p.paddingLeft)+parseFloat(p.paddingRight),vertical=parseFloat(p.paddingTop)+parseFloat(p.paddingBottom);
      const area=(w+horizontal+parseFloat(p.borderLeftWidth)+parseFloat(p.borderRightWidth))>0&&(h+vertical+parseFloat(p.borderTopWidth)+parseFloat(p.borderBottomWidth))>0;
      const decoration=area&&(color(p.backgroundColor)||p.backgroundImage!=='none'||p.borderStyle!=='none')||p.boxShadow!=='none'||p.outlineStyle!=='none';
      // A zero content box is not a zero text paint box. Own overflow can
      // suppress text; shadows/decoration still need independent evidence.
      // Computed serialization may start with content-box/padding-box/border-box.
      // Only a known zero expansion certifies an empty clip; unknown stays closed.
      const zeroClipMargin=p.overflowClipMargin.trim().split(/\s+/).at(-1)==='0px';
      const clipped=(w===0&&horizontal===0&&p.overflowX!=='visible'||h===0&&vertical===0&&p.overflowY!=='visible')&&zeroClipMargin;
      if(text&&!clipped||decoration){
       // Only a clip covering the entire possible viewport proves no paint.
       if(visibleRect(el,new DOMRect(0,0,innerWidth,innerHeight),p.position))return -1;
      }
      continue;
     }
     if(visibleRect(el,new DOMRect(origin.left+x,origin.top+y,w,h),p.position))return 1;
    }else if(visible(el))return 1;
    else return -1; // In-flow generated paint has no DOM Range/box to certify.
   }
   // Text paint does not require an element box (display:contents, overflow).
   for(const node of el.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()&&(color(s.color)||s.textShadow!=='none')){
    const range=document.createRange();range.selectNodeContents(node);
    if([...range.getClientRects()].some(r=>visibleRect(el,r)))return 1;
   }
   const outline=s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0&&color(s.outlineColor);
   if(!visible(el)){if(s.boxShadow!=='none'||outline)return -1;continue;}
   // Transparent layout containers and solid document backdrop are technical.
   // ARIA roles/classes never exempt visible text, controls or decoration.
   if(el instanceof SVGElement||el.matches('button,input,select,textarea,img,video,audio[controls],iframe,object,embed,hr,meter,progress'))return 1;
   if(s.backgroundImage!=='none'||s.boxShadow!=='none'||outline||(!el.matches('body,html')&&(color(s.backgroundColor)||(['Top','Right','Bottom','Left'] as const).some(side=>parseFloat(s['border'+side+'Width' as keyof CSSStyleDeclaration] as string)>0&&color(s['border'+side+'Color' as keyof CSSStyleDeclaration] as string)))))return 1;
  }
  return 0;
 };
 // Latch violations between probes (including menus removed by the next input).
 let domSeen=parserRoot?-1:0;
 for(const owner of [Element.prototype,ShadowRoot.prototype,Document.prototype,Document])for(const name of ['setHTML','setHTMLUnsafe','parseHTML','parseHTMLUnsafe','write','writeln']){
  const descriptor=Object.getOwnPropertyDescriptor(owner,name),native=descriptor?.value;
  if(typeof native!=='function')continue;
  Object.defineProperty(owner,name,{...descriptor,value:function(this:unknown,...args:unknown[]){
   const result=Reflect.apply(native,this,args);domSeen=-1;return result;
  }});
 }
 const scan=()=>{const dom=hasDom();if(dom)domSeen=dom;};
 const observer=new MutationObserver(scan);observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 Element.prototype.attachShadow=function(init:ShadowRootInit){const root=Reflect.apply(attach,this,[init]);roots.add(root);observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return root;};
 Object.defineProperty(window,key,{value:()=>{
  scan();
  const surfaces=elements().filter((el):el is HTMLCanvasElement=>el instanceof HTMLCanvasElement&&visible(el));
  const canvases=surfaces.map(canvas=>{
   if(!ids.has(canvas))ids.set(canvas,++nextId);
   const record=records.get(canvas);if(record?.context==='2d')sample(canvas,record);
   const r=canvas.getBoundingClientRect();
   // A transparent Canvas HUD may overlap the world. Look through only native
   // 2D transparent pixels; an opaque overlaid surface cannot validate hidden art.
   const exposed=[.25,.5,.75].some(x=>[.25,.5,.75].some(y=>{
    const px=Math.max(0,r.left)+Math.min(r.width,innerWidth-Math.max(0,r.left))*x,py=Math.max(0,r.top)+Math.min(r.height,innerHeight-Math.max(0,r.top))*y;
    let hit=document.elementFromPoint(px,py);while(hit?.shadowRoot)hit=hit.shadowRoot.elementFromPoint(px,py);
    if(!(hit instanceof HTMLCanvasElement))return false;
    // Hit testing ignores pointer-events:none. Include such painted layers.
    // Sibling Canvas stacking is supported; ambiguous ancestor stacking is
    // conservatively obstructing, so it cannot manufacture exposed evidence.
    return surfaces.filter(other=>{
     if(other===canvas)return false;
     const box=other.getBoundingClientRect();if(px<box.left||px>=box.right||py<box.top||py>=box.bottom)return false;
     if(other.parentElement!==canvas.parentElement)return true;
     const z=(el:Element)=>{const s=getComputedStyle(el);return s.position==='static'?0:Number(s.zIndex)||0;};
     return z(other)>z(canvas)||z(other)===z(canvas)&&!!(canvas.compareDocumentPosition(other)&Node.DOCUMENT_POSITION_FOLLOWING);
    }).every(other=>{
     if(records.get(other)?.context!=='2d')return false;
     try{const h=other.getBoundingClientRect(),ctx=Reflect.apply(nativeGet,other,['2d']);return Reflect.apply(nativePixels,ctx,[Math.floor((px-h.left)*other.width/h.width),Math.floor((py-h.top)*other.height/h.height),1,1]).data[3]<16;}catch{return false;}
    });
   }));
   const fresh=record&&(record.preserved||frame-record.drawFrame<=1);
   const texts=record?.texts.map((entry:any)=>{const count=(record.seen.get(entry.key)??0)+1;record.seen.set(entry.key,count);const {inkPixels,...publicEntry}=entry;return {...publicEntry,stableSamples:count};})??[];
   const textOverlaps:any[]=[];let textOverlapCoverage=record?.context==='2d'&&!(record.overlapUnverified??1)?'VERIFIED':'NOT_VERIFIED';
   if(record?.context==='2d'){
    const ink=record.texts.filter((entry:any)=>entry.status==='VISIBLE'&&Array.isArray(entry.inkPixels)&&entry.inkPixels.length>0);
    if(record.texts.some((entry:any)=>!Array.isArray(entry.inkPixels)||!entry.inkPixels.length))textOverlapCoverage='NOT_VERIFIED';
    const activePairs=new Set<string>();
    for(let i=0;i<ink.length;i++)for(let j=i+1;j<ink.length;j++){
     const earlier=ink[i],later=ink[j];
     const a=new Set<number>(earlier.inkPixels),b=new Set<number>(later.inkPixels),small=a.size<=b.size?a:b,large=small===a?b:a;
     let intersectionPixels=0;for(const pixel of small)if(large.has(pixel))intersectionPixels++;
     const overlapRatio=intersectionPixels/Math.min(a.size,b.size);if(intersectionPixels<4||overlapRatio<.05)continue;
     if(earlier.textHash===later.textHash){textOverlapCoverage='NOT_VERIFIED';continue;}
     const pairKey=`${canvas.width}x${canvas.height}|${earlier.key}|${later.key}|${intersectionPixels}`,prior=record.overlapSeen.get(pairKey)??{count:0,lastFrame:-1};activePairs.add(pairKey);
     if(prior.lastFrame!==frame){prior.count++;prior.lastFrame=frame;}record.overlapSeen.set(pairKey,prior);
     const roundedBounds=(v:any)=>Object.fromEntries(Object.entries(v).map(([key,value])=>[key,Math.round(Number(value)*100)/100]));
     textOverlaps.push({earlierTextHash:earlier.textHash,laterTextHash:later.textHash,drawOrder:[earlier.drawOrder,later.drawOrder],earlierBounds:roundedBounds(earlier.bounds),laterBounds:roundedBounds(later.bounds),intersectionPixels,overlapRatio:Number(overlapRatio.toFixed(4)),stableSamples:prior.count,status:prior.count>=2?'CONFIRMED':'OBSERVED'});
    }
    for(const key of record.overlapSeen.keys())if(!activePairs.has(key))record.overlapSeen.delete(key);
    if(record.overlapSeen.size>64)record.overlapSeen.clear();
   }
   if(record){const active=new Set(texts.map((entry:any)=>entry.key));for(const key of record.seen.keys())if(!active.has(key))record.seen.delete(key);if(record.seen.size>64)record.seen.clear();}
   return {id:ids.get(canvas)!,context:record?.context??'',draws:record?.draws??0,image:fresh?record.image:'',meaningful:!!fresh&&record.meaningful,sampling:record?.sampling,layoutCoverage:record?.context==='2d'?'canvas2d-text-metrics':'NOT_VERIFIED',unverifiedText:record?.unverifiedText??0,textOverlapCoverage,textOverlaps:textOverlaps.slice(0,8),texts,
    fits:r.width>=20&&r.height>=20&&r.width<=innerWidth+2&&r.height<=innerHeight+2&&r.left>=-2&&r.right<=innerWidth+2&&canvas.width>0&&canvas.height>0,
    exposed};
  });
  // Visible game DOM is forbidden, including menus, HUD and terminal UI.
  return {canvases,dom:domSeen};
 }});
}

export interface CanvasTextLayout {key?:string;textHash:string;length:number;edges:string[];bounds:{left:number;top:number;right:number;bottom:number};clippedCss:{left:number;top:number;right:number;bottom:number};textAlign:string;textBaseline:string;transform:number[];canvas:{width:number;height:number;cssWidth:number;cssHeight:number};stableSamples:number;status:'VISIBLE'|'CLIPPED'|'NOT_VERIFIED';reason?:string}
export interface CanvasTextOverlapEvidence {earlierTextHash:string;laterTextHash:string;drawOrder:[number,number];earlierBounds:{left:number;top:number;right:number;bottom:number};laterBounds:{left:number;top:number;right:number;bottom:number};intersectionPixels:number;overlapRatio:number;stableSamples:number;status:'OBSERVED'|'CONFIRMED'}
export interface CanvasSnapshot {canvases:{id:number;context:string;draws:number;image:string;meaningful:boolean;sampling?:{width:number;height:number;colorBuckets:number;significantColors:number;largestColorPixels:number};fits:boolean;exposed:boolean;layoutCoverage?:string;unverifiedText?:number;textOverlapCoverage?:'VERIFIED'|'NOT_VERIFIED';textOverlaps?:CanvasTextOverlapEvidence[];texts?:CanvasTextLayout[]}[];dom:number;terminal?:boolean}
export interface CanvasProbe {point:[number,number];cssPoint?:[number,number];canvasId:number|null;hashChanged:boolean;drawDelta:number|null;before?:CanvasSnapshot['canvases'][number];after?:CanvasSnapshot['canvases'][number];tapAttempted?:boolean;tapCompleted?:boolean;startActionEvidence?:'unverified'}
export function canvasTextLayoutEvidence(snapshot:CanvasSnapshot,viewport:{width:number;height:number},phase:string){
 const text=snapshot.canvases.flatMap(canvas=>(canvas.texts??[]).map(item=>({...item,canvasId:canvas.id,coverage:canvas.layoutCoverage??'NOT_VERIFIED'})));
 const clipped=text.filter(item=>item.status==='CLIPPED'&&item.stableSamples>=2);
 const overflow=(item:CanvasTextLayout)=>Math.max(0,...Object.values(item.clippedCss));
 const blockingClips=clipped.filter(item=>overflow(item)>2),minorClips=clipped.filter(item=>overflow(item)<=2);
 const overlaps=snapshot.canvases.flatMap(canvas=>(canvas.textOverlaps??[]).filter(item=>item.status==='CONFIRMED').map(item=>({...item,canvasId:canvas.id})));
 const coverage=snapshot.canvases.length>0&&snapshot.canvases.every(canvas=>canvas.layoutCoverage==='canvas2d-text-metrics'&&(canvas.unverifiedText??0)===0&&(canvas.texts??[]).every(item=>item.status!=='NOT_VERIFIED'))?'VERIFIED':'NOT_VERIFIED';
 const overlapCoverage=snapshot.canvases.length>0&&snapshot.canvases.every(canvas=>canvas.textOverlapCoverage==='VERIFIED')?'VERIFIED':'NOT_VERIFIED';
 const confirmed=blockingClips.length>0||overlaps.length>0;
 return{status:confirmed?'FAIL':minorClips.length?'NOT_VERIFIED':coverage,confirmed,coverage,minorClippingWarning:minorClips.length?{count:minorClips.length,maxCssPixels:Math.max(...minorClips.map(overflow))}:undefined,overlapStatus:overlaps.length?'FAIL':overlapCoverage,overlapCoverage,viewport,dpr:2,phase,canvases:snapshot.canvases.map(canvas=>({id:canvas.id,context:canvas.context,layoutCoverage:canvas.layoutCoverage??'NOT_VERIFIED',unverifiedText:canvas.unverifiedText??0,textOverlapCoverage:canvas.textOverlapCoverage??'NOT_VERIFIED',observedTextCount:canvas.texts?.length??0,observedOverlapCount:canvas.textOverlaps?.length??0})),texts:text.slice(0,8).map(({key,...item})=>item),overlaps:overlaps.slice(0,4),semanticHitboxes:'NOT_VERIFIED'};
}
export function requireCanvasTextLayout(samples:CanvasSnapshot[],viewport:{width:number;height:number},phase:string):void {
 const sample=samples.at(-1);if(!sample)return;
 const evidence=canvasTextLayoutEvidence(sample,viewport,phase);
 if(evidence.confirmed){const overlap=evidence.overlaps.length>0,code=overlap?'BROWSER_CANVAS_UI_OVERLAP':'BROWSER_CANVAS_TEXT_CLIPPED';const diagnosis=overlap?'Repeated Canvas 2D glyph raster masks share a material number of backing-store pixels across distinct text draws. The evidence records actual glyph pixels and draw order; text bounding rectangles alone are not used.':'Repeated Canvas 2D text glyph bounds extend beyond the backing bitmap. Keep the complete measured text bounds inside the Canvas and preserve the game mechanics.';const error=Object.assign(new Fault(code,502),{feedback:JSON.stringify({...evidence,diagnosis})});throw error;}
}
/** Compact evidence for diagnosis; never participates in acceptance. */
export function canvasDiagnosticFeedback(code:string,phase:string,samples:CanvasSnapshot[],probes:CanvasProbe[]=[],viewport?:{width:number;height:number},jsErrors:string[]=[],screenshot?:{captureId:string;sha256:string}):string {
 const selectedProbes=probes.slice(-4),relevantIds=new Set(selectedProbes.map(p=>p.canvasId).filter((id):id is number=>id!==null));
 const selectedSamples=samples.length<=3?samples:[samples[0],...samples.slice(-2)];
 const observations=selectedSamples.map((s,index)=>({sample:index,dom:s.dom,canvases:s.canvases.filter((c,i)=>i<2||relevantIds.has(c.id)).slice(0,4).map(c=>({id:c.id,context:c.context,draws:c.draws,meaningful:c.meaningful,sampling:c.sampling??null,fits:c.fits,exposed:c.exposed,hash:c.image||null}))}));
 const diagnosis=code==='BROWSER_CANVAS_UI_OVERLAP'
  ?'Repeated rasterized Canvas glyph masks overlap at the listed backing-store pixels. The conflict is between separate text draws in this viewport and draw order; no full label text or inferred control names are included.'
  :code==='BROWSER_CANVAS_TEXT_CLIPPED'
  ?'Repeated browser TextMetrics and the active transform prove that visible Canvas text extends beyond the backing bitmap; Canvas clip paths and maxWidth cases are excluded from this confirmed result.'
  :code==='BROWSER_CANVAS_ACTIVITY_UNVERIFIED'
  ?'No exposed meaningful Canvas change was observed after the recorded probes; this can mean static gameplay or an interaction point that missed the intended control.'
  :code==='BROWSER_CANVAS_RENDER_UNVERIFIED'
   ?'Canvas was missing, stale, hidden, empty, or lacked substantial sampled colors; compare draw counts, exposure and hashes.'
   :'The protected browser check timed out; the recorded generic tap does not prove which game action was reached or whether its loop stalled.';
 let layout=samples.at(-1)&&viewport?canvasTextLayoutEvidence(samples.at(-1)!,viewport,phase):null;
 if(code==='BROWSER_CANVAS_TEXT_CLIPPED'&&layout&&viewport){
  // The fault is raised when a previously stable clipped label is observed.
  // Preserve that exact evidence even if a later frame no longer draws it.
  const clipped=samples.flatMap(sample=>canvasTextLayoutEvidence(sample,viewport,phase).texts).filter(item=>item.status==='CLIPPED'&&item.stableSamples>=2).slice(-2);
  if(clipped.length)layout={...layout,status:'FAIL',confirmed:true,coverage:'VERIFIED',texts:clipped};
 }
 const report={code,phase,viewport:viewport?{...viewport,dpr:2}:null,diagnosis,observations,canvasTextLayout:layout,probes:selectedProbes.map(p=>({point:p.point,cssPoint:p.cssPoint,canvasId:p.canvasId,hashChanged:p.hashChanged,drawDelta:p.drawDelta,tapAttempted:p.tapAttempted,tapCompleted:p.tapCompleted,before:p.before,after:p.after})),...(screenshot?{screenshot:{captureId:screenshot.captureId,sha256:screenshot.sha256}}:{}),startActionEvidence:'unverified: Canvas-only checker cannot identify the semantic action from a generic tap',jsErrors:jsErrors.slice(0,2).map(e=>e.slice(0,120))};
 if(code==='BROWSER_CANVAS_TEXT_CLIPPED'&&layout&&Array.isArray(layout.texts))layout.texts=layout.texts.filter((item:any)=>item.status==='CLIPPED').slice(0,2);
 if(code==='BROWSER_CANVAS_UI_OVERLAP'&&layout&&Array.isArray(layout.overlaps))layout.overlaps=layout.overlaps.filter((item:any)=>item.status==='CONFIRMED').slice(0,2);
 let encoded=JSON.stringify(report);
 while(encoded.length>2000&&report.probes.length){report.probes.shift();encoded=JSON.stringify(report);}
 while(encoded.length>2000&&report.observations.length>1){report.observations.splice(1,1);encoded=JSON.stringify(report);}
 while(encoded.length>2000&&layout&&Array.isArray(layout.texts)&&layout.texts.length>1){layout.texts.pop();encoded=JSON.stringify(report);}
 return encoded;
}
export async function canvasSnapshot(frame:Frame,key:string):Promise<CanvasSnapshot>{
 return frame.evaluate(key=>(window as unknown as Record<string,()=>CanvasSnapshot>)[key](),key);
}
/** A clear can briefly precede the next frame. Allow at most 100 ms to redraw,
 * within the caller's existing browser deadline; never reuse an older image. */
export async function finalCanvasSnapshot(frame:Frame,key:string):Promise<CanvasSnapshot>{
 let current=await canvasSnapshot(frame,key);
 for(let n=0;n<2&&(!current.canvases.length||current.canvases.some(c=>!c.fits||c.draws<=0||!c.meaningful||!c.context));n++){
  await frame.page().waitForTimeout(50);current=await canvasSnapshot(frame,key);
 }
 return current;
}
export function requireCanvas(samples:CanvasSnapshot[],requireChange=true):('2d'|'webgl'|'webgl2')[]{
 if(samples.some(s=>s.dom===-1))throw new Fault('BROWSER_CANVAS_DOM_UNVERIFIED',502);
 if(samples.some(s=>s.dom))throw new Fault('BROWSER_DOM_GAME_UI',502);
 const last=samples.at(-1)!;
 if(!last.canvases.length)throw new Fault('BROWSER_CANVAS_REQUIRED',502);
 if(last.canvases.some(c=>!c.fits))throw new Fault('BROWSER_CANVAS_LAYOUT',502);
 const usable=(c:CanvasSnapshot['canvases'][number])=>c.fits&&c.exposed&&c.draws>0&&c.meaningful&&!!c.context;
 const changed=(c:CanvasSnapshot['canvases'][number])=>samples.some(s=>!s.terminal&&s.canvases.some(p=>usable(p)&&p.id===c.id&&p.context===c.context&&p.image!==c.image));
 // Every visible Canvas layer must actually render. A live HUD cannot conceal
 // an erased/stale WebGL world, and a decorative Canvas cannot rescue DOM UI.
 if(last.canvases.some(c=>!c.context||c.draws<=0||!c.meaningful))throw new Fault('BROWSER_CANVAS_RENDER_UNVERIFIED',502);
 const drawn=last.canvases.filter(usable);
 if(!drawn.length)throw new Fault('BROWSER_CANVAS_RENDER_UNVERIFIED',502);
 if(requireChange&&!drawn.some(changed))throw new Fault('BROWSER_CANVAS_ACTIVITY_UNVERIFIED',502);
 return [...new Set(drawn.map(c=>c.context))] as ('2d'|'webgl'|'webgl2')[];
}
