> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# MICRO-029 — ChatGPT Plus / Sign in with ChatGPT feasibility

19 октября 2026. База: main `05b7a59a545497fc04246245a016c64b95d25e87`.
Отдельная ветка `codex/micro-029-chatgpt-feasibility`; Draft PR без merge.
Это исследование авторизации, не новый production provider. MICRO-036.3/PR #46
развивается отдельно; его исправления не копируются в эту ветку.

## MICRO-032: owner-operated inference probe (19.10.2026)

### MICRO-029.3: финальная offline-подготовка CLI

На входе HEAD `d659a5049359ba6cab0e614ac09f66116a521d1a`, ветка
`codex/micro-029-chatgpt-feasibility`. Все предыдущие probe/SSE/diagnostic
исправления находились только в рабочем дереве: src/experimental/siwc.ts,
scripts/siwc-auth.ts, tests/siwc.test.ts и два текущих документа. PDF остаётся
untracked и не включается в сохранение. Новый тест — tests/siwc-cli.test.ts.
Публикация/merge не выполняются; сохраняются только шесть проверенных файлов.

Точный source entry point `node scripts/siwc-auth.ts --probe` вызывает
экспортированную `runSiwcCli(process.argv.slice(2))` и импортирует
`../src/experimental/siwc.ts`, не старый build. Offline CLI-тесты вызывают эту
же функцию с `--probe`, подменяя только HTTP и browser opener. Проверяются
итоговый JSON, return/exit codes и очистка временного lock. Отдельный child-process
тест точного source executable проверяет отказ лишних аргументов до OAuth.
Это не проверка реального системного browser opener или аккаунта OpenAI.
Новых CLI/env флагов для замены endpoint, model, tokens или timeout не добавлено.

23 CLI-проверки: completed (включая done + пустой final output), failed,
incomplete, error, interrupted, empty completed, malformed, HTTP200 без SSE,
HTTP401/429/500/503, timeout, истёкший token, другая модель/Pro/hidden.
Пять дополнительных проверок выполняют тот же CLI runner с настоящим локальным
HTTP/SSE-сервером на ephemeral loopback port: completed/failed/incomplete/error/EOF.
Сервер принимает только model GET и Responses POST; реальные OpenAI endpoints
не вызываются. В probe-сценариях model GET ровно 1, inference POST <=1,
refresh grant 0; лишние CLI-аргументы отклоняются до любых запросов.
Истечение токена останавливает POST, а 401 не запускает refresh/retry.
Запрос содержит только gpt-6.1-sol, reasoning medium, store false, stream true
и один user input. В stdout нет ответа, OAuth code, токенов или сырого SSE;
проверяются stderr и persistent host/registration metadata.

Профильные тесты: 96/96 (23 CLI + 73 SIWC), typecheck/build PASS.
Полный локальный unit suite — 359/359, repository checker и diff-check PASS.
Реальные OAuth/models GET/inference POST из Codex: **0/0/0**.
Локальный commit приведён в итоговом отчёте.

Владелец сообщил Gitleaks 8.30.1 в `.local/tools/gitleaks.exe`, проверенный SHA-256
официального архива, и PASS четырёх файлов. Затем Codex независимо выполнил этот
exe: version 8.30.1 и `dir --help` подтверждены; scan **всех шести SIWC-файлов**
с `--no-banner --redact=100` PASS, exit 0 для каждого. Проверка SHA-256 архива
остаётся owner-reported. Каталог tools не изменялся. Корень/ignored файлы/PDF
не сканируются: команда получает только явные шесть путей.

После сохранения локального commit владелец выполняет в обычном PowerShell:

```powershell
Set-Location D:\YAPLIX
$scanner = 'D:\YAPLIX\.local\tools\gitleaks.exe'
& $scanner version
if ($LASTEXITCODE -ne 0) { throw 'Gitleaks version unavailable. STOP.' }
$scanFiles = @(
    'src/experimental/siwc.ts', 'scripts/siwc-auth.ts',
    'tests/siwc.test.ts', 'tests/siwc-cli.test.ts',
    'docs/micro-029-chatgpt-feasibility.md', 'docs/known-errors.md'
)
foreach ($scanFile in $scanFiles) {
    & $scanner dir --no-banner --redact=100 $scanFile
    if ($LASTEXITCODE -ne 0) { throw "Gitleaks failed for $scanFile. STOP; no real POST." }
}
```

Если version отличается от 8.30.1, сверить её dir help; при ошибке STOP,
никакого обхода или реального POST. После PASS Gitleaks владелец отдельно
решает, разрешить ли один реальный POST. **Сейчас повторный probe не разрешён.**

### MICRO-032.1: пустой результат и безопасная диагностика

Владелец сообщил: AUTH VERIFIED, `gpt-6.1-sol`, medium, HTTP200,
responseMediaType missing, sseObserved true, inferencePost 1,
textReceived false, usage null, `SIWC_OUTPUT_INVALID` (**HUMAN_REPORTED**).
Новых реальных OAuth, model GET или inference POST не выполнялось. Бюджет POST 0.

**ROOT_CAUSE: NOT_VERIFIED** для конкретного сетевого ответа: прежний отчёт
не содержит событий и не различает пустой и чрезмерный текст. По коду до
MICRO-032.1 ошибка возникает только внутри `response.completed` после проверки
status completed и отсутствия response.error: извлечённый текст пуст либо
длиннее 8192 символов. Usage извлекался после этой проверки; поэтому usage null
не доказывает отсутствие usage на сервере. При совпадении версии этот путь
также исключает failed/incomplete/error как непосредственный источник ошибки.

Локально воспроизведён дефект: пустой итоговый `response.output:[]` затирал
непустые delta. Другой обнаруженный пробел — `response.output_text.done`
игнорировался. Исправление хранит части по output_index/content_index: delta
накапливается, done заменяет снимок части, непустой финальный output имеет
приоритет. Пустой финальный output не стирает полученный текст. Снимки не
конкатенируются повторно; повторяющиеся реальные подстроки delta сохраняются.
Reasoning/refusal events не считаются текстовым ответом.
Схемы событий: [официальный reference](https://developers.openai.com/api/reference/resources/responses/streaming-events).

| Исход | inference / error |
| --- | --- |
| completed и непустой текст | COMPLETED; PASS только при exactMatch |
| completed без текста | COMPLETED_EMPTY / SIWC_COMPLETED_WITHOUT_TEXT |
| failed | FAILED / SIWC_INFERENCE_FAILED либо фиксированный quota code |
| incomplete | INCOMPLETE / SIWC_INFERENCE_INCOMPLETE |
| error | ERROR / SIWC_INFERENCE_FAILED либо фиксированный quota code |
| конец или ошибка reader без terminal event после SSE | INTERRUPTED / SIWC_STREAM_INTERRUPTED |
| некорректный JSON event, payload или UTF-8 | INVALID_SSE / SIWC_SSE_INVALID |

Отдельно чрезмерный извлечённый текст даёт SIWC_OUTPUT_TOO_LARGE.
Metadata и usage читаются до проверки текста. `diagnostics` содержит только
eventCounts, lastEventType, responseStatus, apiErrorCode, incompleteReason,
textPresent, textLength (UTF-16 code units), receivedBytes (только inference body).
Usage сохраняет числовые input_tokens/output_tokens/total_tokens, если получены.
Имена событий берутся из фиксированного списка; неизвестные — bucket unknown.
API codes/status/reasons проходят allowlist, неизвестные значения — OTHER.
Произвольные строки не отражаются в отчёте. Поле text удалено полностью,
даже ожидаемый ответ больше не печатается. Нет токенов, Authorization, сырого
SSE, reasoning, output или error.message в diagnostic output.

Проверки используют синтетическую HTTP-границу и loopback, без реального входа.
Локально typecheck/build PASS, unit suite 336/336 (SIWC 73/73), repository/diff
checks PASS. Проверка отсутствия текста/секретов в сериализованной диагностике
покрывает текст ответа, reasoning, произвольные event names/error codes/reasons.
Модель, medium, основной генератор/UI и провайдеры не менялись. После локальных
проверок STOP; повторный реальный probe сейчас не разрешён.

Текущее продолжение MICRO-029. Разделы ниже сохраняют исторические результаты
первого прототипа. Владелец 19.10.2026 сообщил `AUTH VERIFIED`,
`planPermissionGranted:true` (**HUMAN_REPORTED**, повторно не расследуется).
Это ещё не доказательство каталога или inference. Реальный probe из Codex
не запускался; текущий LIVE результат **NOT_VERIFIED**.

MICRO-029.2 / MICRO-032: локальное уточнение. Владелец сообщил ошибку
`SIWC_SSE_REQUIRED`, HTTP 200, Content-Type UNKNOWN (в прежнем отчёте отсутствует).
Это HUMAN_REPORTED; исходное тело ответа и причина реального сбоя не установлены.
Новых реальных OAuth/model/inference вызовов из Codex не было.
После локальных проверок остановиться. **Повторный реальный `--probe` сейчас
не разрешён**; следующий запуск возможен только после нового разрешения владельца.

Команда для будущего разрешённого запуска из обычного PowerShell на этой машине:

```powershell
Set-Location D:\YAPLIX
node scripts/siwc-auth.ts --probe
```

После нового разрешения запустить **один раз**. Команда открывает официальный вход прежним OAuth-модулем,
потому что `--authorize` завершил процесс и уничтожил его токены. Это получение
новой сессии, а не повторное исследование OAuth. Host/client registration
переиспользуются; callback URL/code/токены не копировать в чат.

После входа выполняются один `GET https://api.openai.com/v1/models` и не более
одного `POST https://api.openai.com/v1/responses`. Нет retries, fallback, refresh,
repair, API-key или чтения `.env`. При отказе каталога POST не выполняется.
Повторный probe того же экземпляра запрещён; повторный запуск CLI — новая
попытка и требует отдельного разрешения владельца, в том числе после timeout.

Каталог берётся из `models`, учитываются `slug`, `display_name`, `visibility`.
На каждой попытке требуется точный `slug:gpt-6.1-sol` с `visibility:list`.
Если модели нет или она скрыта, `SIWC_PROBE_MODEL_UNAVAILABLE`, inference NOT_RUN,
POST count 0. Автоматическая подмена на Astra, Pro, alias или другую модель
запрещена; кэш каталога не используется.
Порядок доступного каталога сохраняется в отчёте.

Тело POST содержит только `model`, массив `input` с user-сообщением
«Ответь точно: YAPLIX READY», `store:false`, `stream:true`,
`reasoning:{effort:"medium"}`. Pro и service-tier overrides не включаются.
Отчёт `requestedReasoningEffort:medium` фиксирует отправленную настройку,
не независимое подтверждение фактического reasoning аккаунта.
Поддержка medium описана в [модели](https://developers.openai.com/api/docs/models/gpt-6.1-sol);
доступ аккаунта определяется каталогом и будущим разрешённым ответом API.
System-role, лимиты токенов и остальные неподдерживаемые SIWC-поля не отправляются.
Контракт: [модели и inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

SSE обрабатывается по фактическим `data:`-кадрам с поддержкой BOM, многострочного
data, фрагментации UTF-8 и окончаний LF/CRLF/CR. Один заголовок Content-Type
больше не служит запретом чтения SSE: корректные кадры принимаются также при
отсутствующем/неверном media type. JSON, HTML, `[DONE]` и delta без terminal event
не могут стать PASS. JSON error получает фиксированный безопасный код; текст
upstream error не печатается. Это локально проверенная коррекция header-only
отказа, **не доказательство причины реального HTTP200**.
Успех требует
`response.completed`, status `completed`, непустой текст и точное `YAPLIX READY`.
Неожиданный текст даёт PARTIAL с `SIWC_OUTPUT_UNEXPECTED`; факт завершения
сохраняется, текст скрывается. Обрыв, failed/incomplete, quota error, HTTP error,
невалидный SSE или timeout не превращаются в PASS. Общий timeout — 60 s,
входящий поток/каталог — до 1 MB, кадр SSE — до 64 KiB, текст — до 8192 символов.
Ctrl+C отменяет текущую операцию. Redirects запрещены.

CLI печатает только безопасный JSON: result, authorization, planPermissionGranted,
models, selectedModel, inference, textReceived/exactMatch, diagnostics без текста,
числовые usage (если предоставлены), providerCalls, httpStatus, фиксированный error,
`responseMediaType` (event-stream/json/other/missing) и `sseObserved`.
Полный Content-Type/произвольные заголовки не выводятся.
Сырые ошибки, event bodies, OAuth URL, credentials и неожиданный вывод модели
не печатаются. Значения токенов удаляются из разрешённых строк каталога; usage
принимается только как неотрицательные safe integers. Токены живут только в памяти
и забываются в finally. Существующие host/registration metadata остаются на диске.

`providerCalls` считает model GET и inference POST, включая неудачную попытку
отправки. OAuth token-exchange POST относится к входу и не является inference.
Usage — количество токенов из ответа, **не доказательство стоимости или списаний**.
Нет API-key billing path и автоматической покупки credits. Настройки и фактические
списания аккаунта здесь не проверяются.

Приёмка после ручного запуска: `result:PASS`, `inference:COMPLETED`,
`exactMatch:true`, `diagnostics.textLength:12`, `providerCalls:{modelsGet:1,inferencePost:1}`. Сохранить
только этот безопасный отчёт. После PASS остановиться; production provider/UI,
полная игра, vault/refresh и другие ветки остаются отдельными задачами.

Локально после MICRO-032.1: typecheck/build PASS; полный unit suite 336/336,
включая профильные SIWC offline-тесты 73/73.
Публичная seam — signIn→probe через синтетическую границу
OpenAI и настоящий loopback callback; она ловит нарушения тела запроса,
повторные POST и ложный terminal success, но не доказывает доступ сервиса.
Предыдущий короткий runtime smoke Chromium 390: четыре test assertions прошли (эмуляция,
не physical device), но runner не завершился после тестов и был остановлен
вручную; итоговый process exit 1, полный smoke **PARTIAL**, не PASS.
Причина завершения runner не исследовалась в этой изолированной задаче.
Repository checker и diff-check PASS. Целевой поиск private-key/API-key/GitHub-token/
JWT literals в пяти изменённых файлах — 0; SIWC scope/token endpoint/probe marker
в frontend bundle — 0. На MICRO-032.1 Gitleaks был недоступен; теперь
MICRO-029.3 подтвердил 8.30.1 и PASS шести явных файлов. Поиск шаблонов
не заменяет Gitleaks scan.
Реальный inference, Ubuntu/macOS и hosted Actions **NOT_VERIFIED**.

Для разрешённой публикации владельцем после проверки diff (без merge):

```powershell
git diff --check
git add -- src/experimental/siwc.ts scripts/siwc-auth.ts tests/siwc.test.ts docs/micro-029-chatgpt-feasibility.md docs/known-errors.md
git diff --cached --stat
git commit -m "feat: add isolated owner-operated SIWC inference probe"
git push origin codex/micro-029-chatgpt-feasibility
```

Перед push выполнить доступный Gitleaks scan с redaction. При Git network error
остановиться; не обходить ограничения. PDF не входит в staging manifest.
Из Codex Git-сеть повторно не проверялась после ранее наблюдённого запрета.

## FACT

Официальная [документация SIWC](https://developers.openai.com/siwc/quickstart)
описывает identity и отдельное разрешение ChatGPT plan usage. Наличие Plus само
по себе не доказывает доступ конкретного клиента или модели. Для local personal
проектов описан public-client flow без API key/client secret; paid/remote варианты
требуют отдельного допуска. См. [официальный cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

Исследованы текущие [генератор](../../src/live.ts), [durable jobs](../../src/jobs.ts),
[сетевой транспорт](../../src/llm-network.ts) и [архитектура](../architecture.md).
Они остаются без изменений. Новый модуль не импортируется API/server/UI,
не реализует Generator/CodeTransport и не читает SQLite/checkpoints/.env.

### Выбор реализации и лицензии

| Подход | Факты и вывод для этого этапа |
| --- | --- |
| `@siwc/local` | [Официальный DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/README.md) поставляет SDK как local workspace. [Package manifest](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/packages/local/package.json) помечен private, требует Node >=22. Это не основание устанавливать произвольный одноимённый пакет из npm. |
| Лицензия DevKit | [Noncommercial License v1.0](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE) ограничивает использование/распространение некоммерческими целями. Бесплатность продукта сама по себе не даёт коммерческих прав. Для коммерческого использования кода нужна отдельная договорённость; лицензия не даёт сервисного доступа. |
| Шифрование DevKit | [Security guide](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/docs/security.md) требует application-supplied encryption provider; plaintext fallback отсутствует. Пример использует Electron/macOS, YAPLIX — обычный Node server. Нужен отдельный Windows/Linux vault adapter. |
| Выбранный подход | Самостоятельный небольшой public-client OAuth по официальному протоколу, с закреплённой JOSE 6.2.12 для проверки JWT. Код/SDK/branding DevKit не копировались и не подключались. Это устраняет зависимость от его workspace/Electron adapter, но не отменяет условия сервиса или будущий review доступа/распространения. |

### Проверенные официальные контракты

- [Host и client](https://developers.openai.com/siwc/token-sharing-open-source):
  стабильный случайный UUID host ID допустим; host ID не является credential.
  Он относится к установке, client ID — к регистрации аккаунта/workspace.
- [Регистрация и вход](https://developers.openai.com/siwc/token-sharing-open-source/sign-in):
  PKCE S256, state и nonce; первоначально `dynamic_agent_client`, затем issued
  client ID из callback. Callback — HTTP `127.0.0.1`, неизменный `/auth/callback`,
  порт может различаться между попытками. Новый issued ID не равен sentinel.
- [Сессии и refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions):
  refresh использует сохранённый issued ID, refresh token и resource; scope
  не расширяется. Замена вращающихся токенов должна быть атомарной, refresh —
  сериализованным. В этом прототипе refresh и долговременные токены не реализованы.
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference):
  access token живёт час, refresh — 30 дней с заменой при успешном обновлении.
  Сроки нельзя превращать в обещание доступа или гарантированных лимитов.
- [Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):
  будущая интеграция должна использовать `https://api.openai.com/v1/responses`,
  OAuth bearer, аккаунтный каталог моделей и `response.completed` как terminal
  success. Auth или GET models сами по себе не подтверждают inference.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):
  HTTP требует `store:false`, `stream:true`, массива input с нужным контекстом;
  текущие generation knobs нельзя переносить напрямую. В частности,
  `max_output_tokens`, `temperature` и `previous_response_id` здесь не подходят.
  Нельзя переключаться на ChatGPT backend-api или использовать session cookies.

## CHANGED

- [Изолированный модуль](../../src/experimental/siwc.ts): стабильный host ID,
  одноразовый loopback listener, PKCE/state/nonce, discovery с pin endpoints,
  dynamic registration и reuse issued client ID, проверка подписи JWT через JWKS,
  issuer/audience/expiry/iat/nonce/sub/azp и granted scopes. Подмена аккаунта при
  reauthorization отклоняется. Initial registration ID может сохраняться как
  pending с `subject:null`; это не доверенная identity и не grant.
- [Ручной CLI](../../scripts/siwc-auth.ts): только `--prepare` / `--authorize`.
  Открывает системный браузер, не автоматизирует его и не печатает OAuth URL.
  Нет inference, model discovery, repair или автоматических повторов.
- [Тесты](../../tests/siwc.test.ts): реальные локальные callback sockets,
  синтетически подписанные JWT и подменённая только HTTP-граница OpenAI.
- Единственная новая dependency — JOSE 6.2.12 с lockfile. Production-провайдеры,
  jobs, network policy, frontend и пользовательские данные не менялись.

## TESTS

Windows, Node 24.18.0: typecheck/build PASS, полный unit suite **286/286**,
профильные OAuth-тесты **23/23** PASS. `npm audit --omit=dev`: 0 vulnerabilities;
поиск SIWC module/scope/token-endpoint в `build/public`: 0 совпадений.
Проверяются успешный вход/reuse ID и host, PKCE, deny, state/duplicate params,
missing code/permission/scopes, invalid signature/issuer/audience/expiry/nonce/sub,
account/client swap, неверный discovery, network/token failures, browser failure,
timeout/cancel, Host/path/method guards, освобождение callback и временного lock.
В stdout/stderr возвращаются фиксированные коды, без credential/error body.
Постоянные файлы тестов не содержат token/code/verifier.

`--prepare` успешно выполнен из source и compiled CLI: registered:false,
authorization:NOT_RUN, inference:NOT_RUN. Оба используют одну installation path.
Ошибку Windows trailing separator при первоначальном тесте устранила нормализация
корня через `resolve`; таймауты приложения не увеличивались.

Repository checker, diff-check и Gitleaks проверяются перед публикацией; их
итоговый результат и точный head приведены в Draft PR.
Hosted Actions отключены по MICRO-019: это NOT_VERIFIED, не green Ubuntu/Windows CI.

## AUTH

Реальный OpenAI вход **NOT_RUN**. Реальные OAuth token exchange, inference и repair
POST — **0**. Право использования Plus/конкретных моделей **NOT_VERIFIED**.

Ручной сценарий первой авторизации владельцем после review:

1. Выбрать эту ветку, установить зависимости из lockfile, выполнить
   `npm run typecheck` и `npm run build`.
2. Выполнить `node scripts/siwc-auth.ts --prepare`. Это только подготовка
   несекретного host ID в `.local/siwc-feasibility/host.json`, без сети/браузера.
3. На той же машине с GUI и Node выполнить
   `node scripts/siwc-auth.ts --authorize`. В системном браузере выбрать свой
   ChatGPT account/workspace, проверить имя YAPLIX и requested permissions.
   Не передавать callback URL/code в чат или поддержку.
4. При согласии дождаться фиксированного сообщения в браузере и CLI
   `authorization:VERIFIED`, `planPermissionGranted:true`, `inference:NOT_RUN`.
   Отказ пользователя или отсутствующий scope — отказ этапа, без inference.
5. CLI немедленно забывает токены и завершает процесс. Сохраняется только host
   и несекретный issued-client/verified-subject mapping. Следующий запуск требует
   reauthorization; регистрация клиента и host ID переиспользуются.
6. Доступ Plus всё ещё не объявлять подтверждённым. Следующий этап — отдельное
   разрешение владельца с точным inference budget и проверкой terminal result;
   подключение production только после review и результатов MICRO-032.

Если после crash остался `authorization.lock`, сначала убедиться, что своего
auth процесса больше нет. Прототип не удаляет чужой/непроверенный lock автоматически.

## SECURITY

Токены — только private memory fields, не сериализуются и не возвращаются CLI/UI.
Нет plaintext credential storage; PKCE/code/state/nonce не пишутся на диск.
Host и registration не являются секретами; subject — минимальный identity mapping,
без email/profile data. На Unix запрашиваются 0700/0600, на Windows токены в файлы
вообще не попадают. Временные lock/tmp принадлежат только этой попытке.

Доступны только pinned official discovery/authorize/token/JWKS endpoints.
Redirects fetch запрещены, response size и request/attempt duration ограничены,
insecure TLS env запрещён. Listener привязан к `127.0.0.1`, проверяет Host,
path/origin/method/remote IP, не отражает query/error/token. State одноразовый.
Callback response — no-store, CSP none, no-referrer. Production API не имеет
маршрутов подключения/чтения токенов. Существующие `.env`, SQLite, checkpoints,
игры, Firewall, PR #34/#37, PDF и HELD-OUT не затрагивались.

## LIMITATIONS

- Windows: verified local Node/build/offline tests; системный opener — rundll32.
  Настоящий браузерный вход не запускался. Не использовать как service session.
- Ubuntu: Node 24 ESM/JOSE не требуют native addon. GUI-сессия и xdg-open нужны
  для manual sign-in на том же host. Ubuntu runtime/GUI здесь NOT_VERIFIED;
  headless/WSL/remote browser не заявлены рабочими.
- Нет OS vault adapter, disk token persistence, refresh/revocation, multi-account
  picker или автоматического восстановления auth после restart. Эти функции
  требуют отдельного этапа; plaintext fallback добавлять нельзя.
- Пока используется обычный Node fetch; отдельный proxy transport не настроен.
  Не менять глобальный proxy/TLS для обхода сбоя и не приписывать network cause.
- Prototype проверяет documented `oaiapp_` IDs и RS256/ES256 JWT; реальный OAuth
  контракт аккаунта нужно подтвердить ручным входом. Нет API key или cookies.
- Plus имеет общий межприложенческий five-hour allowance по текущей документации
  sessions; отдельной квоты для YAPLIX не обещается. Credits/планы не покупаются.
- Текущий P0 metadata на main исправляется только в PR #46, не этой веткой.

## NEXT

Review Draft PR и выбор lifecycle для OS-protected credentials. Затем ручная
авторизация владельцем. После результатов MICRO-032 — отдельный bounded inference
proof и самостоятельное решение о production-интеграции. До этого STOP.
