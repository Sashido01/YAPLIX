> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# MICRO-023 — Full HTML core

16 октября 2026. Baseline main/origin/main:
`fd8d5e1b1b93bd04080d80b0ebd178c15e249001` (PR #28). Branch:
`codex/micro-023-full-html-core`. Это изменение внутреннего MVP, не release.

## Что установлено

Source audit подтвердил: прежний system prompt требовал compact arcade, preferred
Canvas, меньше 400 строк, mandatory telemetry/state и жанровые подсказки. Это
ограничения полноты и структуры, но не доказательство причины качества конкретного
вывода Ollama: сравнения одинаковых prompts/models здесь не выполнялись.
Output default уже был 12000 tokens; подтверждения, что именно он испортил игру,
нет. Увеличивать бюджет или обещать улучшение качества оснований нет.

Редактор использовал provider select из скрытой формы создания. Отдельного выбора
Ollama в редакторе не было, хотя backend уже принимал previous full HTML.
Auto действительно допускал переход на OpenRouter; новая политика это отменяет.

`BODY_TOO_LARGE` использовался локальным boundedText/SSE. SSE pending frame имел
200000-character cap, хотя JSON escaping/metadata не равны размеру HTML. Regression
с HTML <200000 bytes и JSON frame >200000 воспроизводит ложный отказ. Теперь frame
ограничен прежним общим wire cap 1210000 bytes; общий лимит не увеличен.
Локальное превышение ответа — `LLM_RESPONSE_BODY_TOO_LARGE`, внешний HTTP 413 —
`LLM_HTTP_BODY_TOO_LARGE`. Источник исторического OpenRouter отказа и upstream
timeout не установлен; сетевые гипотезы не выдаются за внешний proof.

## Реализация

- [generation.ts](../../src/generation.ts): компактный GAME_GENERATION_CONTRACT,
  один полный offline HTML с inline CSS/JS, механиками идеи, desktop/touch,
  понятной целью, уместными win/loss, restart и оформлением. Модель выбирает
  Canvas/DOM; нет жанровых шаблонов, line cap или обязательных telemetry IDs.
- Creation: idea → prompt → LLM → whole HTML → validator → atomic GameVersion.
  Whole Markdown fence снимается без изменения JS; incomplete/двойной документ
  и finish_reason=length не становятся Ready. Первый raw answer сохраняется
  в ограниченной private диагностике задания.
- Edit: текущий полный HTML + исходная идея + новое требование, без всей истории.
  Prompt требует сохранять механики. Тесты подтверждают точный payload и версии;
  сохранение произвольной механики реальной моделью требует отдельного LIVE proof.
- Ollama Cloud gemma4:31b — default, включая legacy Auto. OpenRouter Free только
  manual openrouter/free. Upstream ID сохраняется, не используется как requested
  allowlist. No paid/local/generic dispatch или автоматического перехода.
- UI: два одинаковых выбора в создании/редакторе; DEMO убран из основной формы.
  Fixtures/API совместимость сохранены. Model IDs и attempt details остаются
  в diagnostics; технический PASS отделён от gameplay NOT_VERIFIED.
- [full-html-check.ts](../../src/full-html-check.ts): bounded technical probe без
  fixed IDs. Старый instrumented checker сохранён. Sandbox/CSP, runtime/Promise
  errors, startup, доступные restart controls, deterministic fixes, original
  checkpoint и durable one-repair cap сохранены. Новые реальные repairs запрещены.
- SQLite schema/data не мигрируются. Старые versions/jobs/checkpoints сохраняются.
  Legacy Auto checkpoint от OpenRouter не пересылается Ollama: несовместимый origin
  блокирует recovery и сохраняет draft. Explicit router jobs остаются router.

## Лимиты и внешние сведения

Default 12000 output tokens сохранён, config ≤32000, опубликованный completion cap
может его снизить; durable dispatch требует ≥2048. HTML ≤200000 UTF-8 bytes,
serialized messages ≤300000 bytes. При известном context_length проверяется
консервативная оценка bytes + output budget, без усечения обязательного source.
Она может отказать раньше точного tokenizer; ошибка provider context тоже сохраняется.

В [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility)
документирован max_tokens, но универсальный подтверждённый completion cap именно
для бесплатной cloud-квоты gemma4:31b не установлен. Context window в model card
не равен доступному output budget/квоте аккаунта. [Free router](https://openrouter.ai/docs/guides/routing/routers/free-router)
выбирает доступную бесплатную модель; её availability/latency/limits меняются.
[Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
публикует metadata, но router alias не гарантирует контекст каждого upstream.
Реальных inference экспериментов с лимитами не выполнялось. Credits/планы не менялись.

## Проверка

Typecheck/build, 223/223 Node unit tests, реальные локальные Chromium validator
проверки и UI с mocked inference. Creation/edit/version/reopen/export проверяются
через реальный API/SQLite в изолированной базе: 24/24 на 12 профилях;
validator/jobs 16 PASS + 10 intentional skips, mobile/runtime/MVP/arcades 26/26.
Python 19/19, CI policy 8/8. Existing private match-3 прошла bounded gate без
изменения исходной SQLite: html/input VERIFIED, остальные aspects NOT_VERIFIED.
Gitleaks history/changed manifest — без находок. Из 513 local baseline files
512 hashes unchanged; изменён только consumer state synthetic test token
из tests/tunnel.test.ts:18, не пользовательские DB. Mobile browser emulation не
доказывает физические Android/iOS/Telegram. Запуск UI с fixtures не доказывает
качество нового LLM output. Точные результаты — в SESSION_HANDOFF и PR receipt.

Локальный запуск:

```sh
npm run typecheck
npm run build
node --test tests/*.test.ts
node scripts/browser-tests.mjs test tests/generation.spec.ts --project=chromium-desktop
node scripts/browser-tests.mjs test tests/jobs.spec.ts --grep "MICRO-023|Full HTML"
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
node --test scripts/ci-policy.test.mjs
```

GitHub Actions disabled по owner exception; новые runs должны остаться 0.
Hosted Windows/Ubuntu/FULL не заявляются. Production baseline и пользовательские
файлы проверяются отдельным локальным hash manifest, не публикуются в Git.

## LIVE-приёмка — только после разрешения владельца

В реализации MICRO-023 было 0 inference POST. Следующая приёмка MICRO-023L
выполнила 1 разрешённый Ollama POST на main d66151a: полный HTML/сохранение/export
успешны, desktop сбор20/20/win/loss/restart подтверждены, но mobile touch FAILED
в Chromium emulation из-за `'ontouchstart' in window` feature detection.
**LIVE PARTIAL; editing NOT_RUN** по owner stop condition. Исходник не исправлялся
вручную; все private evidence в `.local/micro023l/`, факты — [handoff](session-handoff.md).
Процедура ниже описывает подготовку приёмки; её не следует автоматически повторять
или расходовать неиспользованный второй POST без нового разрешения.

Минимум **2 inference POST**: 1 создание + 1 изменение одной игры через Ollama.
Без automatic retries, repairs или OpenRouter; при ошибке остановиться, новый
POST требует нового разрешения. Существующий .env не редактировать.

После разрешения запустить отдельный процесс с существующими серверными ключами
и отдельной новой `.local/micro023-live/acceptance.sqlite`:

```powershell
$env:YAPLIX_DB='.local/micro023-live/acceptance.sqlite'
$env:LIVE_PROVIDER='ollama-cloud'
$env:CLOUD_API_KEY=''
$env:LLM_MAX_ATTEMPTS='1'
$env:LLM_AUTO_REPAIR='0'
$env:LLM_REPAIRS='0'
$env:PORT='3293'
npm start
```

Если порт занят, выбрать другой свободный loopback порт; чужой процесс не трогать.
Открыть локальный UI и явно выбрать Ollama Cloud в обоих списках создания и
изменения (старый sessionStorage может помнить ручной OpenRouter).
Пустой CLOUD_API_KEY действует только в этом процессе; .env не изменяется.
Первый запрос: «Полноценная игра: персонаж ходит по дому,
убирает мусор, тараканы мешают и отнимают здоровье. Комнаты, препятствия, понятные
цель/победа/поражение, клавиатура и touch, restart, законченное оформление».
Проверить ровно один Ollama dispatch/model, stop reason, полный HTML, runtime,
реальные движение/сбор/столкновения/health/win/loss, сохранить и скачать HTML.
Если генерация не принята, остановиться; не нажимать Continue.

Второй запрос из этой игры: «Добавь тараканов, преследующих персонажа; сохрани
комнаты, мусор, управление и остальные механики». Проверить переданный current HTML,
один dispatch, новую версию/сохранность предыдущей, переключение, restart, reopen
и offline export. Зафиксировать неподтверждённые механики отдельно, без общего
gameplay VERIFIED по одному успешному запуску. Новые игры/diagnostics оставить
private в .local. По окончании закрыть свой процесс и его терминал.

До 29 октября: fresh LIVE acceptance, затем физические Android Chrome/WebView,
iOS Safari/WKWebView и Telegram; exact-release FULL остаётся отдельным требованием.
