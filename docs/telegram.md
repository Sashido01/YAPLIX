# Telegram Mini App и HTTPS

Тот же frontend по `/telegram`; обычный `/` работает без SDK. Собственный бот —
[@YaplixBot](https://t.me/YaplixBot). [Official Mini App docs](https://core.telegram.org/bots/webapps).

## Токен и доступ

[@BotFather](https://t.me/BotFather) /newbot либо уже созданный бот. Локальный .env:

```dotenv
TELEGRAM_BOT_USERNAME=YaplixBot
TELEGRAM_BOT_TOKEN=your-local-token
TELEGRAM_ALLOWED_USER_IDS=123456789
```

ID — положительное число, не @username. Публичный HTTPS сейчас допускает
ровно один ID владельца: библиотека общая, персональный ownership ещё не реализован.
Несколько разных ID блокируют публичный запуск до публикации. Напишите `/start` собственному
@YaplixBot, затем выполните `npm run telegram:id`. Read-only getUpdates показывает
только числовые ID отправителей в приватном чате, без имён/сообщений и без добавления
в allowlist. Выберите свой ID и впишите локально. Активный webhook может блокировать
getUpdates; инструмент его не удаляет. Другой вариант — `/start` стороннему
[@userinfobot](https://t.me/userinfobot), которому не нужны YaplixBot token/API-key.
Не вставляйте token URL в browser/history/чат/скриншоты.

`npm run telegram:check` read-only getMe/getChatMenuButton, показывает bot username,
token accepted, HTTPS/allowlist presence и menu type, без вывода token. Без bot/IDs
Mini App закрыт; подписанный неразрешённый ID не получает library/LLM. HMAC/age
проверяет server, initDataUnsafe не доверяется. После server restart новый вход.

## Временный HTTPS без домена

[Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
даёт trycloudflare.com URL без покупки домена/account. Это тестовый канал без SLA,
URL меняется, SSE не поддерживается; YAPLIX использует JSON. Не запускайте вторую
копию backend с той же SQLite.

```sh
npm run tunnel:install
npm run build
# npm start может продолжать работать; после обновления перезапустите его один раз.
npm run tunnel -- --check
npm run tunnel -- --menu
```

Installer скачивает официальный cloudflared 2026.10.0 и сверяет pinned SHA-256,
сохраняет только .local/tools. Windows x64 / Linux x64,arm64. Existing file с
другим hash не перезаписывает. Connector не получает API/bot credentials и не
меняет global/service/firewall настройки.
Launcher требует bot/одного владельца/build. Порт свободен: запускает backend,
проверяет HTTP readiness, SQLite и идентичность. Порт занят: проверяет HMAC challenge
с локальным runtime-control key именно этого клона, protocol и health; использует
совместимый backend без второго writer. Посторонний HTTP 200 и устаревший YAPLIX
отвергаются без остановки процесса. После изменения .env/обновления один раз
перезапустите свой backend. LAN/постоянный HTTPS backend не переводится автоматически.

Перед connector backend временно закрывается для публичного доступа, затем получает
exact HTTPS origin и защищённые access/Telegram sessions. `/healthz` публичен, содержит
только app/protocol/случайный instance/ready: без конфигурации, ключей и данных.
Launcher проверяет реальный внешний HTTPS, exact instance и ready; URL из stdout
сам по себе не считается успехом. Только после этого `--menu` проверяет getMe,
setChatMenuButton и читает URL обратно. Ошибка Telegram оставляет работающий tunnel,
но печатает, что menu не подтверждено. Приватный токен в терминал не выводится.

URL `/telegram` печатается и сохраняется в `.local/tunnel-url.txt`, .env не меняется.
На Android откройте приватный чат своего бота и menu button, затем DEMO → Старт.
Chrome на Android может открыть `/telegram`, но без подписанного Telegram initData
вход отклоняется. HTTP проверка не подтверждает запуск в физическом WebView/iOS.

Ctrl+C/штатное IPC shutdown: прекращает connector, сбрасывает menu только если оно
ещё указывает на URL этой сессии, удаляет свой URL-файл. Собственный backend закрывает
SQLite; существующий процесс остаётся и возвращается в local mode. При потере parent
собственный backend закрывается по IPC disconnect; при потере heartbeat существующий
backend закрывает public requests через 20 s. После аварии (kill/power loss) меню в
Telegram может остаться: `npm run telegram:check`, перезапуск своего backend и новая
команда обновляют URL. Launcher не заявляет, что внешнее меню очищено, если API отказал.

API/library/generation/backup требуют авторизацию; публичный shell не даёт данных.
Rate limits/login/session quotas, session bearer и opaque iframe сохраняются.
Запрещены прямые SQLite/.env/log/backup downloads; Ollama не публикуется.
Cloudflare завершает TLS и видит HTTP трафик — явная внешняя тестовая зависимость.

## Ошибки сети и Windows

Журнал `.local/logs/tunnel.log` ограничен примерно 64 KB текста, secret values,
bot/API tokens, initData и Authorization фильтруются до записи. Сообщение содержит
код, этап, проверенные сведения, stderr/exit code/signal и путь журнала. Не прикладывайте
.env или необработанные сторонние журналы при диагностике.

- PORT_IN_USE: это несовместимый/посторонний backend. На Windows:
  `Get-NetTCPConnection -LocalPort 3000` → OwningProcess, затем
  `Get-Process -Id PID`. Другой порт: `$env:PORT='3001'` и та же команда tunnel.
  Никогда не останавливайте неизвестный процесс. Doctor всё ещё проверяет новый bind.
- SPAWN_ERROR/install/hash: `npm run tunnel:install`, проверьте права запуска и карантин.
  Не выключайте антивирус/TLS verification и не заменяйте pinned binary неизвестным.
- PUBLIC_URL_TIMEOUT: максимум 60 s на URL; PUBLIC_HEALTH_FAILED: максимум 45 s на
  внешний health. DNS/TLS/HTTP ошибки сохраняются, меню не публикуется.
- Cloudflare требует HTTPS TCP 443 для Quick Tunnel API и UDP 7844 для QUIC или
  TCP 7844 для HTTP/2. `npm run tunnel -- --menu --protocol http2` явно выбирает
  TCP; `--protocol quic` — UDP; default auto использует штатную логику cloudflared.
  TLS не ослабляется. [Официальные сетевые требования](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).
- VPN может менять DNS, маршрут и доступность транспортов. Сравните диагностику в
  разрешённой сети/VPN, не угадывайте причину только по TUNNEL_CLOSED. Передаются
  явно заданные HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY и lowercase варианты;
  поддержка конкретного proxy транспортом cloudflared не гарантируется. Node внешний
  probe учитывает proxy при `NODE_USE_ENV_PROXY=1`; Windows GUI/PAC proxy не подхватывается
  автоматически. Proxy credentials считаются секретами.
- Windows Firewall/защитное ПО могут блокировать исходящие соединения процесса.
  Проверьте правила с администратором; launcher не меняет firewall, не открывает
  входящий backend и не публикует Ollama. HTTPS не заменяет авторизацию.

## BotFather

1. `/setmenubutton` → @YaplixBot → точный HTTPS URL с `/telegram` → текст
   «Открыть YAPLIX».
2. В приватном чате @YaplixBot нажмите меню: вход, library, DEMO/LIVE, игра, версии.
3. После нового tunnel URL повторите menu. Альтернатива собственного бота:
   `npm run tunnel -- --menu` явно вызывает setChatMenuButton, не отправляет сообщения.
4. Main Mini App/direct t.me launch: `/mybots` → Bot Settings → Configure Mini App,
   тот же HTTPS URL. Menu button достаточно для теста. Пункты Telegram могут меняться.

Обычный browser `/telegram` без initData даёт понятный отказ. Обычный `/` требует
access key. Forbidden ID отклоняется до library/LLM. Theme/viewport/safe-area по SDK,
Back → library; game iframe не получает initData/token. Download может ограничивать
WebView: используйте системный браузер для HTML export.

## Постоянный URL

Настройте HTTPS reverse proxy/managed tunnel отдельно: backend только loopback,
proxy сохраняет Host и передаёт `X-Forwarded-Proto: https`.

```dotenv
YAPLIX_MODE=https
YAPLIX_HOST=127.0.0.1
PUBLIC_URL=https://games.example.com
YAPLIX_ACCESS_KEY=your-32-or-more-url-safe-random-key
```

npm start, затем `npm run telegram:menu` или BotFather. Этот режим независим от
Quick Tunnel. Не открывайте backend/Ollama на 0.0.0.0. [Update/backup](development-setup.md).

Synthetic SDK/HTTPS tests проверяют реальный HMAC, allowed/tampered/forbidden,
shared UI/gameplay, header session при blocked cookies, theme/viewport/safe-area,
share/teardown на Chromium/WebKit. Это не реальный Telegram client. telegram:check
подтверждает token, но не Mini App launch. Внешняя приёмка: HTTPS/menu, Telegram
Android/iOS, permitted/forbidden accounts, real LIVE game. До неё physical PASS не заявляется.
