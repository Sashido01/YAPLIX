import { mountGame } from './runtime.ts';
import type { GameVersion, GameSpec, GameEvent } from './contracts.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = el<HTMLTextAreaElement>('prompt'), mode = el<HTMLSelectElement>('mode'), message = el('message');
let current: GameVersion | null = null, unmount: (() => void) | undefined, busy = false, serial = Promise.resolve();
const errors: Record<string, string> = {
  BGEN_NOT_CONFIGURED: 'LIVE не настроен. Откройте диагностику и настройте LLM по README.',
  BGEN_INSTALL_REQUIRED: 'Для LIVE установите библиотеку BGen: npm run bgen:install.',
  LLM_MODEL_NOT_FOUND: 'Модель отсутствует в Ollama. Установите модель, указанную в настройках.',
  LLM_BUSY: 'Другая генерация уже выполняется. Повторите позже.',
  LLM_TIMEOUT: 'Модель не ответила вовремя. Игра не была заменена DEMO.',
  LLM_HTTP: 'LLM вернула ошибку. Проверьте запуск модели и её ресурсы.',
  LLM_UNSAFE_ARTIFACT: 'Модель вернула игру с запрещёнными зависимостями. Попробуйте уточнить запрос.',
  LLM_NETWORK_OR_RESPONSE: 'Не удалось получить полный ответ LLM. Проверьте доступность Ollama.',
  BGEN_LIVE_CONTRACT_REQUIRED: 'Удалённый BGen пока не поддерживает безопасный LIVE-контракт.',
  BACKUP_QUOTA: 'Достигнут лимит резервных копий. Сохраните нужные копии и освободите место по инструкции.',
  BACKUP_BUSY: 'Резервная копия уже создаётся. Повторите позже.',
};
async function api(path: string, body?: unknown, token?: string) {
  const response = await fetch(path, { ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(errors[data.error] ?? `Не удалось выполнить действие (${data.error ?? response.status}).`);
  return data;
}
function lock(value: boolean) { busy = value; el<HTMLButtonElement>('generate').disabled = value; el<HTMLButtonElement>('improve').disabled = value || !current; mode.disabled = value; }
async function attempt(action: () => Promise<void>) {
  if (busy) return; lock(true);
  try { await action(); } catch (error) { message.textContent = (error as Error).message; }
  finally { lock(false); }
}
const spec = (text: string): GameSpec => ({ prompt: text, audience: 'default', genre: 'unknown', mechanics: [], controls: ['keyboard', 'touch', 'pointer'], responsive: true, webview: true });
async function list() {
  const { games } = await api('/api/games'); const list = el('games'); list.replaceChildren();
  if (!games.length) { list.textContent = 'Созданные игры появятся здесь.'; return; }
  for (const v of games as Omit<GameVersion, 'html'>[]) {
    const button = document.createElement('button'); button.textContent = v.spec.prompt; button.type = 'button';
    button.addEventListener('click', () => { void attempt(async () => { await show(await api(`/api/versions/${v.versionId}`)); }); }); list.append(button);
  }
}
async function stats(version: GameVersion) {
  const data = await api(`/api/versions/${version.versionId}/analytics`);
  if (current?.versionId !== version.versionId) return;
  el('analytics').textContent = `Начато: ${data.startedCount}. Завершено: ${data.completedCount}. Победы: ${data.won}. Поражения: ${data.lost}. Средний счёт: ${data.meanScore ?? 'нет данных'}.`;
  el('comparison').textContent = '';
  if (version.previousVersionId) {
    const comparison = await api(`/api/versions/${version.versionId}/analytics?baselineVersionId=${version.previousVersionId}`);
    if (current?.versionId !== version.versionId) return;
    el('comparison').textContent = comparison.evidence === 'insufficient_data' ? 'Для сравнения нужно минимум пять завершённых сессий на каждой версии.' : `Разница доли побед: ${comparison.winRateDelta ?? 'нет данных'}. Это наблюдение по клиентской статистике.`;
  }
}
async function play(version: GameVersion) {
  const session = await api(`/api/versions/${version.versionId}/sessions`, {});
  unmount?.(); el('game').replaceChildren(); serial = Promise.resolve();
  unmount = mountGame(el('game'), version.html, session, (event: GameEvent) => {
    serial = serial.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await api(`/api/sessions/${session.sessionId}/events`, event, session.token); if (event.type === 'session_ended' || event.type === 'game_error') await stats(version); return; }
        catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1))); }
      }
    }).catch(error => { message.textContent = `Игра запущена, событие не сохранено: ${error.message}`; });
  });
}
async function show(version: GameVersion) {
  current = version; mode.value = version.method === 'mock' ? 'demo' : 'live'; help();
  el('game-title').textContent = version.spec.prompt;
  el('provenance').textContent = version.method === 'mock' ? 'DEMO · без LLM' : `${version.method} · ${version.model ?? 'модель неизвестна'}`;
  el<HTMLButtonElement>('replay').disabled = false; el<HTMLButtonElement>('improve').disabled = false;
  const download = el<HTMLAnchorElement>('export'); download.href = `/api/versions/${version.versionId}/export`; download.removeAttribute('aria-disabled');
  const history = await api(`/api/games/${version.gameId}`), select = el<HTMLSelectElement>('versions'); select.replaceChildren(); select.disabled = false;
  history.versions.forEach((v: Omit<GameVersion, 'html'>, i: number) => { const option = document.createElement('option'); option.value = v.versionId; option.textContent = `Версия ${i + 1} · ${new Date(v.createdAt).toLocaleString()} · ${v.method}`; option.selected = v.versionId === version.versionId; select.append(option); });
  await play(version); await stats(version); await list();
}
function help() { el('mode-help').textContent = mode.value === 'demo' ? 'DEMO использует авторскую игру «Звёздный курьер». Число в запросе задаёт цель. Это не LLM.' : 'LIVE создаёт весь HTML/JS моделью. Генерация может занять несколько минут. Ошибка не переключает режим на DEMO.'; }
mode.addEventListener('change', help);
el<HTMLFormElement>('create').addEventListener('submit', event => { event.preventDefault(); void attempt(async () => { message.textContent = mode.value === 'live' ? 'Модель создаёт игру…' : 'Создаём DEMO…'; const version = await api('/api/games', { spec: spec(prompt.value), mode: mode.value }); await show(version); message.textContent = 'Игра сохранена. Можно играть.'; }); });
el<HTMLFormElement>('iterate').addEventListener('submit', event => { event.preventDefault(); if (!current) return; const previous = current; void attempt(async () => { message.textContent = 'Создаём следующую версию…'; const version = await api(`/api/games/${previous.gameId}/versions`, { spec: spec(el<HTMLTextAreaElement>('change').value), previousVersionId: previous.versionId, mode: mode.value }); await show(version); message.textContent = 'Новая версия сохранена. Предыдущая доступна в списке.'; }); });
el('replay').addEventListener('click', () => { if (current) void attempt(async () => { await play(current!); }); });
el('versions').addEventListener('change', () => { void attempt(async () => { await show(await api(`/api/versions/${el<HTMLSelectElement>('versions').value}`)); }); });
async function diagnose() {
  const data = await api('/api/diagnostics');
  el('system-info').textContent = `База: ${data.ok ? 'исправна' : 'ошибка'}. LIVE: ${data.liveConfigured ? (data.provider ?? 'BGen') + ' / ' + (data.model ?? 'по API') : 'не настроен'}. BGen library: ${data.bgenReady ? 'установлена' : 'для Ollama выполните npm run bgen:install'}.`;
}
el('diagnostics').addEventListener('click', () => { el<HTMLDetailsElement>('system').open = true; void attempt(diagnose); });
el('backup').addEventListener('click', () => { void attempt(async () => { const copy = await api('/api/backups', {}); el('backup-result').textContent = `Копия проверена и сохранена в .local/backups/${copy.filename}. SHA-256: ${copy.sha256}`; }); });
void list().catch(error => { message.textContent = error.message; });
void diagnose().catch(error => { el('system-info').textContent = error.message; });
