# Техническое состояние YAPLIX — 29 октября 2026

**MVP scope: техническая проверка и наблюдённый LIVE пользовательский сценарий.**
[PR #69 и актуальное состояние публикации](https://github.com/Sashido01/YAPLIX/pull/69).
Точный опубликованный commit и установочные artifacts указываются в GitHub.
Решение владельца RELEASE-011 от 29 октября уточняет release policy ниже.

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
- Физические Android/iOS/Telegram: NOT_VERIFIED. Windows native installer отдельно подтверждён hosted CI FINAL-CI; это не физический телефон.

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

## Исторический снимок проверок до FINAL-CI

Typecheck/build, 25 целевых units, 6 desktop lifecycle tests, keyboard/no-op
regression, повторный create/edit/export и mobile navigation regressions: PASS.
На runtime-кандидате `c7c6dfa` полный unit: **608 PASS, 0 FAIL, 1 platform SKIP**; полный browser прогон остановлен после обнаружения потерянного LAN UI (131 PASS, 3 FAIL, 1 interrupted). После восстановления UI и его runtime route: **90 целевых browser PASS / 0 FAIL / 3 SKIP** на desktop, Chromium 320 и WebKit 390. Дополнительно: 36 critical unit PASS / 1 platform SKIP; 20 Python checks PASS. Полная матрица целиком повторно не запускалась. Ubuntu Lite из этого кандидата: защищённая установка в отдельный профиль, открытие сохранённого Canvas и restart — PASS. Исторические 578 unit /
638 browser PASS относятся к предыдущей копии, не к текущему commit.
Gitleaks дерева/diff/new history был PASS перед первым push и повторяется перед
публикацией обновлений. В FINAL-30 подтверждены активные hosted Actions. Run 40821319327 на предыдущем SHA завершился отказами Ubuntu/Windows Python до build и отдельным отказом Windows bootstrap; исправления проверяются новым запуском.

Полный локальный отчёт: `.local/yaplix-submission-009/REPORT.md`.

## Release policy MVP — RELEASE-011

Решение принято в RELEASE-011 по поручению владельца, отдельно от факта зелёного
CI: `NOT_VERIFIED` означает недостаток evidence, а не подтверждённый дефект.
Универсальное автоматическое доказательство всех механик произвольной LLM-игры
не входит в обязательные условия этого MVP. Issue [#70](https://github.com/Sashido01/YAPLIX/issues/70)
остаётся открытой P1-задачей развития причинного Canvas input-proof.

| Результат | Что подтверждает | Чего не подтверждает |
| --- | --- | --- |
| Технический PASS | Проверенные HTML/JS, видимость/геометрия Canvas, отсутствие запрещённых ресурсов и ошибок в bounded protected browser probe | Работу всех действий, достижимость победы/поражения и качество любой игры |
| Наблюдённый gameplay | Конкретные действия и результат конкретного неизменного HTML с SHA и записанными условиями | Другие версии, все будущие генерации и физические устройства |
| NOT_VERIFIED | Аспект не доказан выполненной пробой | Ни исправность, ни неисправность механики |
| Подтверждённый дефект | Воспроизведённую ошибку конкретной версии/действия | Неисправность всех игр или всей платформы |

Анимированный START с no-op обработчиком может пройти **технический** checker;
это известная граница его evidence. `input-works`, `gameplay-observed`, win/loss и
restart сохраняют NOT_VERIFIED. Такой fixture не объявляется игровой приёмкой.
Если для конкретной пользовательской версии доказана неработающая кнопка/ввод,
это остаётся дефектом этой версии; переименование статуса не превращает её в PASS.
Checker и negative assertions не ослабляются, автоматический gameplay VERIFIED
на основании движения пикселей не добавляется.

### Обязательные условия выпуска MVP

- Все применимые GitHub jobs, secret scan и требуемый manual FULL на точном
  intended release SHA успешны; текущий diff и base перепроверены перед merge.
- Нет подтверждённых критических дефектов основного платформенного пути или
  нарушений сохранности, auth, opaque sandbox/CSP и provider/POST budgets.
- Есть фактический LIVE путь create/edit/ограниченный same-model repair,
  библиотека/версии, restart/persistence и автономный export.
- Конкретная LIVE-игра имеет отдельное наблюдение управления и игрового результата;
  этот результат не распространяется на другие HTML. Проверенные условия и
  непроверенные аспекты доступны пользователю в технической документации.

Сохранённые evidence этого MVP удовлетворяют последним двум условиям: реальные
create 2 POST (включая один repair), edit 1 POST, сохранение версий/SQLite/restart,
SHA-сверенный export; keyboard и эмулированный touch, счёт и естественный Game Over.
Переход уровня и Restart наблюдались отдельно с browser clock/seed. Это достаточная
ограниченная приёмка основного пути, не FULL_GAMEPLAY_PASS любой генерации.
Физические Android/iOS/Telegram не объявляются проверенными.

На `8eb79ed793addec94451f7572b8406d059927e07` все пять jobs
[run 40912869154](https://github.com/Sashido01/YAPLIX/actions/runs/40912869154)
SUCCESS: Ubuntu и Windows по 700 browser PASS / 0 FAIL / 2240 profile SKIP,
unit/backend и performance PASS, Windows source/Lite/Full installer и secret scan
PASS. Последующее изменение policy/README проверяется по собственному SHA;
исторический зелёный run не подменяет его обязательные проверки.

Навигация по уточнению владельца: только **Создать · Игры · Арена**. Скрытый
четвёртый пункт удалён; контекстный возврат из редактора сохранён.

## FINAL-30 — 29 октября

README, инструкция и восемь слайдов оформлены как продуктовые материалы.
Подтверждённые сценарии генерации и long-v1 сохранены; новых LLM POST нет.
Quick/integration, 3 Canvas classification/keyboard regressions, 21 unit и
20 Python tests: PASS. Неподвижный по вводу animated START остаётся
NOT_VERIFIED по input/gameplay; причинный input-proof P1 не закрыт.

CI исправления: Python suite после build; operation-trace включён в source
installer и payload overlay; Linux ELF test не компилируется на Windows;
переносимая fixture/редакция домашнего пути. Windows installer workflow сохранён.
Hosted Actions активны. Результаты старого run не являются проверкой нового SHA;
незавершённые checks и полная матрица не считаются PASS.

## FINAL-CI — итог исходного run 40824915530

Коммит 1151694: оба unit/backend suite PASS и hosted secret scan SUCCESS.
Ubuntu browser: 697 PASS / 3 FAIL; Windows browser: 692 PASS / 8 FAIL.
Windows Lite/Full build PASS, installer acceptance FAIL на удалённом gallery API.
Адресные исправления QR, начальной навигации теста и isolated installer fixtures
проверяются новым SHA. Полный статус нового run фиксируется отдельно.
Canvas input-works/gameplay-observed остаются NOT_VERIFIED; причинный P1 открыт.
Merge/release до обязательных gates не заявляются.
