# YAPLIX — ты придумал, теперь играй

Один воспроизводимый репозиторий: мобильный frontend, Node backend, собственный
LLM-конвейер, библиотека игр/версий, аналитика, экспорт, LAN/QR и Telegram Mini App.
DEMO — авторский лабиринт с ходами, стенами, победой и поражением. LIVE создаёт
HTML/JS по описанию через модель, без готового каталога и скрытой подмены DEMO.

## Установка и запуск

Git, Node **24.18+ (24.x)**, npm. Для разработки также Python 3.11+.
Windows PowerShell, чистый клон:

```powershell
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
npm ci
Copy-Item .env.example .env
npm run build
npm start
```

Ubuntu 24.04:

```sh
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
npm ci
cp .env.example .env
npm run build
npm start
```

Откройте напечатанный адрес, обычно http://127.0.0.1:3000/.
Frontend/backend запускаются одним процессом. DEMO работает без ключей, Ollama,
cloud и Chromium. Секреты `.env` только на сервере. В существующем клоне не заменяйте
свой `.env` примером.

## Полный сценарий

1. DEMO → «Создать игру» → «Старт». Клавиатура и touch-кнопки двигают героя.
   Соберите груз и дойдите до выхода; ловушка даёт поражение. «Заново» — новая сессия.
2. Библиотека хранит игры и версии. Новое требование → «Новая версия»; старая
   версия сохраняется и доступна для повторного запуска.
3. Аналитика показывает score, wins/losses и сравнение. Это наблюдения по клиентским
   событиям, а не причинное доказательство улучшения игры.
4. Скачанный HTML работает автономно без сервера/ключей. Перезапуск YAPLIX сохраняет
   SQLite/историю. Диагностика проверяет API/базу/модель; backup проверяет копию.

## Настоящая LIVE-генерация

Серверный Chromium (телефону не нужен):

```sh
npm run checker:install
```

Ubuntu при отсутствии OS библиотек:
`node scripts/browser-tests.mjs install --with-deps chromium`.
Локальный `.env`:

```dotenv
LIVE_PROVIDER=cloud
CLOUD_BASE_URL=https://openrouter.ai/api/v1
CLOUD_MODEL=openrouter/free
CLOUD_API_KEY=your-local-key
LLM_FALLBACK=none
LLM_REPAIRS=1
```

Перезапустите backend, выберите LIVE и опишите игру. Конвейер проверяет HTML,
реальный Start/input/pause в opaque iframe 320/390 px и автономный offline запуск.
Ошибка не создаёт версию; default — одно исправление. Успех показывает фактическую
модель, попытки и явно настроенный fallback. Короткий browser preflight не гарантирует
весь путь до победы/поражения или FPS каждого результата; это проверяется отдельно.

OpenRouter разрешён **только `openrouter/free`**, без платного fallback. Router
выбирает доступную бесплатную модель, имя видно в provenance. Бесплатные лимиты,
задержки/недоступность/ошибка модели возможны и показываются честно.
Другой OpenAI-compatible provider задаётся точными CLOUD_BASE_URL/MODEL/KEY.
Gateway21t endpoint/model не угадываются. Ollama — явная альтернатива
`LIVE_PROVIDER=ollama` или `LLM_FALLBACK=ollama`, устанавливается отдельно с моделью.
`npm run demo:live` выполняет три обычных игровых описания в отдельной `.local/live`,
сохраняет exact HTML/evidence. Это набор сценариев, не рейтинг «лучшей» модели.

## Телефон, LAN и Telegram

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
[TASK-008: результаты runtime/tunnel и границы внешней проверки](docs/task-008-report.md).
CI проверяет чистый checkout Windows/Ubuntu, synthetic transports, реальный Chromium
preflight, 12 frontend profiles и секреты. Реальные LLM/физические клиенты отдельно.
Задача завершена после hosted CI, merge, ff-only main и post-merge smoke.
Защиту/CI обходить нельзя: [AGENTS](AGENTS.md), [CONTRIBUTING](CONTRIBUTING.md).

SQLite/HTML в игнорируемой `.local`; старые версии не переписываются. Sandbox/CSP
не дают полной CPU/RAM изоляции. Экспорт теряет HTTP CSP, проверяйте его offline.
[Безопасность](SECURITY.md), [лицензирование](docs/licensing.md), [вклады](AUTHORS.md).
Открытая лицензия на YAPLIX пока не предоставлена.
