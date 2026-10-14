import { randomUUID } from 'node:crypto';
import { Fault, parseSpec, uuid } from './contracts.ts';
import { demoArtifact } from './demo.ts';
import { boundedCode } from './transport.ts';
import type { Generator, GenerationContext, CodeTransport } from './transport.ts';
import type { Store } from './store.ts';
import type { GenerationJob, JobSummary } from './job-contracts.ts';
import { RateLimit } from './rate-limit.ts';

type Request = Pick<GenerationJob,'spec'|'mode'|'previousVersionId'|'telegramConsent'>;
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
  constructor(store:Store,generator?:Generator,notify?:GenerationJobs['notify'],autoStart=true) {
    this.store=store;this.generator=generator;this.notify=notify;
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
    // A dispatched request may have been consumed remotely. Never repeat it on boot.
    for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status IN ('generating','validating','repairing')").all()){
      const job=this.get(String(row.owner_id),String(row.job_id));job.stage='needs_attention';job.errorCode='JOB_RESTART_UNCERTAIN';this.write(job);
    }
    if(this.notify){this.notificationTimer=setInterval(()=>void this.notifications().catch(()=>{}),5000);this.notificationTimer.unref();}
    this.kick();
  }
  get(owner:string,id:string):GenerationJob {
    const row=this.store.db.prepare('SELECT * FROM generation_jobs WHERE job_id=? AND owner_id=?').get(uuid(id),owner);
    if(!row)throw new Fault('JOB_NOT_FOUND',404);
    const request=JSON.parse(String(row.request)),metadata=JSON.parse(String(row.metadata));
    const version=row.version_id?this.store.getVersion(String(row.version_id)):null;
    return{...request,...metadata,jobId:String(row.job_id),ownerId:owner,idempotencyKey:String(row.idempotency_key),stage:row.status,attempts:Number(row.attempts),checkpoint:String(row.checkpoint),createdAt:String(row.created_at),updatedAt:String(row.updated_at),versionId:version?.versionId??null,gameId:version?.gameId??null,notificationClaimed:row.notified===1};
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
    request={...request,spec:parseSpec(request.spec)};if(!['demo','live'].includes(request.mode)||typeof request.telegramConsent!=='boolean')throw new Fault('INVALID_JOB_REQUEST');
    if(request.previousVersionId)this.store.getVersion(uuid(request.previousVersionId));
    const encoded=JSON.stringify(request);
    const found=this.store.db.prepare('SELECT job_id,request FROM generation_jobs WHERE owner_id=? AND idempotency_key=?').get(owner,key);
    if(found){if(found.request!==encoded)throw new Fault('IDEMPOTENCY_CONFLICT',409);return this.summary(this.get(owner,String(found.job_id)));}
    if(request.mode==='live'&&this.generator){this.limits.take('jobs-global',12);this.limits.take('jobs-'+owner,6);}
    const selected=request.mode==='live'?(this.generator as Generator&{routes?:CodeTransport[]}|undefined)?.routes?.[0]:undefined;
    const job:GenerationJob={...request,jobId:randomUUID(),ownerId:owner,idempotencyKey:key,provider:selected?.provider??null,requestedModel:selected?.model??null,actualModel:null,createdAt:now(),updatedAt:now(),stage:'queued',attempts:0,checkpoint:'',checkpointAt:null,history:[],errorCode:null,retryAt:null,versionId:null,gameId:null,notificationClaimed:false,telegramState:request.telegramConsent?'pending':'none',outputTokens:null,reasoningTokens:null,elapsedMs:0};
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
  continue(owner:string,id:string){const job=this.get(owner,id);if(!['needs_attention','failed','cancelled'].includes(job.stage))throw new Fault('JOB_STATE',409);if(job.attempts>=12)throw new Fault('JOB_ATTEMPT_LIMIT',409);if(job.retryAt&&Date.now()<job.retryAt)throw new Fault('JOB_RETRY_AFTER',429);const pending=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status IN ('queued','generating','validating','repairing')").get()?.n),owned=Number(this.store.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE owner_id=? AND status IN ('queued','generating','validating','repairing')").get(owner)?.n);if(pending>=20||owned>=3)throw new Fault('JOB_QUEUE_FULL',429);job.stage='queued';job.errorCode=null;this.write(job);this.kick();return this.summary(job);}
  claim(owner:string,id:string){this.get(owner,id);return this.store.db.prepare("UPDATE generation_jobs SET notified=1 WHERE job_id=? AND owner_id=? AND status='completed' AND notified=0").run(id,owner).changes===1;}
  private kick(){if(this.stopping||!this.started||this.active)return;this.assertWorker();const row=this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();if(!row)return;const controller=new AbortController();const id=String(row.job_id);const done=Promise.resolve().then(()=>this.run(String(row.owner_id),id,controller.signal)).catch(()=>{/* Lease loss preserves the last committed checkpoint for the next owner. */}).finally(()=>{this.active=undefined;if(!this.stopping)this.kick();});this.active={id,controller,done};}
  private async run(owner:string,id:string,signal:AbortSignal){
    let job=this.get(owner,id);if(job.stage!=='queued')return;job.stage='generating';this.write(job);const began=Date.now();
    const initialElapsed=job.elapsedMs;
    const update=(action:(job:GenerationJob)=>void)=>{job=this.get(owner,id);action(job);job.elapsedMs=initialElapsed+Date.now()-began;this.write(job);};
    const context:GenerationContext={checkpoint:job.checkpoint,maxCalls:Math.min(6,12-job.attempts),stage:stage=>update(j=>{if(!terminal.has(j.stage))j.stage=stage;}),dispatch:route=>{try{this.limits.take('provider-global',12);this.limits.take('provider-'+owner,6);}catch(error){update(j=>{j.retryAt=Date.now()+60000;});throw error;}update(j=>{j.attempts++;j.provider=route.provider;j.requestedModel=route.model;});},partial:(code,model,tokens)=>update(j=>{if(code){j.checkpoint=code;j.checkpointAt=now();}if(model)j.actualModel=model;if(tokens?.outputTokens!==undefined)j.outputTokens=tokens.outputTokens;if(tokens?.reasoningTokens!==undefined)j.reasoningTokens=tokens.reasoningTokens;}),attempt:attempt=>update(j=>{j.history.push(attempt);j.history=j.history.slice(-12);}),retryAt:at=>update(j=>{j.retryAt=at;})};
    try{
      const previous=job.previousVersionId?this.store.getVersion(job.previousVersionId):undefined;
      if(job.mode==='live'&&!this.generator)throw new Fault('LLM_NOT_CONFIGURED',503);
      const artifact=job.mode==='demo'?demoArtifact(job.spec):await this.generator!.generate(job.spec,previous,'llm_code',signal,context);
      job=this.get(owner,id);if(signal.aborted||job.stage==='cancelled')return;
      job.elapsedMs=initialElapsed+Date.now()-began;job.stage='validating';this.write(job);
      this.store.saveAndCompleteJob(id,owner,job.spec,artifact,job.previousVersionId,this.instance);
    }catch(error){job=this.get(owner,id);if(job.stage==='completed')return;job.stage=job.stage==='cancelled'?'cancelled':'needs_attention';job.errorCode=this.stopping?'JOB_RESTART_UNCERTAIN':signal.aborted?'REQUEST_CANCELLED':error instanceof Fault?error.code:'LLM_CONNECTION_INTERRUPTED';job.elapsedMs=initialElapsed+Date.now()-began;this.write(job);}
  }
  private async notifications(){if(this.stopping||!this.notify)return;for(const row of this.store.db.prepare("SELECT job_id,owner_id FROM generation_jobs WHERE status='completed' ORDER BY rowid DESC LIMIT 50").all()){
    const owner=String(row.owner_id),job=this.get(owner,String(row.job_id));if(job.telegramState!=='pending'||!job.telegramConsent||Date.now()-(this.presence.get(owner)??0)<30000)continue;
    // Claim before network dispatch. A lost acknowledgement is never sent twice.
    this.assertWorker();const claim=this.store.db.prepare("UPDATE generation_jobs SET metadata=json_set(metadata,'$.telegramState','unknown') WHERE job_id=? AND owner_id=? AND status='completed' AND json_extract(metadata,'$.telegramState')='pending' AND EXISTS(SELECT 1 FROM generation_worker WHERE slot=1 AND instance=? AND expires_at>?)").run(job.jobId,owner,this.instance,Date.now());if(claim.changes!==1)continue;
    job.telegramState='unknown';try{job.telegramState=await this.notify(owner,job.gameId!,job.versionId!);}catch{job.telegramState='unknown';}if(this.stopping)return;this.write(job);
  }}
  async close(){this.stopping=true;clearInterval(this.notificationTimer);this.active?.controller.abort();await this.active?.done;clearInterval(this.heartbeat);if(this.started)this.store.db.prepare('DELETE FROM generation_worker WHERE slot=1 AND instance=?').run(this.instance);this.started=false;}
}
