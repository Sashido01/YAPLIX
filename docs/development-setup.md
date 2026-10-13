# Рабочее место и проверки YAPLIX

Нужны **Git, Python 3.11+, Node 24.18+ (24.x), npm**. Стек приложения — TypeScript,
Hono и встроенный SQLite. Новый участник сначала принимает приглашение в
Private-репозиторий и настраивает GitHub-аутентификацию средствами Git; токены
не вставляет в URL и файлы проекта.

## Первый клон

Из выбранной родительской папки (команды Git одинаковы на Windows/Linux):

```sh
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
git config --local core.autocrlf false
git config --show-origin --get core.hooksPath
```

Отсутствие вывода последней команды и код 1 означают, что core.hooksPath не задан. Если уже настроены чужие hooks, сначала согласуйте их совместное использование: изменение core.hooksPath заменяет активный каталог hooks. Проверьте также свои активные hooks в .git/hooks, если отдельный путь не задан. В существующем клоне не повторяйте git clone.

## Установка локальной защиты main

Из корня клона каждый участник выполняет:

```sh
git config --local core.hooksPath .githooks
git config --local --get core.hooksPath
git ls-files --stage .githooks/pre-push
```

Ожидаются .githooks и Git mode 100755. На Linux при утрате исполняемого права выполните chmod +x .githooks/pre-push. Git for Windows запускает #!/bin/sh своим shell, дополнительный runtime для hook не нужен. Глобальная Git-конфигурация не меняется. После нового клонирования установка повторяется; .git/config в Git не передаётся.

Hook запрещает **любой удалённый refs/heads/main**: обычный push, явный refspec, создание, force-push и удаление. Сопоставление идёт по целевой ветке из stdin Git, а не по текущей локальной ветке или имени remote. В смешанном push запрещается вся операция. Возможности обхода и серверные ограничения — в [github-ruleset.md](github-ruleset.md). Не проверяйте защиту тестовым push в настоящий origin/main.

## Локальные проверки

Установка/запуск и команды продукта — в [README](../README.md). npm ci использует
lockfile и проектный `.npmrc`; npm cache находится в `.local/npm-cache`.
npm start читает `.env`, если он существует; переменные процесса имеют приоритет.
PORT по умолчанию 3000, YAPLIX_DB внутри `.local`, BGEN_URL опционален,
BGEN_TIMEOUT_MS по умолчанию 30000, BGEN_INIT_DATA только server-side.
Сохраните initData локально, не логируйте и обновляйте при истечении срока.

Windows, PowerShell 7:

```powershell
python --version
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
git diff --check
git status --short
```

Ubuntu/Linux: те же команды с `python3`. Скрипт проверяет **отслеживаемые файлы**; перед проверкой новых файлов добавьте явно просмотренные файлы в индекс (`git add <file>`). Тесты push используют только временные локальные репозитории внутри этого клона и никогда не обращаются к GitHub.

Для полного локального сканирования установите официальный Gitleaks **8.24.3** в удобный локальный каталог и проверьте checksum архива. Не храните бинарник в Git. Из корня с доступным gitleaks:

```sh
gitleaks git --redact --log-opts=--all .
gitleaks dir --redact .
```

Вторая команда проверяет также незакоммиченные файлы; не размещайте её отчёт в Git. Находка или ошибка инструмента запрещает считать проверку успешной. Отсутствие находок не гарантирует отсутствия всех секретов. Действия при утечке — в [SECURITY.md](../SECURITY.md).

## CI

В одном workflow находятся repository-checks (Ubuntu 24.04 и Windows) и secret-scan
(Linux, Gitleaks). Обе OS выполняют исходные Python-проверки, npm ci, typecheck,
platform/adapter integration tests и browser tests (пять профилей).
Триггеры: pull_request, push в main, ручной workflow_dispatch. На PR/push Action
проверяет диапазон изменений из полной загруженной истории; ручной запуск
сканирует историю текущего checkout. Это не равнозначно сканированию всех
удалённых веток. Для полной локальной истории используйте команду с --all выше.

Actions закреплены SHA; Dependabot проверяет обновления. Токен имеет contents: read, сканер дополнительно pull-requests: read для чтения списка коммитов Private PR. Запись комментариев, SARIF-артефакты и summary сканера отключены; вывод Gitleaks редактируется (--redact). Для личного аккаунта отдельная лицензия Gitleaks Action не нужна ([документация](https://github.com/gitleaks/gitleaks-action#usage-example)). Private использует квоту GitHub Actions; исчерпание квоты не считается успешным CI.

Локальные проверки не подтверждают hosted CI новой ветки. Перед merge нужно дождаться реальных зелёных checks последней версии PR. Командный процесс — в [CONTRIBUTING.md](../CONTRIBUTING.md), подготовка ноутбука — в [cross-platform.md](cross-platform.md).

## API для UI jeanhayl

JSON body обязателен для POST. API принимает только loopback Host и same-origin
Origin; непривязанный запрос из sandbox (Origin null) отклоняется. UI подключает
API через тот же origin/proxy. Публичная авторизация и multi-user ownership
пока отсутствуют — это локальный MVP.

| Операция | Контракт |
| --- | --- |
| GET /api/games | метаданные последних 50 игр, последняя версия каждой |
| GET /api/diagnostics | integrity/FK/schema и безопасные сведения конфигурации |
| POST /api/backups | `{}`; проверенный SQLite backup, filename/hash/schema |
| GET /api/health | ok по integrity/FK, schemaVersion |
| POST /api/games | `{spec, mode?, artifact?, requiredMethod?}`; mode=demo — авторская игра, live — строгий LLM, без mode — legacy; ответ GameVersion, 201 |
| GET /api/games/:gameId | gameId и история метаданных versions без HTML |
| POST /api/games/:gameId/versions | `{spec, previousVersionId, mode?, artifact?, requiredMethod?}`; DEMO или LLM iteration либо mock import; 201 |
| GET /api/versions/:versionId | полная GameVersion с HTML |
| GET /api/versions/:versionId/export | exact HTML attachment; X-Content-SHA256 совпадает с GameVersion.sha256 |
| POST /api/versions/:versionId/sessions | `{}`; sessionId, versionId, token, expiresAt, protocolVersion |
| POST /api/sessions/:sessionId/events | один GameEvent + Authorization: Bearer session token; duplicate boolean |
| GET /api/versions/:versionId/analytics | статистика; optional baselineVersionId query — сравнение |
| GET /runtime/runtime.js | ES-module mountGame после npm run build |

Точные типы и runtime validators: [contracts.ts](../src/contracts.ts).
GameSpec имеет prompt, audience (`default/kids/elderly/hardcore`), genre,
mechanics[], controls[] (`keyboard/touch/pointer`), responsive, webview.
Неизвестные поля отклоняются. prompt 2–500 символов; адаптер добавляет компактные
requirements, поэтому суммарный BGen prompt тоже должен помещаться в 500.
Это текстовые требования, не гарантия их выполнения BGen.

Пример локальной проверки на Windows в другом терминале после npm start:

```powershell
$spec = @{ prompt='Collect three points'; audience='default'; genre='clicker'; mechanics=@('score'); controls=@('touch','pointer','keyboard'); responsive=$true; webview=$true }
$artifact = @{ html=(Get-Content tests/fixtures/game.html -Raw); method='mock'; provider='authored-test-fixture'; model=$null; generationStatus='succeeded'; validationStatus='unverified' }
$version = Invoke-RestMethod http://127.0.0.1:3000/api/games -Method Post -ContentType application/json -Body (@{ spec=$spec; artifact=$artifact } | ConvertTo-Json -Depth 8)
Invoke-RestMethod "http://127.0.0.1:3000/api/versions/$($version.versionId)/analytics"
```

Импорт artifact разрешает только mock + unverified. Реальный llm_code проходит
через серверный Ollama transport с BGen compiler или строгий BGen HTTP Adapter. Клиент не может сертифицировать
свою игру как passed или переименовать fixture в LLM.
requiredMethod допускает только `llm_code`; несовместим с artifact import.
Для конкурсного запуска всегда указывать это поле. Пример запроса:

```json
{"spec":{"prompt":"Create a snake game with touch controls","audience":"default","genre":"snake","mechanics":["collect"],"controls":["touch","keyboard"],"responsive":true,"webview":true},"requiredMethod":"llm_code"}
```

Допустимый успех — GameVersion с UUID gameId/versionId, previousVersionId null
для первого запуска, spec, html, sha256 (64 hex), createdAt (UTC),
method=llm_code, provider/model непустые строки, generationStatus=succeeded,
validationStatus=unverified. Это схема ответа, не наблюдённый live-результат.
При старом удалённом BGen endpoint ожидается HTTP 503 `{"error":"BGEN_LIVE_CONTRACT_REQUIRED"}`.

UI получает версию и сессию, вызывает `mountGame(container, html, {sessionId,
versionId}, onEvent)` и держит token у родителя. onEvent ставит события в
последовательную очередь HTTP; повторяет **тот же** eventId/sequence при сетевой
ошибке. При пропущенном событии сначала повторить его; не пересоздавать ID.
unmount удаляет frame/listener. Срок токена 1 час; для следующего запуска новая
сессия. Во время offline телеметрия может отсутствовать; gameplay должен работать.

После загрузки bridge посылает `yaplix_init` с protocolVersion=1 и IDs, без token.
Игра отправляет `{channel:'yaplix', event:GameEvent}` через parent.postMessage;
при отсутствии родителя просто пропускает отправку. Минимальный пример —
[авторская fixture](../tests/fixtures/game.html). Это YAPLIX протокол; локальная LLM получает его контракт в промпте.
Текущий BGen telemetry измеряет генерацию и не считается игровым.

## Предложение контракта для SKZHPRVT

Сохраняем /api/generate и /api/iterate и текущие поля. Предлагаем добавить:

```json
{
  "html": "<!DOCTYPE html><html>...</html>",
  "ok": true,
  "fromCache": false,
  "provider": "openai",
  "provenance": {
    "protocolVersion": 1,
    "method": "llm_code",
    "provider": "openai",
    "model": "actual-model-id"
  }
}
```

method всегда один из llm_code/template_config/mock/fallback, соответствует
реальному пути. Для cache сохранить **исходное** provenance с артефактом;
для engine/default честно template_config/fallback, для Mock всегда mock.
model/provider null, если неизвестны; строгий llm_code такой ответ отклоняет.
ok сообщает итог генерации/анализатора,
не результат браузерного испытания. Этот контракт ещё не принят BGen.

Отдельно нужны: явный code-generation путь для обязательного условия кейса,
передача previousCode в CompileOptions при iterate, отказ от скрытого Mock,
GigaChat TLS с проверяемым CA вместо rejectUnauthorized=false, опциональный
YAPLIX event bridge с автономным fallback. Эти изменения выполняет владелец BGen.
Замечания переданы здесь как предложение к командному review; внешних сообщений
участнику эта задача не отправляет.

Для строгого режима предлагаем маленький read-only handshake
`GET /api/capabilities` (пока отсутствует в BGen):

```json
{"protocolVersion":1,"revision":"<40 lowercase hex Git SHA>","codeGeneration":true,"tlsVerification":true,"previousCode":true}
```

revision — SHA развёрнутого сервиса. codeGeneration — поддержка требуемого пути,
tlsVerification — проверка сертификатов **всех** разрешённых LLM/OAuth запросов,
previousCode — HTML реально попадает в compiler/LLM. Это утверждения владельца,
их сверяют с исходниками; endpoint не заменяет аудит TLS. Известный SHA 419c649
небезопасен и отклоняется. Нельзя просто добавить true к старому коду.

POST generate/iterate дополнительно получает requiredMethod=llm_code: пропустить
жанровые шаблоны, запретить Mock/default/config fallback; при невозможности вернуть
ошибку. Cache допускается только с сохранёнными исходными provenance/model.
POST iterate получает previousCodeSha256; ответ должен вернуть этот же hash
после проверки, что соответствующий HTML передан в CompileOptions.previousCode.
Hash не означает, что модель успешно сохранила поведение; это проверяется отдельно.
Без previousCode=true итерация блокируется до POST. Bridge v1 остаётся optional.

## Live-запуск и демонстрация TASK-003

После исправления/аудита BGen, из корня проекта:

```powershell
$env:BGEN_URL='https://your-generator.example'
$env:BGEN_TIMEOUT_MS='120000'
npm run demo:live
```

Не отключать TLS. BGEN_INIT_DATA, если требуется, задаётся только серверному
процессу из локального защищённого источника. Скрипт не логирует initData или
upstream error body. URL не должен содержать credentials/query/path.

Команда создаёт отдельный `.local/live/<run>` с SQLite, evidence.json и exact HTML:
snake (может быть шаблоном в legacy, поэтому здесь обязательно code mode),
Signal Courier (зеркала, луч и запас энергии; отдельный сценарий), затем запрос
изменения snake с пяти до восьми яблок. Все промпты сохраняются в evidence/spec.
Это запланированные сценарии; ни один из них пока не получен от настоящей LLM.
Статус generated_unverified означает только генерацию/хранение/hash, не playability.
При отказе status=blocked, код процесса 1, частичные версии сохраняются честно.

Для дальнейшей демонстрации: открыть run database существующим сервером через
YAPLIX_DB, получить version/session через API, подключить mountGame в UI jeanhayl,
испытать Start/управление/победу/поражение на пяти Playwright-профилях. У каждой
реальной игры проверить её конкретные элементы и механику, не переиспользовать
selectors авторской fixture без проверки. Скачать export; открыть файл в
изолированном browser context с offline=true до загрузки, проверить тот же цикл,
Canvas при 320/390 px, ошибки JS и запросы сети. Сверить SHA скачанного файла.
Физический Android проверять отдельно при наличии устройства.

Если артефакт отправляет bridge events, записывать только пришедшие события,
проверить analytics и сравнение linked version с baselineVersionId. При отсутствии
bridge оставить telemetry not_observed. Нулевые/null агрегаты не заменять
синтетическими событиями. Реальную итерацию оценить по изменению поведения.
До этого validationStatus остаётся unverified; автоматического присвоения passed нет.

13 октября 2026: merge PR #5/main 3b5815d подтверждён, BGen SHA419c649 unchanged.
HTTPS root/health 200, capabilities 404; demo:live сохранил blocked /
BGEN_LIVE_CONTRACT_REQUIRED с 0 версий в локальном evidence. Первый сетевой запуск
также отказал; никакой отказ не переключился на mock. Не отправлено ни одного
generation/iterate POST. Блокеры SKZHPRVT: code mode/provenance/model, TLS и
previousCode; jeanhayl: интегрированного UI в main пока нет. CI подтверждает
synthetic интеграцию, а не live LLM.

Ошибки адаптера: BGEN_AUTH, BGEN_RATE_LIMIT, BGEN_HTTP, BGEN_TIMEOUT,
BGEN_NETWORK, BGEN_INVALID_JSON/RESPONSE/PROVENANCE/ARTIFACT, BGEN_PROVENANCE_REQUIRED,
BGEN_PROVENANCE_CONFLICT; BODY_TOO_LARGE для размеров.
Строгий режим дополнительно: BGEN_LIVE_CONTRACT_REQUIRED, BGEN_UNSAFE_CAPABILITIES,
BGEN_AUDITED_REVISION_UNSAFE, BGEN_CAPABILITIES_HTTP/INVALID, BGEN_CODE_REQUIRED,
BGEN_GENERATION_FAILED, BGEN_ITERATION_UNSUPPORTED/UNCONFIRMED;
INSECURE_TLS_CONFIGURATION и INVALID_REQUIRED_METHOD для входной политики.
API ошибки имеют `{error:code}`, без upstream body/секретов; неверные входы 400,
лимиты 413/507, неизвестные сущности 404, конфликт событий 409, токен 401.

## Доказательные границы TASK-002

Локально: Node 24.18.0, SQLite 3.53.1, 19 Python tests, TypeScript typecheck,
25 platform/adapter tests, 15 Playwright tests. Адаптер проверен изолированным
HTTP-сервером; его llm_code metadata синтетические, не результат платной LLM.
В каждом browser-профиле проверены offline win/loss, SQLite event forwarding и
отрицательные sandbox/CSP/bridge сценарии. Windows проверяет directory junction,
Linux CI дополнительно dangling file symlink. Реальные BGen/LLM/WebView,
физические устройства и демонстрационный Ubuntu ноутбук — NOT VERIFIED.
Hosted CI оценивается по конкретному последнему SHA PR, не по этим локальным тестам.

TASK-003 локально: 19 Python tests, typecheck, 40 unit/integration tests,
20 Playwright tests в тех же пяти профилях — PASS. Regression runner использует
синтетический HTTP BGen и сохраняет две игры + linked version, затем проверяет
SQLite/export и отсутствие придуманных сессий. Проверены также redacted URL
configuration errors и отказ до POST при unsafe TLS/неподдерживаемой итерации.
На Windows sandbox ограничил завершение первого test server; повторный запуск
с правами на остановку своих дочерних процессов завершился exit 0, 20 passed.
Реальный endpoint проверен только HTTPS GET/preflight; live LLM, реальные игровые
события/итерация и Android остаются NOT VERIFIED. Минимум готовности TASK-003
не выполнен до исправления BGen и испытания настоящих артефактов.

## TASK-004: локальный LIVE и обслуживание

Единый UI открыт на `/`; build отдаёт `/runtime/ui.js`. DEMO всегда явно
маркирован mock, provider=yaplix-authored-demo, model=null. Для LIVE установите
Ollama/модель и pinned BGen по README; LIVE_PROVIDER=ollama выбирает только эту
модель. POST /api/chat с stream=false возвращает полный ответ; проверяются done,
model, размер, HTML и запрет внешних scripts/network. BGen compiler получает
prompt/audience, полный GameSpec как требования и previousCode/previousPrompt
в CompileOptions. При ошибке версия не сохраняется; шаблонной подмены нет.

Встроенный backup использует SQLite online backup API, проверяет копию read-only
по integrity_check, foreign_key_check, user_version=1 и каноническим SQL-определениям
таблиц, ограничений и индексов, вычисляет SHA-256. Это
согласованная копия даже при WAL; копирование только активного .sqlite не заменяет
backup. Максимум 20 файлов backup-UUID.sqlite; имена принадлежат операции,
существующие файлы не перезаписываются. Копия не сохраняет .env или модели.

### Восстановление

1. Остановите backend Ctrl+C, проверьте, что других YAPLIX процессов нет.
2. `npm run verify:backup -- .local/backups/backup-UUID.sqlite <сохранённый SHA-256>`.
   Команда ничего не записывает в копию; при несовпадении hash/схемы остановитесь.
3. Сохраните текущее состояние: `npm run backup` (если база исправна), затем
   переместите **целую** `.local/data` вместе с WAL/SHM в новую, ещё не существующую
   `.local/recovery-<дата-время>`. Проверьте пути внутри клона. Не удаляйте оригинал.
   Для нестандартного YAPLIX_DB переместите его отдельный каталог по тому же правилу.
4. Создайте пустую `.local/data`, скопируйте проверенный backup как
   `.local/data/yaplix.sqlite`. Старые WAL/SHM к новой базе не переносите.
5. `npm run doctor`, `npm start`; откройте сохранённую игру, историю и экспорт.
   При ошибке остановите backend, сохраните неудачную копию отдельным именем и
   верните целый recovery-каталог. Автоматического restore через UI пока нет.

Используйте native PowerShell Move-Item/Copy-Item/New-Item на Windows и mv/cp/mkdir
на Ubuntu, только после проверки новых целевых имён; не смешивайте shells и
не выполняйте recursive delete. Синтетический readback backup и restart проверяются
тестами; реальные повреждённые пользовательские базы в этой задаче не восстанавливались.

### Обновление без потери данных

Остановите процесс и сделайте/проверьте backup. В чистом клоне на main:

```sh
git pull --ff-only origin main
npm ci
npm run bgen:install
npm run build
npm run doctor
npm start
```

Если есть локальные изменения или ff-only не проходит, остановитесь и сохраните
их в своей ветке; не применяйте reset/clean/force. `.local` и `.env` не заменяются
Git/npm. После обновления проверьте предыдущую игру, версии, запуск и экспорт.
Модель установлена отдельно и не удаляется обновлением приложения.
