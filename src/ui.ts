import {LIVE_JOB_TIMEOUT_MS} from './generation-timeouts.ts';
import { mountGame } from './runtime.ts';
import type { GameVersion, GameSpec, GameEvent } from './contracts.ts';
import type { JobSummary } from './job-contracts.ts';
import {MODEL_CATALOG,modelForMode} from './model-catalog.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = el<HTMLTextAreaElement>('prompt'), message = el('message');
let current: GameVersion | null = null, unmount: (() => void) | undefined, busy = false, action: AbortController | undefined;
let telegramToken:string|undefined;let phoneOpening=false;
const versions = new Map<string, GameVersion>(); // Bounded read cache, at most 3 × 200 KB HTML.
const apiFailures = new WeakSet<object>();
const apiFailureCodes = new WeakMap<object,string>();
const providerConfiguration = new Map<string,boolean>();
let chatgptConnected=false,modelReadiness='NOT_CHECKED';
let lastEditorState='';
const errors: Record<string, string> = {
  CHATGPT_LOCAL_ONLY:'Личный ChatGPT недоступен в LAN, HTTPS и Telegram.',
  CHATGPT_AUTH_REQUIRED:'Подключите ChatGPT на этом компьютере.',
  CHATGPT_NEW_JOB_REQUIRED:'Для новой попытки создайте новое задание вручную. Старый бюджет не возобновляется.',
  CHATGPT_BUDGET_SPENT:'Единственная попытка ChatGPT уже израсходована.',
  CHATGPT_BUSY:'Подключение уже выполняется или ChatGPT уже подключён.',
  SIWC_PROXY_AUTH:'Прокси отклонил авторизацию при входе в ChatGPT.',
  SIWC_PROXY_CONNECTION:'Не удалось связаться с прокси при входе в ChatGPT.',
  SIWC_PROXY_UNSUPPORTED:'Для входа ChatGPT настроен неподдерживаемый тип прокси.',
  SIWC_NETWORK_CONFIGURATION:'Проверьте сетевые настройки YAPLIX.',
  SIWC_NETWORK_TIMEOUT:'Сервер авторизации ChatGPT не ответил вовремя.',
  SIWC_NETWORK_UNAVAILABLE:'Сеть недоступна для авторизации ChatGPT.',
  SIWC_TLS:'Сертификат соединения ChatGPT не прошёл проверку.',
  SIWC_INSECURE_TLS:'Проверка TLS отключена; вход остановлен.',
  SIWC_DNS:'Не удалось разрешить адрес сервера авторизации ChatGPT.',
  SIWC_TCP_CONNECTION:'Не удалось установить соединение с сервером авторизации ChatGPT.',
  SIWC_AUTH_DENIED:'Вход или разрешение приложению отклонено.',
  SIWC_SCOPES_REQUIRED:'Приложению не выданы необходимые разрешения.',
  SIWC_PLAN_PERMISSION_REQUIRED:'Аккаунт не подтвердил право использовать ChatGPT в приложении.',
  INVALID_PROVIDER_MODE:'Выберите Ollama Cloud, OpenRouter Free или ChatGPT.',
  LLM_INPUT_TOO_LARGE:'Текущий HTML слишком велик для выбранного запроса. Исходная версия сохранена.',
  LLM_HTTP_BODY_TOO_LARGE:'Внешний HTTP-сервис отклонил размер запроса (413). Проверьте диагностику провайдера и прокси.',
  LLM_RESPONSE_BODY_TOO_LARGE:'Ответ модели превысил безопасный лимит транспорта. Полная игра не получена; черновик сохранён.',
  LLM_NOT_CONFIGURED:'LIVE не настроен. Добавьте серверный API key и откройте диагностику.',
  BROWSER_INSTALL_REQUIRED:'Для LIVE установите браузер проверки: npm run checker:install.',
  BROWSER_SANDBOX_UNAVAILABLE:'Браузер проверки не смог запустить защищённую среду. Проверьте настройку Chromium sandbox по инструкции Ubuntu.',
  BROWSER_TEMP_PATH_TOO_LONG:'Защищённый Chromium не запустился: не удалось создать достаточно короткий приватный временный каталог для профиля. Проверьте доступ к системному временному каталогу.',
  BROWSER_SANDBOX_CONFIGURATION:'Системный Chromium sandbox helper не прошёл проверку. Проверьте CHROME_DEVEL_SANDBOX по инструкции Ubuntu.',
  BROWSER_INPUT_NO_EFFECT:'Игра не отвечает на ввод: клавиши и касания не меняют состояние. Запрос и черновик сохранены.',
  BROWSER_CANVAS_ACTIVITY_UNVERIFIED:'Защищённая проверка не увидела изменения Canvas после пробных касаний. Возможно, игра ждала нажатия «Начать» или касание не попало в нужное место. Это не доказывает, что игра сломана; результат остаётся черновиком до подтверждения активности.',
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
  LLM_UNSAFE_ARTIFACT:'Код не прошёл проверку безопасности. Идея и исходный черновик сохранены.',
  JAVASCRIPT_EXCEPTION:'В игре обнаружена ошибка JavaScript. Игра не готова; идея и исходный код сохранены.',
  BROWSER_RESTART_FAILED:'Повторный запуск не работает. Игра не готова; исходный код сохранён.',
  CHECKPOINT_ORIGIN_UNAVAILABLE:'Провайдер сохранённого черновика неизвестен или больше не настроен. Черновик сохранён. Для другого провайдера создайте новый запрос.',
  BROWSER_TIMEOUT_STARTUP:'Не удалось завершить запуск проверяющего браузера вовремя. Работоспособность игры не подтверждена.',
  BROWSER_TIMEOUT_RENDER:'Истекло время загрузки игры. Проверка не завершена; черновик сохранён.',
  BROWSER_TIMEOUT_INTERACTION:'Истекло время проверки управления. Механика не подтверждена; черновик сохранён.',
  BROWSER_TIMEOUT_RESTART:'Истекло время проверки повторного запуска. Результат не подтверждён; черновик сохранён.',
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
    const response = await fetch(path, { signal: signal ?? deadline.signal, headers:{...(body!==undefined?{'Content-Type':'application/json','X-Yaplix-ChatGPT':'owner'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(telegramToken?{'X-Yaplix-Telegram-Session':telegramToken}:{})},...(body !== undefined ? { method:'POST',body:JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) {
      const code=typeof data.error==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(data.error)?data.error:`HTTP_${response.status}`;
      const failure=new Error(errors[data.error] ?? (String(data.error).startsWith('BROWSER_')?'Игра не прошла браузерную проверку ('+data.error+'). Черновик сохранён.':`Не удалось выполнить действие (${code}).`));
      apiFailureCodes.set(failure,code);throw failure;
    }
    el('connection').hidden = true; return data;
  } catch (error) {
    let failure=error;
    if ((error as Error).name === 'TypeError' || !signal && deadline.signal.aborted) { el('connection').hidden = false; failure=new Error('Сервер недоступен. Проверьте связь и повторите действие.'); }
    if(failure&&typeof failure==='object')apiFailures.add(failure);
    if(!signal?.aborted)traceUi('ui.api_error',{errorCode:'UI_API_ERROR',reasonCode:failure&&typeof failure==='object'?apiFailureCodes.get(failure)??'NETWORK_ERROR':'NETWORK_ERROR'});
    throw failure;
  } finally {clearTimeout(timer);}
}
function lock(value: boolean) {
  busy=value; el<HTMLButtonElement>('phone-game').disabled=value||!current; el<HTMLButtonElement>('generate').disabled=value; el<HTMLButtonElement>('improve').disabled=value||!current; el<HTMLSelectElement>('provider-mode').disabled=value;el<HTMLSelectElement>('edit-provider-mode').disabled=value;
  el<HTMLSelectElement>('versions').disabled=value||!current;el<HTMLButtonElement>('replay').disabled=value||!current;
  el('cancel').hidden=!value||genState==='working'; document.body.classList.toggle('waiting',value&&genState!=='working');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>{button.disabled=value&&genState!=='working';});
  syncCreateAvailability();syncEditorAvailability();
  void current;
}
async function attempt(work: (signal: AbortSignal) => Promise<void>, generating = false) {
  if (busy) return; lock(true); action=new AbortController(); const controller=action;
  const timeout=setTimeout(()=>controller.abort('timeout'), generating ? LIVE_JOB_TIMEOUT_MS : 15_000);
  try { await work(controller.signal); }
  catch (error) { if(!controller.signal.aborted&&(!error||typeof error!=='object'||!apiFailures.has(error)))traceUi('ui.state_error',{errorCode:'UI_ACTION_ERROR'});notify(controller.signal.aborted ? controller.signal.reason==='timeout'?'Ожидание истекло. Повторите действие.':'Ожидание отменено. Проверьте список сохранённых игр.' : (error as Error).message, true); }
  finally { clearTimeout(timeout); if(action===controller)action=undefined; lock(false); }
}
el('cancel').addEventListener('click',()=>action?.abort('user'));
const spec=(text:string):GameSpec=>({prompt:text,audience:'default',genre:'unknown',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true});
// --- UI-002D: живое рабочее пространство (состояния правой области) ---
type GenState = 'idle'|'working'|'ready'|'failed';
let genState: GenState = 'idle';
let genStartedAt = 0;
let genTimer: ReturnType<typeof setInterval>|undefined;
let genCancelJobId = '';
let trackedJobId: string | null = null;
let pendingSubmitKey: string | null = null;
let lastJobs: JobSummary[] | undefined;
let noticeTimer: ReturnType<typeof setTimeout>|undefined;
function traceUi(event:string,extra:Record<string,unknown>={}) {
  const versionId=current?.versionId;if(!versionId)return;
  const game=el('game'),rect=game.getBoundingClientRect(),width=Math.max(0,Math.round(innerWidth)),height=Math.max(0,Math.round(innerHeight));
  const orientation=width===height?'square':width>height?'landscape':'portrait',frame=game.querySelector('iframe');
  void fetch('/api/versions/'+versionId+'/ui-trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,width,height,screen:document.body.dataset.screen,panel:document.body.classList.contains('game-focus')?'game-focus':'workspace',gameArea:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.max(0,Math.round(value))),frameVisible:Boolean(frame&&!frame.hidden),orientation,...extra})}).catch(()=>{});
}
const importantNotice = /истек|отменено|ошибк|не удалось|недоступен|не выполнено|Сохраните|событие не сохранено|сохранены|повторите/i;
function notify(text: string, sticky = false) {
  message.textContent = text;
  if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = undefined; }
  if (!text) return;
  if (sticky || importantNotice.test(text)) return; // ошибки и предупреждения не исчезают сами
  noticeTimer = setTimeout(() => { if (message.textContent === text) message.textContent = ''; }, 7000);
}
function genElapsed(): string {
  const job = trackedJobId ? (lastJobs ?? []).find(j => j.jobId === trackedJobId) : undefined;
  if (genStartedAt === 0) {
    if (!job) return '0 с';
    return jobDuration(job);
  }
  const s = Math.max(0, Math.floor((Date.now() - genStartedAt) / 1000));
  return s >= 60 ? Math.floor(s / 60) + ' мин ' + (s % 60) + ' с' : s + ' с';
}
function setGenState(state: GenState) {
  genState = state;
  const box = el('genstate'), game = el('game'), toolbar = el('game-toolbar');
  const empty = game.querySelector('.empty');
  if (state === 'idle') {
    box.hidden = true; toolbar.hidden = true;
    const frame = game.querySelector('iframe') as HTMLElement | null;
    if (frame) { frame.hidden = false; box.hidden = true; toolbar.hidden = false; if (empty) (empty as HTMLElement).hidden = true; }
    else { if (empty) (empty as HTMLElement).hidden = false; toolbar.hidden = true; }
    const hint = document.getElementById('mobile-empty-hint');
    if (hint instanceof HTMLElement) hint.hidden = Boolean(frame) || innerWidth > 760;
    if (genTimer) { clearInterval(genTimer); genTimer = undefined; }
    syncCreateAvailability();syncEditorAvailability();return;
  }
  const frame = game.querySelector('iframe');
  if (state === 'working') {
    if (frame) (frame as HTMLElement).hidden = !current;
    if (empty) (empty as HTMLElement).hidden = true;
  } else {
    if (frame && state !== 'ready') (frame as HTMLElement).hidden = true;
    if (frame && state === 'ready') (frame as HTMLElement).hidden = false;
    if (empty) (empty as HTMLElement).hidden = true;
  }
  box.hidden = (state === 'ready' || state === 'working') && Boolean(current && frame);
  if (state === 'ready' || state === 'working') toolbar.hidden = !current;
  else toolbar.hidden = true;
  el('gen-launch').hidden = state !== 'ready';
  el('gen-cancel').hidden = state !== 'working';
  box.classList.toggle('done', state === 'ready');
  box.classList.toggle('error', state === 'failed');
  if (state === 'working' && !genTimer) {
    genTimer = setInterval(() => {
      const timer = document.getElementById('gen-time');
      if (!timer?.isConnected) { clearInterval(genTimer); genTimer = undefined; return; }
      timer.textContent = genElapsed();
    }, 500);
  }
  if (state !== 'working' && genTimer) { clearInterval(genTimer); genTimer = undefined; }
  syncCreateAvailability();syncEditorAvailability();
}
function remember(version: GameVersion) { versions.delete(version.versionId); versions.set(version.versionId,version); if(versions.size>3)versions.delete(versions.keys().next().value!); }
async function readVersion(id:string,signal?:AbortSignal):Promise<GameVersion> { const cached=versions.get(id); if(cached)return cached; const version=await api('/api/versions/'+id,undefined,undefined,signal); remember(version); return version; }
function view(screen: string) {
  document.body.dataset.screen=screen;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.setAttribute('aria-current',button.dataset.view===screen?'page':'false'));
  if(screen!=='create'){document.body.classList.remove('game-focus');el('focus-game').textContent='Игровой экран';}
  traceUi('ui.panel_changed');
}
async function list(signal?:AbortSignal) {
  const {games}=await api('/api/games',undefined,undefined,signal),container=el('games');container.replaceChildren();
  if(!games.length){container.textContent='';const hint=document.createElement('p');hint.className='muted';hint.textContent='Вы пока не создали ни одной игры.';const create=document.createElement('button');create.type='button';create.textContent='Создать игру';create.addEventListener('click',()=>view('create'));container.append(hint,create);return;}
  for(const v of games as (Omit<GameVersion,'html'>&{title?:string})[]) {
    const title=v.title??v.spec.prompt;
    const button=document.createElement('button');button.type='button';const label=document.createElement('span');label.textContent=title.length>90?title.slice(0,90)+'…':title;const meta=document.createElement('small');meta.textContent='Играть · откроется справа';label.append(meta);button.append(label);button.title=title;button.dataset.version=v.versionId;
    button.addEventListener('click',()=>void attempt(async signal=>{view('create');await show(await readVersion(v.versionId,signal),signal);}));container.append(button);
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
    if(event.type==='game_error')traceUi('ui.game_runtime_error',{errorCode:'GAME_RUNTIME_ERROR',inputAction:event.type});
    else if(event.type!=='score_changed')traceUi('ui.game_activity',{inputAction:event.type});
    if(pending>=128){unmount?.();unmount=undefined;message.textContent='Игра отправляет слишком много событий. Запустите её заново.';return;}
    pending++;
    serial=serial.then(async()=>{for(let retry=0;retry<3;retry++){try{await api(`/api/sessions/${session.sessionId}/events`,event,session.token);if(event.type==='session_ended'||event.type==='game_error'){if(current?.versionId===versionId)await stats(current);}return;}catch(error){if(retry===2)throw error;await new Promise(resolve=>setTimeout(resolve,200*(retry+1)));}}}).catch(error=>{if(current?.versionId===versionId)message.textContent=`Событие не сохранено: ${error.message}`;}).finally(()=>{pending--;});
  });
}
async function show(version:GameVersion,signal?:AbortSignal) {
  const [history,session]=await Promise.all([api('/api/games/'+version.gameId,undefined,undefined,signal),api(`/api/versions/${version.versionId}/sessions`,{},undefined,signal)]);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  current=version;remember(version);
  el('phone').dataset.version = version.versionId;
  el<HTMLButtonElement>('arena-game').disabled=false;
  const title=history.versions[0]?.spec.prompt??version.spec.prompt;
  el('game-title').textContent=title.length>100?title.slice(0,100)+'…':title;
  const bytes=new TextEncoder().encode(version.html).length;
  el('artifact-info').textContent=`HTML: ${(bytes/1024).toFixed(1)} КБ.`+(bytes>100_000?' Большая игра: запуск и расход памяти могут увеличиться.':'');
  el('provenance').textContent=version.method==='mock'?'Тестовая игра · без LLM':'Игра создана · '+(version.provider==='chatgpt'?'ChatGPT · GPT-6.1 Sol Medium':version.provider==='openrouter'?'OpenRouter Free':'Ollama Cloud');
  if(version.method==='authored')el('provenance').textContent='Авторская офлайн-игра · не LIVE';
  el('share').hidden=location.protocol!=='https:';
  if(version.generation)el('provenance').textContent+=' · техническая проверка пройдена · '+(version.generation.browser.checks?.some(c=>c.aspect==='gameplay-observed'&&c.level==='VERIFIED')?'gameplay проверен частично':'механика не проверена')+'; победа и поражение не подтверждены';
  const restart=version.generation?.browser.checks?.find(c=>c.aspect==='restart-works');
  if(restart?.level==='VERIFIED')el('provenance').textContent+=' · повторный запуск проверен';
  el<HTMLButtonElement>('phone-game').disabled=busy;el<HTMLButtonElement>('edit-game').disabled=false;el<HTMLButtonElement>('replay').disabled=busy;el<HTMLButtonElement>('focus-game').disabled=false;
  const download=el<HTMLAnchorElement>('export');download.href=`/api/versions/${version.versionId}/export`;download.removeAttribute('aria-disabled');
  const select=el<HTMLSelectElement>('versions');select.replaceChildren();select.disabled=busy;
  history.versions.forEach((v:Omit<GameVersion,'html'>,i:number)=>{const option=document.createElement('option');option.value=v.versionId;option.textContent=`Версия ${i+1} · ${new Date(v.createdAt).toLocaleString()}`;option.selected=v.versionId===version.versionId;select.append(option);});
  const address=new URL(location.href);address.searchParams.set('game',version.gameId);address.searchParams.set('version',version.versionId);window.history.replaceState(null,'',address);
  document.body.classList.remove('editing');const editor=el<HTMLDetailsElement>('create-more');editor.open=false;const bg = document.getElementById('back-game'); if (bg instanceof HTMLElement) bg.hidden = true;
  const gs = document.querySelector('.game-stage'); if (gs instanceof HTMLElement) gs.hidden = false;
  view('create');mount(version,session);syncArenaVersion(version.versionId);traceUi('ui.game_opened');
  (window as unknown as {_yaplixReadyVersion?: string})._yaplixReadyVersion = version.versionId;
  const mobileHint = document.getElementById('mobile-empty-hint'); if (mobileHint instanceof HTMLElement) mobileHint.hidden = true;
  const completedGenerationOfTrackedJob = Boolean(trackedJobId && lastJobs?.some(j => j.jobId === trackedJobId && j.versionId === version.versionId));
  if (!completedGenerationOfTrackedJob) { trackedJobId = null; genCancelJobId = ''; pendingSubmitKey = null; }
  el('gen-title').textContent = completedGenerationOfTrackedJob ? 'Игра готова' : 'Текущая игра';
  if (!completedGenerationOfTrackedJob) el('gen-stage').textContent = 'Игра открыта · запускайте при готовности';
  el('gen-model').textContent = version.provider==='chatgpt'?'ChatGPT · GPT-6.1 Sol Medium':version.provider==='openrouter'?'OpenRouter Free':'Ollama Cloud';
  el('gen-result').textContent = '';
  genStartedAt = 0; setGenState('ready');
  void Promise.allSettled([stats(version),list(signal)]).then(results=>{
    if(signal?.aborted)return;
    if(results.some(result=>result.status==='rejected'))notify('Игра открыта, но не удалось обновить статистику или список сохранённых игр.',true);
  });
}
const providerSelect=el<HTMLSelectElement>('provider-mode'),editProviderSelect=el<HTMLSelectElement>('edit-provider-mode');
function syncCreateAvailability(){const configured=providerConfiguration.has(providerSelect.value)?providerConfiguration.get(providerSelect.value)!:null;el<HTMLButtonElement>('generate').disabled=busy||genState==='working'||configured===false||el<HTMLTextAreaElement>('prompt').value.trim().length<2;}
for(const select of [providerSelect,editProviderSelect])for(const option of select.options){const item=modelForMode(option.value);if(item)option.textContent=item.label;}
let restoredMode='ollama-cloud';try{const saved=localStorage.getItem('yaplix-provider-mode');if(saved&&modelForMode(saved))restoredMode=saved;}catch{}
providerSelect.value=restoredMode;
editProviderSelect.value=providerSelect.value;
for(const select of [providerSelect,editProviderSelect])select.addEventListener('change',()=>{
  providerSelect.value=editProviderSelect.value=select.value;
  try{localStorage.setItem('yaplix-provider-mode',select.value);}catch{}
  modelReadiness='NOT_CHECKED';traceModel('model.selection_changed',select.value,{reasonCode:'USER_SELECTION',readiness:'NOT_CHECKED'});renderModelConnectionStatus();
  syncCreateAvailability();syncEditorAvailability();
});
const modelEntry=(mode:string)=>modelForMode(mode)!;
function modelTraceId(){
 try{const saved=localStorage.getItem('yaplix-model-trace-id');if(saved&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))return saved;}catch{}
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;try{localStorage.setItem('yaplix-model-trace-id',id);}catch{}return id;
}
const modelTrace=modelTraceId();
function traceModel(event:string,mode:string,details:Record<string,unknown>={}){const entry=modelEntry(mode);void fetch('/api/model-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({traceId:modelTrace,event,mode:entry.mode,model:entry.model,...details})}).catch(()=>{});}
traceModel('model.catalog_loaded',restoredMode,{reasonCode:'STATIC_CATALOG',readiness:'NOT_CHECKED'});traceModel('model.selection_restored',restoredMode,{reasonCode:'LOCAL_STORAGE',readiness:'NOT_CHECKED'});
function renderModelConnectionStatus(reason?:string){
 const mode=providerSelect.value,entry=modelEntry(mode),configured=providerConfiguration.get(mode);
 const text=reason??(configured===false?`${entry.label}: ключ не настроен. Выбор сохранён; настройте подключение на сервере и перезапустите YAPLIX.`:configured===true?`${entry.label}: ключ настроен; доступность ещё не проверена.`:`${entry.label}: проверка подключения ещё не выполнялась.`);
 el<HTMLElement>('model-connection-status').textContent=text;
}
async function checkModelConnection(mode=providerSelect.value){
 const entry=modelEntry(mode),started=performance.now();el<HTMLElement>('model-connection-status').textContent=`Проверяем подключение ${entry.label}…`;
 try{
  const status=await api(`/api/providers/${entry.mode}/check`) as {configured:boolean;ready:boolean;state:string;reasonCode:string|null};
  modelReadiness=status.state;providerConfiguration.set(mode,status.configured);const reasonCode=status.reasonCode??undefined;
  syncCreateAvailability();syncEditorAvailability();
  const text=status.state==='dynamic_upstream_ready'?`${entry.label}: соединение доступно; бесплатный upstream выберется при генерации. Успешный inference ещё не проверен.`:status.ready?`${entry.label}: каталог модели доступен. Генерация будет подтверждена только после реального запроса.`:reasonCode==='PROVIDER_NOT_CONFIGURED'?`${entry.label}: ключ не настроен. Выбор сохранён; добавьте ключ в настройки сервера и перезапустите YAPLIX.`:reasonCode==='MODEL_NOT_AVAILABLE'?`${entry.label}: провайдер не сообщил эту модель. Выбор сохранён; проверьте маршрут провайдера.`:reasonCode==='AUTH_REQUIRED'?'Подключите ChatGPT на этом компьютере. Выбор сохранён; задание не отправлено.':`${entry.label}: соединение недоступно (${reasonCode??'PROVIDER_UNREACHABLE'}). Выбор сохранён; проверьте настройки сети и повторите проверку.`;
  renderModelConnectionStatus(text);traceModel('model.connection_checked',mode,{configured:status.configured,readiness:status.state,reasonCode:reasonCode??'CONNECTION_CHECKED',durationMs:Math.round(performance.now()-started)});return status.ready;
 }catch(error){modelReadiness='unreachable';const code=error&&typeof error==='object'?apiFailureCodes.get(error)??'PROVIDER_CHECK_FAILED':'PROVIDER_CHECK_FAILED';renderModelConnectionStatus(`${entry.label}: не удалось проверить подключение (${code}). Выбор сохранён; генерация не отправлена.`);traceModel('model.connection_checked',mode,{configured:providerConfiguration.get(mode)??false,readiness:'unreachable',reasonCode:code,durationMs:Math.round(performance.now()-started)});return false;}
}
el<HTMLButtonElement>('check-provider').addEventListener('click',()=>void checkModelConnection());renderModelConnectionStatus();
async function refreshProviderConfiguration(){
 try{const data=await api('/api/providers');
  for(const item of MODEL_CATALOG){const state=data.providers.find((p:{mode:string})=>p.mode===item.mode);providerConfiguration.set(item.mode,state?.configured===true);}
  const maxJobMinutes=data.timeouts.jobMs/60000,singlePostMinutes=Math.min(maxJobMinutes,35);
  el('mode-help').textContent+=' Лимит ответа: '+data.timeouts.responseMs/60000+' мин; задание: до '+maxJobMinutes+' мин для Ollama Cloud и до '+singlePostMinutes+' мин для OpenRouter/ChatGPT. Закрытие вкладки не отменяет задание.';
 }catch{/* Configuration remains unknown; explicit submission reports its own failure. */}
 renderModelConnectionStatus();
 syncCreateAvailability();
 syncEditorAvailability();
}
async function refreshChatGpt(){
 try{
  const status=await api('/api/chatgpt/status');chatgptConnected=status.connected===true;
  const errorCode=typeof status.error==='string'?status.error:null;
  const errorLabel=errorCode?(errors[errorCode]??(()=>{const match=/^SIWC_(DISCOVERY|TOKEN|JWKS)_HTTP_(\d{3})$/.exec(errorCode);return match?`${match[1]==='TOKEN'?'Обмен токена':match[1]==='DISCOVERY'?'Поиск настроек входа':'Проверка ключей подписи'} вернул HTTP ${match[2]}.`:''})()):'';
  const label=!status.available?'Личный ChatGPT недоступен в LAN, HTTPS и Telegram.':status.state==='CONNECTING'?'ChatGPT: подключение…':status.state==='EXPIRED'?'ChatGPT: авторизация истекла. Подключитесь заново.':status.state==='ERROR'?`ChatGPT: подключение не выполнено${errorCode?' ('+errorCode+')':''}. ${errorLabel||'Повторите вручную.'}`:chatgptConnected?'ChatGPT: подключён':'ChatGPT: не подключён';
  el('chatgpt-status').textContent=label;
  const compact=el('chatgpt-state');if(compact)compact.textContent=label.replace(/^ChatGPT:\s*/,'ИИ: ');
  el('chatgpt-status').title=label;
  el('chatgpt-connect').hidden=!status.available||chatgptConnected||status.state==='CONNECTING';
  el('chatgpt-disconnect').hidden=!status.available||!chatgptConnected&&status.state!=='CONNECTING';
 }catch{chatgptConnected=false;el('chatgpt-status').textContent='ChatGPT: статус не подтверждён';const compact=el('chatgpt-state');if(compact)compact.textContent='ИИ: статус не подтверждён';}
}
el('chatgpt-connect').addEventListener('click',()=>void attempt(async()=>{await api('/api/chatgpt/connect',{});await refreshChatGpt();}));
el('chatgpt-disconnect').addEventListener('click',()=>void attempt(async()=>{await api('/api/chatgpt/disconnect',{});await refreshChatGpt();}));
el('chatgpt-why')?.addEventListener('click',()=>{const note=el('chatgpt-note');note.hidden=!note.hidden;});
const submitting=new Set<string>();
function syncEditorAvailability(){
 const versionId=current?.versionId,providerMode=editProviderSelect.value,configured=providerConfiguration.has(providerMode)?providerConfiguration.get(providerMode)!:null;
 const instructionReady=el<HTMLTextAreaElement>('change').value.trim().length>=2;
 const tracked=trackedJobId?(lastJobs??[]).find(job=>job.jobId===trackedJobId):undefined;
 const activeEdit=submitting.has('improve')||Boolean(tracked?.previousVersionId&&['queued','generating','repairing','validating'].includes(tracked.stage));
 const activeJob=submitting.has('improve')||Boolean(trackedJobId&&genState==='working');
 let reasonCode='READY';
 if(!versionId)reasonCode='NO_VERSION_SELECTED';
 else if(busy)reasonCode='UI_ACTION_IN_PROGRESS';
 else if(activeEdit||activeJob)reasonCode='EDIT_IN_PROGRESS';
 else if(!instructionReady)reasonCode='INSTRUCTION_REQUIRED';
 else if(configured===false)reasonCode='PROVIDER_NOT_CONFIGURED';
 else if(configured===null)reasonCode='READY_PROVIDER_UNVERIFIED';
 const enabled=Boolean(versionId)&&!busy&&!activeEdit&&!activeJob&&instructionReady&&configured!==false;
 const button=el<HTMLButtonElement>('improve');button.disabled=!enabled;
 const status=el<HTMLElement>('edit-status');
 status.textContent=reasonCode==='NO_VERSION_SELECTED'?'Сначала откройте сохранённую игру.':reasonCode==='UI_ACTION_IN_PROGRESS'?'Подождите, пока игра откроется.':reasonCode==='EDIT_IN_PROGRESS'?'Дождитесь завершения текущего изменения.':reasonCode==='INSTRUCTION_REQUIRED'?'Введите, что нужно изменить.':reasonCode==='PROVIDER_NOT_CONFIGURED'?'Выбранный провайдер не настроен.':reasonCode==='READY_PROVIDER_UNVERIFIED'?'Провайдер настроен; подключение проверится при отправке.':'';
 const signature=JSON.stringify([versionId??null,reasonCode,providerMode,configured,instructionReady,busy,activeEdit,document.body.classList.contains('editing')]);
 if(versionId&&signature!==lastEditorState){lastEditorState=signature;traceUi('ui.editor_state',{reasonCode,selectedVersion:true,providerMode,providerConfigured:configured,providerReadiness:configured===true?'NOT_CHECKED':configured===false?'NOT_CONFIGURED':'UNKNOWN',uiBusy:busy,activeEdit,instructionReady});}
}
el<HTMLTextAreaElement>('change').addEventListener('input',syncEditorAvailability);
async function submitJob(buttonId:string,text:string,previousVersionId?:string){
  const selectedMode=(previousVersionId?editProviderSelect:providerSelect).value;
  if(providerConfiguration.get(selectedMode)===false){const item=modelEntry(selectedMode),reason='PROVIDER_NOT_CONFIGURED';const text=`${item.label}: ключ не настроен. Выбор сохранён; настройте подключение на сервере и перезапустите YAPLIX.`;renderModelConnectionStatus(text);message.textContent=text;traceModel('model.generation_blocked',selectedMode,{configured:false,readiness:'not_configured',reasonCode:reason});return;}
  if(selectedMode==='chatgpt')await refreshChatGpt();
  if(!await checkModelConnection(selectedMode)){const reason=modelReadiness==='auth_required'?'AUTH_REQUIRED':modelReadiness==='not_configured'?'PROVIDER_NOT_CONFIGURED':modelReadiness==='model_missing'?'MODEL_NOT_AVAILABLE':'PROVIDER_UNREACHABLE';traceModel('model.generation_blocked',selectedMode,{configured:providerConfiguration.get(selectedMode)??false,readiness:modelReadiness,reasonCode:reason});message.textContent=el<HTMLElement>('model-connection-status').textContent;return;}
  if(submitting.has(buttonId))return;submitting.add(buttonId);const button=el<HTMLButtonElement>(buttonId);button.disabled=true;syncEditorAvailability();
  const request={spec:spec(text),mode:'live',providerMode:(previousVersionId?editProviderSelect:providerSelect).value,...(previousVersionId?{previousVersionId}:{}),telegramConsent:Boolean(telegramToken&&el<HTMLInputElement>('telegram-notify').checked)};
  // randomUUID is unavailable on private-IP HTTP LAN; getRandomValues works there.
  const bytes=crypto.getRandomValues(new Uint8Array(16));let key=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');try{const old=JSON.parse(sessionStorage.getItem('yaplix-pending-'+buttonId)??'null');if(old?.request===JSON.stringify(request))key=old.key;sessionStorage.setItem('yaplix-pending-'+buttonId,JSON.stringify({key,request:JSON.stringify(request)}));}catch{}
  try{
    const editingJob = Boolean(previousVersionId);
    const mobileHint = document.getElementById('mobile-empty-hint'); if (mobileHint instanceof HTMLElement) mobileHint.hidden = true;
    trackedJobId = null; genCancelJobId = ''; pendingSubmitKey = null;
    genStartedAt = editingJob ? 0 : Date.now();
    el('gen-model').textContent = (previousVersionId?editProviderSelect:providerSelect).value==='chatgpt'?'ChatGPT · GPT-6.1 Sol Medium':(previousVersionId?editProviderSelect:providerSelect).value==='openrouter'?'OpenRouter Free':'Ollama Cloud';
    el('gen-time').textContent = '0 с';
    el('gen-title').textContent = editingJob ? 'Создаём следующую версию' : 'Создаём вашу игру';
    el('gen-stage').textContent = 'Задание создано · отправляем на сервер';
    el('gen-result').textContent = '';
    view('create'); setGenState('working');
    el('job-status').textContent = editingJob ? 'Новая версия отправлена. Ожидаем статусы сервера…' : 'Задание отправлено. Ожидаем статусы сервера…';
    const created = await api('/api/jobs',{...request,idempotencyKey:key}) as {jobId:string};
    traceModel('model.job_created',selectedMode,{configured:true,readiness:modelReadiness,reasonCode:'JOB_CREATED',jobId:created.jobId});
    pendingSubmitKey = key;
    trackedJobId = created.jobId;
    syncEditorAvailability();
    try{sessionStorage.removeItem('yaplix-pending-'+buttonId);}catch{}
    notify('Задание отправлено. Процесс — справа.');
    void pollJobs();
  }
  catch(error){
    notify((error as Error).message, true);
    pendingSubmitKey = null;
    if (!(action?.signal.aborted)) { genStartedAt = 0; setGenState('idle'); el('job-status').textContent = 'Задание не создано: сервер недоступен или отклонил запрос.'; }
  }
  finally{submitting.delete(buttonId);syncCreateAvailability();syncEditorAvailability();}
}
async function cancelTrackedJob(){if(!genCancelJobId)return;await api('/api/jobs/'+genCancelJobId+'/cancel',{});el('gen-stage').textContent='Отменяем задание…';await pollJobs();}
el('gen-cancel').addEventListener('click',()=>void attempt(cancelTrackedJob));
const jobCancelButton=document.getElementById('job-cancel');jobCancelButton?.addEventListener('click',()=>void attempt(cancelTrackedJob));
el('gen-launch').addEventListener('click',()=>{if(current)void attempt(signal=>play(current!,signal), true);});
el<HTMLFormElement>('create').addEventListener('submit',event=>{event.preventDefault();void submitJob('generate',prompt.value);});
el<HTMLFormElement>('iterate').addEventListener('submit',event=>{event.preventDefault();if(current)void submitJob('improve',el<HTMLTextAreaElement>('change').value,current.versionId);});
async function phoneFor(versionId:string){if(phoneOpening)return;phoneOpening=true;try{el('phone').dataset.version=versionId;view('library');el<HTMLDetailsElement>('phone').open=true;const path='/runtime/phone-connect-ui.js';await(await import(path)).connectPhone(versionId);(el('phone-ready').hidden?el('phone'):el('phone-qr')).scrollIntoView({block:'center'});}finally{phoneOpening=false;}}
el('phone-game').addEventListener('click',()=>{if(current)void attempt(()=>phoneFor(current!.versionId));});
el('arena-game').addEventListener('click',()=>{if(current){syncArenaVersion(current.versionId);}view('arena');});

// --- UI-002C: Арена в основной навигации (существующий backend, без новых контрактов) ---
let arenaRoomId = '';
function syncArenaVersion(versionId?: string) {
  const sel = el<HTMLSelectElement>('arena-version');
  if (!sel) return;
  if (versionId && ![...sel.options].some(o => o.value === versionId)) {
    const label = current && current.versionId === versionId
      ? (el('game-title').textContent || versionId.slice(0, 8))
      : versionId.slice(0, 8);
    const opt = document.createElement('option');
    opt.value = versionId; opt.textContent = 'Текущая · ' + label;
    sel.append(opt);
  }
  if (versionId) sel.value = versionId;
  if (!sel.value && current) sel.value = current.versionId;
}
const arenaErrors: Record<string,string> = {
  ARENA_UNSUPPORTED:'Рейтинг недоступен для этой версии. Нужна Arena-совместимая версия со счётом и завершением партии.',
  ARENA_LOCAL_ONLY:'Arena включается только из локального окна YAPLIX на компьютере.',
  ARENA_CLOSED:'Комната закрыта или срок доступа истёк. Результаты сохранены у ведущего.',
  ARENA_NICKNAME:'Ник: 2–24 символа, буквы, цифры, пробел, точка, дефис или подчёркивание.',
  ARENA_NICKNAME_TAKEN:'Этот ник уже занят. Выберите другой; существующие рекорды остаются у прежнего участника.',
  ARENA_INVITE_REQUIRED:'Нужна актуальная QR-ссылка ведущего.',
  ARENA_ACCESS_REQUIRED:'Отсканируйте QR и введите ник.',
  PHONE_NO_NETWORK:'Активная частная сеть не найдена. Подключите компьютер и телефоны к одной доверенной сети.',
  PHONE_CHOOSE_NETWORK:'Выберите сеть участников.',
  HOST_NOT_AVAILABLE:'Адрес сети недоступен. Обновите список.',
  PORT_IN_USE:'Фиксированный порт Arena занят. Освободите его или настройте YAPLIX_ARENA_PORT и перезапустите YAPLIX.',
  ARENA_SCORE_MISSING:'Игра не передала числовой счёт. Попытка не засчитана; нужна совместимая версия.',
  ARENA_ATTEMPT_ENDED:'Эта попытка уже завершена или заменена новой.',
  ARENA_ATTEMPT_RATE:'Подождите секунду перед новой попыткой.',
  RATE_LIMIT:'Слишком много запросов. Подождите и повторите действие.',
  ARENA_VERSION_MISMATCH:'Комната относится к другой версии. Выберите комнату этой версии.',
  ARENA_UNREACHABLE:'Страница Arena не открылась на выбранном адресе. Проверьте частную сеть.',
};
function arenaErrorText(code: unknown): string {
  if (typeof code === 'string' && code && arenaErrors[code]) return arenaErrors[code] + ' (код: ' + code + ')';
  return 'Действие не выполнено' + (typeof code === 'string' && code ? ' (код: ' + code + ')' : '') + '.';
}
async function arenaFetch(path: string, method = 'GET', body?: unknown): Promise<any> {
  const r = await fetch(path, { method, cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { const d = await r.json().catch(() => ({ error: r.status })); throw new Error(arenaErrorText(d.error)); }
  return r.json();
}
async function refreshArenaRoom(silent = false) {
  const st = el('arena-status'), room = el('arena-room-status');
  try {
    const sel = el<HTMLSelectElement>('arena-version');
    const vid = sel.value || current?.versionId || '';
    const data = await arenaFetch('/api/arena?versionId=' + encodeURIComponent(vid));
    const state = data.status as { enabled: boolean; roomId: string; expiresAt: number; url: string };
    el('arena-room').hidden = false;
    if (state.enabled) {
      arenaRoomId = state.roomId;
      st.textContent = 'Комната открыта до ' + new Date(state.expiresAt).toLocaleTimeString() + '.';
      room.textContent = 'Комната ' + state.roomId.slice(0, 8) + ' · вход открыт.';
      el<HTMLButtonElement>('arena-stop').disabled = false;
      const qr = await (await fetch('/api/arena/qr.svg', { cache: 'no-store' })).blob();
      const img = el<HTMLImageElement>('arena-qr');
      if (img.dataset.src) URL.revokeObjectURL(img.dataset.src);
      const url = URL.createObjectURL(qr); img.dataset.src = url; img.src = url;
      el<HTMLInputElement>('arena-url').value = state.url;
      el('arena-invite').hidden = false;
      const board = await arenaFetch('/api/arena/rooms/' + state.roomId);
      renderArenaBoard(board);
    } else {
      st.textContent = data.rooms?.length ? 'Есть сохранённые комнаты: ' + data.rooms.length + '. Выберите запуск.' : 'Комната не запущена.';
      room.textContent = 'Можно создать новую комнату для выбранной версии.';
      el<HTMLButtonElement>('arena-stop').disabled = true;
      el('arena-invite').hidden = true;
    }
    void arenaRoomId;
  } catch (e) { if (!silent) st.textContent = 'Арена недоступна: ' + (e as Error).message; }
}
function renderArenaBoard(board: { players: { place: number | null; nickname: string; bestScore: number | null }[] }) {
  const tb = el('arena-scores'); tb.replaceChildren();
  for (const pl of board.players) {
    const row = document.createElement('tr');
    const vals: unknown[] = [pl.place ?? '—', pl.nickname, pl.bestScore ?? 'Нет завершённой партии'];
    for (const v of vals) { const cell = document.createElement('td'); cell.textContent = String(v); row.append(cell); }
    tb.append(row);
  }
  el('arena-board-status').textContent = board.players.length ? 'Участников: ' + board.players.length + '.' : 'Пока нет результатов.';
}
el('arena-open')?.addEventListener('click', () => {
  const v = el<HTMLSelectElement>('arena-version').value || current?.versionId;
  if (!v) { el('arena-status').textContent = 'Сначала откройте игру в библиотеке.'; return; }
  void attempt(async signal => { view('create'); syncArenaVersion(v); await show(await readVersion(v, signal), signal); });
});
el('arena-refresh')?.addEventListener('click', () => void refreshArenaRoom());
el('arena-copy')?.addEventListener('click', () => {
  const input = el<HTMLInputElement>('arena-url'); input.focus(); input.select();
  void navigator.clipboard?.writeText(input.value).catch(() => {});
});
el('arena-dismiss')?.addEventListener('click', () => { el('arena-room').hidden = true; el('arena-status').textContent = 'Панель комнаты скрыта. Комната на сервере не изменялась; данные в рейтинге сохранены.'; });
el('arena-host')?.addEventListener('click', () => { el('arena-room').hidden = false; syncArenaVersion(current?.versionId); void refreshArenaRoom(); });
el('arena-start')?.addEventListener('click', () => void attempt(async () => {
  const versionId = el<HTMLSelectElement>('arena-version').value || current?.versionId;
  if (!versionId) throw new Error('Выберите игру для соревнования.');
  const nets = await arenaFetch('/api/arena?versionId=' + encodeURIComponent(versionId)) as { networks?: { address: string }[] };
  const addr = nets.networks?.[0]?.address;
  if (!addr) throw new Error('Нет частной сети для участников.');
  const res = await arenaFetch('/api/arena', 'POST', { versionId, address: addr }) as { roomId: string };
  arenaRoomId = res.roomId; await refreshArenaRoom();
  el('arena-status').textContent = 'Комната запущена. QR — ниже.';
}));
el('arena-stop')?.addEventListener('click', () => void attempt(async () => {
  await arenaFetch('/api/arena', 'DELETE', {}); arenaRoomId = '';
  el('arena-invite').hidden = true; await refreshArenaRoom();
}));
function setEditMode(editing: boolean) {
  document.body.classList.toggle('editing', editing);
  const stage = document.querySelector('.game-stage'); if (stage instanceof HTMLElement) stage.hidden = editing;
  el('game-toolbar').hidden = editing ? false : (genState !== 'ready' || !current);
  el('back-game').hidden = !editing;
  if (editing) { view('create'); const more = el<HTMLDetailsElement>('create-more'); if (more && !more.open) more.open = true; el('iterate').scrollIntoView({ block: 'center' }); el('change').focus(); }
  syncEditorAvailability();
}
el('edit-game').addEventListener('click',()=>setEditMode(true));
el('back-game').addEventListener('click',()=>setEditMode(false));
el('replay').addEventListener('click',()=>{if(current)void attempt(signal=>play(current!,signal));});
el('versions').addEventListener('change',()=>void attempt(async signal=>show(await readVersion(el<HTMLSelectElement>('versions').value,signal),signal)));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>{view(button.dataset.view!);}));
el('focus-game').addEventListener('click',()=>{const active=document.body.classList.toggle('game-focus');el('focus-game').textContent=active?'Обычный экран':'Игровой экран';});
el<HTMLAnchorElement>('export').addEventListener('click',()=>traceUi('ui.export_opened'));
let lastViewportTrace='';
function recordViewport(){const key=innerWidth+'x'+innerHeight;if(key===lastViewportTrace)return;lastViewportTrace=key;traceUi('ui.viewport_changed');}
window.addEventListener('resize',recordViewport,{passive:true});window.addEventListener('orientationchange',recordViewport,{passive:true});
window.addEventListener('error',event=>{
  const filename=event.filename||'';
  if(current&&(!filename||new URL(filename,location.href).origin===location.origin))traceUi('ui.host_error',{errorCode:'HOST_UI_ERROR',stack:event.error instanceof Error?event.error.stack??'':''});
});
window.addEventListener('unhandledrejection',event=>{if(current)traceUi('ui.host_error',{errorCode:'HOST_UI_ERROR',stack:event.reason instanceof Error?event.reason.stack??'':''});});
let diagnosing=false;
el('phone').addEventListener('toggle',()=>{if(el<HTMLDetailsElement>('phone').open&&!phoneOpening){const path='/runtime/phone-connect-ui.js';void import(path).then(module=>module.connectPhone()).catch(()=>{el('phone-status').textContent='Не удалось открыть подключение. Обновите страницу и проверьте сервер.';});}});
async function diagnose(){if(diagnosing)return;diagnosing=true;try{const path='/runtime/connection-ui.js';await (await import(path) as typeof import('./connection-ui.ts')).diagnose(telegramToken);}finally{diagnosing=false;}}
el('sys-refresh')?.addEventListener('click',()=>void attempt(async()=>{
  await diagnose();
  const sys = el('system-info').textContent || 'Статус не подтверждён.';
  el('sys-status').textContent = sys.slice(0, 220);
  const body = el('sys-body'); body.replaceChildren();
  const q = document.createElement('p'); q.textContent = sys; body.append(q);
  const lan = el('lan-instructions').textContent;
  if (lan) { const w = document.createElement('p'); w.textContent = lan; body.append(w); }
}));
el('system').addEventListener('toggle',()=>{if(el<HTMLDetailsElement>('system').open)void diagnose().catch(()=>{el('system-info').textContent='Статус не подтверждён. Проверьте сборку и доступность API.';});});
document.getElementById('diagnostics')?.addEventListener('click',()=>{view('library');el<HTMLDetailsElement>('system').open=true;void attempt(async()=>{await diagnose();el('system').scrollIntoView({block:'start'});});});
el('backup').addEventListener('click',()=>void attempt(async signal=>{const copy=await api('/api/backups',{},undefined,signal);el('backup-result').textContent=`Копия проверена и сохранена в .local/backups/${copy.filename}. SHA-256: ${copy.sha256}`;}));
el('share').addEventListener('click',()=>{if(current)void attempt(async signal=>{const shared=await api('/api/versions/'+current!.versionId+'/share',{},undefined,signal);const field=el<HTMLInputElement>('share-url');field.value=shared.url;field.hidden=false;field.focus();field.select();message.textContent='Ссылка открывает только эту игру на 7 дней. Создавайте её только для игры, которой хотите поделиться.';});});
window.addEventListener('offline',()=>{el('connection').hidden=false;});window.addEventListener('online',()=>{void api('/api/health').catch(()=>{el('connection').hidden=false;});});
try{const draft=sessionStorage.getItem('yaplix-draft');prompt.value=draft??'';}catch{prompt.value='';}
prompt.addEventListener('input',()=>{try{sessionStorage.setItem('yaplix-draft',prompt.value);}catch{}syncCreateAvailability();});
window.visualViewport?.addEventListener('resize',()=>{document.body.dataset.keyboard=String(innerHeight-visualViewport!.height-visualViewport!.offsetTop>150);});
const stageNames:Record<string,string>={retry_scheduled:'Автоматический повтор',waiting_for_provider:'Ожидание провайдера',failed_permanent:'Нужно действие',queued:'В очереди',generating:'Генерация',validating:'Проверка',repairing:'Исправление',completed:'Готово · игра создана',needs_attention:'Генерация не завершена',cancelled:'Отменено',failed:'Ошибка'};
let polling=false,pollTimer:ReturnType<typeof setTimeout>|undefined,toast:JobSummary|undefined,closed=false,toastTimer:ReturnType<typeof setTimeout>|undefined;
const importantToast=/истек|ошибк|не удалось|недоступен|не завершена|нужн[оое] действ/i;
function setToast(job:JobSummary|undefined){toast=job;const text=document.getElementById('job-toast-text'),open=document.getElementById('job-toast-open'),dismiss=document.getElementById('job-toast-dismiss');
 if(toastTimer){clearTimeout(toastTimer);toastTimer=undefined;}
 if(!text)return;
 text.textContent=toast?'Готово: '+toast.spec.prompt.slice(0,60)+' · открыть в списке справа.':'';
 if(open)open.hidden=!toast;
 if(dismiss)dismiss.hidden=!toast;
 if(toast&&!importantToast.test(toast.spec.prompt))toastTimer=setTimeout(()=>{if(!dismiss?.hidden)dismissToast();},7000);else if(toast&&dismiss)dismiss.hidden=false;
}
function openJob(job:JobSummary){if(job.versionId){const jp=document.getElementById('jobs-panel');if(jp)jp.hidden=true;return attempt(async signal=>{await api('/api/jobs/'+job.jobId+'/notification',{},undefined,signal);if(toast?.jobId===job.jobId)dismissToast();trackedJobId=job.jobId;view('create');await show(await readVersion(job.versionId!,signal),signal);notify(job.previousVersionId?'Новая версия сохранена.':'Игра сохранена. Можно играть.');await list();});}}
const ACTIVE_STAGES = ['queued','generating','repairing','validating'];
function stageLabel(job: JobSummary): string {
  if (job.recoveryState === 'retry_scheduled') return 'Повторная попытка запланирована';
  if (job.recoveryState === 'waiting_for_provider') return 'Ожидание провайдера';
  if (job.recoveryState === 'failed_permanent') return 'Нужно действие пользователя';
  switch (job.stage) {
    case 'queued': return 'В очереди на обработку';
    case 'generating': return 'Генерация игрового кода';
    case 'validating': return 'Проверка результата';
    case 'repairing': return 'Исправление формата';
    case 'completed': return 'Готово · игра создана';
    case 'needs_attention': return 'Генерация не завершена';
    case 'cancelled': return 'Задание отменено';
    case 'failed': return 'Ошибка генерации';
    default: return String(job.stage);
  }
}
function jobDuration(job: JobSummary): string {
  const ms = job.stage === 'queued' ? Math.max(0, Date.now() - Date.parse(job.updatedAt))
    : job.elapsedMs + (ACTIVE_STAGES.includes(job.stage) ? Math.max(0, Date.now() - Date.parse(job.updatedAt)) : 0);
  const sec = Math.floor(ms / 1000);
  return sec >= 60 ? Math.floor(sec/60) + ' мин ' + (sec%60) + ' с' : sec + ' с';
}
function providerLabel(mode?: string): string {
  return mode==='chatgpt'?'ChatGPT · GPT-6.1 Sol Medium':mode==='openrouter'?'OpenRouter Free':'Ollama Cloud';
}
function syncGenFromJobs(jobs:JobSummary[]) {
  lastJobs = jobs;
  // Трекинг этой сессии: pendingSubmitKey подтверждаем, когда задание видно в списке.
  if (pendingSubmitKey && genStartedAt !== 0 && jobs.some(j => j.jobId === trackedJobId)) pendingSubmitKey = null;
  // Восстановление после перезагрузки: adopt только активного задания и только
  // когда правая область не показывает игру (иначе старые задания её перезаписали бы).
  if (!trackedJobId && !current && genState !== 'ready') {
    const adopted = jobs.find(j => ACTIVE_STAGES.includes(j.stage))
      ?? jobs.find(j => ['needs_attention','failed','cancelled'].includes(j.stage) && j.canContinue);
    if (adopted) { trackedJobId = adopted.jobId; genStartedAt = Date.parse(adopted.createdAt) || Date.now(); }
  }
  const tracked = trackedJobId ? jobs.find(j => j.jobId === trackedJobId) : undefined;
  // Инфоблок — только по отслеживаемому заданию; чужие задания область не перезаписывают.
  if (tracked) {
    el('job-status').textContent = stageLabel(tracked) + ' · ' + jobDuration(tracked);
    el('job-meta').textContent = providerLabel(tracked.providerMode) + ' · попыток ' + tracked.attempts
      + ' · ' + new Date(tracked.createdAt).toLocaleString();
    if (ACTIVE_STAGES.includes(tracked.stage)) genCancelJobId = tracked.jobId;
    renderJobDetails(tracked);
  } else if (!trackedJobId && genState !== 'ready' && !current) {
    el('job-status').textContent = 'Нет активного задания.'; el('job-meta').textContent='';
  }
  if (tracked && ACTIVE_STAGES.includes(tracked.stage)) {
    // Рабочее состояние по подтверждённому статусу отслеживаемого задания.
    if (genStartedAt === 0) genStartedAt = Date.now();
    el('gen-model').textContent = providerLabel(tracked.providerMode);
    el('gen-stage').textContent = stageLabel(tracked) + ' · ' + jobDuration(tracked);
    el('gen-result').textContent = '';
    el<HTMLButtonElement>('gen-continue').hidden = true;
    setGenState('working');
    return;
  }
  // Терминал — только по отслеживаемому заданию; чужие задания область не трогают.
  if (tracked && trackedJobId && ['failed','cancelled','needs_attention','completed'].includes(tracked.stage)) {
    if (tracked.stage === 'completed' && tracked.versionId && genState === 'working') { genStartedAt=0;setGenState('ready'); }
    if (tracked.stage === 'completed' && !tracked.versionId) { trackedJobId = null; genCancelJobId = ''; pendingSubmitKey = null; }
  }
  if (tracked && trackedJobId && ['failed','cancelled','needs_attention'].includes(tracked.stage) && genState !== 'ready') {
    el('gen-title').textContent = 'Не получилось создать игру';
    el('gen-stage').textContent = stageLabel(tracked) + ' · ' + jobDuration(tracked);
    el('gen-model').textContent = providerLabel(tracked.providerMode);
    el('gen-result').textContent = (tracked.errorCode ? (errors[tracked.errorCode] ?? tracked.errorCode) : 'Подробности — в раскрываемом блоке ниже.');
    const continueButton=el<HTMLButtonElement>('gen-continue');continueButton.hidden=!tracked.canContinue;continueButton.disabled=!tracked.canContinue;
    setGenState('failed');
  }
}
el<HTMLButtonElement>('gen-continue').addEventListener('click',()=>{
  const jobId=trackedJobId;if(!jobId)return;
  void attempt(async signal=>{
    const button=el<HTMLButtonElement>('gen-continue');button.disabled=true;button.hidden=true;
    await api('/api/jobs/'+jobId+'/continue',{},undefined,signal);
    genStartedAt=Date.now();el('gen-title').textContent='Проверяем сохранённый результат';
    el('gen-stage').textContent='Задание продолжено · без потери черновика';setGenState('working');await pollJobs();
  },true);
});
function renderJobDetails(job: JobSummary) {
  const body = el('job-detail-body'); body.replaceChildren();
  const add = (t: string) => { const q = document.createElement('p'); q.textContent = t; body.append(q); };
  add('Задание ' + job.jobId);
  add('Этап: ' + stageLabel(job) + (job.recoveryState ? ' (' + job.recoveryState + ')' : ''));
  if (ACTIVE_STAGES.includes(job.stage)) {
    const cancelRow = document.createElement('p');
    const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.id = 'job-cancel';
    cancelButton.textContent = 'Отменить задание';
    cancelRow.append(cancelButton); body.append(cancelRow);
  }
  add('Маршрут: ' + (job.provider ?? 'не выбран') + ' · запрошено: ' + (job.requestedModel ?? 'нет') + ' · ответ: ' + (job.actualModel ?? 'не получен'));
  if (job.validation) add('Проверка: ' + (job.validation.level === 'FAILED' ? 'не пройдена' : job.validation.level === 'VERIFIED' ? 'пройдена частично' : 'не завершена'));
  const fails = job.history.filter(a => a.errorCode).slice(-3);
  if (fails.length) add('Предыдущие попытки: ' + fails.map(a => (a.provider||'?') + ' / ' + (a.model ?? a.requestedModel ?? '?') + ': ' + (errors[a.errorCode!] ?? a.errorCode)).join(' · '));
  if (job.errorCode) { const label=errors[job.errorCode]; add('Ошибка: ' + (label ?? job.errorCode) + (label ? ' (' + job.errorCode + ')' : '') + (job.retryAt ? ' · повтор после ' + new Date(job.retryAt).toLocaleTimeString() : '')); }
  const postCounts=document.createElement('p');postCounts.setAttribute('aria-live','polite');postCounts.textContent='Счётчики LLM POST появятся после загрузки диагностического отчёта.';body.append(postCounts);
  const reportButton=document.createElement('button');reportButton.type='button';reportButton.textContent='Скачать диагностический отчёт и показать счётчики POST';
  reportButton.addEventListener('click',()=>void attempt(async()=>{
    const response=await fetch('/api/jobs/'+job.jobId+'/diagnostics',{headers:telegramToken?{'X-Yaplix-Telegram-Session':telegramToken}:{}});if(!response.ok)throw new Error('Отчёт недоступен');
    const report=await response.json() as {llmPostDispatches?:unknown;llmPostHttpResponses?:unknown;llmPostUnknownOutcomes?:unknown};
    if([report.llmPostDispatches,report.llmPostHttpResponses,report.llmPostUnknownOutcomes].every(value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0))postCounts.textContent=`LLM POST: отправлено ${report.llmPostDispatches}; получено HTTP-ответов ${report.llmPostHttpResponses}; исход неизвестен ${report.llmPostUnknownOutcomes}.`;
    else postCounts.textContent='Счётчики LLM POST недоступны в диагностическом отчёте.';
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='yaplix-diagnostics-'+job.jobId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));body.append(reportButton);
  if (!job.checkpointBytes && !job.errorCode && !fails.length) add('Деталей пока нет — задание только создано.');
  renderJobHistory();
}
function renderJobHistory() {
  const box = document.getElementById('job-history-list');
  if (!box) return;
  box.replaceChildren();
  fetch('/api/jobs', { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then(r => r.json()).then((d: { jobs: JobSummary[] }) => {
    const jobs = d.jobs.slice(0, 5);
    if (!jobs.length) { const q = document.createElement('p'); q.textContent = 'Пока пусто.'; box.append(q); return; }
    for (const j of jobs) {
      const row = document.createElement('p');
      row.textContent = stageLabel(j) + ' · ' + j.spec.prompt.slice(0, 60) + ' · ' + jobDuration(j);
      box.append(row);
    }
  }).catch(() => { const q = document.createElement('p'); q.textContent = 'История недоступна.'; box.append(q); });
}
function renderJobs(jobs:JobSummary[]){
  const toggle = document.getElementById('jobs-toggle');
  if (toggle) { const count=jobs.filter(j=>['queued','generating','repairing','validating'].includes(j.stage)).length;const label=toggle.querySelector('.btn-text'),caption='Задания'+(count?' ('+count+')':'');if(label)label.textContent=caption;else toggle.textContent=caption; }
  syncGenFromJobs(jobs);
  const container=el('jobs-list');const expanded=new Set(Array.from(container.querySelectorAll<HTMLElement>('article')).filter(row=>row.querySelector('details')?.open).map(row=>row.dataset.job));container.replaceChildren();if(!jobs.length)container.textContent='Заданий пока нет.';
  for(const job of jobs){const row=document.createElement('article');row.dataset.job=job.jobId;const title=document.createElement('strong');title.textContent=job.spec.prompt;const status=document.createElement('p');const duration=job.stage==='queued'?Math.max(0,Date.now()-Date.parse(job.updatedAt)):job.elapsedMs+(['generating','repairing','validating'].includes(job.stage)?Math.max(0,Date.now()-Date.parse(job.updatedAt)):0);const seconds=Math.floor(duration/1000),durationText=seconds>=60?`${Math.floor(seconds/60)} мин ${seconds%60} с`:`${seconds} с`;status.textContent=(job.providerMode==='chatgpt'&&job.stage==='generating'?`ChatGPT создаёт игру · ${durationText} · попыток ${job.attempts}`:(job.providerMode?({auto:'Ollama Cloud (прежний Auto)','ollama-cloud':'Ollama Cloud',openrouter:'OpenRouter Free',chatgpt:'ChatGPT · GPT-6.1 Sol Medium'}[job.providerMode]+' · '):'')+`${stageNames[job.recoveryState??job.stage]} · ${durationText} · попыток ${job.attempts}`);row.append(title,status);{const details=document.createElement('details'),summary=document.createElement('summary'),model=document.createElement('p');summary.textContent='Диагностика';details.open=expanded.has(job.jobId);const download=document.createElement('button');download.type='button';download.textContent='Скачать отчёт';download.addEventListener('click',()=>void attempt(async()=>{const response=await fetch('/api/jobs/'+job.jobId+'/diagnostics',{headers:telegramToken?{'X-Yaplix-Telegram-Session':telegramToken}:{}});if(!response.ok)throw new Error('Отчёт недоступен');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='yaplix-diagnostics-'+job.jobId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));model.textContent='Маршрут: '+(job.provider??'не выбран')+'; запрошено: '+(job.requestedModel??'нет')+'; ответ: '+(job.actualModel??'не получен');details.append(summary,model,download);row.append(details);}
    if(job.diagnosticsUnavailable){const warning=document.createElement('p');warning.textContent='Подробный trace недоступен. Этап и код ошибки сохранены в отчёте.';row.append(warning);}
    if(job.validation){const validation=document.createElement('p');validation.textContent=job.validation.level==='FAILED'?'Обнаружена ошибка при проверке игры.':job.validation.level==='VERIFIED'?'Техническая проверка пройдена; полная механика не подтверждена.':'Проверка не завершена.';row.append(validation);}
    const failures=job.history.filter(attempt=>attempt.errorCode).slice(-3);if(failures.length){const reasons=document.createElement('p');reasons.className='muted';reasons.textContent='Предыдущие попытки: '+failures.map(attempt=>`${attempt.provider} / ${attempt.model??attempt.requestedModel}: ${errors[attempt.errorCode!]??attempt.errorCode}`).join(' · ');const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Диагностика попыток';details.append(summary,reasons);row.append(details);}
    if(job.errorCode){const error=document.createElement('p');error.textContent=(errors[job.errorCode]??`Черновик сохранён (${job.errorCode}).`)+(job.retryAt?' Повтор после '+new Date(job.retryAt).toLocaleTimeString()+'.':'');row.append(error);}
    const actions=document.createElement('div');actions.className='actions';const add=(label:string,work:()=>Promise<unknown>|void)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>{button.disabled=true;void Promise.resolve().then(work).then(()=>pollJobs()).catch(error=>{message.textContent=error.message;button.disabled=false;});});actions.append(button);return button;};
      if(job.stage==='completed'){add('Играть',()=>openJob(job));add('Изменить',async()=>{await openJob(job);const more=el<HTMLDetailsElement>('create-more');if(more&&!more.open)more.open=true;el('iterate').scrollIntoView({block:'center'});el('change').focus();});add('На телефон',()=>phoneFor(job.versionId!));const download=document.createElement('a');download.textContent='Скачать HTML';download.href='/api/versions/'+job.versionId+'/export';download.download='game.html';actions.append(download);}
    else if(['needs_attention','failed','cancelled'].includes(job.stage)){const button=add('Продолжить генерацию',()=>api('/api/jobs/'+job.jobId+'/continue',{}));button.disabled=!job.canContinue;}
    else add('Отменить задание',()=>api('/api/jobs/'+job.jobId+'/cancel',{}));
    if(job.validation?.level==='NOT_VERIFIED'&&job.validation.code==='BROWSER_CHECK_INCONCLUSIVE'&&job.stage==='needs_attention'){const preview=document.createElement('a');preview.textContent='Предпросмотр · NOT_VERIFIED';preview.href='/api/jobs/'+job.jobId+'/preview';preview.target='_blank';preview.rel='noopener noreferrer';actions.append(preview);}
    if(job.checkpointBytes)add('Скачать черновик',async()=>{const draft=await api('/api/jobs/'+job.jobId);const url=URL.createObjectURL(new Blob([draft.checkpoint],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='yaplix-draft-'+job.jobId+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    row.append(actions);container.append(row);
  }
}
async function pollJobs(){
  if(polling||closed||document.hidden)return;polling=true;
  try{await refreshChatGpt();const{jobs}=await api('/api/jobs') as {jobs:JobSummary[]};lastJobs=jobs;renderJobs(jobs);const trackedActive=trackedJobId&&jobs.some(j=>j.jobId===trackedJobId&&ACTIVE_STAGES.includes(j.stage));if(!toast&&!trackedActive){for(const job of jobs){if(job.stage==='completed'&&!job.notificationClaimed){const claim=await api('/api/jobs/'+job.jobId+'/notification',{});if(claim.claimed){if(trackedJobId===job.jobId&&job.versionId&&!current){await show(await readVersion(job.versionId),undefined);notify('Игра готова. Можно играть.');}else{setToast(job);}await list();break;}}}}}
  catch{/* The next bounded poll restores server state; keep the active game. */}
  finally{polling=false;clearTimeout(pollTimer);if(!closed)pollTimer=setTimeout(()=>void pollJobs(),2000);}
}
function dismissToast(){if(toastTimer){clearTimeout(toastTimer);toastTimer=undefined;}toast=undefined;const text=document.getElementById('job-toast-text'),open=document.getElementById('job-toast-open'),dismiss=document.getElementById('job-toast-dismiss');if(text)text.textContent='';if(open)open.hidden=true;if(dismiss)dismiss.hidden=true;void pollJobs();}
document.getElementById('job-toast-open')?.addEventListener('click',()=>{if(toast)openJob(toast);dismissToast();});document.getElementById('job-toast-dismiss')?.addEventListener('click',dismissToast);
document.getElementById('jobs-toggle')?.addEventListener('click',()=>{const jp=el('jobs-panel');jp.hidden=!jp.hidden;void pollJobs();});
document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);if(!document.hidden)void pollJobs();});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(pollTimer);unmount?.();unmount=undefined;});window.addEventListener('pageshow',()=>{if(closed){closed=false;void pollJobs();}});
async function boot(){
  if(document.body.dataset.entry!=='telegram'&&location.hostname==='127.0.0.1'){const path='/runtime/lan-setup-ui.js';void import(path).then(module=>module.mountLanSetup(el('service-body'))).catch(()=>{});}
  if(document.body.dataset.entry==='telegram'){const path='/runtime/telegram-ui.js';telegramToken=await (await import(path) as typeof import('./telegram-ui.ts')).initializeTelegram();el('telegram-notify-label').hidden=false;}
  await refreshProviderConfiguration();await list();void pollJobs();const params=new URL(location.href).searchParams,selected=params.get('game');if(params.get('view')==='create')view('create');if(selected&&/^[0-9a-f-]{36}$/.test(selected))await attempt(async signal=>{const history=await api('/api/games/'+selected,undefined,undefined,signal);const requested=params.get('version');const latest=requested?history.versions.find((v:GameVersion)=>v.versionId===requested):history.versions.at(-1);if(!latest)throw new Error('Версия отсутствует в этой игре.');await show(await readVersion(latest.versionId,signal),signal);},false);
}
void boot().then(()=>{document.body.dataset.ready='true';}).catch(error=>{message.textContent=error.message;document.body.dataset.ready='true';});
