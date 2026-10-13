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
Приложение читает настройки из окружения процесса, а не автоматически из `.env`.
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
25 platform/adapter integration tests и 15 browser tests (пять профилей).
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
пока отсутствуют — это локальная foundation.

| Операция | Контракт |
| --- | --- |
| GET /api/health | ok по integrity/FK, schemaVersion |
| POST /api/games | `{spec, artifact?}`; без artifact вызывает BGen generate; ответ GameVersion, 201 |
| GET /api/games/:gameId | gameId и история метаданных versions без HTML |
| POST /api/games/:gameId/versions | `{spec, previousVersionId, artifact?}`; BGen iterate или mock import; 201 |
| GET /api/versions/:versionId | полная GameVersion с HTML |
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
через серверный BGen Adapter с явным provenance. Клиент не может сертифицировать
свою игру как passed или переименовать fixture в LLM.

UI получает версию и сессию, вызывает `mountGame(container, html, {sessionId,
versionId}, onEvent)` и держит token у родителя. onEvent ставит события в
последовательную очередь HTTP; повторяет **тот же** eventId/sequence при сетевой
ошибке. При пропущенном событии сначала повторить его; не пересоздавать ID.
unmount удаляет frame/listener. Срок токена 1 час; для следующего запуска новая
сессия. Во время offline телеметрия может отсутствовать; gameplay должен работать.

После загрузки bridge посылает `yaplix_init` с protocolVersion=1 и IDs, без token.
Игра отправляет `{channel:'yaplix', event:GameEvent}` через parent.postMessage;
при отсутствии родителя просто пропускает отправку. Минимальный пример —
[авторская fixture](../tests/fixtures/game.html). Это новый YAPLIX протокол,
его внедрение в BGen ещё требуется; текущий BGen telemetry не считается игровым.

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
    "model": null
  }
}
```

method всегда один из llm_code/template_config/mock/fallback, соответствует
реальному пути. Для cache сохранить **исходное** provenance с артефактом;
для engine/default честно template_config/fallback, для Mock всегда mock.
model/provider null, если неизвестны. ok сообщает итог генерации/анализатора,
не результат браузерного испытания. Этот контракт ещё не принят BGen.

Отдельно нужны: явный code-generation путь для обязательного условия кейса,
передача previousCode в CompileOptions при iterate, отказ от скрытого Mock,
GigaChat TLS с проверяемым CA вместо rejectUnauthorized=false, опциональный
YAPLIX event bridge с автономным fallback. Эти изменения выполняет владелец BGen.
Замечания переданы здесь как предложение к командному review; внешних сообщений
участнику эта задача не отправляет.

Ошибки адаптера: BGEN_AUTH, BGEN_RATE_LIMIT, BGEN_HTTP, BGEN_TIMEOUT,
BGEN_NETWORK, BGEN_INVALID_JSON/RESPONSE/PROVENANCE/ARTIFACT, BGEN_PROVENANCE_REQUIRED,
BGEN_PROVENANCE_CONFLICT; BODY_TOO_LARGE для размеров.
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
