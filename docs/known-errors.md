# Известные ошибки и восстановление YAPLIX

Справочник действий по текущему коду. Реальные результаты и ограничения сети
TASK-008 зафиксированы в [отчёте](task-008-report.md), TASK-010 — в [едином отчёте](task-010-report.md); они не доказывают причину
каждого будущего сбоя. Сначала сохраните запрос/черновик и проверьте этап,
код ошибки, состояние задания и диагностику. Не прикладывайте `.env`, ключи,
initData или необработанные журналы. [Запуск и обслуживание](../README.md).

| Ошибка / симптом | Причина и безопасное действие |
| --- | --- |
| A1.8.5: отсутствие свежего render/activity evidence ошибочно отмечалось FAILED | `BROWSER_CANVAS_RENDER_UNVERIFIED` и `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` теперь сохраняются как NOT_VERIFIED, при том же отказе Save/Ready и запрете repair/fallback. Два level regressions RED→GREEN; Canvas required и DOM world остаются FAILED. Положительная анимируемая WebGL/WebGL2 mini-game отдельно проверяет score/win/Restart и native false buffer. Это authored offline proof, не качество реальной LLM-игры. |
| A1.8.5: terminal clear отклонён или остановленный WebGL принят по старому draw | Game Over overlay теперь требует changing exposed Canvas history до перехода; до/после Restart evidence разделено, пустой активный или post-Restart Canvas отклоняется. WebGL readback выполняется microtask после синхронного draw/clear; native rAF heartbeat истекает evidence non-preserved buffer за текущий/предыдущий кадр. RED: cleared terminal overlay и stale WebGL/WebGL2; свежий rendering/terminal semantics разделены. 18 s deadline, CSP/opaque sandbox и no-repair не ослаблены. [Сценарии и NOT_VERIFIED](canvas-rendering-contract.md). |
| A1.8.4: MICRO-022 repeat/format-repair positive fixtures отклонены после Restart | Полный integration run обнаружил: synthetic fixture рисовал только полосу score и при корректном Restart (`score=0`) оставлял пустой Canvas. Финальный rendering gate корректно отказывал. Authored restart fixture теперь рисует поле и цель независимо от score; no-op/crashing Restart по-прежнему обязаны отклоняться. Production gate и его пороги не ослаблены. |
| A1.8.4: поздний clear/backing reset получает ложный Canvas PASS | На PR #51 `a43a005` RED воспроизводит приём пустого конечного кадра после накопленного rendering evidence для 2D/WebGL/WebGL2. Gate теперь проверяет последний Canvas, activity history только того же ID/context, кадр после Restart и offline keyboard. Краткий clear → redraw допускает до 100 ms повторного наблюдения внутри прежнего browser deadline. Старые draw counters не заменяют meaningful image. Sandbox/CSP/offline и gameplay NOT_VERIFIED сохранены. |
| A1.8.2: ответ после 5 минут отклоняется как `INVALID_GENERATION_METADATA` при defaults 30/35 min | Публичный parser и GenerationEngine с synthetic `performance.now()` воспроизвели отказ для 29-minute response: прежний metadata cap был 300000 ms. Cap сохранения timings согласован с максимальными 35 min job; отрицательные, дробные, нечисловые и превышающие предел значения по-прежнему отклоняются. Dispatch deadlines, provider routes и one-POST guard не расширялись. |
| A1.8.2: WebGL draw → clear/reset ошибочно получает rendering PASS | Offline regression через `checkFullHtml` воспроизвёл PASS для кадра, немедленно стёртого `gl.clear()` или присваиванием `canvas.width`. Observer теперь переснимает явные WebGL clear и сбрасывает evidence при установке backing dimensions; оба negative fixtures отклоняются, положительный WebGL сохраняется. Это проверка рендеринга, не игровых правил. |
| A1.8: русский Start не распознаётся в локальном validation document без собственного charset | При `Content-Type: text/html` Unicode-текст декодировался неверно; общий probe открывал overlay, но не успевал проверить игру. Локальный fulfill теперь явно задаёт `text/html; charset=utf-8`. MICRO-027 fixture дополнен реальным Canvas draw/touch, сохранив исходный русский Start и opaque overlay; все 12 профилей проходят. Пустой Canvas по-прежнему отклоняется отдельным negative fixture. |
| A1.8: falling-blocks проходит lifecycle, но получает `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` | Наблюдённый probe сначала нажимал Pause и затем проверял движение в паузе. Общий Full HTML probe теперь пропускает служебные Pause/Resume/Restart в игровых действиях и снимает Canvas после каждого реального игрового нажатия, прежде чем противоположное направление отменит изменение. Исходный Orchestrator fixture проходит без изменения правил, Canvas gate и его порогов. |
| A1.8: нарисованный Canvas имеет нулевые наблюдённые draw-вызовы | В Chromium для `srcdoc` наблюдалась гонка: game inline script получил контекст до init instrumentation. Gate теперь загружает HTML через точный локально fulfilled document URL, до parsing устанавливая observer. Внешнего GET нет; opaque `allow-scripts` и CSP сохранены. Реальные Canvas 2D/WebGL fixtures и production job проверяются offline. Не отключайте gate и не добавляйте instrumentation в сохраняемый HTML. |
| `BROWSER_CANVAS_REQUIRED`, `BROWSER_CANVAS_LAYOUT`, `BROWSER_CANVAS_RENDER_UNVERIFIED`, `BROWSER_CANVAS_ACTIVITY_UNVERIFIED`, `BROWSER_DOM_GAME_WORLD` | Новая версия не получила достаточного Canvas/WebGL evidence или обнаружен DOM/SVG world. Draft и причина остаются в job, новая версия не сохраняется; автоматического repair/fallback нет. Continue перепроверяет полный checkpoint локально. Исправление требует нового явного запроса владельца. Старые HTML продолжают открываться и экспортироваться. [Границы проверки](canvas-rendering-contract.md). |
| MICRO-036.2: Full HTML checker проходит, но artifact отклоняется с INVALID_GENERATION_METADATA | На main 942387eb checker возвращает profiles [320,390,844], parseArtifact принимает только [320,390]. Synthetic metadata-only probe воспроизвёл ACCEPTED для двух и отказ для трёх профилей, без сети/SQLite. Требуется отдельное согласование контракта и checker→save regression; не удалять landscape evidence, не запускать новый inference для диагностики. [Аудит и воспроизведение](micro-036-2-docs-audit.md#блокер-контракта-full-html). Это исторический P0 на `942387e`; в ветке PR #46 исправлен MICRO-036.3 (раздел ниже), без нового inference. |
| NL-004: обе змейки теряют управление при 844×390 | Сохранённые DEV HTML рассчитывают поле без достаточного учёта высоты, body overflow:hidden блокирует прокрутку. Общее требование landscape не обеспечило адаптацию. MICRO-030 отклоняет подтверждённо недоступные controls; MICRO-031 уточняет общий prompt: три размера, все основные состояния, CSS shrink/reflow либо настоящая прокрутка без глобальной блокировки жестов. Offline tests проверяют подготовку сообщений; улучшение новых игр NOT_VERIFIED до отдельного разрешённого A/B. Исходные HTML не исправляются. [Контракт и границы](nl-game-intent.md#micro-031-доступность-управления). |
| MICRO-028N: QR listener отвечает с ПК, физический телефон не открывает страницу | В наблюдаемой сессии physical Wi-Fi имел Public profile, ActiveStore — enabled Inbound TCP Block для фактического node.exe на любом порту. IP QR/API совпал с bind, ПК получил `/phone` 200. После отдельного разрешения владельца: только этот доверенный Wi-Fi переведён в Private, добавлен Allow для exact Node/IP/interface/TCP port/local subnet. Владелец подтвердил physical Android / Brave: QR/start/touch/progress/restart/rotation/reopen/revoke PASS. Public Block сохранён; packet capture не выполнялся, другие сети не проверены. MICRO-036.1: порт по умолчанию 52604 постоянный при refresh/restart, `YAPLIX_PHONE_PORT` сохраняется в локальном `.env`; `PORT_IN_USE` не вызывает fallback. При смене IP/интерфейса/профиля сначала проверить применимость узкого правила; широкое разрешение Node не добавлять. Self-probe не доказывает LAN reachability. [Диагностика и STOP-GATE](micro-028n-phone-connectivity.md). |
| MICRO-026: unit `tunnel.test.ts` ждёт TUNNEL_CLOSED, но получает BACKEND_NOT_READY | Один параллельный replay при browser/build нагрузке не успел поднять synthetic backend; полный последовательный `node --test --test-concurrency=1 tests/*.test.ts` прошёл 235/235 без изменения timeouts/production. Это наблюдение локального теста, не доказательство внешнего tunnel отказа. |
| MICRO-026: старые `production.spec.ts` LIVE fixtures падают при локальных model endpoints | На неизменённом main 37653b9 повторён `FREE_MODEL_REQUIRED`: HTTP-disconnect fixture задаёт CLOUD_BASE_URL=localhost, запрещённый MICRO-019. Старые OLLAMA_BASE_URL fixtures также не настраивают текущий cloud route. В расширенном smoke 7 FAIL; production routes не ослаблять. Использовать актуальные isolated transport unit tests и отдельный runtime smoke; обновление legacy harness требует отдельной задачи. Это пробел тестов, не внешний inference proof. |
| MICRO-026: `eval` через Playwright evaluate не показывает запрет CSP | DevTools execution может обходить ограничение unsafe-eval. Проверенный способ: отдельный обычный inline script внутри allow-scripts opaque iframe выполняет security probe, Playwright только читает результат. Обычный eval/network заблокированы; parent DOM/storage недоступны. Это проверка браузерной изоляции, не доказательство безопасности произвольной игровой логики. |
| Firefox browserContext.newPage: Target crashed в ограниченном executor | В MICRO-024 Firefox падал до загрузки приложения; тот же локальный профиль вне sandbox прошёл создание страниц и сценарии. Это наблюдение двух условий, не доказательство конкретной внутренней причины crash. Не меняйте sandbox/CSP игры и не увеличивайте retries. |
| MICRO-024: нет QR / несколько адаптеров | Активный физический Wi-Fi/Ethernet + private IPv4 обязательны. Windows физический список исключает наблюдаемый VirtualBox Ethernet 3, даже если имя не содержит virtual. Выберите сеть телефона; PHONE_NETWORK_CHECK_FAILED не подменяется непроверенным первым IP. Подключение включается в UI, без npm. |
| MICRO-024: QR открывается на ПК, телефон не отвечает | Self-probe подтверждает только локальный listener. Проверьте частное разрешение Node.js в Windows Firewall, LAN access VPN и гостевую изоляцию Wi-Fi. Их блокировка не установлена автоматически; программа не меняет правила или маршруты. |
| MICRO-024: LIVE «провайдер недоступен», хотя игра создана | Прежняя строка отражала отдельный GET models с 3 s timeout. Это не inference probe. Теперь UI показывает служебный источник/время/код, отдельно сохранённый success выбранного provider; не заявляет неизвестную квоту или недоступность генерации. |
| MICRO-023L: LIVE игра прошла technical gate, но джойстик скрыт | На неизменённом ответе gemma4:31b подтверждено в Chromium Pixel5 390×844: maxTouchPoints=1/coarse=true, но `'ontouchstart' in window=false`; startGame оставляет display:none, реальный swipe не двигает персонажа. Это чувствительное к окружению условие данного артефакта; physical devices не проверены. MICRO-024 повторно загрузила тот же HTML без изменений: standalone setContent воспроизводит false/hidden, в текущем served opaque iframe property=true и joystick=block. Это не доказывает исправление на всех устройствах. Prompt усилен, mobile probe не использует клавиатуру; универсального source regex/fix нет. Desktop сбор20/20, win/loss/restart работают. Второй POST остановлен по owner budget; HTML/исходная версия сохранены, универсальный regex fix не добавлен. Touch нельзя объявлять PASS по одному startup gate. [Приёмка](SESSION_HANDOFF.md). |
| MICRO-023: `LLM_RESPONSE_BODY_TOO_LARGE` / `LLM_HTTP_BODY_TOO_LARGE` | Первый код — локальный JSON/SSE cap 1210000 bytes, второй — внешний HTTP 413; по 413 нельзя отличить proxy от API. Исторический BODY_TOO_LARGE без transport evidence не устанавливает источник. SSE frame больше не сравнивается с 200000 HTML bytes: escaping/metadata входят в прежний wire cap. Mocks проверяют границы, это не внешний inference proof. |
| MICRO-023: Auto / в редакторе нет Ollama | Auto теперь aliases Ollama Cloud без fallback; UI создания и изменения имеют одинаковые Ollama/OpenRouter. Старый sessionStorage auto безопасно отображается Ollama. Для OpenRouter нужен явный выбор; старые jobs/versions не удаляются. |
| `LLM_INPUT_TOO_LARGE` | Полный prompt envelope >300000 bytes, dispatch блокируется. Current HTML не усечён; исходная версия остаётся. Известный context_length оценивается консервативно по UTF-8 bytes + output budget, возможен LLM_CONTEXT_LIMIT. |
| `CHECKPOINT_ORIGIN_UNAVAILABLE` | Partial HTML без подтверждённого provider/model (например, interruption до model frame) либо исходный route больше не настроен. Recovery не отправляет draft другому provider и не обходит disabled LLM repair; original сохранён. Восстановите исходную конфигурацию или создайте новый запрос. Mocks проверяют отсутствие dispatch. |
| MICRO-022: `JAVASCRIPT_EXCEPTION`, `BROWSER_INPUT_DISABLED`, `BROWSER_RESTART_FAILED` | Короткий production gate обнаружил конкретный runtime/control defect. Save/Ready блокируются, первый raw HTML сохраняется в originalCheckpoint, последний draft — checkpoint; diagnostics в job.validation. Форматные repairs повторно проходят gate. Не исправляйте selectors случайными regex. LLM repair default off; максимум один после отдельного разрешения. [Границы](game-validation.md). |
| `BROWSER_TIMEOUT_*` / `BROWSER_CHECK_INCONCLUSIVE` | Проверка не завершена: NOT_VERIFIED, не доказанная поломка механики. Browser budget 18 s, startup 8 s, gameplay 6 s/viewport, marked restart 2.5 s. Raw draft сохраняется, готовая версия не создаётся; timeout не запускает repair. Проверьте нагрузку/установку browser перед новым запросом. |
| Continue после incomplete/truncated LLM repair пытается сделать ещё один rewrite | MICRO-022 regression воспроизвёл обход cap при непарсируемом checkpoint. Durable repairUsed теперь проверяется перед любым новым dispatch; полный checkpoint допускает revalidation без POST. Mocks подтверждают cap после Continue, SQLite reopen и automatic retry; это не live inference evidence. |
| MICRO-020: `data-yaplix-state"`, null textContent, поле не заполняется | MICRO-021 воспроизвела на сохранённом оригинале: score 0→30, 3 пустые клетки, moves=20, isAnimating=true. В HTML опечатка boolean attribute; selector не находит output, исключение draw обрывает gravity/refill. Исправлена отдельная private копия плюс её start/end/resume lifecycle; backend не получает patch для одной игры. Touch win/loss/restart/save/reopen проверены без нового LLM. Оригинал/job не менялись. [Handoff](SESSION_HANDOFF.md). |
| `LLM_DNS` / `LLM_TCP_CONNECTION` / `LLM_PROXY_CONNECTION` / `LLM_PROXY_AUTH` / `LLM_TLS` | MICRO-021: единый server transport обоих облаков. Сначала `npm run network:check -- --all`, затем проверьте разрешённые proxy/CA/DNS. Обязательный proxy не обходит Direct; 407 не равен provider 401. Не публикуйте proxy credentials. [Правила и матрица](llm-network.md). |
| Proxy работает в браузере, но LIVE недоступен | Windows Settings/PAC и Node process env различаются. PAC/WPAD и SOCKS не импортируются; получите явный HTTP/HTTPS endpoint у администратора. Auto учитывает server HTTP(S)_PROXY/NO_PROXY без NODE_USE_ENV_PROXY; системные настройки не меняются. GET models 200 не доказывает inference. [Настройка](llm-network.md). |
| SSE получила `[DONE]`, но закончилась timeout при открытом body | Локально воспроизведён дефект CloudTransport: он ждал EOF даже после terminal marker. MICRO-020 завершает reader на `[DONE]`, сохраняя обязательные model/finish_reason=stop; ранний marker не авторизует неполный ответ. Regression падал до исправления. Связь с историческими MICRO-019 обрывами не доказана. |
| Non-streaming response оборвался после headers, но виден `LLM_INVALID_RESPONSE` | MICRO-020 разделяет чтение body и JSON parse: подтверждённый read failure возвращает `LLM_CONNECTION_INTERRUPTED`, полный malformed JSON — `LLM_INVALID_RESPONSE`. Локальный HTTP server проверяет оба случая, отмену/таймаут и отсутствие утечки credentials. |
| MICRO-019: «три в ряд» осталась без HTML | Исторический снимок 16.10.2026: реальный Playwright запрос в отдельной базе, 1 Ollama connection interruption и 3 OpenRouter timeouts по 45 s, всего 4 POST. Job завершён needs_attention; 0 versions, gameplay NOT VERIFIED. Причина недоступности сети не установлена. Дополнительное разрешение и новый результат зафиксированы выше в MICRO-020; старый budget не возобновляется. История старого отказа в пользовательской DB: Ollama interruption + 3 конкретных-model 429; это отдельный снимок до смены маршрутов. |
| `PORT_IN_USE` | Launcher не подтвердил совместимый local backend этого клона. Windows: `Get-NetTCPConnection -LocalPort 3000`, затем `Get-Process -Id PID`. Не останавливайте неизвестный процесс. Свой устаревший backend перезапустите; либо явно выберите другой `PORT`. Doctor проверяет новый bind и может сообщить эту ошибку при здоровом активном сервере. |
| `GRACEFUL_SHUTDOWN_FAILED` / повторный запуск завис надолго | Повторный `YAPLIX.cmd` подтверждает свой backend по HMAC proof (`/api/runtime/tunnel?nonce`) и штатно останавливает его аутентифицированным `POST /api/runtime/shutdown` (только loopback, ключ `X-Yaplix-Control`): backend сам закрывает Generation Jobs, Telegram polling и SQLite, затем освобождает порт. На Windows `SIGTERM` не даёт мягкой остановки, поэтому сигналы не используются; `SIGKILL` — аварийный путь только для подтверждённо своего PID. Чужие процессы (Harness, Ollama, VPN, другие Node.js) не трогаются: launcher возвращает `PORT_IN_USE` и сохраняет их. После restart `healthz` и библиотека игр доступны; данные не сбрасываются. |
| `TUNNEL_CLOSED` / `SPAWN_ERROR` | Просмотрите этап, exit code/signal и фильтрованный `.local/logs/tunnel.log`. Нужен pinned cloudflared из `npm run tunnel:install`; проверьте права запуска/карантин. Не отключайте TLS, антивирус или firewall. Предыдущая ошибка без stderr не устанавливает корневую причину. |
| `TUNNEL_CLOSED` с `failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded` | Воспроизведено (TASK-014, 2026-10-15, pinned cloudflared 2026.10.0): при одновременно установленных `HTTP_PROXY` **и** `HTTPS_PROXY` (например, оба на Xray `127.0.0.1:10809`) провижининг Quick Tunnel через Xray зависает и отваливается по 15 s таймауту; без прокси или только с `HTTPS_PROXY` тот же бинарник создаёт туннель штатно. Причина в транспортной обработке прокси-переменных самим cloudflared, не в VPN/DNS и не в Cloudflare API: локально все цели отвечали (GET 405, POST 200, api.cloudflare.com 404, api.telegram.org 302) и в прямых, и в прокси-замерах. Системные переменные/реестр/VPN менять не нужно: `scripts/tunnel.ts` теперь по умолчанию очищает proxy-переменные окружения коннектора (`scripts/tunnel-connector-env.ts`; POST и edge-транспорт идут напрямую, localhost в любом случае не проксируется, TLS не трогается, bot/LLM ключей у коннектора по-прежнему нет); `YAPLIX_TUNNEL_CONNECTOR_PROXY=1` при необходимости явно возвращает наследование. |
| `PUBLIC_URL_TIMEOUT` / `PUBLIC_HEALTH_FAILED` | URL ожидается до 60 s, внешний HTTPS health до 45 s. Полученный hostname сам по себе не означает доступность. Проверьте DNS/VPN/proxy и исходящие HTTPS 443, QUIC UDP 7844 или HTTP/2 TCP 7844; повторите с явным `--protocol http2` либо `quic`. При неподтверждённом health меню не публикуется. TASK-008 наблюдал DNS ENOTFOUND/timeout; конкретный сетевой виновник не установлен. TASK-014: замер с живым туннелем и реальным origin показал 200 `/healthz` и напрямую, и через Xray — сам путь edge→Node не виновник; при отказе проверьте состояние VPN/маршрута в момент запуска. |
| Telegram открывает устаревший URL (`ERR_NAME_NOT_RESOLVED`) | Код бота мёртвую ссылку не раздаёт: `refreshUrl()` публикует web_app только после `/healthz` с exact instance, `npm run telegram:check` при погашенном туннеле показал `menuType:commands, menuUrl:null`. Постоянный адрес туннеля в Telegram живёт в **BotFather Main Mini App** (`/mybots` → Bot Settings → Configure Mini App) — вне кода; Quick Tunnel URL меняется при каждом запуске, поэтому там нельзя держать временный адрес. Обновите/очистите этот пункт вручную в BotFather для постоянного запуска или пользуйтесь menu button только активной сессии. |
| Timeout 300 s / многократный Continue | Прежний engine допускал deadline до 300 s, а job после ошибки требовал ручного Continue; это не устанавливает причину upstream задержки. MICRO-019 убирает повторный обход fresh-generation routes: default request ≤60 s, весь автоматический цикл ≤300 s / 4 calls; автоматическая смена provider отключена MICRO-023. Исходный prompt/checkpoint не нужно вводить заново. Увеличение timeout не исправляет сломанный код или недоступный provider. |
| `LLM_OUTPUT_TRUNCATED` | `finish_reason=length` сохраняет partial code/model. При отдельно разрешённом LLM repair максимум один rewrite просит полный компактный HTML на исходном route, не склеивает произвольные части; default cloud repair off, поэтому результат может остаться draft. Не увеличивайте `LLM_MAX_TOKENS` вслепую: доступный completion cap снижает запрос, usage/reasoning учитываются при наличии. |
| `LLM_CONTEXT_LIMIT` / `LLM_OUTPUT_BUDGET_TOO_SMALL` | Контекст/известный output cap не подходит; budget <2048 tokens блокирует dispatch. Route получает 15 min cooldown; автоматическая смена provider отключена MICRO-023. При отсутствии доступного route проверьте output settings/квоту, а не запускайте бесконечные retries; prompt/draft остаются. |
| `LLM_RATE_LIMIT` / `JOB_RETRY_AFTER` | Provider `429`: Retry-After задаёт durable cooldown и автоматическое ожидание; без header — 60 s. MICRO-023 запрещает автоматическую смену provider. Повтор/Continue до установленного времени блокируется. TASK-010 получил реальные 429 у concrete free OpenRouter модели; это исторический результат, не ошибка парсера HTML. |
| `LLM_QUOTA` | Provider `402`/quota error (включая распознанный exhausted quota `429`) охлаждает route на 15 min; автоматическая смена provider отключена MICRO-023. Наличие модели в каталоге не доказывает квоту: TASK-010 kimi-k2.7-code вернула 402, другая доступная модель дала coding response. Это историческое evidence. Credits/план автоматически не покупаются; платная OpenRouter модель не подставляется. |
| `LLM_AUTH` / `LLM_MODEL_NOT_FOUND` / `OLLAMA_CLOUD_NOT_CONFIGURED` | Проверьте серверный ключ выбранного provider, затем перезапустите backend. MICRO-019 фиксирует Ollama Cloud model gemma4:31b и OpenRouter model openrouter/free; legacy MODEL не меняет route. Catalog/readiness не доказывает inference или квоту. Auth/model отказ охлаждает route; explicit mode не переключает provider. Значение ключа не выводите. |
| `FREE_MODEL_REQUIRED` | Production допускает только gemma4:31b на https://ollama.com/v1 и openrouter/free на exact https://openrouter.ai/api/v1. Concrete :free IDs и arbitrary endpoints больше не разрешены MICRO-019. Старые model/fallback/local knobs не создают routes; неверный CLOUD_BASE_URL блокирует конфигурацию. Не ослабляйте проверку и не подставляйте платную модель. |
| Provider изменился или job пытается вернуться к прежнему | MICRO-023 запрещает автоматическую смену provider: legacy Auto означает только Ollama Cloud, OpenRouter Free выбирается вручную. Старый Auto checkpoint от OpenRouter сохраняется с CHECKPOINT_ORIGIN_UNAVAILABLE без нового dispatch. Проверьте mode/history/cooldown и сохранённый draft; не удаляйте jobs/metadata ради повторов и не обнуляйте lifetime limit. Контролируемые отказы подтверждают routing/recovery отдельно от доступности реального provider. |
| `LLM_TIMEOUT` / `LLM_CONNECTION_INTERRUPTED` / `LLM_STREAM_ERROR` | Prompt и последний записанный checkpoint остаются. Recoverable сбой автоматически использует оставшийся бюджет и допустимый route; потенциально оплаченный неизвестный запрос не повторяется слепо на том же route. Полный checkpoint с известным origin проверяется без нового POST; неполный требует отдельно разрешённого LLM repair на исходном route, по умолчанию выключенного. Без подтверждённого/настроенного origin dispatch блокируется. Последние незаписанные байты и буквальное resume с токена не гарантируются. |
| `LLM_INVALID_RESPONSE` / `LLM_INVALID_HTML` / `LLM_UNSAFE_ARTIFACT` / `BROWSER_*` | Неполный документ/отказ проверки не создаёт passed version. Repair получает исходный prompt, полезный HTML и конкретную ошибку. TASK-010 устраняет потерю raw response при extract failure и уточняет порядок game_started до score events. Для BROWSER_INSTALL_REQUIRED установите checker; sandbox ОС исправляйте по [setup](development-setup.md), не выключайте. Gate startup-input-pause не доказывает весь gameplay. |
| `JOB_RESTART_UNCERTAIN` | Восстанавливаются original deadline/budget/cooldown и допустимые автоматические действия. Неизвестный potentially billed route исключается; полный checkpoint с совместимым origin может пройти повторную validation без POST. MICRO-023 не допускает автоматическую смену provider. Без ресурсов/бюджета остаётся needs_attention. Ручной Continue запускает новый bounded cycle, не обнуляет lifetime attempts. |
| `BROWSER_RESUME_NOT_WORKING` | После паузы checker не увидел фактического продолжения. Сделайте видимую Resume/Continue/data-yaplix-resume либо работающий pause toggle; одно изменение надписи не доказывает resume. Общий gate не заменяет полный сценарий gameplay/win/loss. |
| `game_won` без доказанного порога / rules-aware NOT_VERIFIED | TASK-017: событие само по себе не доказывает победу. Отдельный offline-аудит читает сохранённые rules, сверяет numeric HUD, реальные действия, стабильный видимый terminal и end; для змейки дополнительно сверяет пиксельные контакты головы с яблоками. Unknown/compound rule, исходно неоднозначный/конфликтный target, отсутствие безопасного пути или исчерпание бюджета остаются NOT_VERIFIED; изменение уже установленной цели — FAILED. HTML и очки не подменяются. См. [результаты и evidence](task-017-report.md). |
| TASK-016 LIVE-тетрис не падает и не реагирует на Drop | Подтверждено TASK-017: 30 s, score 0/200, фигура остаётся в строках 0–1 после 41 Drop при работающем горизонтальном вводе. В исходной логике секунды `dt` сравниваются с `800`, а Drop меняет неиспользуемое `piece.dy`. Это дефект артефакта, не cloud/network timeout и не повод увеличить generation timeout. Исправление генерации не выполнялось в TASK-017; победа остаётся NOT_VERIFIED. |
| `JOB_QUEUE_FULL` / `RATE_LIMIT` | Один worker, до 20 pending глобально и 3 на владельца при creation/continue. LIVE creation при настроенном generator: 6/min owner, 12/min global. Отдельно такие же лимиты фактических provider dispatch, включая repair/Continue. Подождите завершения/отмените своё ненужное задание. Cancel не удаляет запрос и checkpoint. |
| `JOB_WORKER_BUSY` | После successful bind lease защищает одну DB от второго backend, в том числе на другом порте. Закройте только свой writer штатно. После crash подтверждённо отсутствующий PID позволяет restart сразу; живой/непроверяемый PID сохраняет lease до 60 s. Чужой процесс/lease не удаляйте, игры и записанные checkpoints сохраните. |
| `JOB_ATTEMPT_LIMIT` / `JOB_DURATION_LIMIT` / `JOB_STORAGE_QUOTA` | MICRO-019 default cycle: 4 provider calls суммарно, ≤4 worker runs, ≤300 s, request по умолчанию ≤60 s; lifetime ≤12 calls/job. Старые durable budgets сохраняются. До 1000 jobs, 100 MB checkpoints суммарно и 200000 bytes/checkpoint. При исчерпании сохраняются запрос/draft и явная причина; скачайте черновик/backup. Автоудаления и автоматического увеличения бюджета нет. |
| `IDEMPOTENCY_CONFLICT` | Один key был использован с разными запросами. Не повторяйте изменённое тело со старым key; существующее задание сохранено. UI защищает повторное нажатие и повтор того же незавершённого submit. |
| Исходная ошибка LIVE заменена на `JOB_ATTEMPT_LIMIT` | TASK-011 воспроизвёл реальный `JAVASCRIPT_EXCEPTION`, скрытый проверкой бюджета перед repair. Теперь последний отказ остаётся errorCode, история/checkpoint сохраняются, новых dispatch сверх бюджета нет. Regression подтверждает причину и прежний предел 12 вызовов. |
| Telegram молчит после временного сбоя bootstrap API | Раньше отказ getMe/getWebhookInfo завершал единственную попытку запуска consumer. Теперь только TELEGRAM_API_UNAVAILABLE повторяет bootstrap с backoff 2–60 s до shutdown; identity/token/webhook/consumer conflicts не обходятся. Fault injection проверяет retry и отмену ожидания. Реальный TASK-011 bootstrap/polling запущен; VPN/proxy причиной не установлен, глобальные настройки не менялись. |
| Уведомление скрыто/не доставлено | Результат остаётся в центре заданий и библиотеке. Toast имеет серверный claim перед показом; crash может оставить только центр. Telegram требует явное согласие, signed session, HTTPS и доступ бота к чату. Одна попытка отправки, timeout может быть unknown; гарантии exactly-once доставки нет, повторного спама нет. |
| Telegram `/start` не отвечает | Прежний Mini App adapter не получал Bot API updates. Теперь token + single owner запускают одного poller независимо от HTTPS. Проверьте backend, TELEGRAM_UPDATES не off, getMe и коды API. Webhook/другой consumer блокируют запуск; не удаляйте webhook или чужой lock вслепую. Ответ без HTTPS остаётся текстовым. Реальный ответ проверяется отдельно от synthetic tests. |
| Mini App недоступна / нет HTTPS | Текстовый bot и HTTPS Mini App — разные каналы. Loopback/LAN не заменяют публичный HTTPS. Меню/кнопки публикуются только для подтверждённого текущего экземпляра; при недоступном Quick Tunnel используйте отдельно подготовленный защищённый [HTTPS host](telegram.md), не anonymous LLM endpoint. |
| `SCHEMA_INVALID` / `SCHEMA_TOO_NEW` / `BACKUP_*` | Не пересоздавайте и не удаляйте базу. Остановите свой writer, сохраните DB/WAL/SHM и protective `before-v2-*` snapshots. Неизвестная схема/неисправная копия блокируют запуск. Restore выполняйте только из проверенной копии по [setup](development-setup.md). |
| Hosted repository-checks падает на тяжёлых browser-тестах | Windows shared runners близки к 20-минутному лимиту job'а: полный browser suite ~13.5 m суммарно с setup и unit-тестами превышал бюджет (TASK-013: три прогона подряд — упавшие тесты каждый раз разные, затем step cancelled при пройденных 218 тестах). Теперь budget 30 m. Медленный runner не доказывает дефект кода: сначала проверьте, совпадает ли тест между прогонами и прошёл ли тот же коммит в другой раз. MICRO-018 сохраняет suite для FULL, но не устанавливает browsers для docs-only; [policy и ограничения](ci-economy.md). |
| Actions быстро расходует квоту, timing API показывает нулевые billable | MICRO-018: у main run 38868311721 timing API вернул `total_ms:0` при 21 min workflow wall time. Это не нулевой счёт: используйте job started/completed timestamps, отдельно округляйте каждый job вверх и подписывайте оценку, а не billable факт. Billing GET без user scope вернул 404; остаток 189 min из старого письма не подтверждён. MICRO-019 владелец временно выключил repository Actions до 29 октября 2026; отсутствие run не PASS. Dynamic Dependabot workflow не отключается отдельно (422), repository actions/permissions enabled:false — authoritative state. Восстановление только по команде владельца: [порядок](ci-economy.md). Scopes/тариф автоматически не меняются. [Baseline](micro-018-report.md). |
| main a902343: Windows browser suite красный после merge PR 23 | Run 38868311721: jobs background/offline test исчерпал 20 s при ожидании Start после reload; unresponsive gameplay вернул правильный timeout verdict, но wall time 24881 ms превысил assertion 22000 ms. Это два наблюдаемых отказа; точная причина race/нагрузки и remedy не подтверждены. MICRO-018 не отключает эти тесты, не повышает таймауты и не добавляет retries. Локальный PASS не заменяет новый hosted FULL. |
| TASK-017 unresponsive-fixture возвращает NOT_VERIFIED вместо watchdog FAILED в CI | Ubuntu run 38861148019 закончился за 2.0 s до ввода; Windows run 38862850604 показал ту же проблему при 6 s (Start tap 2.58 s, setup/baseline съели drive budget). Активный rules-aware budget теперь начинается после настоящего `game_started`; общий hard watchdog budget + 12 s по-прежнему включает startup. Fixture имеет 6 s и требует `BROWSER_GAMEPLAY_TIMEOUT`; отдельная delayed-Start регрессия с тем же 6 s budget проверяет игру после анимированного Start. Generation/LIVE audit budgets не меняются. |
| Gameplay checker сообщает FAILED при настоящем terminal overlay между наблюдением и FIRE/Pause | Windows trace run 38862850604: змейка закончила run, пока Playwright проверял actionability; `#yapOverlay` перехватил FIRE. Pending click отменяется только при наблюдаемом terminal event, затем обычный независимый proof всё равно сверяет цель/HUD/screen/end. Клик сквозь overlay и изменение состояния запрещены; другие click errors не скрываются. |
| Windows LAN acceptance превышает общий test timeout 20 s при повторном входе после restart сервера | Run 38862850604 дошёл до последнего export assertion после двух startup, QR decode и win/loss/restart. Для этого единственного многошагового теста Windows budget 45 s; все assertions, app timeouts и отдельные performance/gzip gates сохранены. Это не доказательство сетевой причины или изменения production поведения. |
| `Check repository conventions and links` красная на новом PR | Проверяйте локально до push: `python scripts/check_repo.py` требует финальный newline у каждого tracked-файла; в TASK-016 на этом упали `docs/task-016-report.md`, `scripts/orchestrator-gameplay-audit.ts` и `src/orchestrator/gameplay-check.ts` (первый commit PR был красным, коммит с newline перезапустил проверку). Windows-запись через `Set-Content`/`WriteAllText` не добавляет завершающий newline; MICRO-021 также наблюдала CRLF от Python `write_text` по умолчанию, исправление — явный `newline="\n"` или byte normalization в проверенном manifest. После записи запускайте тот же checker. |

## MICRO-027 observed remedies

- Critical JS plus a later blocked tap previously became BROWSER_CHECK_INCONCLUSIVE.
  Preserve the observed runtime/security code first; wait for srcdoc navigation.
  Regression uses real Chromium, not an inference-quality claim.
- A router network/rate-limit/truncation failure must not trigger an automatic
  retry/repair after restart either. Historical queued router retries need manual
  Continue; a complete checkpoint can only revalidate locally without dispatch.
- OpenRouter current LIVE returned HTTP200 then LLM_RESPONSE_BODY_TOO_LARGE before
  output completion. This establishes the wire-cap failure, not a quality verdict.
  It remains experimental; no upstream model selection or enlarged cap is implied.
- On phone now appears on completed jobs and the opened player. It explicitly
  selects that version even after the connection dropdown was changed. LAN probe
  failure means no ready QR; test guards must allow the exact GET /phone probe.
- Trace IO errors must set diagnosticsUnavailable, not strand generating/cancel.
  Download reports via the normal Telegram session header when cookies are absent.

Обычный browser и synthetic fixtures не подтверждают physical Android/iOS,
реальный Telegram API/menu/доставку сообщений или успешный Ollama Cloud inference.
При недоступности всех настроенных вычислений задание может остаться черновиком;
оно не становится DEMO и не получает отметку passed без проверки полного HTML.

## NL-001+002.1: ввод и размер промпта

- `абвгд 999 ???` прежде получал UNKNOWN и допускал dispatch. Узкая проверка
  структурного мусора теперь даёт invalid до обращения к модели; UNKNOWN жанра
  или аудитории не блокируется. Регрессии проверяют 0 synthetic transport calls
  для плохого ввода и принятие коротких, творческих и незнакомых идей.
- Подробный Intent повторял исходную фразу DEV-01 семь раз (user 2162 символа).
  Внутреннюю структуру сохраните, модели передавайте compactGameIntent: raw request
  один раз, уверенные подсказки по приоритету и только недостающие technical defaults.
  User DEV-01 стал 238 символов; edit всё ещё передаёт полный HTML и исходную идею.
  Это офлайн-проверка сообщений, не доказательство качества реальной генерации.

## MICRO-030: управление вне landscape viewport

- NL-004: обе сохранённые змейки проходили прежний Full HTML checker при
  320×700 и 390×700, но при 844×390 четыре div-кнопки уходили ниже экрана.
  Воспроизведено без генерации: верхние кнопки y=548 / y=452, body overflow:hidden.
- Full HTML checker теперь добавляет 844×390. `BROWSER_CONTROLS_UNREACHABLE`
  означает FAILED: ранее доступный в portrait активный элемент полностью вне
  viewport, а CSS не даёт маршрута прокрутки. Для div нужен реальный input listener,
  проверенный read-only CDP в opaque iframe; cursor:pointer сам по себе недостаточен.
- Нормальная/вложенная прокрутка, частично видимые элементы, отключённые/скрытые
  кнопки и неизвестные будущие состояния не являются доказательством отказа.
  Программный scrollIntoView не доказывает доступность: он умеет прокручивать hidden.
- Сохранённые игры не исправлялись; булочная по-прежнему проходит техническую
  проверку. Это не доказательство gameplay/win или физических Android/iOS.
  Детали и границы: [MICRO-030](micro-030-report.md).

## MICRO-036.3: Full HTML прошёл checker, но не сохраняется

- RED на базе `942387e`: настоящий `checkFullHtml` успешно проверил
  320×700, 390×700 и 844×390, затем `parseArtifact` выбросил
  `INVALID_GENERATION_METADATA`: парсер принимал только `[320,390]`.
- BrowserEvidence общий для checker и Artifact. Канонические viewport и profiles
  обоих checker и парсера находятся в `src/browser-profiles.ts`. Для новой
  генерации парсер принимает строго `[320,390]` для `startup-input-pause` и
  `[320,390,844]` для `full-html`.
  Список копируется без потери профилей; порядок, дубли, неизвестные значения,
  строковые числа и объекты с поддельным `toJSON` отклоняются.
- До MICRO-030 (`a0d3f41`) настоящий Full HTML checker выдавал `[320,390]`.
  Исторические metadata поддерживаются в режиме `saved-metadata`, используемом
  `Store.getVersion`, без добавления непроверенного landscape. Сохранение новой
  Full HTML-версии с двумя профилями отклоняется.
  Read-only inventory основной `.local/data/yaplix.sqlite` нашёл одну версию
  без browser metadata; это не инвентаризация всех архивов/других баз.
- GREEN: `tests/generation.spec.ts`, тест MICRO-036.3, наблюдает три настоящих
  viewport и проходит `checkFullHtml → parseArtifact → Store.save → getVersion`
  после закрытия/повторного открытия отдельной тестовой SQLite. Предыдущая версия,
  её ID, SHA, HTML и два профиля остаются неизменны. Checker не подменяется.
- Дополнительный offline integration проходит штатные `GenerationEngine →
  GenerationJobs → Store → API`: создание задания, `completed`, библиотека,
  история, экспорт, повторное открытие, восстановление полного checkpoint.
  Provider — заглушка HTML, production browser checker настоящий. Всего один
  dispatch; восстановление checkpoint не вызывает провайдера повторно.
- Отдельный fault-injection RED обнаружил два dispatch вместо одного при
  `INVALID_GENERATION_METADATA`. GREEN: ошибка локального контракта останавливает
  fallback/repair, задание `needs_attention`, `retryAt:null`, исходный ответ и
  checkpoint сохранены, версий нет. После restart/явной локальной перепроверки
  checkpoint число dispatch остаётся 1. Подмена evidence используется только
  в этом отрицательном тесте, не в основном integration.
- Landscape-регрессии MICRO-030/MICRO-032 по-прежнему отклоняют обрезанные
  controls с `BROWSER_CONTROLS_UNREACHABLE` при 844×390. Критерии checker неизменны.
  Проверки offline/synthetic; реальные inference/repair POST: 0. Это не LIVE,
  не доказательство gameplay/win/loss и не physical-device PASS.

## MICRO-032.4: стартовый overlay скрывает результат landscape gate

- На сохранённой контрольной змейке 7/7 offline запусков Full HTML checker
  завершались `BROWSER_CHECK_INCONCLUSIVE`, phase `touch-input`, 320×700.
  Исходный `TimeoutError` 1500 ms: видимый canvas перекрыт стартовым overlay;
  его текст «Начать играть» не совпадает с точным Start matcher. До landscape
  проверка не доходила. Это дефект выбора цели checker, не JS-ошибка игры.
- Touch-проба теперь проверяет hit-test видимой части элемента и после первого
  настоящего tap повторно наблюдает открывшиеся controls. Не требуется дополнять
  словарь Start под конкретную игру. На том же неизменённом HTML 7/7 повторов
  доходят до доказанного `BROWSER_CONTROLS_UNREACHABLE` при 844×390.
- Критерий MICRO-030, sandbox/CSP и таймауты сохранены. Авторские минимальные
  регрессии проверяют overlay с разными подписями и безопасную компоновку отдельно
  от полностью обрезанных controls. Эти проверки не доказывают gameplay/win/loss.

## MICRO-029: изолированная подготовка SIWC

- MICRO-029.2 third-probe preflight: на c440ca0 синтетические ответы без model,
  с gpt-6-astra и с конфликтующими response.model ошибочно давали PASS.
  Диагностика теперь читает фактическую модель из SSE response metadata;
  отсутствие даёт SIWC_MODEL_ACTUAL_NOT_VERIFIED, несовпадение/конфликт —
  SIWC_MODEL_ACTUAL_MISMATCH. Произвольные значения заменяются OTHER.
  Регрессии RED до исправления, GREEN после. Это offline proof; прошлые LIVE
  ответы не пересматриваются. Для третьего probe разрешены только один новый
  OAuth и один POST с durable reservation в .local/siwc-third-probe; повтор
  после любого исхода запрещён, отчёт сохраняется только в этом каталоге.

- MICRO-029.3: проверка LocalSiwc.probe сама по себе не покрывает stdout/exit code
  CLI. Экспортированная runSiwcCli вызывается обычным source entry point и
  offline-тестами с fake HTTP/browser; 23 проверки, включая пять с loopback
  HTTP/SSE-сервером, проверяют max POST 1,
  отсутствие refresh/retry и утечек, включая 401/429/5xx/timeout/expired token.
  HTTP200 или SSE без completed + text не дают PASS. Реальный probe не запускался.
  [CLI proof и версия Gitleaks](micro-029-chatgpt-feasibility.md#micro-0293-финальная-offline-подготовка-cli).

- MICRO-032.1: `SIWC_OUTPUT_INVALID` при HTTP200/sseObserved true прежде возникал
  в completed-ветке при пустом или >8192 тексте, до чтения usage. Offline
  воспроизведена потеря delta при финальном output []; output_text.done также
  игнорировался. Теперь части объединяются без повторения снимков, metadata/usage
  сохраняются до проверки текста; пустой completed имеет отдельный
  SIWC_COMPLETED_WITHOUT_TEXT. Причина конкретного ответа владельца NOT_VERIFIED.
  Диагностика содержит только counts/status/codes/length/bytes/usage, без текста.
  Реальный probe не повторять без нового разрешения. [Разбор](micro-029-chatgpt-feasibility.md#micro-0321-пустой-результат-и-безопасная-диагностика).

- MICRO-029.2 / MICRO-032: владелец сообщил `SIWC_SSE_REQUIRED`, HTTP200,
  Content-Type UNKNOWN. Прежний header-only guard локально воспроизвёл отказ на
  корректном SSE без Content-Type. Исправление читает реальные data-кадры;
  JSON/HTML/оборванный stream не становятся PASS. Отчёт содержит безопасные
  `responseMediaType`/`sseObserved`. Причина реального HTTP200 не установлена.
  Только `gpt-6.1-sol` из свежего видимого каталога, reasoning medium; при отсутствии
  `SIWC_PROBE_MODEL_UNAVAILABLE`, POST 0, без подмены. Повторный LIVE probe требует
  нового разрешения. [Контракт и границы](micro-029-chatgpt-feasibility.md#micro-032-owner-operated-inference-probe-19102026).

- MICRO-032: HTTP 200 или output delta без `response.completed` не доказывают
  inference. `--probe` возвращает PARTIAL при `SIWC_STREAM_INTERRUPTED`,
  `SIWC_INFERENCE_INCOMPLETE`, `SIWC_USAGE_LIMIT`/`SIWC_USAGE_UNAVAILABLE` и timeout;
  автоматического повторного POST нет. Это проверено offline с синтетическим
  OpenAI HTTP, не реальным аккаунтом. После PARTIAL не перезапускать CLI без
  нового бюджета. [Ручной probe](micro-029-chatgpt-feasibility.md#micro-032-owner-operated-inference-probe-19102026).

- `SIWC_PLAN_PERMISSION_REQUIRED` / `SIWC_ID_TOKEN_INVALID`: identity sign-in
  не даёт автоматически ChatGPT plan usage. Проверяются granted scopes,
  криптографическая подпись и issuer/audience/expiry/nonce; обходов и inference нет.
- Windows path guard должен сравнивать нормализованный `resolve` root:
  trailing separator из `fileURLToPath` иначе не совпадает с `dirname`.
  Реальные loopback offline-тесты проходят после нормализации, без роста timeout.
- CLI `--prepare` не обращается к сети; `--authorize` — только ручной вход.
  Токены живут в памяти и забываются; persistent vault/refresh не реализованы.
  Crash lock автоматически не удаляется. [Сценарий, лицензии и ограничения](micro-029-chatgpt-feasibility.md).

## MICRO-036.4: post-merge ESM и controlled worker

- На `05b7a59` целевой runtime Chromium desktop прошёл 4/4; controlled worker
  на Chromium 320 / WebKit 390 упал 2/2. На `7d945502` запросы
  `/runtime/runtime.js`, `/runtime/contracts.js`, `/runtime/browser-profiles.js`
  вернули соответственно 200, 200, 404. Новый import в contracts остановил
  выполнение ESM до присваивания `window.testSession`. Исправление: добавить
  только `browser-profiles` в существующий точный allowlist `build/src`.
  Неизвестные модули, исходники и encoded traversal по-прежнему возвращают 404.
- В первоначальных trace controlled worker POST `/api/jobs` получил 503
  `LLM_NOT_CONFIGURED`; GET списка вернул 200 и `{"jobs":[]}`, UI показал
  «Заданий пока нет». `GenerationJobs.create` проверяет routes до INSERT,
  поэтому задание не создавалось. Причина: synthetic provider в fixture
  несовместим с явным UI mode `ollama-cloud`. Fixture теперь использует имя
  `ollama.com` с прежним локальным mock complete, без внешнего запроса.
  Assertions проверяют POST 202, наличие задания в manager/API, UI и завершение.
  Изменение MICRO-023 в PR #46 касается другой fixture и не вызвало этот отказ.
- Regression API обходит реальный ESM graph от runtime через contracts до
  browser-profiles; браузерная проверка загружает `/host`, получает game_ready,
  создаёт сессию и подтверждает game_started через analytics. RED воспроизведён
  до исправления. Таймауты, retries, sandbox/CSP и production provider rules
  не изменены. Все проверки synthetic/offline, реальные OAuth/inference POST: 0.

### Обязательный локальный gate перед merge

Любые изменения `src/`, `tests/`, игровых ресурсов, скриптов сборки или
конфигурации, влияющей на выполнение приложения, требуют полного
`npm run check` **до merge**.

Проверки выполняются на точном HEAD коммита, который планируется слить.
Результаты PASS, FAIL и SKIP фиксируются в описании PR.

Изменения исключительно документации, не влияющие на выполнение приложения,
допускаются без полного браузерного прогона.

Пока GitHub Actions недоступны, локальный PASS обязателен, но не приравнивается
к hosted CI PASS.


## MICRO-036.4a: потеря job.created при параллельном pruning

- Владелец воспроизвёл тот же flaky unit на main `7d945502` до MICRO-036.4:
  последовательные запуски PASS, параллельные — intermittent FAIL.
- Один инструментированный параллельный прогон на `37ea5f1` подтвердил 61
  `unlinkSync: ENOENT` и 14 `statSync: ENOENT` в `GenerationTraces.prune()`.
  Независимые тестовые процессы используют общий `.local/diagnostics/generation`
  у лимита 16 MiB. Пока один процесс обходит snapshot, другой уже удаляет файл.
  Ошибка конструктора предотвращает первую запись `job.created`; повторное
  создание logger позднее успешно. Отчёт содержал последующие события до
  `job.completed`, `traceAvailable:true`, `diagnosticsUnavailable:true`.
- Pruning теперь пропускает только исчезнувшие entries (`ENOENT`) при чтении
  metadata и удалении. Остальные ошибки не скрываются. Retention 7 дней,
  общий лимит 16 MiB, rotation, защита ссылок и редактирование секретов сохранены.
  Детерминированные тесты воспроизводят interleaving двух pruners после readdir
  и перед unlink: RED — настоящий ENOENT; GREEN — сохранён `job.created`.
  Permission failure и hardlink по-прежнему отклоняются, чужой HTML сохраняется.
- Пользовательские журналы не очищать ради PASS и assertion не ослаблять.
  Метаданные диагностического запуска находятся только в ignored `.local`.

## A1.8.6: Canvas с видимым DOM UI и неполное rendering evidence

- RED на `7660afb`: production checkFullHtml принимал авторскую Canvas-игру
  с HTML Start/Move/HUD как canvas-webgl-v1. Новый negative-тест требовал отказа,
  но promise resolved. GREEN: тот же HTML получает BROWSER_DOM_GAME_UI.
- Новый контракт запрещает DOM HUD/controls/Game Over. Проверка реального DOM
  включает текст, computed styles/pseudo-elements, SVG и open/closed Shadow DOM;
  ARIA роли не служат allowlist. Превышение bounded DOM анализа даёт
  BROWSER_CANVAS_DOM_UNVERIFIED (NOT_VERIFIED), не FAILED.
- Отдельный RED показал, что parseArtifact принимал новую checked LLM-версию
  без rendering evidence. Теперь Save требует canvas-webgl-strict-v2;
  saved-metadata сохраняет возможность читать прежний v1/отсутствующее поле.
- Финальный кадр после нескольких taps мог скрыть пустой кадр после Restart,
  если следующая проба снова рисовала. Каждый input теперь проверяется до
  следующего; clear→redraw ограничен прежними двумя 50 ms наблюдениями.
- Tests с прежним DOM UI не удалены: новая генерация ожидает отказ, а исторические
  версии остаются доступными через history/reopen/export. Rendering regressions
  дополнительно исполняются на Canvas-only authored fixtures.
- Offline/synthetic проверки не доказывают реальные provider calls, универсальные
  правила gameplay и физические Android/iOS/WebView. Детали и границы:
  [Strict Canvas contract](canvas-rendering-contract.md).

- Независимый аудит A1.8.6 дал пять дополнительных RED: display:contents text,
  текст за нулевым host, absolute pseudo UI, native audio controls и opaque Canvas
  с pointer-events:none над меняющимся миром. Range paint проверяется независимо
  от host rect (с overflow clipping); native audio controls запрещены. Canvas
  exposure учитывает painted sibling layers независимо от pointer-events;
  сложные неоднозначные ancestor stacking layouts остаются NOT_VERIFIED.
- Старые Canvas negatives с DOM controls отдельно проверяют historical refusal;
  новые Canvas-only reductions проверяют hidden/zero/no-draw/inert/landscape
  своими конкретными кодами, чтобы DOM gate не маскировал rendering regression.

- Follow-up audit: fixed/absolute controls могут выходить из обычного overflow
  ancestor, а offscreen pseudo не является видимым UI. Три новых RED→GREEN
  проверяют CSS containing blocks и computed pseudo geometry. Неизвестная
  геометрия pseudo даёт NOT_VERIFIED вместо ложного доказательства FAILED.
- Browser test artifacts из параллельных focused runs должны иметь разные
  `--output` каталоги; общий каталог дал trace ENOENT при удалении артефактов
  другим запуском. Desktop pointer probes используют click, touch — отдельный
  hasTouch context; tap на обычном desktop page отвергается самим Playwright.

- Full suite A1.8.6 воспроизвёл приём DOM controls внутри вложенного auto-scroll
  контейнера: до прокрутки их Range корректно clipped, но пользователь мог
  открыть HTML UI обычной прокруткой. Bounded scroll-ui probe теперь выполняет
  реальные wheel inputs максимум в трёх видимых scroll контейнерах и проверяет
  обнаруженный DOM после каждого. scrollTop/DOM не подменяются. RED полного
  теста nested → GREEN; положительные Canvas и невидимые technical fixtures
  сохранены. Это DOM inspection, не доказательство phone control reachability.

- Итоговая paint матрица добавила четыре RED→GREEN: in-flow pseudo и shadow на
  нулевом host, outline и SVG child за нулевым SVG viewport. Видимое outline/SVG
  отвергается; неподтверждаемая геометрия generated paint/shadow даёт
  BROWSER_CANVAS_DOM_UNVERIFIED. Полностью transparent pseudo text допускается.
  Пять positive + четыре negative cases прошли 9/9.
- Нулевой backing store прежде доходил до NaN координат и общего INCONCLUSIVE.
  Теперь layout проверяется до probes: BROWSER_CANVAS_LAYOUT, без repair/fallback.
  Отдельный RED→GREEN фиксирует именно Canvas classification.

- CSS-visible head/title мог обходить body-only обход. Отдельный RED принимал
  такой HUD. Observer теперь обходит весь document (с прежним bounded cap),
  обычные head/meta/title/script/style остаются разрешены невидимыми. Новый
  negative и два Canvas/technical positives прошли 3/3 GREEN.
