import {LIVE_JOB_TIMEOUT_MS,SINGLE_POST_JOB_TIMEOUT_MS} from './generation-timeouts.ts';
import { GenerationTraces, safeTrace } from './generation-trace.ts';
import { OperationTrace, operationId } from '../scripts/operation-trace.mjs';
import { prepareDocument } from './validation.ts';
import { validateDocument } from './generation.ts';
import { randomUUID, createHash } from 'node:crypto';
import { Fault, parseSpec, uuid, MAX_EDIT_PROMPT_CHARS } from './contracts.ts';
import { boundedCode, providerMode } from './transport.ts';
import type { Generator, GenerationContext, CodeTransport, TokenUsage } from './transport.ts';
import type { Store } from './store.ts';
import type { GenerationJob, JobSummary } from './job-contracts.ts';
import { RateLimit } from './rate-limit.ts';

type Request = Pick<GenerationJob,'spec'|'mode'|'previousVersionId'|'telegramConsent'|'providerMode'>;
const terminal=new Set(['completed','cancelled','failed','needs_attention']);
const now=()=>new Date().toISOString();
function reportIdea(value:string){let text=value;for(const[key,secret]of Object.entries(process.env))if(/KEY|TOKEN|SECRET|PASSWORD/i.test(key)&&secret&&secret.length>=4)text=text.replaceAll(secret,'[REDACTED]');return text.replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [REDACTED]').replace(/\b(?:sk|rk|or)-[A-Za-z0-9_-]{16,}\b/g,'[REDACTED]').replace(/(api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]').slice(0,4000);}
type RepairState={repairCount?:number;repairInFlight?:boolean};
type DurableJob=GenerationJob&RepairState;
type DurableSummary=JobSummary&RepairState;
type DurableGenerationContext=GenerationContext&RepairState&{repairResponse?(code:string,model:string|null,tokens?:TokenUsage):void};
const chatgptCheckpoint=(job:GenerationJob)=>job.checkpointOrigin?.provider==='chatgpt'&&job.checkpointOrigin.requestedModel==='gpt-6.1-sol'&&job.checkpointOrigin.model==='gpt-6.1-sol'&&/<\/html>\s*$/i.test(job.checkpoint);
function recoverableConfirmedCanvasRepair(job:DurableJob){
  if(!['BROWSER_CANVAS_TEXT_CLIPPED','BROWSER_CANVAS_UI_OVERLAP'].includes(job.errorCode??'')||job.validation?.level!=='FAILED'||job.validation.code!==job.errorCode||!job.checkpointOrigin||!/<\/html>\s*$/i.test(job.checkpoint)||job.checkpointOrigin.provider!==job.provider||job.checkpointOrigin.requestedModel!==job.requestedModel)return false;
  try{const parsed=JSON.parse(job.validation.feedback??'') as Record<string,any>,layout=parsed.canvasTextLayout??parsed;if(parsed.code!==job.errorCode||layout.confirmed!==true||layout.status!=='FAIL'||!Number.isFinite(layout.viewport?.width)||!Number.isFinite(layout.viewport?.height))return false;
    if(job.errorCode==='BROWSER_CANVAS_TEXT_CLIPPED')return Array.isArray(layout.texts)&&layout.texts.some((item:any)=>item?.status==='CLIPPED'&&Number(item.stableSamples)>=2);
    return layout.overlapStatus==='FAIL'&&Array.isArray(layout.overlaps)&&layout.overlaps.some((item:any)=>item?.status==='CONFIRMED'&&Number(item.stableSamples)>=2&&Number(item.intersectionPixels)>=4&&Number(item.overlapRatio)>=.05)&&typeof parsed.screenshot?.captureId==='string'&&/^[a-f0-9]{64}$/.test(parsed.screenshot.sha256??'');
  }catch{return false;}
}
function postLimit(job:{previousVersionId?:string|null;provider?:string|null;providerMode?:string}):number {
  if(job.provider==='chatgpt'||job.providerMode==='chatgpt')return 1;
  return 4;
}
function processAlive(pid:number){if(!Number.isSafeInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code!=='ESRCH';}}
export class GenerationJobs {
  private traces?:GenerationTraces;private traceWarning=false;
  private trace(job:GenerationJob,event:string,data:import('./generation-trace.ts').TraceData={}){
    try{this.traces??=new GenerationTraces();this.traces.emit(job.jobId,event,{provider:job.provider,requestedModel:job.requestedModel,actualModel:job.actualModel,attempt:job.attempts,...data});}
    catch{if(!this.traceWarning){this.traceWarning=true;console.warn('GENERATION_DIAGNOSTICS_UNAVAILABLE');}try{const current=this.get(job.ownerId,job.jobId);current.diagnosticsUnavailable=true;job.diagnosticsUnavailable=true;this.write(current);}catch{/* The durable job state remains authoritative if the worker lease is gone. */}}
  }
  report(owner:string,id:string){const job=this.get(owner,id),snapshot=safeTrace('job.resumed',id,{provider:job.provider,requestedModel:job.requestedModel,actualModel:job.actualModel,attempt:job.attempts,errorCode:job.errorCode,durationMs:job.elapsedMs});let report,unavailable=Boolean(job.diagnosticsUnavailable);try{this.traces??=new GenerationTraces();report=this.traces.report(id);}catch{unavailable=true;report={schemaVersion:2,jobId:id,correlationId:id,scope:'metadata-only',retentionDays:7,events:[],timeline:[]};}const dispatchEvents=report.events.filter((row:Record<string,unknown>)=>row.event==='request.wire_dispatched'&&((row.details as Record<string,unknown>|undefined)?.dispatchStarted===true)),responseAttempts=new Set(report.events.filter((row:Record<string,unknown>)=>row.event==='response.headers').map((row:Record<string,unknown>)=>row.attempt)),postDispatches=dispatchEvents.length,postResponses=report.events.filter((row:Record<string,unknown>)=>row.event==='response.headers').length,postUnknownOutcomes=dispatchEvents.filter((row:Record<string,unknown>)=>!responseAttempts.has(row.attempt)).length,captureIds=report.events.filter((row:Record<string,unknown>)=>row.event==='prompt.capture.completed').map((row:Record<string,unknown>)=>(row.details as Record<string,unknown>|undefined)?.captureId).filter((value):value is string=>typeof value==='string'),snapshotIds=report.events.filter((row:Record<string,unknown>)=>row.event==='browser.snapshot.saved').map((row:Record<string,unknown>)=>(row.details as Record<string,unknown>|undefined)?.snapshotCaptureId).filter((value):value is string=>typeof value==='string');return{reportTitle:'YAPLIX Generation Diagnostic Report',...report,idea:reportIdea(job.spec.prompt),traceAvailable:report.events.length>0,diagnosticsUnavailable:unavailable,state:job.stage,stopReason:job.errorCode??null,provider:job.provider,requestedModel:job.requestedModel,actualModel:job.actualModel,attempts:job.attempts,llmPostDispatches:postDispatches,llmPostHttpResponses:postResponses,llmPostUnknownOutcomes:postUnknownOutcomes,repairCount:job.repairCount??0,configuration:{mode:job.mode,providerMode:job.providerMode,automaticLimit:job.automaticLimit,repairBudget:job.repairBudget??0,timeBudgetMs:this.jobDuration(job)},artifacts:{versionId:job.versionId,gameId:job.gameId,checkpointBytes:Buffer.byteLength(job.checkpoint),checkpointSha256:job.checkpoint?createHash('sha256').update(job.checkpoint).digest('hex'):null,privatePromptCaptures:captureIds.map(captureId=>'diagnostics/generation-private/'+id+'-'+captureId+'.json'),privateBrowserSnapshots:snapshotIds.map(captureId=>'diagnostics/generation-private/'+id+'-'+captureId+'.png')},snapshot};}
  traceVersion(owner:string,versionId:string,event:'version.export.started'|'version.export.completed'|'version.export.failed'|'ui.game_opened'|'ui.viewport_changed'|'ui.panel_changed'|'ui.editor_state'|'ui.host_error'|'ui.api_error'|'ui.state_error'|'ui.game_runtime_error'|'ui.game_activity'|'ui.export_opened',data:import('./generation-trace.ts').TraceData={}){const row=this.store.db.prepare('SELECT job_id FROM generation_jobs WHERE owner_id=? AND version_id=?').get(owner,uuid(versionId));if(row){try{this.trace(this.get(owner,String(row.job_id)),event,data);}catch{/* Optional UI/export diagnostics do not affect delivery. */}}}
  preview(owner:string,id:string){const job=this.get(owner,id);if(job.stage!=='needs_attention'||job.validation?.level!=='NOT_VERIFIED'||!['BROWSER_CHECK_INCONCLUSIVE','BROWSER_CANVAS_ACTIVITY_UNVERIFIED'].includes(job.validation.code))throw new Fault('PREVIEW_UNAVAILABLE',409);const html=prepareDocument(job.checkpoint).html;if(validateDocument(html).length)throw new Fault('PREVIEW_UNAVAILABLE',409);return html;}
  private store:Store; private generator?:Generator; private active?:{id:string;controller:AbortController;done:Promise<void>};private stopping=false;
  private presence=new Map<string,number>();
  private notify?: (owner:string,gameId:string,versionId:string)=>Promise<'sent'|'unavailable'|'unknown'>;
  private notificationTimer?:ReturnType<typeof setInterval>;
  private limits:Pick<RateLimit,'take'>;
  private instance=randomUUID();private started=false;private heartbeat?:ReturnType<typeof setInterval>;
  private wake?:ReturnType<typeof setTimeout>; private maxCalls:number;private duration:number;private retryMs:number;private automaticRetries:boolean;
  private repairLimit(){return (this.generator as (Generator&{repairLimit?:number})|undefined)?.repairLimit??1;}
  constructor(store:Store,generator?:Generator,notify?:GenerationJobs['notify'],autoStart=true,policy:{maxCalls?:number;durationMs?:number;retryMs?:number;automaticRetries?:boolean}={},limits:Pick<RateLimit,'take'>=new RateLimit()) {
    this.store=store;this.generator=generator;this.notify=notify;
    this.limits=limits;
    this.maxCalls=policy.maxCalls??4;this.duration=policy.durationMs??generator?.timeouts?.jobMs??LIVE_JOB_TIMEOUT_MS;this.retryMs=policy.retryMs??2000;this.automaticRetries=policy.automaticRetries??true;
    if(!Number.isSafeInteger(this.maxCalls)||this.maxCalls<1||this.maxCalls>12||!Number.isSafeInteger(this.duration)||this.duration<1000||this.duration>LIVE_JOB_TIMEOUT_MS||!Number.isSafeInteger(this.retryMs)||this.retryMs<10||this.retryMs>60000)throw new Fault('INVALID_JOB_POLICY');
    if(autoStart)this.start();
  }
  start(){
    if(this.started)return;
    this.store.transaction(()=>{
      const row=this.store.db.prepare('SELECT expires_at,pid FROM generation_worker WHERE slot=1').get();
      if(row&&Number(row.expires_at)>Date.now()&&processAlive(Number(row.pid)))throw new Fault('JOB_WORKER_BUSY',409);
      this.store.db.prepare('INSERT INTO generation_worker VALUES(1,?,?,?) ON CONFLICT(slot) DO UPDATE SET instance=excluded.instance,expires_at=excluded.expires_at,pid=excluded.pid').run(this.instance,Date.now()+60000,process.pid);
    });this.started=true;
    this.heartbeat=setInterval(()=>{try{const result=this.store.db.prepare('UPDATE generation_worker SET expires_at=? WHERE slot=1 AND instance=? AND expires_at>?').run(Date.now()+60000,this.instance,Date.now());if(result.changes!==1){this.stopping=true;this.active?.controller.abort();clearInterval(this.heartbeat);}}catch{this.stopping=true;this.active?.controller.abort();clearInterval(this.heartbeat);}},5000);this.heartbeat.unref();
    // Adopt pre-TASK-010 recoverable drafts once under an explicit bounded
    // policy. Cancelled jobs and configuration/quota refusals remain untouched.
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='needs_attention' AND json_extract(metadata,'$.automaticLimit') IS NULL").all()){
      const job=this.get(String(row.owner_id),String(row.job_id));if(job.providerMode==='chatgpt'||job.provider==='openrouter'||!['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_OUTPUT_TRUNCATED','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR','LLM_RATE_LIMIT','JOB_RESTART_UNCERTAIN'].includes(job.errorCode??'')||job.attempts>=12)continue;
      job.automaticRuns=0;job.automaticLimit=Math.min(4,job.attempts+this.maxCalls);job.repairBudget??=Math.min(3,this.repairLimit());job.deadlineAt??=Date.now()+this.jobDuration(job);
      if(job.provider&&!['openrouter','ollama','ollama.com'].includes(job.provider))job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
      job.stage='queued';job.recoveryState='retry_scheduled';job.retryAt=Math.max(job.retryAt??0,Date.now()+this.retryMs);this.write(job);
    }
    // A confirmed complete-HTML Canvas layout failure is safe to resume inside
    // the job's already-authorized budget. Validation runs locally first; the
    // model is called only if the same protected checker reconfirms the defect.
    if(this.automaticRetries)for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='needs_attention' AND json_extract(metadata,'$.automaticLimit') IS NOT NULL").all()){
      const job=this.get(String(row.owner_id),String(row.job_id));if(!recoverableConfirmedCanvasRepair(job)||(job.repairCount??0)>=(job.repairBudget??0)||job.attempts>=(job.automaticLimit??0)||(job.automaticRuns??0)>=4||Date.now()>=(job.deadlineAt??0))continue;
      job.stage='queued';job.errorCode=null;job.manualContinuation=false;job.recoveryState='retry_scheduled';job.retryAt=Date.now()+this.retryMs;this.write(job);this.trace(job,'job.retry_scheduled',{status:'PASS',errorCode:'JOB_RESTART_UNCERTAIN',next:'queued',details:{recovery:'confirmed_canvas_layout',repairBudgetRemaining:Math.max(0,(job.repairBudget??0)-(job.repairCount??0))}});
    }
    // An in-flight POST has an unknown outcome after process death. Never
    // replay it. A complete checkpoint may be revalidated locally; otherwise
    // leave the job for explicit user attention.
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status IN ('generating','validating','repairing')").all()){
      const job=this.get(String(row.owner_id),String(row.job_id));job.errorCode='JOB_RESTART_UNCERTAIN';
      if(job.provider)job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
      const completeCheckpoint=/<\/html>\s*$/i.test(job.checkpoint);
      job.deadlineAt??=Date.now()+this.jobDuration(job);job.automaticLimit=Math.min(4,job.automaticLimit??this.maxCalls);job.repairBudget??=Math.min(3,Math.max(0,job.automaticLimit-1));
      job.stage=completeCheckpoint&&this.canRetry(job)?'queued':'needs_attention';job.retryAt=Date.now()+this.retryMs;job.recoveryState=job.stage==='queued'?'retry_scheduled':'failed_permanent';this.write(job);
    }
    // Old automatic router retries must not dispatch after an upgrade. A manual
    // Continue resets automaticRuns to zero; complete drafts can revalidate locally.
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND attempts>0 AND json_extract(metadata,'$.provider')='openrouter' AND COALESCE(json_extract(metadata,'$.automaticRuns'),1)>0").all()){const job=this.get(String(row.owner_id),String(row.job_id));if(!/<\/html>\s*$/i.test(job.checkpoint)){job.stage='needs_attention';job.recoveryState='failed_permanent';job.errorCode??='JOB_RESTART_UNCERTAIN';this.write(job);this.trace(job,'job.failed',{errorCode:job.errorCode,next:'needs_attention'});}}
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND json_extract(metadata,'$.providerMode')='chatgpt' AND attempts>0").all()){const job=this.get(String(row.owner_id),String(row.job_id));if(!chatgptCheckpoint(job)){job.stage='needs_attention';job.errorCode='CHATGPT_BUDGET_SPENT';job.recoveryState='failed_permanent';this.write(job);}}
    if(this.notify){this.notificationTimer=setInterval(()=>void this.notifications().catch(()=>{}),5000);this.notificationTimer.unref();}
    this.kick();
  }
  get(owner:string,id:string):DurableJob {
    const row=this.store.db.prepare('SELECT * FROM generation_jobs WHERE job_id=? AND owner_id=?').get(uuid(id),owner);
    if(!row)throw new Fault('JOB_NOT_FOUND',404);
    const request=JSON.parse(String(row.request)),metadata=JSON.parse(String(row.metadata));
    const version=row.version_id?this.store.getVersion(String(row.version_id)):null;
    const repairCount=metadata.repairCount??(metadata.repairUsed?1:0),repairInFlight=metadata.repairInFlight??Boolean(metadata.repairUsed);
    if(!Number.isSafeInteger(repairCount)||repairCount<0||repairCount>3)throw new Fault('JOB_REPAIR_STATE_INVALID',500);
    const mode=providerMode(metadata.providerMode??request.providerMode),provider=metadata.provider??null,limit=Math.min(this.maxCalls,postLimit({...request,...metadata,provider,providerMode:mode}));
    const automaticLimit=Math.min(Number.isSafeInteger(metadata.automaticLimit)?metadata.automaticLimit:limit,limit),repairLimit=provider==='openrouter'||provider==='chatgpt'||mode==='openrouter'||mode==='chatgpt'?0:Math.max(0,automaticLimit-1);
    const repairBudget=Math.min(Number.isSafeInteger(metadata.repairBudget)?metadata.repairBudget:Math.min(this.repairLimit(),repairLimit),repairLimit);
    return{...request,...metadata,automaticLimit,repairBudget,repairCount,repairInFlight,providerMode:mode,jobId:String(row.job_id),ownerId:owner,idempotencyKey:String(row.idempotency_key),stage:row.status,attempts:Number(row.attempts),checkpoint:String(row.checkpoint),createdAt:String(row.created_at),updatedAt:String(row.updated_at),versionId:version?.versionId??null,gameId:version?.gameId??null,notificationClaimed:row.notified===1};
  }
  summary(job:DurableJob):DurableSummary {
    const {checkpoint,originalCheckpoint:_original,ownerId:_owner,idempotencyKey:_key,...rest}=job;return{...rest,checkpointBytes:Buffer.byteLength(checkpoint),canContinue:this.continuationError(job)===null};
  }
  list(owner:string){
    this.presence.set(owner,Date.now());if(this.presence.size>1000){for(const[key,time]of this.presence)if(Date.now()-time>60000)this.presence.delete(key);}
    return this.store.db.prepare('SELECT job_id FROM generation_jobs WHERE owner_id=? ORDER BY rowid DESC LIMIT 50').all(owner).map(row=>this.summary(this.get(owner,String(row.job_id))));
  }
  create(owner:string,key:unknown,request:Request) {
    this.assertWorker();
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new Fault('IDEMPOTENCY_KEY_REQUIRED');
    if(request.providerMode==='chatgpt'&&(owner!=='owner'||request.mode!=='live'||request.telegramConsent))throw new Fault('CHATGPT_LOCAL_ONLY',403);
    request={...request,spec:parseSpec(request.spec,request.previousVersionId?MAX_EDIT_PROMPT_CHARS:500),providerMode:providerMode(request.providerMode)};if(request.mode!=='live'||typeof request.telegramConsent!=='boolean')throw new Fault('INVALID_JOB_REQUEST');
    if(request.previousVersionId)this.store.getVersion(uuid(request.previousVersionId));
    const encoded=JSON.stringify(request);
    const found=this.store.db.prepare('SELECT job_id,request FROM generation_jobs WHERE owner_id=? AND idempotency_key=?').get(owner,key);
    if(found){const canonical=(r:Request)=>JSON.stringify([parseSpec(r.spec,r.previousVersionId?MAX_EDIT_PROMPT_CHARS:500),r.mode,r.previousVersionId??null,r.telegramConsent,providerMode(r.providerMode)]);if(canonical(JSON.parse(String(found.request)))!==canonical(request))throw new Fault('IDEMPOTENCY_CONFLICT',409);return this.summary(this.get(owner,String(found.job_id)));}
    if(request.mode==='live')this.routes(request,true);
    if(request.mode==='live'&&this.generator){this.limits.take('jobs-global',12);this.limits.take('jobs-'+owner,6);}
    const selected=request.mode==='live'?this.routes(request)?.[0]:undefined;
    const limit=selected?Math.min(this.maxCalls,postLimit({...request,provider:selected.provider})):1;
    const repairBudget=selected&&selected.provider!=='openrouter'&&selected.provider!=='chatgpt'?Math.min(this.repairLimit(),Math.max(0,limit-1)):0;
    const automaticLimit=limit;
    const job:DurableJob={...request,jobId:randomUUID(),ownerId:owner,idempotencyKey:key,provider:selected?.provider??null,requestedModel:selected?.model??null,actualModel:null,createdAt:now(),updatedAt:now(),stage:'queued',attempts:0,checkpoint:'',checkpointAt:null,history:[],errorCode:null,retryAt:null,versionId:null,gameId:null,notificationClaimed:false,telegramState:request.telegramConsent?'pending':'none',outputTokens:null,reasoningTokens:null,elapsedMs:0,automaticRuns:0,automaticLimit,repairBudget,deadlineAt:Date.now()+this.jobDuration(request),blockedRoutes:[],repairCount:0,repairInFlight:false};
    this.store.transaction(()=>{
      this.assertWorker();
      const counts=this.store.db.prepare("SELECT COUNT(*) total,SUM(status IN ('queued','generating','validating','repairing')) pending,COALESCE(SUM(length(CAST(checkpoint AS BLOB))+COALESCE(length(CAST(json_extract(metadata,'$.originalCheckpoint') AS BLOB)),0)),0) bytes FROM generation_jobs").get()!;
      const ownerCount=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE owner_id=? AND status IN ('queued','generating','validating','repairing')").get(owner)?.n);
      if(Number(counts.total)>=1000||Number(counts.bytes)>=100000000)throw new Fault('JOB_STORAGE_QUOTA',507);
      if(Number(counts.pending)>=20||ownerCount>=3)throw new Fault('JOB_QUEUE_FULL',429);
      this.store.db.prepare('INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,0)').run(job.jobId,owner,key,encoded,job.stage,0,'',JSON.stringify(this.metadata(job)),job.createdAt,job.updatedAt,null);
    });
    try{new OperationTrace({dataRoot:process.env.YAPLIX_DATA_HOME??'.local',operationId:operationId()}).linkJob(job.jobId);}catch{/* Operation diagnostics never affect durable job creation. */}
    this.trace(job,'job.created',{status:'PASS',next:'queued',details:{requestBudget:job.automaticLimit,repairBudget:job.repairBudget??0,mode:job.mode,providerMode:job.providerMode??'auto',timeBudgetMs:this.jobDuration(job)}});this.kick();return this.summary(job);
  }
  private routes(job:Pick<GenerationJob,'providerMode'>,strict=false){
    const engine=this.generator as (Generator&{routes?:CodeTransport[];routesFor?:(mode?:GenerationJob['providerMode'])=>CodeTransport[]})|undefined;
    try{return engine?.routesFor?engine.routesFor(job.providerMode??'auto'):engine?.routes;}catch(error){if(strict)throw error;return [];}
  }
  private metadata(job:DurableJob){const{jobId:_id,ownerId:_owner,idempotencyKey:_key,spec:_spec,mode:_mode,previousVersionId:_previous,telegramConsent:_consent,stage:_stage,attempts:_attempts,checkpoint:_checkpoint,createdAt:_created,updatedAt:_updated,versionId:_version,gameId:_game,notificationClaimed:_claim,...metadata}=job;return metadata;}
  private write(job:DurableJob) {
    this.assertWorker();
    job.updatedAt=now();job.checkpoint=boundedCode(job.checkpoint);
    const total=Number(this.store.db.prepare("SELECT COALESCE(SUM(length(CAST(checkpoint AS BLOB))+COALESCE(length(CAST(json_extract(metadata,'$.originalCheckpoint') AS BLOB)),0)),0) bytes FROM generation_jobs WHERE job_id<>?").get(job.jobId)?.bytes);
    if(total+Buffer.byteLength(job.checkpoint)+Buffer.byteLength(job.originalCheckpoint??'')>100000000)throw new Fault('JOB_STORAGE_QUOTA',507);
    const result=this.store.db.prepare('UPDATE generation_jobs SET status=?,attempts=?,checkpoint=?,metadata=?,updated_at=? WHERE job_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?)').run(job.stage,job.attempts,job.checkpoint,JSON.stringify(this.metadata(job)),job.updatedAt,job.jobId,job.ownerId,this.instance,Date.now());
    if(result.changes!==1)throw new Fault('JOB_WORKER_BUSY',409);
  }
  private assertWorker(){if(!this.started||!this.store.db.prepare('SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?').get(this.instance,Date.now()))throw new Fault('JOB_WORKER_BUSY',409);}
  cancel(owner:string,id:string){const job=this.get(owner,id);if(job.stage==='completed')throw new Fault('JOB_STATE',409);job.stage='cancelled';job.errorCode='REQUEST_CANCELLED';this.write(job);this.trace(job,'job.cancelled',{errorCode:'REQUEST_CANCELLED',next:'cancelled'});if(this.active?.id===id)this.active.controller.abort();return this.summary(job);}
  private continuationError(job:GenerationJob){
    if(job.providerMode==='chatgpt'&&!chatgptCheckpoint(job))return 'CHATGPT_NEW_JOB_REQUIRED';
    if(!['needs_attention','failed','cancelled'].includes(job.stage))return 'JOB_STATE';
    if(job.mode!=='live')return 'LEGACY_DEMO_DISABLED';
    if(job.deadlineAt!==undefined&&Date.now()>=job.deadlineAt)return 'JOB_DURATION_LIMIT';
    if(job.attempts>=(job.automaticLimit??this.maxCalls)&&!/<\/html>\s*$/i.test(job.checkpoint))return 'JOB_ATTEMPT_LIMIT';
    if(job.retryAt&&Date.now()<job.retryAt)return 'JOB_RETRY_AFTER';
    const pending=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status IN ('queued','generating','validating','repairing')").get()?.n);
    const owned=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE owner_id=? AND status IN ('queued','generating','validating','repairing')").get(job.ownerId)?.n);
    return pending>=20||owned>=3?'JOB_QUEUE_FULL':null;
  }
  continue(owner:string,id:string){const job=this.get(owner,id),error=this.continuationError(job);if(error)throw new Fault(error,['JOB_RETRY_AFTER','JOB_QUEUE_FULL'].includes(error)?429:409);job.stage='queued';job.manualContinuation=true;job.errorCode=null;job.recoveryState=undefined;job.blockedRoutes=[...(job.retiredRoutes??[])];job.automaticRuns=0;const limit=Math.min(this.maxCalls,postLimit(job));job.automaticLimit=Math.min(limit,Math.max(job.attempts,job.automaticLimit??limit));job.repairBudget=Math.min(job.repairBudget??this.repairLimit(),Math.max(0,job.automaticLimit-1),job.provider==='openrouter'||job.provider==='chatgpt'||job.providerMode==='openrouter'||job.providerMode==='chatgpt'?0:3);job.deadlineAt??=Date.now()+this.jobDuration(job);this.write(job);this.kick();return this.summary(job);}
  claim(owner:string,id:string){this.get(owner,id);return this.store.db.prepare("UPDATE generation_jobs SET notified=1 WHERE job_id=? AND owner_id=? AND status='completed' AND notified=0").run(id,owner).changes===1;}
  private jobDuration(job:{providerMode?:string;mode?:string}){
    return ['chatgpt','openrouter'].includes(job.providerMode??'')?Math.min(this.duration,SINGLE_POST_JOB_TIMEOUT_MS):this.duration;
  }
  private canRetry(job:DurableJob){if(!this.automaticRetries&&!job.manualContinuation&&((job.automaticRuns??0)>0||job.attempts>0))return false;const validationOnly=Boolean(job.repairInFlight)||Boolean((job.repairCount??0)>0&&(job.repairCount??0)>=(job.repairBudget??this.repairLimit()));return(job.attempts<(job.automaticLimit??this.maxCalls)||Boolean(job.checkpointOrigin&&/<\/html>\s*$/i.test(job.checkpoint))||validationOnly)&&(job.automaticRuns??0)<4&&Date.now()<(job.deadlineAt??0);}
  private kick(){
    if(this.stopping||!this.started||this.active)return;this.assertWorker();clearTimeout(this.wake);
    for(const expired of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND json_extract(metadata,'$.deadlineAt')<=?").all(Date.now())){const job=this.get(String(expired.owner_id),String(expired.job_id));job.stage='needs_attention';job.recoveryState='failed_permanent';job.errorCode='JOB_DURATION_LIMIT';this.write(job);this.trace(job,'job.failed',{errorCode:job.errorCode,next:'needs_attention'});}
    const row=this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND COALESCE(json_extract(metadata,'$.retryAt'),0)<=? ORDER BY rowid LIMIT 1").get(Date.now());
    if(!row){const next=this.store.db.prepare("SELECT MIN(MIN(COALESCE(json_extract(metadata,'$.retryAt'),0),COALESCE(json_extract(metadata,'$.deadlineAt'),9223372036854775807))) next FROM generation_jobs WHERE status='queued'").get()?.next;if(next){this.wake=setTimeout(()=>this.kick(),Math.max(10,Math.min(60000,Number(next)-Date.now())));this.wake.unref();}return;}
    const controller=new AbortController(),id=String(row.job_id);const done=Promise.resolve().then(()=>this.run(String(row.owner_id),id,controller.signal)).catch(()=>{/* Lease loss preserves the last committed checkpoint for the next owner. */}).finally(()=>{this.active=undefined;if(!this.stopping)this.kick();});this.active={id,controller,done};
  }
  private async run(owner:string,id:string,signal:AbortSignal){
    let job=this.get(owner,id);if(job.stage!=='queued')return;
    if(job.mode!=='live'){job.stage='needs_attention';job.errorCode='LEGACY_DEMO_DISABLED';job.recoveryState='failed_permanent';this.write(job);this.trace(job,'job.failed',{errorCode:job.errorCode,next:'needs_attention'});return;}
    if(!this.canRetry(job)){job.stage='needs_attention';job.recoveryState='failed_permanent';job.errorCode=Date.now()>=(job.deadlineAt??0)?'JOB_DURATION_LIMIT':'JOB_ATTEMPT_LIMIT';this.write(job);this.trace(job,'job.failed',{errorCode:job.errorCode,next:'needs_attention'});return;}
    const manualContinuation=job.manualContinuation===true;job.manualContinuation=false;job.automaticRuns=(job.automaticRuns??0)+1;job.stage='generating';job.recoveryState=undefined;job.retryAt=null;this.write(job);const began=Date.now();
    const initialElapsed=job.elapsedMs;
    const update=(action:(job:DurableJob)=>void)=>{job=this.get(owner,id);action(job);job.elapsedMs=initialElapsed+Date.now()-began;this.write(job);};
    const cooldowns:Record<string,{until:number;code:string}>={};for(const row of this.store.db.prepare("SELECT metadata FROM generation_jobs WHERE json_extract(metadata,'$.routeCooldowns') IS NOT NULL").all()){const saved=JSON.parse(String(row.metadata)).routeCooldowns;for(const [key,value]of Object.entries(saved) as [string,{until:number;code:string}][])if(value.until>Date.now()&&value.until>(cooldowns[key]?.until??0))cooldowns[key]=value;}
    const context:DurableGenerationContext={
      durableJob:true,manualContinuation,providerMode:job.providerMode,repairCount:job.repairCount??0,repairBudget:job.repairBudget??Math.min(3,this.repairLimit()),repairInFlight:job.repairInFlight??false,repairUsed:job.repairUsed,
      trace:(event,data)=>this.trace(this.get(owner,id),event,data),captureMessages:messages=>{if(process.env.YAPLIX_CAPTURE_GENERATION_MESSAGES!=='1')return;try{this.traces??=new GenerationTraces();const captureId=this.traces.captureMessages(id,messages);if(captureId)this.trace(this.get(owner,id),'prompt.capture.completed',{status:'PASS',details:{captureId}});}catch{try{const current=this.get(owner,id);current.diagnosticsUnavailable=true;this.write(current);if(!this.traceWarning){this.traceWarning=true;console.warn('GENERATION_DIAGNOSTICS_UNAVAILABLE');}}catch{/* Optional capture is never part of job completion. */}}},saveBrowserSnapshot:(viewport,image)=>{try{this.traces??=new GenerationTraces();const snapshot=this.traces.saveBrowserSnapshot(id,viewport,image);this.trace(this.get(owner,id),'browser.snapshot.saved',{status:'PASS',details:{viewport,snapshotCaptureId:snapshot.captureId,snapshotSha256:snapshot.sha256}});return snapshot;}catch{return;}},cooldowns,
      cooldownRoute:(route,until,code)=>update(j=>{j.routeCooldowns={...(j.routeCooldowns??{}),[route.provider+'/'+route.model]:{until,code}};}),
      checkpoint:job.checkpoint,blockedRoutes:job.blockedRoutes??[],...(job.checkpointOrigin?{checkpointOrigin:job.checkpointOrigin}:{}),
      blockRoute:route=>{const key=route.provider+'/'+route.model;if(!context.blockedRoutes!.includes(key))context.blockedRoutes!.push(key);update(j=>{j.blockedRoutes=[...context.blockedRoutes!];});},
      maxCalls:Math.min(6,(job.automaticLimit??this.maxCalls)-job.attempts),
      stage:stage=>update(j=>{if(!terminal.has(j.stage))j.stage=stage;}),
      dispatch:route=>{
        if(route.provider==='chatgpt'&&job.providerMode!=='chatgpt')throw new Fault('CHATGPT_BUDGET_SPENT',409);
        if(Date.now()>=(job.deadlineAt??0))throw new Fault('JOB_DURATION_LIMIT',409);
        if(job.attempts>=(job.automaticLimit??this.maxCalls))throw new Fault('JOB_ATTEMPT_LIMIT',409);
        try{this.limits.take('provider-global',12);this.limits.take('provider-'+owner,6);}catch(error){update(j=>{j.retryAt=Date.now()+60000;});throw error;}
        update(j=>{if(j.provider&&j.requestedModel&&j.provider!==route.provider){const previous=j.provider+'/'+j.requestedModel;if(!context.blockedRoutes!.includes(previous))context.blockedRoutes!.push(previous);j.blockedRoutes=[...context.blockedRoutes!];j.retiredRoutes=[...new Set([...(j.retiredRoutes??[]),previous])];}j.attempts++;j.provider=route.provider;j.requestedModel=route.model;j.actualModel=null;});
      },
      partial:(code,model,tokens)=>update(j=>{if(code){j.checkpoint=code;j.checkpointAt=now();j.checkpointOrigin=model&&j.provider&&j.requestedModel?{provider:j.provider,requestedModel:j.requestedModel,model}:undefined;}if(model)j.actualModel=model;if(tokens?.outputTokens!==undefined)j.outputTokens=tokens.outputTokens;if(tokens?.reasoningTokens!==undefined)j.reasoningTokens=tokens.reasoningTokens;}),
      attempt:attempt=>update(j=>{j.history.push(attempt);j.history=j.history.slice(-12);}),
      retryAt:at=>update(j=>{j.retryAt=Math.max(j.retryAt??0,at);})
    };
    this.trace(job,'job.resumed',{next:job.checkpoint?'validating':'generating'});
    const deadlineController=new AbortController(),deadlineTimer=setTimeout(()=>deadlineController.abort(),Math.max(1,(job.deadlineAt??Date.now()+this.jobDuration(job))-Date.now()));
    try{
      context.validationFailure=job.validation?.level!=='VERIFIED'?job.validation?.code:undefined;
      context.claimRepair=()=>{update(j=>{if(j.repairInFlight||(j.repairCount??0)>=(j.repairBudget??context.repairBudget??0))throw new Fault('LLM_REPAIR_LIMIT',409);j.repairCount=(j.repairCount??0)+1;j.repairInFlight=true;j.repairUsed=true;});context.repairCount=job.repairCount??1;context.repairInFlight=true;context.repairUsed=true;};
      context.repairResponse=(code,model,tokens)=>update(j=>{if(!j.repairInFlight)throw new Fault('JOB_REPAIR_STATE_INVALID',500);if(code){j.checkpoint=boundedCode(code);j.checkpointAt=now();j.checkpointOrigin=model&&j.provider&&j.requestedModel?{provider:j.provider,requestedModel:j.requestedModel,model}:undefined;}if(model)j.actualModel=model;if(tokens?.outputTokens!==undefined)j.outputTokens=tokens.outputTokens;if(tokens?.reasoningTokens!==undefined)j.reasoningTokens=tokens.reasoningTokens;j.repairInFlight=false;});
      context.preserveOriginal=html=>update(j=>{j.originalCheckpoint??=boundedCode(html);});
      context.validation=(diagnostic,repair)=>update(j=>{j.validation=diagnostic;if(repair)j.deterministicRepair=repair;});
      const previous=job.previousVersionId?this.store.getVersion(job.previousVersionId):undefined;
      if(!this.generator)throw new Fault('LLM_NOT_CONFIGURED',503);
      const artifact=await this.generator.generate(job.spec,previous,'llm_code',AbortSignal.any([signal,deadlineController.signal]),context);
      job=this.get(owner,id);if(signal.aborted||job.stage==='cancelled')return;
      if(Date.now()>=(job.deadlineAt??0))throw new Fault('JOB_DURATION_LIMIT',409);
      job.elapsedMs=initialElapsed+Date.now()-began;job.stage='validating';job.retryAt=null;job.errorCode=null;job.recoveryState=undefined;job.provider=artifact.provider;job.actualModel=artifact.model;job.requestedModel=artifact.generation?.attempts.at(-1)?.requestedModel??job.requestedModel;this.write(job);
      const saving=performance.now();this.store.saveAndCompleteJob(id,owner,job.spec,artifact,job.previousVersionId,this.instance);job=this.get(owner,id);
      this.trace(job,'version.saved',{status:'PASS',durationMs:Math.round(performance.now()-saving),outputBytes:Buffer.byteLength(artifact.html),next:'completed',details:{saveGameId:job.gameId??'',saveVersionId:job.versionId??''}});this.trace(job,'job.completed',{status:'PASS',durationMs:Date.now()-Date.parse(job.createdAt),next:'completed'});
    }catch(error){job=this.get(owner,id);if(job.stage==='completed')return;job.stage=job.stage==='cancelled'?'cancelled':'needs_attention';job.errorCode=Date.now()>=(job.deadlineAt??Infinity)?'JOB_DURATION_LIMIT':this.stopping?'JOB_RESTART_UNCERTAIN':signal.aborted?'REQUEST_CANCELLED':error instanceof Fault?error.code:'JOB_PERSISTENCE_ERROR';job.elapsedMs=initialElapsed+Date.now()-began;
      if(job.providerMode!=='chatgpt'&&job.provider!=='openrouter'&&!this.stopping&&!signal.aborted&&['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR','LLM_OUTPUT_TRUNCATED','LLM_HTTP','LLM_RATE_LIMIT','RATE_LIMIT','LLM_NETWORK_OR_RESPONSE'].includes(job.errorCode)&&this.canRetry(job)){
        if(job.errorCode==='LLM_TIMEOUT'&&job.provider&&!['openrouter','ollama','ollama.com'].includes(job.provider))job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
        const routes=this.routes(job);
        if(!routes||routes.some(r=>!job.blockedRoutes?.includes(r.provider+'/'+r.model))){job.stage='queued';job.retryAt=Math.max(job.retryAt??0,Date.now()+Math.min(60000,this.retryMs*2**((job.automaticRuns??1)-1)));job.recoveryState=job.errorCode==='LLM_RATE_LIMIT'?'waiting_for_provider':'retry_scheduled';}
      }
      if(job.stage==='needs_attention')job.recoveryState='failed_permanent';this.write(job);this.trace(job,job.stage==='queued'?'job.retry_scheduled':job.stage==='cancelled'?'job.cancelled':'job.failed',{errorCode:job.errorCode,durationMs:job.elapsedMs,next:job.stage,details:{checkpointSha256:job.checkpoint?createHash('sha256').update(job.checkpoint).digest('hex'):''}});}
    finally{clearTimeout(deadlineTimer);deadlineController.abort();}
  }
  private async notifications(){if(this.stopping||!this.notify)return;for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='completed' ORDER BY rowid DESC LIMIT 50").all()){
    const owner=String(row.owner_id),job=this.get(owner,String(row.job_id));if(job.telegramState!=='pending'||!job.telegramConsent||Date.now()-(this.presence.get(owner)??0)<30000)continue;
    // Claim before network dispatch. A lost acknowledgement is never sent twice.
    this.assertWorker();const claim=this.store.db.prepare("UPDATE generation_jobs SET metadata=json_set(metadata,'$.telegramState','unknown') WHERE job_id=? AND owner_id=? AND status='completed' AND json_extract(metadata,'$.telegramState')='pending' AND EXISTS(SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?)").run(job.jobId,owner,this.instance,Date.now());if(claim.changes!==1)continue;
    job.telegramState='unknown';try{job.telegramState=await this.notify(owner,job.gameId!,job.versionId!);}catch{job.telegramState='unknown';}if(this.stopping)return;this.write(job);
  }}
  async close(){this.stopping=true;clearTimeout(this.wake);clearInterval(this.notificationTimer);this.active?.controller.abort();await this.active?.done;clearInterval(this.heartbeat);if(this.started)this.store.db.prepare('DELETE FROM generation_worker WHERE slot=1 AND instance=?').run(this.instance);this.started=false;}
}
