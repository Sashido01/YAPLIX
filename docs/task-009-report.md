# TASK-009 v2 — фоновые задания, восстановление и мобильный запуск

Проверено локально 14 октября 2026. Основа main: `b95174e` (TASK-008).
Отдельные границы: controlled provider fixtures, настоящий браузерный checker,
реальные облачные запросы и физические устройства. Успешный тест fixture не
доказывает качество произвольной LLM-игры или работоспособность сети пользователя.

## Запуск и пользовательский сценарий

Windows: двойной щелчок [YAPLIX.cmd](../YAPLIX.cmd). Ubuntu: `npm run app`.
Нужен Node 24.18+ (24.x) с npm. Чистый клон устанавливает зависимости;
существующий неполный node_modules сохраняется с инструкцией исправления.
Launcher собирает клиент, проверяет readiness/идентичность того же клона,
открывает каталог и повторно использует совместимый backend. Чужие процессы
не останавливает. LAN/public HTTPS включаются отдельной явной настройкой.

Создать → DEMO или LIVE → исходный запрос попадает в SQLite → можно вернуться
к текущему раунду. Центр заданий показывает настоящие этапы, время и ошибку.
При успехе новая версия и completed записываются одной транзакцией. Уведомление
предлагает «Открыть», текущий iframe/счёт не меняются. Версия доступна в каталоге,
истории и по приватному `?game=…&version=…`. Отдельный Share даёт ограниченный
семидневный доступ только к артефакту, без доступа к генерации или заданиям.

## Восстановление

| Отказ | Действие |
| --- | --- |
| `length` | Сохранить полученный код/модель/usage; ограниченный rewrite полного HTML с исходным запросом и частичным кодом; повторить static/browser check. |
| Context limit | Сохранить запрос/черновик, needs_attention; проверить ограничения/выбор модели. Автоматического увеличения бюджета нет. |
| 429 | Сохранить Retry-After и запретить Continue до срока; без автоматического платного повтора. |
| 402 / quota | Сохранить состояние, остановить автоматические вызовы, проверить квоту. |
| Timeout / оборванный stream | Сохранить доступные checkpoints и метаданные; needs_attention, ручное Continue с сохранённым контекстом. |
| Неполный/опасный HTML | Ограниченное исправление; частичный результат не становится играбельной версией. |
| Browser failure | Исправление получает оригинал/ошибку/код; broken version не сохраняется. Ошибка sandbox останавливает routes. |
| Restart | Queued ещё не отправлены; отправленные/validating/repairing переходят в needs_attention. Неизвестный удалённый результат автоматически не повторяется. |
| Нет вычислений | Запрос/черновик остаются в центре заданий; Continue после явной настройки ресурса. |

SSE и локальный NDJSON сохраняются порциями от 4 KB или с интервалом 750 ms
при поступлении данных, плюс подтверждённое окончание/ошибка. Нет записи каждого
токена, склейки произвольных документов или обещания literal token resume.
Один worker на DB; до 20 pending глобально/3 на владельца, 1000 заданий,
200000 bytes на checkpoint и 100 MB суммарно; до 6 provider dispatch за запуск,
12 на задание. LIVE dispatch, включая repair/Continue, также ограничен
6/min на владельца и 12/min глобально. Подтверждённо завершённый PID позволяет
безопасно получить lease заново; alive/unverifiable PID защищён до expiry 60 s.

OpenRouter остаётся `openrouter/free`. Ollama Cloud — отдельный opt-in endpoint
`https://ollama.com/v1` с OLLAMA_CLOUD_API_KEY/MODEL; ID проверяется через каталог.
Допустимы только явно настроенные transitions. Нет покупки кредитов/смены плана.
Официальные источники: [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility),
[актуальные cloud IDs](https://ollama.com/api/tags),
[OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming),
[ошибки OpenRouter](https://openrouter.ai/docs/api_reference/errors-and-debugging).
Если каталог сообщает output limit, запрос ограничивается сверху этим лимитом;
неподходящий бюджет ниже 2048 отклоняется до provider dispatch. Dynamic free
router не обещает одинаковую модель/лимит в каждом вызове.

## Уведомления и права

Toast имеет атомарный серверный claim. После crash между claim и показом
возможен пропуск toast; результат сохраняется в центре/библиотеке. Telegram
требует signed session, отдельный opt-in, доступный private chat и HTTPS.
При активном polling приложение считается открытым; после 30 s без presence
возможна одна попытка bot sendMessage. Claim перед сетью исключает автоматический
повтор при unknown acknowledgement; sent требует подтверждения Bot API ok=true,
message_id и matching chat.id. Доставку exactly-once система не обещает.
Полный браузерный путь независим от Telegram и Web Push.

Задания фильтруются по серверному owner, тело запроса owner не задаёт. Публичная
библиотека остаётся single-owner; многопользовательские чужие приватные игры этим
MVP не поддерживаются. Неавторизованные запросы, неправильный origin, чужой jobId
и share capability не открывают генерацию/задания. Sandbox/session authorization
сохранены. Ключей в frontend нет; `.env` не менялась.

## Приёмка и доказательства

| Сценарии TASK-009 | Доказательство / граница |
| --- | --- |
| 1, 5, 6, 12, 13 | tests/jobs.test.ts: persisted jobs, idempotency/conflict, shutdown/restart, отсутствие ресурса, ручное продолжение; controlled fixtures. |
| 2, 3, 4 | tests/jobs.spec.ts: тот же iframe realm, touch/счёт, один toast, reopen; controlled LIVE worker с настоящим browser check и DEMO на мобильных профилях. |
| 7, 8, 9, 10, 11 | tests/jobs.test.ts: length, 429/Retry-After, 402, context, interrupted SSE, explicit fallback, сохранение partial/original. |
| 14, 15 | tests/mvp.spec.ts и jobs.spec.ts: история/экспорт/адрес старой версии, cross-game version rejection. |
| 16 | tests/telegram.spec.ts: synthetic SDK/HMAC/HTTPS, тот же UI/touch; настоящий Telegram клиент отдельно. |
| 17, 18 | Owner-filtered read/cancel/continue, auth/Origin tests, подписанная Telegram identity, bundle audit и secret scan. |
| 19 | Миграция копий реальных v1 DB: сравнение содержимого всех старых строк + integrity/FK; originals read-only. |
| 20 | tests/launcher.test.ts: start/reuse/foreign service/bounded hung-child cleanup. Clean-clone smoke и Windows/Ubuntu CI проверяются при доставке. |

Локальные typecheck/build и 57 Node тестов проходят; полный первоначальный
браузерный набор: 191 PASS / 145 осознанных SKIP на 12 профилях. Дополнительный
controlled LIVE test запускается на Chromium 320/WebKit 390; итоговый current-head
полный набор и Windows/Ubuntu/secret-scan подтверждаются в PR. Дополнительный
controlled LIVE test прошёл на Chromium 320/WebKit 390 с настоящей browser
validation: текущие iframe/touch/счёт сохранены до и после проверки новой версии.

Чистый независимый Git-клон commit `537d460`, без `.env`, DB и node_modules,
прошёл первый автоматический запуск app entry, установку из project npm cache,
production build, HTTP readiness, completed DEMO job и HTML export. Собственные
launcher/backend после smoke закрылись; фактический мышиный double-click отдельно
не автоматизировался. Staged diff и commit history прошли Gitleaks. npm audit CLI
получил сетевой отказ; тот же официальный bulk advisory endpoint через Windows
HTTPS ответил без advisories для четырёх production packages.

Две реальные DB сохранены: основная — 14 games/32 versions/178 sessions/913 events;
вторая — 1/1/2/8. SHA-256 содержимого старых таблиц одинаков до/после миграции
копий; originals и `.env` неизменны. В существующей v1 DB перед миграцией создаётся
проверенный `before-v2-*` snapshot; существующие games/versions/events не удаляются.

## Скорость и облачная проверка

По семь холодных mobile runs, 390×844, DPR2, Slow 4G/CPU×4. Исходный p75 shell
664.6 ms; после изменений 645.6 ms, game start 965.5 ms, touch 7.1 ms,
API 3.1 ms. Baseline использовал накопленный fixture каталог, post — свежую
изолированную DB; это одинаковый профиль, не причинное доказательство ускорения.
Начальные gzip: JS около 8.9 KB, CSS 2.3 KB, critical assets около 13.8 KB —
ниже бюджетов 150/30/250 KB. Измерялся авторский DEMO, не произвольный LLM code.
Сорок циклов смены игры оставляют один активный iframe; context close освобождает его.

`npm run benchmark:generation` делает один provider dispatch без repair/fallback,
в отдельной DB, с пределом 60 s. Сохраняет actual route/model, attempts, request/
validation time, output/reasoning tokens при наличии, полный job time и TTFPG.
В TASK-009 выполнены ровно два отдельных бесплатных dispatch `openrouter/free`.
Оба остановлены по 60 s, без playable result/checkpoint code и без usage от
провайдера. Первый stream сообщил `cohere/north-mini-code:free`; второй не сообщил
actual model. TTFPG и ranking моделей не установлены. Запросы/ошибки сохраняются.
GameSpec — локальная структура исходного текста; отдельного LLM-вызова для неё нет.

## Кейс Билайна и внешняя граница

Матрица проверена по требованиям TASK-009 и [project brief](project-brief.md),
а не по независимо полученному официальному положению. Поиск первичного кейса
«Вайбкодинг игр / ИТ-спринт 2026» результата не дал; запрошена официальная ссылка.
Полное официальное соответствие не заявляется.

Есть natural prompt, собственный HTML/JS pipeline, start/game/end/offline export,
mobile input/opaque WebView runtime, Git history, versions/iteration, client analytics
и controlled share. LIVE не использует фиксированный DEMO template. API передаёт
audience модели, UI пока использует default; доказательства возрастной адаптации
и разнообразия/качества каждого произвольного результата нет. Аналитика описательная,
автоматическая причинная эволюция не реализована. Node/TypeScript/Hono/SQLite сохранены.

NOT VERIFIED: successful live inference в двух новых попытках, Ollama Cloud
inference без credentials, физические Android/iPhone/Telegram, внешняя HTTPS/menu/
реальная bot delivery и официальные конкурсные условия. Сетевые ограничения
TASK-008 остаются в [историческом отчёте](task-008-report.md).

Известные решения — [known-errors](known-errors.md); запуск/обслуживание — [README](../README.md).
Доставка: feature `codex/task-009-background-recovery`, PR в main, только current-head
green CI, стандартный merge и последующая проверка actual merge SHA/post-merge smoke.
