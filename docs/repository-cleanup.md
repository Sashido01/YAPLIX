# Подготовка репозитория к оценке жюри

> Исторический отчёт PR #57. Результаты ниже относятся к документационной ветке, а не к объединённому приложению. Текущее состояние и новые screenshots: [отчёт интеграции](release-integration.md), [происхождение снимков](media/README.md).

21 октября 2026. База: main `a56fe00adc8ee215998cc1da3a9c4d6b92408f95`. Изолированная ветка `codex/final-repo`; исходный checkout Arena и чужие worktree не меняются. Результат — Draft PR, без merge и закрытия объектов GitHub.

## Что изменилось

- README переписан вокруг продукта: идея, создание, игра, изменение, версии, экспорт, запуск, стек, ограничения и команда.
- Добавлены два настоящих screenshot из main на отдельной пустой SQLite. Авторская игра явно подписана; пользовательские данные, ключи, QR и личные материалы не используются. [Происхождение](media/README.md).
- [Указатель документации](README.md) разделяет пользовательские инструкции, разработку и историю. Подготовлены актуальные архитектура, валидация, demo и QR; Arena помечена отдельным кандидатом.
- Исправлены устаревший metadata-блокер, «PR ещё не слит», прежние deadlines и состав команды. Исторические SHA/даты оставлены в архиве, а не выданы за текущую main.
- Аудированы все открытые Issues/PR, подготовлены предложения владельцу. [Снимок и зависимости](release-status.md); ничего не закрыто.

## Файлы и основания решений

[Полный inventory](repository-inventory.tsv) содержит **234 исходных отслеживаемых файла**, назначение, потребителя, наличие доказательств, решение и SHA-256 до изменения. Он построен по `git ls-files` на базе выше; новые документы и screenshots перечисляются diff этого PR. Для истории сохранён исходный Git, он не переписывается.

Удалений содержимого без сохранённой копии: **0**. Из текущего `docs/` перенесены 25 конкретных файлов; Markdown изменён только для ссылок и явной архивной пометки. PNG и JSON сохраняют исходные байты. Тесты, исходники и сборка не читают перенесённые пути; ссылки документации обновлены. JSON evidence сохраняет исторические пути своих записей как часть исходного результата.

| Прежний путь | Сохранённый путь |
| --- | --- |
| `docs/task-001-report.md` | `docs/archive/task-001-report.md` |
| `docs/task-008-report.md` | `docs/archive/task-008-report.md` |
| `docs/task-009-report.md` | `docs/archive/task-009-report.md` |
| `docs/task-010-report.md` | `docs/archive/task-010-report.md` |
| `docs/task-013-report.md` | `docs/archive/task-013-report.md` |
| `docs/task-014-report.md` | `docs/archive/task-014-report.md` |
| `docs/task-016-report.md` | `docs/archive/task-016-report.md` |
| `docs/task-017-report.md` | `docs/archive/task-017-report.md` |
| `docs/micro-018-report.md` | `docs/archive/micro-018-report.md` |
| `docs/micro-022-report.md` | `docs/archive/micro-022-report.md` |
| `docs/micro-023-report.md` | `docs/archive/micro-023-report.md` |
| `docs/micro-026-architecture-audit.md` | `docs/archive/micro-026-architecture-audit.md` |
| `docs/micro-027-report.md` | `docs/archive/micro-027-report.md` |
| `docs/micro-028n-phone-connectivity.md` | `docs/archive/micro-028n-phone-connectivity.md` |
| `docs/micro-029-chatgpt-feasibility.md` | `docs/archive/micro-029-chatgpt-feasibility.md` |
| `docs/micro-030-report.md` | `docs/archive/micro-030-report.md` |
| `docs/micro-036-2-docs-audit.md` | `docs/archive/micro-036-2-docs-audit.md` |
| `docs/micro-036-stable-phone-port.md` | `docs/archive/micro-036-stable-phone-port.md` |
| `docs/task-017-evidence.json` | `docs/archive/task-017-evidence.json` |
| `docs/task-017/b-prompt-1-final.png` | `docs/archive/task-017/b-prompt-1-final.png` |
| `docs/task-017/b-prompt-2-final.png` | `docs/archive/task-017/b-prompt-2-final.png` |
| `docs/task-017/b-prompt-2-restart.png` | `docs/archive/task-017/b-prompt-2-restart.png` |
| `docs/decisions/0001-public-portfolio-repository.md` | `docs/archive/decisions/0001-public-portfolio-repository.md` |
| `docs/decisions/0002-repository-ci.md` | `docs/archive/decisions/0002-repository-ci.md` |
| `docs/decisions/0003-platform-foundation.md` | `docs/archive/decisions/0003-platform-foundation.md` |

Старые `SESSION_HANDOFF`, `architecture`, `demo-readiness`, `game-validation` и `project-brief` дополнительно сохранены в архиве как `session-handoff`, `architecture-notes`, `demo-readiness-2026-10-18`, `validation-notes` и `project-brief-2026-10-13`; на прежних путях теперь текущие руководства. Старые внешние ссылки на файлы доступны в GitHub через их исторический commit.

Сохранены на исходных путях: все runtime/assets/tests/scripts, тестовые JSON-корпуса `docs/nl-evaluation` (читаются `tests/game-intent.test.ts`), visual library и её QA, API и security contracts, инструкции backup/restore, правила CI и known-errors. Ничего не удалялось по маске. Приватные `.env`, SQLite, результаты игр, backups, ignored research и PDF владельца не читались и не включены в PR. Ни GitHub visibility, ни лицензия, ни Firewall не меняются.

## Проверки

Результаты ниже получены локально на Windows, Node 24.18.0. Внешняя генерация/OAuth не запускались. Приложение использовало отдельную `.local`/SQLite. Датированные результаты иных веток не приписываются этому PR.

| Проверка | Результат |
| --- | --- |
| `npm ci`, typecheck, production build | PASS; npm audit при установке: 0 vulnerabilities |
| `node --test tests/*.test.ts` | **491 PASS, 0 FAIL, 0 SKIP** |
| Python tests / CI policy | **19/19 / 8/8 PASS** |
| Реальный запуск `npm run app -- --no-open` | PASS, собственный loopback-порт и пустая база, авторская игра открыта обычным UI |
| Screenshot desktop/mobile | PASS: без page errors и горизонтального overflow; визуально просмотрены |
| Короткий Playwright, история/export/backup/gallery/QR | **24 PASS, 0 FAIL**, Chromium desktop/320 и WebKit390 |
| Markdown/локальные ссылки/якоря и repository checker | PASS: 61 Markdown, пути/регистр/локальные якоря |
| Gitleaks: reviewed snapshot / Git history | PASS, 0 leaks; история всех веток — 168 commits, snapshot — только reviewed Git-файлы |
| Чистый clone: установка, build, запуск и UI | PASS: clone без `.env`/`.local`, `npm ci` из download cache, typecheck/build, штатный launcher, реальное управление, offline export; после рестарта сохранены игра и SHA HTML |
| GitHub rendering, ссылки README, About | PASS через авторизованный API: настоящий HTML README, 26 локальных целей и изображение существуют в опубликованной ветке, Git blob совпадают; Description обновлён и прочитан обратно |
| `git diff --check` | PASS |

Первый browser запуск не состоялся: wrapper выбрал отсутствующий executable в новом worktree. Причина подтверждена; повтор использует существующий Playwright CLI и установленный cache с сохранением sandbox. Первичный FAIL не считается PASS и не скрывается. [Способ запуска](known-errors.md).

Чистый clone проверен на содержательном commit `b687576ed43f86ea077ecd296ff8874e052ff15a`; после него уточняется только этот отчёт. Установка использовала уже загруженный npm cache, поэтому доступность npm из новой сети не подтверждается. Build/launcher работают без копирования node_modules, `.env` или данных. Независимое заключительное чтение diff не выявило проблем; отдельно подтверждены все 234 строки inventory и побайтовая сохранность перенесённых JSON/PNG. Версия продукта остаётся `0.0.1`: этот PR не меняет исполняемый код или package metadata.

## Оставшиеся ограничения

Hosted Actions на момент GET — `enabled:false`; hosted Windows/Ubuntu/secret-scan не объявлены пройденными. Изображения/TSV не входят в allowlist docs-only FAST, поэтому policy выбирает FULL; этот PR не является release, полный hosted release gate остаётся обязательным после разрешённого восстановления Actions. Полная большая browser matrix этой документационной подготовкой не заменяется.

Новый LIVE, реальная OAuth-сессия, физические телефоны и Ubuntu runtime не проверялись. Main не включает Arena, LAN helper и visual redesign. Предложения закрытия/merge ожидают решения владельца. Открытая лицензия не предоставлена. Свежая LLM-репетиция и подтверждение официальных условий кейса остаются отдельными действиями перед защитой.

Прямой просмотр приватного GitHub UI во встроенном браузере не подтверждён: его сессия не авторизована и получает страницу недоступности. Это не ошибка репозитория и не причина менять видимость. Авторизованный API подтвердил Markdown-rendering, якорь установки, цели навигации, изображение и опубликованные байты; внешний вид самого GitHub chrome остаётся отдельной визуальной проверкой владельца. Доступ жюри к PRIVATE репозиторию также нужно обеспечить заранее, без автоматической выдачи прав в этой задаче.
