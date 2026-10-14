# TASK-010 — автономное восстановление, аркады и Telegram

## Как запустить YAPLIX сейчас

Windows: двойной щелчок [YAPLIX.cmd](../YAPLIX.cmd). Ubuntu: `npm run app` из
корня клона. Нужен Node 24.18+ (24.x) с npm. Каталог → игра → «Играть»/«Старт».
DEMO и две собственные reserve-игры работают без LLM; authored/unverified явно
отличается от LIVE. Авторская игра сохраняется только по явному нажатию пользователя.
Телефон открывает доступный защищённый HTTPS/LAN адрес; Node/Ollama ему не нужны.
После update кода/`.env` закройте только свой старый backend и повторите запуск.
Build identity фиксируется при старте и не даёт launcher переиспользовать старый
same-schema процесс; tunnel проверяет ту же identity. Неизвестные процессы не останавливаются.

Исходная main: `2c415385324c7fe986bfd95c0c877ab8e81faaf0`, ветка
`codex/task-010-autonomous-games`. Дата локальной проверки: 2026-10-14.
Документ отделяет source audit, controlled tests, реальные cloud вызовы,
проверку отдельного HTML и physical/external acceptance.

## Причины и изменения

Прежний deadline engine мог достигать 300 s; после recoverable ошибки job
останавливался до ручного Continue. Теперь durable metadata существующей SQLite
сохраняют automatic budget, deadline, retryAt, cooldown и origin checkpoint.
Recovery сначала проверяет полный подтверждённый checkpoint без нового LLM POST;
неполный код получает controlled rewrite с исходным запросом и конкретной ошибкой.
Извлечение неполного HTML больше не заменяет полезный raw response пустым placeholder.

Default automatic cycle: до 6 provider dispatch суммарно, до 4 worker runs,
600 s включая ожидание; один transport request до 60 s. Retry начинается с 2 s,
exponential backoff ограничен 60 s; Retry-After соблюдается. Lifetime budget ≤12
вызовов на job, ручной Continue не обнуляет attempts. Quota/auth/model/context/
неподходящий output budget охлаждают route на 15 min. Переходы только на явно
настроенные routes. Неизвестный потенциально оплаченный запрос не повторяется
слепо по тому же route. При отсутствии ресурса/бюджета остаются запрос, draft и
понятный blocker; создание игры при любых внешних условиях не гарантируется.

Schema game DB остаётся v2; новые поля помещаются в jobs JSON. Новой generation
очереди, Redis или отдельного frontend нет. Старые HTML/provenance не переписываются.
Готовая версия по-прежнему сохраняется атомарно вместе с completed job; toast
предлагает явное «Открыть» и не переключает текущий iframe.
UI показывает последние три неудачных route/model и причины переходов, сохраняя
полную историю в metadata задания.

OpenRouter default — конкретная `google/gemma-4-31b-it:free`. Перед dispatch
проверяются exact official base, наличие concrete :free ID и явно нулевые
prompt/completion prices. При неизвестной цене — отказ. Legacy openrouter/free
совместим; платного OpenRouter fallback нет. Ollama Cloud — отдельный explicit
route с существующей account quota; credits/план автоматически не покупаются.
ID из каталога сам по себе не доказывает право на inference.

## Реальные облачные запросы и game quality

Ограниченный опыт: 12 внешних generation POST, включая два малых coding probes.
Это не массовое сравнение и не рейтинг «лучшей» модели. Артефакты/evidence остаются
в ignored `.local/task-010`, не публикуются и не подменяют пользовательскую библиотеку.

| Проба | Наблюдаемый результат / граница |
| --- | --- |
| Ollama Cloud gemma4:31b, малый coding prompt | HTTP 200, полный короткий ответ, 1149 ms, 140 output tokens. Это inference, не gameplay. |
| Ollama Cloud kimi-k2.7-code | HTTP 402, несмотря на наличие в каталоге. Account entitlement не подтверждён; повторная серия не выполнялась. |
| Ollama Cloud shooter | Первый HTML отклонён из-за JS, следующие ответы оборвались. Проверенная shooter-игра этими попытками не получена; prompt/draft сохранены. |
| Concrete free OpenRouter shooter | Два 429 с ожиданием 60 s, без игрового результата. Это наблюдение текущей доступности, не вывод о качестве модели. |
| Ollama Cloud falling blocks | Два исходных ответа отклонены: BROWSER_GAME_AREA, затем BROWSER_EVENT_ORDER. Один дополнительный targeted repair принят checker на третьем вызове: API 8725 ms, validation 2432 ms, 3288 output tokens, HTML 9908 bytes. |
| Ollama Cloud shooter, direct prompt | Последняя отдельная попытка с maxCalls=1 без auto repair/fallback: API 12111 ms + validation 2515 ms, total 14662 ms, 3560 output tokens, HTML 12486 bytes; checker и отдельный gameplay scenario описаны ниже. |
| Ollama Cloud shooter, spec prompt | Один тот же пользовательский запрос и та же модель, maxCalls=1: JS exception, API 17410 ms, total 18778 ms, 3952 output tokens, HTML 11352 bytes; не playable acceptance. |

Последние direct/spec пробы — по одному наблюдению, не статистический выбор лучшего
prompt/model. Локальная конфигурация владельца и `.env.example` явно выбирают
`LLM_PROMPT_STYLE=direct`; code default остаётся `spec`, если параметр не задан.
Direct передаёт естественный запрос, spec использует структурированный specification;
оба сохраняют общий game contract, validation и правила безопасности. Evidence последних
проб: `.local/task-010/live-ollama-shooter-5e14ec6a-21de-405d-bfc3-102d2ecfe0d3`
и `.local/task-010/live-ollama-shooter-9e865c1d-43d3-413d-99b5-dcd3a0b900eb`.

Эти стили не добавляют отдельного LLM interpretation call. Новых inference после
12 ограниченных POST не выполнялось.

Falling-blocks HTML подтвердил **startup/input/pause/offline на 320/390 px**. Отдельный
browser сценарий с DOM input и read-only state, без injection, наблюдал touch,
rotation, locking, restart и поражение на обоих размерах. На 320 px достигнута
победа: 520 points после 8 locks; на 390 px игра закончилась поражением после
38 pieces. Это один набор случайных партий, не гарантия победы для каждого seed.
Сами по себе read-only state/общий gate ещё не доказывают все обещанные
falling-blocks/explosion mechanics. 11.16 s — длительность успешной попытки, а не сквозной TTFPG с
двумя предыдущими отказами и отдельным targeted repair. Reasoning usage не получен.
Один принятый артефакт не доказывает устойчивое качество произвольных игр.
Последний direct shooter отдельно прошёл offline gameplay на 320/390 px:
DOM touch двигал корабль и создавал projectile; keyboard autoplayer прошёл все
3 waves, набрал 450 points и достиг MISSION ACCOMPLISHED. Restart восстановил
3 lives/0 score; JS errors отсутствовали. Использовались реальные DOM controls
и read-only actual state без state injection. Playwright virtual clock составил
25.2/21.8 s simulation time; это синтетическое время, не latency/physical proof.
Evidence: `gameplay-evidence.json` в указанном direct shooter directory. Поражение
этого shooter отдельным сценарием пока не подтверждено. Оба реальных HTML — shooter
и blocks — повторно прошли усиленный checker с фактическим resume после pause,
offline на 320/390 px, без нового API вызова.
Публикуемые generic quality levels ограничены HTML_VALID, JS_EXECUTABLE,
UI_VISIBLE, MOBILE_VERIFIED. Короткий checker проверяет также pause и фактический
resume через видимую кнопку/переключатель; arbitrary gameplay/end/input correctness
не объявляются отдельными подтверждёнными уровнями.

Собственные «Искры в клетках» и «Световой лабиринт» — presentation/runtime reserve,
method authored, validation unverified. Они не участвуют в LIVE fallback и не
маскируют неудачный LLM вызов. Отдельные controlled browser сценарии на Chromium
390/WebKit 320 наблюдали у blocks движение/rotation/gravity/collision/locking,
row clear/explosion/win/loss/restart/offline; у maze — стены/движение/score/pursuit,
win/loss/restart/offline. Это scenario proof авторских fixtures, а не proof LIVE.

## Telegram и публичный доступ

Bot API consumer запускается с token + single owner независимо от tunnel;
TELEGRAM_UPDATES=off выключает его. /start, /games, /new, /status, /help используют
существующие данные и общий Mini App frontend. Без подтверждённого HTTPS бот
остаётся текстовым. Текущий endpoint/instance/lease проверяются перед web_app
кнопками; menu setting/clearing с readback отделены от реального запуска клиента.
Ошибка command/menu настройки логируется и не останавливает текстовый poller;
identity/webhook/consumer conflicts остаются блокирующими.

Один consumer координируется atomic transaction в per-bot SQLite отдельно от
game DB/порта. Webhook/competing consumer не обходятся; update offset сохраняется
до отправки reply, поэтому crash может потерять ответ. Exactly-once доставки нет.
Notification остаётся отдельным opt-in; неизвестный acknowledgement не вызывает
автоматическую повторную отправку. API/library остаются owner/key защищёнными.

Реальный bounded poller подтвердил два существовавших owner `/start` и два
sendMessage acknowledgement Bot API без ошибок; setMyCommands выполнен один раз.
GetMe подтвердил ожидаемого бота, webhook пуст. Каталог для этого опыта читался
из согласованной копии с 14 games, original game DB не менялась. HTTPS отсутствовал:
проверен текстовый /start, а реальные /games/new/status, меню Mini App и чтение
сообщения физическим клиентом этим не доказаны. Полные command scenarios остаются
controlled tests. Evidence: `.local/task-010/telegram-live.json`, без token/user IDs.

LAN/QR не равны публичному HTTPS. При сетевом блокере Quick Tunnel описан
отдельно подготовленный Caddy/reverse-proxy host; Caddy не устанавливался и
production deployment не выполнялся. [Настройка и границы](telegram.md).
Один bounded реальный HTTP/2 smoke с существующим pinned cloudflared и изолированной
DB завершился PUBLIC_HEALTH_FAILED после 61791 ms. Внешний health и menu не
подтверждены, URL не сохранён; собственные backend/connector закрыты. Firewall/TLS
не менялись, сетевая root cause не установлена.

## Производительность и проверки

Baseline `.local/performance/task010-baseline.json` и final
`.local/performance/task010-reviewed.json`: по семь cold contexts 390×844,
DPR2, Slow 4G/CPU×4, прогретый server.

| Метрика | Baseline | Final |
| --- | --- | --- |
| Shell p75 ms | 618.8 | 638.9 |
| Game start p75 ms | 958.07 | 961.6983 |
| Touch p75 ms | 5.4 | 5.2 |
| API p75 ms | 3.08 | 3.2778 |
| Initial JS gzip bytes | 8893 | 9348 |
| CSS gzip bytes | 2332 | 2332 |
| Critical gzip bytes | 13775 | 14318 |

Промежуточная последовательная загрузка games/gallery дала shell p75 около
796 ms; параллельный запрос устранил добавленный сетевой round trip. Final всё
ещё выше baseline; ускорение относительно исходного состояния не заявляется.
Бюджеты 150000/30000/250000 B соблюдены. Shell, game start, browser validation и
LLM timing измеряются отдельно; профиль не доказывает physical device performance.
Memory probe оставил 1 iframe после 40 циклов; исторический результат 0 iframe
другого сценария не переносится на TASK-010 и сам по себе не доказывает отсутствие утечки.

Локальный текущий `npm test`: 106 PASS, production build/typecheck пройдены.
Negative valid-HMAC/wrong-buildId включён; launcher+tunnel subset: 14 PASS;
отдельный reviewed engine/recovery/bot subset: 52 PASS. npm audit --omit=dev:
0 vulnerabilities. Независимый source security review не оставил P1/P2 findings.
Counts разных запусков не складываются в один full-suite результат. После исправления
устаревшего metadata assertion targeted generation/jobs run дал 11 PASS/7 skips.
Следующий полный browser run: 216 PASS/155 intentional skips/1 FAIL — Chromium
ERR_NO_BUFFER_SPACE на page.goto до открытия страницы. Изолированный повтор
jobs/chromium-390: 2 PASS/1 intentional skip, включая упавший scenario; source/tests
ради обхода ошибки не менялись. Полный current-head browser результат ещё должен
подтвердить hosted CI. Current-head CI и post-merge smoke фиксируются после выполнения.

Независимый чистый клон implementation commit `6faa02f` без `.env` и node_modules
прошёл автоматический npm ci из project cache, build, HTTP readiness, persistent
DEMO job, HTML export и явное сохранение authored game без duplicate version.
Реальный `cmd.exe /d /c "YAPLIX.cmd --no-open"` в этом клоне завершился exit 0
и переиспользовал тот же backend. Закрытие attached launcher не остановило backend;
после проверки закрыты только собственные процессы. Это CMD automation, не physical
double-click/device proof. Evidence: `.local/task-010/clean-clone-evidence.log`.

Source changes и единичный внешний ответ сами
по себе не являются PASS tests или готовностью конкурсной демонстрации.

## Не подтверждено

Все genre/prompt требования и все механики выбранных LLM HTML, shooter loss scenario,
реальные Telegram /games/new/status, client/menu delivery, доступный внешний HTTPS,
physical Android/iPhone/Telegram пока не заявляются. Официальный кейс предоставлен
владельцем как локальный `docs/Keys_Bilayn.pdf` (2 страницы); [матрица обязательных
требований и бонусов](demo-readiness.md) сопоставлена с его содержимым. Prompt,
реальный generated code, история и AI подтверждены в указанных границах;
playable mechanics и WebView имеют сценарные/device ограничения. Команда 2–4
человека и фактическая презентация 3–5 минут не подтверждены. Analytics display
не является автоматическим analytics feedback в LLM; отдельного AI asset pipeline
нет. Формальная приёмка организаторов не заявляется. Windows/Ubuntu CI, merge и main smoke
не считаются завершёнными до фактического подтверждения.

Copy audit `.local/task-010/data-proof/evidence.json` сравнил содержимое старых
таблиц по SHA-256: v2 база содержит 14 games/32 versions/181 sessions/924 events
и 2 existing jobs; их rows сохранены. Отдельная v1 copy с 1/1/2/8 прошла прежнюю
защищённую миграцию в v2 с сохранением old rows. В обоих результатах originals
не изменены; `.env` hash в период этого аудита также совпал. Это проверка копий,
не разрешение переписать реальные игры или опубликовать generated HTML.
Значения ключей в отчёт не включаются. После copy audit изменены только разрешённые
несекретные provider/prompt-style настройки `.env`; ключи и посторонние строки
сохранены, gemma4:31b уже присутствовала. Это отдельное изменение конфигурации,
поэтому полный `.env` за всю задачу не объявляется неизменным. Правила backup/update прежние:
[development setup](development-setup.md), [известные решения](known-errors.md).
