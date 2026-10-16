# Подключение LLM: Direct, VPN и proxy

MICRO-021. Все LLM GET/POST выполняет Node backend. Телефон не получает ключи
провайдеров или proxy. Provider mode (`auto`, `ollama-cloud`, `openrouter`) и
сетевой режим ниже — разные настройки. Модели остаются gemma4:31b / openrouter/free.

## Auto и приоритет

`YAPLIX_LLM_NETWORK=auto` — default. На каждом запросе backend читает свою текущую
конфигурацию. Изменение `.env` требует штатного перезапуска приложения; изменение
переменных в другом терминале не меняет окружение уже запущенного процесса.

1. `YAPLIX_LLM_PROXY` — явно заданный HTTP/HTTPS proxy администратора.
2. Для облачного HTTPS: `https_proxy`, затем `HTTPS_PROXY`; при отсутствии значения
   используется `http_proxy`, затем `HTTP_PROXY`. Нижний регистр имеет приоритет
   над верхним, даже если задан пустой строкой. Это правила YAPLIX/Undici;
   не следует переносить их автоматически на другие HTTP-клиенты.
3. `no_proxy`, затем `NO_PROXY` разрешает явные исключения в Auto.
4. Если proxy не задан, соединение Direct использует маршрутизацию ОС, включая
   работающий прозрачный VPN. Приложение не определяет название VPN-клиента.

NO_PROXY: `localhost,127.0.0.1,[::1],example.org,.internal.example,*.internal.example:443`
или `*`. Совпадает сам host и его поддомены, порт необязателен. CIDR, диапазоны IP
и PAC не поддержаны. Проверка hostname не выполняет DNS lookup.

`YAPLIX_LLM_NETWORK=proxy` требует `YAPLIX_LLM_PROXY`, игнорирует NO_PROXY и
**никогда не переключается в Direct** при отказе. Auto тоже не обходит выбранный
proxy после ошибки; исключения NO_PROXY применяются до соединения.
`YAPLIX_LLM_NETWORK=direct` — явный выбор администратора, игнорирующий proxy.
Не используйте его для обхода корпоративной политики.

Если задан только неподдерживаемый ALL_PROXY либо выбран socks/socks5/socks5h,
получите `LLM_PROXY_UNSUPPORTED`, а не скрытый Direct. SOCKS/DNS через SOCKS не
реализованы: для этой задачи достаточно небольшого HTTP/HTTPS транспорта без
отдельной SOCKS-инфраструктуры. Произвольные публичные proxy не ищутся.

## Настройка сервера

Обычная сеть/прозрачный VPN: настройка не нужна. Для proxy администратор может
явно добавить в собственный серверный `.env` (не копируйте поверх существующего):

```dotenv
YAPLIX_LLM_NETWORK=proxy
YAPLIX_LLM_PROXY=http://proxy.example.org:8080
LLM_CONNECT_TIMEOUT_MS=10000
```

Для TLS до самого proxy: `https://proxy.example.org:8443`.
Для Basic authentication допустим URL `http://USER:PASSWORD@HOST:PORT`;
спецсимволы username/password кодируются percent-encoding. Не публикуйте этот URL,
не вставляйте его в screenshot, issue, browser или command history. Другие схемы
proxy auth (NTLM, Kerberos, интерактивный login) не заявлены.
Proxy credentials идут только на CONNECT, не к провайдеру; API key — внутри TLS.

Для стандартных environment variables в PowerShell:

```powershell
$env:HTTPS_PROXY='http://proxy.example.org:8080'
$env:NO_PROXY='localhost,127.0.0.1,[::1]'
npm run network:check
```

Ubuntu, окружение только одной команды:

```sh
HTTPS_PROXY=http://proxy.example.org:8080 NO_PROXY=localhost,127.0.0.1 npm run network:check
```

## Системные настройки и TLS

Node 24.18 имеет `NODE_USE_ENV_PROXY=1`, `--use-env-proxy` и
`http.setGlobalProxyFromEnv()`. Последний заменяет global agents/dispatcher;
вызывать его посреди активных запросов не рекомендуется
([Node](https://nodejs.org/docs/latest-v24.x/api/http.html#httpsetglobalproxyfromenvproxyenv)).
YAPLIX использует явный Agent/ProxyAgent из фиксированного Undici 7.30.1 для
каждого облачного запроса; этот путь не требует flag и не меняет global dispatcher
Telegram/других компонентов. GET models, health/readiness и inference используют
тот же механизм. Agent уничтожается после body/ошибки/отмены, кэша proxy нет.

Автоматического импорта Windows Settings/WinINET/WinHTTP/PAC нет. Read-only
источники администратора: `netsh winhttp show proxy` и параметры Internet Settings
текущего пользователя (ProxyEnable/ProxyServer/AutoConfigURL). Это разные источники;
наличие registry URL не доказывает, что его нужно использовать для каждого host.
PAC требует загрузки и выполнения скрипта для URL/host
([Microsoft](https://learn.microsoft.com/en-us/windows/win32/winhttp/winhttp-autoproxy-support)).
YAPLIX не загружает/не исполняет PAC/WPAD. Получите у администратора разрешённый
явный endpoint и используйте обязательный proxy mode. Аналогично настройки
Ubuntu desktop не гарантируют окружение systemd/терминала: задавайте proxy для
процесса backend. Системные VPN/DNS/firewall/proxy приложение не меняет.

Сертификаты origin и HTTPS proxy проверяются. При корпоративном CA администратор
может настроить доверенный CA через `NODE_EXTRA_CA_CERTS` перед запуском Node;
не выключайте проверку TLS. `NODE_TLS_REJECT_UNAUTHORIZED=0` блокируется.
Connect timeout default 10 s (100..30000 ms); request/inference timeout,
общий engine/job deadline, AbortController, bounded retries/cooldowns сохранены.
Дополнительного автоматического повтора внутри HTTP-транспорта нет.

## Диагностика без генерации

`npm run network:check` проверяет routes выбранного серверного provider mode;
`npm run network:check -- --all` — оба настроенных разрешённых provider.
Выполняются только GET `/models`, без SQLite/worker/inference/repair/fallback.
Вывод: provider/model, route, stage, HTTP status (если получен), durationMs,
category и `inferenceVerified:false`. `npm run doctor` и backend readiness также
получают безопасную сетевую сводку. GET 200 **не подтверждает генерацию**.

| Код | Действие |
| --- | --- |
| LLM_DNS | Проверить DNS/интернет backend; при proxy DNS origin выполняет proxy |
| LLM_PROXY_CONNECTION | Проверить обязательный endpoint/порт/доступность proxy |
| LLM_PROXY_AUTH | Проверить серверные proxy credentials; отказ CONNECT 407 |
| LLM_TCP_CONNECTION | Проверить доступность TCP endpoint |
| LLM_TLS | Проверить цепочку CA, hostname, срок сертификата origin/proxy |
| LLM_AUTH | HTTP 401/403 provider: проверить серверный API key |
| LLM_RATE_LIMIT / LLM_QUOTA | 429/402 и ограниченное ожидание; не покупать credits |
| LLM_HTTP | HTTP error provider, status отдельно, например service 503 |
| LLM_RESPONSE_TIMEOUT / LLM_TIMEOUT | Timeout транспорта / engine deadline |
| LLM_CONNECTION_INTERRUPTED | Обрыв body/SSE; checkpoint сохранён |
| LLM_NETWORK_UNAVAILABLE | Остальной сетевой отказ без раскрытия raw exception |
| LLM_NETWORK_CONFIGURATION / LLM_PROXY_UNSUPPORTED | Исправить конфигурацию; Direct автоматически не включается |

Сообщения UI краткие, идея/черновик остаются в задании. Не передавайте raw logs,
stack, `.env`, API keys, proxy URL/password или секретные query parameters.
Ошибки сети не превращаются в ошибки качества игрового HTML.

## Проверенные границы

16.10.2026, локальный Windows Node 24.18: реальный Direct GET обоих облаков — 200.
HTTP и HTTPS CONNECT, Basic auth/407, TLS rejection, timeout, NO_PROXY,
изменение конфигурации и запрет Direct fallback проверены на локальных серверах.
DNS failure и прозрачный VPN-маршрут — simulated. Физический VPN, корпоративный
proxy, Ubuntu runtime, Android/iOS/Telegram devices — NOT_TESTED в MICRO-021.
Новых реальных inference POST — **0**. Полная матрица и восстановление игры —
[handoff](SESSION_HANDOFF.md). Работоспособность в любой сети не обещается.
