# TASK-017 — Rules-Aware Gameplay Verification

Решение: **ITERATE** для дальнейшей экспериментальной интеграции. В неизменённой
LIVE-змейке победа доказана реальными действиями. В LIVE-тетрисе победа остаётся
**NOT_VERIFIED**; обнаружены конкретные дефекты игровой логики. Это не
production-ready и не разрешение подключать orchestrator к jobs/UI.

## Исходная точка и недостающее доказательство

Работа от `main d70a926fb0958518169239da43c9db3ba9ba7872` (PR #22).
Изучены AGENTS.md, known-errors, TASK-016, spec, checker, browser tests и оба
существующих `.local/task-016/b-prompt-{1,2}.html` с metadata.
Новых LLM-запросов: **0**; стоимость inference: **0**. HTML не переписывались.

TASK-016 проверяла bridge `game_won`, но не связывала его с фактическим порогом
правил и устойчивым видимым экраном. Аудит подставлял эвристические правила по
имени файла, смешивал score/items и не выбирал путь к яблоку. Числа 200/5 не
были доказанными результатами прохождения. Теперь аудит читает сохранённые
`rules` из metadata, а числовой порог — из однозначного `rules.win` либо из HUD
той же метрики. Примеры из objective (в том числе «например, 10») не являются
порогами. Генерация и QA остаются отдельными этапами.

## Реальные результаты

Опорный записанный прогон: **16 октября 2026, 09:14:38–09:15:18 MSK**. Это локальный
Chromium, viewport 390×844, touch/mobile emulation, offline opaque iframe,
OS sandbox и прежний GAME_CSP. Физические телефоны/Telegram не проверялись.

| LIVE HTML | Цель | Действия | Прогресс | Завершение | Restart | Время целиком | Победа |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Тетрис со взрывами | score ≥ 200, порог из HUD | 165 записей, включая Start, клавиши, ожидания; 41 нажатие реальной Drop | 0/200; 167 наблюдений, 2 положения фигуры по X, те же строки 0–1 | game_won / session_ended и экран завершения не достигнуты | NOT_VERIFIED, нет terminal | 30.090 s | **NOT_VERIFIED** |
| Змейка с противниками | items ≥ 5, порог из HUD collected | 144 записи: Start, реальные стрелки, FIRE, Pause/Continue, Restart и повторный Start | 0→1→2→3→4→5; пять входов головы в предыдущую красную клетку яблока | score 50, game_won → session_ended, устойчивый видимый You win! | **VERIFIED**: свежие ready/start, collected 0/5, последующий ввод меняет изображение, run остаётся активным | 9.268 s | **VERIFIED** |

Время внутри probe: 29.370 s / 8.660 s соответственно. Проверка двух игр
заняла 39.358 s вместе с запуском браузеров. Это стоимость данного прохождения,
не гарантия для случайных полей/произвольного LLM-кода. Были промежуточные
проверки того же HTML при разработке checker; повторной генерации не было.
Контрольный повтор на финальных ограничениях checker (09:20 MSK) дал те же
статусы: тетрис 0/200, 29.914 s; змейка 5/5, win и restart VERIFIED,
15.448 s / 264 action records. Evidence этого повтора отдельно сохранено в
`.local/task-017/2026-10-16T06-20-21-247Z/`. Разница времени связана с новым
случайным полем внутри того же неизменённого HTML; RNG не подменялся.

Цепочка яблок (индекс `y*20+x`): **191 → 92 → 159 → 294 → 373**.
Голова последовательно вошла в каждую из этих клеток. Время прогресса после
Start: **0.738 / 2.027 / 4.157 / 6.693 / 7.766 s**. При каждом приросте
число наблюдаемых контактов совпало с collected. Использовались обычные паузы
для чтения изображения и выбора следующего хода; скорость таймеров не менялась.

Полные последовательности действий, правила, fingerprint HTML, milestone
наблюдения, события, terminal и restart включены в
[переносимую evidence-запись](task-017-evidence.json). Сырые samples/pixels и PNG
каждого прироста сохранены в
`.local/task-017/2026-10-16T06-14-38-154Z/`; SHA-256 исходных JSON есть в записи.
Исходные LIVE HTML остаются локальными; clean clone выполняет контролируемые
browser tests, а повторный LIVE-аудит требует эти существующие артефакты.

[Тетрис, финальный кадр](task-017/b-prompt-1-final.png),
[змейка, победа](task-017/b-prompt-2-final.png),
[змейка, свежий run](task-017/b-prompt-2-restart.png).

## VERIFIED / NOT_VERIFIED / FAILED

- **VERIFIED**: запуск и реальные действия обеих игр; у змейки — сбор всех пяти
  яблок, достижение порога, экран/события завершения и restart.
- **NOT_VERIFIED**: победа/поражение/restart тетриса; поражение змейки в этом
  выигранном run; произвольные жанры, неоднозначные/составные правила,
  отсутствие наблюдаемого числового прогресса, отсутствие безопасного пути
  или исчерпание бюджета. Отсутствие найденного пути не доказывает
  математическую недостижимость цели.
- **FAILED** в негативных controlled browser tests: ложный win без завершения,
  порог без завершения, победа ниже порога, невидимый terminal, конфликт
  меняющегося HUD target, неотвечающий JS. Это авторские дефектные fixtures,
  не реальные LLM-артефакты и не доказательство внешних сбоев.

## Дефекты генерации

LIVE-тетрис: `dropTimer += dt` (секунды) сравнивается с `speed = 800`;
Drop меняет `piece.dy`, которое нигде не применяется к координате/скорости.
Источник просмотрен; browser-наблюдения подтверждают отсутствие падения за
30 s и после 41 Drop, при работающем горизонтальном вводе. Это конкретные
ошибки gameplay; вечная недостижимость победы не утверждается (один шаг
гравитации по этому коду требует >800 игровых секунд). Артефакт не исправлялся.

LIVE-змейка: HUD `score: _game.score` сериализует функцию и потому не показывает
score — видно на реальных кадрах. Для items-цели использован collected, а
score_changed/финальные 50 — отдельное подтверждение. Отсутствие score в HUD
не мешает доказанному сбору, но остаётся дефектом представления прогресса.
Другие потенциальные дефекты, не пройденные в этих сессиях, не выдаются за
подтверждённые нарушения.

## Реализация и пределы

- [rules-probe.ts](../src/orchestrator/rules-probe.ts): ограниченная интерпретация
  одной cumulative цели score/items/lines/waves с положительным целым порогом;
  проверка согласованности rules/HUD, chronology, прогресса от исходного
  состояния до порога, real-input записей, terminal/end и двух устойчивых
  наблюдений. Порог/метрика не берутся из loss или примеров objective.
- [rules-gameplay.ts](../src/orchestrator/rules-gameplay.ts): реальное управление
  через Playwright keyboard/pointer. Адаптер змейки использует только пиксели
  нарисованного canvas: явно заданные геометрия/палитра, BFS до видимого яблока,
  избегание стен/тела/врагов. Каждый шаг выбирается заново; контакты с яблоками
  сверяются с прогрессом. Это небольшой явно настроенный адаптер, не общий AI.
- Generic scripted probe умеет проверять простые числовые HUD-сценарии; заранее
  наблюдаемый автономный прирост не считается доказательством действия игрока.
  Это ограниченная атрибуция, не защита от произвольной намеренной симуляции
  механик в недоверенном HTML. Один bridge-event, одни пиксели или один score
  никогда не дают win VERIFIED.
- HUD/события по-прежнему недоверенные; профиль змейки добавляет независимую
  наблюдаемую геометрию. Completion требует видимой области viewport,
  отсутствия hidden/visibility/opacity-block и перекрытия result другим UI.
  Неожиданный ready/start/reload до окончания proof отвергается. Restart
  проверяется после запечатывания evidence первого run.
- Бюджеты: 2–180 s активной сессии после подтверждённого game_started;
  browser setup не съедает active budget. Watchdog закрывает только свой браузер
  не позднее budget + 12 s (startup/teardown, в том числе зависший JS).
  ≤1000 записей действий, ≤2048 drive samples (+ bounded baseline/final),
  ≤512 принятых bridge events. Audit: 30/150 s, ≤900 действий, stall 10 s.
  Oversized/unsupported наблюдения не становятся PASS. Очки, переменные,
  таймеры, RNG, состояния победы и игровые функции через evaluate не меняются.
- Старый `summarizeSession` больше не выдаёт win VERIFIED по `game_won`.
  Production generator/jobs/UI/SQLite/Telegram/VPN/launcher/.env и Visual Kit
  не менялись. Неизвестные ignored-файлы и `docs/Keys_Bilayn.pdf` сохранены.

## Проверки и доставка

- Typecheck/build и **149 unit tests**: PASS; **19 repository Python tests**:
  PASS; repo checker и diff whitespace: PASS.
- Новые browser negatives дополнительно проверяют ambiguity/unreachable,
  автономный прирост, action limit и watchdog зависшего JS. Controlled
  tetris/snake достигают win через реальные input и независимый HUD/terminal.
- Полная browser matrix: **233 PASS / 331 intentional skips**, 7.4 min.
  Backend Chromium probes выполняются один раз, а не повторяются для каждого
  frontend profile; mobile UI проверяется на 320/360/390/430, tablet/desktop,
  rotation, keyboard viewport и touch. Skips не считаются физическим PASS.
- Повторный focused Chromium run на финальном checker: **16/16 PASS**, 1.3 min.
- Штатный performance smoke: **7 cold mobile Slow 4G / CPU×4**, PASS.
  p75 shell interactive 639.8 ms; DEMO game launch 969.1 ms; API 3.55 ms;
  touch 6 ms. Это shell/DEMO, не время LLM или произвольной LIVE-игры.
  Gzip initial JS **9661 B**, CSS **2332 B**, critical total **14631 B** —
  ниже 150/30/250 KB. QA-код не входит в browser bundle.
- Staged Gitleaks 8.24.3: **no leaks**. Current-head Windows/Ubuntu/secret-scan,
  PR, merge SHA и post-merge smoke подтверждаются в итоговом GitHub handoff.
- `npm audit` (все locked dependencies): **0 vulnerabilities**.

Первый hosted Ubuntu run `38861148019` выявил ошибку бюджета controlled hang
test: он завершился за 2.0 s до ввода в заведомо зависающий handler (остальные
232 browser tests прошли). Fixture получает 6 s до watchdog + 12 s и проверяет
явный BROWSER_GAMEPLAY_TIMEOUT; генерация и audit 30/150 s не меняются.
Локально после исправления: typecheck/build, 149 unit и все 16 Chromium tests
PASS (1.6 min); реальное зависание оборвано watchdog через 18.0 s. После
исправления обязательны заново checks нового head на обеих ОС.

Второй hosted run `38862850604`: Ubuntu полностью PASS; Windows нашла
terminal race (FIRE перехвачен честным end-overlay), расходование 6 s active
budget на setup (Start tap 2.58 s) и общий 20 s timeout старого многошагового
LAN acceptance на финальном export assertion. Исправление: отмена pending input
при terminal с прежним независимым proof; active clock после game_started при
неизменном общем watchdog; только Windows test budget этого LAN кейса 45 s.
Assertions, production timeouts, generation и performance budgets сохранены.
Добавлена реальная delayed-Start browser регрессия с active budget 6 s.
Локальная повторная проверка: 149 unit PASS; orchestrator + production browser
coverage в Chromium desktop/320 и WebKit 390 — 41 PASS / 34 intentional skips.
LIVE повтор после этих исправлений: тетрис 0/200 NOT_VERIFIED, 30.383 s;
змейка 5/5, пять контактов, win/restart VERIFIED, 13.841 s, 224 action records.
Полные samples: `.local/task-017/2026-10-16T07-11-38-022Z/`.

Дальше: исправить генерацию временных единиц/сброса отдельной задачей; расширять
проверяемые visual adapters и выборку настоящих игр. До этого — **ITERATE**,
без production-интеграции и без обещания прохождения произвольной LLM-игры.

## GitHub handoff

[PR #23](https://github.com/Sashido01/YAPLIX/pull/23) → `main`, feature commit
`5a825bf9f2011c979471bcb9249939daa49b51f5`. Последующий documentation commit
уточняет только этот handoff и различие initial/changing target в known-errors.
[Проверки текущего head](https://github.com/Sashido01/YAPLIX/pull/23/checks)
являются authoritative источником Windows/Ubuntu/secret-scan; actual merge SHA
и завершение доступны в PR. Merge разрешён только после успеха всех трёх
checks актуального head, затем ff-only main и post-merge smoke. Итог этих
операций сообщается владельцу отдельно; до их выполнения merge PASS не заявлен.
