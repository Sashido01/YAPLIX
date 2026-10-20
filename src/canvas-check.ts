import type {Frame} from 'playwright-core';
import {Fault} from './contracts.ts';

/** Runs before game scripts, only in the disposable validation browser. Native
 * calls retain their receiver/arguments/results. No game source is rewritten. */
export function observeCanvas({key,html}:{key:string;html:string}) {
 // DOMParser is inert and retains declarative shadow templates. Native parser
 // roots can bypass attachShadow, so their contents cannot earn strict evidence.
 const parserRoot=!!new DOMParser().parseFromString(html,'text/html').querySelector('template[shadowrootmode]');
 const records=new Map<HTMLCanvasElement,{context:string;draws:number;image:string;meaningful:boolean;preserved:boolean;drawFrame:number}>();
 // Expire non-preserved evidence even when the game stops scheduling frames.
 // This observer never draws or changes the game's context options.
 let frame=0;const nativeFrame=window.requestAnimationFrame.bind(window);
 const advance=()=>{frame++;nativeFrame(advance);};nativeFrame(advance);
 const dirty=new Set<HTMLCanvasElement>();let pending=false;
 const ids=new WeakMap<HTMLCanvasElement,number>();let nextId=0;
 const nativeGet=HTMLCanvasElement.prototype.getContext;
 const nativeDraw=CanvasRenderingContext2D.prototype.drawImage;
 const nativePixels=CanvasRenderingContext2D.prototype.getImageData;
 const sample=(canvas:HTMLCanvasElement,record:{image:string;meaningful:boolean})=>{
  try{
   const probe=document.createElement('canvas');probe.width=32;probe.height=24;
   const ctx=Reflect.apply(nativeGet,probe,['2d']) as CanvasRenderingContext2D;
   Reflect.apply(nativeDraw,ctx,[canvas,0,0,32,24]);
   const pixels=Reflect.apply(nativePixels,ctx,[0,0,32,24]).data;
   const colors=new Map<number,number>();let hash=2166136261;
   for(let i=0;i<pixels.length;i+=4){
    const color=pixels[i+3]<16?0:1+(pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4);
    colors.set(color,(colors.get(color)??0)+1);
    hash=Math.imul(hash^color,16777619);
   }
   record.image=String(hash>>>0);
   // A blank/solid clear, a lone pixel or a thin decorative line is insufficient.
   record.meaningful=[...colors.values()].filter(n=>n>=8).length>=2;
  }catch{record.image='';record.meaningful=false;}
 };
 HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<HTMLCanvasElement['getContext']>){
  const result=Reflect.apply(nativeGet,this,args);
  if(result&&['2d','webgl','webgl2'].includes(args[0])&&!records.has(this)&&records.size<32)
   records.set(this,{context:args[0],draws:0,image:'',meaningful:false,drawFrame:-10,
    preserved:args[0]==='2d'||!!(result as WebGLRenderingContext).getContextAttributes()?.preserveDrawingBuffer});
  return result;
 } as HTMLCanvasElement['getContext'];
 const wrap=(prototype:object,names:string[],draw=true)=>{
  for(const name of names){
   const native=(prototype as Record<string,Function>)[name];if(typeof native!=='function')continue;
   Object.defineProperty(prototype,name,{configurable:true,writable:true,value:function(this:{canvas:HTMLCanvasElement},...args:unknown[]){
    const result=Reflect.apply(native,this,args),record=records.get(this.canvas);
    if(record){
     if(draw){record.draws++;record.drawFrame=frame;}
     if(record.context!=='2d'){
      // Read at the end of this callback, after its synchronous draws/clears,
      // before presentation can implicitly discard the drawing buffer.
      record.image='';record.meaningful=false;dirty.add(this.canvas);
      if(!pending){pending=true;queueMicrotask(()=>{
       pending=false;for(const canvas of dirty){const current=records.get(canvas);if(current)sample(canvas,current);}dirty.clear();
      });}
     }
    }
    return result;
   }});
  }
 };
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
   const record=records.get(this);if(record){record.draws=0;record.drawFrame=-10;record.image='';record.meaningful=false;}
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
   return {id:ids.get(canvas)!,context:record?.context??'',draws:record?.draws??0,image:fresh?record.image:'',meaningful:!!fresh&&record.meaningful,
    fits:r.width>=20&&r.height>=20&&r.width<=innerWidth+2&&r.height<=innerHeight+2&&r.left>=-2&&r.right<=innerWidth+2&&canvas.width>0&&canvas.height>0,
    exposed};
  });
  // Visible game DOM is forbidden, including menus, HUD and terminal UI.
  return {canvases,dom:domSeen};
 }});
}

export interface CanvasSnapshot {canvases:{id:number;context:string;draws:number;image:string;meaningful:boolean;fits:boolean;exposed:boolean}[];dom:number;terminal?:boolean}
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
