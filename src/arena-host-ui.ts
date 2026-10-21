import {arenaDeclared} from './arena-contract.ts';
import {mountLanSetup,selectLanAddress} from './lan-setup-ui.ts';
import {arenaEl as el,arenaRequest as request,renderBoard} from './arena-view.ts';
const versionId=new URL(location.href).searchParams.get('versionId');
mountLanSetup(document.querySelector('main')!);
el('network').addEventListener('change',()=>selectLanAddress(el<HTMLSelectElement>('network').value));
let busy=false, image:string|undefined, timer:ReturnType<typeof setTimeout>|undefined, stopped=false, selected='';
function release(){if(image)URL.revokeObjectURL(image);image=undefined;el<HTMLImageElement>('qr').removeAttribute('src');el('invite').hidden=true;}
async function run(work:()=>Promise<void>){if(busy)return;busy=true;for(const id of ['start','stop','refresh','rooms','network'])el<HTMLButtonElement>(id).disabled=true;try{await work();}catch(error){el('status').textContent=(error as Error).message;}finally{busy=false;for(const id of ['start','refresh','rooms','network'])el<HTMLButtonElement>(id).disabled=false;}}
async function refresh(){
  const data=await(await request('/api/arena?versionId='+encodeURIComponent(versionId!))).json();
  if(stopped)return;
  const rooms=el<HTMLSelectElement>('rooms'), network=el<HTMLSelectElement>('network'),previous=network.value;
  rooms.replaceChildren(new Option('Новая комната',''));
  for(const r of data.rooms)rooms.add(new Option(r.roomId.slice(0,8)+' · '+r.players.length+' участников'+(r.open?' · открыта':' · сохранена'),r.roomId));
  if(data.rooms.some((r:{roomId:string})=>r.roomId===selected))rooms.value=selected;
  network.replaceChildren();if(data.networks.length>1)network.add(new Option('Выберите частную сеть',''));
  for(const n of data.networks)network.add(new Option(n.name+' · '+n.address,n.address));
  if(data.networks.some((n:{address:string})=>n.address===previous))network.value=previous;
  selectLanAddress(network.value);
  const state=data.status;el<HTMLButtonElement>('stop').disabled=!state.enabled;
  if(state.enabled&&state.versionId===versionId){
    selected=state.roomId;rooms.value=selected;
    if(el<HTMLInputElement>('url').value!==state.url||!image){release();const response=await request('/api/arena/qr.svg');image=URL.createObjectURL(await response.blob());el<HTMLImageElement>('qr').src=image;el<HTMLInputElement>('url').value=state.url;}
    el('invite').hidden=false;el('status').textContent='Arena доступна до '+new Date(state.expiresAt).toLocaleTimeString()+'. Страница проверена с компьютера; подключение физических телефонов этим не подтверждено.';
  }else{release();el('status').textContent=state.enabled?'Сейчас открыта другая версия. Запуск этой комнаты отключит прежний вход.':'Комната не запущена. Можно возобновить сохранённую или создать новую.';}
  el<HTMLButtonElement>('start').textContent=selected?'Возобновить комнату':'Запустить новую Arena';
  if(selected)renderBoard(await(await request('/api/arena/rooms/'+selected)).json());
}
async function poll(){if(stopped)return;try{if(selected){const board=await(await request('/api/arena/rooms/'+selected)).json();renderBoard(board);const option=Array.from(el<HTMLSelectElement>('rooms').options).find(o=>o.value===board.roomId);if(option)option.textContent=board.roomId.slice(0,8)+' · '+board.players.length+' участников'+(board.open?' · открыта':' · сохранена');if(!board.open){release();el<HTMLButtonElement>('stop').disabled=true;}}}catch(error){el('board-status').textContent='Рейтинг не обновлён: '+(error as Error).message;}finally{if(!stopped)timer=setTimeout(()=>void poll(),2000);}}
el('rooms').addEventListener('change',()=>{selected=el<HTMLSelectElement>('rooms').value;el<HTMLButtonElement>('start').textContent=selected?'Возобновить комнату':'Запустить новую Arena';if(selected)void run(async()=>renderBoard(await(await request('/api/arena/rooms/'+selected)).json()));else{el('scores').replaceChildren();el('board-status').textContent='Новая комната начнётся без результатов.';}});
el('start').addEventListener('click',()=>void run(async()=>{const address=el<HTMLSelectElement>('network').value;if(!address)throw new Error('Выберите частную сеть участников.');const result=await(await request('/api/arena','POST',{versionId,address,...(selected?{roomId:selected}:{})})).json();selected=result.roomId;await refresh();}));
el('stop').addEventListener('click',()=>void run(async()=>{await request('/api/arena','DELETE',{});await refresh();}));
el('refresh').addEventListener('click',()=>void run(refresh));
el('copy').addEventListener('click',()=>{const input=el<HTMLInputElement>('url');input.focus();input.select();void navigator.clipboard?.writeText(input.value).catch(()=>{});});
el('screen').addEventListener('click',()=>{if(document.fullscreenElement)void document.exitFullscreen();else void el('leaderboard').requestFullscreen?.().catch(()=>{el('board-status').textContent='Полноэкранный режим недоступен в этом браузере.';});});
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);release();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void run(async()=>{
  if(!versionId)throw new Error('Откройте сохранённую игру в YAPLIX и нажмите «Общий рейтинг».');
  const version=await(await request('/api/versions/'+encodeURIComponent(versionId))).json();
  el('title').textContent=version.spec.prompt;el('version').textContent='versionId: '+version.versionId+' · SHA256: '+version.sha256;
  if(!arenaDeclared(version.html))throw new Error('Рейтинг недоступен для этой версии. Нужна Arena-совместимая версия. Для локального демо откройте авторскую игру «Arena: Меткий бросок» в библиотеке.');
  el('setup').hidden=false;await refresh();void poll();
});
