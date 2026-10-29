# Статус сдачи YAPLIX — 29 октября 2026

**Product status: PARTIAL / опубликованный кандидат; полный release gate не закрыт.**
[Draft PR #69](https://github.com/Sashido01/YAPLIX/pull/69), Issue #68.
Main остаётся `b6a64abb`; merge не выполнен.

## Сохранность и интеграция

Точный allowlist-снимок `15c6393` опубликован отдельно. Исходный checkout
`codex/arena-mvp @ 78492bf`, его индекс, SQLite и личные файлы сохранены.
Интеграция ведётся в отдельном worktree; installer/Windows CI из main сохранены.
Палитра PR #66 от jeanhayl выборочно адаптирована; process/lock/install changes
из этого PR не переносились. Материалы PR #67 интегрированы и обновлены.

## Подтверждённый LIVE путь на отдельной SQLite

- Через настоящий UI выбран Ollama Cloud `gemma4:31b` и создана новая аркада:
  2 POST, включая 1 automatic same-provider repair; durable job completed.
- Игра открыта из Library. Пользовательский edit цвета корабля выполнен через UI:
  1 POST, durable job completed, предыдущая версия сохранена.
- Сервер штатно остановлен и запущен с той же тестовой SQLite: integrity `ok`,
  SHA всех трёх сохранённых версий совпадают с записями до restart.
- Export изменённой версии: 11 171 bytes; SHA256
  `80e39de1a6da0fc4d7683a51ee65092955e3dbbcdb3097d11a79da18b698580a`
  совпал с SQLite и HTTP заголовком.
- Offline Chromium на этом LIVE export наблюдал клавиатурное и эмулированное
  сенсорное движение, рост счёта и естественный Game Over без JS exceptions
  и внешних запросов. В отдельном контролируемом browser-clock/seed прогоне того же неизменного
  HTML наблюдались ROUND COMPLETE → уровень 2 → GAME OVER → RESTART
  со счётом 0 / уровнем 1. Это branch evidence, а не физическое устройство
  или гарантия качества любой сгенерированной игры.
- Физические Android/iOS/Telegram и Windows native: NOT_VERIFIED.

## Диагноз генерации и A/B

Восстановлено SHA-происхождение пяти checkpoint предыдущей durable-серии.
Точный replay в интеграции дал 3/5 технических PASS. Snake действительно не
помещается при 844×390; Racing имеет значимое clipping текста при том же размере.
NOT_VERIFIED не трактуется как доказанная неисправность.

Исправлена подтверждённая ошибка checker: после Canvas Start клавиатурная проба
выполнялась только standalone, а iframe отклонялся раньше. Теперь при недостающей
activity внутри обоих режимов выполняются максимум две адресные стрелки. No-op
контроль всё ещё отклоняется; глубокая игровая проверка не объявляется полной.

Последняя серия SUBMISSION-008 имела 8 POST и **3 repair**, а не 4. Отклонённые
ответы её прямой driver не сохранил — эти конкретные HTML нельзя воспроизвести.
Статистика v2 исключена из-за двух одновременных запусков, писавших в общую папку.

Версии prompt: production `long-v1`, экспериментальная `compact-v2` с раздельными
экранами состояний. Ограниченный A/B, одинаковые Snake/Arcade: first-pass long 1/2,
compact 0/2. Переключения production нет. Repair-сравнение НЕВАЛИДНО: обёртка
тестового транспорта не передала observesDispatch и дважды считала budget.
На wire ушли 4 POST, все 4 ответа сохранены с SHA. Повтор A/B не запускался.

## Проверки и границы

Typecheck/build, 25 целевых units, 6 desktop lifecycle tests, keyboard/no-op
regression, повторный create/edit/export и mobile navigation regressions: PASS.
На runtime-кандидате `c7c6dfa` полный unit: **608 PASS, 0 FAIL, 1 platform SKIP**; полный browser прогон остановлен после обнаружения потерянного LAN UI (131 PASS, 3 FAIL, 1 interrupted). После восстановления UI и его runtime route: **90 целевых browser PASS / 0 FAIL / 3 SKIP** на desktop, Chromium 320 и WebKit 390. Дополнительно: 36 critical unit PASS / 1 platform SKIP; 20 Python checks PASS. Полная матрица целиком повторно не запускалась. Ubuntu Lite из этого кандидата: защищённая установка в отдельный профиль, открытие сохранённого Canvas и restart — PASS. Исторические 578 unit /
638 browser PASS относятся к предыдущей копии, не к текущему commit.
Gitleaks дерева/diff/new history был PASS перед первым push и повторяется перед
публикацией обновлений. Hosted Actions отключены владельцем и не считаются PASS.

Полный локальный отчёт: `.local/yaplix-submission-009/REPORT.md`.

## Оставшийся блокер release gate

Независимое review и неизменный локальный пример подтвердили: анимированный
START с полностью no-op обработчиком управления проходит технический checker
за счёт изменения пикселей. `input-works`, победа, поражение и Restart остаются
NOT_VERIFIED, но принятие произвольной игры ещё не доказывает рабочий Start.
Поэтому merge/release пока не разрешён; успешный конкретный LIVE-сценарий выше
не распространяется на любой ответ модели. Локальный reproducer:
`.local/yaplix-submission-009/idle-noop.html`, результат `idle-noop-result.json`.
Нужна проверка связи ввода с запуском/изменением игры, не новая серия LLM-вызовов.

Навигация по уточнению владельца: только **Создать · Игры · Арена**. Скрытый
четвёртый пункт удалён; контекстный возврат из редактора сохранён.
