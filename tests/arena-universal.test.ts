import test from 'node:test';
import assert from 'node:assert/strict';
import {generationMessages} from '../src/generation.ts';
import {spec} from './helpers.ts';
import {artifact as currentFixture,event} from './helpers.ts';
import {Store} from '../src/store.ts';
import {ArenaStore} from '../src/arena-store.ts';
import {createApp} from '../src/api.ts';
import {ArenaConnection} from '../src/arena.ts';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {arenaMetric,formatArenaValue} from '../src/arena-contract.ts';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {metricGame} from './arena-metric-fixture.ts';
// Preserve a genuinely historical fixture with no Arena declaration.
const artifact={...currentFixture,html:currentFixture.html.replace('<meta name="yaplix-arena" content="score-v1">','')};

test('owner prepares known historical HTML locally as a separate version and repeat preparation is idempotent',async()=>{
  const store=new Store(':memory:'),arena=new ArenaConnection(store);
  try{
    const html=readFileSync('tests/fixtures/games/ember-blocks.html','utf8'),old=store.save(spec,{...artifact,html});
    const app=createApp(store,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,arena);
    const prepare=()=>app.request('http://localhost/api/arena/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId:old.versionId,mode:'local'})});
    const response=await prepare();assert.equal(response.status,201);
    const v=await response.json();assert.notEqual(v.versionId,old.versionId);assert.equal(v.previousVersionId,old.versionId);assert.equal(v.gameId,old.gameId);
    assert.equal(store.getVersion(old.versionId).html,html);assert.equal(store.history(old.gameId).length,2);
    assert.match(v.html,/result-v1:score/);assert.ok(new ArenaStore(store).create(v.versionId));
    assert.equal((await(await prepare()).json()).versionId,v.versionId);assert.equal(store.history(old.gameId).length,2);
    const unknown=store.save(spec,artifact);const rejected=await app.request('http://localhost/api/arena/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId:unknown.versionId,mode:'local'})});assert.equal(rejected.status,409);assert.equal(store.history(unknown.gameId).length,1);
  }finally{await arena.shutdown();store.close();}
});

test('minimum completion time ranks faster players first and preserves their best completed result',()=>{
  const store=new Store(':memory:');
  try{
    const v=store.save(spec,{...artifact,html:artifact.html.replace('<head>','<head><meta name="yaplix-arena" content="result-v1:completion-time">')});
    const arena=new ArenaStore(store),room=arena.create(v.versionId),slow=arena.join(room.roomId,'Медленный'),fast=arena.join(room.roomId,'Быстрый');
    const run=(p:typeof slow,value:number)=>{const s=arena.start(room.roomId,p.token);arena.event(room.roomId,p.token,s.token,event(s,'game_ready',0));arena.event(room.roomId,p.token,s.token,event(s,'game_started',1));arena.event(room.roomId,p.token,s.token,{...event(s,'score_changed',2),type:'result_changed',data:{value}});assert.equal(arena.board(room.roomId).players.find(r=>r.nickname===p.nickname)?.bestScore,null);arena.event(room.roomId,p.token,s.token,event(s,'game_won',3));arena.event(room.roomId,p.token,s.token,event(s,'session_ended',4));};
    run(slow,5000);run(fast,3000);
    assert.deepEqual(arena.board(room.roomId).players.map(p=>[p.nickname,p.bestScore,p.place]),[['Быстрый',3000,1],['Медленный',5000,2]]);
    assert.equal(arena.board(room.roomId).metric.direction,'lower');
  }finally{store.close();}
});

test('an unfinished or failed puzzle cannot submit a completion-time record',()=>{
  const store=new Store(':memory:');try{
    const v=store.save(spec,{...artifact,html:artifact.html.replace('<head>','<head><meta name="yaplix-arena" content="result-v1:completion-time">')}),a=new ArenaStore(store),r=a.create(v.versionId),p=a.join(r.roomId,'Игрок'),s=a.start(r.roomId,p.token);
    for(const [type,seq,data] of [['game_ready',0,{}],['game_started',1,{}],['result_changed',2,{value:1000}]] as const)a.event(r.roomId,p.token,s.token,event(s,type,seq,Date.now(),data));
    assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'session_ended',3)),/ARENA_OBJECTIVE_INCOMPLETE/);
    a.event(r.roomId,p.token,s.token,event(s,'game_lost',3));
    assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'session_ended',4)),/ARENA_OBJECTIVE_INCOMPLETE/);assert.equal(a.board(r.roomId).players[0].bestScore,null);
  }finally{store.close();}
});

for(const metric of ['score','completion-time','distance','survival'])test('version pins '+metric+' semantics, rejects malformed/mixed/foreign result streams and keeps ties',()=>{
  const store=new Store(':memory:'),a=new ArenaStore(store);try{
    const v=store.save(spec,{...artifact,html:artifact.html.replace('<head>','<head><meta name="yaplix-arena" content="result-v1:'+metric+'">')}),r=a.create(v.versionId),p=a.join(r.roomId,'Первый'),q=a.join(r.roomId,'Другой'),s=a.start(r.roomId,p.token),other=a.start(r.roomId,q.token);
    a.event(r.roomId,p.token,s.token,event(s,'game_ready',0));
    assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'result_changed',1,Date.now(),{value:30})),/EVENT_STATE/);
    a.event(r.roomId,p.token,s.token,event(s,'game_started',1));
    for(const value of [-1,.5,1e9+1,NaN])assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'result_changed',2,Date.now(),{value})),/INVALID_RESULT/);
    if(metric==='completion-time'||metric==='survival')assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'result_changed',2,Date.now(),{value:0})),/INVALID_RESULT/);
    assert.throws(()=>a.event(r.roomId,q.token,s.token,event(s,'result_changed',2,Date.now(),{value:30})),/ARENA_ATTEMPT_MISMATCH/);
    assert.throws(()=>a.event(r.roomId,p.token,other.token,event(s,'result_changed',2,Date.now(),{value:30})),/SESSION_UNAUTHORIZED/);
    assert.throws(()=>a.event(r.roomId,p.token,s.token,event(s,'score_changed',2,Date.now(),{score:30})),/ARENA_METRIC_MISMATCH/);
    a.event(r.roomId,p.token,s.token,event(s,'result_changed',2,Date.now(),{value:30}));a.event(r.roomId,p.token,s.token,event(s,'game_won',3));const end=event(s,'session_ended',4);a.event(r.roomId,p.token,s.token,end);assert.deepEqual(a.event(r.roomId,p.token,s.token,end),{duplicate:true});
    for(const [type,seq,data] of [['game_ready',0,{}],['game_started',1,{}],['result_changed',2,{value:30}],['game_won',3,{}],['session_ended',4,{}]] as const)a.event(r.roomId,q.token,other.token,event(other,type,seq,Date.now(),data));
    assert.deepEqual(a.board(r.roomId).players.map(p=>p.place),[1,1]);
    const third=a.join(r.roomId,'Третий'),thirdSession=a.start(r.roomId,third.token);
    for(const [type,seq,data] of [['game_ready',0,{}],['game_started',1,{}],['result_changed',2,{value:40}],['game_won',3,{}],['session_ended',4,{}]] as const)a.event(r.roomId,third.token,thirdSession.token,event(thirdSession,type,seq,Date.now(),data));
    assert.deepEqual(a.board(r.roomId).players.map(p=>[p.bestScore,p.place]),metric==='completion-time'?[[30,1],[30,1],[40,3]]:[[40,1],[30,2],[30,2]]);
    const changed=store.save(spec,{...artifact,html:v.html},v.versionId);assert.throws(()=>a.resume(r.roomId,changed.versionId),/ARENA_VERSION_MISMATCH/);
  }finally{store.close();}
});

test('ambiguous declarations and games without a measured goal have no ranking; LLM consent is required server-side',async()=>{
  assert.equal(arenaMetric('<meta name="yaplix-arena" content="result-v1:score"><meta name="yaplix-arena" content="result-v1:distance">'),null);
  assert.equal(arenaMetric('<meta name="yaplix-arena" content="result-v1:unknown">'),null);
  const store=new Store(':memory:'),arena=new ArenaConnection(store);try{
    const html=artifact.html.replace('<head>','<head><meta name="yaplix-arena" content="goal-required-v1">'),v=store.save(spec,{...artifact,html});
    const app=createApp(store,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,arena);
    const post=(body:unknown,origin?:string)=>app.request('http://localhost/api/arena/prepare',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
    assert.throws(()=>arena.records.create(v.versionId),/ARENA_UNSUPPORTED/);
    assert.equal((await(await app.request('http://localhost/api/arena/compatibility/'+v.versionId)).json()).goalRequired,true);
    for(const consent of [undefined,false])assert.equal((await post({versionId:v.versionId,mode:'llm',goal:'Пройти игру быстро',consent,providerMode:'ollama-cloud'})).status,409);
    assert.equal((await post({versionId:v.versionId,mode:'llm',consent:true,goal:'',providerMode:'ollama-cloud'})).status,400);
    assert.equal((await post({versionId:v.versionId,mode:'llm',consent:true,goal:'Пройти игру быстро',providerMode:'paid'})).status,400);
    assert.equal((await post({versionId:v.versionId,mode:'local'},'https://evil.invalid')).status,403);
    assert.equal(store.history(v.gameId).length,1);assert.equal(store.getVersion(v.versionId).html,html);
  }finally{await arena.shutdown();store.close();}
});

test('missing Arena contract stops at one synthetic dispatch, preserves checkpoint, and never repairs or falls back',async()=>{
  let calls=0;
  const code=metricGame('score',false);
  const route={route:'primary' as const,provider:'ollama.com',model:'fixture',readiness:async()=>'ready',complete:async()=>{calls++;return {code,model:'fixture'};}};
  const check=async()=>({profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const,rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]}});
  const engine=new GenerationEngine([route,{...route,route:'secondary'}],{allowLlmRepair:true,repairs:1,check});
  const store=new Store(':memory:'),jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:4,retryMs:10});
  try{
    const job=jobs.create('owner','arena-gate-test',{spec:{...spec,prompt:'Arena: '+spec.prompt},mode:'live',providerMode:'ollama-cloud',telegramConsent:false});
    for(let i=0;i<150&&jobs.get('owner',job.jobId).stage!=='needs_attention';i++)await new Promise(r=>setTimeout(r,10));
    const result=jobs.get('owner',job.jobId);assert.equal(result.stage,'needs_attention');assert.equal(result.errorCode,'ARENA_CONTRACT_REQUIRED');assert.equal(calls,1);assert.equal(result.checkpoint,code);assert.equal(store.list().length,0);
    jobs.continue('owner',job.jobId);for(let i=0;i<150&&jobs.get('owner',job.jobId).stage!=='needs_attention';i++)await new Promise(r=>setTimeout(r,10));assert.equal(jobs.get('owner',job.jobId).stage,'needs_attention');assert.equal(calls,1);
  }finally{await jobs.close();engine.close();store.close();}
});

test('completion-time keeps a faster record across worse retries and SQLite reopen without mixing versions',()=>{
  const dir=mkdtempSync('.local/arena-universal-unit-'),file=resolve(dir,'own-test.sqlite');let store=new Store(file);
  const original=Date.now;let now=Date.now();Date.now=()=>now;
  try{
    const v=store.save(spec,{...artifact,html:metricGame('completion-time')}),a=new ArenaStore(store),r=a.create(v.versionId),p=a.join(r.roomId,'Игрок');a.join(r.roomId,'Без результата');
    for(const value of [3000,5000,2000]){
      const s=a.start(r.roomId,p.token);for(const [type,seq,data] of [['game_ready',0,{}],['game_started',1,{}],['result_changed',2,{value}],['game_won',3,{}],['session_ended',4,{}]] as const)a.event(r.roomId,p.token,s.token,event(s,type,seq,now,data));
      assert.equal(a.board(r.roomId).players[0].bestScore,value===2000?2000:3000);assert.equal(a.board(r.roomId).players[1].place,null);now+=1100;
    }
    a.close(r.roomId);store.close();store=new Store(file);const reopened=new ArenaStore(store);reopened.resume(r.roomId,v.versionId);
    assert.equal(reopened.board(r.roomId).metric.id,'completion-time');assert.equal(reopened.board(r.roomId).players[0].bestScore,2000);
    const edited=store.save(spec,{...artifact,html:metricGame('score')},v.versionId);assert.equal(reopened.create(edited.versionId).players.length,0);assert.equal(reopened.board(r.roomId).metric.direction,'lower');
  }finally{Date.now=original;store.close();rmSync(dir,{recursive:true});}
});

test('analytics names time and distance as results rather than presenting them as points',()=>{
  assert.equal(formatArenaValue(5000,{unit:'ms'}),'5.000 с');assert.equal(formatArenaValue(30,{unit:'m'}),'30 м');
  const store=new Store(':memory:');try{
    for(const [metric,value] of [['completion-time',5000],['distance',30],['survival',6000]] as const){
      const v=store.save(spec,{...artifact,html:metricGame(metric)}),s=store.session(v.versionId);
      for(const [type,seq,data] of [['game_ready',0,{}],['game_started',1,{}],['result_changed',2,{value}],['game_won',3,{}],['session_ended',4,{}]] as const)store.event(event(s,type,seq,Date.now(),data),s.token);
      const data=store.analytics(v.versionId);assert.equal(data.meanScore,null);assert.equal(data.meanResult,value);assert.equal(data.resultMetric?.id,metric);
    }
  }finally{store.close();}
});

test('Arena generation contract is explicit and regular games keep optional telemetry',()=>{
  for(const style of ['direct','spec','intent'] as const){
    const messages=generationMessages({...spec,prompt:'Arena: головоломка, пройди лабиринт без очков и жизней'},undefined,style);
    assert.equal(messages.length,2);
    assert.match(messages[0].content,/Arena score-v1 is explicitly requested/);
    assert.doesNotMatch(generationMessages({...spec,prompt:'Головоломка без очков и жизней'},undefined,style)[0].content,/Arena score-v1 is explicitly requested/);
    assert.match(messages[0].content,/do not.*invent game mechanics/i);
    assert.match(messages[1].content,/без очков и жизней/);
  }
});
