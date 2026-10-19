# Production game validation — текущее поведение

> A1.8: новый [Canvas/WebGL rendering gate](canvas-rendering-contract.md) применяется
> ко всем новым LIVE create/edit и checkpoint revalidation, включая HTML с legacy
> lifecycle markers. Текст исторических аудитов ниже не отменяет этот gate.
> Runtime/render evidence отделено от gameplay evidence. Неподтверждённое
> рисование или активность Canvas блокируют новую версию, сохраняя draft в job.

> MICRO-036.3, 19 октября 2026: в ветке [PR #46](https://github.com/Sashido01/YAPLIX/pull/46) metadata contract исправлен: текущий Full HTML сохраняет три профиля, исторические два читаются без добавления landscape. Полный offline job/checker/save/API путь проверяется тестами. PR слит 19 октября 2026 и включён в main `d389821`; LIVE и общий MVP этим не подтверждены. Аудит MICRO-036.2 ниже описывает исторический main `942387e`, а не исправленную ветку. [Исправление и границы](known-errors.md).

Аудит MICRO-036.2: 18 октября 2026, main `942387eb1fc06792767bddf2ae766cd0ed4676ff`.
MICRO-023/022 ниже описывают базовые gates; MICRO-030/032 уточняют Full HTML.
Текущий блокер Save/Ready приведён в конце, production в этом аудите не меняется.

`LLM → prepareDocument → static validation → browserCheck → bounded repair →
revalidation → transaction Save/Ready`. Один production checker, без нового
игрового движка. Game Orchestrator не изменён; из существующего gameplay checker
повторно используется чистая функция `summarizeSession`.

## Автоматическая проверка

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

LLM repair production CloudTransport **по умолчанию выключен**. После отдельного
разрешения владельца серверный `LLM_AUTO_REPAIR=1` позволяет максимум один rewrite
на job. `LLM_REPAIRS=0` отключает его; legacy 2 принимается как cap 1. Это тот же
выбранный route, компактная обратная связь ≤512 characters плюс исходные требования
и rejected HTML, без всех logs. Repair не меняет provider и не открывает платный
маршрут. Durable `repairUsed` записывается перед dispatch; Continue, restart,
truncated/incomplete output и автоматический retry не разрешают второй repair.
Полный candidate после crash можно перепроверить без POST. Timeout/неподтверждённый
checker failure не запускают LLM repair. MICRO-022 проверяет его только на mocks.
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


## Контракт browser metadata — блокер MICRO-036.2

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
