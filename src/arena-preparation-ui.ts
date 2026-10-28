import type {GameVersion} from './contracts.ts';
import {arenaDeclared} from './arena-contract.ts';
import {arenaEl as el,arenaRequest as request} from './arena-view.ts';

/** No network generation on navigation, compatibility check, goal entry or consent alone. */
export async function mountPreparation(version:GameVersion){
  const compatibility=await(await request('/api/arena/compatibility/'+version.versionId)).json();
  if(compatibility.metric)return false;
  el('prepare').hidden=false;el('leaderboard').hidden=true;
  el('status').textContent='Рейтинг недоступен для этой версии. Подготовьте отдельную Arena-версию; оригинал и история сохранятся.';
  el('preparation-note').textContent=compatibility.localPreparation?'Эту авторскую игру можно подготовить локально, без модели и изменения правил.':compatibility.goalRequired?'У игры нет измеримой турнирной цели. Опишите её явно: без цели результат не придумывается.':'У этой версии нет известного совместимого bridge. Для привязки реальных механик нужна отдельная LLM-доработка.';
  el('prepare-local').hidden=!compatibility.localPreparation;el('llm-preparation').hidden=compatibility.localPreparation;
  let working=false,timer:ReturnType<typeof setTimeout>|undefined,closed=false;
  const goal=el<HTMLTextAreaElement>('arena-goal'),consent=el<HTMLInputElement>('prepare-consent'),button=el<HTMLButtonElement>('prepare-llm'),provider=el<HTMLSelectElement>('prepare-provider');
  const sync=()=>{button.disabled=working||!consent.checked||goal.value.trim().length<10;goal.disabled=working;provider.disabled=working;consent.disabled=working;};
  goal.addEventListener('input',sync);consent.addEventListener('change',sync);sync();
  const key='yaplix-arena-preparation-'+version.versionId;
  let jobId:string|undefined;
  const showVersion=async(id:string)=>{const v=await(await request('/api/versions/'+id)).json();if(!arenaDeclared(v.html))throw Error('Новая версия сохранена, но bridge не заявлен. Откройте задания в YAPLIX и проверьте результат; соревнование не запущено.');location.assign('/arena?versionId='+encodeURIComponent(id));};
  async function poll(){
    if(!jobId||closed)return;
    try{
      const job=await(await request('/api/jobs/'+jobId)).json();
      if(job.stage==='completed'&&job.versionId){working=false;sessionStorage.removeItem(key);consent.checked=false;await showVersion(job.versionId);return;}
      if(['failed','cancelled','needs_attention'].includes(job.stage)){working=false;sessionStorage.removeItem(key);consent.checked=false;el('preparation-status').textContent='Подготовка остановлена: '+(job.errorCode??job.stage)+'. Оригинал сохранён. Диагностика — в списке заданий YAPLIX. Новая LLM-попытка требует нового согласия.';return;}
      const stage:Record<string,string>={queued:'в очереди',generating:'модель создаёт версию',validating:'локальная проверка',repairing:'доработка'};
      el('preparation-status').textContent='Подготовка новой версии: '+(stage[job.stage]??'ожидание')+'. Можно закрыть страницу; задание сохранено.';
      timer=setTimeout(()=>void poll(),2000);
    }catch(error){el('preparation-status').textContent=(error as Error).message;working=false;}
    finally{sync();}
  }
  el('prepare-local').addEventListener('click',()=>{if(working)return;working=true;el<HTMLButtonElement>('prepare-local').disabled=true;void(async()=>{try{const v=await(await request('/api/arena/prepare','POST',{versionId:version.versionId,mode:'local'})).json();await showVersion(v.versionId);}catch(error){el('preparation-status').textContent=(error as Error).message;working=false;el<HTMLButtonElement>('prepare-local').disabled=false;}})();});
  button.addEventListener('click',()=>{if(button.disabled)return;working=true;sync();void(async()=>{
    try{
      const fingerprint=JSON.stringify([goal.value.trim(),provider.value]);
      let pending;try{pending=JSON.parse(sessionStorage.getItem(key)??'null');}catch{}
      if(pending?.fingerprint!==fingerprint)pending={fingerprint,idempotencyKey:crypto.randomUUID()};
      sessionStorage.setItem(key,JSON.stringify(pending));
      const job=await(await request('/api/arena/prepare','POST',{versionId:version.versionId,mode:'llm',goal:goal.value.trim(),consent:true,providerMode:provider.value,idempotencyKey:pending.idempotencyKey})).json();
      jobId=job.jobId;sessionStorage.setItem(key,JSON.stringify({...pending,jobId,goal:goal.value.trim(),provider:provider.value}));await poll();
    }catch(error){el('preparation-status').textContent=(error as Error).message+' Проверьте список заданий YAPLIX перед повтором.';working=false;sync();}
  })();});
  window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);});
  try{const pending=JSON.parse(sessionStorage.getItem(key)??'null');if(pending?.jobId){jobId=pending.jobId;goal.value=pending.goal;provider.value=pending.provider;working=true;sync();void poll();}}catch{}
  return true;
}
