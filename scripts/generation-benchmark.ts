import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {configuredGenerator} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {Fault} from '../src/contracts.ts';
import type {GameSpec} from '../src/contracts.ts';
// One prompt, one provider request; repairs/fallback disabled for this benchmark.
const adapter=configuredGenerator({...process.env,LLM_REPAIRS:'0',LLM_FALLBACK:'none',LLM_LOCAL_FALLBACK:'',LLM_TIMEOUT_MS:'60000'});
if(!adapter)throw new Fault('LLM_NOT_CONFIGURED');
if(!['openrouter','ollama.com','ollama'].includes(adapter.routes[0].provider))throw new Fault('BENCHMARK_PROVIDER_NOT_ALLOWED');
const directory='.local/benchmarks/'+randomUUID();mkdirSync(directory,{recursive:true});const store=new Store(directory+'/data.sqlite'),jobs=new GenerationJobs(store,adapter,undefined,true,{maxCalls:1,durationMs:70000});
const spec:GameSpec={prompt:'Мини-игра: нажми 3 звезды, затем победа. Ошибочный тап на красный круг — поражение. Старт, пауза/продолжение, заново. Touch-кнопки от 44px, автономный HTML. Сохраняй ход игры после паузы.',audience:'default',genre:'unknown',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true};
const began=Date.now();let result;
try{
  const created=jobs.create('benchmark',randomUUID(),{spec,mode:'live',telegramConsent:false});
  for(let i=0;i<3500;i++){const job=jobs.get('benchmark',created.jobId);if(['completed','needs_attention','failed','cancelled'].includes(job.stage)){result=job;break;}await new Promise(done=>setTimeout(done,20));}
  if(!result)throw new Fault('BENCHMARK_TIMEOUT');
  const report={provider:result.provider,requestedModel:result.requestedModel,actualModel:result.actualModel,status:result.stage,error:result.errorCode,requests:result.attempts,repairs:Math.max(0,result.history.length-1),outputTokens:result.outputTokens,reasoningTokens:result.reasoningTokens,requestMs:result.history.map(attempt=>attempt.requestMs??attempt.elapsedMs),validationMs:result.history.map(attempt=>attempt.validationMs??null),fullJobMs:Date.now()-began,timeToFirstPlayableGameMs:result.stage==='completed'?Date.now()-began:null,checkpointBytes:Buffer.byteLength(result.checkpoint),browser:result.versionId?store.getVersion(result.versionId).generation?.browser:null,gameSpec:'deterministic local envelope; no separate model call',fullGameplay:'not_verified',comparison:'single requested model; no best-model claim'};
  if(result.versionId)writeFileSync(directory+'/game.html',store.getVersion(result.versionId).html,{flag:'wx'});
  writeFileSync(directory+'/evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,directory}));
}finally{await jobs.close();adapter.close();store.close();}
