import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {runApp} from '../scripts/app-runtime.ts';
import {PROJECT_ROOT,Store} from '../src/store.ts';
import {spec} from './helpers.ts';
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
test('one-click runtime starts one owned server, opens catalogue, reuses identity and preserves DB on graceful close',async()=>{
  const directory=mkdtempSync('.local/launcher-test-'),port=await freePort(),controller=new AbortController();let ready!:()=>void;const started=new Promise<void>(done=>ready=done);const opened:string[]=[];
  const running=runApp({port,env:{...process.env,LIVE_PROVIDER:'none',YAPLIX_DB:directory+'/data.sqlite'},signal:controller.signal,openBrowser:url=>opened.push(url),announce:()=>ready()});
  try{await started;const reused=await runApp({port,signal:new AbortController().signal,openBrowser:url=>opened.push(url),announce:()=>{}});assert.equal(reused.attached,true);assert.equal(opened.length,2);const version=await(await fetch(opened[0]+'api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',spec})})).json();controller.abort();await running;const store=new Store(directory+'/data.sqlite');try{assert.equal(store.getVersion(version.versionId).sha256,version.sha256);assert.ok(store.integrity());}finally{store.close();}}finally{controller.abort();await running;rmSync(directory,{recursive:true});}
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
