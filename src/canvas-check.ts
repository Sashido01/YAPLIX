import type {Frame} from 'playwright-core';
import {Fault} from './contracts.ts';

/** Runs before game scripts, only in the disposable validation browser. Native
 * calls retain their receiver/arguments/results. No game source is rewritten. */
export function observeCanvas(key:string) {
 const records=new Map<HTMLCanvasElement,{context:string;draws:number;image:string;meaningful:boolean}>();
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
   records.set(this,{context:args[0],draws:0,image:'',meaningful:false});
  return result;
 } as HTMLCanvasElement['getContext'];
 const wrap=(prototype:object,names:string[],draw=true)=>{
  for(const name of names){
   const native=(prototype as Record<string,Function>)[name];if(typeof native!=='function')continue;
   Object.defineProperty(prototype,name,{configurable:true,writable:true,value:function(this:{canvas:HTMLCanvasElement},...args:unknown[]){
    const result=Reflect.apply(native,this,args),record=records.get(this.canvas);
    if(record){if(draw)record.draws++;if(record.context!=='2d')sample(this.canvas,record);}
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
   const record=records.get(this);if(record){record.draws=0;record.image='';record.meaningful=false;}
  }});
 }
 const ui='button,input,select,textarea,output,label,nav,header,footer,[role=button],[role=status],[role=menu],[role=dialog],[aria-live]';
 const visible=(el:Element)=>{
  for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}
  const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
 };
 Object.defineProperty(window,key,{value:()=>{
  const canvases=[...document.querySelectorAll('canvas')].filter(visible).map(canvas=>{
   if(!ids.has(canvas))ids.set(canvas,++nextId);
   const record=records.get(canvas);if(record?.context==='2d')sample(canvas,record);
   const r=canvas.getBoundingClientRect();
   const hit=document.elementFromPoint(Math.max(0,r.left)+Math.min(r.width,innerWidth-Math.max(0,r.left))/2,Math.max(0,r.top)+Math.min(r.height,innerHeight-Math.max(0,r.top))/2);
   return {id:ids.get(canvas)!,context:record?.context??'',draws:record?.draws??0,image:record?.image??'',meaningful:record?.meaningful??false,
    fits:r.width>=20&&r.height>=20&&r.width<=innerWidth+2&&r.height<=innerHeight+2&&r.left>=-2&&r.right<=innerWidth+2&&canvas.width>0&&canvas.height>0,
    exposed:hit===canvas};
  });
  // Conservative observable DOM-world indicators. UI text/controls/containers
  // are allowed; moving sprites, SVG worlds and styled grid cells are not.
  const dom=[...document.querySelectorAll('body *')].filter(el=>{
   if(el.matches('canvas,script,style')||el.closest(ui)||!visible(el))return false;
   if(el instanceof SVGElement)return !!el.closest('svg')&&!el.closest('svg')!.closest(ui);
   const s=getComputedStyle(el),r=el.getBoundingClientRect();
   if(el.children.length||r.width<8||r.height<8)return false;
   const styled=s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.backgroundImage!=='none'||s.borderStyle!=='none';
   const grid=el.parentElement&&getComputedStyle(el.parentElement).display==='grid'&&el.parentElement.children.length>=4;
   return !!styled&&(s.position==='absolute'||s.position==='fixed'||s.transform!=='none'||s.animationName!=='none'||grid);
  }).length;
  return {canvases,dom};
 }});
}

export interface CanvasSnapshot {canvases:{id:number;context:string;draws:number;image:string;meaningful:boolean;fits:boolean;exposed:boolean}[];dom:number}
export async function canvasSnapshot(frame:Frame,key:string):Promise<CanvasSnapshot>{
 return frame.evaluate(key=>(window as unknown as Record<string,()=>CanvasSnapshot>)[key](),key);
}
/** A clear can briefly precede the next frame. Allow at most 100 ms to redraw,
 * within the caller's existing browser deadline; never reuse an older image. */
export async function finalCanvasSnapshot(frame:Frame,key:string):Promise<CanvasSnapshot>{
 let current=await canvasSnapshot(frame,key);
 for(let n=0;n<2&&!current.canvases.some(c=>c.fits&&c.exposed&&c.draws>0&&c.meaningful&&c.context);n++){
  await frame.page().waitForTimeout(50);current=await canvasSnapshot(frame,key);
 }
 return current;
}
export function requireCanvas(samples:CanvasSnapshot[],requireChange=true):('2d'|'webgl'|'webgl2')[]{
 if(samples.some(s=>s.dom))throw new Fault('BROWSER_DOM_GAME_WORLD',502);
 const last=samples.at(-1)!;
 if(!last.canvases.length)throw new Fault('BROWSER_CANVAS_REQUIRED',502);
 if(last.canvases.some(c=>!c.fits))throw new Fault('BROWSER_CANVAS_LAYOUT',502);
 const drawn=last.canvases.filter(c=>c.fits&&c.exposed&&c.draws>0&&c.meaningful&&c.context);
 if(!drawn.length)throw new Fault('BROWSER_CANVAS_RENDER_UNVERIFIED',502);
 if(requireChange&&!drawn.some(c=>samples.some(s=>s.canvases.some(p=>p.id===c.id&&p.context===c.context&&p.image&&p.image!==c.image))))throw new Fault('BROWSER_CANVAS_ACTIVITY_UNVERIFIED',502);
 return [...new Set(drawn.map(c=>c.context))] as ('2d'|'webgl'|'webgl2')[];
}
