# MICRO-029: локальная приёмка Visual Library

Дата: 2026-10-17. База: main `bf85925968372b072a507696aa43b63da4a2b8bc`
(PR #35). Область: только Visual Library и два узких Playwright-файла.
Генератор, runtime, провайдеры, промпты, SQLite, Telegram и сетевые настройки
не изменялись. Реальных LLM вызовов не было. PR #34 / #37 не изменялись.

## Воспроизведённые дефекты и исправления

- Pixel Breaker: после столкновения с первым кирпичом `score=50`, `alive=false`;
  resize на исходном main возвращал `alive=true`. Регрессия сначала упала именно
  на этом сравнении. Создание раунда теперь отделено от layout существующих
  объектов: row/col, alive, points, score, lives и state сохраняются. Платформа
  и мяч адаптируются к новой области; vx/vy запущенного мяча сохраняются.
  Незапущенный мяч остаётся на платформе. Restart создаёт полный новый раунд
  и очищает удерживаемый ввод. Начальная ширина кирпичей сохранена.
- Neon Arcade, Pixel Retro, Standalone: при portrait → landscape игрок оставался
  ниже видимой области. Smoke воспроизвёл это в Chromium 390×844. Resize теперь
  обновляет высоту игрока и ограничивает его x, не сбрасывая счёт/цели.
- Neon Survivor: mouse down не двигал игрока. Добавлено следование мыши на canvas,
  очистка ввода при mouseup/blur, ограничение игрока и touch-target при resize.
- README: закрыт последний Markdown fence; API сверено с девятью экспортами
  effects.js. Убраны неподтверждённые заявления о проверенных телефонах, размере
  minified, стабильном FPS и гарантированной защите от утечек. Уточнены inline
  копии, ограничения dt, safe-area и отсутствие terminal/restart у базовых демо.

## Выполненные проверки

```powershell
npm run typecheck
npm run build
node --test tests/constructor.test.ts tests/rules-probe.test.ts
node scripts/browser-tests.mjs test --config tests/visual-library.config.ts
git diff --check
```

- Typecheck и build: PASS. Существующие чистые unit-контракты: **10/10**.
- Playwright: **96/96** (8 сценариев × 12 профилей), Windows, установленные
  Chromium, Firefox и WebKit. Использованы профили проекта: Chromium desktop,
  320×568, **360×640**, **390×844**, 430×932, tablet 768×1024; Firefox desktop
  1366×768; WebKit 320×568, 360×800, 390×844, 430×932, tablet 768×1024.
- Каждый из пяти HTML: START, keyboard, mouse, mobile touch, canvas/DPR,
  portrait/landscape resize, сохранение score/lives, отсутствие горизонтального
  скролла, видимость игрока после resize. Для четырёх примеров до resize
  получен ненулевой счёт через обычный обработчик столкновения; у Breaker это
  проверяет отдельная регрессия.
- Breaker: реальное выполнение collision/update разрушает кирпич; поворот,
  320×568 и возврат сохраняют весь alive-массив, score=50, lives, state, vx/vy.
  Далее столкновения со всеми оставшимися кирпичами приводят к WON; после
  restart три потери мяча приводят к LOST. Проверены terminal resize, полный
  reset, незапущенный мяч на платформе и обе границы платформы.
- Survivor: сбор 10 предметов приводит к WON, три столкновения с врагами — к
  LOST, restart очищает счёт/жизни/объекты. Это проверки реальной логики с
  детерминированной постановкой объектов через Playwright, не прохождение
  всей игры человеком и не доказательство сложности/баланса.
- effects.js: точный набор экспортов, частицы/update/dead/drawAll, explosion,
  clamp, collides, clampDelta, clearInput, start/stop/idempotent start.
- Для всех сценариев проверены `pageerror`, console error и failed requests.
  Ресурсы выдаются Playwright route из allowlist этих пяти HTML и effects.js;
  любой внешний или неизвестный запрос вызывает провал. Backend не запускается.
- Просмотрена контактная подборка 10 скриншотов Chromium 390: каждый пример
  до и после поворота. Остальные скриншоты сохраняются в
  `.local/micro029-browser/` (не коммитятся).
- Gitleaks с redaction проверяет assets/visual-library и два новых тестовых
  файла; source audit проверяет внешние URLs и сетевые API. Новых внешних
  обращений и секретов не обнаружено. `git diff --check`: PASS.

## Границы доказательств

Первый запуск Firefox внутри ограниченного executor завершался
`browserContext.newPage: Target crashed` до загрузки HTML. Повтор вне executor
прошёл; точная внутренняя причина crash не установлена. WebKit на Windows не
поддерживает `new Touch(...)`: harness использует native Playwright tap для
START, а для удержания/отпускания — явно синтетические DOM touch events.
В Chromium удержание touch проверяется через CDP Input.dispatchTouchEvent.
Это не ошибки HTML и не доказательство физических устройств.

**NOT_VERIFIED:** физические Android/iOS, Chrome/System WebView, Safari/WKWebView,
Telegram, вырезы/safe-area и экранная клавиатура на устройствах, длительные
сессии, FPS/Slow 4G/CPU benchmarks, hosted Windows/Ubuntu CI. Полный suite
платформы не запускался: эта задача не меняет платформу и не открывает её БД.
Hosted Actions оставлены выключенными (`enabled:false` подтверждено read-only
GitHub API); отсутствие checks не считается зелёным CI. Интеграция с генератором
вне задачи. MVP и LIVE платформы повторно не проверялись.

Справка по наблюдённым ошибкам находится здесь, внутри разрешённой области;
общий `docs/known-errors.md` не менялся из-за явной границы MICRO-029.

## Передача

READY_FOR_REVIEW после локальных проверок. Ветка
`fix/micro-029-visual-library-qa`, отдельный PR в main. Автоматический merge
запрещён условиями этой задачи. Пользовательский `docs/Keys_Bilayn.pdf` сохранён
неотслеживаемым и не включён в коммит.
