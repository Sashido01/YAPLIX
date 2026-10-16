# Production game validation — MICRO-023 / MICRO-022

`LLM → prepareDocument → static validation → browserCheck → bounded repair →
revalidation → transaction Save/Ready`. Один production checker, без нового
игрового движка. Game Orchestrator не изменён; из существующего gameplay checker
повторно используется чистая функция `summarizeSession`.

## Автоматическая проверка

Chromium запускается с OS sandbox и environment без server keys. Игра работает
offline в opaque iframe `sandbox="allow-scripts"` с прежней CSP. Generated JS
не исполняется в Node. Запрещены сеть, popups, dialogs, downloads и service workers.
После iframe отдельно проверяется standalone HTML с той же CSP.

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
| Initial render / ожидание controls/events | 3.5 s на browser operation |
| Initial critical runtime observation | 100 ms после bridge ready; errors слушаются весь probe |
| Gameplay / pause / resume | ≤6 s на viewport |
| Marked restart interaction | ≤2.5 s на viewport |
| Один browser check / revalidation | ≤18 s целиком, оба viewport |
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
320/390 px overflow, runtime errors/Promise rejection, запрещённые операции,
тапы/клавиши и доступные Start/Restart по accessible name; отдельно offline load.
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
