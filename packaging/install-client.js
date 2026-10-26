const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const status=document.querySelector('#status'),error=document.querySelector('#error'),retry=document.querySelector('#retry'),open=document.querySelector('#open');
const order=['CHECK','PREPARE','INSTALL','VERIFY','LAUNCH'];let finished=false;
async function request(path,method='GET'){const r=await fetch(path,{method,headers:{'X-Yaplix-Installer':token}});if(!r.ok)throw Error('request');return r.json();}
async function start(){error.hidden=true;retry.hidden=true;finished=false;try{await request('/api/start','POST');poll();}catch{error.textContent='Не удалось связаться с установщиком. Запустите установочный файл повторно.';error.hidden=false;}}
async function poll(){
 try{const state=await request('/api/status');const active=state.stage==='PLAN'?'CHECK':state.stage;const n=order.indexOf(active);
 for(const [i,li] of [...document.querySelectorAll('li')].entries()){li.classList.toggle('done',state.stage==='DONE'||n>i);if(i===n)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}
 status.textContent=state.stage==='DONE'?'Готово. YAPLIX запускается.':state.stage==='ROLLBACK'?'Сохраняем предыдущую версию…':state.facts?`ОС: ${state.facts.osVersion} · ${state.facts.architecture}. ${state.stage==='VERIFY'?'Проверяем API, интерфейс и защищённый браузер…':'Пожалуйста, подождите.'}`:'Проверяем установленную ОС и необходимые компоненты…';
 if(state.stage==='ERROR'){error.textContent=state.message;error.hidden=false;retry.hidden=false;retry.focus();finished=true;return;}
 if(state.stage==='DONE'&&/^http:\/\/127\.0\.0\.1:\d+\/$/.test(state.url)){open.href=state.url;open.hidden=false;finished=true;setTimeout(()=>location.replace(state.url),1200);return;}
 }catch{status.textContent='Связь с установщиком потеряна. Повторно запустите установочный файл; предыдущая версия и данные сохраняются.';finished=true;}
 if(!finished)setTimeout(poll,500);
}
retry.addEventListener('click',start);start();
