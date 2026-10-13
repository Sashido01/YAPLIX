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

ID — число, не @username; несколько через запятую. Напишите `/start` собственному
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
# Остановите свой npm start, если порт занят.
npm run tunnel -- --check
npm run tunnel
```

Installer скачивает официальный cloudflared 2026.10.0 и сверяет pinned SHA-256,
сохраняет только .local/tools. Windows x64 / Linux x64,arm64. Existing file с
другим hash не перезаписывает. Connector не получает API/bot credentials и не
меняет global/service/firewall настройки.
Launcher требует bot/allowlist, build и свободный порт. Он создаёт random public URL,
запускает loopback backend в HTTPS mode с exact PUBLIC_URL и strong access key
из .env либо .local/lan-access.key. URL `/telegram` печатается и сохраняется в
.local/tunnel-url.txt; .env не меняется. Ctrl+C закрывает connector/backend.
API/library/generation/backup защищены; public shell не означает доступ к данным.
Cloudflare завершает TLS и видит HTTP трафик — явная внешняя тестовая зависимость.

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
