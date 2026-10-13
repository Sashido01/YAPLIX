import { Fault } from '../src/contracts.ts';
import { boundedText } from '../src/transport.ts';
const command=process.argv[2]??'check';
try {
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token||!/^\d+:[A-Za-z0-9_-]+$/.test(token))throw new Fault('TELEGRAM_TOKEN_REQUIRED');
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION');
  async function call(method:string,body?:object){
    const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    if(!response.ok){await response.body?.cancel();throw new Fault(response.status===401?'TELEGRAM_TOKEN_REJECTED':'TELEGRAM_API_UNAVAILABLE');}
    const result=JSON.parse(await boundedText(response,100000));if(result.ok!==true)throw new Fault('TELEGRAM_API_REJECTED');return result.result;
  }
  const me=await call('getMe');if(me.is_bot!==true||typeof me.username!=='string')throw new Fault('TELEGRAM_INVALID_BOT');
  const expected=process.env.TELEGRAM_BOT_USERNAME??'YaplixBot';
  if(me.username.toLowerCase()!==expected.replace(/^@/,'').toLowerCase())throw new Fault('TELEGRAM_BOT_MISMATCH');
  if(command==='id'){
    const updates=await call('getUpdates');
    const ids=[...new Set(updates.flatMap((update:any)=>update.message?.chat?.type==='private'&&Number.isSafeInteger(update.message.from?.id)?[update.message.from.id]:[]))];
    console.log(JSON.stringify({bot:'@'+me.username,privateSenderUserIds:ids,note:'Send /start to your own bot first, then identify your ID. No messages/content are printed or users admitted. Active webhook may prevent getUpdates.'}));
  }else if(command==='menu'){
    const url=new URL(process.env.PUBLIC_URL??'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Fault('TELEGRAM_HTTPS_REQUIRED');
    await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Открыть YAPLIX',web_app:{url:new URL('/telegram',url).href}}});
    console.log(JSON.stringify({bot:'@'+me.username,menuConfigured:true,url:new URL('/telegram',url).href}));
  }else if(command==='check'){
    const menu=await call('getChatMenuButton');
    const publicUrl=process.env.PUBLIC_URL;let httpsConfigured=false;try{httpsConfigured=!!publicUrl&&new URL(publicUrl).protocol==='https:';}catch{}
    const allowlist=(process.env.TELEGRAM_ALLOWED_USER_IDS??'').split(',').filter(id=>/^\d+$/.test(id.trim())).length;
    console.log(JSON.stringify({bot:'@'+me.username,tokenAccepted:true,httpsConfigured,allowedUsers:allowlist,menuType:menu.type,menuUrl:menu.web_app?.url??null}));
  }else throw new Fault('USAGE: npm run telegram:check | npm run telegram:id | npm run telegram:menu');
}catch(error){console.error(error instanceof Fault?error.code:'TELEGRAM_CHECK_FAILED');process.exitCode=1;}
