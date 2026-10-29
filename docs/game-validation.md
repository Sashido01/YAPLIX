# Production game validation — текущее поведение

Trace событий по job, подсчёт dispatch/HTTP/unknown POST и различие между
`FAIL`, `NOT_VERIFIED` и `SKIPPED` описаны в [diagnostics](diagnostics.md).
Последний общий LIVE результат остаётся PARTIAL: см. [release status](release-status.md).

> A1.8.6: строгий `canvas-webgl-strict-v2` требует весь видимый игровой UI в
> Canvas/WebGL. DOM HUD/controls/terminal overlays запрещены.
> Исторический v1 их допускал; старые metadata не мигрируют.
> Новый [Canvas/WebGL rendering gate](canvas-rendering-contract.md) применяется
> ко всем новым LIVE create/edit и checkpoint revalidation, включая HTML с legacy
> lifecycle markers. Текст исторических аудитов ниже не отменяет этот gate.
> Runtime/render evidence отделено от gameplay evidence. Неподтверждённое
> рисование или активность Canvas блокируют новую версию, сохраняя draft в job.

## Проверка сохранённой версии в RELEASE-006

Production checker для FINAL-005 exact version прошёл технический runtime
validation, однако оставил input/gameplay, win/loss, restart как
`NOT_VERIFIED`. Последующая ошибка player `localStorage SecurityError` оказалась
инициирована Playwright `context.addInitScript`, исполненным во всех frame;
с тем же HTML без init script player ошибок не сообщил. Реальная игра была
проверена отдельно в UI с детерминированным test RNG: Start, еда, счёт, рост,
touch/keyboard direction, collision/Game Over и restart наблюдались в 320×700 и
390×700; landscape 844×390 имел лишь четыре колонки и быстрый повторный collision,
поэтому игровой результат там ограничен. Это offline synthetic evidence, не LIVE
качество, нативное устройство или автоматическое подтверждение механик checker.

> MICRO-036.3 metadata correction was later merged. The MICRO-036.2 compatibility finding below is historical and does not describe the current gate. LIVE and general MVP are assessed separately in [release status](release-status.md).

Аудит MICRO-036.2: 18 октября 2026, main `942387eb1fc06792767bddf2ae766cd0ed4676ff`.
MICRO-023/022 ниже описывают базовые gates; MICRO-030/032 уточняют Full HTML.
Исторические измерения Save/Ready приведены ниже; актуальные ограничения описаны в отдельном release status.

`LLM → prepareDocument → static validation → browserCheck → bounded repair →
revalidation → transaction Save/Ready`. Один production checker, без нового
игрового движка. Game Orchestrator не изменён; из существующего gameplay checker
повторно используется чистая функция `summarizeSession`.

## YAPLIX-GENERATION-RECOVERY-001 — проверка Canvas Start

Full HTML probe добавляет общие taps в центре Canvas на 45% и 54% высоты перед
прежним набором касаний. Это помогает активировать распространённую центральную
кнопку Start, не читает подписи, не использует DOM/игровые селекторы и не меняет HTML.
Любая смена пикселей остаётся только runtime evidence: если после probes нет
подтверждённого Canvas изменения, игра не сохраняется. `BROWSER_CANVAS_ACTIVITY_UNVERIFIED`
остаётся уровнем неопределённости, пока исправная/неисправная механика не доказана;
см. offline regression и реальные сохранённые traces в [отчёте](../.local/yaplix-generation-recovery-001/REPORT.md).

## YAPLIX-GENERATION-RECOVERY-002 — граница реального replay

Без исходных байтов checkpoint записанный trace SHA не пересчитывается и не
заменяет replay. `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` не доказывает запуск
конкретной игры; authored controls подтверждают только общий probe. Повторная
проверка заданий `de96…` и `336f…` требует разрешённо полученного исходного HTML.
См. [Recovery-002](../.local/yaplix-generation-recovery-002/REPORT.md).

## Историческая автоматическая проверка до строгого контракта

Chromium запускается с OS sandbox и environment без server keys. Игра работает
offline в opaque iframe `sandbox="allow-scripts"` с прежней CSP. Generated JS
не исполняется в Node. Запрещены сеть, popups, dialogs, downloads и service workers.
После iframe отдельно проверяется standalone HTML с той же CSP.

Следующее описание event/state evidence относится к legacy `startup-input-pause`;
Full HTML имеет отдельный раздел ниже.

Для legacy HTML с data-yaplix-start на 320/390 px проверяются загрузка/Start, JS syntax/runtime errors и unhandled
Promise rejection, размеры поля/Canvas, overflow, session event contract,
реальный input, pause/resume и повторный запуск при доступном marked Restart.
Подтверждённое исключение, отключённый input после Start, удалённое поле,
неправильный lifecycle, нарушение sandbox или подтверждённый дефект restart
блокируют Save/Ready. Причина сохраняется в `job.validation` и attempt history.

`generation.browser.checks` содержит отдельные `VERIFIED`, `FAILED`,
`NOT_VERIFIED` для html-runs, input-works, gameplay-observed, win-reachable,
loss-reachable и restart-works. У принятой версии `FAILED` недопустим.
Результаты двух размеров объединяются консервативно: VERIFIED требует обоих.

Input evidence требует наблюдаемого изменения изображения вместе с HUD state
или score event; одних движущихся пикселей недостаточно. Gameplay-observed —
лишь несколько наблюдаемых состояний, не доказательство правильности всех правил.
Restart VERIFIED требует реального касания, восстановления исходного счёта и
всего доступного read-only state, затем нового изменения после input. Если state
недоступен, случайный новый мир несравним или Restart не виден, это NOT_VERIFIED.
Глубокие win/loss проверки выполняются отдельно на распознаваемых fixtures.
Короткий production probe не выдаёт win/loss VERIFIED по строкам HTML или events.

Неизвестная механика или отсутствие наблюдаемого прогресса сами по себе не
доказывают дефект. Такая игра может пройти startup/runtime gate с отдельными
NOT_VERIFIED aspects; UI прямо сообщает, что механики и финал не подтверждены.
Проверка не гарантирует обнаружение ошибок, требующих долгой партии, конкретного
случайного поля или неизвестной последовательности действий.

## Восстановление и сохранность

`prepareDocument` допускает только два format repairs:

- `JSON_STRING_DOCUMENT`: JSON.parse целой JSON-строки, содержащей ровно один
  полный HTML; objects/arrays/двойной документ не принимаются.
- `MISSING_DOCTYPE`: добавить declaration перед целым единственным `<html>`.

JS, selectors, attributes и игровые правила не переписываются. Любой candidate
снова проходит static/browser gate. Опечатка `data-yaplix-state"` не исправляется
универсальным regex: сохранённый MICRO-020 остаётся FAILED с null exception.

Первый raw response, включая успешный, сохраняется в
`originalCheckpoint` job metadata; текущий `checkpoint` хранит последний draft.
Оба bounded до 200000 bytes и учитываются в общей квоте 100 MB. Raw HTML отсутствует
в list/summary, доступен владельцу через существующий защищённый GET job.
Идея, origin и diagnostics переживают SQLite reopen. Checked version и completed
job сохраняются одной существующей transaction, idempotency не создаёт дубликаты.
Массовая миграция/перепроверка игр не добавлена; прежнее bounded recovery jobs
после restart сохраняется.

Ollama Cloud получает до `LLM_REPAIRS` автоматических repair requests (0..3,
default 3); один первоначальный POST плюс repairs ограничены четырьмя вызовами
на durable job. `LLM_AUTO_REPAIR=0` явно отключает их. Pinned ChatGPT transport
также может выполнить последовательные запросы к `gpt-6.1-sol`. OpenRouter
остаётся repair-disabled: `openrouter/free` не фиксирует upstream-модель. Каждая
итерация получает исходные требования, полный HTML, структурированный defect и
измерения checker-а; route/model не меняются. Durable счётчики и `repairInFlight`
записываются до dispatch; unknown POST outcome никогда не replay-ится после
restart/Continue, инфраструктурный отказ не расходует repair budget. Завершённый candidate сохраняется
как checkpoint и проходит полный gate повторно; в историю игры попадает только
прошедшая версия. При исчерпании лимита или ошибке draft и причина остаются в job.
Timeout, неподтверждённый checker failure и инфраструктурные/security ошибки не
запускают LLM repair. Целевые тесты покрывают эту цепочку на mocks.
Draft без известного origin или без его configured route блокируется как
`CHECKPOINT_ORIGIN_UNAVAILABLE`, не пересылается другому provider. Владелец может
создать новый запрос; исходный job/draft сохраняется.

## Budgets и диагностика

| Этап | Ограничение |
| --- | --- |
| Browser startup | 8 s, входит в общий budget |
| Legacy render / ожидание controls/events | 3.5 s на browser operation |
| Full HTML browser operation | 1.5 s default timeout; общий deadline остаётся 18 s |
| Initial critical runtime observation | 100 ms после bridge ready; errors слушаются весь probe |
| Legacy gameplay / pause / resume | ≤6 s на viewport |
| Legacy marked restart interaction | ≤2.5 s на viewport |
| Один browser check / revalidation | ≤18 s целиком, включая startup и все viewport выбранного gate |
| LLM repair | existing request deadline ≤60 s по умолчанию, внутри engine/job deadline |
| Generation/job | прежние engine ≤300 s, job default 300 s / 4 calls |

`BROWSER_TIMEOUT_STARTUP/RENDER/INTERACTION/RESTART` и
`BROWSER_CHECK_INCONCLUSIVE` означают NOT_VERIFIED, не доказанную поломку логики.
Ready блокируется до завершённого gate. Cancellation закрывает browser/context;
отменённый/просроченный job не сохраняет поздний успешный ответ.
Успех хранит `browser.elapsedMs`, attempts — request/validation time, включая failure.

Тесты: `node --test tests/micro022.test.ts` (mocks/isolated SQLite) и
`node scripts/browser-tests.mjs test tests/generation.spec.ts --project=chromium-desktop`.
Отдельные authored Tetris/Snake probes остаются в `tests/orchestrator.spec.ts`;
gallery arcade tests — в `tests/arcades.spec.ts`. Это synthetic evidence.
Результаты сохранённого реального checkpoint, timings и границы LIVE:
[отчёт MICRO-022](micro-022-report.md).

## Базовый Full HTML без platform markup (MICRO-023)

Обычная новая генерация не требует event bridge, state output, fixed IDs, Canvas
или универсальных score/health. `browser-check.ts` сохраняет общий browser launch,
OS sandbox/secret-free env и 18 s deadline; для HTML без data-yaplix-start вызывает
[full-html-check.ts](../src/full-html-check.ts). Тот проверяет видимый документ,
320×700/390×700 portrait и 844×390 landscape: visible body/game area,
horizontal overflow, runtime errors/Promise rejection, запрещённые операции,
реальные touch taps и доступные Start/Restart по accessible name; отдельно
standalone offline load. Keyboard fallback здесь не используется: он скрывал бы
отсутствие touch controls. Legacy gate имеет свои keyboard/touch probes.

MICRO-030/032: active-element hit-test исключает перекрытый overlay canvas;
обычный tap по доступной кнопке может открыть Start с неизвестным названием.
После него controls наблюдаются повторно перед landscape comparison.
`BROWSER_CONTROLS_UNREACHABLE` — подтверждённо активный control, доступный в
portrait, целиком вне landscape viewport без возможной пользовательской прокрутки.
Частичная видимость, настоящая root/nested прокрутка, hidden/disabled и ещё не
наблюдавшиеся будущие controls не являются достаточным основанием отказа.
Для несемантических div нужен настоящий input listener, проверяемый read-only CDP
в opaque frame; cursor:pointer сам по себе недостаточен. `scrollIntoView()` не
используется как доказательство touch-доступности.
Подтверждённая ошибка блокирует Save/Ready. Неизвестная последовательность controls
не считается FAILED; input/gameplay/win/loss/restart остаются NOT_VERIFIED,
html-runs VERIFIED подтверждает только наблюдавшийся технический запуск.
Старый instrumented gate с pause/resume/event/restart-reset сохраняется полностью.

Extract принимает весь документ или один целый Markdown fence, не вырезает
HTML из окружающего текста. Неполный HTML/finish_reason=length не сохраняется
как готовая версия. Никаких regex исправлений JavaScript. Новые real repairs в
MICRO-023 не разрешены; все соответствующие тесты используют mocks.

## MICRO-027 failure evidence and preview

An observed critical runtime/security error takes precedence over a later
Playwright actionability failure. A full-HTML inconclusive failure records the
bounded probe phase and viewport width, without raw exception/source text.
No uncertain mechanic automatically authorizes another inference request.

For a complete statically safe checkpoint with BROWSER_CHECK_INCONCLUSIVE,
`GET /api/jobs/:id/preview` offers an explicitly NOT_VERIFIED, opaque sandbox/CSP
preview. Critical errors, unsafe/incomplete HTML and browser timeouts are refused.
This creates no accepted game/version, Ready label or gameplay PASS. Continue can
revalidate a complete checkpoint locally. OpenRouter cannot auto-repair a failed
checkpoint after restart. Trace failures degrade diagnostics, not durable jobs.
[Current LIVE and regression boundaries](micro-027-report.md).

## Canvas text overlap gate

The Canvas 2D layout observer separately rasterizes visible text glyph masks
with the browser's own font engine and active transform. It blocks only a
repeated, material pixel intersection between distinct text draw calls, with
backing-store bounds and draw order; intersecting TextMetrics rectangles alone
are not evidence. Full label contents are not placed in the diagnostic trace.
Unknown paint, clipping, shaping, WebGL text, control hitboxes and text covered
by arbitrary graphics remain `NOT_VERIFIED`. This gate does not infer button
semantics from rectangles. A confirmed `BROWSER_CANVAS_UI_OVERLAP` saves a
viewport screenshot/hash and can enter the existing bounded Ollama repair path;
the full protected checker must pass again before save.


## Контракт browser metadata — исторический блокер MICRO-036.2 (впоследствии исправлен)

Этот раздел сохраняет точный вывод 18 октября для истории. Он не описывает
текущий Save/Ready: позднейший metadata correction был объединён; смотрите
[release status](release-status.md).

На проверенном main [checkFullHtml](../src/full-html-check.ts) возвращает
`profiles:[320,390,844]`. Legacy [browserCheck](../src/browser-check.ts) возвращает
`[320,390]`. [parseArtifact](../src/contracts.ts) пока принимает только точный
`[320,390]` для обоих scopes и нормализует metadata к этим двум значениям.
[GenerationEngine](../src/live.ts) передаёт checker evidence в parseArtifact
до возврата результата; [Store](../src/store.ts) тоже валидирует artifact.

Изолированная проверка parseArtifact с одинаковым synthetic accepted artifact
дала ACCEPTED для `[320,390]` и `INVALID_GENERATION_METADATA` для `[320,390,844]`.
Сеть, LLM и SQLite не использовались. Это доказанная несовместимость границы
контракта: успешный Full HTML checker не превращается в принятую новую версию
через этот путь. Не заявляется новый LIVE сетевой сбой или повтор всего E2E.
Тесты с injected evidence `[320,390]` могут проходить, не покрывая эту границу.

Нужна отдельная production-задача: согласовать metadata для обоих scopes и
проверить реальный checker → parseArtifact → save, сохранив landscape evidence.
В этом docs-only PR код, budgets, HTML и исторические verdict не изменяются.
`MOBILE_VERIFIED` — техническая browser-emulation метка, не физический PASS и
не подтверждение правил/win/loss. [Отчёт и воспроизведение](micro-036-2-docs-audit.md).

## YAPLIX-GAMEPLAY-RECOVERY-004: текст Canvas обрезан на 320×700

Для одного LIVE edit защищённый Chromium и Canvas text-metrics подтвердили, что
две строки выходят за левую и правую границы backing bitmap на профиле 320×700.
Gate корректно отклонил artifact до сохранения. Более широкие профили и игровая
семантика не проверялись; нельзя переносить этот результат на touch, score,
collision или restart. Снимок/trace и неизменность родительской версии записаны в
`.local/yaplix-gameplay-recovery-004/REPORT.md`.

## YAPLIX-FINAL-002: адаптивная выборка Canvas и независимый gameplay evidence

Уменьшенная выборка сохраняет пропорции изображения Canvas и ограничивает длинную
сторону 256 пикселями. Это позволяет не терять тонкие сегменты змейки и еду на
широком landscape viewport; порог существенных цветов остаётся строгим. Общая
Full HTML проверка также касается нижней зоны Canvas, где в исходном checkpoint
находился Start. Ошибки event bridge без `game_ready` направляются в этот же
строгий checker, а не трактуются как render timeout.

Техническая browser проверка не подтверждает еду, score, рост, столкновения,
restart или touch. Для этих выводов нужны наблюдаемые последствия ввода в самой
игре. В FINAL-002 их проверяли отдельно на сохранённом HTML во всех трёх
viewport; контролируемый RNG использовался только для расположения еды. Это
headless browser evidence, не физическое Android/iOS устройство. Отчёт:
`.local/yaplix-final-002/REPORT.md`.
