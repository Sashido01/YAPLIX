# Приёмка YAPLIX

13 октября 2026. Репетиция по текущей main после merge. Browser tests, реальные LLM,
hosted CI и физические устройства имеют разные границы.

## Сценарий 3–5 минут

1. Чистый клон, npm ci/build/start без ключей: DEMO лабиринт.
2. Старт/движение/победа; Replay/поражение, library/new version/old version.
3. Exact HTML export, offline управление; restart server сохраняет историю.
4. Backup/verify hash/schema, diagnosis; LAN QR + separate access key.
5. LIVE cloud: обычное описание, настоящий HTML/JS, actual model/attempts,
   input/pause/outcome; доработка полного предыдущего HTML следующей версией.
6. Telegram после HTTPS/menu: signed вход, общая library и тот же gameplay.

## Автоматизация

npm test: contracts/SQLite/history/backup/Host/Origin/auth/timeout/cancel, Cloud/
Ollama protocols, Telegram HMAC/allowlist, shares/rates. Transport синтетический;
fake checker используется только в явно помеченных unit tests.
Browser suite **реальный Chromium checker**: positive/zero-size/fatal JS/autostart/
duplicate start/network negatives, bounded repair без сохранения broken version.
Production process: LAN/auth, независимый QR decode, restart/export, synthetic
transport. 12 Chromium/WebKit/Firefox profiles: responsive/input/navigation/history/
offline/isolation. Telegram SDK synthetic: allowed/forbidden/tampered, theme/viewport/
safe-area, blocked cookies, share/listener cleanup.
Performance семь cold 390x844 DPR2 Slow4G CPUx4 before/after, [результаты](cross-platform.md).
Budgets прежние: JS 150 KB, CSS 30 KB, critical 250 KB; p75 target 3 s. LLM отдельно.

## Реальная LLM и внешние шаги

npm run demo:live сохраняет три ordinary game prompts, actual free model, time/
attempts и exact HTML в ignored .local/live. Dynamic free router не сравнивает
фиксированные модели и не обосновывает «лучшую». Проверяйте каждый HTML до win/loss
и следующую version отдельно. Ошибка модели/лимита — отказ, без DEMO подмены.
Bot token проверяет telegram:check, независимо от Mini App launch.
[Внешние шаги](telegram.md): HTTPS/menu/real client. Physical Ubuntu laptop,
Android/iPhone/WebView/keyboard/safe-area/download требуют человеческой репетиции.
Hosted CI этого не подтверждает.

## Данные

Перед update проверенный backup, no old HTML/metadata rewrite. Schema v1 неизменна.
Приёмка сравнивает исходные rows/hashes/history/events, открывает старые игры,
скачивает exact HTML. Old validationStatus сохраняется, passed задним числом не
назначается. Новые версии только добавляются; failure не записывается.
