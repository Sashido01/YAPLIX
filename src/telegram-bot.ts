import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Fault} from './contracts.ts';
import {boundedText} from './transport.ts';
import {managedPath} from './store.ts';
import type {Store} from './store.ts';
import type {GenerationJobs} from './jobs.ts';

export type BotCall=(method:string,body:Record<string,unknown>,signal:AbortSignal)=>Promise<any>;
const commands=[['start','Открыть YAPLIX'],['games','Мои игры'],['new','Создать игру'],['status','Статус генерации'],['help','Помощь']].map(([command,description])=>({command,description}));
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH';}};

// A transactionally claimed consumer per bot on this checkout, independent of
// game database/port. The state contains only ownership and update offset.
export class TelegramBot {
  private stopSignal=new AbortController();private running?:Promise<void>;private nonce=randomUUID();private offset=0;private state?:DatabaseSync;private publicEndpoint?:()=>{origin:string;instance:string}|undefined;
  private token:string;private owner:number;private username:string;private url?:string;private call:BotCall;private log:(code:string)=>void;
  private store:Store;private jobs:GenerationJobs;
  constructor(store:Store,jobs:GenerationJobs,env:NodeJS.ProcessEnv=process.env,options:{call?:BotCall;log?:(code:string)=>void;publicEndpoint?:()=>{origin:string;instance:string}|undefined}={}){
    this.store=store;this.jobs=jobs;
    this.token=env.TELEGRAM_BOT_TOKEN??'';const ids=(env.TELEGRAM_ALLOWED_USER_IDS??'').split(',').map(v=>v.trim()).filter(Boolean);
    this.owner=ids.length===1&&/^\d+$/.test(ids[0])?Number(ids[0]):0;this.username=(env.TELEGRAM_BOT_USERNAME??'YaplixBot').replace(/^@/,'');
    this.publicEndpoint=options.publicEndpoint;
    this.log=options.log??(code=>console.log(code));
    this.call=options.call??(async(method,body,signal)=>{
      const response=await fetch('https://api.telegram.org/bot'+this.token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(method==='getUpdates'?32000:8000)]),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=JSON.parse(await boundedText(response,256000));
      if(!response.ok||data.ok!==true)throw new Fault(response.status===409||data.error_code===409?'TELEGRAM_UPDATES_CONFLICT':response.status===401?'TELEGRAM_TOKEN_REJECTED':'TELEGRAM_API_UNAVAILABLE',503);
      return data.result;
    });
  }
  private acquire(){
    const hash=createHash('sha256').update(this.token).digest('hex').slice(0,24),path=managedPath('.local/telegram/consumer-'+hash+'.sqlite');
    this.state=new DatabaseSync(path);this.state.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    try{
      const version=this.state.prepare('PRAGMA user_version').get()?.user_version;
      if(version===0){if(this.state.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())throw new Fault('TELEGRAM_STATE_INVALID');this.state.exec('CREATE TABLE consumer(slot INTEGER PRIMARY KEY CHECK(slot=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL,offset INTEGER NOT NULL CHECK(offset>=0)) STRICT; PRAGMA user_version=1');}
      else if(version!==1)throw new Fault('TELEGRAM_STATE_INVALID');
      const row=this.state.prepare('SELECT pid,offset FROM consumer WHERE slot=1').get();
      if(row&&Number(row.pid)>0&&alive(Number(row.pid)))throw new Fault('TELEGRAM_UPDATES_CONFLICT');
      this.offset=Number(row?.offset??0);if(!Number.isSafeInteger(this.offset)||this.offset<0)throw new Fault('TELEGRAM_OFFSET_INVALID');
      this.state.prepare('INSERT INTO consumer VALUES(1,?,?,?) ON CONFLICT(slot) DO UPDATE SET pid=excluded.pid,nonce=excluded.nonce').run(process.pid,this.nonce,this.offset);this.state.exec('COMMIT');
    }catch(error){this.state.exec('ROLLBACK');this.state.close();this.state=undefined;throw error;}
  }
  private release(){if(this.state){try{this.state.prepare("UPDATE consumer SET pid=0,nonce='' WHERE slot=1 AND nonce=?").run(this.nonce);}finally{this.state.close();this.state=undefined;}}}
  private async refreshUrl(){
    this.url=undefined;const endpoint=this.publicEndpoint?.();if(!endpoint)return;
    try{const url=new URL(endpoint.origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)return;
      const response=await fetch(new URL('/healthz',url),{redirect:'error',signal:AbortSignal.any([this.stopSignal.signal,AbortSignal.timeout(3000)])});const health=JSON.parse(await boundedText(response,2048));
      const current=this.publicEndpoint?.();if(response.ok&&health.app==='YAPLIX'&&health.protocol===1&&health.ready===true&&health.instance===endpoint.instance&&current?.origin===endpoint.origin&&current.instance===endpoint.instance)this.url=url.origin;
    }catch{/* The text bot remains available without a healthy matching tunnel. */}
  }
  private async syncMenu(){
    const signal=this.stopSignal.signal,current=await this.call('getChatMenuButton',{},signal),url=this.url?new URL('/telegram',this.url).href:undefined;
    if(url){if(current.type!=='web_app'||current.web_app?.url!==url){await this.call('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url}}},signal);const checked=await this.call('getChatMenuButton',{},signal);if(checked.type!=='web_app'||checked.web_app?.url!==url)throw new Fault('TELEGRAM_MENU_VERIFY_FAILED');}}
    else if(current.type==='web_app'){await this.call('setChatMenuButton',{menu_button:{type:'commands'}},signal);if((await this.call('getChatMenuButton',{},signal)).type!=='commands')throw new Fault('TELEGRAM_MENU_VERIFY_FAILED');}
  }
  async start(){
    if(this.running)return;
    if(!/^\d+:[A-Za-z0-9_-]+$/.test(this.token)||!Number.isSafeInteger(this.owner)||this.owner<=0)throw new Fault('TELEGRAM_SINGLE_OWNER_REQUIRED');
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION');
    try{
      this.acquire();const signal=this.stopSignal.signal,me=await this.call('getMe',{},signal);
      if(me.is_bot!==true||me.username?.toLowerCase()!==this.username.toLowerCase())throw new Fault('TELEGRAM_BOT_MISMATCH');
      const webhook=await this.call('getWebhookInfo',{},signal);if(webhook.url)throw new Fault('TELEGRAM_WEBHOOK_CONFLICT');
      try{if(await this.call('setMyCommands',{commands},signal)!==true)throw new Fault('TELEGRAM_COMMANDS_VERIFY_FAILED');}catch(error){if(signal.aborted)throw error;this.log(error instanceof Fault?error.code:'TELEGRAM_API_UNAVAILABLE');}
      signal.throwIfAborted();await this.refreshUrl();try{await this.syncMenu();}catch(error){if(signal.aborted)throw error;this.log(error instanceof Fault?error.code:'TELEGRAM_MENU_VERIFY_FAILED');}signal.throwIfAborted();
      this.log('TELEGRAM_POLLING_READY');this.running=this.poll();
    }catch(error){this.release();throw error instanceof Fault?error:new Fault('TELEGRAM_API_UNAVAILABLE',503);}
  }
  private persistOffset(offset:number){if(!this.state||this.state.prepare('UPDATE consumer SET offset=? WHERE slot=1 AND nonce=? AND pid=?').run(offset,this.nonce,process.pid).changes!==1)throw new Fault('TELEGRAM_UPDATES_CONFLICT');this.offset=offset;}
  private async poll(){
    let failures=0;
    try{while(!this.stopSignal.signal.aborted){
      try{const updates=await this.call('getUpdates',{offset:this.offset,timeout:25,limit:20,allowed_updates:['message','callback_query']},this.stopSignal.signal);
        if(!Array.isArray(updates)||updates.length>20)throw new Fault('TELEGRAM_UPDATES_INVALID');failures=0;
        for(const update of updates){if(!Number.isSafeInteger(update.update_id)||update.update_id<0||update.update_id<this.offset)continue;
          // Claim before sending. A crash may lose a reply, never replay it.
          this.persistOffset(update.update_id+1);await this.handle(update);
        }
      }catch(error){if(this.stopSignal.signal.aborted)break;const code=error instanceof Fault?error.code:'TELEGRAM_API_UNAVAILABLE';this.log(code);if(['TELEGRAM_UPDATES_CONFLICT','TELEGRAM_TOKEN_REJECTED'].includes(code))break;
        failures++;await new Promise<void>(done=>{const finish=()=>{clearTimeout(timer);this.stopSignal.signal.removeEventListener('abort',finish);done();};const timer=setTimeout(finish,Math.min(60000,1000*2**Math.min(failures,6)));this.stopSignal.signal.addEventListener('abort',finish,{once:true});});
      }
    }}finally{this.release();}
  }
  async handle(update:any){
    const message=update.message??update.callback_query?.message,user=update.message?.from??update.callback_query?.from;
    if(message?.chat?.type!=='private'||message.chat.id!==this.owner||user?.id!==this.owner||user.is_bot)return;
    await this.refreshUrl();try{await this.syncMenu();}catch{this.log('TELEGRAM_MENU_VERIFY_FAILED');}
    const text=String(update.message?.text??update.callback_query?.data??'').slice(0,256),command=text.split(/\s/)[0].split('@')[0].toLowerCase();
    if(update.callback_query?.id)await this.call('answerCallbackQuery',{callback_query_id:update.callback_query.id},this.stopSignal.signal);
    const isGames=['/games','играть','мои'].includes(command),isStatus=['/status','статус'].includes(command),isNew=['/new','создать'].includes(command);
    let reply:string;const links:{text:string;web_app:{url:string}}[][]=[];
    const link=(label:string,path='')=>{if(this.url)links.push([{text:label,web_app:{url:new URL('/telegram'+path,this.url).href}}]);};
    if(isGames){const games=this.store.list().slice(0,8);reply=games.length?'Ваши игры:\n'+games.map((g,i)=>(i+1)+'. '+String(g.title??g.spec.prompt).slice(0,100)).join('\n'):'В библиотеке пока нет игр. Нажмите «Создать игру».';for(const game of games)link(String(game.title??game.spec.prompt).slice(0,50),'?game='+game.gameId+'&version='+game.versionId);}
    else if(isStatus){const jobs=[...this.jobs.list(String(this.owner)),...this.jobs.list('owner')].slice(0,8);const stages:Record<string,string>={queued:'В очереди',generating:'Генерация',repairing:'Исправление',validating:'Проверка',completed:'Готово',needs_attention:'Нужно действие',cancelled:'Отменено',failed:'Ошибка'};reply=jobs.length?jobs.map(j=>String(j.spec.prompt).slice(0,80)+' — '+(stages[j.stage]??j.stage)+(j.recoveryState==='waiting_for_provider'?' (ожидание провайдера)':'')).join('\n'):'Активных и сохранённых заданий пока нет.';link('Статус');}
    else if(isNew){reply='Опишите игру в Mini App и нажмите «Создать». Генерация идёт в фоне; можно играть в другую игру.';link('Создать игру','?view=create');}
    else{reply='YAPLIX создаёт мобильные игры по вашему описанию. Можно играть, сохранять версии и скачивать HTML для игры без сети.\n/games — мои игры\n/new — создать\n/status — генерация\n/help — помощь';link('Играть');link('Создать игру','?view=create');}
    if(!this.url)reply+='\nMini App сейчас недоступна: серверу нужен проверенный публичный HTTPS. Бот продолжает отвечать; на компьютере откройте YAPLIX.cmd. На телефоне установка Node.js и Ollama не нужна.';
    const keyboard={keyboard:[[{text:'Играть'},{text:'Мои игры'}],[{text:'Создать игру'},{text:'Статус'}]],resize_keyboard:true};
    const inline:unknown[][]=[...links];if(this.url){inline.push([{text:'Мои игры',callback_data:'/games'},{text:'Статус',callback_data:'/status'}]);if(!isNew)inline.push([{text:'Создать игру',web_app:{url:new URL('/telegram?view=create',this.url).href}}]);}
    await this.call('sendMessage',{chat_id:this.owner,text:reply.slice(0,3800),reply_markup:links.length?{inline_keyboard:inline}:keyboard},this.stopSignal.signal);
  }
  async close(){this.stopSignal.abort();await this.running;this.release();}
}
