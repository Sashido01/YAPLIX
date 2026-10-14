# Приёмка YAPLIX

Исторические проверки TASK-007/009 сохранены ниже. Сценарий актуализирован для
TASK-010; текущие результаты и границы — в [едином отчёте](task-010-report.md).
Browser tests, реальные LLM, hosted CI и физические устройства имеют разные границы.

## Сценарий 3–5 минут

1. Чистый клон, YAPLIX.cmd или npm run app без ключей: каталог и DEMO лабиринт.
2. Задание → явное «Открыть» → Старт/движение/победа; Replay/поражение,
   library/new version/old version. Генерация другой игры не прерывает текущий раунд.
3. Exact HTML export, offline управление; restart server сохраняет историю.
4. Backup/verify hash/schema, diagnosis; LAN QR + separate access key.
5. LIVE cloud: обычное описание, настоящий HTML/JS, actual model/attempts,
   input/pause/outcome; доработка полного предыдущего HTML следующей версией.
6. Telegram после HTTPS/menu: signed вход, общая library и тот же gameplay.
7. Центр заданий после возврата/restart: запрос и записанный draft сохранены;
   recoverable ошибки восстанавливаются автоматически в durable бюджете. Неизвестный
   потенциально оплаченный route не повторяется слепо. Rate/quota/stream/truncation
   fixtures должны подтверждать соответствующие [границы](known-errors.md).
8. Toast не переключает игру; скрытый результат остаётся в центре/каталоге.
   Telegram notification проверяется только после согласия, separately от UI toast.
9. Без cloud/key запустить две авторские reserve-игры по явному действию в каталоге,
   проверить реальные правила/поражение/restart/offline отдельно от LLM provenance.
10. /start, /games, /new, /status, /help работают при доступном Bot API даже без
    HTTPS. Mini App/menu требуют отдельного подтверждения текущего внешнего адреса.

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

Для TASK-010 отдельно проверяются concrete бесплатная OpenRouter модель и Ollama
Cloud, автоматическое восстановление и реальные аркады. Уровни доказательства:
структура HTML → выполнение JS → видимый UI → наблюдаемый gameplay →
проверенный финал → соответствие конкретному prompt. Общий checker публикует только
HTML_VALID, JS_EXECUTABLE, UI_VISIBLE, MOBILE_VERIFIED. Его короткий сценарий
startup/input/pause/resume/offline выполняется на 320/390 px; arbitrary mechanics, победа,
поражение и соответствие запросу требуют отдельного сценария. Read-only state и
скриншот — диагностические данные, не замена игре. Авторская gallery не выдаётся за LIVE.

Аудит TASK-009 сопоставляет реализованный сценарий с требованиями предоставленного
задания. Официальный документ кейса Билайна для независимой сверки не предоставлен;
полное соответствие официальному кейсу пока **не проверено**.
В TASK-010 владелец предоставил официальный двухстраничный кейс
`docs/Keys_Bilayn.pdf`. Файл владельца сохраняется локально и не публикуется
автоматически. Следующая сверка относится к этому документу; это инженерный
self-audit, а не решение организаторов конкурса.

## Официальный кейс Билайна: обязательные требования

| Требование | Подтверждение / оставшаяся граница |
| --- | --- |
| Естественный текстовый запрос | Форма создания и version edit принимают описание без пользовательского кода; controlled browser scenarios. |
| Настоящая LLM генерация кода | Реальные Ollama Cloud HTML/JS и provenance сохранены отдельно; authored/DEMO не подставляются вместо LIVE. |
| Начало → gameplay → победа/поражение, управление | У реального falling-blocks HTML наблюдались touch/rotation, победа на 320 и поражение на 390 px. Direct shooter на обоих размерах offline прошёл touch/projectiles, 3 waves/450 points/win/restart через DOM/keyboard с virtual clock. Shooter loss и все mechanics отдельно не доказаны; общий gate не является полной приёмкой. |
| Self-contained HTML5+JS для WebView | Export и offline browser проверяются без server dependencies во время игры. Физический embedded WebView не проверен. |
| Команда 2–4 человека | Состав человеческой команды не подтверждён; агенты не считаются участниками команды. |
| Git с историей разработки | История коммитов существует. Итоговый TASK-010 commit/merge проверяются в delivery workflow отдельно. |
| Презентация 3–5 минут | Сценарий выше подготовлен; человеческая репетиция и фактическая презентация не проведены. |
| Использование AI при разработке и/или генерации | Реальные LLM generation calls подтверждены evidence. Это не оценка качества каждого результата. |

## Бонусы кейса

| Бонус | Реализация / граница |
| --- | --- |
| Аудитория | Audience передаётся в prompt; качество адаптации для разных аудиторий требует отдельных игровых примеров. |
| Аналитика влияет на следующие генерации | Статистика отображается; автоматическая передача аналитики в LLM для выбора успешных механик не реализована. |
| Итеративная доработка | Новая версия получает прежний HTML и новое требование; история сохраняется. Успех каждого реального edit отдельно проверяется. |
| AI графика/звук | Canvas graphics создаются внутри generated code; отдельного AI asset pipeline нет, бонус полностью не заявляется. |
| Touch и мобильное масштабирование | Browser profiles и отдельные offline scenarios; physical WebView/safe-area/keyboard требуют проверки человеком. |
| История/галерея/share | Сохранение версий, explicit gallery import, private version links и HTML export. Public share требует доступного защищённого HTTPS. |
| Разные жанры | Реальные LIVE blocks и shooter имеют отдельные browser scenario evidence; две authored reference-игры маркированы отдельно. Два результата не доказывают устойчивую генерацию любых жанров. |

Точные реальные вызовы и timings — в [TASK-010 report](task-010-report.md).

## Данные

Перед update проверенный backup, no old HTML/metadata rewrite. TASK-009 добавляет
schema v2 с protective before-v2 snapshot; [restore/update](development-setup.md).
TASK-010 schema v2 не меняет; добавляются recovery metadata внутри existing jobs.
Приёмка сравнивает исходные rows/hashes/history/events, открывает старые игры,
скачивает exact HTML. Old validationStatus сохраняется, passed задним числом не
назначается. Новые версии только добавляются; failure не записывается.
