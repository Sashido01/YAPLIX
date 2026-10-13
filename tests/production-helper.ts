import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { PROJECT_ROOT } from '../src/store.ts';
export async function productionServer(host: string, env: NodeJS.ProcessEnv = {}, directory = mkdtempSync('.local/production-test-')) {
  const probe = createServer(); await new Promise<void>((done, fail) => { probe.once('error',fail); probe.listen(0,host,done); });
  const port = (probe.address() as {port:number}).port; await new Promise<void>(done=>probe.close(()=>done()));
  const child = fork('src/server.ts',[],{cwd:PROJECT_ROOT,silent:true,env:{...process.env,YAPLIX_DB:directory+'/data.sqlite',LIVE_PROVIDER:'none',YAPLIX_MODE:'local',YAPLIX_HOST:host,PUBLIC_URL:'',YAPLIX_ACCESS_KEY:'',...env,PORT:String(port)}});
  let output = ''; child.stderr!.on('data',bytes=>output+=bytes);
  const exited = new Promise<void>(done=>child.once('exit',()=>done()));
  async function stop() { if(child.exitCode===null&&child.signalCode===null){child.send('shutdown');const force=setTimeout(()=>child.kill(),7000);await exited;clearTimeout(force);} }
  try {
    await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Production startup timed out: '+output)),8000);child.stdout!.on('data',bytes=>{if(String(bytes).includes('YAPLIX http')){clearTimeout(timer);done();}});child.once('error',fail);child.once('exit',()=>{clearTimeout(timer);fail(new Error('Production startup failed: '+output));});});
  } catch(e) { await stop(); throw e; }
  return {url:`http://${host}:${port}`,port,directory,stop,cleanup:()=>rmSync(directory,{recursive:true})};
}
