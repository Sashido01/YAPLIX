# Рабочее место, API и обслуживание

Git, Node 24.18+ (24.x), npm; для разработки Python 3.11+. Установка — [README](../README.md).
Команды из корня клона, секреты/данные/браузеры/инструменты только локально.

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
из установленного Google Chrome (включая Ubuntu GitHub runner). Для другого
проверенного системного helper задайте `CHROME_DEVEL_SANDBOX`; owner должен быть
root, setuid включён, запись группе/остальным запрещена. Если helper отсутствует,
нужна поддержка sandbox со стороны ОС; LIVE безопасно отказывает. Не отключайте
AppArmor или Chromium sandbox. [Документация Chromium](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
Hook mode 100755 блокирует remote main; не заменяет server protection. Checker
проверяет tracked files, UTF-8/LF/регистр ссылок. Gitleaks 8.24.3:
`gitleaks git --redact --log-opts=--all .`, `gitleaks dir --redact .`.
Сначала checksum инструмента; binary/reports/secrets не коммитить.
Hosted Windows/Ubuntu: npm ci, Python tests, types/integration, реальный server-side
Chromium checker, 12 frontend-профилей, performance. LLM transport синтетический,
реальный inference отдельно. Actions SHA pinned, обязательны green exact PR head,
merge и smoke main. [Workflow](../CONTRIBUTING.md).

## Конфигурация

.env.example безопасен; process variables имеют приоритет над .env.

| Параметр | Значение / ограничение |
| --- | --- |
| PORT / YAPLIX_DB | 3000 / .local/data/yaplix.sqlite, только .local |
| LIVE_PROVIDER | cloud default; ollama/none; no key отключает только LIVE |
| CLOUD_BASE_URL / MODEL / API_KEY | exact OpenAI-compatible base / model ID / secret |
| LLM_TIMEOUT_MS | 1000..300000, default 180000, общий deadline |
| LLM_MAX_TOKENS | 256..32000, default 12000 |
| LLM_TOKEN_FIELD | max_tokens default или max_completion_tokens |
| LLM_TEMPERATURE | optional 0..2, иначе не отправляется |
| LLM_REPAIRS | 0..2, default 1 |
| LLM_FALLBACK | none default; explicit secondary/ollama |
| SECONDARY_BASE_URL / MODEL / API_KEY | все три при secondary |
| OLLAMA_BASE_URL / MODEL | loopback 11434 / qwen2.5-coder:14b default |
| YAPLIX_MODE / HOST / PUBLIC_URL | local loopback; explicit LAN/HTTPS |
| YAPLIX_ACCESS_KEY | random URL-safe 32..128 chars, shared team access |
| TELEGRAM_BOT_TOKEN / ALLOWED_USER_IDS | server token / числовые ID через запятую |
| TELEGRAM_AUTH_MAX_AGE | 30..900 s, default 300; session TTL 1 h |

OpenRouter exact base https://openrouter.ai/api/v1, model **openrouter/free**;
primary запрещает paid secondary. Альтернативный provider/Gateway21t требует
официально известные base/model, не угадываются. TLS bypass, credentials/query в
base запрещены. Readiness GET models не доказывает successful inference.

## API

POST JSON, same-origin. LAN key/cookie; HTTPS также валидный Telegram cookie или
X-Yaplix-Telegram-Session. Events дополнительно session bearer. Origin null запрещён.

| Операция | Контракт |
| --- | --- |
| GET /api/health | integrity/FK/schema |
| GET /api/diagnostics | безопасные readiness/model/browser параметры |
| POST /api/access | `{key}` → HttpOnly cookie |
| POST /api/telegram/auth | `{initData}` → Secure cookie + memory sessionToken |
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
| GET /api/connection/qr.svg | LAN cookie, только адрес/порт |

Strict types — [contracts.ts](../src/contracts.ts). prompt 2..500 chars; audience
(default/kids/elderly/hardcore); arbitrary genre/mechanics, controls keyboard/touch/
pointer, responsive/webview boolean. Imported artifact только mock/unverified,
клиент не может выставить llm_code/passed. requiredMethod только llm_code, без import.
LIVE success actual provider/model/succeeded/passed + generation attempts/browser
scope. Failed generation не создаёт version. `{error:CODE}` и sanitized attempts:
LLM_AUTH/RATE_LIMIT/HTTP/TIMEOUT/BUSY/INVALID_RESPONSE/INVALID_HTML/UNSAFE_ARTIFACT,
BROWSER_*; own RATE_LIMIT 429. Parent хранит session token, игра получает только IDs
в yaplix_init v1. HTTP retries сохраняют eventId/sequence. Unmount закрывает realm.

## Backup, восстановление, обновление

npm run backup: согласованная SQLite online copy даже при WAL, integrity/FK/schema
v1/SHA-256, до 20 файлов, без перезаписи. .env/модель не входят в backup.

1. Остановите свой backend Ctrl+C, проверьте отсутствие других YAPLIX writers.
2. `npm run verify:backup -- .local/backups/backup-UUID.sqlite SHA256` read-only;
   hash/schema mismatch означает остановку.
3. Если база исправна, защитный backup. Переместите целый каталог своей базы вместе
   с WAL/SHM в новый `.local/recovery-DATE`, проверив пути внутри клона. Не удаляйте
   оригинал и не перезаписывайте existing recovery.
4. Пустой каталог базы: скопируйте verified backup под настроенное имя, без old WAL/SHM.
5. doctor/start, game/history/export. При ошибке остановите backend, сохраните
   неудачную копию и верните целый recovery-каталог. UI auto-restore пока нет.

Windows native Move-Item/Copy-Item/New-Item с LiteralPath; Ubuntu mv/cp/mkdir.
Обновление после остановки и backup, в чистой main:

```sh
git pull --ff-only origin main
npm ci
npm run checker:install
npm run build
npm run doctor
npm start
```

Git/npm не заменяют .local/.env. Dirty/ff-only failure: сохраните свою ветку,
без reset/clean/force. Проверьте прежнюю игру/history/export hash. TASK-007 schema
v1 не меняет, old HTML/metadata сохраняются. LAN/QR — README, [HTTPS/Telegram](telegram.md).
PORT_IN_USE — свой активный server или чужой процесс; остановите только свой либо
смените порт. Doctor проверяет новый bind: активный server может давать PORT_IN_USE.
После изменения .env перезапустите backend, build не перезагружает его.
