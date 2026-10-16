interface Status { ok: boolean; demoReady?: boolean; liveConfigured?: boolean; liveReady?: boolean; llmState?: string; mode?: string; connectionUrl?: string; accessRequired?: boolean; provider?: string; model?: string; browserReady?: boolean; readinessSource?: string; readinessCheckedAt?: string; network?: {category?:string}; lastSavedGeneration?: {createdAt:string;model:string} }
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
    const states: Record<string,string> = {ready:'модель найдена',not_configured:'ключ/маршрут не настроен',unreachable:'служебная проверка не удалась; доступность генерации не определена',model_missing:'модель не найдена в каталоге',authentication_failed:'служебный запрос отклонён авторизацией',browser_missing:'модель найдена; браузер проверки не установлен',not_verified:'не проверено'};
    const mode = data.mode==='local'?'Сервер на этом компьютере':data.mode==='lan'?'Полный интерфейс в локальной сети':data.mode==='https'?'HTTPS сервер':'неизвестен';
    el('system-info').textContent = `API: ответ получен. База: ${data.ok?'исправна':'ошибка'}. LIVE: ${data.liveConfigured?'маршрут настроен':'не настроен'}${data.model?' / '+data.model:''}. Служебная проверка: ${states[data.llmState??'not_configured']??'неизвестно'}. Источник: ${data.readinessSource??'конфигурация'}${data.readinessCheckedAt?' · '+new Date(data.readinessCheckedAt).toLocaleString():''}${data.network?.category?' · '+data.network.category:''}. Квота и текущий rate limit inference не проверялись. Последняя сохранённая генерация: ${data.lastSavedGeneration?new Date(data.lastSavedGeneration.createdAt).toLocaleString()+' / '+data.lastSavedGeneration.model+' (история версий)':'не найдена для этого маршрута'}. ${mode}.`;
    if (!['lan','https'].includes(data.mode??'') || !data.connectionUrl) {
      el('lan-instructions').textContent = 'Для мобильного тестирования откройте «Подключить телефон».';
      return;
    }
    const url = new URL(data.connectionUrl);
    if (url.origin !== location.origin || url.search || url.hash || url.username || url.password) throw new Error('Адрес сервера не соответствует открытому подключению.');
    el('connection-details').hidden = false;
    (el('lan-url') as HTMLInputElement).value = url.href;
    if(data.mode==='https'){el('lan-instructions').textContent='Публичный HTTPS: откройте адрес или QR на Android/iPhone из любой сети. Доступ защищён ключом сервера или авторизацией Telegram. Генерация остаётся приватной.';return;}
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
