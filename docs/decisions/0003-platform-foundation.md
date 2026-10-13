# ADR-0003: TypeScript/Hono, Node 24 и SQLite

Дата: 2026-10-13. Статус: принято для локальной TASK-002.

## Контекст

BGen уже реализован на Bun/Hono/TypeScript и развивается SKZHPRVT; jeanhayl
ведёт Mobile First UI. YAPLIX пока содержит только командные проверки.
Нужна рабочая вертикаль версий/телеметрии с простыми общими контрактами.

## Решение

Один Hono backend на Node 24.18+ с native TypeScript stripping и built-in
SQLite DatabaseSync. Browser bridge компилируется TypeScript в обычные ES modules.
Node/SQLite фактически проверены локально на Windows; CI расширен на Windows
и Ubuntu 24.04. SQL миграция атомарная и versioned, без ORM.

BGen подключается по HTTP; конфигурация и credentials доступны серверу.
Контракт адаптера учитывает реальные legacy ответы и отклоняет неоднозначное
происхождение. llm_code требует явной upstream provenance; mock/template/fallback
не считаются свободной LLM-генерацией. Производственный GigaChat блокируется
до исправления TLS в BGen. Исходники и шаблоны BGen не переносятся.

Работа разделена: Sashido01 — platform API/store/analytics/runtime contract;
SKZHPRVT — LLM-код, iterate, provenance и TLS; jeanhayl — UI и очередь bridge.

## Альтернативы и последствия

Bun подходит BGen, но отдельная платформа использует уже установленный Node 24,
встроенный SQLite и node:test, без bun-specific SQLite типов/драйверов.
HTTP сохраняет независимость runtime генератора. Bun не требуется для YAPLIX.
React/Fastify/Vite frontend не добавлены: дублировали бы работу команды.
Rust/Tauri/Electron/Redis/PostgreSQL/Docker не нужны локальной вертикали.

Цена выбора: node:sqlite на Node 24 experimental; синхронные операции ограничивают
нагрузку. API пока loopback и не содержит production auth/ownership. Browser CSP
не гарантирует блокировку любой собственной навигации iframe. Интеграция реального
BGen и физических WebView требует следующих отдельных проверок.
