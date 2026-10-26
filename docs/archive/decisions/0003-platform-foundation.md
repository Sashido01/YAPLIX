> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../../README.md).

# ADR-0003: собственная Node/TypeScript/Hono/SQLite платформа

13 октября 2026. Актуализировано TASK-007, прежняя внешняя интеграция снята.
Один репозиторий: frontend/API/generator/storage. Node 24.18+ (24.x), native TS
stripping/node:test/SQLite; Hono/esbuild не требуют второго frontend проекта.
Собственный generator/spec/prompts по YAPLIX contracts, cloud primary, explicit
Ollama alternative. Никаких чужих local source/templates/assets/clone шагов.
Static + real Chromium preflight, bounded repair и provenance; короткая browser
проверка не заменяет complete gameplay. Telegram тот же frontend с HTTPS/HMAC.
Цена: synchronous SQLite ограничивает нагрузку, server Chromium нужен LIVE;
DEMO независим. Shared team library пока без ownership/roles. Отдельные Docker/
Redis/PostgreSQL/SPA framework не нужны этой вертикали.
