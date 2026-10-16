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
восстановления Actions. [Полный отчёт](micro-022-report.md), [checker](game-validation.md).

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
[Настройка, системные ограничения и TLS](llm-network.md).

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
отсутствие runs не CI PASS. [MICRO-019 exception/FAST/FULL/release](ci-economy.md).
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
