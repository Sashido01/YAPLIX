import { mountGame } from './runtime.ts';
const el = (id: string) => document.getElementById(id)!;
let unmount: (() => void) | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
const token = location.hash.slice(1);
history.replaceState(null, '', '/phone');
async function open(redeem = false) {
  controller?.abort(); controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
  const restart = el('restart') as HTMLButtonElement; restart.disabled = true;
  try {
    if (redeem && token) {
      const access = await fetch('/phone/access', { method: 'POST', body: token, signal });
      if (!access.ok) throw new Error('Ссылка истекла. Обновите подключение на компьютере и сканируйте новый QR.');
    }
    const response = await fetch('/phone/version', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Доступ завершён. Обновите подключение на компьютере.');
    const version = await response.json();
    document.title = 'YAPLIX — ' + version.title;
    signal.throwIfAborted();
    const end = () => { unmount?.(); unmount=undefined; restart.disabled = true; el('status').textContent = 'Временный доступ истёк. Обновите подключение на компьютере.'; };
    const play = () => { if(Date.now()>=version.expiresAt){end();return;} unmount?.(); unmount = mountGame(el('game'), version.html, { sessionId: crypto.randomUUID?.() ?? uuid(), versionId: version.versionId }, () => {}); };
    play();
    restart.disabled = Date.now()>=version.expiresAt; restart.onclick = play;
    el('status').textContent = version.title;
    clearTimeout(expiry); expiry = setTimeout(end, Math.max(0, version.expiresAt - Date.now()));
  } catch (error) { if(!controller?.signal.aborted)el('status').textContent = error instanceof TypeError ? 'Сервер недоступен. Проверьте Wi-Fi, VPN и подключение на компьютере.' : (error as Error).message; }
}
function uuid() { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, v => v.toString(16).padStart(2, '0')).join(''); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
window.addEventListener('pagehide', () => { controller?.abort(); unmount?.(); unmount=undefined; clearTimeout(expiry); (el('restart') as HTMLButtonElement).disabled=true; });
window.addEventListener('pageshow', event => { if(event.persisted)void open(); });
void open(true);
