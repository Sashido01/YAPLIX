# YAPLIX — ты придумал, теперь играй

## Запуск за 60 секунд

Нужны установленный Node **24.18+ (24.x)** с npm и папка клона YAPLIX.
На Windows откройте **YAPLIX.cmd двойным щелчком**. На Ubuntu 24.04 из папки
проекта выполните **`npm run app`**. Launcher устанавливает зависимости при первом
запуске, собирает клиент, проверяет backend и открывает браузер. Первое скачивание
зависит от сети: название раздела не обещает установку за 60 секунд на любой машине.

Откроется каталог **«Игры»**. Выберите игру → «Играть» → «Старт». Пустой каталог:
«Создать» → режим **DEMO** → «Создать игру»; после готовности нажмите **«Открыть»**
в уведомлении или «Играть» в центре **«Задания»**. DEMO работает без ключей,
облака, Ollama и Chromium. Телефону нужны только доступная ссылка и браузер.
В каталоге также есть авторский офлайн-резерв: «Искры в клетках» и «Световой
лабиринт». Кнопка игры явно сохраняет её в библиотеку как authored/unverified;
это собственные примеры, не результат LIVE и не замена неудачной генерации.

Обычно адрес http://127.0.0.1:3000/. Если браузер не открылся, откройте напечатанный
адрес вручную; `npm run app -- --no-open` запускает без открытия окна. Повторный
запуск **YAPLIX.cmd** при уже работающем собственном backend проходит автоматически:
launcher проверяет HMAC-подписанный identity этого клона, штатно останавливает его
аутентифицированным локальным `POST /api/runtime/shutdown` (только loopback, ключ
клона; через LAN/туннель/HTTPS недоступен), backend закрывает Generation Jobs,
Telegram polling и SQLite, освобождает порт, и запускается новый backend; сохранённые
версии и история игр не сбрасываются. Чужой или устаревший процесс (включая другой каталог)
launcher сохраняет и сообщает `PORT_IN_USE`. Ctrl+C в окне собственного launcher
останавливает его backend; при подключении к существующему процессу тот остаётся.
После обновления кода или `.env` повторный запуск делает тот же штатный swap
backend'а. Совпадение schema недостаточно: launcher проверяет identity загруженного
кода и не подключается к устаревшей версии.

Один воспроизводимый репозиторий: мобильный frontend, Node backend, собственный
LLM-конвейер, библиотека игр/версий, аналитика, экспорт, LAN/QR и Telegram Mini App.
DEMO — авторский лабиринт с ходами, стенами, победой и поражением. LIVE создаёт
HTML/JS по описанию через модель, без готового каталога и скрытой подмены DEMO.

## Чистый клон и ручной запуск

Git, Node **24.18+ (24.x)**, npm. Для разработки также Python 3.11+.
Windows PowerShell, чистый клон:

```powershell
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
npm ci
npm run app
```

Ubuntu 24.04:

```sh
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
npm ci
npm run app
```

Откройте напечатанный адрес, обычно http://127.0.0.1:3000/.
Frontend/backend запускаются одним процессом. DEMO работает без ключей, Ollama,
cloud и Chromium. Ручная альтернатива: `npm run build`, затем `npm start`.
Секреты `.env` только на сервере. Для LIVE создайте `.env` из `.env.example`
(Windows `Copy-Item .env.example .env`, Ubuntu `cp .env.example .env`), только если
своего `.env` ещё нет. В существующем клоне не заменяйте его примером.

LIVE работает через Direct/маршрутизацию VPN или явно настроенный HTTP/HTTPS proxy
на backend. Проверка без генерации: `npm run network:check` (оба настроенных
provider: `npm run network:check -- --all`). [Правила Auto, TLS, proxy и ограничения](docs/llm-network.md).

## Полный сценарий

1. DEMO → «Создать игру» → задание → явное «Открыть» → «Старт». Клавиатура и touch-кнопки двигают героя.
   Соберите груз и дойдите до выхода; ловушка даёт поражение. «Заново» — новая сессия.
2. Библиотека хранит игры и версии. Новое требование → «Новая версия»; старая
   версия сохраняется и доступна для повторного запуска.
3. Аналитика показывает score, wins/losses и сравнение. Это наблюдения по клиентским
   событиям, а не причинное доказательство улучшения игры.
4. Скачанный HTML работает автономно без сервера/ключей. Перезапуск YAPLIX сохраняет
   SQLite/историю. Диагностика проверяет API/базу/модель; backup проверяет копию.

## Фоновая генерация и восстановление

«Создать игру» и «Новая версия» сохраняют задание на сервере. Можно продолжать
текущий раунд, играть в другую игру или закрыть вкладку: работа продолжается,
пока backend запущен. «Задания» показывает фактический этап, время, попытки и
полученную модель; процента выполнения нет. Готовая версия сохраняется в библиотеке.
Уведомление предлагает **«Открыть»**, а текущая игра автоматически не переключается.
После скрытия уведомления результат остаётся в заданиях и каталоге.

Повторная отправка того же сохранённого запроса с тем же idempotency key возвращает
одно задание. Состояние заданий, исходный текст и полученные checkpoints хранятся в
SQLite v2. После возврата страница получает состояние сервера. Recoverable timeout,
обрыв потока, обрезанный вывод и `429` автоматически получают допустимый retry,
проверку полного checkpoint или переход к другому разрешённому provider в Auto. Последние три неудачных
route/model и причины переходов видны в истории задания. В центре видны
«Автоматический повтор»/«Ожидание провайдера» и фактическая причина. После restart
сохраняются исходный deadline, cooldown и бюджет; неизвестный потенциально оплаченный
запрос не отправляется слепо ещё раз по тому же маршруту. «Продолжить генерацию»
остаётся для исчерпанного бюджета, недоступности всех маршрутов/конфигурации и отмены.
Восстановление использует исходный запрос и полезный черновик, повторяет проверки; это не обещание
возобновления с последнего токена. **«Скачать черновик»** сохраняет текст, который
ещё не считается безопасной или играбельной версией.

Retry-After соблюдается; квота/отказ ключа/model/context блокируют маршрут и позволяют
использовать другой разрешённый provider только в Auto. После перехода job не
возвращается к прежнему provider, в том числе после restart/Continue.
«Отменить задание» сохраняет запрос и черновик.
Один worker, очередь до 20 заданий и 3 на владельца. Default: до 4 provider calls
за автоматический цикл, до 4 запусков worker и общий deadline 300 s; один запрос
до 60 s. Ручное продолжение не снимает lifetime limit 12 calls на задание.
Точные настройки и действия — [известные ошибки](docs/known-errors.md).
Недоступность всех моделей может оставить черновик; она не подменяет LIVE на DEMO.

## Настоящая LIVE-генерация

Проверка MICRO-019 от 16.10.2026 остаётся **PARTIAL**: «три в ряд» не получила
HTML за четыре разрешённых inference POST из-за обрыва Ollama и таймаутов
OpenRouter. Полный gameplay не подтверждён. [Факты и продолжение](docs/SESSION_HANDOFF.md).

Серверный Chromium (телефону не нужен):

```sh
npm run checker:install
```

Ubuntu при отсутствии OS библиотек:
`node scripts/browser-tests.mjs install --with-deps chromium`.
Локальный `.env`:

```dotenv
LIVE_PROVIDER=auto
CLOUD_BASE_URL=https://openrouter.ai/api/v1
CLOUD_API_KEY=your-local-key
# Optional: enables the preferred route in Auto.
# OLLAMA_CLOUD_API_KEY=your-local-cloud-key
LLM_REPAIRS=1
```

Перезапустите backend, выберите LIVE, provider и опишите игру.
**Auto** предпочитает настроенный Ollama Cloud и допускает переход к OpenRouter Free.
**Ollama Cloud** и **OpenRouter Free** используют только выбранный provider,
без перехода к другому. Выбор сохраняется для задания и виден в центре заданий.
Конвейер проверяет HTML,
реальный Start/input/pause в opaque iframe 320/390 px и автономный offline запуск.
Ошибка не создаёт игровую версию; запрос/доступный черновик остаются в задании.
Default — одно исправление. Успех показывает фактическую
модель, попытки и фактический переход provider. Короткий browser preflight не гарантирует
весь путь до победы/поражения или FPS каждого результата; это проверяется отдельно.

MICRO-019 разрешает OpenRouter только через `openrouter/free` и exact official
base `https://openrouter.ai/api/v1`. Фактическую бесплатную модель выбирает router;
она видна в provenance. Concrete `:free` IDs, платные модели, generic providers
и локальные модели не являются production routes.
Бесплатные лимиты/недоступность/ошибки остаются возможны; это не рейтинг «лучшей» модели.
`LLM_MAX_TOKENS` — запрошенный верхний
предел, а не гарантия полного ответа: сервер учитывает доступные model metadata,
сохраняет output/reasoning tokens, если провайдер их возвращает. Бюджет нельзя
увеличивать вслепую; подробности в [настройке](docs/development-setup.md).

**Ollama Cloud** использует квоту аккаунта и явный серверный ключ:

```dotenv
OLLAMA_CLOUD_API_KEY=your-local-cloud-key
# Optional server default; UI can also select this provider explicitly.
LIVE_PROVIDER=ollama-cloud
```

Фиксированные model/endpoint — `gemma4:31b` / `https://ollama.com/v1`.
[Официальная документация](https://docs.ollama.com/cloud).
Ключ не подтверждает доступную квоту; credits и план автоматически не меняются.
Точная доступность зависит от аккаунта:
models API не доказывает inference. В TASK-010 `gemma4:31b` вернула настоящий код;
scope проверки конкретной игры указан в [отчёте](docs/task-010-report.md).
MICRO-020 также получила полный LIVE HTML через UI; browser gate отверг его
из-за gameplay JavaScript error, поэтому играбельная версия не создана.
Исправлено ожидание EOF после SSE `[DONE]`; таймауты не увеличены.
[Текущий результат и оставшиеся ограничения](docs/SESSION_HANDOFF.md).

`LLM_PROMPT_STYLE=direct` явно выбирает прямой natural-language prompt; `spec`
остаётся code default и использует структурированное описание. Оба проходят один
game contract/checker, без дополнительного LLM interpretation call. `.env.example` выбирает direct после единичного сравнения;
это не гарантия лучшего качества любого запроса.

Существующий `.env` не переписывается. Legacy `CLOUD_MODEL`, `OLLAMA_CLOUD_MODEL`,
`LLM_FALLBACK`, `SECONDARY_*`, `OLLAMA_*` для local и `LLM_LOCAL_FALLBACK`
не разрешают дополнительные маршруты или модели; production использует только
два маршрута выше. Legacy `LIVE_PROVIDER=cloud` означает OpenRouter Free,
`LIVE_PROVIDER=ollama` — Auto. Для ясной конфигурации используйте новые значения.
`npm run demo:live` выполняет три обычных игровых описания в отдельной `.local/live`,
сохраняет exact HTML/evidence. Это набор сценариев, не рейтинг «лучшей» модели.

Для единичного измерения с уже настроенным провайдером:
`npm run benchmark:generation`. Один встроенный игровой запрос и один provider
dispatch, без repair/fallback, deadline генерации 60 s. Отдельная SQLite и evidence
в `.local/benchmarks/UUID` сохраняют результат, request/validation time,
output/reasoning tokens, если доступны. Time to First Playable Game заполняется
только после успешной проверки; full gameplay и «лучшая модель» этим не доказаны.

## Телефон, LAN и Telegram

Обычный Android Chrome/iPhone Safari открывает предоставленный **публичный HTTPS**
адрес → защищённый вход → каталог → «Играть». Node/SQLite/LLM работают на сервере;
APK, Ollama и терминал на телефоне не нужны. В диагностике HTTPS можно показать QR
этого адреса. QR открывает URL, но не подтверждает доступность с конкретного телефона.
Физические Android/iOS/Telegram клиенты проверяются отдельно от browser emulation.

**LAN QR** предназначен для разработки в одной доверенной сети:

```sh
npm run lan -- --list
npm run lan -- --host 192.168.0.12 --port 3000
```

Выберите реальный Wi-Fi/Ethernet IPv4. Откройте URL на компьютере, введите ключ,
в диагностике покажите QR. QR только с адресом; ключ вводится отдельно. Телефон
в той же доверенной сети. Firewall автоматически не меняется. LAN HTTP не для
публичного доступа; Ollama остаётся на loopback.

Собственный бот — [@YaplixBot](https://t.me/YaplixBot). Добавьте локально
TELEGRAM_BOT_TOKEN и TELEGRAM_ALLOWED_USER_IDS. `npm run telegram:check` проверяет
бота без вывода token. Mini App использует тот же frontend по `/telegram`, сервер
проверяет HMAC/initData age/allowlist. Обычный браузер Telegram SDK не загружает.
При token и одном owner ID обычный backend запускает одного Bot API poller:
`/start`, `/games`, `/new`, `/status`, `/help` и кнопки. Текстовый бот отвечает
независимо от туннеля, если Bot API доступен; без HTTPS объясняет недоступность
Mini App. Каталог берётся из реальной SQLite. `TELEGRAM_UPDATES=off` явно выключает
получение updates. Webhook/второй consumer блокируют polling, не удаляются автоматически.
Для временного HTTPS без покупки домена:

```sh
npm run tunnel:install
# Backend может уже работать на этом порту.
npm run tunnel -- --menu
```

cloudflared закреплён version/SHA-256 и устанавливается только в `.local/tools`.
Launcher проверяет идентичность/readiness уже работающего YAPLIX из этого клона
или запускает свой backend. Публичный health должен подтвердить экземпляр до
настройки меню и печати `/telegram` URL. Ctrl+C закрывает собственные процессы,
сохраняет существующий совместимый backend и сбрасывает только своё меню. `.env` не меняется.
Публичный Telegram сейчас требует ровно один ID владельца; общая библиотека
не обеспечивает персональную изоляцию. Диагностика: `.local/logs/tunnel.log`;
при сетевых сбоях доступен `--protocol http2` или `--protocol quic`. [Telegram/HTTPS](docs/telegram.md)
объясняет BotFather, собственный user ID и постоянный production URL.

В HTTPS кнопка «Поделиться» создаёт ссылку на одну неизменяемую версию на 7 дней;
она разрешает только HTML и не открывает API, библиотеку, generation/backup или
session token. Общая командная библиотека пока без персонального ownership.

Внутренние ссылки `/?game=GAME_ID&version=VERSION_ID` и
`/telegram?game=GAME_ID&version=VERSION_ID` открывают конкретную сохранённую версию
после обычной авторизации. Без version выбирается последняя версия игры. HTML и
ключей в query нет; такая ссылка не даёт права входа. Quick Tunnel меняет hostname,
поэтому для устойчивой внешней ссылки нужен постоянный HTTPS адрес. Библиотека
общая для допущенного владельца; многопользовательская изоляция игр ещё отсутствует.

В Telegram можно до создания задания отметить **«Сообщить в моём Telegram,
когда я выйду из приложения»**. Нужны signed session, собственный бот с доступом
к чату и действующий HTTPS. Без явного согласия сообщений нет. Сервер отслеживает
отсутствие polling, а не доказывает закрытие Mini App; отправка имеет одну попытку.
При сетевом timeout состояние может быть unknown, автоматического дубля нет.
Центр заданий остаётся основным источником результата. Обычный браузер работает
без Telegram; Web Push вне страницы пока не реализован.

## Обслуживание и проверки

```sh
npm run doctor
npm run backup
npm run verify:backup -- .local/backups/backup-UUID.sqlite SHA256
npm test
npm run browsers:install
npm run test:browser
npm run performance:smoke
```

[API/backup/restore/update](docs/development-setup.md), [Windows/Ubuntu](docs/cross-platform.md),
[архитектура](docs/architecture.md), [приёмка](docs/demo-readiness.md).
[Известные ошибки и безопасное восстановление](docs/known-errors.md).
[TASK-008: результаты runtime/tunnel и границы внешней проверки](docs/task-008-report.md).
[TASK-010: облачные модели, recovery, игры и Telegram](docs/task-010-report.md).
Обычный CI выполняет FAST на чистом checkout Windows/Ubuntu и secret-scan;
для runtime/config/неизвестных изменений FULL добавляет реальный Chromium
preflight, 12 frontend profiles и performance. Manual FULL обязателен перед
релизом. [Режимы и ограничения защиты](docs/ci-economy.md),
[замеры MICRO-018](docs/micro-018-report.md). Реальные LLM/физические клиенты отдельно.
По прямому разрешению владельца MICRO-019 hosted Actions временно выключены
до 29 октября 2026; локальные typecheck/build, критические unit, короткий
Playwright и secret scan выполняются отдельно и не считаются hosted PASS.
Восстановление — только по команде владельца, [точный порядок](docs/ci-economy.md).
Задача требует merge, ff-only main и post-merge smoke; защита не обходится:
[AGENTS](AGENTS.md), [CONTRIBUTING](CONTRIBUTING.md).

SQLite/HTML в игнорируемой `.local`; старые версии не переписываются. Sandbox/CSP
не дают полной CPU/RAM изоляции. Экспорт теряет HTTP CSP, проверяйте его offline.
[Безопасность](SECURITY.md), [лицензирование](docs/licensing.md), [вклады](AUTHORS.md).
Открытая лицензия на YAPLIX пока не предоставлена.

TASK-009 добавляет задания и single-worker lease в SQLite **v2**. Перед переходом с v1 создаётся
проверенный защитный snapshot `.local/backups/before-v2-UUID.sqlite`; он не заменяет
обычный backup и не удаляется автоматически. Пустая новая база создаётся сразу
в v2 без migration snapshot. Перед update сделайте backup, затем
остановите свой backend. Порядок update/restore и ограничения downgrade —
[development setup](docs/development-setup.md). `.env`, старые игры/версии и
история сохраняются; утверждение об их фактической сохранности требует проверки
на конкретной базе, а не чтения этих инструкций.
TASK-010 schema v2 не меняет; recovery metadata добавляются внутри существующих jobs.
