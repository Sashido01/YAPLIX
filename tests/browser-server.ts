import { serve } from '@hono/node-server';
import { createApp } from '../src/api.ts';
import { Store } from '../src/store.ts';
import { syntheticEngine } from './synthetic-engine.ts';
import { GenerationJobs } from '../src/jobs.ts';
import { RateLimit } from '../src/rate-limit.ts';
import { artifact, html, spec } from './helpers.ts';
import {readFileSync} from 'node:fs';
// The offline browser server must report a deterministic, unconfigured LIVE
// provider state even when the developer shell has personal credentials.
delete process.env.OLLAMA_CLOUD_API_KEY;
delete process.env.CLOUD_API_KEY;
const store = new Store(process.env.YAPLIX_PLAY_DB ?? ':memory:');
const engine=syntheticEngine();
// Synthetic browser runs do not contact a provider. Keep the production
// per-provider dispatch limit intact in GenerationJobs defaults and use an
// isolated test-only cap so the full UI matrix cannot exhaust it cumulatively.
class SyntheticRateLimit extends RateLimit {
  override take(key:string,_limit=6,windowMs=60000){super.take(key,1000,windowMs);}
}
const jobs=new GenerationJobs(store,engine,undefined,true,{},new SyntheticRateLimit());
// The UI reports provider readiness from the production adapter. This browser
// app intentionally has none; jobs receive the synthetic engine separately.
const app = createApp(store,undefined,undefined,undefined,undefined,undefined,jobs);
app.post('/__test/reset',c=>{
  if((process.env.YAPLIX_PLAY_DB??':memory:')!==':memory:')return c.json({error:'TEST_RESET_DISABLED'},409);
  store.db.exec('PRAGMA foreign_keys=OFF;BEGIN;');
  try{for(const table of ['events','sessions','arena_attempts','arena_players','arena_rooms','generation_jobs','versions','games'])store.db.exec('DELETE FROM '+table);store.db.exec('COMMIT;PRAGMA foreign_keys=ON;');return c.json({reset:true});}
  catch(error){store.db.exec('ROLLBACK;PRAGMA foreign_keys=ON;');throw error;}
});
app.post('/__test/seed-version',async c=>{
  if((process.env.YAPLIX_PLAY_DB??':memory:')!==':memory:')return c.json({error:'TEST_SEED_DISABLED'},409);
  const body=await c.req.json() as {prompt?:string;previousVersionId?:string};
  if(typeof body.prompt!=='string'||body.prompt.length<2||body.prompt.length>500)return c.json({error:'INVALID_FIXTURE_PROMPT'},400);
  const previous=body.previousVersionId?store.getVersion(body.previousVersionId):undefined;
  const version=store.save({...spec,prompt:body.prompt},artifact,previous?.versionId);
  return c.json(version,201);
});
app.get('/fixture', c => {
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  return c.html(html);
});
app.get('/host', c => {
  const fixture=c.req.query('fixture'),fixtureFiles=new Set(['ember-blocks.html','prism-maze.html','arena-target.html']);
  if(fixture&&!fixtureFiles.has(fixture))return c.text('NOT_FOUND',404);
  const fixtureHtml=fixture?readFileSync(new URL('./fixtures/games/'+fixture,import.meta.url),'utf8'):undefined;
  const v = c.req.query('versionId') ? store.getVersion(c.req.query('versionId')!) : store.save(spec,fixtureHtml?{...artifact,html:fixtureHtml}:artifact), session = store.session(v.versionId);
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'");
  return c.html(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="game" style="height:100vh"></div><script type="module">
    import {mountGame} from '/runtime/runtime.js';
    const session=${JSON.stringify(session)};
    window.testSession=session; window.received=[]; window.forwardErrors=[];
    let queue=Promise.resolve();
    window.unmount=mountGame(document.querySelector('#game'),${JSON.stringify(v.html).replaceAll('<', '\\u003c')},session,event=>{
      window.received.push(event);
      queue=queue.then(async()=>{const response=await fetch('/api/sessions/'+session.sessionId+'/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify(event)});if(!response.ok)window.forwardErrors.push(await response.text());}).catch(error=>{window.forwardErrors.push(String(error));});
    });
  </script></body></html>`);
});
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.YAPLIX_PLAY_PORT ?? 3210) });
process.on('SIGTERM', () => {void jobs.close().finally(()=>server.close(() => store.close()));});
