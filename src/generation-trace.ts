import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { DATA_ROOT, managedPath } from './store.ts';
import { uuid } from './contracts.ts';

export type TraceStatus='STARTED'|'PASS'|'FAIL'|'NOT_VERIFIED'|'SKIPPED';
export type TraceData = { status?:TraceStatus; details?:Record<string,unknown>; durationMs?:number; wireBytes?:number; profileWidth?:number; profileHeight?:number; viewport?:string; validationPhase?:string; maxOutputTokens?:number; inputTokens?:number; networkRoute?:string; networkStage?:string; provider?:string|null; requestedModel?:string|null; actualModel?:string|null; attempt?:number; httpStatus?:number; inputBytes?:number; outputBytes?:number; outputTokens?:number; reasoningTokens?:number; finishReason?:string|null; errorCode?:string|null; next?:string };
const events = new Set(['job.created','job.resumed','prompt.prepared','prompt.capture.completed','provider.selected','provider.catalog_completed','request.started','request.wire_dispatched','response.headers','response.first_byte','response.stream_completed','response.failed','html.extracted','html.validated','browser.started','browser.launch.started','browser.launch.completed','browser.launch.failed','browser.phase.started','browser.phase.completed','browser.validator_routed','browser.viewport.started','browser.viewport.completed','browser.snapshot.saved','browser.runtime_error','browser.validation_completed','repair.eligibility','repair.started','repair.completed','version.saved','version.export.started','version.export.completed','version.export.failed','ui.game_opened','ui.viewport_changed','ui.panel_changed','ui.editor_state','ui.host_error','ui.api_error','ui.state_error','ui.game_runtime_error','ui.game_activity','ui.export_opened','job.completed','job.failed','job.cancelled','job.retry_scheduled']);
const statuses=new Set<TraceStatus>(['STARTED','PASS','FAIL','NOT_VERIFIED','SKIPPED']);
const numeric = ['durationMs','wireBytes','profileWidth','profileHeight','maxOutputTokens','inputTokens','attempt','httpStatus','inputBytes','outputBytes','outputTokens','reasoningTokens'] as const;
const textual = ['viewport','validationPhase','networkRoute','networkStage','provider','requestedModel','actualModel','finishReason','errorCode','next'] as const;
const detailKeys = new Set(['nodeVersion','browserTarget','browserChannel','browserExecutable','browserExecutableExists','browserReady','sandboxEnabled','sandboxHelper','sandboxHelperUid','sandboxHelperMode','tempProfileReady','launchErrorCategory','launchError','viewport','deviceScaleFactor','phase','phaseIndex','jsErrorCount','drawCalls','frameChanged','frameHashBefore','frameHashAfter','canvasContexts','canvasTextLayout','canvasSampling','inputAction','inputX','inputY','inputObserved','checkpointSha256','promptSha256','promptBytes','promptStyle','requestBudget','repairBudget','vocabularyVersion','archetypeId','genreId','appliedRuleCount','ruleSources','suppressedAssumptionCount','hintBytes','classificationMs','mode','providerMode','providerConfigured','providerReadiness','reasonCode','selectedVersion','uiBusy','activeEdit','instructionReady','versionId','timeBudgetMs','htmlSha256','htmlBytes','dispatchStarted','postOutcome','repairNumber','repairBudgetRemaining','attemptNumber','saveGameId','saveVersionId','exportSha256','exportBytes','captureId','snapshotCaptureId','snapshotSha256','config','blockers','screen','panel','gameArea','frameVisible','orientation','stack']);
const traceName = /^[0-9a-f-]{36}\.jsonl(?:\.1)?$/;
const root = managedPath('.local/diagnostics/generation');

/** Only metadata is accepted. Never pass prompts, source, headers or exception text. */
export function safeTrace(event:string,jobId:string,data:TraceData={},env:NodeJS.ProcessEnv=process.env) {
  if(!events.has(event))throw Error('INVALID_TRACE_EVENT');
  const secrets=Object.entries(env).filter(([k,v])=>/KEY|TOKEN|SECRET|PASSWORD|PROXY/i.test(k)&&v&&v.length>=4).map(([,v])=>v!);
  const safe=(value:unknown)=>{
    if(typeof value!=='string'||value.length>128||!/^[a-zA-Z0-9_.:/-]+$/.test(value)||/bearer|password|secret|token|api.key|https?:/i.test(value)||secrets.some(s=>value.includes(s)))return null;
    return value;
  };
  const inferred:TraceStatus=data.status&&statuses.has(data.status)?data.status:(event.endsWith('.started')?'STARTED':data.errorCode?( /TIMEOUT|INCONCLUSIVE|UNAVAILABLE|NOT_VERIFIED/.test(data.errorCode)?'NOT_VERIFIED':'FAIL'):event.endsWith('.failed')||event==='job.failed'||event==='browser.runtime_error'?'FAIL':event.endsWith('.completed')||event==='job.created'||event==='job.resumed'||event==='html.extracted'||event==='html.validated'||event==='provider.selected'||event==='version.saved'?'PASS':'PASS');
  const stage=event.startsWith('browser.launch.')?'browser.launch':event.startsWith('browser.viewport.')?'browser.viewport':event.split('.')[0];
  const operationId=process.env.YAPLIX_OPERATION_ID;
  const row:Record<string,unknown>={timestamp:new Date().toISOString(),jobId:uuid(jobId),correlationId:uuid(jobId),...(typeof operationId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)?{operationId}:{}),event,stage,status:inferred};
  for(const k of numeric)row[k]=typeof data[k]==='number'&&Number.isFinite(data[k])&&data[k]!>=0?Math.round(data[k]!):null;
  for(const k of textual)row[k]=safe(data[k]);
  if(data.details&&typeof data.details==='object'&&!Array.isArray(data.details)){
    const details:Record<string,unknown>={};for(const [key,value]of Object.entries(data.details))if(detailKeys.has(key)){
      if(key==='canvasTextLayout'&&value&&typeof value==='object'&&!Array.isArray(value)){
        const layout=value as Record<string,any>,finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000?Math.round(n*100)/100:undefined;
        const box=(v:unknown)=>{if(!v||typeof v!=='object')return undefined;const o=v as Record<string,unknown>,result:Record<string,number>={};for(const k of ['left','top','right','bottom']){const n=finite(o[k]);if(n===undefined)return undefined;result[k]=n;}return result;};
        const dimensions=(v:unknown,keys=['width','height','cssWidth','cssHeight'])=>{if(!v||typeof v!=='object')return undefined;const o=v as Record<string,unknown>,result:Record<string,number>={};for(const k of keys){const n=finite(o[k]);if(n===undefined||n<0)return undefined;result[k]=n;}return result;};
        const texts=Array.isArray(layout.texts)?layout.texts.slice(0,4).flatMap((item:Record<string,any>)=>{if(!item||typeof item!=='object'||typeof item.textHash!=='string'||!/^\d{1,12}$/.test(item.textHash)||!Number.isSafeInteger(item.length)||item.length<1||item.length>10000||!Array.isArray(item.edges)||!item.edges.every((v:string)=>['left','right','top','bottom'].includes(v)))return[];const bounds=box(item.bounds),clippedCss=box(item.clippedCss);if(!bounds||!clippedCss)return[];return[{textHash:item.textHash,length:item.length,edges:item.edges.slice(0,4),bounds,clippedCss,textAlign:['start','end','left','right','center'].includes(item.textAlign)?item.textAlign:null,textBaseline:['top','hanging','middle','alphabetic','ideographic','bottom'].includes(item.textBaseline)?item.textBaseline:null,transform:Array.isArray(item.transform)&&item.transform.length===6?item.transform.map(finite):[],canvas:dimensions(item.canvas),stableSamples:Number.isSafeInteger(item.stableSamples)?Math.min(item.stableSamples,100):0,status:['VISIBLE','CLIPPED','NOT_VERIFIED'].includes(item.status)?item.status:null,reason:['max-width','active-clip'].includes(item.reason)?item.reason:null}];}):[];
        details[key]={status:['VERIFIED','FAIL','NOT_VERIFIED'].includes(layout.status)?layout.status:'NOT_VERIFIED',confirmed:layout.confirmed===true,coverage:['VERIFIED','NOT_VERIFIED'].includes(layout.coverage)?layout.coverage:'NOT_VERIFIED',viewport:dimensions(layout.viewport,['width','height']),dpr:finite(layout.dpr),phase:safe(layout.phase),semanticHitboxes:'NOT_VERIFIED',canvases:Array.isArray(layout.canvases)?layout.canvases.slice(0,4).map((c:Record<string,any>)=>({id:Number.isSafeInteger(c.id)?c.id:null,context:['2d','webgl','webgl2'].includes(c.context)?c.context:null,layoutCoverage:c.layoutCoverage==='canvas2d-text-metrics'?'canvas2d-text-metrics':'NOT_VERIFIED',unverifiedText:Number.isSafeInteger(c.unverifiedText)?Math.min(c.unverifiedText,10000):0,observedTextCount:Number.isSafeInteger(c.observedTextCount)?Math.min(c.observedTextCount,10000):0})):[],texts};
      }
      else if(key==='canvasSampling'&&Array.isArray(value))details[key]=value.slice(0,4).flatMap((item:Record<string,unknown>)=>{if(!item||typeof item!=='object')return[];const n=(v:unknown,max:number)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max?Number(v):null;return[{id:n(item.id,32),context:['2d','webgl','webgl2'].includes(String(item.context))?item.context:null,width:n(item.width,4096),height:n(item.height,4096),colorBuckets:n(item.colorBuckets,1_000_000),significantColors:n(item.significantColors,1_000_000),largestColorPixels:n(item.largestColorPixels,1_000_000)}];});
      else if(typeof value==='number'&&Number.isFinite(value)&&value>=0)details[key]=Math.round(value);
      else if(typeof value==='boolean')details[key]=value;
      else if(typeof value==='string'){
        let candidate=value.slice(0,key==='launchError'?300:key==='stack'?2048:128).replace(/[\r\n\t]/g,' ').replaceAll(homedir(),'<HOME>').replaceAll(process.env.HOME??'\0','<HOME>');
        if(key==='stack')candidate=candidate.replace(/https?:\/\/[^/\s)]+/g,'').replace(/\?[^\s):]*/g,'').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;)]+/gi,'[REDACTED]');
        const clean=key==='launchError'&&candidate.length<=300&&!/https?:|bearer|password|secret|token|api.key/i.test(candidate)&&!secrets.some(s=>candidate.includes(s))?candidate:key==='stack'&&!secrets.some(s=>candidate.includes(s))?candidate:safe(candidate);
        if(clean!==null)details[key]=clean;
      }
      else if(Array.isArray(value)&&value.length<=16&&value.every(v=>typeof v==='string'&&safe(v)!==null||typeof v==='number'&&Number.isFinite(v)&&v>=0||typeof v==='boolean'))details[key]=value.map(v=>typeof v==='string'?safe(v):v);
    }row.details=details;
  }
  return row;
}
export class GenerationTraces {
  private directory:string;private writes=0;
  constructor(directory=root){
    this.directory=resolve(directory);
    if(!this.directory.startsWith(DATA_ROOT+'/')&&!this.directory.startsWith(DATA_ROOT+'\\'))throw Error('TRACE_PATH_OUTSIDE_LOCAL');
    let parent=this.directory;
    while(parent.length>DATA_ROOT.length){if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('TRACE_LINK_FORBIDDEN');parent=resolve(parent,'..');}
    mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);this.prune();
  }
  private file(id:string){return resolve(this.directory,uuid(id)+'.jsonl');}
  private regular(path:string){if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||statSync(path).nlink!==1))throw Error('TRACE_LINK_FORBIDDEN');}
  private prune(){
    const files=readdirSync(this.directory).filter(n=>traceName.test(n)).flatMap(n=>{
      const path=resolve(this.directory,n);
      try{this.regular(path);return[{path,...statSync(path)}];}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}
    }).sort((a,b)=>a.mtimeMs-b.mtimeMs);
    let bytes=files.reduce((sum,f)=>sum+f.size,0);
    for(const f of files)if(Date.now()-f.mtimeMs>7*86400000||bytes>16*1024*1024){
      // Another process may already have pruned this snapshot entry.
      try{unlinkSync(f.path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      bytes-=f.size;
    }
  }
  emit(id:string,event:string,data:TraceData={}){
    const file=this.file(id),line=JSON.stringify(safeTrace(event,id,data))+'\n';this.regular(file);this.regular(file+'.1');
    if(existsSync(file)&&statSync(file).size+Buffer.byteLength(line)>131072){if(existsSync(file+'.1'))unlinkSync(file+'.1');renameSync(file,file+'.1');}
    appendFileSync(file,line,{mode:0o600});chmodSync(file,0o600);if(existsSync(file+'.1'))chmodSync(file+'.1',0o600);if(++this.writes%64===0)this.prune();
  }
  captureMessages(id:string,messages:unknown):string|undefined{
    if(process.env.YAPLIX_CAPTURE_GENERATION_MESSAGES!=='1')return;
    const body=JSON.stringify({jobId:uuid(id),capturedAt:new Date().toISOString(),messages});if(Buffer.byteLength(body)>400000)throw Error('PROMPT_CAPTURE_TOO_LARGE');
    const secrets=Object.entries(process.env).filter(([key,value])=>/KEY|TOKEN|SECRET|PASSWORD/i.test(key)&&value&&value.length>=4).map(([,value])=>value!);
    if(secrets.some(secret=>body.includes(secret))||/Bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S+/i.test(body))throw Error('PROMPT_CAPTURE_SECRET_REJECTED');
    const directory=managedPath('.local/diagnostics/generation-private');if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))throw Error('PROMPT_CAPTURE_PATH_INVALID');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    const captureId=uuid(randomUUID()),path=resolve(directory,uuid(id)+'-'+captureId+'.json');writeFileSync(path,body+'\n',{flag:'wx',mode:0o600});return captureId;
  }
  saveBrowserSnapshot(id:string,viewport:string,image:Uint8Array){
    if(!/^\d{2,4}x\d{2,4}$/.test(viewport)||image.byteLength<8||image.byteLength>2*1024*1024||image[0]!==137||image[1]!==80||image[2]!==78||image[3]!==71)throw Error('BROWSER_SNAPSHOT_INVALID');
    const directory=managedPath('.local/diagnostics/generation-private');if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))throw Error('BROWSER_SNAPSHOT_PATH_INVALID');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    const captureId=uuid(randomUUID()),path=resolve(directory,uuid(id)+'-'+captureId+'.png');writeFileSync(path,image,{flag:'wx',mode:0o600});return{captureId,sha256:createHash('sha256').update(image).digest('hex')};
  }
  report(id:string){
    const file=this.file(id),rows:Record<string,unknown>[]=[];
    for(const path of [file+'.1',file]){this.regular(path);if(existsSync(path))for(const line of readFileSync(path,'utf8').trim().split('\n'))if(line){const row=JSON.parse(line);if(row.correlationId===id&&events.has(row.event))rows.push({...safeTrace(row.event,id,row),timestamp:row.timestamp});}}
    const start=rows.length?Date.parse(String(rows[0].timestamp)):0;
    const timeline=rows.map(row=>({elapsedMs:Math.max(0,Date.parse(String(row.timestamp))-start),stage:row.stage,event:row.event,status:row.status,durationMs:row.durationMs,errorCode:row.errorCode,details:row.details}));
    return {schemaVersion:2,jobId:id,correlationId:id,scope:'metadata-only',retentionDays:7,events:rows,timeline};
  }
}
