> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# Текущий статус — MICRO-036.2

> MICRO-036.3, 19 октября 2026: в ветке [PR #46](https://github.com/Sashido01/YAPLIX/pull/46) metadata contract исправлен: текущий Full HTML сохраняет три профиля, исторические два читаются без добавления landscape. Полный offline job/checker/save/API путь проверяется тестами. PR ещё не слит; LIVE и общий MVP этим не подтверждены. Аудит MICRO-036.2 ниже описывает исторический main `942387e`, а не исправленную ветку. [Исправление и границы](../known-errors.md).

18 октября 2026 (Europe/Moscow). Проверенный main/база:
`942387eb1fc06792767bddf2ae766cd0ed4676ff` — merge PR #44, MICRO-036.1.
При старте отслеживаемые файлы чистые; только untracked PDF владельца, не читался.
Это snapshot на указанном SHA, не самоссылочный HEAD нового docs commit.

- Phone QR: постоянный default 52604, override `YAPLIX_PHONE_PORT`, без random
  fallback. Android/Brave: подключение, «Волк ловит яйца», refresh/re-entry и
  отключение доступа подтверждены владельцем; independently observed не заявлен.
  Version ID/LLM provenance игры неизвестны; restart YAPLIX и другие физические
  сценарии не добавлены к PASS. [Точные границы](micro-036-stable-phone-port.md).
- MVP/demo **PARTIAL**. Блокер свежего Full HTML Save/Ready: checker profiles
  `[320,390,844]` несовместимы с parseArtifact `[320,390]`; synthetic probe
  воспроизвёл `INVALID_GENERATION_METADATA`, без LLM/SQLite. Код не меняется.
- Исторические LLM successes — [MICRO-027](micro-027-report.md), [TASK-010](task-010-report.md).
  Новый LIVE в MICRO-036.2 не запускался, inference/repair POST **0**.
- [Демонстрация 4:30 и матрица 8+7](demo-readiness-2026-10-18.md): saved LLM fallback должен
  быть проверен до выступления; выбранного подтверждённого резерва в этом аудите нет.
- PR [#34](https://github.com/Sashido01/YAPLIX/pull/34) и
  [#37](https://github.com/Sashido01/YAPLIX/pull/37) — OPEN Draft, не изменялись.
  Actions read-only GET `enabled:false`; отсутствие hosted checks не PASS.
- NEXT: review отдельного docs-only PR без merge; затем отдельная задача на
  metadata contract и разрешённая проверка provenance/репетиция. Production,
  Firewall не менялся; `.env`, пользовательские SQLite/HTML и ignored research
  не читались и не изменялись.

[Противоречия, исправления и оставшиеся пробелы](micro-036-2-docs-audit.md).
Ниже — исторические handoff, их HEAD/вердикты относятся к датам соответствующих задач.

---

# MICRO-027 — reliability, diagnostics and LIVE delivery

2026-10-17. Baseline main `ff1a952`; [current report](micro-027-report.md).
Metadata-only per-job UTC trace, safe report download, exact-version On phone
entry points, critical-error precedence and SSE framing fixes. OpenRouter is
experimental/manual only, including retries, repair and restart recovery.

Four guarded inference POST: Ollama connect timeout; Blueprint HTTP200 but
BLUEPRINT_INCOMPATIBLE; Ollama Full HTML2770 tokens/9894 bytes delivered after
checkpoint revalidation without another POST; OpenRouter HTTP200 upstream
cohere/north-mini-code:free failed at wire cap. Real keyboard/touch win/loss/
restart, persistence/export and decoded exact-version LAN QR verified. Real edit,
physical devices and landscape playability remain unverified; landscape screenshot
shows clipped generated controls. Product PARTIAL, Router UNRELIABLE, Blueprint
ITERATE. Evidence `.local/micro027/`; user DB/.env/PDF preserved. Actions disabled.
Local gates: units246, Python19, policy8 PASS; final Playwright28+28 PASS
with21+8 intentional profile skips; typecheck/build and secrets PASS.
MICRO-025 completion still unconfirmed. See final delivery receipt for merge SHA.

# MICRO-026 — isolated Game Constructor PoC

2026-10-16, baseline main `37653b984e41f7486f218e055673857222b96ecb`;
MICRO-025 absent. [Architecture audit and results](micro-026-architecture-audit.md)
is the main report. Source: src/research/constructor; explicit offline runner:
`node scripts/constructor-proof.ts` (`--quick` omits 21 timing runs).
Exports/schema/action receipts/screenshots stay in ignored `.local/micro026/`.

Audit PASS; bounded offline PoC PASS; adoption decision ITERATE. Existing
grid/physics/score reused; no Phaser dependency or production generator changes.
Three distinct games: real desktop and touch win/loss/restart, plus executable
key/spawn/chase/goal module variant and two House themes. All authored fixtures,
not LLM output. Typical HTML15.8–16.3KB, gzip6.2–6.4KB; warmed compilation p75
3.67–3.83ms and mobile local interactive p75 385.89–395.58ms, 7 cold contexts/game.
These omit LLM inference and do not establish an E2E speed/quality advantage.

Typecheck/build PASS, units235/235, Python19/19, policy8/8, existing runtime
Playwright8/8; constructor gameplay/layout/export/CSP probes and existing checker
PASS. Expanded legacy production suite has 7 failures from old cloud/local-route
fixtures; first reproduced on exact baseline main. See known-errors and report;
no route relaxation. Physical devices/WebViews/real keyboard NOT_TESTED.
345 protected hashes:344 same; only synthetic Telegram test-consumer ledger
changed by existing tests, no user DB/.env/PDF/Visual Kit changes.

Production/MVP UNCHANGED; LIVE NOT_TESTED, real inference POST0. Actions disabled
(baseline79 runs/latest38877566527), no workflow change or dispatch. Git delivery
receipt supplied in PR/final report. NEXT: separate legacy harness repair,
owner-budgeted equal-prompt LIVE A/B/C + edits/originality, physical mobile tests.

---

# MICRO-024 — One-click LAN QR / mobile testing

16 октября 2026. Baseline main/origin/main `6728272a14a1be217118d3551e1866e66ea93153`
(PR #30), ветка `codex/micro-024-lan-qr-mobile`. Это внутреннее изменение, не release.

## Пользовательский сценарий

`YAPLIX.cmd` → открыть свою игру → «Подключить телефон» → выбрать физическую
сеть, если их несколько → камера телефона → выбранная версия. QR появляется
автоматически после bind/self-probe; адрес/порт фактические. Обновление выдаёт
новый token/порт, прежнее подключение отзывается. «Отключить доступ», TTL 30 min
и shutdown закрывают listener. Если игра ещё не выбрана, предложена последняя
сохранённая; выбор виден над QR. После новых edits выберите новую версию явно.
При уже работающем старом backend launcher требует перезапуска обновлённой сборки.

## Реализация и границы

- Loopback owner сохранён. Второй listener внутри того же процесса и Store,
  без второй пользовательской базы, копирования игр или миграции schema.
- Windows active physical adapters + private IPv4, исключение VPN/virtual;
  при нескольких сетях нужен выбор, при ошибке OS inspection fail-closed.
- Read-only mobile scope только одной сохранённой версии. Random 256-bit token
  в fragment, bounded POST redemption, HttpOnly SameSite cookie, 30 min.
  Нет owner API, библиотеки, jobs, backups, настроек, файлов или session writes.
  Token/secret не попадают в HTTP URL/logs; не передавайте саму QR-ссылку посторонним.
- Оpaque iframe/CSP сохранены. Phone shell учитывает short viewport, safe-area,
  restart и browser-history restore с повторной проверкой доступа. Прогресс
  телефонного запуска не сохраняется. HTTP подходит только доверенной LAN.
- Firewall/router/routes не изменялись. При блокировке разрешите Node.js только
  для доверенной частной сети. VPN LAN access и guest/client isolation — внешние
  условия; self-probe на ПК не доказывает доступ физического телефона.
- LIVE диагностика раньше означала GET models + 3 s timeout. Теперь источник,
  время/код служебной проверки и сохранённый success текущего provider раздельны.
  Квота/rate limit inference не проверялись. «local» → «Сервер на этом компьютере».

## Проверка существующей игры

Неизменённый MICRO-023L HTML прочитан из private evidence, применён только в
in-memory Store. Его SHA-256 совпадает до/после; исходные SQLite/игры не редактировались.
На настоящем Wi-Fi listener и отдельном Chromium Pixel5 390×844 клиенте этого ПК:
QR independently decoded == returned URL, joystick visible, настоящий touch
сдвинул player x300→412, restart/reload работают, overflow=false, JS errors=0.
Это read-only mechanical proof этой версии, не полная проверка игры и не телефон.
Private receipt/screenshots — `.local/micro024/`, не включать в публичный diff.

Исторический hidden joystick зависит от окружения: standalone setContent всё ещё
даёт ontouchstart=false/hidden; текущий served opaque iframe даёт true/visible.
Единственная проверка ontouchstart в артефакте непереносима. HTML владельца не
исправлялся. Prompt усилен Pointer Events/cancel/visible fallback/maxTouchPoints;
мобильный validator использует taps без клавиатуры и не обещает универсальный
gameplay PASS. Source regex, автоматически меняющий или отвергающий произвольный
HTML по одной строке, не введён. Новое качество LLM этим не проверено.

## Verification receipt

Typecheck/build PASS; Node unit 230/230; Python 19/19; CI policy 8/8.
Phone/mobile browser matrix 72/72 на 12 профилях (Chromium/WebKit 320/360/390/430,
tablet; Chromium/Firefox desktop). Validator + phone gates 14 PASS / 16 intentional
profile skips. Повторный phone smoke после UI review — 24/24; Git receipt в PR.
7 cold Slow4G/CPU×4 synthetic runs: interactive p75 664 ms; game launch 999 ms,
touch 7.2 ms, API 2.5 ms. Initial JS gzip 10965 B, CSS 2385 B, total 16777 B;
phone UI грузится отдельно. Это local timing с synthetic game, не скорость LLM
или физического телефона; сравнение с дооптимизационным baseline не заявляется.
QR decode, multiple adapters, exact selected address, invalid/expired access,
private API denial, Host/Origin/forwarded, failed bind/self-probe cleanup,
busy/shutdown guards, touch/rotation/restart/reopen/expiry покрыты локально.
Browser emulation и отдельный сетевой клиент на ПК не равны физическим устройствам.
Android Chrome/System WebView, iOS Safari/WKWebView и Telegram — NOT_TESTED.
Другой физический LAN-клиент/VPN/firewall/router isolation — NOT_TESTED.

**LLM: 0 новых inference POST**, repairs/fallback не запускались; маршруты
Ollama Cloud gemma4:31b и manual OpenRouter openrouter/free сохранены. Пользователь
сообщил об успешном создании/изменении после MICRO-023L; это owner evidence, здесь
новая независимая LIVE-приёмка не выполнялась. Доступность квоты не утверждается.

**CI:** repository Actions enabled:false, baseline 79 runs / latest 38877566527;
не включать и не запускать. Hosted Ubuntu/Windows и release FULL не заявляются.
Оригинальные FAST/FULL требования остаются. Gitleaks history и reviewed manifest — без находок; diff/repo checks PASS.
Protected baseline: из 328 файлов 327 hashes совпали; изменился только
consumer SQLite synthetic token из tests/tunnel.test.ts:18. User SQLite/.env,
игры/версии, PDF и Visual Kit не изменялись. Git merge SHA — в PR receipt; exact release FULL отдельно.

## Проверка владельцем / NEXT

На доверенной общей сети откройте свою игру, «Подключить телефон», сканируйте QR
на Android/iPhone, Start → движение/действия → Restart → повторное открытие.
Поверните телефон, проверьте края управления. Затем «Отключить доступ»: повторная
загрузка должна завершиться ошибкой доступа/соединения. Для physical PASS нужны
точные устройство/OS/browser и наблюдаемые действия; пока Physical NOT_TESTED.
MVP phone scenario технически реализован; physical acceptance остаётся открытой.

---

# MICRO-023L — Fresh LIVE acceptance: PARTIAL

16 октября 2026. LIVE проверен на main
`d66151a27cbaa7db2a04e13b2e0ec1de3ebbe20e` (PR #29), после ff-only pull.
Штатный YAPLIX.cmd, отдельные port3293 и `.local/micro023l/acceptance.sqlite`.
**Реальных inference POST: 1 из разрешённых максимум 2**, только Ollama Cloud
gemma4:31b. HTTP200, finish_reason=stop + DONE; HTML13710 bytes без усечения,
точное совпадение raw SSE content / saved version / export по SHA-256.
Input477/output4546 tokens; TTFB886ms, stream12327ms, request с catalog13149ms,
validation1546ms, job14699ms. Сохранены 1 game / 1 version / 1 completed job.

Реальные клавиши: движение, 20/20 сборов, score0→20, пустой список мусора и
win terminal DOM; контакт с тараканами, потеря здоровья, loss при health0 и
restart с score0/health3/20 items подтверждены. Runtime errors0. Данные считывались
только для навигации/сверки, state/score/HTML и terminal handlers не изменялись.
Полноэкранный screenshot финала не захватил полезную картинку iframe; win proof
опирается на журнал реальных действий, собранные предметы и terminal DOM.

**FAILED: touch в Chromium Pixel5 390×844 emulation.** maxTouchPoints1 и
pointer:coarse=true, но `'ontouchstart' in window=false`. Модель показывает
джойстик только по последней проверке: display:none, rect0×0; реальный touch
swipe оставил персонажа (300,300)→(300,300). Физические устройства NOT_TESTED.
Полная техническая проверка не обещала gameplay PASS: её аспекты были NOT_VERIFIED.

По owner stop condition второй POST **не выполнен**; запрос аптечек, новая версия
и свежий editing E2E не проверены. Нет edit permit/second dispatch ticket.
Предел защищён durable atomic tickets перед fetch, кроме per-job maxCalls1;
retry/fallback/OpenRouter/repair выключены. HTML сохранён без ручного исправления.
Export/reopen проверены; exported file работает клавиатурой offline после
штатного закрытия только изолированного backend. SQLite quick_check ok/FK0.
User DB осталась 24 games / 42 versions / 21 jobs; все 321 baseline hashes
не изменились (.env/PDF/existing SQLite включены). Приёмочные браузеры закрыты.
Typecheck/build и 35 critical units PASS. Actions остаются disabled.

VERDICT: Technical pipeline PASS; Generation PARTIAL; desktop gameplay VERIFIED,
Chromium touch FAILED; Editing PARTIAL/NOT_RUN; Overall PARTIAL. Код продукта
не менялся. Private evidence/receipt/screenshots/export — `.local/micro023l/`.
NEXT: исправить причину ненадёжного выбора touch-controls в будущих результатах
без regex-подмены этой игры; для нового LIVE-прогона нужно отдельное разрешение.
Не расходовать оставшийся второй POST на repair или повтор создания.

---

# MICRO-023 — Full HTML core

16 октября 2026. Baseline main/origin/main:
`fd8d5e1b1b93bd04080d80b0ebd178c15e249001`, ff-only pull. Branch:
`codex/micro-023-full-html-core`. Новый поток: идея → один полный HTML →
техническая проверка → версия. Редактирование передаёт полный current HTML и
новое требование, сохраняет историю. Compact arcade/Canvas/line cap/mandatory
telemetry убраны из базового prompt. Legacy instrumented validator сохранён;
новый full-html probe не требует fixed IDs и не выдаёт gameplay VERIFIED.

Ollama Cloud gemma4:31b default в создании/редакторе; OpenRouter Free вручную.
Legacy Auto — только Ollama без provider fallback. UI начинает с создания,
DEMO mode убран из основной формы; fixtures/API и старые games/jobs сохранены.
Local response cap и внешний HTTP 413 теперь имеют разные ошибки. SSE frame
учитывает JSON escaping в прежнем wire budget, общий лимит не увеличен.

VERIFIED локально: typecheck/build; 223 Node units; Python19 и CI-policy8;
16 browser PASS/10 intentional profile skips (generic + legacy checker, jobs),
24/24 create/edit/provider/version/reopen/export на всех 12 профилях;
26/26 touch/rotation/keyboard viewport/runtime/CSP/MVP/authored maze и falling
blocks на Chromium320/WebKit390. Existing private recovered match-3 прошла
тот же bounded checker: html/input VERIFIED, gameplay/win/loss/restart NOT_VERIFIED;
исходная SQLite прочитана immutable/read-only и не изменена. Это не новая LLM игра.
Initial UI JS gzip 10718 bytes, CSS2328; cold 7-run performance не измерялся,
performance improvement/physical device PASS не заявляются.

Security: history + explicit changed-file Gitleaks scans без находок; sandbox,
CSP и session authorization сохранены. Зафиксированы 513 локальных файлов:
512 hashes unchanged; единственное изменение — служебная consumer SQLite,
доказанно связанная с synthetic token tests/tunnel.test.ts:18 (не production bot).
`.env`, PDF, существующие пользовательские DB/игры/версии сохранены.

LLM: **0 новых реальных inference POST; LIVE NOT_TESTED**. Actions disabled,
hosted/FULL/Ubuntu PASS не заявляются. PR/merge SHA и post-merge smoke — в Git
receipt. [Полный отчёт и точная LIVE-процедура](micro-023-report.md).
NEXT: получить разрешение ровно на 2 Ollama POST (создание + изменение),
без retries/repair/router; при ошибке остановиться. Затем physical acceptance.
До 29 октября MVP технически подготовлен, качество fresh LLM пока не подтверждено.

---

# MICRO-022 — Production validation and bounded recovery

16 октября 2026. Baseline main/origin/main `8465feac701932cf074e7215fa0d49fe6f9f921a`,
ff-only pull; ветка `codex/micro-022-production-validation`. PDF/ignored user data
сохранены. Production browser gate расширен runtime/input/restart evidence и
ограниченными budgets. Format repairs: JSON-string document / missing doctype,
без изменения JS. Original raw HTML и repair claim durable; даже incomplete repair,
Continue и restart не обходят один rewrite. Cloud repair default off, требует
отдельного разрешения через LLM_AUTO_REPAIR=1. 0 новых inference POST.

VERIFIED: 217 Node tests (MICRO-022 17), typecheck/build, 11 runtime/CSP browser,
10 mobile jobs/offline/session, 3 existing Snake/Tetris probes, Python19/policy8.
Неизменённый MICRO-020: FAILED/null exception, original сохранён, versions0.
Ранее вручную восстановленная копия: реальные match/refill, score, win1020/2moves,
loss910/0moves, restart/pause, isolated SQLite reopen/WebKit/export PASS.
7 checker samples median2713ms, range2705..2766ms; CPU/network не throttled.
7/7 protected file hashes unchanged. Оригинальная typo не исправляется production
regex; неизвестные механики и короткие win/loss остаются NOT_VERIFIED.

CI: GitHub Actions disabled, hosted runs не запускались; FULL/Ubuntu/physical
devices и новый LIVE не заявляются. Публикация выполняется разрешённым feature
PR/merge; exact commit/merge SHA и post-merge smoke фиксируются в Git receipt.
RUN: обычный launcher; isolated recovered game `.local/micro022/recovered.sqlite`
(authored/manual-recovery), private artifacts только `.local/micro022`.
NEXT: отдельное owner разрешение на fresh LIVE E2E; затем physical Android/iOS/
Telegram acceptance. Перед release остаётся exact-commit FULL после разрешённого
восстановления Actions. [Полный отчёт](micro-022-report.md), [checker](../game-validation.md).

---

# MICRO-021 — Network Portability & Game Recovery

16 октября 2026. FACT: исходный main `0b53a336eeadce0d258dfa839712f11867b274fc`
(PR #26 / MICRO-020), `git pull --ff-only` выполнен; рабочая ветка
`codex/micro-021-network-portability`. Tracked baseline чистый, только локальный
untracked `docs/Keys_Bilayn.pdf`. Commit/PR/merge SHA фиксируются в Git receipt;
сам документ не предсказывает будущий merge SHA.

## NETWORK

LLM выполняется в Node backend через CloudTransport/native fetch, без provider SDK.
Добавлен единый per-request Agent/ProxyAgent (Undici 7.30.1) для Ollama Cloud,
OpenRouter, GET models/readiness и inference. Первоначально проверенная 7.28.0
имела npm advisories; установлена исправленная 7.30.1, npm audit — 0 vulnerabilities.
Модели/allowlist FREE ONLY, prompts, API keys, provider mode не менялись.

Auto: manual YAPLIX_LLM_PROXY → HTTPS_PROXY → HTTP_PROXY, lowercase приоритет,
NO_PROXY exceptions → иначе Direct/маршрутизация ОС. Обязательный proxy mode
требует manual URL, игнорирует NO_PROXY и не переключается в Direct при отказе.
Direct — явный выбор администратора. HTTP/HTTPS CONNECT и Basic authentication
(включая пустой password) поддержаны, credentials не передаются origin.
Socks5/Socks5h, системный PAC/WPAD/WinINET/WinHTTP auto import не реализованы;
есть документированный явный способ настройки. Произвольных proxy/fallback нет.
[Настройка, системные ограничения и TLS](../llm-network.md).

Connect timeout default 10 s, bounded 100..30000 ms. Request/inference timeout,
общие deadlines, AbortController, SSE `[DONE]`, partial checkpoints и bounded
retry/cooldown сохранены. Новые DNS/TCP/proxy/timeout коды участвуют в прежнем
ограниченном job recovery. Dispatcher уничтожается после body/отмены; proxy cache
и global dispatcher mutation отсутствуют. Диагностика локальна каждому запросу.

`npm run network:check` / `-- --all` выполняет только GET `/models`, не открывает
SQLite и не запускает jobs. Безопасный вывод: provider, model, route, stage,
status, duration, category, `inferenceVerified:false`. UI объясняет ошибки кратко
и сохраняет идею/черновик. Raw exceptions, proxy URL/password, keys не выводятся.

## TEST MATRIX

| Сценарий | Результат / граница доказательства |
| --- | --- |
| Реальная текущая сеть, Direct Ollama Cloud | GET models 200, 538 ms; не inference |
| Реальная текущая сеть, Direct OpenRouter | GET models 200, 1150 ms; не inference |
| Прямой HTTPS и прозрачный системный маршрут | PASS local TLS server; VPN simulated, конкретные VPN-продукты NOT_TESTED |
| HTTP proxy → TLS origin, оба provider | PASS loopback CONNECT, catalog и synthetic SSE через один proxy |
| HTTPS proxy → TLS origin, оба provider | PASS loopback CONNECT, доверенные ephemeral CA, проверка TLS обоих участков |
| Basic auth / пустой password / 407 | PASS; proxy header не появляется origin, ошибки не раскрывают credentials |
| Неверный обязательный proxy | PASS finite failure, target не получает Direct запрос |
| Недоступный DNS / TCP / нет интернета | PASS controlled DNS failure/refused connection; сохранение SQLite job/checkpoint и конечный budget |
| TLS origin / HTTPS proxy rejection | PASS независимые untrusted certificates; verification не отключена |
| Timeout / cancel / interrupted SSE | PASS local server и existing MICRO-020/engine/jobs regressions |
| Смена сети/конфигурации между запросами | PASS fresh request config, proxy failure → explicit Direct только после смены администратором |
| Восстановление связи | PASS synthetic DNS loss → прежний bounded retry → одна checked version, 2 calls |
| System proxy/PAC / SOCKS | NOT_SUPPORTED; явный HTTP/HTTPS endpoint документирован |
| Реальный VPN/корпоративный proxy/Ubuntu/physical devices | NOT_TESTED |

GET 200 не означает successful generation и не доказывает отсутствие VPN у ОС.
Системные VPN/DNS/firewall/proxy не изменялись.

## ROOT CAUSE и GAMEPLAY

На неизменённом private checkpoint MICRO-020 воспроизведено:
`<output data-yaplix-state" ...>` создаёт неправильное имя boolean attribute;
`querySelector('[data-yaplix-state]')` возвращает null. Запись textContent из draw
выбрасывает исключение; после настоящего touch match score 0→30, 3 пустые клетки,
moves=20 и isAnimating=true. Это опечатка LLM HTML, не escape/parser/sandbox/network.
Общий backend не получает исправление, специфичное для этой игры.

Private derived copy исправляет атрибут и обнаруженные при приёмке lifecycle
дефекты той же игры: первый game_started при host init, terminal session_ended,
Resume сохраняет мир вместо вызова нового start/reset. Действия/правила игры,
board, RNG, score и target не подменялись, готовый шаблон не использовался.
В БД версия явно `method:authored`, `provider:manual-recovery`, `model:null`:
это ручное восстановление Ollama checkpoint, не новый независимый LLM output.
Полные source/recovered hashes и origin — в private receipt рядом с HTML.

VERIFIED на сохранённом HTML через Playwright:

- Поле 8x8; touch selection, соседние swaps; invalid swap rollback.
- Настоящие horizontal/vertical matches, score и decrement moves; gravity/refill,
  отсутствие пустых клеток после settle, последующие ходы.
- Полный выигрыш: 1060 очков, 4 хода осталось, видимое Victory.
- Полное поражение: 690 очков, 0 ходов, видимое Game Over.
- Restart сбрасывает score/moves; idle pause/resume сохраняет board/score/moves.
- Chromium mobile touch 390, видимое поле 320/360/390/430, tablet/desktop и landscape.
- Штатный offline browser gate 320/390 PASS, 0 JS errors, opaque sandbox/CSP.
- Отдельная recovery SQLite: save, close/reopen, UI reload, WebKit390 touch Start,
  offline HTML export и integrity PASS. Оригинальная БД/версии/jobs не менялись.

NOT_VERIFIED: physical Android/iOS/Telegram, keyboard viewport/safe-area на
физическом устройстве, exhaustive механики/все случайные доски. Browser emulation
не physical PASS. Проверка видимости в landscape не обещает идеальную компоновку.

RUN: `.local/micro021/recovered-game.html` можно открыть как offline HTML.
Recovery library сохранена отдельно в `.local/micro021/recovered.sqlite`,
version `d2d0a762-d30b-4d2e-8187-70ec637b47d3`.
Source `.local/micro020/received-game.html` и needs_attention job сохранены.
Private evidence: `.local/micro021/gameplay.json`, original-defect.json/PNG,
won.png/lost.png, gate.json, recovery HTML/SQLite, test logs и safe diagnostics.
Не коммитить эти artifacts, исходный пользовательский HTML или secrets.

## VERIFIED / SECURITY / CI

Typecheck/build PASS; полный локальный Node suite 200/200 (network MICRO-021
16/16), Python tests 19/19, CI policy 8/8 PASS; Gitleaks history и dependency
audit без находок. Explicit staged manifest сканируется отдельно до commit. Smoke: 8/8 Chromium320/WebKit390
(provider mode/draft reload, controlled background LIVE, offline export,
opaque runtime/session events). Synthetic transport не является реальным inference.
Python repo/checker tests, CI policy и local Gitleaks выполняются до публикации.
Полная тяжёлая browser/performance матрица не нужна для этой задачи и не запускалась;
это не оптимизация и не релиз. Hosted FULL/Ubuntu PASS не заявлены.

LLM: **0 новых реальных inference POST**, включая repair/fallback. Service GETs
и synthetic local inference различаются. MICRO-020 quota counter не расходуется.
TLS origin/proxy и sandbox сохранены, `.env`, PDF, пользовательские SQLite/jobs,
checkpoint и unknown ignored files защищены baseline hashes/read-only snapshots.
Проверяется равенство data-before/data-after и protected file hashes.

Authoritative GitHub state перед публикацией: actions enabled=false; 79 runs,
latest 38877566527. После merge сравниваются те же поля. Actions не включать;
отсутствие runs не CI PASS. [MICRO-019 exception/FAST/FULL/release](../ci-economy.md).
Документы: README, .env.example, architecture, setup, known-errors, этот handoff
и network instructions. Экспериментальный Orchestrator/Telegram/Visual Kit не менялись.

## MVP / NEXT / VERDICT

Network **PASS в проверенном scope**: Direct service GET плюс local proxy/TLS/fault
matrix; физические VPN/корпоративные сети и live inference здесь NOT_TESTED.
Gameplay **PASS в проверенном scope**: восстановление исходной игры без LLM,
основные механики/win/loss/restart/save/reopen подтверждены; версия изолирована
и помечена ручной. Это не утверждение готовности произвольного LLM HTML.

Публикация разрешена через feature PR/merge при локальных проверках по MICRO-019;
после merge — ff-only main и critical smoke actual merge SHA. Следующий независимый
этап: physical network/device acceptance; перед release exact-commit manual FULL
после явного разрешения владельца восстановить Actions. Новый inference требует
отдельного разрешения и не нужен для открытия восстановленной игры.
