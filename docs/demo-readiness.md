# Приёмка YAPLIX

## Текущий статус — MICRO-036.2

18 октября 2026, main `942387eb1fc06792767bddf2ae766cd0ed4676ff`.
Product/demo readiness — **PARTIAL**. PR #44 со стабильным портом merged;
Android/Brave: подключение, запуск «Волк ловит яйца», QR refresh/re-entry и revoke
подтверждены владельцем, не independently observed. Version ID и LLM provenance
этой игры — NOT_VERIFIED. [Точный physical scope](micro-036-stable-phone-port.md).

Аудит обнаружил блокер новых Full HTML результатов: checker возвращает три
профиля, parseArtifact разрешает два → `INVALID_GENERATION_METADATA`.
[Контракт валидатора](game-validation.md#контракт-browser-metadata--блокер-micro-0362).
Ранее записанные LIVE успехи ниже не доказывают работоспособность нового создания
на этом HEAD. Открытие уже сохранённых игр этим probe не проверялось и не
объявляется сломанным. [Компактный статус](SESSION_HANDOFF.md),
[противоречия/пробелы аудита](micro-036-2-docs-audit.md).
PR #34/#37 — OPEN Draft, не включены в текущий main и не изменялись.
Эта задача — docs + audit, inference POST 0, без merge и без изменения production.


Исторические проверки TASK-007/009/010 сохранены ниже; их маршруты и timings
не считаются текущим результатом MICRO-019. [Отчёт TASK-010](task-010-report.md).
Browser tests, реальные LLM, hosted CI и физические устройства имеют разные границы.

Production routes MICRO-023 (подтверждены source-аудитом): создание и редактирование предлагают Ollama Cloud
по умолчанию и OpenRouter Free вручную. Допустимы только gemma4:31b на
https://ollama.com/v1 и openrouter/free на https://openrouter.ai/api/v1.
Legacy Auto означает только Ollama, автоматического fallback нет. Базовый
контракт — полный offline HTML/CSS/JS; gameplay и технический запуск различаются.
Исторический отчёт MICRO-023L: 1 fresh Ollama POST,
LIVE PARTIAL: desktop win/loss/restart/export подтверждены, mobile touch FAILED
в Chromium emulation; editing не запускалось по owner stop condition.
[Точная приёмка: минимум 2 запроса после разрешения](micro-023-report.md).
Hosted Actions временно выключены владельцем до 29 октября 2026:
[локальные проверки и восстановление](ci-economy.md).

## Демонстрация 3–5 минут: новая игра и сохранённый LLM-результат

Это подготовленный сценарий, не состоявшаяся презентация. **На текущем HEAD
новое Full HTML создание блокируется контрактом metadata**. До демонстрации
нужны отдельное исправление/проверка этого blocker либо явное объявление проблемы
аудитории. Не обещайте live-ready результат на `942387eb`.

Перед репетицией: настроенное владельцем облако и серверный Chromium; уже
сохранённая LLM-версия, заранее проверенная на том же устройстве. Владелец
фиксирует её название, versionId, hash, `method=llm_code`, provider/model и
связанный generation job/report. UI provenance — полезная маркировка, но не
независимое доказательство происхождения. Исторический кандидат — реальный
Full HTML из [MICRO-027](micro-027-report.md#live--four-post-no-hidden-retries);
его наличие в текущей библиотеке этим аудитом не проверено. Не импортировать
HTML через authored/mock и не выдавать его за новый LIVE.
«Волк ловит яйца» пока не подходит как доказанный LLM fallback: provenance неизвестен.

Обычное создание во время будущей демонстрации требует отдельного согласованного
inference-бюджета, включая все retry/repair. Один клик не равен одному POST.
В MICRO-036.2 ничего не создаётся, настройки попыток/ключи не меняются.

| Время | Действие и честное пояснение |
| --- | --- |
| 0:00–0:30 | Открыть YAPLIX обычным launcher. Показать «Создать», библиотеку и сохранённый резерв. Объяснить: модель пишет полный HTML, сервер проверяет и сохраняет версию. |
| 0:30–1:30 | После устранения blocker и отдельного разрешения: в «Создать» выбрать Ollama Cloud, ввести обычный запрос «Игра: корабль собирает 5 звёзд, уклоняется от астероидов; touch, победа после 5 звёзд, поражение при столкновении, Restart», нажать «Создать игру». Показать фактический этап задания. Не менять provider автоматически. |
| 1:30–2:00 | Если готово — явное «Открыть». Если облако отказало/задание не завершилось за отведённую минуту, показать фактический статус, при необходимости отменить своё ещё активное задание и явно сказать: «Новая генерация сейчас не завершилась; покажу заранее сохранённый результат LLM». Открыть именно заранее проверенную версию из «Игры». Не заявлять timeout модели только из-за лимита времени выступления. |
| 2:00–3:00 | Показать Start, реальное управление, наблюдаемый прогресс, Restart. Победу/поражение назвать только если достигнуты; короткий technical gate не подтверждает все правила. |
| 3:00–4:00 | «Подключить телефон»: QR, постоянный порт 52604, Android/Brave в той же доверенной сети. Refresh → повторный вход, затем отключить доступ. Не показывать токен крупным планом в записи. При сетевом сбое показать компьютер и честно назвать границу; не менять Firewall на сцене. |
| 4:00–4:30 | Показать историю версии и экспорт HTML. Офлайн-запуск — только заранее проверенный; ключей и сервера в HTML нет. Завершить списком границ: новая облачная генерация зависит от провайдера, iOS/Telegram physical не закрыты. |

Цель — 4:30, не более 5:00. Если генерация не закончилась за минуту, переход к
сохранённой версии не маскирует отказ и не заменяет состояние исходного job.
Если до выступления LLM provenance резерва не подтверждено, этот демонстрационный
fallback остаётся **NOT_VERIFIED**: можно показать явно authored offline-пример,
но он не закрывает требование настоящей LLM генерации. Edit с новым POST в этот
короткий сценарий не входит; история версий показывается на сохранённых данных.

## Автоматизация

npm test: contracts/SQLite/history/backup/Host/Origin/auth/timeout/cancel, Cloud/
Ollama protocols, Telegram HMAC/allowlist, shares/rates. Transport синтетический;
fake checker используется только в явно помеченных unit tests.
Browser suite **реальный Chromium checker**: positive/zero-size/fatal JS/autostart/
duplicate start/network negatives, bounded repair без сохранения broken version.
Production process: LAN/auth, независимый QR decode, restart/export, synthetic
transport. 12 Chromium/WebKit/Firefox profiles: responsive/input/navigation/history/
offline/isolation. Telegram SDK synthetic: allowed/forbidden/tampered, theme/viewport/
safe-area, blocked cookies, share/listener cleanup.
Performance семь cold 390x844 DPR2 Slow4G CPUx4 before/after, [результаты](cross-platform.md).
Budgets прежние: JS 150 KB, CSS 30 KB, critical 250 KB; p75 target 3 s. LLM отдельно.

## Реальная LLM и внешние шаги

В TASK-007 проверен настоящий HTML5 Space Dodge через `openrouter/free`:
`dots-studio/dots-3-note-preview:free` (~100 s), клавиатура/пауза, две обычные
победы без изменения состояния или часов игры. Доработки через production UI:
`cohere/north-mini-code:free` (~36 s), затем `poolside/laguna-s-2.1:free` (~43 s).
Последняя исправила перекрытые фоном звёзды; touch двигает корабль, pause замораживает
Canvas, 150 звёзд видимы, победа задана на 12 s. Exact export играет offline;
хеш исходной версии сохранён. Модели выбирает free router, это не рейтинг качества.
Первый набор трёх запросов не прошёл gate; один ответ доработки был неполным.
Ошибки не сохранялись и не заменялись DEMO. Наличие одного успешного сценария
не гарантирует качество каждого ответа бесплатных моделей.

В TASK-009 ограниченный pilot `benchmark:generation` выполнил два раздельных
запроса `openrouter/free`, каждый с deadline 60 s, одним dispatch и без repair/fallback.
Оба завершились `LLM_TIMEOUT`: первая попытка сообщила `cohere/north-mini-code:free`,
вторая actual model не сообщила. Играбельных версий нет, output/reasoning usage
не получен, Time to First Playable Game отсутствует. Исходные prompts/jobs сохранены
в изолированных benchmark SQLite; доступного частичного HTML не было. Этот pilot
проверяет сохранение намерения, но не доказывает качество/скорость успешной генерации.
Ollama Cloud inference в этой проверке не выполнялся: credentials отсутствуют.

npm run demo:live сохраняет три ordinary game prompts, actual free model, time/
attempts и exact HTML в ignored .local/live. Dynamic free router не сравнивает
фиксированные модели и не обосновывает «лучшую». Проверяйте каждый HTML до win/loss
и следующую version отдельно. Ошибка модели/лимита — отказ, без DEMO подмены.
Bot token проверяет telegram:check, независимо от Mini App launch.
[Внешние шаги](telegram.md): HTTPS/menu/real client. Physical Ubuntu laptop,
Android/iPhone/WebView/keyboard/safe-area/download требуют человеческой репетиции.
Hosted CI этого не подтверждает.

В историческом TASK-010 отдельно проверялись concrete бесплатная OpenRouter модель и Ollama
Cloud, автоматическое восстановление и реальные аркады. Уровни доказательства:
структура HTML → выполнение JS → видимый UI → наблюдаемый gameplay →
проверенный финал → соответствие конкретному prompt. Общий checker публикует только
HTML_VALID, JS_EXECUTABLE, UI_VISIBLE, MOBILE_VERIFIED. Его короткий сценарий
legacy startup/input/pause/resume/offline выполняется на 320/390 px; Full HTML
touch probe теперь включает 844×390 и не использует keyboard fallback; arbitrary mechanics, победа,
поражение и соответствие запросу требуют отдельного сценария. Read-only state и
скриншот — диагностические данные, не замена игре. Авторская gallery не выдаётся за LIVE.

## Кейс Билайна: источник и шкала

Ниже **8 обязательных + 7 бонусных** пунктов из уже записанной расшифровки
TASK-010 в прежней версии этого документа, а не новая независимая сверка с PDF.
PDF владельца не читался и не публикуется. Формулировки и полноту официального
оригинала в MICRO-036.2 повторно не подтверждали; это инженерный self-audit,
не решение организаторов. [Исходный TASK-010 evidence](task-010-report.md).

VERIFIED — есть evidence ровно указанного свойства; PARTIAL — реализована или
проверена лишь часть; NOT_VERIFIED — достаточного подтверждения нет. Source/test
аудит, исторический отчёт, новый synthetic probe и сообщение владельца различаются.
Тестовый файл — описание проверки, не утверждение о её новом запуске на этом HEAD.

## Восемь обязательных требований

| № | Требование | Статус | Реальное evidence и предел |
| --- | --- | --- | --- |
| M1 | Естественный текстовый запрос | VERIFIED | Форма и обработка идеи/изменения существуют: [UI](../src/ui.ts), [generationMessages](../src/generation.ts), [контролируемый UI сценарий](../tests/micro027.spec.ts). Проверено свойство входа, не качество любого результата. |
| M2 | Настоящая LLM генерация кода | PARTIAL | [MICRO-027: POST 3, gemma4:31b, 9894 bytes](micro-027-report.md#live--four-post-no-hidden-retries), [TASK-010](task-010-report.md) — исторические реальные результаты. На текущем HEAD выявлен [metadata blocker](game-validation.md#контракт-browser-metadata--блокер-micro-0362); нового LIVE proof нет; provenance «Волк ловит яйца» неизвестен. |
| M3 | Начало → gameplay → победа/поражение, управление | PARTIAL | [Исторический gameplay MICRO-027](micro-027-report.md#ui--gameplay-proof-and-limits), [TASK-010](task-010-report.md). Owner-confirmed Android запуск не подтверждает оба финала или правила произвольного HTML. |
| M4 | Self-contained HTML5+JS для WebView | PARTIAL | [Static/offline checker](../src/full-html-check.ts), [runtime/offline tests](../tests/runtime.spec.ts), [реальный export MICRO-027](micro-027-report.md). Физический embedded Android WebView/WKWebView не подтверждён; Brave не заменяет эти клиенты. |
| M5 | Команда 2–4 человека | PARTIAL | [AUTHORS](../AUTHORS.md) заявляет команду из 3 человек, но участники №2/№3 и их вклад пока placeholders. Декларация есть; фактический состав независимо не подтверждён. Агенты не считаются командой. |
| M6 | Git с историей разработки | VERIFIED | Проверены main `942387eb`, предыдущие commits и [merge PR #44](https://github.com/Sashido01/YAPLIX/pull/44). Это наличие истории, не оценка организаторов. |
| M7 | Презентация 3–5 минут | PARTIAL | Сценарий 4:30 выше подготовлен. Репетиция/запись, подтверждённый локальный LLM fallback и новая успешная генерация на этом HEAD отсутствуют. |
| M8 | Использование AI при разработке и/или генерации | VERIFIED | Задокументированы реальные [LLM вызовы MICRO-027](micro-027-report.md#live--four-post-no-hidden-retries) и [TASK-010](task-010-report.md). 0 новых POST в этом аудите не отменяет исторический evidence. |

## Семь бонусных требований

| № | Бонус | Статус | Реальное evidence и предел |
| --- | --- | --- | --- |
| B1 | Аудитория | PARTIAL | Audience передаётся в [generationMessages](../src/generation.ts), есть [intent tests](../tests/game-intent.test.ts); отдельная проверка качества адаптации разным аудиториям не выполнена. |
| B2 | Аналитика влияет на следующие генерации | NOT_VERIFIED | [Store analytics](../src/store.ts) считает события; [generationMessages](../src/generation.ts) не передаёт статистику для выбора успешных механик. Feedback loop не реализован, отображение аналитики не закрывает бонус. |
| B3 | Итеративная доработка | PARTIAL | Полный previous HTML в [generationMessages](../src/generation.ts), версии в [Store](../src/store.ts), [исторические реальные edits](task-010-report.md), [synthetic UI](../tests/micro027.spec.ts). Новый Full HTML edit также затронут metadata blocker. |
| B4 | AI графика/звук | PARTIAL | Исторические generated Canvas игры описаны в [TASK-010](task-010-report.md); отдельный проверенный AI image/audio asset pipeline не подтверждён. Код рисования не доказывает генерацию самостоятельных медиаресурсов. |
| B5 | Touch и мобильное масштабирование | PARTIAL | [Phone регрессии MICRO-036.1](micro-036-stable-phone-port.md#проверки-качества), [owner-confirmed Android/Brave](micro-036-stable-phone-port.md#micro-0362--физическая-приёмка-подтверждение-владельца), [layout probes](../tests/generation.spec.ts). iOS, физический WebView, все игровые состояния/rotation/keyboard не закрыты этим сообщением. |
| B6 | История/галерея/share | PARTIAL | [Store](../src/store.ts), [phone-only listener](../src/phone.ts), owner-confirmed QR/revoke; [архитектура shares](architecture.md#telegram-и-shares). Public HTTPS/Mini App delivery не подтверждены текущим аудитом. |
| B7 | Разные жанры | PARTIAL | Исторические LIVE blocks/shooter в [TASK-010](task-010-report.md), иной Full HTML в [MICRO-027](micro-027-report.md). Это отдельные результаты, не доказательство устойчивого создания любых жанров. |

## Данные

Перед update проверенный backup, no old HTML/metadata rewrite. TASK-009 добавляет
schema v2 с protective before-v2 snapshot; [restore/update](development-setup.md).
TASK-010 schema v2 не меняет; добавляются recovery metadata внутри existing jobs.
Приёмка сравнивает исходные rows/hashes/history/events, открывает старые игры,
скачивает exact HTML. Old validationStatus сохраняется, passed задним числом не
назначается. Новые версии только добавляются; failure не записывается.

MICRO-019, 16.10.2026: LIVE «Собери игру три в ряд» не получила HTML: 4/4 inference POST (Ollama interruption, три OpenRouter timeout). Gameplay NOT VERIFIED; product acceptance PARTIAL. [Текущий evidence/handoff](SESSION_HANDOFF.md).
