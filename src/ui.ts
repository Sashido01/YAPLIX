import { mountGame } from './runtime.ts';
import type { GameVersion, GameSpec, GameEvent } from './contracts.ts';
import type { JobSummary } from './job-contracts.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = el<HTMLTextAreaElement>('prompt'), mode = el<HTMLSelectElement>('mode'), message = el('message');
let current: GameVersion | null = null, unmount: (() => void) | undefined, busy = false, action: AbortController | undefined;
let telegramToken:string|undefined;
const versions = new Map<string, GameVersion>(); // Bounded read cache, at most 3 × 200 KB HTML.
const errors: Record<string, string> = {
  INVALID_PROVIDER_MODE:'Выберите Auto, Ollama Cloud или OpenRouter Free.',
  LLM_NOT_CONFIGURED:'LIVE не настроен. Добавьте серверный API key и откройте диагностику.',
  BROWSER_INSTALL_REQUIRED:'Для LIVE установите браузер проверки: npm run checker:install.',
  BROWSER_SANDBOX_UNAVAILABLE:'Браузер проверки не смог запустить защищённую среду. Проверьте настройку Chromium sandbox по инструкции Ubuntu.',
  BROWSER_SANDBOX_CONFIGURATION:'Системный Chromium sandbox helper не прошёл проверку. Проверьте CHROME_DEVEL_SANDBOX по инструкции Ubuntu.',
  BROWSER_INPUT_NO_EFFECT:'Игра не отвечает на ввод: клавиши и касания не меняют состояние. Запрос и черновик сохранены.',
  BROWSER_START_CONTROL:'Стартовая кнопка не найдена или не единственная. Игра не сохранена.',
  BROWSER_MOBILE_LAYOUT:'Разметка не помещается в мобильный экран 320/390 px. Игра не сохранена.',
  BROWSER_GAME_AREA:'Игровая область или canvas не имеют видимого размера. Игра не сохранена.',
  BROWSER_PAUSE_CONTROL:'Кнопка паузы не найдена. Игра не сохранена.',
  BROWSER_PAUSE_NOT_FROZEN:'После паузы игра продолжала анимацию. Игра не сохранена.',
  LLM_MODEL_NOT_FOUND:'Выбранная модель недоступна у провайдера. Проверьте серверную конфигурацию.',
  LLM_BUSY:'Другая генерация ещё завершается. Повторите позже.',
  LLM_DNS:'Не найден адрес модели. Проверьте интернет и DNS. Идея сохранена.',
  LLM_TCP_CONNECTION:'Не удалось подключиться к модели. Проверьте сеть. Идея сохранена.',
  LLM_TLS:'Сертификат соединения не прошёл проверку. Проверьте сертификаты сервера или прокси. Идея сохранена.',
  LLM_PROXY_CONNECTION:'Не удалось подключиться через прокси. Проверьте настройки сервера. Идея сохранена.',
  LLM_PROXY_AUTH:'Прокси отклонил авторизацию. Проверьте серверные настройки. Идея сохранена.',
  LLM_PROXY_UNSUPPORTED:'Тип прокси не поддерживается. Настройте HTTP/HTTPS-прокси на сервере. Идея сохранена.',
  LLM_NETWORK_CONFIGURATION:'Ошибка сетевых настроек сервера. Проверьте диагностику. Идея сохранена.',
  LLM_NETWORK_UNAVAILABLE:'Сеть недоступна. Проверьте интернет и прокси. Идея сохранена.',
  LLM_RESPONSE_TIMEOUT:'Соединение с моделью не ответило вовремя. Идея и черновик сохранены.',
  LLM_TIMEOUT:'Модель не ответила вовремя. Запрос и черновик сохранены.',
  LLM_INVALID_RESPONSE:'Модель вернула неполный ответ. Игра не сохранена.',
  LLM_OUTPUT_TRUNCATED:'Вывод обрезан. Запрос и полученный код сохранены для исправления.',
  LLM_QUOTA:'Квота провайдера исчерпана. Черновик сохранён. Проверьте квоту перед продолжением.',
  LLM_CONTEXT_LIMIT:'Контекст превышает лимит модели. Запрос и черновик сохранены; проверьте настройки модели.',
  LLM_CONNECTION_INTERRUPTED:'Соединение с моделью прервано. Запрос и полученные части сохранены.',
  JOB_RESTART_UNCERTAIN:'Сервер перезапустился после отправки запроса. Сохранённый код проверяется; повторы ограничены.',
  JOB_RETRY_AFTER:'Провайдер просит подождать. Продолжение станет доступно после указанного времени.',
  JOB_ATTEMPT_LIMIT:'Бюджет автоматических запросов исчерпан. Исходный запрос и черновик сохранены.',
  JOB_DURATION_LIMIT:'Время автоматического восстановления истекло. Запрос и черновик сохранены.',
  LLM_ROUTES_UNAVAILABLE:'Настроенные маршруты недоступны. Запрос и черновик сохранены; проверьте доступность провайдеров.',
  JOB_QUEUE_FULL:'Очередь заполнена. Дождитесь завершения одного из заданий.',
  LLM_UNSAFE_ARTIFACT:'Код не прошёл проверку безопасности после попытки исправления моделью. Уточните запрос.',
  LLM_HTTP:'LLM вернула ошибку. Проверьте запуск модели и её ресурсы.',
  LLM_NETWORK_OR_RESPONSE:'Не удалось получить полный ответ LLM. Проверьте подключение провайдера.',
  LLM_AUTH:'Провайдер не принял серверный API key.',
  LLM_RATE_LIMIT:'Провайдер ограничил запросы. Автоматический повтор соблюдает время ожидания.',
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
  if(screen!=='play'){document.body.classList.remove('game-focus');el('focus-game').textContent='Игровой экран';}
}
async function list(signal?:AbortSignal) {
  const reserve=el('gallery'),[{games},catalog]=await Promise.all([api('/api/games',undefined,undefined,signal),reserve.childElementCount?Promise.resolve(null):api('/api/gallery',undefined,undefined,signal)]),container=el('games');container.replaceChildren();
  if(catalog&&!reserve.childElementCount){for(const game of catalog.games){const button=document.createElement('button');button.textContent=game.title+' · офлайн';button.type='button';button.addEventListener('click',()=>void attempt(async signal=>{const version=await api('/api/gallery/'+game.id,{},undefined,signal);await show(version,signal);await list(signal);}));reserve.append(button);}}
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
  if(version.method==='authored')el('provenance').textContent='Авторская офлайн-игра · не LIVE';
  el('share').hidden=location.protocol!=='https:';
  if(version.generation)el('provenance').textContent+=` · попыток: ${version.generation.attempts.length}${version.generation.fallback?' · резервный маршрут':''} · запуск/пауза/offline 320/390 px · механики и финал не подтверждены`;
  el<HTMLButtonElement>('replay').disabled=busy;el<HTMLButtonElement>('focus-game').disabled=false;
  const download=el<HTMLAnchorElement>('export');download.href=`/api/versions/${version.versionId}/export`;download.removeAttribute('aria-disabled');
  const select=el<HTMLSelectElement>('versions');select.replaceChildren();select.disabled=busy;
  history.versions.forEach((v:Omit<GameVersion,'html'>,i:number)=>{const option=document.createElement('option');option.value=v.versionId;option.textContent=`Версия ${i+1} · ${new Date(v.createdAt).toLocaleString()} · ${v.method}`;option.selected=v.versionId===version.versionId;select.append(option);});
  const address=new URL(location.href);address.searchParams.set('game',version.gameId);address.searchParams.set('version',version.versionId);window.history.replaceState(null,'',address);
  view('play');mount(version,session);await Promise.all([stats(version),list(signal)]);
}
function help(){el('mode-help').textContent=mode.value==='demo'?'DEMO использует авторскую игру «Звёздный курьер». Число в запросе задаёт цель. Это не LLM.':'LIVE создаёт HTML/JS моделью. Ожидание может занять несколько минут. Ошибка не переключает режим на DEMO.';}
mode.addEventListener('change',help);
const providerSelect=el<HTMLSelectElement>('provider-mode');
try{const saved=sessionStorage.getItem('yaplix-provider-mode');if(saved&&['auto','ollama-cloud','openrouter'].includes(saved))providerSelect.value=saved;}catch{}
providerSelect.addEventListener('change',()=>{try{sessionStorage.setItem('yaplix-provider-mode',providerSelect.value);}catch{}});
const submitting=new Set<string>();
async function submitJob(buttonId:string,text:string,previousVersionId?:string){
  if(submitting.has(buttonId))return;submitting.add(buttonId);const button=el<HTMLButtonElement>(buttonId);button.disabled=true;
  const request={spec:spec(text),mode:mode.value,providerMode:el<HTMLSelectElement>('provider-mode').value,...(previousVersionId?{previousVersionId}:{}),telegramConsent:Boolean(telegramToken&&el<HTMLInputElement>('telegram-notify').checked)};
  // randomUUID is unavailable on private-IP HTTP LAN; getRandomValues works there.
  const bytes=crypto.getRandomValues(new Uint8Array(16));let key=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');try{const old=JSON.parse(sessionStorage.getItem('yaplix-pending-'+buttonId)??'null');if(old?.request===JSON.stringify(request))key=old.key;sessionStorage.setItem('yaplix-pending-'+buttonId,JSON.stringify({key,request:JSON.stringify(request)}));}catch{}
  try{await api('/api/jobs',{...request,idempotencyKey:key});try{sessionStorage.removeItem('yaplix-pending-'+buttonId);}catch{}message.textContent='Задание сохранено. Можно продолжать играть.';await pollJobs();}
  catch(error){message.textContent=(error as Error).message;}
  finally{submitting.delete(buttonId);button.disabled=buttonId==='improve'&&!current;}
}
el<HTMLFormElement>('create').addEventListener('submit',event=>{event.preventDefault();void submitJob('generate',prompt.value);});
el<HTMLFormElement>('iterate').addEventListener('submit',event=>{event.preventDefault();if(current)void submitJob('improve',el<HTMLTextAreaElement>('change').value,current.versionId);});
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
const stageNames:Record<string,string>={retry_scheduled:'Автоматический повтор',waiting_for_provider:'Ожидание провайдера',failed_permanent:'Нужно действие',queued:'В очереди',generating:'Генерация',validating:'Проверка',repairing:'Исправление',completed:'Готово',needs_attention:'Нужно действие',cancelled:'Отменено',failed:'Ошибка'};
let polling=false,pollTimer:ReturnType<typeof setTimeout>|undefined,toast:JobSummary|undefined,closed=false;
function openJob(job:JobSummary){if(job.versionId){el('jobs-panel').hidden=true;return attempt(async signal=>{await api('/api/jobs/'+job.jobId+'/notification',{},undefined,signal);if(toast?.jobId===job.jobId)dismissToast();await show(await readVersion(job.versionId!,signal),signal);message.textContent=job.previousVersionId?'Новая версия сохранена. Предыдущая доступна в списке.':'Игра сохранена. Можно играть.';});}}
function renderJobs(jobs:JobSummary[]){
  const count=jobs.filter(j=>['queued','generating','repairing','validating'].includes(j.stage)).length;el('jobs-toggle').textContent='Задания'+(count?' ('+count+')':'');
  const container=el('jobs-list');container.replaceChildren();if(!jobs.length)container.textContent='Заданий пока нет.';
  for(const job of jobs){const row=document.createElement('article');row.dataset.job=job.jobId;const title=document.createElement('strong');title.textContent=job.spec.prompt;const status=document.createElement('p');const duration=job.stage==='queued'?Math.max(0,Date.now()-Date.parse(job.updatedAt)):job.elapsedMs+(['generating','repairing','validating'].includes(job.stage)?Math.max(0,Date.now()-Date.parse(job.updatedAt)):0);status.textContent=(job.providerMode?({auto:'Auto','ollama-cloud':'Ollama Cloud',openrouter:'OpenRouter Free'}[job.providerMode]+' · '):'')+`${stageNames[job.recoveryState??job.stage]} · ${Math.round(duration/1000)} с · попыток ${job.attempts}`+((job.actualModel??job.requestedModel)?' · '+(job.actualModel??job.requestedModel):'');row.append(title,status);
    const failures=job.history.filter(attempt=>attempt.errorCode).slice(-3);if(failures.length){const reasons=document.createElement('p');reasons.className='muted';reasons.textContent='Предыдущие попытки: '+failures.map(attempt=>`${attempt.provider} / ${attempt.model??attempt.requestedModel}: ${errors[attempt.errorCode!]??attempt.errorCode}`).join(' · ');row.append(reasons);}
    if(job.errorCode){const error=document.createElement('p');error.textContent=(errors[job.errorCode]??`Черновик сохранён (${job.errorCode}).`)+(job.retryAt?' Повтор после '+new Date(job.retryAt).toLocaleTimeString()+'.':'');row.append(error);}
    const actions=document.createElement('div');actions.className='actions';const add=(label:string,work:()=>Promise<unknown>|void)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>{button.disabled=true;void Promise.resolve().then(work).then(()=>pollJobs()).catch(error=>{message.textContent=error.message;button.disabled=false;});});actions.append(button);return button;};
      if(job.stage==='completed')add('Играть',()=>openJob(job));
    else if(['needs_attention','failed','cancelled'].includes(job.stage)){const button=add('Продолжить генерацию',()=>api('/api/jobs/'+job.jobId+'/continue',{}));button.disabled=job.attempts>=12||Boolean(job.retryAt&&Date.now()<job.retryAt);}
    else add('Отменить задание',()=>api('/api/jobs/'+job.jobId+'/cancel',{}));
    if(job.checkpointBytes)add('Скачать черновик',async()=>{const draft=await api('/api/jobs/'+job.jobId);const url=URL.createObjectURL(new Blob([draft.checkpoint],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='yaplix-draft-'+job.jobId+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    row.append(actions);container.append(row);
  }
}
async function pollJobs(){
  if(polling||closed||document.hidden)return;polling=true;
  try{const{jobs}=await api('/api/jobs') as {jobs:JobSummary[]};renderJobs(jobs);if(!toast){for(const job of jobs){if(job.stage==='completed'&&!job.notificationClaimed){const claim=await api('/api/jobs/'+job.jobId+'/notification',{});if(claim.claimed){toast=job;el('job-toast-text').textContent='Игра сохранена. Можно играть.';el('job-toast-open').hidden=false;el('job-toast-dismiss').hidden=false;await list();break;}}}}}
  catch{/* The next bounded poll restores server state; keep the active game. */}
  finally{polling=false;clearTimeout(pollTimer);if(!closed)pollTimer=setTimeout(()=>void pollJobs(),2000);}
}
function dismissToast(){toast=undefined;el('job-toast-text').textContent='';el('job-toast-open').hidden=true;el('job-toast-dismiss').hidden=true;void pollJobs();}
el('job-toast-open').addEventListener('click',()=>{if(toast)openJob(toast);dismissToast();});el('job-toast-dismiss').addEventListener('click',dismissToast);
el('jobs-toggle').addEventListener('click',()=>{el('jobs-panel').hidden=!el('jobs-panel').hidden;void pollJobs();});
document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);if(!document.hidden)void pollJobs();});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(pollTimer);unmount?.();unmount=undefined;});window.addEventListener('pageshow',()=>{if(closed){closed=false;void pollJobs();}});
async function boot(){
  if(document.body.dataset.entry==='telegram'){const path='/runtime/telegram-ui.js';telegramToken=await (await import(path) as typeof import('./telegram-ui.ts')).initializeTelegram();el('telegram-notify-label').hidden=false;}
  await list();void pollJobs();const params=new URL(location.href).searchParams,selected=params.get('game');if(params.get('view')==='create')view('create');if(selected&&/^[0-9a-f-]{36}$/.test(selected))await attempt(async signal=>{const history=await api('/api/games/'+selected,undefined,undefined,signal);const requested=params.get('version');const latest=requested?history.versions.find((v:GameVersion)=>v.versionId===requested):history.versions.at(-1);if(!latest)throw new Error('Версия отсутствует в этой игре.');await show(await readVersion(latest.versionId,signal),signal);},false);
}
void boot().then(()=>{document.body.dataset.ready='true';}).catch(error=>{message.textContent=error.message;document.body.dataset.ready='true';});
