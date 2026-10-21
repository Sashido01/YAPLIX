export type ArenaBoard = {roomId:string;versionId:string;sha256:string;open:boolean;expiresAt:number;players:{place:number|null;nickname:string;bestScore:number|null}[]};
export const arenaErrors: Record<string,string> = {
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
export const arenaEl = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
export async function arenaRequest(path:string,method='GET',body?:unknown,token?:string) {
  const response=await fetch(path,{method,cache:'no-store',signal:AbortSignal.timeout(8000),headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!response.ok){const data=await response.json();throw new Error(arenaErrors[data.error]??'Действие не выполнено: '+data.error);}
  return response;
}
export function renderBoard(board:ArenaBoard) {
  const target=arenaEl('scores'); target.replaceChildren();
  for(const p of board.players){const row=document.createElement('tr');for(const text of [p.place??'—',p.nickname,p.bestScore??'Нет завершённой партии']){const cell=document.createElement('td');cell.textContent=String(text);row.append(cell);}target.append(row);}
  arenaEl('board-status').textContent=board.players.length?`Участников: ${board.players.length}. ${board.open?'Обновляется каждые 2 секунды.':'Комната отключена. История сохранена.'}`:'Пока нет участников. Очки появятся после завершённой партии.';
}
