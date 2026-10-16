import { randomUUID } from 'node:crypto';
import { Fault, parseSpec, uuid } from './contracts.ts';
import { demoArtifact } from './demo.ts';
import { boundedCode, providerMode } from './transport.ts';
import type { Generator, GenerationContext, CodeTransport } from './transport.ts';
import type { Store } from './store.ts';
import type { GenerationJob, JobSummary } from './job-contracts.ts';
import { RateLimit } from './rate-limit.ts';

type Request = Pick<GenerationJob,'spec'|'mode'|'previousVersionId'|'telegramConsent'|'providerMode'>;
const terminal=new Set(['completed','cancelled','failed','needs_attention']);
const now=()=>new Date().toISOString();
function processAlive(pid:number){if(!Number.isSafeInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code!=='ESRCH';}}
export class GenerationJobs {
  private store:Store; private generator?:Generator; private active?:{id:string;controller:AbortController;done:Promise<void>};private stopping=false;
  private presence=new Map<string,number>();
  private notify?: (owner:string,gameId:string,versionId:string)=>Promise<'sent'|'unavailable'|'unknown'>;
  private notificationTimer?:ReturnType<typeof setInterval>;
  private limits=new RateLimit();
  private instance=randomUUID();private started=false;private heartbeat?:ReturnType<typeof setInterval>;
  private wake?:ReturnType<typeof setTimeout>; private maxCalls:number;private duration:number;private retryMs:number;
  constructor(store:Store,generator?:Generator,notify?:GenerationJobs['notify'],autoStart=true,policy:{maxCalls?:number;durationMs?:number;retryMs?:number}={}) {
    this.store=store;this.generator=generator;this.notify=notify;
    this.maxCalls=policy.maxCalls??4;this.duration=policy.durationMs??300000;this.retryMs=policy.retryMs??2000;
    if(!Number.isSafeInteger(this.maxCalls)||this.maxCalls<1||this.maxCalls>12||!Number.isSafeInteger(this.duration)||this.duration<1000||this.duration>1800000||!Number.isSafeInteger(this.retryMs)||this.retryMs<10||this.retryMs>60000)throw new Fault('INVALID_JOB_POLICY');
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
      const job=this.get(String(row.owner_id),String(row.job_id));if(!['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_OUTPUT_TRUNCATED','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR','LLM_RATE_LIMIT','JOB_RESTART_UNCERTAIN'].includes(job.errorCode??'')||job.attempts>=12)continue;
      job.automaticRuns=0;job.automaticLimit=Math.min(12,job.attempts+this.maxCalls);job.deadlineAt=Date.now()+this.duration;
      if(job.provider&&!['openrouter','ollama','ollama.com'].includes(job.provider))job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
      job.stage='queued';job.recoveryState='retry_scheduled';job.retryAt=Math.max(job.retryAt??0,Date.now()+this.retryMs);this.write(job);
    }
    // Recover within the original durable budget. Unknown billed dispatches
    // exclude that route; another configured route may recover the draft.
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status IN ('generating','validating','repairing')").all()){
      const job=this.get(String(row.owner_id),String(row.job_id));job.errorCode='JOB_RESTART_UNCERTAIN';
      if(job.provider&&!['openrouter','ollama','ollama.com'].includes(job.provider))job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
      job.deadlineAt??=Date.now()+this.duration;job.automaticLimit??=this.maxCalls;const routes=this.routes(job);const available=!routes||routes.some(r=>!job.blockedRoutes?.includes(r.provider+'/'+r.model))||/<\/html>\s*$/i.test(job.checkpoint);job.stage=this.canRetry(job)&&available?'queued':'needs_attention';job.retryAt=Date.now()+this.retryMs;job.recoveryState=job.stage==='queued'?'retry_scheduled':'failed_permanent';this.write(job);
    }
    if(this.notify){this.notificationTimer=setInterval(()=>void this.notifications().catch(()=>{}),5000);this.notificationTimer.unref();}
    this.kick();
  }
  get(owner:string,id:string):GenerationJob {
    const row=this.store.db.prepare('SELECT * FROM generation_jobs WHERE job_id=? AND owner_id=?').get(uuid(id),owner);
    if(!row)throw new Fault('JOB_NOT_FOUND',404);
    const request=JSON.parse(String(row.request)),metadata=JSON.parse(String(row.metadata));
    const version=row.version_id?this.store.getVersion(String(row.version_id)):null;
    return{...request,...metadata,providerMode:providerMode(metadata.providerMode??request.providerMode),jobId:String(row.job_id),ownerId:owner,idempotencyKey:String(row.idempotency_key),stage:row.status,attempts:Number(row.attempts),checkpoint:String(row.checkpoint),createdAt:String(row.created_at),updatedAt:String(row.updated_at),versionId:version?.versionId??null,gameId:version?.gameId??null,notificationClaimed:row.notified===1};
  }
  summary(job:GenerationJob):JobSummary {
    const {checkpoint,ownerId:_owner,idempotencyKey:_key,...rest}=job;return{...rest,checkpointBytes:Buffer.byteLength(checkpoint)};
  }
  list(owner:string){
    this.presence.set(owner,Date.now());if(this.presence.size>1000){for(const[key,time]of this.presence)if(Date.now()-time>60000)this.presence.delete(key);}
    return this.store.db.prepare('SELECT job_id FROM generation_jobs WHERE owner_id=? ORDER BY rowid DESC LIMIT 50').all(owner).map(row=>this.summary(this.get(owner,String(row.job_id))));
  }
  create(owner:string,key:unknown,request:Request) {
    this.assertWorker();
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new Fault('IDEMPOTENCY_KEY_REQUIRED');
    request={...request,spec:parseSpec(request.spec),providerMode:providerMode(request.providerMode)};if(!['demo','live'].includes(request.mode)||typeof request.telegramConsent!=='boolean')throw new Fault('INVALID_JOB_REQUEST');
    if(request.previousVersionId)this.store.getVersion(uuid(request.previousVersionId));
    const encoded=JSON.stringify(request);
    const found=this.store.db.prepare('SELECT job_id,request FROM generation_jobs WHERE owner_id=? AND idempotency_key=?').get(owner,key);
    if(found){const canonical=(r:Request)=>JSON.stringify([parseSpec(r.spec),r.mode,r.previousVersionId??null,r.telegramConsent,providerMode(r.providerMode)]);if(canonical(JSON.parse(String(found.request)))!==canonical(request))throw new Fault('IDEMPOTENCY_CONFLICT',409);return this.summary(this.get(owner,String(found.job_id)));}
    if(request.mode==='live')this.routes(request,true);
    if(request.mode==='live'&&this.generator){this.limits.take('jobs-global',12);this.limits.take('jobs-'+owner,6);}
    const selected=request.mode==='live'?this.routes(request)?.[0]:undefined;
    const job:GenerationJob={...request,jobId:randomUUID(),ownerId:owner,idempotencyKey:key,provider:selected?.provider??null,requestedModel:selected?.model??null,actualModel:null,createdAt:now(),updatedAt:now(),stage:'queued',attempts:0,checkpoint:'',checkpointAt:null,history:[],errorCode:null,retryAt:null,versionId:null,gameId:null,notificationClaimed:false,telegramState:request.telegramConsent?'pending':'none',outputTokens:null,reasoningTokens:null,elapsedMs:0,automaticRuns:0,automaticLimit:this.maxCalls,deadlineAt:Date.now()+this.duration,blockedRoutes:[]};
    this.store.transaction(()=>{
      this.assertWorker();
      const counts=this.store.db.prepare("SELECT COUNT(*) total,SUM(status IN ('queued','generating','validating','repairing')) pending,COALESCE(SUM(length(CAST(checkpoint AS BLOB))),0) bytes FROM generation_jobs").get()!;
      const ownerCount=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE owner_id=? AND status IN ('queued','generating','validating','repairing')").get(owner)?.n);
      if(Number(counts.total)>=1000||Number(counts.bytes)>=100000000)throw new Fault('JOB_STORAGE_QUOTA',507);
      if(Number(counts.pending)>=20||ownerCount>=3)throw new Fault('JOB_QUEUE_FULL',429);
      this.store.db.prepare('INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,0)').run(job.jobId,owner,key,encoded,job.stage,0,'',JSON.stringify(this.metadata(job)),job.createdAt,job.updatedAt,null);
    });
    this.kick();return this.summary(job);
  }
  private routes(job:Pick<GenerationJob,'providerMode'>,strict=false){
    const engine=this.generator as (Generator&{routes?:CodeTransport[];routesFor?:(mode?:GenerationJob['providerMode'])=>CodeTransport[]})|undefined;
    try{return engine?.routesFor?engine.routesFor(job.providerMode??'auto'):engine?.routes;}catch(error){if(strict)throw error;return [];}
  }
  private metadata(job:GenerationJob){const{jobId:_id,ownerId:_owner,idempotencyKey:_key,spec:_spec,mode:_mode,previousVersionId:_previous,telegramConsent:_consent,stage:_stage,attempts:_attempts,checkpoint:_checkpoint,createdAt:_created,updatedAt:_updated,versionId:_version,gameId:_game,notificationClaimed:_claim,...metadata}=job;return metadata;}
  private write(job:GenerationJob) {
    this.assertWorker();
    job.updatedAt=now();job.checkpoint=boundedCode(job.checkpoint);
    const total=Number(this.store.db.prepare('SELECT COALESCE(SUM(length(CAST(checkpoint AS BLOB))),0) bytes FROM generation_jobs WHERE job_id<>?').get(job.jobId)?.bytes);
    if(total+Buffer.byteLength(job.checkpoint)>100000000)throw new Fault('JOB_STORAGE_QUOTA',507);
    const result=this.store.db.prepare('UPDATE generation_jobs SET status=?,attempts=?,checkpoint=?,metadata=?,updated_at=? WHERE job_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?)').run(job.stage,job.attempts,job.checkpoint,JSON.stringify(this.metadata(job)),job.updatedAt,job.jobId,job.ownerId,this.instance,Date.now());
    if(result.changes!==1)throw new Fault('JOB_WORKER_BUSY',409);
  }
  private assertWorker(){if(!this.started||!this.store.db.prepare('SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?').get(this.instance,Date.now()))throw new Fault('JOB_WORKER_BUSY',409);}
  cancel(owner:string,id:string){const job=this.get(owner,id);if(job.stage==='completed')throw new Fault('JOB_STATE',409);job.stage='cancelled';job.errorCode='REQUEST_CANCELLED';this.write(job);if(this.active?.id===id)this.active.controller.abort();return this.summary(job);}
  continue(owner:string,id:string){const job=this.get(owner,id);if(!['needs_attention','failed','cancelled'].includes(job.stage))throw new Fault('JOB_STATE',409);if(job.attempts>=12)throw new Fault('JOB_ATTEMPT_LIMIT',409);if(job.retryAt&&Date.now()<job.retryAt)throw new Fault('JOB_RETRY_AFTER',429);const pending=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status IN ('queued','generating','validating','repairing')").get()?.n),owned=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE owner_id=? AND status IN ('queued','generating','validating','repairing')").get(owner)?.n);if(pending>=20||owned>=3)throw new Fault('JOB_QUEUE_FULL',429);job.stage='queued';job.errorCode=null;job.recoveryState=undefined;job.blockedRoutes=[...(job.retiredRoutes??[])];job.automaticRuns=0;job.automaticLimit=Math.min(12,job.attempts+this.maxCalls);job.deadlineAt=Date.now()+this.duration;this.write(job);this.kick();return this.summary(job);}
  claim(owner:string,id:string){this.get(owner,id);return this.store.db.prepare("UPDATE generation_jobs SET notified=1 WHERE job_id=? AND owner_id=? AND status='completed' AND notified=0").run(id,owner).changes===1;}
  private canRetry(job:GenerationJob){return(job.attempts<(job.automaticLimit??this.maxCalls)||Boolean(job.checkpointOrigin&&/<\/html>\s*$/i.test(job.checkpoint)))&&(job.automaticRuns??0)<4&&Date.now()<(job.deadlineAt??0);}
  private kick(){
    if(this.stopping||!this.started||this.active)return;this.assertWorker();clearTimeout(this.wake);
    for(const expired of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND json_extract(metadata,'$.deadlineAt')<=?").all(Date.now())){const job=this.get(String(expired.owner_id),String(expired.job_id));job.stage='needs_attention';job.recoveryState='failed_permanent';job.errorCode='JOB_DURATION_LIMIT';this.write(job);}
    const row=this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' AND COALESCE(json_extract(metadata,'$.retryAt'),0)<=? ORDER BY rowid LIMIT 1").get(Date.now());
    if(!row){const next=this.store.db.prepare("SELECT MIN(MIN(COALESCE(json_extract(metadata,'$.retryAt'),0),COALESCE(json_extract(metadata,'$.deadlineAt'),9223372036854775807))) next FROM generation_jobs WHERE status='queued'").get()?.next;if(next){this.wake=setTimeout(()=>this.kick(),Math.max(10,Math.min(60000,Number(next)-Date.now())));this.wake.unref();}return;}
    const controller=new AbortController(),id=String(row.job_id);const done=Promise.resolve().then(()=>this.run(String(row.owner_id),id,controller.signal)).catch(()=>{/* Lease loss preserves the last committed checkpoint for the next owner. */}).finally(()=>{this.active=undefined;if(!this.stopping)this.kick();});this.active={id,controller,done};
  }
  private async run(owner:string,id:string,signal:AbortSignal){
    let job=this.get(owner,id);if(job.stage!=='queued')return;
    if(!this.canRetry(job)){job.stage='needs_attention';job.recoveryState='failed_permanent';job.errorCode=Date.now()>=(job.deadlineAt??0)?'JOB_DURATION_LIMIT':'JOB_ATTEMPT_LIMIT';this.write(job);return;}
    job.automaticRuns=(job.automaticRuns??0)+1;job.stage='generating';job.recoveryState=undefined;job.retryAt=null;this.write(job);const began=Date.now();
    const initialElapsed=job.elapsedMs;
    const update=(action:(job:GenerationJob)=>void)=>{job=this.get(owner,id);action(job);job.elapsedMs=initialElapsed+Date.now()-began;this.write(job);};
    const cooldowns:Record<string,{until:number;code:string}>={};for(const row of this.store.db.prepare("SELECT metadata FROM generation_jobs WHERE json_extract(metadata,'$.routeCooldowns') IS NOT NULL").all()){const saved=JSON.parse(String(row.metadata)).routeCooldowns;for(const [key,value]of Object.entries(saved) as [string,{until:number;code:string}][])if(value.until>Date.now()&&value.until>(cooldowns[key]?.until??0))cooldowns[key]=value;}
    const context:GenerationContext={providerMode:job.providerMode,cooldowns,cooldownRoute:(route,until,code)=>update(j=>{j.routeCooldowns={...(j.routeCooldowns??{}),[route.provider+'/'+route.model]:{until,code}};}),checkpoint:job.checkpoint,blockedRoutes:job.blockedRoutes??[],...(job.checkpointOrigin?{checkpointOrigin:job.checkpointOrigin}:{}),blockRoute:(route)=>{const key=route.provider+'/'+route.model;if(!context.blockedRoutes!.includes(key))context.blockedRoutes!.push(key);update(j=>{j.blockedRoutes=[...context.blockedRoutes!];});},maxCalls:Math.min(6,(job.automaticLimit??this.maxCalls)-job.attempts),stage:stage=>update(j=>{if(!terminal.has(j.stage))j.stage=stage;}),dispatch:route=>{if(Date.now()>=(job.deadlineAt??0))throw new Fault('JOB_DURATION_LIMIT',409);if(job.attempts>=(job.automaticLimit??this.maxCalls))throw new Fault('JOB_ATTEMPT_LIMIT',409);try{this.limits.take('provider-global',12);this.limits.take('provider-'+owner,6);}catch(error){update(j=>{j.retryAt=Date.now()+60000;});throw error;}update(j=>{if(j.provider&&j.requestedModel&&j.provider!==route.provider){const previous=j.provider+'/'+j.requestedModel;if(!context.blockedRoutes!.includes(previous))context.blockedRoutes!.push(previous);j.blockedRoutes=[...context.blockedRoutes!];j.retiredRoutes=[...new Set([...(j.retiredRoutes??[]),previous])];}j.attempts++;j.provider=route.provider;j.requestedModel=route.model;j.actualModel=null;});},partial:(code,model,tokens)=>update(j=>{if(code){j.checkpoint=code;j.checkpointAt=now();j.checkpointOrigin=model&&j.provider&&j.requestedModel?{provider:j.provider,requestedModel:j.requestedModel,model}:undefined;}if(model)j.actualModel=model;if(tokens?.outputTokens!==undefined)j.outputTokens=tokens.outputTokens;if(tokens?.reasoningTokens!==undefined)j.reasoningTokens=tokens.reasoningTokens;}),attempt:attempt=>update(j=>{j.history.push(attempt);j.history=j.history.slice(-12);}),retryAt:at=>update(j=>{j.retryAt=Math.max(j.retryAt??0,at);})};
    try{
      const previous=job.previousVersionId?this.store.getVersion(job.previousVersionId):undefined;
      if(job.mode==='live'&&!this.generator)throw new Fault('LLM_NOT_CONFIGURED',503);
      const artifact=job.mode==='demo'?demoArtifact(job.spec):await this.generator!.generate(job.spec,previous,'llm_code',AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,(job.deadlineAt??Date.now()+this.duration)-Date.now()))]),context);
      job=this.get(owner,id);if(signal.aborted||job.stage==='cancelled')return;
      if(Date.now()>=(job.deadlineAt??0))throw new Fault('JOB_DURATION_LIMIT',409);
      job.elapsedMs=initialElapsed+Date.now()-began;job.stage='validating';job.retryAt=null;job.errorCode=null;job.recoveryState=undefined;job.provider=artifact.provider;job.actualModel=artifact.model;job.requestedModel=artifact.generation?.attempts.at(-1)?.requestedModel??job.requestedModel;this.write(job);
      this.store.saveAndCompleteJob(id,owner,job.spec,artifact,job.previousVersionId,this.instance);
    }catch(error){job=this.get(owner,id);if(job.stage==='completed')return;job.stage=job.stage==='cancelled'?'cancelled':'needs_attention';job.errorCode=Date.now()>=(job.deadlineAt??Infinity)?'JOB_DURATION_LIMIT':this.stopping?'JOB_RESTART_UNCERTAIN':signal.aborted?'REQUEST_CANCELLED':error instanceof Fault?error.code:'JOB_PERSISTENCE_ERROR';job.elapsedMs=initialElapsed+Date.now()-began;
      if(!this.stopping&&!signal.aborted&&['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR','LLM_OUTPUT_TRUNCATED','LLM_HTTP','LLM_RATE_LIMIT','RATE_LIMIT','LLM_NETWORK_OR_RESPONSE'].includes(job.errorCode)&&this.canRetry(job)){
        if(job.errorCode==='LLM_TIMEOUT'&&job.provider&&!['openrouter','ollama','ollama.com'].includes(job.provider))job.blockedRoutes=[...new Set([...(job.blockedRoutes??[]),job.provider+'/'+job.requestedModel])];
        const routes=this.routes(job);
        if(!routes||routes.some(r=>!job.blockedRoutes?.includes(r.provider+'/'+r.model))){job.stage='queued';job.retryAt=Math.max(job.retryAt??0,Date.now()+Math.min(60000,this.retryMs*2**((job.automaticRuns??1)-1)));job.recoveryState=job.errorCode==='LLM_RATE_LIMIT'?'waiting_for_provider':'retry_scheduled';}
      }
      if(job.stage==='needs_attention')job.recoveryState='failed_permanent';this.write(job);}
  }
  private async notifications(){if(this.stopping||!this.notify)return;for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='completed' ORDER BY rowid DESC LIMIT 50").all()){
    const owner=String(row.owner_id),job=this.get(owner,String(row.job_id));if(job.telegramState!=='pending'||!job.telegramConsent||Date.now()-(this.presence.get(owner)??0)<30000)continue;
    // Claim before network dispatch. A lost acknowledgement is never sent twice.
    this.assertWorker();const claim=this.store.db.prepare("UPDATE generation_jobs SET metadata=json_set(metadata,'$.telegramState','unknown') WHERE job_id=? AND owner_id=? AND status='completed' AND json_extract(metadata,'$.telegramState')='pending' AND EXISTS(SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?)").run(job.jobId,owner,this.instance,Date.now());if(claim.changes!==1)continue;
    job.telegramState='unknown';try{job.telegramState=await this.notify(owner,job.gameId!,job.versionId!);}catch{job.telegramState='unknown';}if(this.stopping)return;this.write(job);
  }}
  async close(){this.stopping=true;clearTimeout(this.wake);clearInterval(this.notificationTimer);this.active?.controller.abort();await this.active?.done;clearInterval(this.heartbeat);if(this.started)this.store.db.prepare('DELETE FROM generation_worker WHERE slot=1 AND instance=?').run(this.instance);this.started=false;}
}
