# Security Policy / Безопасность

**Статус:** работающий командный MVP; публичного релиза и multi-tenant изоляции нет.

Репозиторий YAPLIX открыт для просмотра (Public; проверено через GitHub API 26 октября 2026 года), но публичного релиза и открытой лицензии нет. Секреты нельзя хранить в клонах, истории и CI-логах.

## Что нельзя публиковать

- Пароли, API-токены, файлы `.env`, приватные ключи, резервные копии и реальные персональные данные.
- Не предназначенные для публикации материалы компаний и соревнования.
- Детали эксплуатации уязвимостей в публичных Issues до согласования безопасного способа раскрытия.

## Сообщение об уязвимости

Если на странице **Security** появится функция **Report a vulnerability** (private vulnerability reporting), используйте её. **Сейчас включение этой функции не подтверждено.** Если она недоступна, свяжитесь с участниками команды по уже согласованному приватному каналу и не размещайте технические подробности публично. До публикации работающего приложения команда должна определить и указать здесь постоянный приватный контакт.

## Реакция команды

При обнаружении реального секрета не вставляйте его в отчёт, Issue, PR или лог. Сообщите владельцу по приватному каналу, отзовите/замените секрет у провайдера, затем удалите его из текущих файлов. Удаление файла не удаляет секрет из истории. Очистку общей истории планируйте отдельно с участниками, резервными копиями и явным разрешением владельца; не выполняйте её автоматически.

После получения сообщения команда оценит влияние и воспроизводимость проблемы, исправит её, а при необходимости уведомит затронутых пользователей. SLA и сроки реакции пока не установлены и не обещаются.


## Работающий MVP

По умолчанию server доступен на loopback. Явные LAN/HTTPS режимы требуют общий
случайный key и HttpOnly/SameSite cookie; публичный доступ требует TLS reverse
proxy, loopback backend и точный public Host/Origin. LAN HTTP — доверенная
репетиционная сеть, без защиты от прослушивания. Общий key даёт доступ ко всем
играм, generation и backup; это не персональные аккаунты/роли. Не публикуйте
key/LLM секреты в browser URL, game HTML, логи CI или Git.

Недоверенный HTML находится в opaque iframe allow-scripts с CSP, без token/API
доступа. События проверяются и требуют отдельный session bearer, однако остаются
клиентской статистикой. CSP/sandbox не гарантируют CPU/RAM изоляцию произвольного
LLM кода. Скачанный файл теряет HTTP CSP; проверяйте его offline в отдельном
браузере. LLM TLS bypass и remote template/fallback подмена LIVE запрещены.

Backup/restore выполняются по [development-setup](docs/development-setup.md).
Данные и .env игнорируются Git, но оператор отвечает за filesystem permissions
и сохранение проверенных backup. При отзыве access key перезапустите server:
старые cookie прекращают работать. Частные контакты/SLA команда ещё не утвердила.

## Cloud и Telegram

TLS verification/redirect deny. MICRO-019 допускает только `gemma4:31b` на
`https://ollama.com/v1` и `openrouter/free` на `https://openrouter.ai/api/v1`;
concrete :free IDs и paid secondary запрещены. Repair/deadline/response/concurrency bounded. Chromium checker с OS sandbox,
без server secrets в environment, offline/CSP; не полная защита от browser exploits
или resource exhaustion. Не открывайте MVP как anonymous multi-tenant service.
Telegram HMAC/age/allowlist до library/LLM; initDataUnsafe не доверяется.
HttpOnly Secure cookie/memory header token не в игре/storage/URL. Generation 6/min
на principal, 12/min global. Shared library без personal ownership: публичный Telegram допускает ровно один
ID владельца; несколько разных ID блокируют публичный HTTPS startup. Share 7 дней
для одной version без API/backup, key rotation отзывает cap.
Quick Tunnel — явный временный protected HTTPS ingress; Cloudflare видит HTTP traffic.

Runtime control требует loopback, отсутствие browser/proxy headers и локальный
secret key для изменений. Перед отправкой ключа launcher проверяет HMAC nonce
совместимого backend. Public `/healthz` не раскрывает env, DB paths или diagnostics.
После потери supervisor lease закрывает public access; local mode отвергает
forwarded traffic. Journal фильтрует secrets до записи и ограничивает объём.
Невозможность подтвердить внешний health блокирует menu button.

## MICRO-029 Stage A1: личный ChatGPT

Исключение владельца к MICRO-019 добавляет ручной `chatgpt` только local/loopback:
`https://api.openai.com/v1/responses`, `gpt-6.1-sol`, reasoning medium,
store false, stream true. Серверная SIWC-сессия хранит токены только в памяти;
LAN/HTTPS/Telegram запрещены. Connect/disconnect требуют точного Origin и
отдельного заголовка действия владельца. Worker проверяет доступ перед POST.
Один durable job допускает максимум один inference POST, включая ошибку или
crash; retry, fallback, LLM repair и повторный POST через Continue запрещены.
Полный подтверждённый checkpoint разрешено повторно проверить локально.
Серверный OAuth lock живёт в памяти; locks standalone CLI не изменяются.
A1 проверяется offline; реальные OAuth, model GET и inference требуют отдельного
разрешения. Техническая доступность не доказывает право коммерческого или
многопользовательского использования. [Подробности](docs/chatgpt-setup.md).
