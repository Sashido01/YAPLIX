import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './store.ts';
import { uuid } from './contracts.ts';

export type TraceData = { durationMs?:number; wireBytes?:number; profileWidth?:number; validationPhase?:string; maxOutputTokens?:number; inputTokens?:number; networkRoute?:string; networkStage?:string; provider?:string|null; requestedModel?:string|null; actualModel?:string|null; attempt?:number; httpStatus?:number; inputBytes?:number; outputBytes?:number; outputTokens?:number; reasoningTokens?:number; finishReason?:string|null; errorCode?:string|null; next?:string };
const events = new Set(['job.created','job.resumed','prompt.prepared','provider.selected','provider.catalog_completed','request.started','response.headers','response.first_byte','response.stream_completed','response.failed','html.extracted','html.validated','browser.started','browser.runtime_error','browser.validation_completed','repair.started','repair.completed','version.saved','job.completed','job.failed','job.cancelled','job.retry_scheduled']);
const numeric = ['durationMs','wireBytes','profileWidth','maxOutputTokens','inputTokens','attempt','httpStatus','inputBytes','outputBytes','outputTokens','reasoningTokens'] as const;
const textual = ['validationPhase','networkRoute','networkStage','provider','requestedModel','actualModel','finishReason','errorCode','next'] as const;
const traceName = /^[0-9a-f-]{36}\.jsonl(?:\.1)?$/;
const root = resolve(PROJECT_ROOT,'.local/diagnostics/generation');

/** Only metadata is accepted. Never pass prompts, source, headers or exception text. */
export function safeTrace(event:string,jobId:string,data:TraceData={},env:NodeJS.ProcessEnv=process.env) {
  if(!events.has(event))throw Error('INVALID_TRACE_EVENT');
  const secrets=Object.entries(env).filter(([k,v])=>/KEY|TOKEN|SECRET|PASSWORD|PROXY/i.test(k)&&v&&v.length>=4).map(([,v])=>v!);
  const safe=(value:unknown)=>{
    if(typeof value!=='string'||value.length>128||!/^[a-zA-Z0-9_.:/-]+$/.test(value)||/bearer|password|secret|token|api.key|https?:/i.test(value)||secrets.some(s=>value.includes(s)))return null;
    return value;
  };
  const row:Record<string,unknown>={timestamp:new Date().toISOString(),correlationId:uuid(jobId),event,stage:event.split('.')[0]};
  for(const k of numeric)row[k]=typeof data[k]==='number'&&Number.isFinite(data[k])&&data[k]!>=0?Math.round(data[k]!):null;
  for(const k of textual)row[k]=safe(data[k]);
  return row;
}
export class GenerationTraces {
  private directory:string;private writes=0;
  constructor(directory=root){
    this.directory=resolve(directory);
    if(!this.directory.startsWith(resolve(PROJECT_ROOT,'.local')+'/')&&!this.directory.startsWith(resolve(PROJECT_ROOT,'.local')+'\\'))throw Error('TRACE_PATH_OUTSIDE_LOCAL');
    let parent=this.directory;
    while(parent.length>PROJECT_ROOT.length){if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('TRACE_LINK_FORBIDDEN');parent=resolve(parent,'..');}
    mkdirSync(this.directory,{recursive:true});this.prune();
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
    appendFileSync(file,line,{mode:0o600});if(++this.writes%64===0)this.prune();
  }
  report(id:string){
    const file=this.file(id),rows:Record<string,unknown>[]=[];
    for(const path of [file+'.1',file]){this.regular(path);if(existsSync(path))for(const line of readFileSync(path,'utf8').trim().split('\n'))if(line){const row=JSON.parse(line);if(row.correlationId===id&&events.has(row.event))rows.push({...safeTrace(row.event,id,row),timestamp:row.timestamp});}}
    return {schemaVersion:1,correlationId:id,scope:'metadata-only',retentionDays:7,events:rows};
  }
}
