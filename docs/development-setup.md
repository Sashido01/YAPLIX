# Рабочее место, API и обслуживание

Git, Node 24.18+ (24.x), npm; для разработки Python 3.11+. Установка — [README](../README.md).
Команды из корня клона, секреты/данные/браузеры/инструменты только локально.
Пользовательский запуск: Windows `YAPLIX.cmd` двойным щелчком, Windows/Ubuntu
`npm run app`. Launcher собирает клиент и открывает каталог; первый `npm ci`
выполняется автоматически только при отсутствии node_modules. Неполный existing
node_modules сохраняется, дальнейшее исправление явное. Ручной server: build/start.

## Разработка и CI

```sh
git config --local core.autocrlf false
git config --local core.hooksPath .githooks
npm ci
npm run browsers:install
npm run check
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
git diff --check
```

Ubuntu: python3; при недостающих OS libraries:
`node scripts/browser-tests.mjs install --with-deps chromium webkit firefox`.
Production LIVE достаточно checker:install, DEMO не нужен Chromium.
Ubuntu 23.10+ ограничивает user namespaces. Checker сохраняет Chromium sandbox:
при наличии использует root-owned setuid helper `/opt/google/chrome/chrome-sandbox`
из установленного Google Chrome. CI проверяет helper по реестру установленного
пакета, затем выставляет root:root/4755 для существующего бинарного файла;
AppArmor и sandbox остаются включёнными. Checker запускает полный project-local
Chromium в headless mode. Для другого
проверенного системного helper задайте `CHROME_DEVEL_SANDBOX`; owner должен быть
root, setuid включён, запись группе/остальным запрещена. Если helper отсутствует,
нужна поддержка sandbox со стороны ОС; LIVE безопасно отказывает. Не отключайте
AppArmor или Chromium sandbox. [Документация Chromium](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
Hook mode 100755 блокирует remote main; не заменяет server protection. Checker
проверяет tracked files, UTF-8/LF/регистр ссылок. Gitleaks 8.24.3:
`gitleaks git --redact --log-opts=--all .`, `gitleaks dir --redact .`.
Сначала checksum инструмента; binary/reports/secrets не коммитить.
Hosted FAST: npm ci/cache, Python и policy tests, types/build, все Ubuntu units
и Windows contracts/SQLite smoke. FULL по риску/вручную добавляет все Windows
units, реальный server-side Chromium checker, 12 frontend-профилей, performance.
LLM transport синтетический, реальный inference отдельно. Actions SHA pinned,
обязательны green exact PR head, merge и smoke main. Перед релизом manual FULL;
post-merge smoke локальный. [FAST/FULL](ci-economy.md),
[workflow](../CONTRIBUTING.md).

## Конфигурация

.env.example безопасен; process variables имеют приоритет над .env.

| Параметр | Значение / ограничение |
| --- | --- |
| PORT / YAPLIX_DB | 3000 / .local/data/yaplix.sqlite, только .local |
| LIVE_PROVIDER | cloud default; ollama-cloud/ollama/none; no OpenRouter key отключает только LIVE |
| CLOUD_BASE_URL / MODEL / API_KEY | exact base / concrete model ID / secret; default model google/gemma-4-31b-it:free |
| LLM_TIMEOUT_MS | 1000..300000, default 180000, один запуск engine |
| LLM_REQUEST_TIMEOUT_MS | 1000..LLM_TIMEOUT_MS, default min(60000, LLM_TIMEOUT_MS), один transport request |
| LLM_MAX_ATTEMPTS | 1..12, default 6, provider-call budget автоматического цикла; lifetime ≤12/job |
| LLM_MAX_DURATION_MS | 1000..1800000, default 600000, durable deadline цикла включая ожидание |
| LLM_RETRY_MS | 10..60000, default 2000, exponential backoff с cap 60000 |
| LLM_MAX_TOKENS | 256..32000, default 12000; доступный completion cap из models API может снизить бюджет |
| LLM_TOKEN_FIELD | max_tokens default или max_completion_tokens |
| LLM_TEMPERATURE | optional 0..2, иначе не отправляется |
| LLM_REPAIRS | 0..2, default 1 |
| LLM_PROMPT_STYLE | spec code default; direct явно передаёт естественный запрос; .env.example выбирает direct |
| LLM_FALLBACK | none default; explicit secondary/ollama-cloud/openrouter/ollama |
| OLLAMA_CLOUD_API_KEY / MODEL | оба обязательны для Ollama Cloud; fixed https://ollama.com/v1; exact ID из API |
| LLM_LOCAL_FALLBACK | 1 добавляет необязательный local route после явно настроенного cloud |
| SECONDARY_BASE_URL / MODEL / API_KEY | все три при secondary |
| OLLAMA_BASE_URL / MODEL | loopback 11434 / qwen2.5-coder:14b default |
| YAPLIX_MODE / HOST / PUBLIC_URL | local loopback; explicit LAN/HTTPS |
| YAPLIX_ACCESS_KEY | random URL-safe 32..128 chars, shared team access |
| TELEGRAM_BOT_TOKEN / ALLOWED_USER_IDS | server token / один положительный ID владельца для публичного HTTPS |
| TELEGRAM_AUTH_MAX_AGE | 30..900 s, default 300; session TTL 1 h |
| TELEGRAM_UPDATES | token + single owner включают одного poller; off явно отключает |

OpenRouter exact base https://openrouter.ai/api/v1, default model
**google/gemma-4-31b-it:free**; разрешены concrete `:free` IDs из models API с явно
нулевыми pricing.prompt и pricing.completion. Проверка выполняется до каждого
provider dispatch, включая legacy synchronous API; отсутствие модели/нулевой цены
блокирует вызов. `openrouter/free` сохраняет совместимость, не default selection.
Платные OpenRouter модели запрещены. [Официальный каталог и pricing](https://openrouter.ai/docs/api/api-reference/models/get-model).
Ollama Cloud включается явно как secondary
или primary; generic nonfree secondary для OpenRouter primary блокируется.
Для прямого Ollama Cloud используйте ID из [официального API](https://ollama.com/api/tags)
и [документации](https://docs.ollama.com/cloud), server проверяет models API.
Альтернативный provider/Gateway21t требует
официально известные base/model, не угадываются. TLS bypass, credentials/query в
base запрещены. Readiness GET models не доказывает successful inference.

При создании cloud-задания запрашивается SSE stream с usage; Local Ollama job
использует native NDJSON stream. Checkpoint записывается
порциями (около 4 KB или 750 ms при поступлении данных), плюс при завершении/обрыве;
данные usage могут отсутствовать у конкретного провайдера. Полученный completion
cap уменьшает запрошенный output budget; меньше 2048 tokens для задания даёт
`LLM_OUTPUT_BUDGET_TOO_SMALL`. Reasoning usage сохраняется отдельно, если возвращён.
Local job сохраняет output tokens из eval_count, если получен; legacy synchronous
API получает полный ответ без streaming checkpoints.

`npm run benchmark:generation` — один ordinary prompt, один provider dispatch,
repair/fallback отключены, generation deadline 60 s. Benchmark не использует
пользовательскую SQLite: создаёт `.local/benchmarks/UUID/data.sqlite`, evidence.json
с provider/requested/actual model, request/validation/fullJob time, available tokens
и ошибки. Exact game.html создаётся только при успехе gate; полный gameplay не
проверяется автоматически. GameSpec формируется локально без отдельного LLM вызова.
Это ограниченный pilot, не массовый сравнительный benchmark моделей.

## API

POST JSON, same-origin. LAN key/cookie; HTTPS также валидный Telegram cookie или
X-Yaplix-Telegram-Session. Events дополнительно session bearer. Origin null запрещён.

| Операция | Контракт |
| --- | --- |
| GET /api/health | integrity/FK/schema |
| GET /api/diagnostics | безопасные readiness/model/browser параметры |
| POST /api/access | `{key}` → HttpOnly cookie |
| POST /api/telegram/auth | `{initData}` → Secure cookie + memory sessionToken |
| GET /api/jobs | последние 50 заданий своего principal, без raw checkpoint |
| GET /api/gallery | две авторские игры, без автоматической записи в library |
| POST /api/gallery/:id | `{}` → сохранённая authored/unverified version по явному действию |
| POST /api/jobs | `{spec,mode?,previousVersionId?,idempotencyKey,telegramConsent?}` → job summary 202 |
| GET /api/jobs/:jobId | своё задание, исходный запрос/checkpoint/metadata |
| POST /api/jobs/:jobId/cancel | `{}` → cancelled; запрос/черновик остаются |
| POST /api/jobs/:jobId/continue | `{}` → queued для needs_attention/failed/cancelled; Retry-After и attempt cap |
| POST /api/jobs/:jobId/notification | `{}` → `{claimed}`; at-most-once claim toast |
| GET /api/games | latest metadata 50 игр, title из первого prompt |
| POST /api/games | `{spec,mode:demo/live,requiredMethod?}` → GameVersion 201 |
| GET /api/games/:gameId | история metadata без HTML |
| POST /api/games/:gameId/versions | `{spec,previousVersionId,mode,requiredMethod?}` → linked version |
| GET /api/versions/:versionId | GameVersion с HTML |
| GET /api/versions/:versionId/export | exact HTML attachment, X-Content-SHA256 |
| POST /api/versions/:versionId/share | `{}` → HTTPS URL 7 дней |
| GET /play/:versionId/:expires/:signature | readonly HTML, cap не авторизует API |
| POST /api/versions/:versionId/sessions | `{}` → IDs/token/expiresAt/protocolVersion |
| POST /api/sessions/:sessionId/events | GameEvent + session bearer, duplicate boolean |
| GET /api/versions/:versionId/analytics | aggregates; baselineVersionId для comparison |
| POST /api/backups | `{}` → filename/hash/schema verified backup |
| GET /api/connection/qr.svg | LAN/HTTPS authorization, только адрес без ключей |

Strict types — [contracts.ts](../src/contracts.ts). prompt 2..500 chars; audience
(default/kids/elderly/hardcore); arbitrary genre/mechanics, controls keyboard/touch/
pointer, responsive/webview boolean. Imported artifact только mock/unverified,
клиент не может выставить llm_code/passed. requiredMethod только llm_code, без import.
LIVE success actual provider/model/succeeded/passed + generation attempts/browser
scope. Failed generation не создаёт version. `{error:CODE}` и sanitized attempts:
LLM_AUTH/RATE_LIMIT/HTTP/TIMEOUT/BUSY/INVALID_RESPONSE/INVALID_HTML/UNSAFE_ARTIFACT,
BROWSER_*; own RATE_LIMIT 429. Parent хранит session token, игра получает только IDs
в yaplix_init v1. HTTP retries сохраняют eventId/sequence. Unmount закрывает realm.

Frontend использует jobs API; синхронные games/versions POST остаются совместимыми.
Job idempotencyKey — 8..100 букв/цифр/`_`/`-`, уникален внутри principal; повтор
идентичного request возвращает job, другой request с тем же key даёт conflict.
Telegram consent принимается только с signed Telegram session. Один worker,
pending ≤20 глобально/≤3 на владельца, total ≤1000 jobs, checkpoints ≤100 MB
суммарно/≤200000 bytes на job. Default автоматический цикл — до 6 provider calls,
до 4 запусков worker и 600 s суммарно с ожиданием; lifetime limit 12 calls/job.
`Continue` открывает новый ограниченный цикл, не обнуляет lifetime attempts.
При настроенном generator LIVE creation rate 6/min owner, 12/min global.
Отдельный лимит фактических вызовов генерации к провайдерам — 6/min owner и 12/min
global, включая repair и Continue. Recoverable ошибки получают bounded retry/fallback,
а rate limit — Retry-After. Cooldown и scheduled retry хранятся в job metadata;
неизвестный потенциально оплаченный исход не повторяется слепо по тому же route.
Действия — [known errors](known-errors.md).

Restart восстанавливает generating/validating/repairing в пределах исходных
deadline/бюджета, сохраняя `JOB_RESTART_UNCERTAIN`. Доступный разрешённый route
может продолжить автоматически; неизвестный potentially billed route исключается.
Старые recoverable needs_attention jobs без automatic metadata принимаются один
раз в новый ограниченный цикл с lifetime cap 12. Cancelled/quota/auth/configuration
отказы автоматически не возобновляются; сохранённый draft остаётся доступен.
Полный checkpoint с подтверждённым origin сначала проходит validation без нового
LLM POST. Остальные drafts переписываются в полный документ по original spec;
буквальное resume с токена не обещается. Дополнительные recoveryState:
retry_scheduled / waiting_for_provider / failed_permanent при прежней schema v2.
Static/browser gate обязателен;
playable version и completed job записываются одной SQLite transaction. Черновик
не может получить passed сам по себе. Готовность не меняет активный iframe;
переключение игры происходит по явному «Открыть»/«Играть».

Quota/auth/model/context/output-budget отказ охлаждает route на 15 min, не покупает
credits и позволяет другой явно настроенный route. При `429` cooldown соответствует
Retry-After (если отсутствует — 60 s). Исчерпание automatic calls/runs/duration,
отсутствие всех routes или обязательного Chromium оставляют needs_attention.
Авторская gallery никогда не участвует в LIVE recovery; authored/unverified
отличается от mock DEMO и от llm_code/passed. GET catalogue не заселяет user DB.

Внутренний URL `/?game=UUID&version=UUID` (Telegram `/telegram?...`) требует обычную
авторизацию; version должна принадлежать game. Это адресация общей owner-library,
а не multi-tenant ACL и не подписанный Share. Quick Tunnel hostname временный.

## Backup, восстановление, обновление

npm run backup: согласованная SQLite online copy даже при WAL, integrity/FK/schema
v2/SHA-256, до 20 обычных backup-файлов, без перезаписи. .env/модель не входят в backup.
Это backup game DB, включая jobs; отдельный per-bot consumer/offset state из
`.local/telegram` и локальные control/access keys в него не входят. Не удаляйте
эти существующие файлы при update и не подменяйте unknown state пустым.
`verify:backup` читает проверенные схемы v1 и v2, сообщает фактическую версию.

Новая пустая база создаётся сразу с schema v2, без before-v2 snapshot.
Первый запуск нового backend на исправной существующей v1 добавляет generation_jobs,
generation_worker и индексы в transaction, затем выставляет user_version=2. До миграции файловой базы
создаётся уникальный `.local/backups/before-v2-UUID.sqlite` через VACUUM INTO;
копия read-only проверяется по integrity/FK/точной v1 schema. Неизвестная/неисправная
схема блокирует переход. В memory DB snapshot не создаётся. Старые games/versions/
sessions/events и HTML не переписываются. Protective snapshots не удаляются
автоматически и не входят в предел обычных backup-UUID файлов.

У before-v2 snapshot нет автоматически сохранённого SHA-256 sidecar: для ручного
использования зафиксируйте его hash и выполните verify:backup; не угадывайте hash
и не удаляйте неизвестные `.local` recovery-файлы. Ранее созданные v1 backup допустимы
для восстановления на новой версии, которая снова выполнит защищённую миграцию.
Откат к старому v1 runtime не читает v2; восстановление before-v2 теряет более новые
jobs/изменения после snapshot. Сначала сохраните текущую базу целиком отдельно.

После успешного bind сервер получает exclusive DB worker lease; второй backend
с той же базой блокируется (`JOB_WORKER_BUSY`), даже при другом порте. Graceful stop
снимает lease. Если после crash проверка PID (`signal 0`, без завершения процесса)
подтверждает отсутствие прежнего worker, новый запуск может забрать lease сразу.
Живой или непроверяемый PID сохраняет действующий lease до 60 s: дождитесь expiry,
не удаляйте lease вручную и не убивайте чужой PID.

1. Остановите свой backend Ctrl+C, проверьте отсутствие других YAPLIX writers.
2. `npm run verify:backup -- .local/backups/backup-UUID.sqlite SHA256` read-only;
   hash/schema mismatch означает остановку.
3. Если база исправна, защитный backup. Переместите целый каталог своей базы вместе
   с WAL/SHM в новый `.local/recovery-DATE`, проверив пути внутри клона. Не удаляйте
   оригинал и не перезаписывайте existing recovery.
4. Пустой каталог базы: скопируйте verified backup под настроенное имя, без old WAL/SHM.
5. doctor/app, game/history/export/jobs. При ошибке остановите backend, сохраните
   неудачную копию и верните целый recovery-каталог. UI auto-restore пока нет.

Windows native Move-Item/Copy-Item/New-Item с LiteralPath; Ubuntu mv/cp/mkdir.
Обновление после остановки и backup, в чистой main:

```sh
git pull --ff-only origin main
npm ci
npm run checker:install
npm run build
npm run doctor
npm run app
```

Git/npm не заменяют .local/.env. Dirty/ff-only failure: сохраните свою ветку,
без reset/clean/force. Проверьте прежние game/history/export hashes и задания.
TASK-009 переводит schema v1 → v2 с protective snapshot; сохранность конкретной
пользовательской базы проверяйте отдельно. LAN/QR — README, [HTTPS/Telegram](telegram.md).
TASK-010 не добавляет schema migration: recovery budget/cooldown metadata помещаются
в существующий JSON jobs. Старые HTML и validationStatus не переписываются.
PORT_IN_USE — свой активный server или чужой процесс; остановите только свой либо
смените порт. Doctor проверяет новый bind: активный server может давать PORT_IN_USE.
После изменения .env перезапустите backend, build не перезагружает его.
Launcher проверяет не только HMAC/schema, но и build identity загруженного backend,
зафиксированную при старте. После update штатно закройте свой старый backend,
затем запустите YAPLIX.cmd/app заново; same-schema старый процесс сохраняется,
вместо ошибочного attach выводится занятый порт/необходимость restart.

## Надёжный временный Telegram runtime

После `npm run build` и `npm run tunnel:install`: `npm run tunnel -- --menu`.
Совместимый `npm start` из этого же клона можно оставить работающим. Launcher
проверяет HTTP ready и HMAC challenge; чужой/старый сервер не останавливает.
Свободный порт: запускает backend сам, ждёт readiness и управляет только им.
После обновления/.env изменений перезапустите backend, чтобы он загрузил новый код.

Публичный `/healthz` не содержит конфигурацию; identity/ready проверяется через
реальный HTTPS до menu button. Private `/api/runtime/tunnel` работает только на
loopback с локальным control key для изменений; ключ не передаётся connector.
Публичный HTTP и forwarded headers не могут управлять runtime. Telegram HTTPS
требует единственного владельца, пока общая библиотека не имеет ownership.

Ctrl+C сохраняет existing backend, закрывает свой backend и connector. После аварии
публичный lease закрывается за 20 s; перезапустите свой backend, затем tunnel.
URL-файл отражает только подтверждённую текущую сессию. Telegram reset требует сети;
его отказ явно печатается. Публичного состояния «подключено» после shutdown нет.

Журнал `.local/logs/tunnel.log` ограничен и фильтруется до записи. Ошибки процесса
показывают exit code/signal/stderr. URL timeout 60 s, внешний health 45 s.
`--protocol auto|http2|quic`, влияние DNS/VPN/proxy/Windows Firewall, Android и
безопасный публичный сценарий описаны в [Telegram](telegram.md).
