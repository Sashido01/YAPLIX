import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Store,managedPath} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {TelegramBot} from '../src/telegram-bot.ts';
import type {BotCall} from '../src/telegram-bot.ts';
import {Fault} from '../src/contracts.ts';
import {artifact,spec} from './helpers.ts';

const env=(extra:NodeJS.ProcessEnv={})=>({TELEGRAM_BOT_TOKEN:'123:'+randomUUID().replaceAll('-',''),TELEGRAM_ALLOWED_USER_IDS:'123',TELEGRAM_BOT_USERNAME:'YaplixBot',...extra});
const update=(text:string,extra:Record<string,unknown>={})=>({update_id:1,message:{text,chat:{id:123,type:'private'},from:{id:123,is_bot:false},...extra}});
const pause=(ms=5)=>new Promise<void>(done=>setTimeout(done,ms));
async function until(predicate:()=>boolean){for(let i=0;i<400;i++){if(predicate())return;await pause();}throw Error('BOT_WAIT_TIMEOUT');}
function statePath(token:string){const hash=createHash('sha256').update(token).digest('hex').slice(0,24);return managedPath('.local/telegram/consumer-'+hash+'.sqlite');}
function state(token:string){const db=new DatabaseSync(statePath(token),{readOnly:true});try{return db.prepare('SELECT * FROM consumer WHERE slot=1').get();}finally{db.close();}}
function cleanup(token:string){for(const path of [statePath(token),statePath(token)+'-journal',statePath(token)+'-wal',statePath(token)+'-shm'])if(existsSync(path))rmSync(path);}
function idle(signal:AbortSignal){return new Promise<never>((_resolve,reject)=>{const stop=()=>reject(new DOMException('stopped','AbortError'));if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});}
function harness(override?:BotCall){const calls:{method:string;body:Record<string,unknown>}[]=[];let menu:unknown={type:'commands'};const call:BotCall=async(method,body,signal)=>{calls.push({method,body});if(method==='getChatMenuButton')return menu;if(method==='setChatMenuButton'){menu=body.menu_button;return true;}if(override)return override(method,body,signal);if(method==='getMe')return{is_bot:true,username:'YaplixBot'};if(method==='getWebhookInfo')return{url:''};if(method==='getUpdates')return idle(signal);return true;};return{calls,call};}

test('bot commands use actual catalog and job status; HTTPS links preserve exact game/version',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store);const settings=env({PUBLIC_URL:'https://yaplix.test'}),h=harness();const bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{},publicEndpoint:()=>({origin:'https://yaplix.test',instance:'owned-instance'})});
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{assert.equal(String(url),'https://yaplix.test/healthz');return Response.json({app:'YAPLIX',protocol:1,ready:true,instance:'owned-instance'});});
 try{const saved=store.save({...spec,prompt:'My catalog game'},artifact);jobs.create('123','telegram-job-status',{spec:{...spec,prompt:'My queued request'},mode:'live',telegramConsent:false});await bot.start();
  for(const command of ['/start','/games','/new','/status','/help'])await bot.handle(update(command));
  const sent=h.calls.filter(c=>c.method==='sendMessage').map(c=>c.body);assert.equal(sent.length,5);assert.match(String(sent[0].text),/YAPLIX/);assert.match(String(sent[1].text),/My catalog game/);assert.match(String(sent[2].text),/Mini App/);assert.match(String(sent[3].text),/My queued request/);assert.match(String(sent[4].text),/\/help/);
  const links=(sent[1].reply_markup as any).inline_keyboard.flat().filter((x:any)=>x.web_app).map((x:any)=>new URL(x.web_app.url));assert.ok(links.some((u:URL)=>u.pathname==='/telegram'&&u.searchParams.get('game')===saved.gameId&&u.searchParams.get('version')===saved.versionId));
  const createLinks=(sent[2].reply_markup as any).inline_keyboard.flat().filter((x:any)=>x.web_app);assert.ok(createLinks.some((x:any)=>new URL(x.web_app.url).searchParams.get('view')==='create'));
  const registered=h.calls.find(c=>c.method==='setMyCommands')!.body.commands as {command:string}[];assert.deepEqual(registered.map(c=>c.command),['start','games','new','status','help']);
  const menuCalls=h.calls.filter(c=>c.method.includes('ChatMenuButton'));assert.deepEqual(menuCalls.slice(0,3).map(c=>c.method),['getChatMenuButton','setChatMenuButton','getChatMenuButton']);assert.equal(menuCalls.filter(c=>c.method==='setChatMenuButton').length,1);assert.equal(menuCalls.filter(c=>c.method==='getChatMenuButton').length,7);assert.equal((menuCalls[1].body.menu_button as any).web_app.url,'https://yaplix.test/telegram');
 }finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('private bot ignores other users, groups, forged sender/chat combinations and bot senders',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),h=harness(),settings=env(),bot=new TelegramBot(store,jobs,settings,{call:h.call});
 try{for(const extra of [{chat:{id:456,type:'private'}},{from:{id:456}},{chat:{id:123,type:'group'}},{from:{id:123,is_bot:true}},{chat:{id:'123',type:'private'}}])await bot.handle(update('/games',extra));assert.equal(h.calls.length,0);
  await bot.handle({callback_query:{id:'callback-one',data:'/status',from:{id:123},message:{chat:{id:123,type:'private'}}}});assert.deepEqual(h.calls.map(c=>c.method),['getChatMenuButton','answerCallbackQuery','sendMessage']);
 }finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('no HTTPS keeps bot useful with explanatory message, reply keyboard and no Mini App links',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),h=harness(),settings=env({PUBLIC_URL:'http://127.0.0.1:3000'}),bot=new TelegramBot(store,jobs,settings,{call:h.call});
 try{await bot.handle(update('/games'));const body=h.calls.at(-1)!.body;assert.match(String(body.text),/пока нет игр/);assert.match(String(body.text),/проверенный публичный HTTPS/);assert.match(String(body.text),/YAPLIX.cmd/);assert.ok((body.reply_markup as any).keyboard);assert.equal(JSON.stringify(body).includes('web_app'),false);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('unverified HTTPS health removes web-app links before replies',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),h=harness(),settings=env({PUBLIC_URL:'https://yaplix.test'}),bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{},publicEndpoint:()=>({origin:'https://yaplix.test',instance:'owned-instance'})});
 t.mock.method(globalThis,'fetch',async()=>Response.json({app:'some-other-service',protocol:1,ready:true}));
 try{await bot.start();await bot.handle(update('/start'));assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);assert.match(String(h.calls.at(-1)!.body.text),/HTTPS/);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('single owner is required; bot mismatch and configured webhook release their acquired lock',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store);
 try{for(const ids of ['', '123,456','not-an-id']){const settings=env({TELEGRAM_ALLOWED_USER_IDS:ids}),h=harness(),bot=new TelegramBot(store,jobs,settings,{call:h.call});await assert.rejects(bot.start(),/TELEGRAM_SINGLE_OWNER_REQUIRED/);assert.equal(h.calls.length,0);await bot.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
  for(const failure of ['mismatch','webhook']){const settings=env(),h=harness(async(method)=>{if(method==='getMe')return{is_bot:true,username:failure==='mismatch'?'WrongBot':'YaplixBot'};if(method==='getWebhookInfo')return{url:'https://configured.test/webhook'};throw Error('NO_POLL');}),bot=new TelegramBot(store,jobs,settings,{call:h.call});try{await assert.rejects(bot.start(),failure==='mismatch'?/TELEGRAM_BOT_MISMATCH/:/TELEGRAM_WEBHOOK_CONFLICT/);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);assert.equal(h.calls.some(c=>c.method==='deleteWebhook'),false);}finally{await bot.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}}
 }finally{await jobs.close();store.close();}
});

test('one poller owns a bot lock; cancellation aborts polling and allows a new owner',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness(),first=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{}}),second=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{}});
 try{await first.start();await until(()=>h.calls.some(c=>c.method==='getUpdates'));await assert.rejects(second.start(),/TELEGRAM_UPDATES_CONFLICT/);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,process.pid);await first.close();assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);await second.start();assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,process.pid);await second.close();assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);}
 finally{await first.close();await second.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('provider polling conflict stops consumption and cleans the local lock',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),logs:string[]=[];let polls=0;const h=harness(async(method)=>{if(method==='getMe')return{is_bot:true,username:'YaplixBot'};if(method==='getWebhookInfo')return{url:''};if(method==='getUpdates'){polls++;throw new Fault('TELEGRAM_UPDATES_CONFLICT');}return true;});const bot=new TelegramBot(store,jobs,settings,{call:h.call,log:code=>logs.push(code)});
 try{await bot.start();await until(()=>logs.includes('TELEGRAM_UPDATES_CONFLICT'));await bot.close();assert.equal(polls,1);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('offset is persisted before uncertain send and prevents replay after a fresh poller',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env();let sends=0,polls=0;const receivedOffsets:number[]=[];
 const h=harness(async(method,body,signal)=>{if(method==='getMe')return{is_bot:true,username:'YaplixBot'};if(method==='getWebhookInfo')return{url:''};if(method==='getUpdates'){receivedOffsets.push(Number(body.offset));return ++polls<=2?[{...update('/start'),update_id:41}]:idle(signal);}if(method==='sendMessage'){sends++;assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.offset,42);throw Error('uncertain delivery');}return true;});
 let bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{}});
 try{await bot.start();await until(()=>sends===1);await bot.close();bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{}});await bot.start();await until(()=>polls>=3);assert.equal(sends,1);assert.deepEqual(receivedOffsets,[0,42,42]);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('corrupt persisted offset fails closed and does not claim the consumer',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness(),bot=new TelegramBot(store,jobs,settings,{call:h.call});const db=new DatabaseSync(statePath(settings.TELEGRAM_BOT_TOKEN));db.exec('CREATE TABLE consumer(slot INTEGER PRIMARY KEY CHECK(slot=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL,offset INTEGER NOT NULL CHECK(offset>=0)) STRICT; PRAGMA user_version=1; PRAGMA ignore_check_constraints=ON');db.prepare("INSERT INTO consumer VALUES(1,0,'',-1)").run();db.close();
 try{await assert.rejects(bot.start(),/TELEGRAM_OFFSET_INVALID/);assert.equal(h.calls.length,0);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('unknown polling state is preserved rather than replaced',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness(),bot=new TelegramBot(store,jobs,settings,{call:h.call});const db=new DatabaseSync(statePath(settings.TELEGRAM_BOT_TOKEN));db.exec('CREATE TABLE unknown_user_data(value TEXT)');db.prepare('INSERT INTO unknown_user_data VALUES(?)').run('preserve');db.close();
 try{await assert.rejects(bot.start(),/TELEGRAM_STATE_INVALID/);await bot.close();assert.equal(h.calls.length,0);const saved=new DatabaseSync(statePath(settings.TELEGRAM_BOT_TOKEN),{readOnly:true});try{assert.equal(saved.prepare('SELECT value FROM unknown_user_data').get()?.value,'preserve');}finally{saved.close();}}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('env-only public URL cannot authorize HTTPS links or trigger a health request',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env({PUBLIC_URL:'https://unowned.test'}),h=harness(),bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{}});let fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('NO_ENV_ONLY_NETWORK');});
 try{await bot.start();await bot.handle(update('/start'));assert.equal(fetches,0);assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('a matching runtime endpoint can activate after startup and lease revocation removes links',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness();let endpoint:{origin:string;instance:string}|undefined;
 const bot=new TelegramBot(store,jobs,settings,{call:h.call,log:()=>{},publicEndpoint:()=>endpoint});
 t.mock.method(globalThis,'fetch',async()=>Response.json({app:'YAPLIX',protocol:1,ready:true,instance:'this-runtime'}));
 try{await bot.start();await bot.handle(update('/new'));assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);endpoint={origin:'https://current.test',instance:'this-runtime'};await bot.handle(update('/new'));assert.ok(JSON.stringify(h.calls.at(-1)!.body).includes('https://current.test/telegram?view=create'));endpoint=undefined;await bot.handle(update('/new'));assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('health from another runtime or revoked while awaiting fetch cannot authorize links',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness();let endpoint:{origin:string;instance:string}|undefined={origin:'https://current.test',instance:'owned'};let revoke=false;
 const bot=new TelegramBot(store,jobs,settings,{call:h.call,publicEndpoint:()=>endpoint});
 t.mock.method(globalThis,'fetch',async()=>{if(revoke)endpoint=undefined;return Response.json({app:'YAPLIX',protocol:1,ready:true,instance:revoke?'owned':'another-runtime'});});
 try{await bot.handle(update('/games'));assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);revoke=true;await bot.handle(update('/new'));assert.equal(JSON.stringify(h.calls.at(-1)!.body).includes('web_app'),false);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('menu readback mismatch is logged while polling and a safe start reply remain available',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness(),logs:string[]=[];let menuWrites=0,endpoint:{origin:string;instance:string}|undefined={origin:'https://owned.test',instance:'owned'};
 const call:BotCall=async(method,body,signal)=>{if(method==='getChatMenuButton')return{type:'commands'};if(method==='setChatMenuButton'){menuWrites++;return true;}return h.call(method,body,signal);};
 const bot=new TelegramBot(store,jobs,settings,{call,publicEndpoint:()=>endpoint,log:code=>logs.push(code)});
 t.mock.method(globalThis,'fetch',async()=>Response.json({app:'YAPLIX',protocol:1,ready:true,instance:'owned'}));
 try{await bot.start();assert.equal(menuWrites,1);assert.ok(logs.includes('TELEGRAM_MENU_VERIFY_FAILED'));assert.ok(logs.includes('TELEGRAM_POLLING_READY'));assert.equal(h.calls.some(c=>c.method==='getUpdates'),true);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,process.pid);
  endpoint=undefined;await bot.handle(update('/start'));const reply=h.calls.findLast(c=>c.method==='sendMessage')!.body;assert.match(String(reply.text),/YAPLIX/);assert.match(String(reply.text),/проверенный публичный HTTPS/);assert.equal(JSON.stringify(reply).includes('web_app'),false);await bot.close();assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);
 }
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('command registration and menu API failure cannot silence a polled start message',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),logs:string[]=[],sent:Record<string,unknown>[]=[];let polls=0;
 const call:BotCall=async(method,body,signal)=>{if(method==='getMe')return{is_bot:true,username:'YaplixBot'};if(method==='getWebhookInfo')return{url:''};if(method==='setMyCommands')return false;if(method==='getChatMenuButton')throw new Fault('TELEGRAM_API_UNAVAILABLE');if(method==='getUpdates')return ++polls===1?[{...update('/start'),update_id:12}]:idle(signal);if(method==='sendMessage'){sent.push(body);return true;}throw Error('UNEXPECTED_METHOD');};
 const bot=new TelegramBot(store,jobs,settings,{call,log:code=>logs.push(code)});
 try{await bot.start();await until(()=>sent.length===1);assert.ok(logs.includes('TELEGRAM_COMMANDS_VERIFY_FAILED'));assert.ok(logs.includes('TELEGRAM_API_UNAVAILABLE'));assert.ok(logs.includes('TELEGRAM_MENU_VERIFY_FAILED'));assert.ok(logs.includes('TELEGRAM_POLLING_READY'));assert.match(String(sent[0].text),/YAPLIX/);assert.match(String(sent[0].text),/YAPLIX.cmd/);assert.equal(JSON.stringify(sent[0]).includes('web_app'),false);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.offset,13);}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('failed stale-menu clearing is verified and logged without hiding the safe start response',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store),settings=env(),h=harness(),logs:string[]=[];let reads=0,writes=0;
 const call:BotCall=async(method,body,signal)=>{if(method==='getChatMenuButton'){reads++;return{type:'web_app',web_app:{url:'https://expired.test/telegram'}};}if(method==='setChatMenuButton'){writes++;assert.deepEqual(body,{menu_button:{type:'commands'}});return true;}return h.call(method,body,signal);};
 const bot=new TelegramBot(store,jobs,settings,{call,log:code=>logs.push(code)});
 try{await bot.start();await bot.handle(update('/start'));assert.equal(writes,2);assert.equal(reads,4);assert.equal(logs.filter(code=>code==='TELEGRAM_MENU_VERIFY_FAILED').length,2);const reply=h.calls.findLast(c=>c.method==='sendMessage')!.body;assert.match(String(reply.text),/проверенный публичный HTTPS/);assert.equal(JSON.stringify(reply).includes('expired.test'),false);assert.equal(JSON.stringify(reply).includes('web_app'),false);assert.ok(h.calls.some(c=>c.method==='getUpdates'));}
 finally{await bot.close();await jobs.close();store.close();cleanup(settings.TELEGRAM_BOT_TOKEN);}
});

test('two real local processes contend atomically for a stale consumer and preserve its offset',async()=>{
 const settings=env();const stalePid=2147483647;assert.throws(()=>process.kill(stalePid,0));
 const db=new DatabaseSync(statePath(settings.TELEGRAM_BOT_TOKEN));db.exec('CREATE TABLE consumer(slot INTEGER PRIMARY KEY CHECK(slot=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL,offset INTEGER NOT NULL CHECK(offset>=0)) STRICT; PRAGMA user_version=1');db.prepare("INSERT INTO consumer VALUES(1,?,'stale-fixture',73)").run(stalePid);db.close();
 const script=`
  const {Store}=await import(${JSON.stringify(new URL('../src/store.ts',import.meta.url).href)});
  const {GenerationJobs}=await import(${JSON.stringify(new URL('../src/jobs.ts',import.meta.url).href)});
  const {TelegramBot}=await import(${JSON.stringify(new URL('../src/telegram-bot.ts',import.meta.url).href)});
  const store=new Store(':memory:'),jobs=new GenerationJobs(store);let offset;
  const call=async(method,body,signal)=>{if(method==='getMe')return{is_bot:true,username:'YaplixBot'};if(method==='getWebhookInfo')return{url:''};if(method==='getChatMenuButton')return{type:'commands'};if(method==='getUpdates'){offset=body.offset;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('stop')),{once:true}));}return true;};
  const bot=new TelegramBot(store,jobs,JSON.parse(process.argv[1]),{call,log:()=>{}});
  const close=async()=>{await bot.close();await jobs.close();store.close();process.exit(0);};
  process.on('message',()=>void close());
  try{await bot.start();process.send({status:'ready',offset});}catch(error){process.send({status:'error',code:error.code});await close();}
 `;
 const children=[0,1].map(()=>spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(settings)],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}));
 try{const outcomes=await Promise.all(children.map(child=>new Promise<{status:string;offset?:number;code?:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CHILD_READY_TIMEOUT')),5000);child.once('message',message=>{clearTimeout(timer);resolve(message as {status:string;offset?:number;code?:string});});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('CHILD_EXIT_BEFORE_READY_'+code));});})));
  assert.equal(outcomes.filter(x=>x.status==='ready').length,1);assert.equal(outcomes.find(x=>x.status==='ready')!.offset,73);assert.equal(outcomes.filter(x=>x.code==='TELEGRAM_UPDATES_CONFLICT').length,1);assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.offset,73);
 }finally{await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const exited=once(child,'exit');if(child.connected)child.send('close');else child.kill();await exited;}));assert.equal(state(settings.TELEGRAM_BOT_TOKEN)?.pid,0);cleanup(settings.TELEGRAM_BOT_TOKEN);}
});
