type State = { enabled: boolean; url?: string; versionId?: string; expiresAt?: number; lastOpenedAt?: number; networks?: { name: string; address: string }[] };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let image: string | undefined, pending = false, initialized = false, expiry: ReturnType<typeof setTimeout> | undefined;
let lastDesktopVersion: string | undefined;
const errors: Record<string,string> = {
  PHONE_NO_NETWORK:'Активная сеть Wi-Fi/Ethernet не найдена. Подключите компьютер к маршрутизатору и повторите.',
  PHONE_NETWORK_CHECK_FAILED:'Не удалось определить активную сеть. Проверьте подключение Wi-Fi/Ethernet и повторите.',
  PHONE_CHOOSE_NETWORK:'Выберите сеть, к которой подключён телефон.',
  PHONE_LOCAL_ONLY:'Подключение телефона включается из локального окна YAPLIX на компьютере.',
  HOST_NOT_AVAILABLE:'Адрес сети изменился. Обновите список сетей.',
  PHONE_SERVER_UNREACHABLE:'Не удалось открыть страницу в выбранной сети. Проверьте сеть и VPN.',
  PHONE_ACCESS_EXPIRED:'Доступ истёк. Обновите подключение.',
  PHONE_BUSY:'Подключение ещё обновляется. Повторите через несколько секунд.'
};
function release() { clearTimeout(expiry); if (image) URL.revokeObjectURL(image); image = undefined; el<HTMLImageElement>('phone-qr').removeAttribute('src'); el('phone-ready').hidden = true; }
async function api(path: string, method = 'GET', body?: object) {
  const response = await fetch(path, { method, signal: AbortSignal.timeout(12000), cache:'no-store', ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}) });
  if (!response.ok) { const result = await response.json(); throw new Error(errors[result.error] ?? 'Подключение недоступно: '+result.error); }
  return response;
}
async function render(state: State) {
  release(); el<HTMLButtonElement>('phone-off').disabled = !state.enabled;
  if (!state.enabled) { el('phone-status').textContent='Общий доступ выключен.'; return; }
  const response = await api('/api/phone/qr.svg');
  image = URL.createObjectURL(await response.blob()); el<HTMLImageElement>('phone-qr').src = image;
  el<HTMLInputElement>('phone-url').value=state.url!; el('phone-ready').hidden=false;
  el('phone-status').textContent='Страница проверена с компьютера. Доступ до '+new Date(state.expiresAt!).toLocaleTimeString()+'. '+(state.lastOpenedAt?'Выбранная версия запрошена: '+new Date(state.lastOpenedAt).toLocaleTimeString()+'.':'Подключение телефона пока не подтверждено.');
  expiry=setTimeout(()=>{release();el('phone-status').textContent='Временный доступ истёк. Обновите подключение.';},Math.max(0,state.expiresAt!-Date.now()));
}
async function run(work: () => Promise<void>) {
  if (pending) return; pending=true;
  for (const id of ['phone-refresh','phone-networks','phone-off','phone-version','phone-network']) el<HTMLButtonElement | HTMLSelectElement>(id).disabled=true;
  try { await work(); } catch(error) { release(); el('phone-status').textContent=(error as Error).message; }
  finally { pending=false; for(const id of ['phone-refresh','phone-networks','phone-off','phone-version','phone-network'])el<HTMLButtonElement | HTMLSelectElement>(id).disabled=false; }
}
async function load() {
  const [state, library] = await Promise.all([(await api('/api/phone')).json(), (await api('/api/games')).json()]);
  const networks = el<HTMLSelectElement>('phone-network'), chosen = networks.value || (state.url ? new URL(state.url).hostname : '');
  networks.replaceChildren();
  if (state.networks.length > 1) networks.add(new Option('Выберите вашу сеть', ''));
  for (const n of state.networks) networks.add(new Option(n.name+' · '+n.address, n.address));
  if (chosen && state.networks.some((n: {address:string})=>n.address===chosen)) networks.value=chosen;
  el('phone-network-label').hidden = state.networks.length < 2;
  const versions = el<HTMLSelectElement>('phone-version'), desktop = el('phone').dataset.version;
  const selected = desktop && desktop!==lastDesktopVersion ? desktop : versions.value || desktop || state.versionId;
  lastDesktopVersion = desktop;
  versions.replaceChildren();
  for (const v of library.games) versions.add(new Option(v.spec.prompt, v.versionId));
  if (selected && library.games.some((v:{versionId:string})=>v.versionId===selected)) versions.value=selected;
  else if(selected && selected===el('phone').dataset.version) { // An older explicitly open version is also shareable.
    const v=await(await api('/api/versions/'+selected)).json(); versions.add(new Option(v.spec.prompt+' · открытая версия',selected)); versions.value=selected;
  }
  return state as State;
}
async function enable() {
  const versionId=el<HTMLSelectElement>('phone-version').value;
  if (!versionId) throw new Error('Сначала создайте или откройте сохранённую игру на компьютере.');
  const address=el<HTMLSelectElement>('phone-network').value;
  if(el<HTMLSelectElement>('phone-network').options.length>1&&!address)throw new Error(errors.PHONE_CHOOSE_NETWORK);
  const state=await(await api('/api/phone','POST',{versionId,...(address?{address}:{})})).json(); await render(state);
}
export async function connectPhone() {
  if (!initialized) {
  initialized=true;
  el('phone-refresh').addEventListener('click',()=>void run(async()=>{await load();await enable();}));
  el('phone-networks').addEventListener('click',()=>void run(async()=>{const state=await load();if(state.enabled&&state.versionId!==el<HTMLSelectElement>('phone-version').value)await enable();else await render(state);}));
  el('phone-off').addEventListener('click',()=>void run(async()=>{await render(await(await api('/api/phone','DELETE',{})).json());}));
  for(const id of ['phone-network','phone-version'])el(id).addEventListener('change',()=>void run(enable));
  el('phone-copy').addEventListener('click',async()=>{const input=el<HTMLInputElement>('phone-url');try{await navigator.clipboard.writeText(input.value);el('phone-status').textContent='Ссылка скопирована. Она даёт временный доступ к выбранной версии.';}catch{input.focus();input.select();el('phone-status').textContent='Скопируйте выделенную ссылку.';}});
  window.addEventListener('pagehide',release);
  }
  await run(async()=>{const state=await load();if(state.enabled&&state.versionId===el<HTMLSelectElement>('phone-version').value)await render(state);else await enable();});
}
