import { mountGame } from './runtime.ts';
import type { GameVersion, GameSpec, GameEvent } from './contracts.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = el<HTMLTextAreaElement>('prompt'), mode = el<HTMLSelectElement>('mode'), message = el('message');
let current: GameVersion | null = null, unmount: (() => void) | undefined, busy = false, action: AbortController | undefined;
const versions = new Map<string, GameVersion>(); // Bounded read cache, at most 3 × 200 KB HTML.
const errors: Record<string, string> = {
  BGEN_NOT_CONFIGURED:'LIVE не настроен. Откройте диагностику и настройте LLM по README.',
  BGEN_INSTALL_REQUIRED:'Для LIVE установите библиотеку BGen: npm run bgen:install.',
  LLM_MODEL_NOT_FOUND:'Модель отсутствует в Ollama. Установите выбранную модель.',
  LLM_BUSY:'Другая генерация ещё завершается. Повторите позже.',
  LLM_TIMEOUT:'Модель не ответила вовремя. Попробуйте уточнить запрос.',
  LLM_INVALID_RESPONSE:'Модель вернула неполный ответ. Игра не сохранена.',
  LLM_UNSAFE_ARTIFACT:'Модель вернула запрещённые зависимости. Уточните запрос.',
  LLM_HTTP:'LLM вернула ошибку. Проверьте запуск модели и её ресурсы.',
  LLM_NETWORK_OR_RESPONSE:'Не удалось получить полный ответ LLM. Проверьте Ollama.',
  BGEN_LIVE_CONTRACT_REQUIRED:'Удалённый BGen пока не поддерживает безопасный LIVE-контракт.',
  ACCESS_REQUIRED:'Доступ истёк. Обновите страницу и введите ключ сервера.',
  BACKUP_QUOTA:'Достигнут лимит копий. Сохраните нужные копии и освободите место по README.',
  BACKUP_BUSY:'Копия уже создаётся. Повторите позже.',
};
async function api(path: string, body?: unknown, token?: string, signal?: AbortSignal) {
  const deadline=new AbortController(),timer=signal?undefined:setTimeout(()=>deadline.abort(),10_000);
  try {
    const response = await fetch(path, { signal: signal ?? deadline.signal, ...(body !== undefined ? { method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token} : {})} } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(errors[data.error] ?? `Не удалось выполнить действие (${data.error ?? response.status}).`);
    el('connection').hidden = true; return data;
  } catch (error) {
    if ((error as Error).name === 'TypeError' || !signal && deadline.signal.aborted) { el('connection').hidden = false; throw new Error('Сервер недоступен. Проверьте связь и повторите действие.'); }
    throw error;
  } finally {clearTimeout(timer);}
}
function lock(value: boolean) {
  busy=value; el<HTMLButtonElement>('generate').disabled=value; el<HTMLButtonElement>('improve').disabled=value||!current; mode.disabled=value;
  el<HTMLSelectElement>('versions').disabled=value||!current;el<HTMLButtonElement>('replay').disabled=value||!current;
  el('cancel').hidden=!value; document.body.classList.toggle('waiting',value);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.disabled=value||button.dataset.view==='play'&&!current);
}
async function attempt(work: (signal: AbortSignal) => Promise<void>, generating = false) {
  if (busy) return; lock(true); action=new AbortController(); const controller=action;
  const timeout=setTimeout(()=>controller.abort('timeout'), generating ? 330_000 : 15_000), began=performance.now();
  const progress=generating?setInterval(()=>{if(!controller.signal.aborted)message.textContent=`Модель создаёт игру… ${Math.floor((performance.now()-began)/1000)} с. Можно отменить ожидание.`;},1000):undefined;
  try { await work(controller.signal); }
  catch (error) { message.textContent=controller.signal.aborted ? controller.signal.reason==='timeout'?'Ожидание истекло. Повторите действие.':'Ожидание отменено. Проверьте список сохранённых игр.' : (error as Error).message; }
  finally { clearTimeout(timeout); clearInterval(progress); if(action===controller)action=undefined; lock(false); }
}
el('cancel').addEventListener('click',()=>action?.abort('user'));
const spec=(text:string):GameSpec=>({prompt:text,audience:'default',genre:'unknown',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true});
function remember(version: GameVersion) { versions.delete(version.versionId); versions.set(version.versionId,version); if(versions.size>3)versions.delete(versions.keys().next().value!); }
async function readVersion(id:string,signal?:AbortSignal):Promise<GameVersion> { const cached=versions.get(id); if(cached)return cached; const version=await api('/api/versions/'+id,undefined,undefined,signal); remember(version); return version; }
function view(screen: string) {
  document.body.dataset.screen=screen;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.setAttribute('aria-current',button.dataset.view===screen?'page':'false'));
  if(screen!=='play'){unmount?.();unmount=undefined;document.body.classList.remove('game-focus');el('focus-game').textContent='Игровой экран';}
}
async function list(signal?:AbortSignal) {
  const {games}=await api('/api/games',undefined,undefined,signal),container=el('games');container.replaceChildren();
  if(!games.length){container.textContent='Созданные игры появятся здесь.';return;}
  for(const v of games as Omit<GameVersion,'html'>[]) {
    const button=document.createElement('button');button.textContent=v.spec.prompt.length>90?v.spec.prompt.slice(0,90)+'…':v.spec.prompt;button.title=v.spec.prompt;button.type='button';button.dataset.version=v.versionId;
    button.addEventListener('click',()=>void attempt(async signal=>show(await readVersion(v.versionId,signal),signal)));container.append(button);
  }
}
async function stats(version: GameVersion) {
  const data=await api('/api/versions/'+version.versionId+'/analytics');if(current?.versionId!==version.versionId)return;
  el('analytics').textContent=`Начато: ${data.startedCount}. Завершено: ${data.completedCount}. Победы: ${data.won}. Поражения: ${data.lost}. Средний счёт: ${data.meanScore??'нет данных'}.`;
  el('comparison').textContent='';
  if(version.previousVersionId){const comparison=await api(`/api/versions/${version.versionId}/analytics?baselineVersionId=${version.previousVersionId}`);if(current?.versionId!==version.versionId)return;
    el('comparison').textContent=comparison.evidence==='insufficient_data'?'Для сравнения нужно минимум пять завершённых сессий на каждой версии.':`Разница доли побед: ${comparison.winRateDelta??'нет данных'}. Это наблюдение по клиентской статистике.`;}
}
async function play(version: GameVersion,signal?:AbortSignal) {
  const session=await api(`/api/versions/${version.versionId}/sessions`,{},undefined,signal);
  mount(version,session);
}
function mount(version:GameVersion,session:Parameters<typeof mountGame>[2]&{token:string}) {
  unmount?.();el('game').replaceChildren();let serial=Promise.resolve(),pending=0;
  const versionId=version.versionId;
  unmount=mountGame(el('game'),version.html,session,(event:GameEvent)=>{
    if(pending>=128){unmount?.();unmount=undefined;message.textContent='Игра отправляет слишком много событий. Запустите её заново.';return;}
    pending++;
    serial=serial.then(async()=>{for(let retry=0;retry<3;retry++){try{await api(`/api/sessions/${session.sessionId}/events`,event,session.token);if(event.type==='session_ended'||event.type==='game_error'){if(current?.versionId===versionId)await stats(current);}return;}catch(error){if(retry===2)throw error;await new Promise(resolve=>setTimeout(resolve,200*(retry+1)));}}}).catch(error=>{if(current?.versionId===versionId)message.textContent=`Событие не сохранено: ${error.message}`;}).finally(()=>{pending--;});
  });
}
async function show(version:GameVersion,signal?:AbortSignal) {
  const [history,session]=await Promise.all([api('/api/games/'+version.gameId,undefined,undefined,signal),api(`/api/versions/${version.versionId}/sessions`,{},undefined,signal)]);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  current=version;remember(version);mode.value=version.method==='mock'?'demo':'live';help();
  el('game-title').textContent=version.spec.prompt.length>100?version.spec.prompt.slice(0,100)+'…':version.spec.prompt;
  const bytes=new TextEncoder().encode(version.html).length;
  el('artifact-info').textContent=`HTML: ${(bytes/1024).toFixed(1)} КБ.`+(bytes>100_000?' Большая игра: запуск и расход памяти могут увеличиться.':'');
  el('provenance').textContent=version.method==='mock'?'DEMO · без LLM':`${version.method} · ${version.model??'модель неизвестна'}`;
  el<HTMLButtonElement>('replay').disabled=busy;el<HTMLButtonElement>('focus-game').disabled=false;
  const download=el<HTMLAnchorElement>('export');download.href=`/api/versions/${version.versionId}/export`;download.removeAttribute('aria-disabled');
  const select=el<HTMLSelectElement>('versions');select.replaceChildren();select.disabled=busy;
  history.versions.forEach((v:Omit<GameVersion,'html'>,i:number)=>{const option=document.createElement('option');option.value=v.versionId;option.textContent=`Версия ${i+1} · ${new Date(v.createdAt).toLocaleString()} · ${v.method}`;option.selected=v.versionId===version.versionId;select.append(option);});
  view('play');mount(version,session);await Promise.all([stats(version),list(signal)]);
}
function help(){el('mode-help').textContent=mode.value==='demo'?'DEMO использует авторскую игру «Звёздный курьер». Число в запросе задаёт цель. Это не LLM.':'LIVE создаёт HTML/JS моделью. Ожидание может занять несколько минут. Ошибка не переключает режим на DEMO.';}
mode.addEventListener('change',help);
el<HTMLFormElement>('create').addEventListener('submit',event=>{event.preventDefault();const selected=mode.value;void attempt(async signal=>{message.textContent=selected==='live'?'Модель создаёт игру…':'Создаём DEMO…';const version=await api('/api/games',{spec:spec(prompt.value),mode:selected},undefined,signal);await show(version,signal);message.textContent='Игра сохранена. Можно играть.';},selected==='live');});
el<HTMLFormElement>('iterate').addEventListener('submit',event=>{event.preventDefault();if(!current)return;const previous=current,selected=mode.value;void attempt(async signal=>{message.textContent='Создаём следующую версию…';const version=await api(`/api/games/${previous.gameId}/versions`,{spec:spec(el<HTMLTextAreaElement>('change').value),previousVersionId:previous.versionId,mode:selected},undefined,signal);await show(version,signal);message.textContent='Новая версия сохранена. Предыдущая доступна в списке.';},selected==='live');});
el('replay').addEventListener('click',()=>{if(current)void attempt(signal=>play(current!,signal));});
el('versions').addEventListener('change',()=>void attempt(async signal=>show(await readVersion(el<HTMLSelectElement>('versions').value,signal),signal)));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>{const screen=button.dataset.view!;if(screen==='play'&&current&&!unmount)void attempt(async signal=>{view(screen);await play(current!,signal);});else view(screen);}));
el('focus-game').addEventListener('click',()=>{const active=document.body.classList.toggle('game-focus');el('focus-game').textContent=active?'Обычный экран':'Игровой экран';});
async function diagnose(){const data=await api('/api/diagnostics');el('system-info').textContent=`База: ${data.ok?'исправна':'ошибка'}. LIVE: ${data.liveConfigured?(data.provider??'BGen')+' / '+(data.model??'по API'):'не настроен'}. BGen library: ${data.bgenReady?'установлена':'для Ollama выполните npm run bgen:install'}.`;}
el('diagnostics').addEventListener('click',()=>{el<HTMLDetailsElement>('system').open=true;void attempt(async()=>{await diagnose();el('system').scrollIntoView({block:'start'});});});
el('backup').addEventListener('click',()=>void attempt(async signal=>{const copy=await api('/api/backups',{},undefined,signal);el('backup-result').textContent=`Копия проверена и сохранена в .local/backups/${copy.filename}. SHA-256: ${copy.sha256}`;}));
window.addEventListener('offline',()=>{el('connection').hidden=false;});window.addEventListener('online',()=>{el('connection').hidden=true;});
try{prompt.value=sessionStorage.getItem('yaplix-draft')??prompt.value;}catch{}
prompt.addEventListener('input',()=>{try{sessionStorage.setItem('yaplix-draft',prompt.value);}catch{}});
window.visualViewport?.addEventListener('resize',()=>{document.body.dataset.keyboard=String(innerHeight-visualViewport!.height-visualViewport!.offsetTop>150);});
void list().then(()=>{document.body.dataset.ready='true';}).catch(error=>{message.textContent=error.message;document.body.dataset.ready='true';});
