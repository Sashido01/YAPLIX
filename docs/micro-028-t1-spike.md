# MICRO-028.2 — Deterministic T1 Gameplay Probe

2026-10-17, Europe/Moscow. **NO_GO для production-интеграции этого probe.**
Один исследовательский цикл завершён; универсальная проверка gameplay не достигнута.
На двух обязательных реальных регрессиях получено **0 определённых T1-аспектов
сверх T0**. Authored held-out дал полезные частные наблюдения, но воспроизводимость
оказалась 4/6. Это результат данной реализации и бюджета, не доказательство
принципиальной невозможности T1 для произвольного HTML.

## Границы, Git и защищённые данные

Исходный HEAD: `33f2a05c4537509cd6348296c11c59bf6c09f719`, ветка
`test/micro-028-validator-calibration`. Main/origin/main после fetch и
`git pull --ff-only`: `70fff011a8f01598863010366b3503fbd9d63396`, ровно заданная база.
Продолжена существующая ветка, без нового worktree или PR.
[Draft PR #34](https://github.com/Sashido01/YAPLIX/pull/34) остаётся Draft, merge
**запрещён**. В этом increment production validator, prompts, GameBlueprint,
Orchestrator, API, UI, зависимости и durable storage не изменены относительно
исходного HEAD. Сам PR содержит более ранние изменения MICRO-028; это не утверждение,
что весь diff PR против main является research-only.

Все новые файлы находятся в `D:\YAPLIX`. Исходные SQLite открывались с
`readOnly:true`; HTML читались без изменения и копировались по SHA-256 в приватный
corpus. Логические хеши games/versions/generation_jobs во всех трёх исследованных
БД, хеши `.env` и постороннего `docs/Keys_Bilayn.pdf` до/после совпали. PDF сохранён
untracked. Оригинальные jobs/checkpoints/версии не изменены. Приватный источник,
идентификаторы и доказательства не публикуются.

**Реальных внешних LLM inference/repair POST: 0.** Research runner не импортирует
provider/engine/storage, не загружает `.env`, браузер получает allowlist окружения
без credentials. Offline context перехватывает только два документа harness,
остальные обращения блокирует; CSP `connect-src 'none'`. Новых генераций нет.
Actions не включались; hosted Ubuntu/Windows/secret-scan не объявляются зелёными.
Локальная MICRO-019 exception применена, это не release.

Контрольный commit: `ed056323f5560275f3d5a761cfec430cf0849710`.
Заморозка probe: `81c46b782f94dc3d0b1b88ca1cd61ee428122b4b`.
После открытия held-out checker, controls, oracle и лимиты не менялись.
Последующие изменения — отчёт и компактная документация ошибок.

## Stage 0 — corpus и production-интеграция

Первым выполнен read-only аудит, до создания controls и прототипа. Источники:
configured SQLite, default SQLite, сохранённая LIVE acceptance DB MICRO-027,
оригинальный checkpoint «Доброта для всех» и два исторических TASK-016 HTML с
отдельными provenance receipts. Последние — LLM-derived Orchestrator документы
с authored оболочкой; они не выдаются за новые независимые Full HTML генерации.

| Единица подсчёта | Обнаружено |
| --- | ---: |
| Сохранённые версии в трёх БД | 48 |
| Из них версии с metadata `llm_code` и моделью | 40 |
| Остальные authored/demo версии | 8 |
| Уникальные HTML этих 48 версий | 45 |
| Game ID всех версий / LLM-версий | 29 / 22 |
| Дополнительные provenance HTML/checkpoint | 3 |
| Всего source records / уникальных HTML | 51 / 48 |
| Уникальные LLM/provenance HTML | 43 |
| Из них без legacy `data-yaplix-start` / с marker | 30 / 13 |
| Уникальные HTML реально загружены | 48/48 |
| Полное наблюдение после попытки Start | 47/48 |

Одно исполнение каждого уникального HTML покрывает дубликаты версий по байтам;
это не 51 независимый эксперимент или 43 независимые игровые идеи. Для одного
LLM HTML `e3d2b8ad…` сохранилась начальная выборка, но Start был перекрыт и tap
истёк через 700ms. Его post-Start свойства неизвестны. Полностью незагруженных
HTML: 0. Два других документа дали наблюдаемые JS errors; это не новые LLM вызовы
и не автоматические T2-вердикты.

Ниже знаменатель — **уникальные документы**, не версии/независимые игры.
`Source candidate` означает обнаружение в исходнике, а не исполненный контракт.
Числовое представление может включать правила; его наличие ещё не устанавливает
смысл HUD. Для каждого хеша сохранены отдельные поля и причины неизвестности.

| Признак | Все HTML | LLM/provenance | Full HTML LLM без marker |
| --- | ---: | ---: | ---: |
| События v1 действительно наблюдались | 40/48 | 35/43 | 22/30 |
| `render_game_to_text()` | 0/48 | 0/43 | 0/30 |
| `advanceTime(ms)` | 0/48 | 0/43 | 0/30 |
| DOM содержит доступные числа | 39/48 | 34/43 | 24/30 |
| DOM HUD source candidate | 36/48 | 31/43 | 21/30 |
| Реальные вызовы Canvas text | 13/48 | 13/43 | 10/30 |
| В их аргументе присутствовали числа | 10/48 | 10/43 | 7/30 |
| Start overlay source candidate | 29/48 | 27/43 | 14/30 |
| Видимые распознаваемые кнопки | 45/48 | 40/43 | 27/30 |
| Restart source candidate, включая скрытый | 45/48 | 40/43 | 27/30 |
| Видимая Restart-кнопка до/после попытки Start | 20/48 | 18/43 | 16/30 |
| Регистрация RAF наблюдалась | 38/48 | 36/43 | 23/30 |
| Регистрация interval наблюдалась | 1/48 | 1/43 | 1/30 |
| Регистрация timeout наблюдалась | 1/48 | 1/43 | 1/30 |
| `game_started` до пользовательского действия | 0/48 | 0/43 | 0/30 |

Отсутствие раннего события не доказывает отсутствие autostart механики.
Графический HUD без текстового представления не был достоверно классифицирован:
0 подтверждений, семантический статус неизвестен. У 1/43 LLM HTML не наблюдалось
чисел ни в DOM, ни в Canvas text; это также не доказательство graphical-only HUD
или дефекта. Canvas images/WebGL/OCR не интерпретировались. Объём наблюдаемой
механики без правил ограничен доступным текстом, timer/render activity,
интерфейсом кнопок и lifecycle events; win/loss и правильность правил Stage 0
не доказывает. Эти неизвестности сохранены в per-document audit, не заменены PASS.

В исторической смешанной выборке Events не являются меньшинством: 22/30 Full
HTML дали события. Однако все **6/6** современных документов без bridge,
включая обе обязательные регрессии, дали **0/6 событий**, **0/6 render-text** и
**0/6 advanceTime**. Поэтому bridge нельзя считать универсальным механизмом
текущего свободного Full HTML контракта. Исторический coverage не переносится
на новые документы без изменения генерационного контракта.

Фактические зависимости:

- `browser-check.ts` выбирает Full HTML при отсутствии Start marker. Этот путь
  вызывает `checkFullHtml`, технический gate, без rules-aware proof.
- Production использует только `summarizeSession` из `gameplay-check.ts` для
  старого маркированного пути. Это pure mapping ранее собранных наблюдений.
- `gameplayCheck`, `runRulesGameplay`, `rules-probe.ts` вызываются из отдельного
  `scripts/orchestrator-gameplay-audit.ts` и browser tests. Текущий Orchestrator
  engine также не вызывает этот rules-aware runner автоматически.
- Events v1 store/runtime доступны историческим Full HTML/marked документам,
  но не обязательны для текущего generation contract. Наличие source строк не
  считалось доказательством доставки события; host наблюдал реальный postMessage
  от конкретного iframe после session init. Сами события считаются недоверенными.

Приватные доказательства Stage 0: `inventory.json`, `stage0.json`,
`corpus-audit.json`, `corpus/<sha256>.html`, `protected-before.json` и
`protected-after.json` в `D:\YAPLIX\.local\micro028-t1\`.

## Stage 1 — контроль до checker

Сначала сохранены шесть HTML, SHA manifest, oracle, seeds 17/101/991 и Git commit.
Отдельный rule-specific oracle до реализации T1 подтвердил все шесть ожидаемых
поведений, без изменения исходников игр или инъекции состояния.

| Семейство | Исправная | Эквивалентная | Дефектная | Различия / дефект |
| --- | --- | --- | --- | --- |
| Binary switch register | a | b | c | DOM+interval против Canvas+RAF/key latch; Toggle в c не меняет lamp/turns |
| Pressure regulation | d | e | f | DOM+interval против Canvas+RAF/key latch; f оставляет terminal pressure после Restart |

Эти механики отличаются от пяти исходных calibration genres. Эквивалентные
версии сохраняют правила; frame quantization явно ограничена <20ms. Новые шесть
документов — authored controls, **не LLM output**. Oracle хранится отдельно;
`probe.mjs` не читает его, названия дефектов, manifest или fixture catalog.
DEV включает старые 15 fixtures, 7 adversaries и обе реальные регрессии.
HELD-OUT не использовался для настройки T1 и открыт один раз после freeze.
Один Codex создал и controls, и checker: полноценной независимой слепоты нет.

## Stage 2–3 — что именно проверяет прототип

Модуль: `research/micro028-t1/`, без production imports на этот каталог.
Три seed, два повтора, независимые A/B contexts: **12 исполнений на документ**.
Start выбирается по доступной кнопке с общим названием либо единственной
начальной кнопке рядом с surface. Выбор кандидата не является Start proof.
Затем одинаковые clock/viewport/seed и 32ms passive baseline. A не получает
gameplay input; B получает заранее заданный общий arrow sweep и доступные кнопки,
без маршрута конкретной игры. Ни состояния, ни score/health/win не присваиваются.

Доступные claims: наблюдаемый Start UI transition с corroboration, числовое A/B
отличие, стабильный terminal interface без ввода и reset доступных чисел с одним
последующим действием. Отдельно сохраняются observed/changed numeric tokens.
Предполагаемая метрика остаётся UNESTABLISHED; gameplay progress, rule win/loss
и полный reset мира **всегда NOT_VERIFIED**. События, пиксели и arbitrary numbers
не повышают T2. Даже реальное изменение `turn` на сломанном управлении не является
доказательством правильного движения или победы.

Canvas interception — bounded test init script для `fillText`/`strokeText`;
оригинальный HTML и экспорт не меняются. DOM text/attributes читаются отдельно.
Без чисел возвращается отсутствие доказательства, а не FAILED. Native graphics,
transforms, images, WebGL и декоративные эффекты могут быть ненаблюдаемы.

Лимиты объявлены до held-out, не увеличивались:

| На одно исполнение A или B | Лимит |
| --- | ---: |
| Wall / simulated time | 20s / 30s |
| User input events / snapshots | 100 / 12 |
| JSON diagnostic / screenshot | 256 KiB / 2 MiB |
| Optional browser trace | 8 MiB, oversize удаляется с записью BUDGET_LIMIT |
| Основное наблюдение / restart overhead | 6s / менее 0.8s simulated |

Шесть секунд — исследовательский бюджет, не норматив времени прохождения.
Timeout/instrumentation failure отделены как PROBE_UNSUPPORTED/CHECKER_ERROR.
FAILED допускается только при повторяемом критическом exception, атрибутированном
исходному документу. Отсутствие числовой реакции не является сломанным input.

### Clock и RNG: фактические эксперименты

Установлены `page.clock.install()` и pause до навигации и timer initialization.
В текущем Chromium `srcdoc` обнаружил race init instrumentation: при virtual
`runFor(1000)` interval/timeout дали 0 тиков, первый RNG остался нативным, хотя
последующее чтение Date было virtual. В первом oracle `runFor(5100)` сдвигал Date,
но игровое elapsed изменилось лишь на 60–80ms. Это tooling failure, не дефект игры.

Offline route-fulfilled document в `iframe sandbox="allow-scripts"` с прежним
GAME_CSP дал следующие результаты; внешний сервер не запускался:

| Timer, 1000ms | Обычное время | Virtual время |
| --- | ---: | ---: |
| RAF callbacks | 150 | 62 |
| Interval 100ms | 10 | 10 |
| Recursive timeout 100ms | 10 | 10 |

Virtual RAF не воспроизводит физическую частоту экрана. Seeded init-script в
document route дал одинаковое первое значение `0.24265636410564184` во всех шести
normal/virtual timer checks; srcdoc — разные нативные значения. Math.random
подменяется только в test context; crypto RNG не объявляется контролируемым.
При обнаруженном crypto.getRandomValues строгий causal claim запрещён.

Обычный inline security script, а не DevTools eval, подтвердил parent-DOM denial,
storage denial, CSP eval denial и opaque `self.origin === 'null'` в 12/12 проверок.
Sandbox/CSP не ослаблены. Отдельный clock-sensitive DEV на трёх seed показал
62/63/63 в обычном времени против 124/124/124 virtual: это намеренно authored
adversary, демонстрирующий границу тестовых условий, не поведение реального телефона.

### DEV и предотвращение ложных выводов

Финальный DEV: 24/24 controlled/repeatable, 0 checker errors, 1 FAILED на известном
JS-exception fixture; false FAILED на пяти исправных calibration games — 0/5.
Контрольные дефекты gameplay автоматически не решены: 9/10 не получили FAILED.
Numeric A/B difference на некоторых дефектных fixtures лишь подтверждает изменение
доступных полей, а не исправность управления или достижимость цели.

Отдельные adversaries: idle animation, визуальный click без state change,
автономное число, ложная надпись win, ложный v1 `game_won`, clock-sensitive code,
restart без reset. Первые пять не получили input/win proof; screen-only restart
не получил reset proof. Ни одно fake win не повысило ruleWin из NOT_VERIFIED.

В первом DEV была ошибка parser: координаты диагностического Canvas prefix
ошибочно участвовали как видимые числа. Она создала ложный предварительный
A/B сигнал на MICRO-027. Parser исправлен **до freeze и held-out**, весь DEV
повторён. Исходный неудачный DEV сохранён, не выдаётся за финальное подтверждение.

## Stage 4 — единственный held-out и реальные регрессии

Перед запуском проверены exact HEAD `81c46b7`, отсутствие diff research tree,
все шесть SHA-256, seeds и лимиты. Plan сохранён до запуска; повторный campaign
в ту же директорию запрещён. Checker между документами и после просмотра результата
не менялся. V = VERIFIED конкретного аспекта; NV = NOT_VERIFIED.

| Control | HUD / timer | Start | A/B number | Passive terminal UI | Observed reset + action | Repeatability | Wall sum / actions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a good | DOM / interval | NV | V | V | V | yes | 17.455s / 150 |
| b equivalent good | Canvas / RAF | NV | V | V | V | yes | 21.773s / 150 |
| c disconnected input | DOM / interval | NV | NV | V | NV | yes | 17.877s / 240 |
| d good | DOM / interval | NV | NV | NV | NV | NON_DETERMINISTIC | 17.560s / 216 |
| e equivalent good | Canvas / RAF | NV | V | V | V | yes | 21.976s / 216 |
| f bad restart | DOM / interval | NV | NV | NV | NV | NON_DETERMINISTIC | 17.554s / 216 |

Start remains conservative when Begin is replaced by another button without
an independently recognized overlay transition. Это наблюдаемая недопроверка,
не дефект controls. У d повтор B/seed17 дал pressure9 вместо12 при одинаковом
explicit action log; остальные соответствующие повторы совпали. У f также есть
расхождение. Причина не установлена; native Space/focus interaction — возможная
гипотеза, **не проверенный диагноз**. Не проводились новые прогоны/настройка по
этому held-out. Глобальный repeatability gate понижает и стабильную passive часть.
Пара a/b перенеслась между HUD/timer; d/e выявила неподтверждённую переносимость.

| Метрика held-out | Результат и знаменатель |
| --- | --- |
| Correct verified core T1 aspects | 10/24 (четыре аспекта × шесть документов) |
| Все VERIFIED, включая numeric diagnostics | 21/60 |
| NOT_VERIFIED aspects | 39/60 |
| False VERIFIED на заранее заданных defect aspects | 0/2: c.input, f.restart |
| False FAILED исправных документов | 0/4 |
| CHECKER_ERROR / PROBE_UNSUPPORTED | 0/6 / 0/6 документов |
| Воспроизводимые документы | 4/6 |
| Defect documents с доказанным FAILED | 0/2; блокировка aspect не означает diagnosis |
| Whole-game Gameplay VERIFIED | 0/6; такой автоматический сертификат не выдаётся |

Correct core claims: a3+b3+c1+e3. Никакой generic gameplay accept из них не выводится.
Знаменатель 0/2 относится только к предопределённым дефектным аспектам, не ко всем
возможным нарушениям шести игр. Маленькая authored выборка одного автора не даёт
статистической гарантии false accept/reject для реальных LLM игр.

Всего 72 arm executions: 114.195s суммарного wall, 1188 input events, максимум на
arm 2.062s wall, 6314ms simulated, 35 input events, 11 snapshots, 7675 bytes JSON.
Wall sum строки — 12 исполнений, не превышение 20s per-arm. Общий лимит campaign
не подменяется лимитом одного исполнения. Нагрузочного/телефонного benchmark нет.

После held-out выполнен отдельный frozen-code campaign реальных регрессий:

| Реальная игра | SHA-256 | Повторы / seed | T1 Start/input/terminal/reset | Wall sum / actions |
| --- | --- | --- | --- | --- |
| Оригинальная «Доброта для всех» | 8db53bfbfb6681cf82c3ac2582d4319c3888feaf3fedfa4c88216b5c50d5beac | повторяемо, A/B отличие только seed991 | все NV | 21.478s / 156 |
| Сохранённая LIVE MICRO-027 | aafce7e3572e0c2db77853aa40928e736f6940c2a895c07961b9426d76f14e5d | повторяемо, A/B numeric distinction нет | все NV | 3.750s / 168 |

Kindness имеет numeric token observed/changed; MICRO-027 — observed, без changed.
Это **не** новые определённые gameplay T1-аспекты: **0/8 core aspects, 0/2 игр**.
Нет доказательства неработающего управления или нового game defect. False FAILED
на этих известных реальных регрессиях — **0/2**, checker errors — **0/2**.
Итоговые screenshots обеих игр просмотрены; traces содержат реальные действия.
Для final held-out+real максимальный trace37446 bytes, screenshot33341 bytes,
суммарно сохранено1810237 bytes. Бюджеты не превышены, артефакты не отбрасывались.

Private outputs: `heldout-final/plan.json`, per-document `result.json`, A/B
`browser.zip` и `final.png`, `heldout-evaluation.json`, `real-final/`,
`dev-first/`, `dev-final/`, `clock-check/results.json`, `clock-sensitive.json`.
Они находятся только в `D:\YAPLIX\.local\micro028-t1\`.

## Stage 5 — ручная T2-приёмка

**Процедура recorder ниже историческая (MICRO-028.2).** Для текущего запуска
использовать [MICRO-028.3](micro-028-t2-pilot.md): журнал ввода, partial recovery,
HUMAN_REPORTED без auto-VERIFIED и export только в offline opaque iframe.
Прямой переход на оригинальный `file://` удалён; native file acceptance остаётся
NATIVE_FILE_EXPORT_NOT_VERIFIED. T1 NO_GO и исторические измерения не изменяются.

Доступно достаточно сохранённых provenance игр: подготовлен private
`manual-plan.json` на **10 разных HTML** с разными game/source groups, включая
две обязательные регрессии. Для каждого сохранены hash, источник/provenance и
восемь отдельных `HUMAN_ACCEPTANCE_PENDING` аспектов. Новые LLM игры не создавались.
Новых человеческих прохождений/оценок нет: **0/10 выполнены, 10/10 pending**.
Исторические MICRO-027 win/loss/export не засчитываются в новую T2-приёмку.

Воспроизводимая процедура владельца из `D:\YAPLIX`:

1. Прочитать выбранную запись `manual-plan.json`, проверить источник LLM и SHA.
   Запустить `node research/micro028-t1/manual.mjs manual-01` (далее до manual-10).
   Используется существующий Chromium, без установки пакетов/генерации.
2. Прочитать правила, определить их человеком; неизвестную цель не угадывать.
   Записать правила/управление в terminal recorder. Игра работает в видимом offline
   opaque iframe с тем же CSP; играйте мышью/клавиатурой/эмуляцией touch вручную.
3. Для Start, input и progress записать точные действия и наблюдаемые изменения.
   Попытаться достичь предусмотренной победы; отдельно открыть новую партию и
   попытаться достичь предусмотренного поражения. Надпись/событие без выполнения
   установленного правила не является T2 VERIFIED.
4. После реального завершения проверить Restart, восстановление мира/прогресса
   и новое действие. Повторить доказанный путь; недоступные/не достигнутые аспекты
   оставить NOT_VERIFIED с причиной и бюджетом.
5. В каждой фазе recorder просит status, actions и наблюдение, снимает screenshot.
   Время обычное, RNG native: фиксировать воспроизводимость с этим ограничением.
   Затем открывается тот же byte-exact HTML как standalone file offline:
   повторить input/progress/end/restart и записать отдельный export результат.
6. Сохранить `human-record.json`, screenshots и `browser.zip` в отдельной
   `.local/micro028-t1/human/manual-NN/<timestamp>/`. Recorder ограничен15 минутами,
   oversized trace >32MiB удаляется с явным статусом; не считать отсутствие trace PASS.
   Текст владельца маркируется HUMAN_REPORTED и требует сопоставления с evidence.

Recorder проверен синтаксически и через `--help`; интерактивный human workflow
не запускался Codex и не объявляется VERIFIED. Его ошибка help с принудительным
`process.exit` в Windows pipes устранена обычным завершением, повтор help успешен.
Physical Android/iOS, Safari/WKWebView и Telegram не проверены; browser emulation
не заменяет такие результаты.

## Проверки и архитектурное решение

Локально выполнены: typecheck PASS, production build PASS, unit248/248,
исследовательские units8/8, Python19/19, CI policy8/8, существующий Chromium
production smoke11/11 (Full HTML/opaque sandbox/errors/restart/repair), repository
text/link check и diff check. Clock matrix12/12 isolation checks, DEV24 документов,
held-out6 и реальные2 исполнены отдельно от production smoke. Secret scans
controls/research/history не нашли секретов; publication manifest сканируется
перед commit/push. Hosted Actions не запускались и не считаются PASS.

**Вариант C.** Не интегрировать этот probe в production; прекратить универсальный
автоматический checker в текущем MVP и провести подготовленную ручную T2-приёмку
10 сохранённых игр. Важные причины: нулевой новый core coverage на двух реальных
регрессиях и instability одной исправной held-out реализации. Нули false VERIFIED
и false FAILED не компенсируют это. Локальные authored частные успехи полезны
как исследовательские данные, но не дают оснований для production GO.

Развитие надёжности генерации и возможный read-only render-text/advance-time
контракт требуют отдельной задачи и решения владельца. GameBlueprint остаётся
для самостоятельного MICRO-029. Production acceptance и MVP/LIVE guarantees
этой задачей не повышены. Main не merged, ветка не удаляется.
