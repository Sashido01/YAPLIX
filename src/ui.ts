import { mountGame } from './runtime.ts';
import type { GameVersion, GameSpec, GameEvent } from './contracts.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = el<HTMLTextAreaElement>('prompt'), mode = el<HTMLSelectElement>('mode'), message = el('message');
let current: GameVersion | null = null, unmount: (() => void) | undefined, busy = false, action: AbortController | undefined;
let telegramToken:string|undefined;
const versions = new Map<string, GameVersion>(); // Bounded read cache, at most 3 × 200 KB HTML.
const errors: Record<string, string> = {
  LLM_NOT_CONFIGURED:'LIVE не настроен. Добавьте серверный API key и откройте диагностику.',
  BROWSER_INSTALL_REQUIRED:'Для LIVE установите браузер проверки: npm run checker:install.',
  BROWSER_SANDBOX_UNAVAILABLE:'Браузер проверки не смог запустить защищённую среду. Проверьте настройку Chromium sandbox по инструкции Ubuntu.',
  BROWSER_SANDBOX_CONFIGURATION:'Системный Chromium sandbox helper не прошёл проверку. Проверьте CHROME_DEVEL_SANDBOX по инструкции Ubuntu.',
  LLM_MODEL_NOT_FOUND:'Модель отсутствует в Ollama. Установите выбранную модель.',
  LLM_BUSY:'Другая генерация ещё завершается. Повторите позже.',
  LLM_TIMEOUT:'Модель не ответила вовремя. Попробуйте уточнить запрос.',
  LLM_INVALID_RESPONSE:'Модель вернула неполный ответ. Игра не сохранена.',
  LLM_OUTPUT_TRUNCATED:'Модель исчерпала лимит вывода. Игра не сохранена; сократите описание или увеличьте LLM_MAX_TOKENS на сервере.',
  LLM_UNSAFE_ARTIFACT:'Код не прошёл проверку безопасности после попытки исправления моделью. Уточните запрос.',
  LLM_HTTP:'LLM вернула ошибку. Проверьте запуск модели и её ресурсы.',
  LLM_NETWORK_OR_RESPONSE:'Не удалось получить полный ответ LLM. Проверьте подключение провайдера.',
  LLM_AUTH:'Провайдер не принял серверный API key.',
  LLM_RATE_LIMIT:'Провайдер ограничил запросы. Подождите и повторите. Платная модель не включается.',
  RATE_LIMIT:'Лимит генераций достигнут. Подождите минуту.',
  ACCESS_REQUIRED:'Доступ истёк. Обновите страницу и введите ключ сервера.',
  BACKUP_QUOTA:'Достигнут лимит копий. Сохраните нужные копии и освободите место по README.',
  BACKUP_BUSY:'Копия уже создаётся. Повторите позже.',
};
async function api(path: string, body?: unknown, token?: string, signal?: AbortSignal) {
  const deadline=new AbortController(),timer=signal?undefined:setTimeout(()=>deadline.abort(),10_000);
  try {
    const response = await fetch(path, { signal: signal ?? deadline.signal, headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(telegramToken?{'X-Yaplix-Telegram-Session':telegramToken}:{})},...(body !== undefined ? { method:'POST',body:JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(errors[data.error] ?? (String(data.error).startsWith('BROWSER_')||data.error==='JAVASCRIPT_EXCEPTION'?'Игра не прошла браузерную проверку после исправления моделью ('+data.error+'). Уточните запрос.':`Не удалось выполнить действие (${data.error ?? response.status}).`));
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
  if(!value&&current&&document.body.dataset.screen==='play'){
    const mobile=matchMedia('(max-width:760px)').matches;
    const scroller=(mobile?document.querySelector('body>main'):document.scrollingElement) as HTMLElement;
    const bottom=mobile?scroller.getBoundingClientRect().bottom:innerHeight;
    scroller.scrollTop+=Math.max(0,el('game').getBoundingClientRect().bottom-bottom+8);
  }
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
  for(const v of games as (Omit<GameVersion,'html'>&{title?:string})[]) {
    const title=v.title??v.spec.prompt;
    const button=document.createElement('button');button.textContent=title.length>90?title.slice(0,90)+'…':title;button.title=title;button.type='button';button.dataset.version=v.versionId;
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
  const title=history.versions[0]?.spec.prompt??version.spec.prompt;
  el('game-title').textContent=title.length>100?title.slice(0,100)+'…':title;
  const bytes=new TextEncoder().encode(version.html).length;
  el('artifact-info').textContent=`HTML: ${(bytes/1024).toFixed(1)} КБ.`+(bytes>100_000?' Большая игра: запуск и расход памяти могут увеличиться.':'');
  el('provenance').textContent=version.method==='mock'?'DEMO · без LLM':`${version.method} · ${version.model??'модель неизвестна'}`;
  el('share').hidden=location.protocol!=='https:';
  if(version.generation)el('provenance').textContent+=` · попыток: ${version.generation.attempts.length}${version.generation.fallback?' · резервный маршрут':''} · проверка запуска 320/390 px`;
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
let diagnosing=false;
async function diagnose(){if(diagnosing)return;diagnosing=true;try{const path='/runtime/connection-ui.js';await (await import(path) as typeof import('./connection-ui.ts')).diagnose(telegramToken);}finally{diagnosing=false;}}
el('system').addEventListener('toggle',()=>{if(el<HTMLDetailsElement>('system').open)void diagnose().catch(()=>{el('system-info').textContent='Статус не подтверждён. Проверьте сборку и доступность API.';});});
el('diagnostics').addEventListener('click',()=>{el<HTMLDetailsElement>('system').open=true;void attempt(async()=>{await diagnose();el('system').scrollIntoView({block:'start'});});});
el('backup').addEventListener('click',()=>void attempt(async signal=>{const copy=await api('/api/backups',{},undefined,signal);el('backup-result').textContent=`Копия проверена и сохранена в .local/backups/${copy.filename}. SHA-256: ${copy.sha256}`;}));
el('share').addEventListener('click',()=>{if(current)void attempt(async signal=>{const shared=await api('/api/versions/'+current!.versionId+'/share',{},undefined,signal);const field=el<HTMLInputElement>('share-url');field.value=shared.url;field.hidden=false;field.focus();field.select();message.textContent='Ссылка открывает только эту игру на 7 дней. Создавайте её только для игры, которой хотите поделиться.';});});
window.addEventListener('offline',()=>{el('connection').hidden=false;});window.addEventListener('online',()=>{void api('/api/health').catch(()=>{el('connection').hidden=false;});});
try{prompt.value=sessionStorage.getItem('yaplix-draft')??prompt.value;}catch{}
prompt.addEventListener('input',()=>{try{sessionStorage.setItem('yaplix-draft',prompt.value);}catch{}});
window.visualViewport?.addEventListener('resize',()=>{document.body.dataset.keyboard=String(innerHeight-visualViewport!.height-visualViewport!.offsetTop>150);});
async function boot(){
  if(document.body.dataset.entry==='telegram'){const path='/runtime/telegram-ui.js';telegramToken=await (await import(path) as typeof import('./telegram-ui.ts')).initializeTelegram();}
  await list();const selected=new URL(location.href).searchParams.get('game');if(selected&&/^[0-9a-f-]{36}$/.test(selected))await attempt(async signal=>{const history=await api('/api/games/'+selected,undefined,undefined,signal);const latest=history.versions.at(-1);if(latest)await show(await readVersion(latest.versionId,signal),signal);},false);
}
void boot().then(()=>{document.body.dataset.ready='true';}).catch(error=>{message.textContent=error.message;document.body.dataset.ready='true';});
