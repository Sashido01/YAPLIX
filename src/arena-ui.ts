import {mountGame} from './runtime.ts';
import type {GameEvent} from './contracts.ts';
import {arenaEl as el,arenaRequest as request,renderBoard} from './arena-view.ts';
const base=location.pathname, invite=location.hash.slice(1);
history.replaceState(null,'',base);
let unmount:(()=>void)|undefined, timer:ReturnType<typeof setTimeout>|undefined, expiry:ReturnType<typeof setTimeout>|undefined, watchdog:ReturnType<typeof setTimeout>|undefined;
let version:{html:string;versionId:string;sha256:string;title:string;expiresAt:number}|undefined;
let stopped=false, starting=false, posting=false, failed=false, epoch=0, ready=false, completed=false;
let queue:GameEvent[]=[], session:{token:string;sessionId:string;versionId:string;expiresAt:number}|undefined;
function dispose(){epoch++;unmount?.();unmount=undefined;clearTimeout(expiry);clearTimeout(watchdog);queue=[];session=undefined;}
function stop(message:string,closed=false){dispose();failed=false;el('retry-event').hidden=true;el('attempt-status').textContent=message;el<HTMLButtonElement>('attempt').disabled=closed||!version||Date.now()>=version.expiresAt;}
async function board(){if(stopped)return;try{const data=await(await request(base+'/results')).json();if(!stopped)renderBoard(data);}catch(error){el('board-status').textContent='Рейтинг не обновлён: '+(error as Error).message;}finally{if(!stopped)timer=setTimeout(()=>void board(),2000);}}
async function flush(expectedEpoch:number){
  if(posting||failed)return;posting=true;
  try{while(queue.length&&session&&expectedEpoch===epoch){const event=queue[0], token=session.token;
    await request(base+'/events','POST',event,token);
    if(expectedEpoch!==epoch)return;queue.shift();
    if(event.type==='game_ready'){ready=true;clearTimeout(watchdog);el('attempt-status').textContent='Игра подключена. Начните партию в игровом поле.';}
    if(event.type==='game_started')el('attempt-status').textContent='Партия идёт. Результат появится после завершения.';
    if(event.type==='session_ended'){completed=true;clearTimeout(expiry);expiry=setTimeout(()=>stop('Доступ к комнате истёк. Завершённый результат сохранён.',true),Math.max(0,version!.expiresAt-Date.now()));el('attempt-status').textContent='Завершённый результат сохранён. Личный рекорд меняется только при улучшении.';el<HTMLButtonElement>('attempt').textContent='Новая попытка';void request(base+'/results').then(r=>r.json()).then(renderBoard).catch(()=>{});}
    if(event.type==='game_error'){stop('Игра сообщила об ошибке. Попытка не засчитана.');break;}
  }}catch(error){if(expectedEpoch===epoch){failed=true;el('attempt-status').textContent='Событие не подтверждено. Проверьте рейтинг или повторите отправку: '+(error as Error).message;el('retry-event').hidden=false;}}
  finally{posting=false;if(expectedEpoch!==epoch&&queue.length&&!failed)void flush(epoch);}
}
async function start(){
  if(starting||stopped||!version)return;starting=true;el<HTMLButtonElement>('attempt').disabled=true;
  dispose();failed=false;completed=false;ready=false;el('retry-event').hidden=true;
  const current=epoch;
  try{
    const result=await(await request(base+'/attempts','POST',{})).json();if(stopped||current!==epoch)return;
    if(result.versionId!==version.versionId||result.sha256!==version.sha256)throw new Error('Версия игры не совпадает с комнатой.');
    session=result;
    unmount=mountGame(el('game'),version.html,{sessionId:result.sessionId,versionId:result.versionId},event=>{
      if(current!==epoch||stopped)return;
      if(queue.length>=128){stop('Слишком много событий игры. Попытка не подтверждена.');return;}
      queue.push(event);void flush(current);
    });
    el('attempt-status').textContent='Ожидание игрового bridge…';
    watchdog=setTimeout(()=>{if(!ready&&!completed&&current===epoch)el('attempt-status').textContent='Контракт этой игры не подтверждён: нет game_ready. Рейтинг недоступен, очки не засчитаны.';},10_000);
    expiry=setTimeout(()=>stop('Время попытки истекло. Незавершённая партия не засчитана.'),Math.max(0,result.expiresAt-Date.now()));
  }catch(error){el('attempt-status').textContent=(error as Error).message;}
  finally{starting=false;if(!stopped)el<HTMLButtonElement>('attempt').disabled=false;}
}
async function enter(identity:{nickname:string}){
  version=await(await request(base+'/version')).json();if(stopped)return;
  el('identity').textContent=identity.nickname;el('title').textContent=version!.title;
  el('status').textContent='В комнате используется одна неизменяемая версия игры. Каждая партия независима.';
  el('join').hidden=true;el('play').hidden=false;el('leaderboard').hidden=false;
  el('attempt-status').textContent='Заявлен контракт score-v1. Счёт ещё не подтверждён. Нажмите «Начать попытку».';
  void board();
}
el<HTMLFormElement>('join').addEventListener('submit',event=>{event.preventDefault();if(starting)return;starting=true;const button=el<HTMLFormElement>('join').querySelector('button')!;button.disabled=true;void(async()=>{try{const me=await(await request(base+'/join','POST',{invite,nickname:el<HTMLInputElement>('nickname').value})).json();await enter(me);}catch(error){el('status').textContent=(error as Error).message;}finally{starting=false;button.disabled=false;}})();});
el('attempt').addEventListener('click',()=>void start());
el('retry-event').addEventListener('click',()=>{failed=false;el('retry-event').hidden=true;void flush(epoch);});
el('leave').addEventListener('click',()=>{dispose();el('attempt-status').textContent='Игра остановлена. Незавершённая партия не засчитана.';});
window.addEventListener('pagehide',()=>{stopped=true;dispose();clearTimeout(timer);});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void(async()=>{try{await enter(await(await request(base+'/me')).json());}catch{el('join').hidden=false;el('status').textContent=invite?'Введите ник. Один и тот же QR подходит всем участникам.':'Отсканируйте QR ведущего. Если вы уже входили, проверьте связь и обновите страницу.';}})();
