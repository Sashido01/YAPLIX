# Контекст YAPLIX для разработки

> Снимок ниже исторический и предшествует YAPLIX-RELEASE-007. Актуальный
> контракт: в production нет DEMO-игр, галереи и offline fallback; чистая
> библиотека пуста, а `tests/fixtures/` используются только проверками.
> Текущие результаты и нерешённые gates смотрите в
> [release status](release-status.md) и `.local/yaplix-release-007/REPORT.md`.

## Снимок текущей рабочей копии — 27 октября 2026

База этого снимка — `e074974629c2c871589ec560e8e0d463ac456358`
(`codex/arena-mvp`). Затем создан локальный commit `23b91bb` только для политики
в `CONTRIBUTING.md`; рабочая копия всё ещё dirty. Это не `main`, release candidate
или состояние опубликованного GitHub. Подробно: [release status](release-status.md),
[диагностика](diagnostics.md), [индекс docs](README.md). Исторические таблицы и
приоритеты далее сохранены с датами соответствующих отчётов.

Portable-поставка YAPLIX-INSTALL-002: [установка и запуск](../INSTALL.md), [сборка пакетов](installer-building.md).
Ubuntu: per-user установка без изменения ОС; независимое устройство и Windows — NOT_VERIFIED.

Проверено локально 24 октября 2026 в YAPLIX-UBUNTU-001. Это снимок состояния,
а не гарантия будущего GitHub HEAD. Подробные логи и результаты:
`.local/ubuntu-prep/REPORT.md`; инструкции: [Ubuntu](UBUNTU_SETUP.md),
[общая разработка/API/backup](development-setup.md).

UI-002A–F: локальный редизайн интерфейса — разделы Создать / Игры / Арена
(отдельной вкладки «Игра» нет; игры запускаются в рабочем пространстве «Создать»).
Статус и границы: [UI_002_STATUS](UI_002_STATUS.md).

## Git и сохранность работы — исторический снимок 24 октября

- Перенесённая копия: `codex/arena-mvp`, HEAD
  `364bd2194890df3a205f82086402b652c6f9b372`, совпадает с удалённой веткой #53.
- Независимо клонированный GitHub `main`:
  `a56fe00adc8ee215998cc1da3a9c4d6b92408f95`, merge #51. Это родитель локального
  Arena-коммита: main не содержит Arena, 36 файлов различаются.
- В начале основное дерево чистое, кроме untracked `docs/Keys_Bilayn.pdf`.
  PDF сохранён, не добавлен в индекс; его назначение/допустимость публикации
  требуют отдельного решения владельца. `.env`, SQLite и эксперименты сохранены.
- Windows worktree metadata указывает на `D:/YAPLIX/...`. Найдены 26 перенесённых
  каталогов worktree; `a1-8-3-merge-simulation` содержит staged integration changes.
  Не выполняйте prune/reset/clean. Обычная работа основной копии не требует
  удаления этих записей. Ремонт связей worktree — отдельная задача после backup.
- Запреты этого раздела описывают задачу от 24 октября. Для текущей работы
  действует [локальная Git-политика](release-status.md): локальные проверенные
  коммиты допустимы, remote operations требуют отдельного разрешения.

Открытые PR на момент проверки:

| PR | Ветка | Что отсутствует в текущем main |
| --- | --- | --- |
| #53 draft | codex/arena-mvp | LAN Arena MVP, текущая перенесённая копия |
| #54 draft | feat/ui-visual-redesign | отдельный redesign; не текущий UI |
| #56 draft | codex/lan-first-run | consent-based Windows LAN setup; base #53 |
| #57 draft | codex/final-repo | отдельная документация для жюри |
| #58 draft | codex/release-integration-001 | интеграция Arena/LAN/UI/docs, 14 commits ahead main |
| #59 draft | codex/arena-universal-001 | versioned metrics/safe preparation, base #58; 15 ahead main |
| #34 draft | test/micro-028-validator-calibration | отдельное исследование; 89 commits behind, 7 ahead main |
| #60–62 | dependabot branches | предложения обновления dependencies, не приняты в этой задаче |

Исходники этих PR не объединялись. Клонирование main не восстанавливает автоматически
все возможности draft integration. Сохраняйте точную ветку/SHA в доказательствах.

## Архитектура и контракты — проверенный контекст 24 октября 2026

Один сервер Node 24.18+ (24.x), Hono, встроенный `node:sqlite`. Лёгкий TS/esbuild
клиент; мобильный браузер не исполняет Node. `src/server.ts` запускает сервер,
`src/api.ts` задаёт API, `src/store.ts` — persistent versions/events/jobs,
`src/jobs.ts` — worker, budgets, checkpoints, cancellation и restart recovery.
`scripts/app.mjs`/`app-runtime.ts` — launcher, build и штатное завершение.

Full HTML — основной generation contract: идея → полный автономный HTML →
static validation → production Chromium checker → атомарное сохранение версии.
Изменение передаёт полный текущий HTML и сохраняет прежнюю версию. Генератор
и prompts написаны здесь; BGen и его старый checkout запрещены как reference.
Экспериментальные `src/orchestrator/` и `src/research/constructor/` не заменяют
production pipeline. GameDNA/Evolution Engine — будущая концепция; действующий
автоматический цикл эволюции по поведению игроков в production не найден.

Текущий prompt требует **весь видимый gameplay и UI в Canvas/WebGL**.
`canvas-webgl-strict-v2` проверяет 320×700, 390×700, 844×390. Старые DOM-fixtures
могут законно отклоняться с `BROWSER_DOM_GAME_UI`. Не ослабляйте validator для
прохождения старого fixture. Историческое описание «Canvas/DOM выбирает модель»
в architecture/report не является текущим контрактом.

Исправления metadata/Canvas из #49/#51 уже входят в main a56fe00. Заголовки
старых README/architecture/handoff про main 942387e и «PR ещё не слит» исторические.
Текущий parser сохраняет актуальные три профиля и исторические два без promotion.
Strict checker различает техническую исполнимость и gameplay NOT_VERIFIED:
успешное открытие HTML не доказывает достижимость победы или качество игры.

`jobs.ts` сохраняет исходный запрос, bounded checkpoint и первый raw response
в originalCheckpoint, предоставляет скачивание черновика/диагностики. Тесты
проверяют ошибки, restart, idempotency и сохранность; это не гарантия, что каждый
когда-либо существовавший внешний ответ был сохранён. Пользовательские старые
SQLite в этой задаче не открывались приложением и не мигрировались.

GameVersion играется в opaque `sandbox="allow-scripts"`, с CSP и session auth.
Events опциональны для базовой игры; offline export должен работать без сервера.
Авторские gallery games сохраняются как `authored/unverified`, без LLM provenance.

## LIVE и сети

- Default: `ollama-cloud`, только `gemma4:31b` на `https://ollama.com/v1` с серверным ключом.
- `openrouter` вручную: только `openrouter/free` на `https://openrouter.ai/api/v1`.
- A1 manual `chatgpt`: loopback-only Responses, `gpt-6.1-sol`, medium,
  store false, stream true; максимум один POST на durable job, без refresh,
  token persistence, auto retry/fallback/repair. [Ограничения](chatgpt-setup.md).
- Auto — только Ollama Cloud, без перехода на другой provider. Legacy knobs не
  разрешают платные/local/generic routes. Реальные inference требуют отдельного
  явного бюджета владельца; в Ubuntu-аудите OAuth/model GET/inference не запускались.
- Рабочие network-команды используют существующий HTTP(S) proxy процесса.
  Offline tests на этом хосте требуют отдельного окружения: [setup](UBUNTU_SETUP.md).
- Loopback по умолчанию; phone/Arena открываются по явному действию только на
  выбранном private IPv4. Public use — только protected HTTPS. Firewall не меняется.

## Arena

В текущей ветке реализованы отдельный LAN listener, scoped QR, персональные
cookie участников, независимые попытки, idempotent events и атомарный SQLite
leaderboard. Подробности: [Arena](arena.md). Для MVP нужен явный score-v1 bridge;
произвольной игре очки не придумываются. Авторский «Меткий бросок» — offline demo.
Рейтинг не является античитом: доверяет валидному потоку client game events.
Production main этого функционала пока не содержит. Более универсальный вариант
#59 существует в draft, не считается реализованным в этой копии.

## Проверки Ubuntu и приоритеты — snapshot 24 октября 2026

Node/npm и Linux dependencies восстановлены без смены lock. В обеих копиях
прошли typecheck/build, Python hygiene (19 tests), отдельный launcher/UI/API/
authored save/offline export и полное закрытие/повторный запуск с той же тестовой
SQLite. Unit suite: **499/499** в Arena-ветке, **491/491** в main после процессной
изоляции proxy. Production Canvas checker проверен на authored fixture;
реальная AI-генерация, Windows runtime и физические устройства **NOT_VERIFIED**.
Browser profile outcomes и обнаруженные ограничения указаны в локальном REPORT.

| Приоритет | Следующая задача | Критерий |
| --- | --- | --- |
| P0 | MICRO Ubuntu worktree recovery | Backup dirty index/files, ремонт Windows gitdir paths без потери staged интеграции |
| P0 | MICRO release candidate selection | Владелец выбирает #53 vs #58/#59; reviewed integration и повторные проверки точного SHA перед публикацией |
| P0 | MICRO real-generation acceptance | Отдельный явный бюджет; raw/checkpoints, checker/save/play/restart/export на реальных ответах, без подмены offline |
| P0 | MICRO physical demo acceptance | Настоящие Android Chrome/WebView, iOS Safari/WKWebView и Telegram; Wi-Fi/QR/Arena, restart и повторный вход |
| P1 | MICRO validation calibration | Разобрать реальные false rejects на сохранённом HTML; сохранять strict gate, source и точную причину |
| P1 | MICRO clean release rehearsal | Точный выбранный release SHA, clean clone Windows/Ubuntu и manual FULL по политике CI после отдельного разрешения Actions |
| P1 | MICRO demo rehearsal | Авторский offline fallback с честной маркировкой, backup/restore, диагностика сети и сценарий 3–5 минут |
| P2 | MICRO GameDNA exploration | Отдельное продуктовое решение после стабильных generation/validation/Arena; не блокирует текущий offline запуск |

Номера новых MICRO не резервируются этим документом. Проверяйте issue/branch
состояние перед следующей задачей; список выше задаёт порядок, не разрешение на
публикацию, inference, системную настройку или восстановление hosted Actions.
