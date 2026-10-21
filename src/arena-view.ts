import type {ArenaMetric} from './arena-contract.ts';
import {formatArenaValue} from './arena-contract.ts';
export type ArenaBoard = {roomId:string;versionId:string;sha256:string;metric?:ArenaMetric;open:boolean;expiresAt:number;players:{place:number|null;nickname:string;bestScore:number|null}[]};
export const arenaErrors: Record<string,string> = {
  ARENA_LLM_PREPARATION_REQUIRED:'Эту игру нельзя безопасно подготовить локально. Опишите турнирную цель и отдельно разрешите LLM-доработку.',
  ARENA_PREPARATION_CONSENT:'Для LLM-подготовки требуется отдельное согласие.',
  ARENA_GOAL_REQUIRED:'Опишите измеримую турнирную цель (10–200 символов).',
  ARENA_OBJECTIVE_INCOMPLETE:'Цель головоломки не достигнута. Время не засчитано. Начните новую попытку.',
  ARENA_METRIC_MISMATCH:'Событие не соответствует критерию этой версии. Результат не засчитан.',
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
  ARENA_SCORE_MISSING:'Игра не передала числовой результат. Попытка не засчитана; нужна совместимая версия.',
  ARENA_ATTEMPT_ENDED:'Эта попытка уже завершена или заменена новой.',
  ARENA_ATTEMPT_RATE:'Подождите секунду перед новой попыткой.',
  RATE_LIMIT:'Слишком много запросов. Подождите и повторите действие.',
  ARENA_VERSION_MISMATCH:'Комната относится к другой версии. Выберите комнату этой версии.',
  ARENA_UNREACHABLE:'Страница Arena не открылась на выбранном адресе. Проверьте частную сеть.',
};
export const arenaEl = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
export async function arenaRequest(path:string,method='GET',body?:unknown,token?:string) {
  const preflight=path==='/api/arena'&&method==='POST'||path==='/api/arena/qr.svg';
  const response=await fetch(path,{method,cache:'no-store',signal:AbortSignal.timeout(preflight?45000:8000),headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!response.ok){const data=await response.json();throw Object.assign(new Error(arenaErrors[data.error]??'Действие не выполнено: '+data.error),{code:data.error});}
  return response;
}
export function renderBoard(board:ArenaBoard) {
  const target=arenaEl('scores'); target.replaceChildren();
  const metric=board.metric;
  const heading=document.getElementById('metric-heading');if(heading&&metric)heading.textContent=metric.label;
  for(const p of board.players){const value=p.bestScore===null?'Нет завершённой партии':metric?formatArenaValue(p.bestScore,metric):p.bestScore;const row=document.createElement('tr');for(const text of [p.place??'—',p.nickname,value]){const cell=document.createElement('td');cell.textContent=String(text);row.append(cell);}target.append(row);}
  arenaEl('board-status').textContent=board.players.length?`Участников: ${board.players.length}. ${board.open?'Обновляется каждые 2 секунды.':'Комната отключена. История сохранена.'}`:'Пока нет участников. Результаты появятся после завершённой партии.';
}
