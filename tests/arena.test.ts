import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, healthyDatabase, managedPath } from '../src/store.ts';
import { artifact, spec, event } from './helpers.ts';
import { createApp } from '../src/api.ts';
import { ArenaConnection, arenaPort } from '../src/arena.ts';
import { ArenaStore } from '../src/arena-store.ts';
import { arenaDeclared } from '../src/arena-contract.ts';
import { generationMessages } from '../src/generation.ts';
import { openGallery } from '../src/gallery.ts';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { networkPolicy } from '../src/access.ts';
import { mountGame } from '../src/runtime.ts';

const downgrade = 'DROP INDEX arena_attempts_player; DROP TABLE arena_attempts; DROP TABLE arena_players; DROP INDEX arena_rooms_version; DROP TABLE arena_rooms; PRAGMA user_version=2';
const testNetworks = async()=>[{name:'isolated test',address:'127.0.0.1'}];

test('Arena migration protects a v2 snapshot, keeps existing HTML and reopens records', async () => {
  const dir=mkdtempSync(managedPath('.local/tests/arena-migration-')), path=resolve(dir,'arena.sqlite');
  const backups=resolve(managedPath('.local/backups/marker'),'..'), before=new Set(readdirSync(backups));
  let store = new Store(path),snapshot:string|undefined;
  try {
    const version = store.save(spec, artifact);
    store.db.exec(downgrade);store.close();store=new Store(path);
    assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 3);
    assert.equal(store.getVersion(version.versionId).html, version.html);
    assert.ok(store.integrity());
    // Identify only this test's snapshot by its unique saved version, never remove another migration's files.
    snapshot=readdirSync(backups).filter(name=>!before.has(name)&&name.startsWith('before-v3-')).find(name=>{
      const candidate=new DatabaseSync(resolve(backups,name),{readOnly:true});
      try{return Boolean(candidate.prepare('SELECT 1 FROM versions WHERE version_id=?').get(version.versionId));}finally{candidate.close();}
    });
    assert.ok(snapshot);const copy=new DatabaseSync(resolve(backups,snapshot),{readOnly:true});
    try{assert.ok(healthyDatabase(copy));assert.equal(copy.prepare('PRAGMA user_version').get()?.user_version,2);}finally{copy.close();}
    const arena=new ArenaStore(store),game=openGallery(store,'arena-target'),room=arena.create(game.versionId),p=arena.join(room.roomId,'Аня');
    const attempt=arena.start(room.roomId,p.token);let sequence=0;
    for(const [type,data] of [['game_ready',{}],['game_started',{}],['score_changed',{score:30}],['session_ended',{}]] as const)arena.event(room.roomId,p.token,attempt.token,event(attempt,type,sequence++,Date.now(),data));
    store.close();store=new Store(path);
    assert.equal(new ArenaStore(store).board(room.roomId).players[0].bestScore,30);
    assert.equal(new ArenaStore(store).player(room.roomId,p.token).nickname,'Аня');
    const backup=await store.backup();assert.equal(backup.schemaVersion,3);rmSync(resolve(backups,backup.filename));
  } finally { store.close();if(snapshot)rmSync(resolve(backups,snapshot));rmSync(dir,{recursive:true}); }
});

test('only completed actual-event streams improve personal records; duplicates and abandoned attempts cannot double count', () => {
  const store=new Store(':memory:'),arena=new ArenaStore(store),v=openGallery(store,'arena-target'),r=arena.create(v.versionId),p=arena.join(r.roomId,'Игрок');
  try{
    let bestScore:number|null=null;let now=Date.now();const original=Date.now;Date.now=()=>now;
    try{
      const run=(score:number)=>{const s=arena.start(r.roomId,p.token);let seq=0;const send=(type:Parameters<typeof event>[1],data={})=>{const e=event(s,type,seq++,now,data);arena.event(r.roomId,p.token,s.token,e);return e;};send('game_ready');send('game_started');send('score_changed',{score});assert.equal(arena.board(r.roomId).players[0].bestScore,bestScore);const end=send('session_ended');assert.deepEqual(arena.event(r.roomId,p.token,s.token,end),{duplicate:true});bestScore=bestScore===null?score:Math.max(bestScore,score);now+=1100;};
      run(30);run(10);assert.equal(arena.board(r.roomId).players[0].bestScore,30);run(60);assert.equal(arena.board(r.roomId).players[0].bestScore,60);
      const s=arena.start(r.roomId,p.token);arena.event(r.roomId,p.token,s.token,event(s,'game_ready',0,now));arena.event(r.roomId,p.token,s.token,event(s,'game_started',1,now));
      assert.throws(()=>arena.event(r.roomId,p.token,s.token,event(s,'session_ended',2,now)),/ARENA_SCORE_MISSING/);
      assert.equal(arena.board(r.roomId).players[0].bestScore,60);
      now+=1100;arena.start(r.roomId,p.token);
      assert.throws(()=>arena.event(r.roomId,p.token,s.token,event(s,'score_changed',2,now,{score:900})),/ARENA_ATTEMPT_ENDED/);
    }finally{Date.now=original;}
  }finally{store.close();}
});

test('completion and best record are atomic even if SQLite rejects the record update', () => {
  const store=new Store(':memory:'),arena=new ArenaStore(store),v=openGallery(store,'arena-target'),r=arena.create(v.versionId),p=arena.join(r.roomId,'Игрок'),s=arena.start(r.roomId,p.token);
  try{
    arena.event(r.roomId,p.token,s.token,event(s,'game_ready',0));arena.event(r.roomId,p.token,s.token,event(s,'game_started',1));arena.event(r.roomId,p.token,s.token,event(s,'score_changed',2,Date.now(),{score:90}));
    const end=event(s,'session_ended',3);
    store.db.exec("CREATE TRIGGER fail_record BEFORE UPDATE OF best_score ON arena_players BEGIN SELECT RAISE(ABORT,'synthetic record failure'); END");
    assert.throws(()=>arena.event(r.roomId,p.token,s.token,end),/synthetic record failure/);assert.equal(arena.board(r.roomId).players[0].bestScore,null);
    store.db.exec('DROP TRIGGER fail_record');assert.deepEqual(arena.event(r.roomId,p.token,s.token,end),{duplicate:false});assert.equal(arena.board(r.roomId).players[0].bestScore,90);
  }finally{store.close();}
});

test('universal Arena generation preserves legacy score-v1 and strict Canvas without extra inference', () => {
  const store=new Store(':memory:');try{
    const historical={...artifact,html:artifact.html.replace('<meta name="yaplix-arena" content="score-v1">','')};
    assert.equal(arenaDeclared(historical.html),false);
    assert.match(generationMessages(spec)[0].content,/Arena is automatic/);
    const messages=generationMessages({...spec,prompt:'Arena: точная игра с пятью бросками'});
    assert.equal(messages.length,2);assert.match(messages[0].content,/ALL visible game UI inside Canvas/);assert.match(messages[0].content,/result_changed/);
    const v=openGallery(store,'arena-target');assert.ok(arenaDeclared(v.html));assert.match(generationMessages({...spec,prompt:'Ускорить игру'},v)[0].content,/preserve the existing metric\/score-v1 bridge/);
    assert.throws(()=>new ArenaStore(store).create(store.save(spec,historical).versionId),/ARENA_UNSUPPORTED/);
  }finally{store.close();}
});

test('one invitation admits ten independent clients, confines LAN scope, rejects forged or malformed events', async () => {
  const store=new Store(':memory:'),arena=new ArenaConnection(store,testNetworks,0),v=openGallery(store,'arena-target');
  try{
    const state=await arena.enable(v.versionId), url=new URL((state as {url:string}).url),base=url.origin+url.pathname;
    const post=(path:string,body:unknown,cookie?:string,token?:string,extra={})=>fetch(base+path,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)});
    const cookies=await Promise.all(Array.from({length:10},async(_,i)=>{const response=await post('/join',{nickname:'Игрок '+i,invite:url.hash.slice(1)});assert.equal(response.status,201);return response.headers.get('set-cookie')!.split(';')[0];}));
    assert.equal(new Set(cookies).size,10);
    for(let i=0;i<10;i++)assert.equal((await(await fetch(base+'/me',{headers:{Cookie:cookies[i]}})).json()).nickname,'Игрок '+i);
    assert.equal((await post('/join',{nickname:'Новый',invite:'x'.repeat(43)})).status,401);
    assert.equal((await post('/join',{nickname:'<img onerror=x>',invite:url.hash.slice(1)})).status,400);
    assert.equal((await post('/join',{nickname:'Игрок 0',invite:url.hash.slice(1)})).status,409);
    for(const path of ['/api/games','/api/jobs','/api/backups','/api/chatgpt/status','/.env','/phone/version','/arena/other/version'])assert.equal((await fetch(url.origin+path,{headers:{Cookie:cookies[0]}})).status,403);
    assert.equal((await fetch(base+'/version')).status,401);
    assert.equal((await fetch(base+'/version',{headers:{Cookie:cookies[0],Origin:'null'}})).status,403);
    assert.equal((await fetch(base+'/version',{headers:{Cookie:cookies[0],'X-Forwarded-For':'127.0.0.1'}})).status,403);
    assert.equal((await post('/attempts',{},cookies[0],undefined,{Origin:'https://evil.invalid'})).status,403);
    const sessions=await Promise.all(cookies.map(async cookie=>{const response=await post('/attempts',{},cookie);assert.equal(response.status,201);return response.json();}));
    assert.equal(new Set(sessions.map(s=>s.sessionId)).size,10);
    const s=sessions[0];assert.equal((await post('/events',{score:999},cookies[0],s.token)).status,400);
    assert.equal((await post('/events',event(s,'game_ready',0),cookies[1],s.token)).status,409);
    assert.equal((await post('/events',event(s,'game_ready',0),cookies[0],'0'.repeat(64))).status,401);
    const ready=event(s,'game_ready',0);assert.equal((await post('/events',ready,cookies[0],s.token)).status,200);
    assert.equal((await post('/events',ready,cookies[0],s.token)).status,200);
    assert.equal((await post('/events',{...ready,type:'game_started'},cookies[0],s.token)).status,409);
    assert.equal((await post('/events',event(s,'score_changed',1,Date.now(),{score:90}),cookies[0],s.token)).status,409);
    assert.equal((await post('/events',event(s,'game_started',1),cookies[0],s.token)).status,200);
    for(const score of [-1,.5,1e10])assert.equal((await post('/events',event(s,'score_changed',2,Date.now(),{score}),cookies[0],s.token)).status,400);
    assert.equal((await post('/events',event({...s,versionId:sessions[1].sessionId},'score_changed',2,Date.now(),{score:10}),cookies[0],s.token)).status,409);
    assert.equal((await post('/events',{padding:'x'.repeat(6000)},cookies[0],s.token)).status,413);
    const roomId=(state as {roomId:string}).roomId;
    const edited=store.save({...v.spec,prompt:'Отдельная версия'}, {html:v.html,method:v.method,provider:v.provider,model:v.model,generationStatus:v.generationStatus,validationStatus:v.validationStatus}, v.versionId);
    await assert.rejects(arena.enable(edited.versionId,'127.0.0.1',roomId),/ARENA_VERSION_MISMATCH/);
    assert.equal(arena.status().enabled,true);
    arena.records.close(roomId);assert.equal((await post('/attempts',{},cookies[1])).status,409);assert.equal(arena.records.board(roomId).players.length,10);
  }finally{await arena.shutdown();store.close();}
});

test('fixed Arena port and remote owner restrictions preserve the read-only phone surface', async () => {
  assert.equal(arenaPort({}),52605);for(const port of ['0','65536','x',' 52605'])assert.throws(()=>arenaPort({YAPLIX_ARENA_PORT:port}),/ARENA_PORT_INVALID/);
  const store=new Store(':memory:'),blocker=createServer();await new Promise<void>(done=>blocker.listen(0,'127.0.0.1',done));
  const port=(blocker.address() as {port:number}).port,arena=new ArenaConnection(store,testNetworks,port),v=openGallery(store,'arena-target');
  try{
    await assert.rejects(arena.enable(v.versionId),/PORT_IN_USE/);assert.equal(arena.status().enabled,false);assert.throws(()=>arena.qr(),/ARENA_CLOSED/);assert.equal(blocker.listening,true);
    const policy=networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:'192.168.1.2',YAPLIX_ACCESS_KEY:'s'.repeat(43)}),app=createApp(store,undefined,undefined,policy,undefined,undefined,undefined,undefined,undefined,arena);
    const login=await app.request(policy.origin+'/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:policy.key})}),cookie=login.headers.get('set-cookie')!;
    for(const path of ['/arena','/api/arena?versionId='+v.versionId,'/api/arena/qr.svg'])assert.equal((await app.request(policy.origin+path,{headers:{Cookie:cookie}})).status,403);
  }finally{await arena.shutdown();await new Promise<void>(done=>blocker.close(()=>done()));store.close();}
});

test('owner can open the Arena control page without exposing it to a remote host', async () => {
  const store = new Store(':memory:');
  try {
    const app = createApp(store);
    assert.equal((await app.request('http://localhost/arena')).status, 200);
    assert.equal((await app.request('http://192.168.1.2/arena')).status, 403);
  } finally { store.close(); }
});

test('runtime initialization sends public session IDs only, never parent HTTP secrets', t => {
  let onLoad:(()=>void)|undefined,init:unknown;
  const frame={title:'',setAttribute(){},referrerPolicy:'',style:{cssText:''},srcdoc:'',contentWindow:{postMessage(message:unknown){init=message;}},addEventListener(type:string,listener:()=>void){if(type==='load')onLoad=listener;},remove(){}};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>frame}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
  t.after(()=>{Reflect.deleteProperty(globalThis,'document');Reflect.deleteProperty(globalThis,'window');});
  const session={sessionId:'00000000-0000-4000-8000-000000000001',versionId:'00000000-0000-4000-8000-000000000002',token:'synthetic-parent-only-secret',expiresAt:123};
  const dispose=mountGame({append(){}} as unknown as HTMLElement,artifact.html,session,()=>{});onLoad!();dispose();
  assert.deepEqual(init,{channel:'yaplix_init',protocolVersion:1,sessionId:session.sessionId,versionId:session.versionId});
});
