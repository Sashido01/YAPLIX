> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# TASK-008 — Runtime & Tunnel Reliability

Дата проверки: 2026-10-14. Исходная main: d5b678a70567208261131c6f912c121bc3d9d00d.

## Причины и границы доказательства

PORT_IN_USE: прежний launcher всегда делал exclusive bind и отвергал любой уже
работающий backend. Теперь проверяет readiness и HMAC identity именно этого клона.

Прежний TUNNEL_CLOSED терял stderr/exit code/signal; историческая причина по этим
данным не восстановима. Установленный SHA-verified cloudflared 2026.10.0 воспроизведён
вне sandbox: Quick Tunnel выдаёт URL, QUIC регистрируется, DNS resolver предупреждает
i/o timeout, HTTP/2 precheck сообщает blocked/unreachable. Это сведения текущей сети,
а не доказательство причины прежнего пользовательского завершения.

Реальные испытания собственного и existing backend получили Quick Tunnel URL,
но внешний Node HTTPS health не подтвердился за 45 s. Дополнительная проверка одного
полученного hostname вернула ENOTFOUND через OS lookup и DNS resolve4. Read-only
проверка Windows GUI proxy: отключён; env HTTP/HTTPS/ALL_PROXY отсутствуют.
Telegram API direct fetch тоже дал timeout. Причина ограничений маршрута/DNS/VPN
оператора не установлена. Menu не публиковалось. TLS/firewall/DNS/OS настройки не менялись.

## Изменения

- Ready backend перед connector; same-clone HMAC/protocol/instance attach без второго writer.
- Fail-closed public lease, bounded startup/external health, stdout/stderr/exit/signal capture.
- Только owned children закрываются; existing backend возвращается в local mode.
- Public `/healthz` минимален; menu update после exact-instance external health и readback.
- Telegram failure оставляет tunnel/backend; reset касается только URL текущей сессии.
- TLS сохраняется, transport auto/http2/quic явный, connector без bot/LLM/control keys.
- Public Telegram single owner, auth/rate limits/sandbox/session bearer сохранены.
- Журнал фильтрует env secrets, JSON/fragmented tokens/Authorization до bounded записи.

## Проверки

- Production build/typecheck; 42 Node tests, включая A–L, URL-then-exit, JSON redaction,
  heartbeat loss, lease expiry и повторный запуск.
- Первый hosted Ubuntu run выявил связанность test connector timeout 600 ms и
  backend readiness. Deadline backend отделён (15 s); current-head CI проверяется заново.
- 19 Python repository/hook tests; repository checker и diff whitespace check.
- Browser matrix: 167 passed / 145 intentional profile skips из 312, Chromium,
  Firefox, WebKit; 320/360/390/430, tablet/desktop, touch/rotation/reduced viewport,
  opaque sandbox, persistence/export, synthetic Telegram и LIVE transport.
- Первые checker tests внутри sandbox дали timeout; повтор вне sandbox прошёл с
  Chromium sandbox включённым. Это ограничение тестовой среды, не заявленный PASS первого запуска.
- npm audit production dependencies: 0 vulnerabilities.
- Mobile Slow 4G / CPU ×4, семь cold browser contexts до и после: interactive p75
  651 → 668 ms, game start 972 → 964 ms, API p75 3.47 → 2.90 ms. LLM timing не измерялся.
  Server warmed в обоих замерах; физический cold process launch не измерялся.
- Initial gzip JS 7035 B, CSS 2143 B, critical total 11439 B; размеры не изменились,
  budgets 150000/30000/250000 B соблюдены. Frontend source/dependencies не менялись.

## Запуск и оставшаяся внешняя приёмка

`npm run tunnel -- --menu`, после build/install и bot/одного owner ID в .env.
После обновления перезапустите уже работающий backend один раз. Ошибки теперь
содержат этап/проверки/действия/путь `.local/logs/tunnel.log`.

Реальный внешний health/menu readback/reset и physical Telegram Android/iOS в этой
сети пока не подтверждены. Ни synthetic HTTPS, ни полученный URL не заявляются
успешным внешним Mini App. Реальные LLM calls в TASK-008 не выполнялись.
MVP DEMO/versions/restart/export/backup проверены; arbitrary LLM game performance
не гарантируется. Реальные пользователи/SQLite/.env не изменялись.

GitHub delivery фиксируется по actual PR head/Windows/Ubuntu/secret-scan и merge SHA;
local/post-merge proof не заменяет внешнюю Telegram приёмку. Настройка и диагностика:
[Telegram](../telegram.md), [development setup](../development-setup.md).
