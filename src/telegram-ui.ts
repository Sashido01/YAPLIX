type WebApp={initData:string;themeParams:Record<string,string>;safeAreaInset?:Record<string,number>;contentSafeAreaInset?:Record<string,number>;viewportHeight:number;viewportStableHeight:number;ready():void;expand():void;onEvent(name:string,cb:()=>void):void;offEvent(name:string,cb:()=>void):void;BackButton:{show():void;hide():void;onClick(cb:()=>void):void;offClick(cb:()=>void):void};};
export async function initializeTelegram(){
  const app=(window as typeof window&{Telegram?:{WebApp?:WebApp}}).Telegram?.WebApp;
  if(!app?.initData)throw new Error('Откройте Mini App через собственного бота YAPLIX. Telegram-авторизация отсутствует.');
  const response=await fetch('/api/telegram/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:app.initData}),signal:AbortSignal.timeout(10000)});
  if(!response.ok){const data=await response.json();throw new Error(data.error==='TELEGRAM_USER_FORBIDDEN'?'Этот Telegram-пользователь не включён владельцем в список доступа.':data.error==='TELEGRAM_NOT_CONFIGURED'?'Бот ещё не настроен на сервере.':'Telegram-авторизация не принята. Закройте Mini App и откройте заново.');}
  // Keep signed initData only in SDK memory, never game URLs, logs, DOM or storage.
  history.replaceState(null,'',location.pathname+location.search);
  const {sessionToken}=await response.json();if(typeof sessionToken!=='string'||!/^[0-9a-f]{64}$/.test(sessionToken))throw new Error('Telegram session unavailable');
  const adapt=()=>{
    const colors={bg_color:'--page',text_color:'--text',secondary_bg_color:'--panel',button_color:'--accent'};
    for(const[k,v]of Object.entries(colors)){const color=app.themeParams[k];if(/^#[0-9a-f]{6}$/i.test(color??''))document.documentElement.style.setProperty(v,color);}
    for(const side of ['top','right','bottom','left']){const value=Math.max(app.safeAreaInset?.[side]??0,app.contentSafeAreaInset?.[side]??0);if(Number.isFinite(value)&&value>=0&&value<=200)document.documentElement.style.setProperty('--tg-safe-'+side,value+'px');}
    if(app.viewportHeight>0)document.documentElement.style.setProperty('--app-height',app.viewportHeight+'px');
  };
  const back=()=>{document.querySelector<HTMLButtonElement>('[data-view="library"]')?.click();};
  app.ready();app.expand();adapt();app.BackButton.show();app.BackButton.onClick(back);
  for(const event of ['themeChanged','viewportChanged','safeAreaChanged','contentSafeAreaChanged'])app.onEvent(event,adapt);
  addEventListener('pagehide',()=>{for(const event of ['themeChanged','viewportChanged','safeAreaChanged','contentSafeAreaChanged'])app.offEvent(event,adapt);app.BackButton.offClick(back);},{once:true});
  return sessionToken;
}
