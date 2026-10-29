import {test,expect} from '@playwright/test';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {CloudTransport} from '../src/transport.ts';
import {ChatGptTransport} from '../src/chatgpt.ts';
import {offlineChatGpt,connected,completed,sse} from './chatgpt-helper.ts';
import {strictCanvas} from './strict-canvas-fixtures.ts';
import {generationMessages} from '../src/generation.ts';
import {createApp} from '../src/api.ts';
import {spec} from './helpers.ts';
import {mkdtempSync} from 'node:fs';

test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Production checker is Chromium.'));
for(const mode of ['ollama-cloud','openrouter','chatgpt'] as const)test('strict integration: real '+mode+' transport, synthetic HTTP, create/edit/reject/Continue',async()=>{
 test.setTimeout(65000);
 let source=strictCanvas(),posts=0;const bodies:any[]=[];
 const originalFetch=globalThis.fetch;
 const {session}=offlineChatGpt(async(_url,init)=>{posts++;bodies.push(JSON.parse(String(init?.body)));return sse([completed(source)]);});
 const requested=mode==='ollama-cloud'?'gemma4:31b':'openrouter/free';
 globalThis.fetch=(async(input:any,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname==='127.0.0.1')return originalFetch(input,init);
  if(!['https://ollama.com','https://openrouter.ai'].includes(url.origin))throw Error('EXTERNAL_TEST_REQUEST_FORBIDDEN');
  if(init?.method!=='POST')return Response.json({data:[{id:requested}]});
  posts++;bodies.push(JSON.parse(String(init.body)));
  return new Response('data: '+JSON.stringify({model:requested,choices:[{delta:{content:source},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 }) as typeof fetch;
 const path=mkdtempSync('.local/strict-providers-')+'/games.sqlite';
 const transport=mode==='chatgpt'?new ChatGptTransport(session):new CloudTransport({base:mode==='ollama-cloud'?'https://ollama.com/v1':'https://openrouter.ai/api/v1',key:'synthetic-test-only',model:requested,networkEnv:()=>({YAPLIX_LLM_NETWORK:'direct'})});
 const engine=new GenerationEngine([transport],{allowLlmRepair:true,repairs:1});
 let store=new Store(path),jobs=new GenerationJobs(store,engine),app=createApp(store,undefined,undefined,undefined,undefined,undefined,jobs);
 const settled=async(id:string)=>{await expect.poll(()=>jobs.get('owner',id).stage,{timeout:30000}).toMatch(/^(completed|needs_attention|failed)$/);return jobs.get('owner',id);};
 try{
  if(mode==='chatgpt')await connected(session);
  const request={spec,mode:'live' as const,providerMode:mode,telegramConsent:false};
  const first=await settled(jobs.create('owner','strict-create',request).jobId);expect(first.stage).toBe('completed');expect(posts).toBe(1);
  const old=store.getVersion(first.versionId!);expect(old.generation?.browser.rendering?.contract).toBe('canvas-webgl-strict-v2');
  const edit=await settled(jobs.create('owner','strict-edit',{...request,previousVersionId:old.versionId}).jobId);expect(edit.stage).toBe('completed');expect(posts).toBe(2);
  const messages=mode==='chatgpt'?bodies[1].input:bodies[1].messages;expect(messages).toEqual(generationMessages(spec,old));
  if(mode==='chatgpt')expect(bodies[0]).toMatchObject({model:'gpt-6.1-sol',reasoning:{effort:'medium'},store:false,stream:true});
  const latest=store.getVersion(edit.versionId!);const exported=await(await app.request('/api/versions/'+latest.versionId+'/export')).text();expect(exported).toBe(source);
  const refusedJobs:string[]=[];
  for(const [index,markup] of [
   `<li style="position:fixed;left:160px;top:5px;list-style-type:'Score 100';color:white;font-size:20px"></li>`,
   '<style>#probe::before{content:"Pause";position:fixed;left:0;top:0;width:0;height:0;overflow:visible;color:white;font-size:20px}</style><div id="probe"></div>',
  ].entries()){
   source=strictCanvas().replace('<body>','<body>'+markup);
   const refused=await settled(jobs.create('owner','strict-reject-'+index,{...request,previousVersionId:latest.versionId}).jobId);
   expect(refused).toMatchObject({stage:'needs_attention',versionId:null,errorCode:'BROWSER_CANVAS_DOM_UNVERIFIED',checkpoint:source,originalCheckpoint:source,validation:{level:'NOT_VERIFIED'}});expect(posts).toBe(3+index);expect(refused.attempts).toBe(1);
   expect(store.history(old.gameId)).toHaveLength(2);refusedJobs.push(refused.jobId);
  }
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);session.disconnect();
  expect(store.getVersion(old.versionId)).toEqual(old);expect(store.getVersion(latest.versionId)).toEqual(latest);
  for(const id of refusedJobs){
   jobs.continue('owner',id);expect(await settled(id)).toMatchObject({stage:'needs_attention',versionId:null,errorCode:'BROWSER_CANVAS_DOM_UNVERIFIED',validation:{level:'NOT_VERIFIED'}});expect(posts).toBe(4);
   expect(store.history(old.gameId)).toHaveLength(2);
  }
 }finally{globalThis.fetch=originalFetch;session.disconnect();await jobs.close();engine.close();store.close();}
});
