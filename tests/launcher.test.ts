import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {runApp,appIdentity} from '../scripts/app-runtime.ts';
import {runTunnel} from '../scripts/tunnel-runtime.ts';
import {runtimeKey,proof,RUNTIME_PROTOCOL} from '../src/runtime-control.ts';
import {PROJECT_ROOT,Store} from '../src/store.ts';
import {spec} from './helpers.ts';
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
test('one-click restart stops own backend, preserves DB, and relaunches',{timeout:45000},async()=>{
  const directory=mkdtempSync('.local/launcher-test-'),port=await freePort(),c1=new AbortController(),c2=new AbortController();
  let ready1!:()=>void,ready2!:()=>void;const started1=new Promise<void>(done=>ready1=done),started2=new Promise<void>(done=>ready2=done);const opened:string[]=[];
  const running=runApp({port,env:{...process.env,LIVE_PROVIDER:'none',YAPLIX_DB:directory+'/data.sqlite'},signal:c1.signal,openBrowser:url=>opened.push(url),announce:()=>ready1()});
  try{
    await started1;
    // Second launch must gracefully stop the proven own backend and start a new one; both share the temp DB.
    const restarted=runApp({port,env:{...process.env,LIVE_PROVIDER:'none',YAPLIX_DB:directory+'/data.sqlite'},signal:c2.signal,openBrowser:url=>opened.push(url),announce:()=>ready2()});
    try{
      await started2;
      assert.equal(opened.length,2);
      const version=await(await fetch(opened[1]+'api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',spec})})).json();
      c2.abort();await restarted;
      c1.abort();await running;
      const store=new Store(directory+'/data.sqlite');try{assert.equal(store.getVersion(version.versionId).sha256,version.sha256);assert.ok(store.integrity());}finally{store.close();}
    }finally{c2.abort();await restarted.catch(()=>{});}
  }finally{c1.abort();await running.catch(()=>{});rmSync(directory,{recursive:true});}
});
test('one-click rejects foreign service without exposing control key or stopping it',async()=>{
  let authorization=false;const server=createServer((request,response)=>{authorization||=Boolean(request.headers.authorization||request.headers['x-yaplix-control']);response.end('{}');});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;
  try{await assert.rejects(runApp({port,signal:new AbortController().signal,open:false}),/PORT_IN_USE/);assert.equal(authorization,false);assert.equal((await fetch('http://127.0.0.1:'+port)).status,200);}finally{await new Promise<void>(done=>server.close(()=>done()));}
});
test('hung owned shutdown reaches forced cleanup after cancellation; never waits indefinitely (synthetic child)',{timeout:15000},async()=>{
  const controller=new AbortController(),port=await freePort();let ready!:()=>void;const started=new Promise<void>(done=>ready=done);let child:ReturnType<typeof fork>|undefined;
  const running=runApp({port,signal:controller.signal,open:false,announce:()=>ready(),startBackend:env=>child=fork('tests/launcher-fixture.ts',[],{cwd:PROJECT_ROOT,env,silent:true})});
  try{await started;const begin=Date.now();controller.abort();await running;assert.ok(Date.now()-begin<10000);assert.ok(child!.exitCode!==null||child!.signalCode!==null);}finally{controller.abort();child?.kill('SIGKILL');await running;}
});

test('launcher and tunnel preserve a valid same-clone backend with an obsolete build fingerprint',async()=>{
  const instance='same-clone-old-build',key=runtimeKey();let connectorStarted=false;
  const server=createServer((request,response)=>{const url=new URL(request.url!,'http://127.0.0.1');response.setHeader('Content-Type','application/json');response.end(JSON.stringify(url.pathname==='/healthz'?{app:'YAPLIX',instance,ready:true}:{app:'YAPLIX',instance,mode:'local',protocol:RUNTIME_PROTOCOL,schemaVersion:3,buildId:'0'.repeat(64),proof:proof(key,url.searchParams.get('nonce')!,instance)}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;
  try{await assert.rejects(appIdentity(port,key),/BACKEND_UPDATE_RESTART_REQUIRED/);await assert.rejects(runApp({port,signal:new AbortController().signal,open:false}),/PORT_IN_USE/);await assert.rejects(runTunnel({port,binary:'unused',connectorEnv:{},signal:new AbortController().signal,connector:()=>{connectorStarted=true;throw Error('must not launch');},announce:()=>{}}),/PORT_IN_USE/);assert.equal(connectorStarted,false);assert.equal((await fetch('http://127.0.0.1:'+port+'/healthz')).status,200);}finally{await new Promise<void>(done=>server.close(()=>done()));}
});
