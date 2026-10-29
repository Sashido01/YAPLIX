# Известные ошибки и восстановление YAPLIX

### YAPLIX-SUBMISSION-FINAL-008 follow-up — 29 октября 2026

После добавления в production prompt явной компоновки 844×390 чистый повтор
пяти жанров через Ollama Cloud `gemma4:31b` всё ещё дал 0/5 принятых игр:
8 POST, 4 ограниченных repair, 0 неизвестных исходов. Две игры завершились
`BROWSER_CANVAS_UI_OVERLAP`, одна — `BROWSER_CANVAS_TEXT_CLIPPED`, две —
`BROWSER_CANVAS_ACTIVITY_UNVERIFIED`. Сверка пяти строк `events.jsonl` с
`summary.json` прошла. Дополнительное повторение того же prompt-гипотезы не
проводилось. Эти результаты не оправдывают ослабление layout/activity gate;
нужны сохранённые HTML вместе с точным checker feedback и адресное исправление
причины до нового LIVE набора. Headless игровые клики и model generation
считаются разными свидетельствами.

### YAPLIX-SUBMISSION-FINAL-008 — LIVE жанровая выборка, 28 октября 2026

Пять новых durable jobs через Ollama Cloud `gemma4:31b` дали 0/5 технических
PASS после первого POST; четыре из пяти получили по одной bounded repair, и ни
один результат не был сохранён как игра. Первые четыре были отклонены из-за
подтверждённого Canvas text clipping; после repair три из четырёх достигли
`BROWSER_CANVAS_ACTIVITY_UNVERIFIED`, который означал, что проба не попала в
кнопку Start, а не доказывал отсутствие игрового цикла. У пятого сразу был этот
неподтверждённый activity результат. На пяти сохранённых checkpoint HTML
визуально обнаружены Canvas START-кнопки около 50–58% высоты; relative tap
`x=0.5,y=0.58` действительно запускал все пять без JS-ошибок. Production checker
пробовал `y=0.50,0.88,0.50`, поэтому средняя проба пропускала их. Перенос средней
пробы на `y=0.58` проходит отдельный RED/GREEN regression тест. После того как
подтверждённый выход текста до 2 CSS px стал minor warning, replay без новых
LLM вызовов дал технический PASS 3/5; Snake не помещает Canvas в viewport
844×390, Racing имеет подтверждённое пересечение текста. Не считать эти два
результата принятыми и не считать gameplay PASS по одному запуску Start.
См. `.local/yaplix-submission-final-008/REPORT.md` и сохранённые HTML в
`.local/yaplix-submission-final-008/live/`.

### YAPLIX-SUBMISSION-FINAL-008 — bounded Canvas input scan, 29 октября 2026

Повторный Chromium matrix сначала показал, что замена lower probe на y=0.58
ломает near-bottom Start; добавление обеих точек восстановило оба теста. Затем
четвёртый generic tap случайно доходил до Game Over в strict fixture. Проверенный
remedy: оставить порядок center → y=0.58 → y=0.88 и ограничить probe тремя
нажатиями. Целевые тесты near-bottom/centered Start, generic validator, ниже
середины, hidden victory и post-Game-Over markers прошли 7/7 в Chromium.
Полная матрица на точной изолированной копии: 638 PASS, 2,218 configured skips,
0 FAIL; unit tests 578/578. Первый exploratory run также показал Firefox 502 на
loopback/LAN при унаследованном proxy; isolated full runner убирает proxy только
для offline/browser test processes, после чего Firefox Arena/phone прошли.
Отдельный WebKit tablet timeout прошёл на focused replay и full rerun. Эти
результаты не заменяют hosted CI или физические устройства. См. локальный
`.local/yaplix-submission-final-008/REPORT.md`.

## YAPLIX-FINAL-001 — подтверждённая причина автоматического repair отказа

Production `canvasDiagnosticFeedback` помещает measured confirmation в объект
`canvasTextLayout`; repair eligibility ранее читала поля только сверху и потому
отбрасывала реальный `BROWSER_CANVAS_TEXT_CLIPPED` как неподтверждённый. При этом
trace хранил `confirmed:true`, устойчивые измерения и viewport. Проверка теперь
разбирает вложенный evidence, повторно проверяет полный HTML и передаёт диагностику
той же модели. Regression использует production-shaped fixture. В LIVE после
backend restart confirmed checkpoint автоматически перепроверен, выполнил repair
и затем корректно остановился на другом `BROWSER_CANVAS_RENDER_UNVERIFIED`; это
подтверждает путь repair, но не готовность игры. Evidence без подтверждения и
browser timeout остаются `NOT_VERIFIED` и не расходуют repair budget. См. локальный
`.local/yaplix-final-001/REPORT.md`.

Для новых job сначала используйте [диагностический API и trace guide](diagnostics.md).
Таблица ниже объединяет подтверждённые исторические инциденты; каждый пункт
сохраняет собственную дату, среду и границы доказательства.

Справочник действий по текущему коду. Реальные результаты и ограничения сети
TASK-008 зафиксированы в [отчёте](task-008-report.md), TASK-010 — в [едином отчёте](task-010-report.md); они не доказывают причину
каждого будущего сбоя. Сначала сохраните запрос/черновик и проверьте этап,
код ошибки, состояние задания и диагностику. Не прикладывайте `.env`, ключи,
initData или необработанные журналы. [Запуск и обслуживание](../README.md).

### YAPLIX-RELEASE-007F — холодный запуск opaque game iframe

Наблюдался intermittent blank screen в сохранённой LIVE игре: iframe имел
ненулевой размер, но Canvas иногда оставался 0×0 без page error или CSP violation.
При назначении `srcdoc` до вставки iframe host layout ещё не был подтверждён.
Парный Chromium probe той же HTML дал 19/20 с прежним порядком против 20/20 при
назначении `srcdoc` на следующем animation frame после append. Runtime монтирует
sandboxed `allow-scripts` iframe и сохраняет CSP; `allow-same-origin` не добавлен.
В текущем кандидате runtime cold-open loop прошёл 20/20, в том числе на
пользовательски отредактированной LIVE версии. Если повторится, сначала сохраните
точную version ID, screenshot и размеры host/iframe/Canvas; не ослабляйте sandbox
и не меняйте checker. Отдельно: технический Canvas PASS не доказывает победу или
полное прохождение игры. Full test также поймал ложный WebKit offline-export
network failure: pending `game_ready` POST предыдущего `/host` запроса начинался
до перехода на `file://`; тест теперь относит запрос к исходной странице по
`request.frame().url()`. Исходные 3 WebKit профиля и дополнительный Chromium
контроль прошли после исправления (5/5). См. `.local/yaplix-release-007f/REPORT.md`.

### YAPLIX-GENERATION-RECOVERY-001 — 28 октября 2026

`BROWSER_CANVAS_ACTIVITY_UNVERIFIED` означает, что наблюдатель не увидел смену
Canvas после конечного набора общих касаний; стартовый экран или промах по
Canvas-кнопке остаются возможны. Сверяйте screenshot и координаты input, не
считайте это доказательством сломанной игры и не снимайте gate. Checker добавил
центральные taps в точках 50%×45% и 50%×54%; оба authored Canvas-контроля проходят,
inert контроль продолжает блокироваться. Сохранённый Ollama `BROWSER_CANVAS_TEXT_CLIPPED`
наоборот подтверждён снимком с реально обрезанной строкой: это дефект результата.
OpenRouter `LLM_RESPONSE_BODY_TOO_LARGE` с HTTP 200 остановился до полного потока,
HTML и browser-check; не увеличивайте лимит и не повторяйте запрос автоматически.
Сводка evidence: `.local/yaplix-generation-recovery-001/REPORT.md`.

### YAPLIX-GENERATION-RECOVERY-002 — 28 октября 2026

Четыре metadata-only traces показывают разные причины: подтверждённое clipping
у Ollama, две неопределённости Canvas activity, и OpenRouter body cap после HTTP
200. Реакция игр на правильный Start не подтверждена без исходных HTML.
ChatGPT wire-dispatch/HTTP trace gap исправлен в текущем source без изменения
one-POST policy; исторический POST count остался `NOT_VERIFIED`. Не повышайте
body cap и не повторяйте inference автоматически. Детали и blockers:
`.local/yaplix-generation-recovery-002/REPORT.md`.

| Ошибка / симптом | Причина и безопасное действие |
| --- | --- |
| Короткий игровой запрос получает `UNKNOWN` или название в отрицании ошибочно становится механикой | Локальный словарь теперь содержит отдельные жанры, 25 архетипов, перечисленные RU/EN алиасы, механику, аудиторию, оформление и явные запреты. Он использует ограниченную NFC-нормализацию без стемминга, игнорирует цитируемый текст и сохраняет несколько названных идей. Проверяйте только на development-корпусе; неизвестное оставляйте `UNKNOWN`, не дополняйте пользовательский текст. Подробности, baseline и границы: [Game Vocabulary](game-vocabulary.md). |
| `BROWSER_CANVAS_RENDER_UNVERIFIED` / `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` | Canvas-контракт может отклонить визуально работающую игру, если поле нарисовано только CSS, игровое изображение не даёт крупных различимых цветовых областей в 32×24 preview или после пробного действия не наблюдается смена кадра. Рисуйте игровое поле и мир в Canvas; для `ACTIVITY` смотрите сохранённые draw counts, image hashes и точку tap. Не снижайте порог checker-а и не принимайте игру только по любому движению пикселей. Подтверждённый разбор: `.local/canvas-001/REPORT.md`. |
| Generated game `JAVASCRIPT_EXCEPTION`: `localStorage` fails inside the game frame | Confirmed in saved “змейка для бабушки” HTML: opaque `sandbox="allow-scripts"` intentionally omits `allow-same-origin`, so reading `localStorage` throws `Failed to read the 'localStorage' property from 'Window'`. The browser checker is correct; preserve the draft and exact browser feedback, make the game tolerate unavailable storage (or avoid browser storage), then run the full checker before saving. Never add `allow-same-origin` to the game frame to hide the error. Evidence: `.local/game-fix-001/REPORT.md`, `repaired-snake.html`. |
| Portable INSTALL-002: PERMISSION при подготовке профиля | Подтверждено реальным read-only тестовым каталогом на Ubuntu: запись недоступна. Восстановите право записи в свой каталог YAPLIX и нажмите «Повторить». Установщик не требует root и не меняет системные права/библиотеки. Неверная SQLite также блокирует установку до запуска, её байты сохраняются. Evidence: `.local/install-002/lifecycle-evidence.json`, `corrupt-data-evidence.json`. |
| Ubuntu: production checker даёт `BROWSER_SANDBOX_UNAVAILABLE` в длинном пути клона | В launch log 24.10.2026 подтверждён `FATAL ... Socket path too long ... SingletonSocket`. Это Linux UNIX socket limit, не доказанная неисправность sandbox. Созданный Ubuntu-аудитом клон перемещён целиком в короткий `.local/ubuntu-prep/c`, без изменения исходников; не отключайте sandbox и не перемещайте чужие worktree без инвентаризации. |
| Arena E2E в быстром Firefox получает `ARENA_ATTEMPT_RATE` | Сервер намеренно запрещает новую попытку раньше 1000 ms. Browser test завершал броски и сразу открывал keyboard run в том же окне. Test helper теперь ждёт остаток окна от предыдущего подтверждения попытки; счёт, gameplay assertions и production limit сохранены. Исходный RED и адресный GREEN записаны в Ubuntu REPORT. |
| Ubuntu перенос: `tsc` вызывает отсутствующий `node.exe` | Проверено 24.10.2026: это Windows `node_modules`, а не ошибка TypeScript source. Сохраните каталог отдельно и выполните `npm ci` под Node 24.18+ (24.x). Lock не обновлять. Linux typecheck/build после установки прошли в перенесённой копии и чистом main. [Ubuntu](UBUNTU_SETUP.md). |
| `browsers:install` exit 0, но Linux executable отсутствует | Перенесённый Windows cache содержит совпадающие Playwright revision/INSTALLATION_COMPLETE. Сохраните `.local/playwright` отдельно и установите Linux browsers в новый каталог. Не удаляйте старые reports/DB/игры. Проверяйте фактический launch, а не только install exit code. |
| Offline transport tests: `LLM_PROXY_CONNECTION` вместо ожидаемых mock/DNS ошибок | На Ubuntu host proxy унаследован, NO_PROXY содержит неподдерживаемый YAPLIX CIDR `127.0.0.0/8`; mocked provider errors также получают proxy route. Probe подтвердил direct при точном loopback. Удаление proxy env только у процесса offline tests даёт 27/27 transport и полные 499/491 suites. Рабочий proxy и глобальную конфигурацию не менять. [Проверенные команды](UBUNTU_SETUP.md#проверки-и-proxy). |
| WebKit installed, но не запускается на Ubuntu | Exit 0 установки сопровождался missing libraries. На этом хосте нужны libevent-2.1-7t64, libavif16 и его libgav1-1/libyuv0. Они извлечены из Ubuntu deb внутри проекта; LD_LIBRARY_PATH процессный. Глобальные apt/AppArmor/sandbox не менялись. Фактические browser outcomes смотреть в локальном Ubuntu REPORT. |
| Arena: `LAN_QR_UNAVAILABLE` при новом URL комнаты | QR телефона допускает только `/phone`. Arena использует отдельный узкий QR-формат `/arena/<UUID>#<secret>` с частным IPv4; не расширяйте общий QR до произвольных URL. Browser E2E декодирует QR и проходит реальные касания десяти clients, без подстановки score. В тесте нужен частный IPv4, loopback QR запрещён. [Демо и ограничения](arena.md). |
| Arena: версия не выдаёт score/завершение | Маркер score-v1 — заявление контракта, не gameplay PASS. Без него UI показывает недоступность, без числового score и session_ended рекорд не создаётся. Создайте отдельную совместимую версию вручную; не подставляйте очки по Start, DOM/Canvas или таймеру и не запускайте inference без бюджета. |
| A1.8.5: browser ESM graph assertion перечисляет только прежние три модуля | При корректных HTTP 200 четырёх модулей точный список `runtime.spec.ts` ещё ожидал три; полный прогон дал один и тот же RED во всех 12 профилях. Список обновлён совместно с unit graph, без ослабления status/session/gameplay assertions. Исходный failed full log сохранён; финальный HEAD требует нового полного прогона. |
| A1.8.5: `/runtime/generation-limits.js` возвращает 404 | Вынос pure cap в отдельный модуль добавил browser ESM import из contracts. Полный unit graph test воспроизвёл 404; новый dependency-free модуль добавлен в точный API allowlist и ожидаемый ESM graph. Server timeout module и произвольные пути по-прежнему не доступны. Это локальная source/build проверка, без пользовательского сервера. |
| A1.8.5: риск рассинхронизации metadata cap и job budget | Dependency-free `src/generation-limits.ts` задаёт прежние 35 min для parser и server timeout policy; `generation-timeouts.ts` сохраняет прежний экспорт. Regression сохраняет maximum configurable job budget во всех пяти timing fields и проверяет меньшие явные response/job limits. Восстановление старого metadata cap 5 min даёт 16 RED, текущий parser — 31/31 GREEN. Реальные inference deadlines, historical profiles и one-POST guard не увеличены. |
| A1.8.4: длинная генерация отклонена с `INVALID_GENERATION_METADATA` | На PR #49 `07e42a5` parser принимал timings только до 5 минут при job budget 35 минут. RED на 29/30/35 min для всех timing fields; metadata cap теперь 35 min, включая saved metadata. Целые конечные неотрицательные значения и исторические profiles сохранены. Inference POST deadlines и durable budgets не увеличены; проверки synthetic, без реального ожидания upstream. |
| MICRO-029 A1.7: `npm run check` в ограниченном Windows executor получает 20 s timeout вложенного Chromium | Три последовательных MICRO-030 landscape case не завершились вовремя; тот же `direct` case в host-контексте прошёл за 1.9 s без изменения кода checker. Это сравнение окружений, не доказательство конкретного механизма блокировки. Запускайте offline browser checks через разрешённое per-command исключение; не ослабляйте sandbox/CSP или validation budgets. Пользовательский сервер и LIVE-базы для этого не нужны. |
| MICRO-029 A1.7: провайдер не настроен / длинная генерация прервана | Synthetic env-file probe подтвердил: inherited empty key перекрывает `.env`; пустой/whitespace ключ не создаёт route. `npm run doctor:providers` показывает только presence/configuration и бюджеты, без сети и SQLite. Причина прежнего LIVE отказа Ollama/OpenRouter NOT_VERIFIED. Общие defaults: response 30 min / durable job 35 min для всех трёх провайдеров; меньшие явные настройки видны в UI. Restart/Continue не продлевают deadline, ChatGPT сохраняет one-POST guard. Headers/body/SSE/AbortSignal конечны; SQLite completion откатывается при выходе за deadline. [Настройки и безопасный запуск](chatgpt-setup.md#длительная-генерация--stage-a17). |
| A1.8.5: отсутствие свежего render/activity evidence ошибочно отмечалось FAILED | `BROWSER_CANVAS_RENDER_UNVERIFIED` и `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` теперь сохраняются как NOT_VERIFIED, при том же отказе Save/Ready и запрете repair/fallback. Два level regressions RED→GREEN; Canvas required и DOM world остаются FAILED. Положительная анимируемая WebGL/WebGL2 mini-game отдельно проверяет score/win/Restart и native false buffer. Это authored offline proof, не качество реальной LLM-игры. |
| A1.8.5: terminal clear отклонён или остановленный WebGL принят по старому draw | Game Over overlay теперь требует changing exposed Canvas history до перехода; до/после Restart evidence разделено, пустой активный или post-Restart Canvas отклоняется. WebGL readback выполняется microtask после синхронного draw/clear; native rAF heartbeat истекает evidence non-preserved buffer за текущий/предыдущий кадр. RED: cleared terminal overlay и stale WebGL/WebGL2; свежий rendering/terminal semantics разделены. 18 s deadline, CSP/opaque sandbox и no-repair не ослаблены. [Сценарии и NOT_VERIFIED](canvas-rendering-contract.md). |
| A1.8.4: MICRO-022 repeat/format-repair positive fixtures отклонены после Restart | Полный integration run обнаружил: synthetic fixture рисовал только полосу score и при корректном Restart (`score=0`) оставлял пустой Canvas. Финальный rendering gate корректно отказывал. Authored restart fixture теперь рисует поле и цель независимо от score; no-op/crashing Restart по-прежнему обязаны отклоняться. Production gate и его пороги не ослаблены. |
| A1.8.4: поздний clear/backing reset получает ложный Canvas PASS | На PR #51 `a43a005` RED воспроизводит приём пустого конечного кадра после накопленного rendering evidence для 2D/WebGL/WebGL2. Gate теперь проверяет последний Canvas, activity history только того же ID/context, кадр после Restart и offline keyboard. Краткий clear → redraw допускает до 100 ms повторного наблюдения внутри прежнего browser deadline. Старые draw counters не заменяют meaningful image. Sandbox/CSP/offline и gameplay NOT_VERIFIED сохранены. |
| A1.8.2: ответ после 5 минут отклоняется как `INVALID_GENERATION_METADATA` при defaults 30/35 min | Публичный parser и GenerationEngine с synthetic `performance.now()` воспроизвели отказ для 29-minute response: прежний metadata cap был 300000 ms. Cap сохранения timings согласован с максимальными 35 min job; отрицательные, дробные, нечисловые и превышающие предел значения по-прежнему отклоняются. Dispatch deadlines, provider routes и one-POST guard не расширялись. |
| A1.8.2: WebGL draw → clear/reset ошибочно получает rendering PASS | Offline regression через `checkFullHtml` воспроизвёл PASS для кадра, немедленно стёртого `gl.clear()` или присваиванием `canvas.width`. Observer теперь переснимает явные WebGL clear и сбрасывает evidence при установке backing dimensions; оба negative fixtures отклоняются, положительный WebGL сохраняется. Это проверка рендеринга, не игровых правил. |
| A1.8: русский Start не распознаётся в локальном validation document без собственного charset | При `Content-Type: text/html` Unicode-текст декодировался неверно; общий probe открывал overlay, но не успевал проверить игру. Локальный fulfill теперь явно задаёт `text/html; charset=utf-8`. MICRO-027 fixture дополнен реальным Canvas draw/touch, сохранив исходный русский Start и opaque overlay; все 12 профилей проходят. Пустой Canvas по-прежнему отклоняется отдельным negative fixture. |
| A1.8: falling-blocks проходит lifecycle, но получает `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` | Наблюдённый probe сначала нажимал Pause и затем проверял движение в паузе. Общий Full HTML probe теперь пропускает служебные Pause/Resume/Restart в игровых действиях и снимает Canvas после каждого реального игрового нажатия, прежде чем противоположное направление отменит изменение. Исходный Orchestrator fixture проходит без изменения правил, Canvas gate и его порогов. |
| A1.8: нарисованный Canvas имеет нулевые наблюдённые draw-вызовы | В Chromium для `srcdoc` наблюдалась гонка: game inline script получил контекст до init instrumentation. Gate теперь загружает HTML через точный локально fulfilled document URL, до parsing устанавливая observer. Внешнего GET нет; opaque `allow-scripts` и CSP сохранены. Реальные Canvas 2D/WebGL fixtures и production job проверяются offline. Не отключайте gate и не добавляйте instrumentation в сохраняемый HTML. |
| `BROWSER_CANVAS_REQUIRED`, `BROWSER_CANVAS_LAYOUT`, `BROWSER_CANVAS_RENDER_UNVERIFIED`, `BROWSER_CANVAS_ACTIVITY_UNVERIFIED`, `BROWSER_DOM_GAME_WORLD` | Новая версия не получила достаточного Canvas/WebGL evidence или обнаружен DOM/SVG world. Draft и причина остаются в job, новая версия не сохраняется; автоматического repair/fallback нет. Continue перепроверяет полный checkpoint локально. Исправление требует нового явного запроса владельца. Старые HTML продолжают открываться и экспортироваться. [Границы проверки](canvas-rendering-contract.md). |
| MICRO-036.2: Full HTML checker проходит, но artifact отклоняется с INVALID_GENERATION_METADATA | На main 942387eb checker возвращает profiles [320,390,844], parseArtifact принимает только [320,390]. Synthetic metadata-only probe воспроизвёл ACCEPTED для двух и отказ для трёх профилей, без сети/SQLite. Требуется отдельное согласование контракта и checker→save regression; не удалять landscape evidence, не запускать новый inference для диагностики. [Аудит и воспроизведение](micro-036-2-docs-audit.md#блокер-контракта-full-html). Это исторический P0 на `942387e`; в ветке PR #46 исправлен MICRO-036.3 (раздел ниже), без нового inference. |
| NL-004: обе змейки теряют управление при 844×390 | Сохранённые DEV HTML рассчитывают поле без достаточного учёта высоты, body overflow:hidden блокирует прокрутку. Общее требование landscape не обеспечило адаптацию. MICRO-030 отклоняет подтверждённо недоступные controls; MICRO-031 уточняет общий prompt: три размера, все основные состояния, CSS shrink/reflow либо настоящая прокрутка без глобальной блокировки жестов. Offline tests проверяют подготовку сообщений; улучшение новых игр NOT_VERIFIED до отдельного разрешённого A/B. Исходные HTML не исправляются. [Контракт и границы](nl-game-intent.md#micro-031-доступность-управления). |
| MICRO-028N: QR listener отвечает с ПК, физический телефон не открывает страницу | В наблюдаемой сессии physical Wi-Fi имел Public profile, ActiveStore — enabled Inbound TCP Block для фактического node.exe на любом порту. IP QR/API совпал с bind, ПК получил `/phone` 200. После отдельного разрешения владельца: только этот доверенный Wi-Fi переведён в Private, добавлен Allow для exact Node/IP/interface/TCP port/local subnet. Владелец подтвердил physical Android / Brave: QR/start/touch/progress/restart/rotation/reopen/revoke PASS. Public Block сохранён; packet capture не выполнялся, другие сети не проверены. MICRO-036.1: порт по умолчанию 52604 постоянный при refresh/restart, `YAPLIX_PHONE_PORT` сохраняется в локальном `.env`; `PORT_IN_USE` не вызывает fallback. При смене IP/интерфейса/профиля сначала проверить применимость узкого правила; широкое разрешение Node не добавлять. Self-probe не доказывает LAN reachability. [Диагностика и STOP-GATE](micro-028n-phone-connectivity.md). |
| MICRO-026: unit `tunnel.test.ts` ждёт TUNNEL_CLOSED, но получает BACKEND_NOT_READY | Один параллельный replay при browser/build нагрузке не успел поднять synthetic backend; полный последовательный `node --test --test-concurrency=1 tests/*.test.ts` прошёл 235/235 без изменения timeouts/production. Это наблюдение локального теста, не доказательство внешнего tunnel отказа. |
| MICRO-026: старые `production.spec.ts` LIVE fixtures падают при локальных model endpoints | На неизменённом main 37653b9 повторён `FREE_MODEL_REQUIRED`: HTTP-disconnect fixture задаёт CLOUD_BASE_URL=localhost, запрещённый MICRO-019. Старые OLLAMA_BASE_URL fixtures также не настраивают текущий cloud route. В расширенном smoke 7 FAIL; production routes не ослаблять. Использовать актуальные isolated transport unit tests и отдельный runtime smoke; обновление legacy harness требует отдельной задачи. Это пробел тестов, не внешний inference proof. |
| MICRO-026: `eval` через Playwright evaluate не показывает запрет CSP | DevTools execution может обходить ограничение unsafe-eval. Проверенный способ: отдельный обычный inline script внутри allow-scripts opaque iframe выполняет security probe, Playwright только читает результат. Обычный eval/network заблокированы; parent DOM/storage недоступны. Это проверка браузерной изоляции, не доказательство безопасности произвольной игровой логики. |
| Firefox browserContext.newPage: Target crashed в ограниченном executor | В MICRO-024 Firefox падал до загрузки приложения; тот же локальный профиль вне sandbox прошёл создание страниц и сценарии. Это наблюдение двух условий, не доказательство конкретной внутренней причины crash. Не меняйте sandbox/CSP игры и не увеличивайте retries. |
| MICRO-024: нет QR / несколько адаптеров | Активный физический Wi-Fi/Ethernet + private IPv4 обязательны. Windows физический список исключает наблюдаемый VirtualBox Ethernet 3, даже если имя не содержит virtual. Выберите сеть телефона; PHONE_NETWORK_CHECK_FAILED не подменяется непроверенным первым IP. Подключение включается в UI, без npm. |
| MICRO-024: QR открывается на ПК, телефон не отвечает | Self-probe подтверждает только локальный listener. Проверьте частное разрешение Node.js в Windows Firewall, LAN access VPN и гостевую изоляцию Wi-Fi. Их блокировка не установлена автоматически; программа не меняет правила или маршруты. |
| MICRO-024: LIVE «провайдер недоступен», хотя игра создана | Прежняя строка отражала отдельный GET models с 3 s timeout. Это не inference probe. Теперь UI показывает служебный источник/время/код, отдельно сохранённый success выбранного provider; не заявляет неизвестную квоту или недоступность генерации. |
| MICRO-023L: LIVE игра прошла technical gate, но джойстик скрыт | На неизменённом ответе gemma4:31b подтверждено в Chromium Pixel5 390×844: maxTouchPoints=1/coarse=true, но `'ontouchstart' in window=false`; startGame оставляет display:none, реальный swipe не двигает персонажа. Это чувствительное к окружению условие данного артефакта; physical devices не проверены. MICRO-024 повторно загрузила тот же HTML без изменений: standalone setContent воспроизводит false/hidden, в текущем served opaque iframe property=true и joystick=block. Это не доказывает исправление на всех устройствах. Prompt усилен, mobile probe не использует клавиатуру; универсального source regex/fix нет. Desktop сбор20/20, win/loss/restart работают. Второй POST остановлен по owner budget; HTML/исходная версия сохранены, универсальный regex fix не добавлен. Touch нельзя объявлять PASS по одному startup gate. [Приёмка](SESSION_HANDOFF.md). |
| MICRO-023: `LLM_RESPONSE_BODY_TOO_LARGE` / `LLM_HTTP_BODY_TOO_LARGE` | Первый код — локальный JSON/SSE cap 1210000 bytes, второй — внешний HTTP 413; по 413 нельзя отличить proxy от API. Исторический BODY_TOO_LARGE без transport evidence не устанавливает источник. SSE frame больше не сравнивается с 200000 HTML bytes: escaping/metadata входят в прежний wire cap. Mocks проверяют границы, это не внешний inference proof. |
| MICRO-023: Auto / в редакторе нет Ollama | Auto теперь aliases Ollama Cloud без fallback; UI создания и изменения имеют одинаковые Ollama/OpenRouter. Старый sessionStorage auto безопасно отображается Ollama. Для OpenRouter нужен явный выбор; старые jobs/versions не удаляются. |
| `LLM_INPUT_TOO_LARGE` | Полный prompt envelope >300000 bytes, dispatch блокируется. Current HTML не усечён; исходная версия остаётся. Известный context_length оценивается консервативно по UTF-8 bytes + output budget, возможен LLM_CONTEXT_LIMIT. |
| `CHECKPOINT_ORIGIN_UNAVAILABLE` | Partial HTML без подтверждённого provider/model (например, interruption до model frame) либо исходный route больше не настроен. Recovery не отправляет draft другому provider и не обходит disabled LLM repair; original сохранён. Восстановите исходную конфигурацию или создайте новый запрос. Mocks проверяют отсутствие dispatch. |
| MICRO-022: `JAVASCRIPT_EXCEPTION`, `BROWSER_INPUT_DISABLED`, `BROWSER_RESTART_FAILED` | Короткий production gate обнаружил конкретный runtime/control defect. Save/Ready блокируются, первый raw HTML сохраняется в originalCheckpoint, последний draft — checkpoint; diagnostics в job.validation. Форматные repairs повторно проходят gate. Не исправляйте selectors случайными regex. LLM repair default off; максимум один после отдельного разрешения. [Границы](game-validation.md). |
| `BROWSER_TIMEOUT_*` / `BROWSER_CHECK_INCONCLUSIVE` | Проверка не завершена: NOT_VERIFIED, не доказанная поломка механики. Browser budget 18 s, startup 8 s, gameplay 6 s/viewport, marked restart 2.5 s. Raw draft сохраняется, готовая версия не создаётся; timeout не запускает repair. Проверьте нагрузку/установку browser перед новым запросом. |
| Continue после incomplete/truncated LLM repair пытается сделать ещё один rewrite | MICRO-022 regression воспроизвёл обход cap при непарсируемом checkpoint. Durable repairUsed теперь проверяется перед любым новым dispatch; полный checkpoint допускает revalidation без POST. Mocks подтверждают cap после Continue, SQLite reopen и automatic retry; это не live inference evidence. |
| MICRO-020: `data-yaplix-state"`, null textContent, поле не заполняется | MICRO-021 воспроизвела на сохранённом оригинале: score 0→30, 3 пустые клетки, moves=20, isAnimating=true. В HTML опечатка boolean attribute; selector не находит output, исключение draw обрывает gravity/refill. Исправлена отдельная private копия плюс её start/end/resume lifecycle; backend не получает patch для одной игры. Touch win/loss/restart/save/reopen проверены без нового LLM. Оригинал/job не менялись. [Handoff](SESSION_HANDOFF.md). |
| `LLM_DNS` / `LLM_TCP_CONNECTION` / `LLM_PROXY_CONNECTION` / `LLM_PROXY_AUTH` / `LLM_TLS` | MICRO-021: единый server transport обоих облаков. Сначала `npm run network:check -- --all`, затем проверьте разрешённые proxy/CA/DNS. Обязательный proxy не обходит Direct; 407 не равен provider 401. Не публикуйте proxy credentials. [Правила и матрица](llm-network.md). |
| Proxy работает в браузере, но LIVE недоступен | Windows Settings/PAC и Node process env различаются. PAC/WPAD и SOCKS не импортируются; получите явный HTTP/HTTPS endpoint у администратора. Auto учитывает server HTTP(S)_PROXY/NO_PROXY без NODE_USE_ENV_PROXY; системные настройки не меняются. GET models 200 не доказывает inference. [Настройка](llm-network.md). |
| SSE получила `[DONE]`, но закончилась timeout при открытом body | Локально воспроизведён дефект CloudTransport: он ждал EOF даже после terminal marker. MICRO-020 завершает reader на `[DONE]`, сохраняя обязательные model/finish_reason=stop; ранний marker не авторизует неполный ответ. Regression падал до исправления. Связь с историческими MICRO-019 обрывами не доказана. |
| Non-streaming response оборвался после headers, но виден `LLM_INVALID_RESPONSE` | MICRO-020 разделяет чтение body и JSON parse: подтверждённый read failure возвращает `LLM_CONNECTION_INTERRUPTED`, полный malformed JSON — `LLM_INVALID_RESPONSE`. Локальный HTTP server проверяет оба случая, отмену/таймаут и отсутствие утечки credentials. |
| MICRO-019: «три в ряд» осталась без HTML | Исторический снимок 16.10.2026: реальный Playwright запрос в отдельной базе, 1 Ollama connection interruption и 3 OpenRouter timeouts по 45 s, всего 4 POST. Job завершён needs_attention; 0 versions, gameplay NOT VERIFIED. Причина недоступности сети не установлена. Дополнительное разрешение и новый результат зафиксированы выше в MICRO-020; старый budget не возобновляется. История старого отказа в пользовательской DB: Ollama interruption + 3 конкретных-model 429; это отдельный снимок до смены маршрутов. |
| `PORT_IN_USE` | Launcher не подтвердил совместимый local backend этого клона. Windows: `Get-NetTCPConnection -LocalPort 3000`, затем `Get-Process -Id PID`. Не останавливайте неизвестный процесс. Свой устаревший backend перезапустите; либо явно выберите другой `PORT`. Doctor проверяет новый bind и может сообщить эту ошибку при здоровом активном сервере. |
| `GRACEFUL_SHUTDOWN_FAILED` / повторный запуск завис надолго | Повторный `YAPLIX.cmd` подтверждает свой backend по HMAC proof (`/api/runtime/tunnel?nonce`) и штатно останавливает его аутентифицированным `POST /api/runtime/shutdown` (только loopback, ключ `X-Yaplix-Control`): backend сам закрывает Generation Jobs, Telegram polling и SQLite, затем освобождает порт. На Windows `SIGTERM` не даёт мягкой остановки, поэтому сигналы не используются; `SIGKILL` — аварийный путь только для подтверждённо своего PID. Чужие процессы (Harness, Ollama, VPN, другие Node.js) не трогаются: launcher возвращает `PORT_IN_USE` и сохраняет их. После restart `healthz` и библиотека игр доступны; данные не сбрасываются. |
| `TUNNEL_CLOSED` / `SPAWN_ERROR` | Просмотрите этап, exit code/signal и фильтрованный `.local/logs/tunnel.log`. Нужен pinned cloudflared из `npm run tunnel:install`; проверьте права запуска/карантин. Не отключайте TLS, антивирус или firewall. Предыдущая ошибка без stderr не устанавливает корневую причину. |
| `TUNNEL_CLOSED` с `failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded` | Воспроизведено (TASK-014, 2026-10-15, pinned cloudflared 2026.10.0): при одновременно установленных `HTTP_PROXY` **и** `HTTPS_PROXY` (например, оба на Xray `127.0.0.1:10809`) провижининг Quick Tunnel через Xray зависает и отваливается по 15 s таймауту; без прокси или только с `HTTPS_PROXY` тот же бинарник создаёт туннель штатно. Причина в транспортной обработке прокси-переменных самим cloudflared, не в VPN/DNS и не в Cloudflare API: локально все цели отвечали (GET 405, POST 200, api.cloudflare.com 404, api.telegram.org 302) и в прямых, и в прокси-замерах. Системные переменные/реестр/VPN менять не нужно: `scripts/tunnel.ts` теперь по умолчанию очищает proxy-переменные окружения коннектора (`scripts/tunnel-connector-env.ts`; POST и edge-транспорт идут напрямую, localhost в любом случае не проксируется, TLS не трогается, bot/LLM ключей у коннектора по-прежнему нет); `YAPLIX_TUNNEL_CONNECTOR_PROXY=1` при необходимости явно возвращает наследование. |
| `PUBLIC_URL_TIMEOUT` / `PUBLIC_HEALTH_FAILED` | URL ожидается до 60 s, внешний HTTPS health до 45 s. Полученный hostname сам по себе не означает доступность. Проверьте DNS/VPN/proxy и исходящие HTTPS 443, QUIC UDP 7844 или HTTP/2 TCP 7844; повторите с явным `--protocol http2` либо `quic`. При неподтверждённом health меню не публикуется. TASK-008 наблюдал DNS ENOTFOUND/timeout; конкретный сетевой виновник не установлен. TASK-014: замер с живым туннелем и реальным origin показал 200 `/healthz` и напрямую, и через Xray — сам путь edge→Node не виновник; при отказе проверьте состояние VPN/маршрута в момент запуска. |
| Telegram открывает устаревший URL (`ERR_NAME_NOT_RESOLVED`) | Код бота мёртвую ссылку не раздаёт: `refreshUrl()` публикует web_app только после `/healthz` с exact instance, `npm run telegram:check` при погашенном туннеле показал `menuType:commands, menuUrl:null`. Постоянный адрес туннеля в Telegram живёт в **BotFather Main Mini App** (`/mybots` → Bot Settings → Configure Mini App) — вне кода; Quick Tunnel URL меняется при каждом запуске, поэтому там нельзя держать временный адрес. Обновите/очистите этот пункт вручную в BotFather для постоянного запуска или пользуйтесь menu button только активной сессии. |
| Timeout 300 s / многократный Continue | Прежний engine допускал deadline до 300 s, а job после ошибки требовал ручного Continue; это не устанавливает причину upstream задержки. MICRO-019 убирает повторный обход fresh-generation routes: MICRO-029 A1.7: default response ≤30 min, весь job ≤35 min / 4 calls; автоматическая смена provider отключена MICRO-023. Исходный prompt/checkpoint не нужно вводить заново. Увеличение timeout не исправляет сломанный код или недоступный provider. |
| `LLM_OUTPUT_TRUNCATED` | `finish_reason=length` сохраняет partial code/model. При отдельно разрешённом LLM repair максимум один rewrite просит полный компактный HTML на исходном route, не склеивает произвольные части; default cloud repair off, поэтому результат может остаться draft. Не увеличивайте `LLM_MAX_TOKENS` вслепую: доступный completion cap снижает запрос, usage/reasoning учитываются при наличии. |
| `LLM_CONTEXT_LIMIT` / `LLM_OUTPUT_BUDGET_TOO_SMALL` | Контекст/известный output cap не подходит; budget <2048 tokens блокирует dispatch. Route получает 15 min cooldown; автоматическая смена provider отключена MICRO-023. При отсутствии доступного route проверьте output settings/квоту, а не запускайте бесконечные retries; prompt/draft остаются. |
| `LLM_RATE_LIMIT` / `JOB_RETRY_AFTER` | Provider `429`: Retry-After задаёт durable cooldown и автоматическое ожидание; без header — 60 s. MICRO-023 запрещает автоматическую смену provider. Повтор/Continue до установленного времени блокируется. TASK-010 получил реальные 429 у concrete free OpenRouter модели; это исторический результат, не ошибка парсера HTML. |
| `LLM_QUOTA` | Provider `402`/quota error (включая распознанный exhausted quota `429`) охлаждает route на 15 min; автоматическая смена provider отключена MICRO-023. Наличие модели в каталоге не доказывает квоту: TASK-010 kimi-k2.7-code вернула 402, другая доступная модель дала coding response. Это историческое evidence. Credits/план автоматически не покупаются; платная OpenRouter модель не подставляется. |
| `LLM_AUTH` / `LLM_MODEL_NOT_FOUND` / `OLLAMA_CLOUD_NOT_CONFIGURED` | Проверьте серверный ключ выбранного provider, затем перезапустите backend. MICRO-019 фиксирует Ollama Cloud model gemma4:31b и OpenRouter model openrouter/free; legacy MODEL не меняет route. Catalog/readiness не доказывает inference или квоту. Auth/model отказ охлаждает route; explicit mode не переключает provider. Значение ключа не выводите. |
| `FREE_MODEL_REQUIRED` | Production допускает только gemma4:31b на https://ollama.com/v1 и openrouter/free на exact https://openrouter.ai/api/v1. Concrete :free IDs и arbitrary endpoints больше не разрешены MICRO-019. Старые model/fallback/local knobs не создают routes; неверный CLOUD_BASE_URL блокирует конфигурацию. Не ослабляйте проверку и не подставляйте платную модель. |
| Provider изменился или job пытается вернуться к прежнему | MICRO-023 запрещает автоматическую смену provider: legacy Auto означает только Ollama Cloud, OpenRouter Free выбирается вручную. Старый Auto checkpoint от OpenRouter сохраняется с CHECKPOINT_ORIGIN_UNAVAILABLE без нового dispatch. Проверьте mode/history/cooldown и сохранённый draft; не удаляйте jobs/metadata ради повторов и не обнуляйте lifetime limit. Контролируемые отказы подтверждают routing/recovery отдельно от доступности реального provider. |
| `LLM_TIMEOUT` / `LLM_CONNECTION_INTERRUPTED` / `LLM_STREAM_ERROR` | Prompt и последний записанный checkpoint остаются. Recoverable сбой автоматически использует оставшийся бюджет и допустимый route; потенциально оплаченный неизвестный запрос не повторяется слепо на том же route. Полный checkpoint с известным origin проверяется без нового POST; неполный требует отдельно разрешённого LLM repair на исходном route, по умолчанию выключенного. Без подтверждённого/настроенного origin dispatch блокируется. Последние незаписанные байты и буквальное resume с токена не гарантируются. |
| `LLM_INVALID_RESPONSE` / `LLM_INVALID_HTML` / `LLM_UNSAFE_ARTIFACT` / `BROWSER_*` | Неполный документ/отказ проверки не создаёт passed version. Repair получает исходный prompt, полезный HTML и конкретную ошибку. TASK-010 устраняет потерю raw response при extract failure и уточняет порядок game_started до score events. Для BROWSER_INSTALL_REQUIRED установите checker; sandbox ОС исправляйте по [setup](development-setup.md), не выключайте. Gate startup-input-pause не доказывает весь gameplay. |
| `JOB_RESTART_UNCERTAIN` | Восстанавливаются original deadline/budget/cooldown и допустимые автоматические действия. Неизвестный potentially billed route исключается; полный checkpoint с совместимым origin может пройти повторную validation без POST. MICRO-023 не допускает автоматическую смену provider. Без ресурсов/бюджета остаётся needs_attention. Ручной Continue запускает новый bounded cycle, не обнуляет lifetime attempts. |
| `BROWSER_RESUME_NOT_WORKING` | После паузы checker не увидел фактического продолжения. Сделайте видимую Resume/Continue/data-yaplix-resume либо работающий pause toggle; одно изменение надписи не доказывает resume. Общий gate не заменяет полный сценарий gameplay/win/loss. |
| `game_won` без доказанного порога / rules-aware NOT_VERIFIED | TASK-017: событие само по себе не доказывает победу. Отдельный offline-аудит читает сохранённые rules, сверяет numeric HUD, реальные действия, стабильный видимый terminal и end; для змейки дополнительно сверяет пиксельные контакты головы с яблоками. Unknown/compound rule, исходно неоднозначный/конфликтный target, отсутствие безопасного пути или исчерпание бюджета остаются NOT_VERIFIED; изменение уже установленной цели — FAILED. HTML и очки не подменяются. См. [результаты и evidence](task-017-report.md). |
| TASK-016 LIVE-тетрис не падает и не реагирует на Drop | Подтверждено TASK-017: 30 s, score 0/200, фигура остаётся в строках 0–1 после 41 Drop при работающем горизонтальном вводе. В исходной логике секунды `dt` сравниваются с `800`, а Drop меняет неиспользуемое `piece.dy`. Это дефект артефакта, не cloud/network timeout и не повод увеличить generation timeout. Исправление генерации не выполнялось в TASK-017; победа остаётся NOT_VERIFIED. |
| `JOB_QUEUE_FULL` / `RATE_LIMIT` | Один worker, до 20 pending глобально и 3 на владельца при creation/continue. LIVE creation при настроенном generator: 6/min owner, 12/min global. Отдельно такие же лимиты фактических provider dispatch, включая repair/Continue. Подождите завершения/отмените своё ненужное задание. Cancel не удаляет запрос и checkpoint. |
| `JOB_WORKER_BUSY` | После successful bind lease защищает одну DB от второго backend, в том числе на другом порте. Закройте только свой writer штатно. После crash подтверждённо отсутствующий PID позволяет restart сразу; живой/непроверяемый PID сохраняет lease до 60 s. Чужой процесс/lease не удаляйте, игры и записанные checkpoints сохраните. |
| `JOB_ATTEMPT_LIMIT` / `JOB_DURATION_LIMIT` / `JOB_STORAGE_QUOTA` | MICRO-029 A1.7 default cycle: 4 provider calls суммарно (ChatGPT — 1), ≤4 worker runs, job ≤35 min, response ≤30 min; lifetime ≤12 calls/job. Старые durable budgets сохраняются. До 1000 jobs, 100 MB checkpoints суммарно и 200000 bytes/checkpoint. При исчерпании сохраняются запрос/draft и явная причина; скачайте черновик/backup. Автоудаления и автоматического увеличения бюджета нет. |
| `IDEMPOTENCY_CONFLICT` | Один key был использован с разными запросами. Не повторяйте изменённое тело со старым key; существующее задание сохранено. UI защищает повторное нажатие и повтор того же незавершённого submit. |
| Исходная ошибка LIVE заменена на `JOB_ATTEMPT_LIMIT` | TASK-011 воспроизвёл реальный `JAVASCRIPT_EXCEPTION`, скрытый проверкой бюджета перед repair. Теперь последний отказ остаётся errorCode, история/checkpoint сохраняются, новых dispatch сверх бюджета нет. Regression подтверждает причину и прежний предел 12 вызовов. |
| Telegram молчит после временного сбоя bootstrap API | Раньше отказ getMe/getWebhookInfo завершал единственную попытку запуска consumer. Теперь только TELEGRAM_API_UNAVAILABLE повторяет bootstrap с backoff 2–60 s до shutdown; identity/token/webhook/consumer conflicts не обходятся. Fault injection проверяет retry и отмену ожидания. Реальный TASK-011 bootstrap/polling запущен; VPN/proxy причиной не установлен, глобальные настройки не менялись. |
| Уведомление скрыто/не доставлено | Результат остаётся в центре заданий и библиотеке. Toast имеет серверный claim перед показом; crash может оставить только центр. Telegram требует явное согласие, signed session, HTTPS и доступ бота к чату. Одна попытка отправки, timeout может быть unknown; гарантии exactly-once доставки нет, повторного спама нет. |
| Telegram `/start` не отвечает | Прежний Mini App adapter не получал Bot API updates. Теперь token + single owner запускают одного poller независимо от HTTPS. Проверьте backend, TELEGRAM_UPDATES не off, getMe и коды API. Webhook/другой consumer блокируют запуск; не удаляйте webhook или чужой lock вслепую. Ответ без HTTPS остаётся текстовым. Реальный ответ проверяется отдельно от synthetic tests. |
| Mini App недоступна / нет HTTPS | Текстовый bot и HTTPS Mini App — разные каналы. Loopback/LAN не заменяют публичный HTTPS. Меню/кнопки публикуются только для подтверждённого текущего экземпляра; при недоступном Quick Tunnel используйте отдельно подготовленный защищённый [HTTPS host](telegram.md), не anonymous LLM endpoint. |
| `SCHEMA_INVALID` / `SCHEMA_TOO_NEW` / `BACKUP_*` | Не пересоздавайте и не удаляйте базу. Остановите свой writer, сохраните DB/WAL/SHM и protective `before-v2-*` snapshots. Неизвестная схема/неисправная копия блокируют запуск. Restore выполняйте только из проверенной копии по [setup](development-setup.md). |
| Hosted repository-checks падает на тяжёлых browser-тестах | Windows shared runners близки к 20-минутному лимиту job'а: полный browser suite ~13.5 m суммарно с setup и unit-тестами превышал бюджет (TASK-013: три прогона подряд — упавшие тесты каждый раз разные, затем step cancelled при пройденных 218 тестах). Теперь budget 30 m. Медленный runner не доказывает дефект кода: сначала проверьте, совпадает ли тест между прогонами и прошёл ли тот же коммит в другой раз. MICRO-018 сохраняет suite для FULL, но не устанавливает browsers для docs-only; [policy и ограничения](ci-economy.md). |
| Actions быстро расходует квоту, timing API показывает нулевые billable | MICRO-018: у main run 38868311721 timing API вернул `total_ms:0` при 21 min workflow wall time. Это не нулевой счёт: используйте job started/completed timestamps, отдельно округляйте каждый job вверх и подписывайте оценку, а не billable факт. Billing GET без user scope вернул 404; остаток 189 min из старого письма не подтверждён. MICRO-019 владелец временно выключил repository Actions до 29 октября 2026; отсутствие run не PASS. Dynamic Dependabot workflow не отключается отдельно (422), repository actions/permissions enabled:false — authoritative state. Восстановление только по команде владельца: [порядок](ci-economy.md). Scopes/тариф автоматически не меняются. [Baseline](micro-018-report.md). |
| main a902343: Windows browser suite красный после merge PR 23 | Run 38868311721: jobs background/offline test исчерпал 20 s при ожидании Start после reload; unresponsive gameplay вернул правильный timeout verdict, но wall time 24881 ms превысил assertion 22000 ms. Это два наблюдаемых отказа; точная причина race/нагрузки и remedy не подтверждены. MICRO-018 не отключает эти тесты, не повышает таймауты и не добавляет retries. Локальный PASS не заменяет новый hosted FULL. |
| TASK-017 unresponsive-fixture возвращает NOT_VERIFIED вместо watchdog FAILED в CI | Ubuntu run 38861148019 закончился за 2.0 s до ввода; Windows run 38862850604 показал ту же проблему при 6 s (Start tap 2.58 s, setup/baseline съели drive budget). Активный rules-aware budget теперь начинается после настоящего `game_started`; общий hard watchdog budget + 12 s по-прежнему включает startup. Fixture имеет 6 s и требует `BROWSER_GAMEPLAY_TIMEOUT`; отдельная delayed-Start регрессия с тем же 6 s budget проверяет игру после анимированного Start. Generation/LIVE audit budgets не меняются. |
| Gameplay checker сообщает FAILED при настоящем terminal overlay между наблюдением и FIRE/Pause | Windows trace run 38862850604: змейка закончила run, пока Playwright проверял actionability; `#yapOverlay` перехватил FIRE. Pending click отменяется только при наблюдаемом terminal event, затем обычный независимый proof всё равно сверяет цель/HUD/screen/end. Клик сквозь overlay и изменение состояния запрещены; другие click errors не скрываются. |
| Windows LAN acceptance превышает общий test timeout 20 s при повторном входе после restart сервера | Run 38862850604 дошёл до последнего export assertion после двух startup, QR decode и win/loss/restart. Для этого единственного многошагового теста Windows budget 45 s; все assertions, app timeouts и отдельные performance/gzip gates сохранены. Это не доказательство сетевой причины или изменения production поведения. |
| `Check repository conventions and links` красная на новом PR | Проверяйте локально до push: `python scripts/check_repo.py` требует финальный newline у каждого tracked-файла; в TASK-016 на этом упали `docs/task-016-report.md`, `scripts/orchestrator-gameplay-audit.ts` и `src/orchestrator/gameplay-check.ts` (первый commit PR был красным, коммит с newline перезапустил проверку). Windows-запись через `Set-Content`/`WriteAllText` не добавляет завершающий newline; MICRO-021 также наблюдала CRLF от Python `write_text` по умолчанию, исправление — явный `newline="\n"` или byte normalization в проверенном manifest. После записи запускайте тот же checker. |

## MICRO-027 observed remedies

- Critical JS plus a later blocked tap previously became BROWSER_CHECK_INCONCLUSIVE.
  Preserve the observed runtime/security code first; wait for srcdoc navigation.
  Regression uses real Chromium, not an inference-quality claim.
- A router network/rate-limit/truncation failure must not trigger an automatic
  retry/repair after restart either. Historical queued router retries need manual
  Continue; a complete checkpoint can only revalidate locally without dispatch.
- OpenRouter current LIVE returned HTTP200 then LLM_RESPONSE_BODY_TOO_LARGE before
  output completion. This establishes the wire-cap failure, not a quality verdict.
  It remains experimental; no upstream model selection or enlarged cap is implied.
- On phone now appears on completed jobs and the opened player. It explicitly
  selects that version even after the connection dropdown was changed. LAN probe
  failure means no ready QR; test guards must allow the exact GET /phone probe.
- Trace IO errors must set diagnosticsUnavailable, not strand generating/cancel.
  Download reports via the normal Telegram session header when cookies are absent.

Обычный browser и synthetic fixtures не подтверждают physical Android/iOS,
реальный Telegram API/menu/доставку сообщений или успешный Ollama Cloud inference.
При недоступности всех настроенных вычислений задание может остаться черновиком;
оно не становится DEMO и не получает отметку passed без проверки полного HTML.

## NL-001+002.1: ввод и размер промпта

- `абвгд 999 ???` прежде получал UNKNOWN и допускал dispatch. Узкая проверка
  структурного мусора теперь даёт invalid до обращения к модели; UNKNOWN жанра
  или аудитории не блокируется. Регрессии проверяют 0 synthetic transport calls
  для плохого ввода и принятие коротких, творческих и незнакомых идей.
- Подробный Intent повторял исходную фразу DEV-01 семь раз (user 2162 символа).
  Внутреннюю структуру сохраните, модели передавайте compactGameIntent: raw request
  один раз, уверенные подсказки по приоритету и только недостающие technical defaults.
  User DEV-01 стал 238 символов; edit всё ещё передаёт полный HTML и исходную идею.
  Это офлайн-проверка сообщений, не доказательство качества реальной генерации.

## MICRO-030: управление вне landscape viewport

- NL-004: обе сохранённые змейки проходили прежний Full HTML checker при
  320×700 и 390×700, но при 844×390 четыре div-кнопки уходили ниже экрана.
  Воспроизведено без генерации: верхние кнопки y=548 / y=452, body overflow:hidden.
- Full HTML checker теперь добавляет 844×390. `BROWSER_CONTROLS_UNREACHABLE`
  означает FAILED: ранее доступный в portrait активный элемент полностью вне
  viewport, а CSS не даёт маршрута прокрутки. Для div нужен реальный input listener,
  проверенный read-only CDP в opaque iframe; cursor:pointer сам по себе недостаточен.
- Нормальная/вложенная прокрутка, частично видимые элементы, отключённые/скрытые
  кнопки и неизвестные будущие состояния не являются доказательством отказа.
  Программный scrollIntoView не доказывает доступность: он умеет прокручивать hidden.
- Сохранённые игры не исправлялись; булочная по-прежнему проходит техническую
  проверку. Это не доказательство gameplay/win или физических Android/iOS.
  Детали и границы: [MICRO-030](micro-030-report.md).

## MICRO-036.3: Full HTML прошёл checker, но не сохраняется

- RED на базе `942387e`: настоящий `checkFullHtml` успешно проверил
  320×700, 390×700 и 844×390, затем `parseArtifact` выбросил
  `INVALID_GENERATION_METADATA`: парсер принимал только `[320,390]`.
- BrowserEvidence общий для checker и Artifact. Канонические viewport и profiles
  обоих checker и парсера находятся в `src/browser-profiles.ts`. Для новой
  генерации парсер принимает строго `[320,390]` для `startup-input-pause` и
  `[320,390,844]` для `full-html`.
  Список копируется без потери профилей; порядок, дубли, неизвестные значения,
  строковые числа и объекты с поддельным `toJSON` отклоняются.
- До MICRO-030 (`a0d3f41`) настоящий Full HTML checker выдавал `[320,390]`.
  Исторические metadata поддерживаются в режиме `saved-metadata`, используемом
  `Store.getVersion`, без добавления непроверенного landscape. Сохранение новой
  Full HTML-версии с двумя профилями отклоняется.
  Read-only inventory основной `.local/data/yaplix.sqlite` нашёл одну версию
  без browser metadata; это не инвентаризация всех архивов/других баз.
- GREEN: `tests/generation.spec.ts`, тест MICRO-036.3, наблюдает три настоящих
  viewport и проходит `checkFullHtml → parseArtifact → Store.save → getVersion`
  после закрытия/повторного открытия отдельной тестовой SQLite. Предыдущая версия,
  её ID, SHA, HTML и два профиля остаются неизменны. Checker не подменяется.
- Дополнительный offline integration проходит штатные `GenerationEngine →
  GenerationJobs → Store → API`: создание задания, `completed`, библиотека,
  история, экспорт, повторное открытие, восстановление полного checkpoint.
  Provider — заглушка HTML, production browser checker настоящий. Всего один
  dispatch; восстановление checkpoint не вызывает провайдера повторно.
- Отдельный fault-injection RED обнаружил два dispatch вместо одного при
  `INVALID_GENERATION_METADATA`. GREEN: ошибка локального контракта останавливает
  fallback/repair, задание `needs_attention`, `retryAt:null`, исходный ответ и
  checkpoint сохранены, версий нет. После restart/явной локальной перепроверки
  checkpoint число dispatch остаётся 1. Подмена evidence используется только
  в этом отрицательном тесте, не в основном integration.
- Landscape-регрессии MICRO-030/MICRO-032 по-прежнему отклоняют обрезанные
  controls с `BROWSER_CONTROLS_UNREACHABLE` при 844×390. Критерии checker неизменны.
  Проверки offline/synthetic; реальные inference/repair POST: 0. Это не LIVE,
  не доказательство gameplay/win/loss и не physical-device PASS.

## MICRO-032.4: стартовый overlay скрывает результат landscape gate

- На сохранённой контрольной змейке 7/7 offline запусков Full HTML checker
  завершались `BROWSER_CHECK_INCONCLUSIVE`, phase `touch-input`, 320×700.
  Исходный `TimeoutError` 1500 ms: видимый canvas перекрыт стартовым overlay;
  его текст «Начать играть» не совпадает с точным Start matcher. До landscape
  проверка не доходила. Это дефект выбора цели checker, не JS-ошибка игры.
- Touch-проба теперь проверяет hit-test видимой части элемента и после первого
  настоящего tap повторно наблюдает открывшиеся controls. Не требуется дополнять
  словарь Start под конкретную игру. На том же неизменённом HTML 7/7 повторов
  доходят до доказанного `BROWSER_CONTROLS_UNREACHABLE` при 844×390.
- Критерий MICRO-030, sandbox/CSP и таймауты сохранены. Авторские минимальные
  регрессии проверяют overlay с разными подписями и безопасную компоновку отдельно
  от полностью обрезанных controls. Эти проверки не доказывают gameplay/win/loss.

## MICRO-029: изолированная подготовка SIWC

- MICRO-029.2 third-probe preflight: на c440ca0 синтетические ответы без model,
  с gpt-6-astra и с конфликтующими response.model ошибочно давали PASS.
  Диагностика теперь читает фактическую модель из SSE response metadata;
  отсутствие даёт SIWC_MODEL_ACTUAL_NOT_VERIFIED, несовпадение/конфликт —
  SIWC_MODEL_ACTUAL_MISMATCH. Произвольные значения заменяются OTHER.
  Регрессии RED до исправления, GREEN после. Это offline proof; прошлые LIVE
  ответы не пересматриваются. Для третьего probe разрешены только один новый
  OAuth и один POST с durable reservation в .local/siwc-third-probe; повтор
  после любого исхода запрещён, отчёт сохраняется только в этом каталоге.

- MICRO-029.3: проверка LocalSiwc.probe сама по себе не покрывает stdout/exit code
  CLI. Экспортированная runSiwcCli вызывается обычным source entry point и
  offline-тестами с fake HTTP/browser; 23 проверки, включая пять с loopback
  HTTP/SSE-сервером, проверяют max POST 1,
  отсутствие refresh/retry и утечек, включая 401/429/5xx/timeout/expired token.
  HTTP200 или SSE без completed + text не дают PASS. Реальный probe не запускался.
  [CLI proof и версия Gitleaks](micro-029-chatgpt-feasibility.md#micro-0293-финальная-offline-подготовка-cli).

- MICRO-032.1: `SIWC_OUTPUT_INVALID` при HTTP200/sseObserved true прежде возникал
  в completed-ветке при пустом или >8192 тексте, до чтения usage. Offline
  воспроизведена потеря delta при финальном output []; output_text.done также
  игнорировался. Теперь части объединяются без повторения снимков, metadata/usage
  сохраняются до проверки текста; пустой completed имеет отдельный
  SIWC_COMPLETED_WITHOUT_TEXT. Причина конкретного ответа владельца NOT_VERIFIED.
  Диагностика содержит только counts/status/codes/length/bytes/usage, без текста.
  Реальный probe не повторять без нового разрешения. [Разбор](micro-029-chatgpt-feasibility.md#micro-0321-пустой-результат-и-безопасная-диагностика).

- MICRO-029.2 / MICRO-032: владелец сообщил `SIWC_SSE_REQUIRED`, HTTP200,
  Content-Type UNKNOWN. Прежний header-only guard локально воспроизвёл отказ на
  корректном SSE без Content-Type. Исправление читает реальные data-кадры;
  JSON/HTML/оборванный stream не становятся PASS. Отчёт содержит безопасные
  `responseMediaType`/`sseObserved`. Причина реального HTTP200 не установлена.
  Только `gpt-6.1-sol` из свежего видимого каталога, reasoning medium; при отсутствии
  `SIWC_PROBE_MODEL_UNAVAILABLE`, POST 0, без подмены. Повторный LIVE probe требует
  нового разрешения. [Контракт и границы](micro-029-chatgpt-feasibility.md#micro-032-owner-operated-inference-probe-19102026).

- MICRO-032: HTTP 200 или output delta без `response.completed` не доказывают
  inference. `--probe` возвращает PARTIAL при `SIWC_STREAM_INTERRUPTED`,
  `SIWC_INFERENCE_INCOMPLETE`, `SIWC_USAGE_LIMIT`/`SIWC_USAGE_UNAVAILABLE` и timeout;
  автоматического повторного POST нет. Это проверено offline с синтетическим
  OpenAI HTTP, не реальным аккаунтом. После PARTIAL не перезапускать CLI без
  нового бюджета. [Ручной probe](micro-029-chatgpt-feasibility.md#micro-032-owner-operated-inference-probe-19102026).

- `SIWC_PLAN_PERMISSION_REQUIRED` / `SIWC_ID_TOKEN_INVALID`: identity sign-in
  не даёт автоматически ChatGPT plan usage. Проверяются granted scopes,
  криптографическая подпись и issuer/audience/expiry/nonce; обходов и inference нет.
- Windows path guard должен сравнивать нормализованный `resolve` root:
  trailing separator из `fileURLToPath` иначе не совпадает с `dirname`.
  Реальные loopback offline-тесты проходят после нормализации, без роста timeout.
- CLI `--prepare` не обращается к сети; `--authorize` — только ручной вход.
  Токены живут в памяти и забываются; persistent vault/refresh не реализованы.
  Crash lock автоматически не удаляется. [Сценарий, лицензии и ограничения](micro-029-chatgpt-feasibility.md).

## MICRO-036.4: post-merge ESM и controlled worker

- На `05b7a59` целевой runtime Chromium desktop прошёл 4/4; controlled worker
  на Chromium 320 / WebKit 390 упал 2/2. На `7d945502` запросы
  `/runtime/runtime.js`, `/runtime/contracts.js`, `/runtime/browser-profiles.js`
  вернули соответственно 200, 200, 404. Новый import в contracts остановил
  выполнение ESM до присваивания `window.testSession`. Исправление: добавить
  только `browser-profiles` в существующий точный allowlist `build/src`.
  Неизвестные модули, исходники и encoded traversal по-прежнему возвращают 404.
- В первоначальных trace controlled worker POST `/api/jobs` получил 503
  `LLM_NOT_CONFIGURED`; GET списка вернул 200 и `{"jobs":[]}`, UI показал
  «Заданий пока нет». `GenerationJobs.create` проверяет routes до INSERT,
  поэтому задание не создавалось. Причина: synthetic provider в fixture
  несовместим с явным UI mode `ollama-cloud`. Fixture теперь использует имя
  `ollama.com` с прежним локальным mock complete, без внешнего запроса.
  Assertions проверяют POST 202, наличие задания в manager/API, UI и завершение.
  Изменение MICRO-023 в PR #46 касается другой fixture и не вызвало этот отказ.
- Regression API обходит реальный ESM graph от runtime через contracts до
  browser-profiles; браузерная проверка загружает `/host`, получает game_ready,
  создаёт сессию и подтверждает game_started через analytics. RED воспроизведён
  до исправления. Таймауты, retries, sandbox/CSP и production provider rules
  не изменены. Все проверки synthetic/offline, реальные OAuth/inference POST: 0.

### Обязательный локальный gate перед merge

Любые изменения `src/`, `tests/`, игровых ресурсов, скриптов сборки или
конфигурации, влияющей на выполнение приложения, требуют полного
`npm run check` **до merge**.

Проверки выполняются на точном HEAD коммита, который планируется слить.
Результаты PASS, FAIL и SKIP фиксируются в описании PR.

Изменения исключительно документации, не влияющие на выполнение приложения,
допускаются без полного браузерного прогона.

Пока GitHub Actions недоступны, локальный PASS обязателен, но не приравнивается
к hosted CI PASS.


## MICRO-036.4a: потеря job.created при параллельном pruning

- Владелец воспроизвёл тот же flaky unit на main `7d945502` до MICRO-036.4:
  последовательные запуски PASS, параллельные — intermittent FAIL.
- Один инструментированный параллельный прогон на `37ea5f1` подтвердил 61
  `unlinkSync: ENOENT` и 14 `statSync: ENOENT` в `GenerationTraces.prune()`.
  Независимые тестовые процессы используют общий `.local/diagnostics/generation`
  у лимита 16 MiB. Пока один процесс обходит snapshot, другой уже удаляет файл.
  Ошибка конструктора предотвращает первую запись `job.created`; повторное
  создание logger позднее успешно. Отчёт содержал последующие события до
  `job.completed`, `traceAvailable:true`, `diagnosticsUnavailable:true`.
- Pruning теперь пропускает только исчезнувшие entries (`ENOENT`) при чтении
  metadata и удалении. Остальные ошибки не скрываются. Retention 7 дней,
  общий лимит 16 MiB, rotation, защита ссылок и редактирование секретов сохранены.
  Детерминированные тесты воспроизводят interleaving двух pruners после readdir
  и перед unlink: RED — настоящий ENOENT; GREEN — сохранён `job.created`.
  Permission failure и hardlink по-прежнему отклоняются, чужой HTML сохраняется.
- Пользовательские журналы не очищать ради PASS и assertion не ослаблять.
  Метаданные диагностического запуска находятся только в ignored `.local`.

## MICRO-029 Stage A1: личный ChatGPT

- В offline regression 401/403 очищали SIWC-сессию и отменяли активный
  controller, после чего catch маскировал отказ как SIWC_REQUEST_CANCELLED.
  Теперь проверенный SiwcError сохраняется до классификации внешней отмены;
  HTTP 401/403 дают SIWC_AUTH_REQUIRED, повторного POST нет.
- Нельзя использовать CLI OAuth как серверный login: токены только в памяти
  одного процесса. Нужен явный connect в local UI. Status не выполняет OAuth,
  refresh, catalog GET или inference. После restart требуется новый вход.
- Sandbox browser-запуск A1 остановлен после отсутствия прогресса первого
  теста. В окружении владельца targeted UI create/edit/reopen с настоящей
  browser validation прошёл 3/3: desktop, Chromium 320, WebKit 390.
  Промежуточная ошибка нового теста была race: reload до завершения show();
  ожидание выбранной версии исправляет тест без изменения production UI.
  Синтетические Responses и подписанный fake OAuth не доказывают LIVE.
- [Подключение, бюджет, ошибки и ограничения](chatgpt-setup.md).
- Review A1: standalone `authorization.lock` переживает аварийное завершение
  OAuth и не может безопасно удаляться новым процессом вслепую. Сервер теперь
  использует process-local lock внутри прежнего `LocalSiwc`; CLI сохраняет
  дисковый lock и прежнее поведение. Offline-тест принудительно завершает
  дочерний сервер во время CONNECTING, затем подтверждает новый ручной вход
  без inference и без изменения существующего CLI lock.

## MICRO-029 Stage A1.2: ошибки до POST и Continue

- `beforePost()` находился внутри network catch в `LocalSiwc.respond()`.
  Offline RED воспроизвёл подмену `JOB_STORAGE_QUOTA`, `JOB_WORKER_BUSY` и
  `CHATGPT_BUDGET_SPENT` на `SIWC_NETWORK`. Резервирование теперь имеет отдельную
  границу: типизированный Fault сохраняет только code/status, SiwcError сохраняет
  свой код, нетипизированный отказ получает `SIWC_DISPATCH_FAILED` без исходного
  сообщения и приватных полей. SQLite trigger подтверждает POST 0/attempts 0
  при отказе записи. Обычный network error после резерва остаётся SIWC_NETWORK,
  attempts 1/POST 1; Continue и restart повторную отправку не разрешают.
- UI активировал Continue по checkpointBytes/Origin, даже если HTML был неполон.
  Browser RED подтвердил активную кнопку. Теперь JobSummary содержит вычисляемый
  `canContinue` без полного HTML; summary и Continue используют одну серверную
  проверку состояния, лимитов, ожидания, очереди и checkpoint provenance.
  Для ChatGPT нужны исходные provider/requestedModel/model и существующий
  признак завершённости HTML. Это разрешение только на повторную локальную
  HTML/browser validation, а не сертификат корректности кода или новый POST.
  Неизвестная/неверная модель, чужой provider и неполный HTML запрещены;
  полный подтверждённый checkpoint допускается после restart/disconnect OAuth.
- При выделении общей проверки сохраняются прежние HTTP 429 для JOB_QUEUE_FULL
  и JOB_RETRY_AFTER. Регрессии отдельно проверяют Ollama и OpenRouter.
- Все новые reproductions используют synthetic OAuth/Responses и тестовые SQLite;
  реальные OAuth, models GET и inference не выполняются.
## A1.8.6: Canvas с видимым DOM UI и неполное rendering evidence

- RED на `7660afb`: production checkFullHtml принимал авторскую Canvas-игру
  с HTML Start/Move/HUD как canvas-webgl-v1. Новый negative-тест требовал отказа,
  но promise resolved. GREEN: тот же HTML получает BROWSER_DOM_GAME_UI.
- Новый контракт запрещает DOM HUD/controls/Game Over. Проверка реального DOM
  включает текст, computed styles/pseudo-elements, SVG и open/closed Shadow DOM;
  ARIA роли не служат allowlist. Превышение bounded DOM анализа даёт
  BROWSER_CANVAS_DOM_UNVERIFIED (NOT_VERIFIED), не FAILED.
- Отдельный RED показал, что parseArtifact принимал новую checked LLM-версию
  без rendering evidence. Теперь Save требует canvas-webgl-strict-v2;
  saved-metadata сохраняет возможность читать прежний v1/отсутствующее поле.
- Финальный кадр после нескольких taps мог скрыть пустой кадр после Restart,
  если следующая проба снова рисовала. Каждый input теперь проверяется до
  следующего; clear→redraw ограничен прежними двумя 50 ms наблюдениями.
- Tests с прежним DOM UI не удалены: новая генерация ожидает отказ, а исторические
  версии остаются доступными через history/reopen/export. Rendering regressions
  дополнительно исполняются на Canvas-only authored fixtures.
- Offline/synthetic проверки не доказывают реальные provider calls, универсальные
  правила gameplay и физические Android/iOS/WebView. Детали и границы:
  [Strict Canvas contract](canvas-rendering-contract.md).

- Независимый аудит A1.8.6 дал пять дополнительных RED: display:contents text,
  текст за нулевым host, absolute pseudo UI, native audio controls и opaque Canvas
  с pointer-events:none над меняющимся миром. Range paint проверяется независимо
  от host rect (с overflow clipping); native audio controls запрещены. Canvas
  exposure учитывает painted sibling layers независимо от pointer-events;
  сложные неоднозначные ancestor stacking layouts остаются NOT_VERIFIED.
- Старые Canvas negatives с DOM controls отдельно проверяют historical refusal;
  новые Canvas-only reductions проверяют hidden/zero/no-draw/inert/landscape
  своими конкретными кодами, чтобы DOM gate не маскировал rendering regression.

- Follow-up audit: fixed/absolute controls могут выходить из обычного overflow
  ancestor, а offscreen pseudo не является видимым UI. Три новых RED→GREEN
  проверяют CSS containing blocks и computed pseudo geometry. Неизвестная
  геометрия pseudo даёт NOT_VERIFIED вместо ложного доказательства FAILED.
- Browser test artifacts из параллельных focused runs должны иметь разные
  `--output` каталоги; общий каталог дал trace ENOENT при удалении артефактов
  другим запуском. Desktop pointer probes используют click, touch — отдельный
  hasTouch context; tap на обычном desktop page отвергается самим Playwright.

- Full suite A1.8.6 воспроизвёл приём DOM controls внутри вложенного auto-scroll
  контейнера: до прокрутки их Range корректно clipped, но пользователь мог
  открыть HTML UI обычной прокруткой. Bounded scroll-ui probe теперь выполняет
  реальные wheel inputs максимум в трёх видимых scroll контейнерах и проверяет
  обнаруженный DOM после каждого. scrollTop/DOM не подменяются. RED полного
  теста nested → GREEN; положительные Canvas и невидимые technical fixtures
  сохранены. Это DOM inspection, не доказательство phone control reachability.

- Итоговая paint матрица добавила четыре RED→GREEN: in-flow pseudo и shadow на
  нулевом host, outline и SVG child за нулевым SVG viewport. Видимое outline/SVG
  отвергается; неподтверждаемая геометрия generated paint/shadow даёт
  BROWSER_CANVAS_DOM_UNVERIFIED. Полностью transparent pseudo text допускается.
  Пять positive + четыре negative cases прошли 9/9.
- Нулевой backing store прежде доходил до NaN координат и общего INCONCLUSIVE.
  Теперь layout проверяется до probes: BROWSER_CANVAS_LAYOUT, без repair/fallback.
  Отдельный RED→GREEN фиксирует именно Canvas classification.

- CSS-visible head/title мог обходить body-only обход. Отдельный RED принимал
  такой HUD. Observer теперь обходит весь document (с прежним bounded cap),
  обычные head/meta/title/script/style остаются разрешены невидимыми. Новый
  negative и два Canvas/technical positives прошли 3/3 GREEN.

- Closed roots, созданные declarative/native HTML parser, обходят attachShadow.
  Три RED принимали DOM HUD через shadowrootmode, setHTMLUnsafe и document.write.
  Такие неподтверждаемые parsing paths теперь дают BROWSER_CANVAS_DOM_UNVERIFIED:
  initial source проверяется inert DOMParser, native parsing calls отмечаются
  без изменения их семантики. Programmatic attachShadow roots по-прежнему
  анализируются по фактическому DOM. Canvas/WebGL и invisible technical positives
  сохранены; ни одна unsupported ветка не получает строгий PASS по умолчанию.

## A1.8.7: confirmed strict-v2 DOM paint false acceptance

- On strict head `77cc4e6` and isolated integration `dc3bee9`, authored offline
  Chromium fixtures with a visible CSS list marker (`list-style-type:'Score 100'`)
  or zero-size positioned `::before` text (`overflow:visible`) were accepted as
  `canvas-webgl-strict-v2` for profiles 320/390/844. Pixel comparisons independently
  confirmed visible DOM text (538 and 332 changed pixels respectively).
- `hasDom()` does not inspect list markers; positioned pseudo geometry considers
  only its zero-size content box. The two A1.8.7 regression cases expect refusal
  and expose these defects without changing production gates or budgets.
- No verified remedy is implemented in this audit. Keep publication NO-GO until
  a focused correction and fresh regression/full integration checks pass. Do not
  remove the refusal assertions or count this false acceptance as Canvas-only proof.

## A1.8.8: CSS marker and zero-box pseudo paint

- On `da7b40a`, both production-checker regressions resolved with strict-v2
  evidence instead of refusing. Offline screenshots at 320x700, 390x700 and
  844x390 confirmed visible marker text and overflowing `Pause` text; Canvas
  rendering itself passed. The original RED commit remains in history.
- The bounded DOM scan now examines computed `::marker`, inherited
  list-style-type/image and generated marker content. Invisible/empty markers
  and hidden technical lists remain allowed. Native APIs do not expose a marker
  paint rect: potentially visible markers remain `BROWSER_CANVAS_DOM_UNVERIFIED`,
  even if the host appears clipped/offscreen, rather than earning strict PASS.
- Positioned `::before`/`::after` with a zero content dimension no longer proves
  absent text paint. Own overflow clipping can certify suppressed text; a real
  ancestor clip can suppress the whole viewport paint region, respecting fixed/
  absolute containing blocks. Otherwise ambiguous overflow stays NOT_VERIFIED.
  Transparent/no-content and demonstrably clipped technical cases remain valid.
- Review reproduced a padded zero-content pseudo that still painted inside its
  overflow clip. Clipping proof now includes padding and overflow-clip-margin;
  an empty zero-area background is allowed because it has no painting area.
- Both refusals block Save/Ready without repair/fallback. Authored production
  job tests retain checkpoint/draft and the last version across SQLite reopen;
  Continue revalidates locally without another dispatch. These are offline
  synthetic checks, not real-provider or physical-device evidence.
- Evidence is synthetic/offline only; real LLM/OAuth/model requests remain zero.

## YAPLIX-BROWSER-RUNTIME-001: distinguish a missing Playwright executable from sandbox failure

- The checker used to map every rejected `chromium.launch()` to
  `BROWSER_SANDBOX_UNAVAILABLE`, hiding Playwright's launch error. It now records
  a bounded, secret-screened launch detail, channel, Node version, executable
  basename/presence, sandbox-helper ownership/mode, temporary-profile readiness,
  and separate launch status while keeping `chromiumSandbox: true`.
- An environment comparison on this host reproduced
  `Executable doesn't exist at ~/.cache/ms-playwright/chromium-1248/...` when
  `PLAYWRIGHT_BROWSERS_PATH` was unset. Loading the project `.env` selected the
  existing `.local/playwright/chromium-1248/...`; the same launch with the
  verified setuid helper passed. This confirms that omitting project browser
  configuration can cause a missing-executable error; it does not retroactively
  prove the cause of an older durable-job failure whose trace omitted launch
  details.
- Use the normal launcher or `node --env-file-if-exists=.env ...` from the
  project root. Keep sandbox enabled. Inspect the job diagnostic timeline for
  `browser.launch.failed` to distinguish installation, permission, timeout and
  sandbox failures; do not treat a direct checker result as server-worker proof.
- A nested `YAPLIX_DATA_HOME` previously made Chromium's temporary
  `SingletonSocket` exceed Linux's Unix-socket path limit. The production
  browser checker, gameplay worker and browser-test launcher now share a
  process-unique mode-0700 profile root under `/tmp`, independent of
  project/data path depth, and remove it when Node exits. The OS sandbox remains
  enabled. A checker/worker smoke does not prove LIVE generation.

## YAPLIX-MOBILE-UI-001: detached generation status and hidden phone game panel

- Opening a saved game called `mount()`, which replaced `#game` children, then
  `show()` wrote to `#gen-title` and `#gen-time` inside the removed subtree.
  A stale active-job poll could also restart the timer and hide the just-opened
  iframe. Keep generation status beside the replaceable game container, ignore
  untracked stale active state once a version is open, and stop the timer if its
  DOM target is disconnected.
- At widths up to 760 px the create screen explicitly hid `.player`. Keep it in
  the mobile document flow and expose the existing game-focus mode through the
  `К игре` navigation action. Keep mobile notices in flow so they cannot cover
  bottom navigation or game controls.
- Regression evidence: `.local/yaplix-mobile-ui-001/REPORT.md`. The saved
  “Лови звёзды” HTML was not edited; its own title/help text still clips at the
  narrowest tested widths. Standalone `file:` launch remains unverified when
  the browser policy blocks local-file navigation.

## YAPLIX-CANVAS-QUALITY-001: measured Canvas 2D text overflow

- The strict Canvas checker now observes native `fillText`/`strokeText` calls
  after the game call, uses native `measureText()` metrics and the active 2D
  transform, and records backing/CSS dimensions, alignment, baseline and
  transformed glyph bounds. It tracks save/restore/clip state without changing
  game source, drawing, or the game loop.
- `BROWSER_CANVAS_TEXT_CLIPPED` blocks only when the same measurable text bounds
  repeat in at least two observations and extend more than one CSS pixel beyond
  the Canvas bitmap, with no active custom clip and no `maxWidth` shaping.
  Unmeasurable paint, custom clips, `maxWidth`, WebGL-rendered text, Canvas
  hitbox semantics, and touch-target size stay `NOT_VERIFIED`; missing evidence
  is not treated as a defect.
- Only confirmed text clipping is repairable, and only by the existing Ollama
  route within `LLM_REPAIRS`. The repair receives the original request, full
  HTML and bounded measured geometry; it must preserve mechanics and pass the
  full protected checker again. Other Canvas uncertainty and infrastructure
  errors do not trigger this repair.
- Offline production-checker probe (no provider POST): a clean authored Canvas
  fixture passed 320x700, 390x700 and 844x390; a deliberately clipped label was
  rejected at 320x700 with measured left overflow 17 CSS px and a saved PNG.
  This tests the detector and repair eligibility, not real model quality.
  Evidence: `.local/yaplix-canvas-quality-001/probe-results.json` and
  `clipped-320x700.png`. The checker's standalone phase uses a separate
  isolated page with external requests blocked; the actual downloaded file
  protocol remains subject to browser policy and is not claimed as verified.

## YAPLIX-CANVAS-OVERLAP-001: distinct Canvas labels obscure one another

- Root cause in LIVE-002: the layout observer stored Canvas `TextMetrics` bounds
  and checked only bitmap clipping. It never compared glyphs from separate
  `fillText`/`strokeText` calls, so the game HUD's lives label and pause label
  were both inside the bitmap and escaped the gate.
- The new observer rasterizes isolated glyph masks in a reusable OffscreenCanvas
  with the same browser font and 2D transform. It requires at least four shared
  backing pixels, at least 5% of the smaller glyph mask, and the same conflict
  across two rendered frames. Draw order, bounds, viewport, phase, DPR and a
  screenshot ID/SHA are recorded without raw text. Bounding-box intersections
  alone do not fail. MaxWidth, active clip, unsupported paint, WebGL and
  semantic hitbox/graphic obstruction cases stay `NOT_VERIFIED`.
- Only screenshot-backed confirmed `BROWSER_CANVAS_UI_OVERLAP` on Ollama can use
  the existing `LLM_REPAIRS` budget; the complete protected checker runs again
  before save. In particular, do not infer buttons from rectangles or repair
  uncertain overlap. No manual edit or provider POST was used in this audit.
- Regression probe of the unmodified LIVE-002 export reproduced the overlap at
  320x700 with 25 shared glyph pixels (18.52% of the smaller mask); two frames
  confirmed it and the checker rejected the old artifact. This validates the
  checker regression only, not new-game generation or LIVE model repair.
  Evidence: `.local/yaplix-canvas-overlap-001/regression.json` and its PNG.

## UI-002F: сырой код ARENA_UNSUPPORTED поверх интерфейса (27 октября 2026)

Клиентский `arenaFetch` в `src/ui.ts` выбрасывал сырой код из ответа API
(`new Error(String(d.error))`) в статусную строку Arena, поэтому несовместимая
с рейтингом версия постоянно показывала технический код поверх приложения.
Источник и условие: серверный Fault `ARENA_UNSUPPORTED` (409) из
`src/arena-store.ts`/`src/arena.ts` — версия без явного opt-in score-v1
(`arenaDeclared(html)` false), то есть обычное ожидаемое ограничение, а не сбой
backend. Backend не менялся, контракты и рейтинг не тронуты.

Исправление UI-002F: таблица русских объяснений с кодом в скобках
(источник истины — `src/arena-view.ts`), сырые коды больше не показываются
без объяснения; панель комнаты закрывается кнопкой «Скрыть панель» без
воздействия на серверное состояние. Код ошибки фиксируется в диагностике.
Настоящие ошибки backend по-прежнему отображаются, а не скрываются.

## YAPLIX-UI-SMOKE-002: устаревшие мобильные селекторы и UI trace

- Пять старых mobile assertions ссылались на `#jobs-toggle` и кнопку
  `Обычный экран`. UI-002 намеренно удалил старый список заданий из основного
  сценария и использует секции деталей текущего задания в рабочем пространстве;
  переключение фокуса игры теперь проверяется отдельной актуальной кнопкой.
  Обновляйте сценарии по доступным разделам Create/Games/Arena и текущим
  доступным именам, не возвращая удалённые элементы ради тестов.
- Старое ожидание занятости `#versions`/`#replay` задерживало analytics-запрос,
  которого нет в текущем пути открытия. Для проверки busy-state блокируйте
  фактический запрос загрузки сессии, затем освобождайте его и проверяйте
  доступность контролов после появления игры.
- UI traces хранятся в существующем generation trace для версии durable job.
  `ui.api_error` и `ui.state_error` содержат только фиксированный код и получают
  статус `FAIL`; текст ошибки, адрес, payload и секреты туда не копируются.
  При проверке frontend сначала запускайте `npm run build`: browser server
  раздаёт собранные статические файлы и иначе может использовать старый client
  bundle. Локальный Playwright smoke не подтверждает физическое устройство.

## Operation JSONL не появился

Operation trace записывается best-effort под
`<YAPLIX_DATA_HOME>/diagnostics/operations/` (или project `.local` без отдельного
data home). Отсутствие файла само по себе не означает отказ запуска: проверьте
права каталога/data home, отсутствие symlink в родителях и фактический
`operationId` в `desktop.log`. При недоступном trace приложение продолжает
работу; используйте код штатной ошибки или существующий installer/desktop log,
не повторяйте операцию только ради логирования.

## YAPLIX-OBSERVABILITY-GIT-001 / DESKTOP-LOCK-GIT-001: launcher lifecycle

Предыдущий отчёт не смог доказать полный restart, и его финальная проверка lock
не воспроизводится текущим целевым набором. Диагностический trace показал
отдельный подтверждённый дефект: readiness launcher разрывал IPC с detached
worker; серверный процесс воспринимал потерю своего supervisor как `disconnect`
и останавливался сразу после `running`. Launcher теперь ждёт profile state и
loopback identity/health, а затем выходит без IPC-зависимости между CLI и
worker. Целевой тест проверяет полный lifecycle и проходит 6/6.

Одновременный старт двух профилей также воспроизводил `PORT_IN_USE`: desktop
вызывал внутренний авто-подбор порта `app-runtime`, но продолжал сохранять
первоначальный порт. Передавайте выбранный Desktop-порт как explicit и повторяйте
выбор только во внешнем цикле launcher. После исправления тест двух профилей
проходит и подтверждает разные порты.

Lock удаляйте только после повторной проверки, что его PID совпадает с ожидаемым
владельцем; state удаляйте только при совпадении instance. Тест подменяет lock
на PID живого test runner и подтверждает, что shutdown оставляет этот lock.
Stale cleanup разрешается только при мёртвом PID, совпадающем instance и
свободном loopback port. Полный smoke, operation IDs и результаты сохранения
приведены в `.local/yaplix-desktop-lock-git-001/REPORT.md`; отдельный принятый
профиль остаётся приватным под тем же каталогом.

## YAPLIX-GAMEPLAY-RECOVERY-004: доступность editor и длинная edit-инструкция

После открытия сохранённой игры редактор мог оставаться disabled, пока завершались
необязательные analytics/list запросы. Не блокируйте готовность формы на этих
фоновых вызовах; состояние редактора должно зависеть от выбранной версии,
активного job и настроенности provider. Не отправляйте per-keystroke trace.

Создание новой игры ограничено 500 символами. Длинное задание изменения полного
HTML проверяйте отдельным edit-лимитом: иначе UI может выглядеть готовым, а API
отклонит текст как `INVALID_STRING`. Синтетический regression проверяет точный
полный текст, immutable parent и отсутствие повторной отправки после reload.

В YAPLIX-GAMEPLAY-RECOVERY-004 единственный LIVE edit получил HTML, но protected
проверка остановила сохранение с `BROWSER_CANVAS_TEXT_CLIPPED` на 320×700. Это
реальный отказ проверки layout, а не подтверждение gameplay. См. локальный отчёт
`.local/yaplix-gameplay-recovery-004/REPORT.md`; повторный LLM запрос не выполнялся.

## YAPLIX-FINAL-002: Canvas sampling, Start probes, bridge fallback и test readiness

- `BROWSER_CANVAS_RENDER_UNVERIFIED` на landscape может быть следствием потери
  мелких игровых деталей при чрезмерно широком downsample. Сохраняйте aspect
  ratio и до 256 px длинной стороны; не понижайте порог цветов.
- `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` может означать, что общие probes не
  достигли Start в нижней части Canvas. Включайте нижние точки, но не объявляйте
  управление доказанным без наблюдаемого изменения.
- `BROWSER_TIMEOUT_RENDER` при marker без event bridge — ошибка выбора validator,
  если документ так и не отправил `game_ready`. После короткого ожидания явно
  фиксируйте `YAPLIX_BRIDGE_NOT_OBSERVED`, затем запускайте строгий Full HTML
  checker; runtime errors по-прежнему являются отказом.
- Playwright `webServer.url` и `baseURL` должны использовать `localhost` в
  этой среде: `127.0.0.1` попадал в HTTP proxy, поскольку loopback IP отсутствовал
  в `NO_PROXY`. Proxy не отключать глобально.
- Тест владения занятым портом должен задавать `explicitPort: true`; иначе
  launcher закономерно выбирает следующий свободный порт и ожидание отказа
  превращается в зависание.

FINAL-002 измерил указанные причины на трёх реальных сохранённых checkpoint;
полный suite всё ещё имеет отдельные падения и не является release PASS. См.
`.local/yaplix-final-002/REPORT.md`.

### YAPLIX-RELEASE-FINAL-004 — durable repair policy (28 октября 2026)

Ollama Cloud create и edit получают общий durable лимит до четырёх POST на job:
первичный запрос и не более трёх автоматических repair. `LLM_REPAIRS` задаёт
фактическое число разрешённых repair (0–3), а `LLM_MAX_ATTEMPTS` может только
уменьшить общий предел, не увеличить его выше четырёх. Каждая попытка использует
тот же provider/model и полный checker. OpenRouter не получает автоматических
repair; ChatGPT ограничен одним POST и своей локальной авторизацией. Неизвестный
результат отправленного POST не повторяется после restart или Continue.

Длительный deadline Ollama по умолчанию 130 минут: до четырёх последовательных
окон ответа по 30 минут плюс 10 минут на очередь, проверки и сохранение. Для
OpenRouter и ChatGPT действует максимум 35 минут на job. Явный `LLM_MAX_DURATION_MS`
может уменьшить общий лимит; provider deadline не превышает 35 минут для этих
маршрутов.

Сводка отчёта job различает `llmPostDispatches` (фактические dispatches внутри
этого job), `configuration.automaticLimit` (максимум POST этого job) и число
заданий проекта, которое нельзя выводить из одного job report. Project LIVE
эксперименты считаются по безопасным report counters каждого задания; synthetic
тесты не являются LIVE расходом.


### YAPLIX-FINAL-005 — LIVE сохранённая игра выбросила sandbox localStorage SecurityError

**Исправление классификации в RELEASE-006:** точная версия FINAL-005 была
проверена парно в actual player. Без Playwright init script исключения нет; с
`context.addInitScript(()=>localStorage.setItem(...))` возникает тот же
`SecurityError` из frame origin `null`, поскольку init script применяется также
к sandboxed игре. Поэтому этот SecurityError не подтверждает defect generated
HTML и старый отчёт FINAL-005 сохранён как исторический, с correction note.
Game HTML и sandbox не менялись.

Также подтверждён отдельный UI defect: клик по сохранённой карточке не всегда
возвращал workspace из Library, поэтому загруженный iframe оставался скрыт.
Обработчики карточек переключают view в `create` до открытия; выбранные Chromium
MVP и mobile specs прошли 3/3 и 5/5 после того, как synthetic fixtures стали
учитывать обязательный provider preflight.
Не считать оставшуюся browser matrix закрытой: 158 исторических FAIL системно
не устранены. См. [RELEASE-006 report](../.local/yaplix-release-006/REPORT.md).

Первоначальное наблюдение FINAL-005 (источник в игре неизвестен) superseded
проверкой RELEASE-006 выше: точный вызов шёл из Playwright init script. Sandbox
остаётся opaque; не добавляйте `allow-same-origin`.
