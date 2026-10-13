interface Status { ok: boolean; demoReady?: boolean; liveReady?: boolean; llmState?: string; mode?: string; connectionUrl?: string; accessRequired?: boolean; provider?: string; model?: string; browserReady?: boolean }
let telegramToken:string|undefined;
let imageUrl: string | undefined;
const el = (id: string) => document.getElementById(id)!;
async function response(path: string) {
  const result = await fetch(path, { signal: AbortSignal.timeout(5000), cache: 'no-store',...(telegramToken?{headers:{'X-Yaplix-Telegram-Session':telegramToken}}:{}) });
  if (!result.ok) throw new Error(result.status === 401 ? 'Доступ истёк: обновите страницу и введите ключ.' : 'API недоступен. Проверьте сервер и подключение.');
  return result;
}
function releaseImage() { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = undefined; el('qr-image').removeAttribute('src'); el('qr-image').hidden = true; }
// Kept outside the initial UI bundle. QR is generated locally on the server only on demand.
export async function diagnose(token?:string) {
  telegramToken=token;
  releaseImage(); el('qr-message').textContent = ''; el('connection-details').hidden = true;
  el('system-info').textContent = 'Проверяем API, базу и модель…';
  try {
    const data: Status = await (await response('/api/diagnostics')).json();
    const states: Record<string,string> = {ready:'модель доступна',not_configured:'не настроен',unreachable:'провайдер недоступен',model_missing:'модель не найдена',authentication_failed:'API key не принят',browser_missing:'установите браузер: npm run checker:install',not_verified:'готовность модели не проверена'};
    el('system-info').textContent = `API: ответ получен. База: ${data.ok?'исправна':'ошибка'}. DEMO: ${data.demoReady===false?'нужна сборка / проверка базы':'доступен'}. LIVE: ${states[data.llmState??'not_configured']??'состояние неизвестно'}${data.model?' / '+data.model:''}. Режим: ${data.mode??'неизвестен'}.`;
    if (data.mode !== 'lan' || !data.connectionUrl) {
      el('lan-instructions').textContent = 'Для телефона запустите npm run lan -- --list, затем npm run lan -- --host <IPv4> --port 3000. Выберите адрес Wi-Fi/Ethernet вашей сети из списка; VPN и виртуальные адаптеры также могут присутствовать.';
      return;
    }
    const url = new URL(data.connectionUrl);
    if (url.origin !== location.origin || url.search || url.hash || url.username || url.password) throw new Error('Адрес сервера не соответствует открытому подключению.');
    el('connection-details').hidden = false;
    (el('lan-url') as HTMLInputElement).value = url.href;
    el('lan-instructions').textContent = 'Телефон и компьютер — в одной Wi-Fi сети. Сканируйте QR или откройте ссылку; затем введите ключ из терминала компьютера. Если адрес не открывается, проверьте выбранный интерфейс, изоляцию клиентов Wi-Fi и разрешение доступа в firewall. Сервер не проверяет доступность телефона.';
  } catch (error) { el('system-info').textContent = 'Статус не подтверждён. '+(error as Error).message; }
}
el('show-qr').addEventListener('click', async () => {
  releaseImage(); el('qr-message').textContent = 'Готовим QR…';
  try {
    const result = await response('/api/connection/qr.svg');
    const svg = await result.blob();
    if (!svg.type.startsWith('image/svg+xml')) throw new Error('Некорректный ответ QR.');
    imageUrl = URL.createObjectURL(svg); (el('qr-image') as HTMLImageElement).src = imageUrl; el('qr-image').hidden = false;
    el('qr-message').textContent = 'QR содержит только адрес сервера. Ключ вводится отдельно.';
  } catch (error) { el('qr-message').textContent = (error as Error).message; }
});
el('copy-lan').addEventListener('click', async () => {
  const input = el('lan-url') as HTMLInputElement;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(input.value);
    else { input.focus(); input.select(); if (!document.execCommand('copy')) throw new Error(); }
    el('qr-message').textContent = 'Ссылка скопирована.';
  } catch { input.focus(); input.select(); el('qr-message').textContent = 'Скопируйте выделенный адрес вручную.'; }
});
window.addEventListener('pagehide', releaseImage);
