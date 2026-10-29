# Диагностика и журналы YAPLIX

# YAPLIX-FINAL-005 — LIVE repair и ошибка sandbox (28 октября 2026)

> **Уточнение YAPLIX-RELEASE-006:** приведённый ниже `SecurityError` был
> воспроизведён в тестовом harness, где `context.addInitScript` обращался к
> `localStorage` и автоматически исполнялся во всех frame, включая opaque game
> iframe. Точная сохранённая версия без этого init script открылась в штатном
> player без исключения; добавление init script воспроизвело исключение с
> sandbox origin `null`. Следовательно, старый вывод об источнике в game HTML
> отменён evidence новой проверки. Checker PASS при сохранении всё равно не
> подтверждает механику; gameplay и варианты доказательств перечислены в
> release report (локально: `../.local/yaplix-release-006/REPORT.md`).

Ollama Cloud edit и последующий repair выполнены через UI. Job
`fb42b696-9938-4a14-bd89-641f6f38f692` сохранил версию
`15dcddd9-5c3a-4f97-94ad-423970a0cddc` после двух same-model repair; trace
содержит два `BROWSER_CANVAS_UI_OVERLAP`, подтверждённые `repair.eligibility`,
и финальные `browser.validation_completed`, `version.saved`, `job.completed` PASS.
Это технический, не игровой PASS. При последующем UI открытии версия выбросила
`SecurityError` о `localStorage` в sandboxed document. Экспорт через UI совпал
с SQLite HTML побайтно. Внутри HTML прямой токен `localStorage` не обнаружен;
источник доступа пока неизвестен. Job diagnostics и export хранятся локально в
`.local/yaplix-final-005/`; не копировать их содержимое в публичные логи.


## YAPLIX-FINAL-001 — 28 октября 2026

В изолированном data home `.local/yaplix-final-001/` выполнены три новые
Ollama Cloud генерации, один same-model repair и перезапуск durable worker.
Подтверждённый Canvas text clipping был повторно проверен после restart и
автоматически получил repair POST; после него gate остановился на
`BROWSER_CANVAS_RENDER_UNVERIFIED`. Другие результаты: landscape
`BROWSER_CANVAS_ACTIVITY_UNVERIFIED` и `BROWSER_TIMEOUT_RENDER`. Готовой версии
не сохранено; Technical PASS и Gameplay PASS отсутствуют. Все job traces, private
snapshots и отчёт находятся в изолированном локальном каталоге; см.
YAPLIX-FINAL-001 report (локально: `../.local/yaplix-final-001/REPORT.md`). Счётчик включает
четыре POST текущей задачи и три trace-confirmed POST предыдущих YAPLIX этапов.

Документ описывает локальный checkout на 27 октября 2026 года. Job и операции
без игры имеют отдельные связанные metadata-only traces. Их доказательные
границы и ограничения приведены ниже; сводка состояния — в [release status](release-status.md).

## YAPLIX-GENERATION-RECOVERY-001 — 28 октября 2026

Четыре trace от 27 октября показывают разные точки отказа: два Ollama ответа
дошли до HTML/browser gate, OpenRouter остановился на ограничении размера ответа,
ChatGPT дошёл до Canvas activity gate. Snapshots, hashes и счётчики POST
перечислены в локальном отчёте (локально: `../.local/yaplix-generation-recovery-001/REPORT.md`).
У ChatGPT trace не содержит wire-dispatch/HTTP-событий, поэтому число POST по
этой записи `NOT_VERIFIED`; не выводите его из длительности задания. API текущего
`:3000` требует авторизацию (`/api/jobs` и `/api/diagnostics` вернули 401), а
health commit не совпал с локальным checkout. Не используйте эти данные как
доказательство, что текущий UI подключён к этому процессу.

## YAPLIX-GENERATION-RECOVERY-002 — 28 октября 2026

Health на :3000 сообщает commit `f681b1359f6a0b8ecb9f2c49a88ac72b75bde73b`,
а checkout — `78492bf`; PID и browser tab не установлены. `/api/jobs` и
`/api/diagnostics` вернули 401, который не обходился. Не связывайте эти traces с
открытой вкладкой или user SQLite без подтверждения instance identity.

Текущий ChatGPT transport пишет dispatch перед единственным POST и HTTP status
при получении ответа. Это metadata-only: без OAuth, headers, body или prompt.
Synthetic test подтверждает counters; старые traces не изменяются. См. локальный
Recovery-002 report (локально: `../.local/yaplix-generation-recovery-002/REPORT.md`).

## Операционный trace

Startup/bootstrap/desktop launch используют один `operationId` из
`YAPLIX_OPERATION_ID` (создаётся при отсутствии); backend и generation trace
сохраняют этот идентификатор. Установка/update/rollback, backup и проверка
backup получают отдельные идентификаторы. JSONL лежит в
`<YAPLIX_DATA_HOME>/diagnostics/operations/<operationId>.jsonl`; без отдельного
data home используется `.local/diagnostics/operations/`. Файл имеет режим `0600`,
каталог `0700`; один `.1` фрагмент, максимум 128 KiB на файл, 16 MiB суммарно и
retention 7 дней. Trace best-effort: отказ записи не меняет результат установки,
backup или запуска.

Чтобы найти запуск desktop, откройте `desktop.log`: строки READY/STOPPED
содержат operationId. Для прямого `npm run start` возьмите имя самого нового
JSONL файла из указанного каталога. Затем сопоставьте `operationId` с полем того
же имени в `.local/diagnostics/generation/<jobId>.jsonl`; `jobId` указан в
событии `generation.job_linked`. Не передавайте полный лог без проверки приватности.

События отражают фактические точки кода: startup config/database/API/UI и browser
readiness; bootstrap Node/dependencies/build/app; desktop runtime/backend;
installer platform/plan/backup/install/verify/launch/recovery/rollback; backup и
backup verification. Startup integrity входит в существующий запрос readiness,
не запускается отдельно ради trace. Этапы, отсутствующие в adapter пути, не
имитируются.

Desktop launcher пишет `desktop.started` для каждой CLI операции с безопасным
`details.action`; старт дополнительно фиксирует `desktop.runtime_verified` и
`desktop.backend_ready`, повторное подключение — `desktop.instance_reused`,
остановку — `desktop.stop_requested` и `desktop.stopped`, а запуск после
зафиксированной остановки — `desktop.restart`. При отказе записывается
`desktop.failed`. Launcher worker использует тот же `operationId`, что и вызов,
который его запустил. Готовность подтверждается сохранённым profile state,
loopback instance proof и `/healthz`; закрытие CLI handshake не является
командой остановки backend. Удаление lock сверяет PID владельца, удаление state —
instance. Эти строки не содержат адресов с ключами, API credentials или prompt.

## Диагностика durable job

1. Получите `jobId` из «Заданий» или ответа API. Для серверной диагностики
   запросите `GET /api/jobs/<jobId>/diagnostics` в том же авторизованном
   экземпляре YAPLIX. Endpoint принадлежит job и выдаёт metadata-only trace,
   агрегаты dispatch/HTTP/неопределённых исходов, счётчик repair, текущую стадию,
   checkpoint hash и ссылки на private captures. Не пересылайте полный JSON без
   просмотра `idea`, fault и локальных путей.
2. Текущие JSONL-файлы находятся под
   `YAPLIX_DATA_HOME/.local/diagnostics/generation/`; если переменная не задана,
   корень данных — корень проекта `.local/`. По одному trace на job:
   `<jobId>.jsonl` и один ротационный `<jobId>.jsonl.1`.
3. Приватные prompt captures и PNG snapshots, когда они созданы, находятся в
   `YAPLIX_DATA_HOME/.local/diagnostics/generation-private/`. Каталог имеет режим
   `0700`, файлы `0600`. Captures содержат текст промпта или изображение и
   требуют особой осторожности при передаче.

Пример локального HTTP-запроса (добавьте штатную авторизацию экземпляра):

```sh
curl --fail --silent --show-error \
  http://127.0.0.1:3020/api/jobs/JOB_ID/diagnostics \
  -o job-diagnostics.json
```

Порт может отличаться; используйте адрес, показанный текущим launcher. Не
добавляйте access key, cookie или bearer в командную строку, shell history,
общий лог или текст отчёта.

## Временная шкала и статусы

Каждая запись содержит timestamp UTC, `jobId`/`correlationId`, `stage`, `event`,
статус и allowlisted metadata. `timeline[].elapsedMs` считается относительно
первого сохранённого события; отдельные события могут иметь `durationMs`.

| Статус | Значение |
| --- | --- |
| `PASS` | Указанный технический этап завершён по своему контракту. Это не означает, что вся игра качественная. |
| `FAIL` | Этап обнаружил блокирующее нарушение или ошибку. Смотрите `errorCode`, `phase` и viewport. |
| `NOT_VERIFIED` | Проверку нельзя было завершить или доказательств не хватило; это не PASS и не подтверждённый дефект. |
| `SKIPPED` | Этап намеренно пропущен; обычно trace содержит причину в коде/allowlisted `blockers`. |
| `STARTED` | Начало этапа записано, завершение могло не успеть попасть в журнал при аварийном завершении. |

Сравнивайте `browser.viewport.started/completed` для каждого реально достигнутого
viewport. Отсутствующее событие означает, что этот viewport не подтверждён.
`BROWSER_CANVAS_*_UNVERIFIED` следует отличать от подтверждённых `FAIL` кодов.
Repair допустим только при текущем явно подтверждённом и исправимом дефекте;
смотрите `repair.eligibility`, затем `repair.started/completed`. `SKIPPED` не
означает ошибку модели.

## Подтверждённые и неопределённые LLM POST

API отчёт отдельно показывает:

- `llmPostDispatches` — сетевой клиент начал wire dispatch;
- `llmPostHttpResponses` — получены HTTP response headers;
- `llmPostUnknownOutcomes` — dispatch был, но соответствующий HTTP response не
  записан; результат запроса неизвестен, повторять автоматически небезопасно.

Каталожные GET не являются inference POST. Число попыток или `request.started`
само по себе не доказывает dispatch. После timeout/обрыва неизвестный исход не
следует считать нулём потраченных запросов.

## Где лежат остальные локальные журналы

- Generation JSONL и API report описаны выше.
- Operation JSONL для startup/install/update/recovery и backups расположен под
  data home в `diagnostics/operations/`; см. раздел operation trace.
- Установщик пишет ограниченные строки `stage`/`code` в
  `<installHome>/installer/install.log`.
- Установленный desktop launcher пишет короткие коды запуска/остановки в
  `<YAPLIX_DATA_HOME>/desktop.log`.
- SQLite jobs/checkpoints сохраняются в data home; SQLite является durable
  состоянием задания, но не заменяет trace timeline.
- `.local/<task>/REPORT.md` и связанные файлы — свидетельства конкретного
  эксперимента. Это не текущие журналы production и не должны редактироваться
  для согласования с новым состоянием.

## Проверка Chromium, SQLite и экспорта

При `BROWSER_*` ошибке сначала проверьте этап launch, executable readiness,
`sandboxEnabled`, `launchErrorCategory`, временный профиль, затем события viewport.
Не отключайте sandbox, CSP или TLS и не меняйте браузер после отказа. Ошибка до
`browser.viewport.started` — инфраструктурный отказ, не доказательство дефекта
игровой механики.

Для SQLite используйте только копию/изолированную базу либо штатный read-only
doctor. Не открывайте пользовательскую базу на запись ради диагностики. Успешное
`integrity_check` подтверждает целостность базы, но отдельно проверяйте наличие
нужных game/version/job rows и запуск конкретной игры.

`version.export.started/completed/failed` связывает export с job, когда версии
созданы durable job. Сверьте размер и SHA-256 ответа с сохранённой версией;
запуск экспортированного HTML проверяется отдельно в offline sandbox.

## UI trace для сохранённой игры

Действия UI, связанные с уже сохранённой durable-job версией, входят в её trace:
`ui.panel_changed` (раздел), `ui.game_opened`, `ui.viewport_changed`,
`ui.export_opened`, а также `ui.api_error`, `ui.state_error` и ошибки самого
игрового iframe (`ui.game_runtime_error`). Для host JS exceptions используется
отдельный `ui.host_error`. Ошибки UI записываются как `FAIL`; браузерные
исключения игры не смешиваются с API/action сбоями. В UI trace передаются только
фиксированные коды `UI_API_ERROR`/`UI_ACTION_ERROR`, viewport и безопасная
геометрия — без API URL, payload, текста исключения, токена или пользовательского
prompt. Непредвиденные ошибки без выбранной сохранённой версии и авторские
offline-игры не имеют связи с durable job, поэтому не обещается запись в её
version trace.

## Приватность, ротация и передача отчёта

Общий JSONL — metadata-only: whitelist полей и событий не принимает полный
prompt, HTML, HTTP headers или тело исключения. Секретоподобные значения и
сетевые URL отбрасываются/очищаются; пользовательский текст не следует добавлять
в `details`. Не включайте ключи, токены, cookies, полный `.env`, полный prompt,
HTML или персональные данные.

На trace действует ограничение примерно 128 KiB на файл плюс один предыдущий
фрагмент `.1`; общий предел каталога 16 MiB и срок хранения 7 суток. Очистка
проверяется при создании trace и периодически во время записи. Private captures
не входят в metadata JSONL и ограничены размером; в текущем коде автоматическая
ротация для private captures не подтверждена. Удаление старых private artifacts
проводите только после проверки владельца и retention-нужд.

Для безопасной передачи разработчику создайте отдельную копию API report,
проверьте `idea`, пути и значения полей, удалите IDs/лишний контекст при
необходимости. Передавайте конкретный `errorCode`, фазу, viewport, счётчики и
статусы; не передавайте private captures без отдельной проверки. Следует считать
отчёт локально чувствительным даже при штатной фильтрации.

## Непокрытые жизненные циклы

На 27 октября сквозная JSONL-трасса связывает создание durable job, распознавание
словаря и подготовку prompt, сетевой dispatch/response, HTML/static gate,
Chromium launch, каждый достигнутый viewport, Canvas evidence, repair decision,
повторную проверку, SQLite save, экспорт и события UI открытия/панелей/ошибок.
`jobId` связывает generation → version → export/UI, если эти операции относятся к
сохранённой версии.

Отдельного общего operation ID и JSONL timeline пока нет для старта процесса,
загрузки конфигурации, готовности SQLite/API, install/update/recovery и некоторых
launcher lifecycle событий. Для установщика и launcher есть отдельные короткие
коды, но не тот же trace schema. UI trace принимает allowlist сведений; он не
видит произвольную ошибку внутри opaque iframe, если iframe сам не послал
поддерживаемое событие. Не логируются каждый кадр и `pointermove`. Эти пробелы
оставлены без нового параллельного логгера; их закрытие требует отдельной
операционной схемы, тестов и согласования с продолжающейся работой UI/UX.

### UI editor state (YAPLIX-GAMEPLAY-RECOVERY-004)

`ui.editor_state` содержит только выбранность версии, provider mode/configuration
и readiness marker, busy/active-edit, instructionReady и стабильный reasonCode.
Текст инструкции и значения по каждому вводу не записываются. `ui.api_error`
сохраняет стабильный API reason code. См. локальный отчёт
`.local/yaplix-gameplay-recovery-004/REPORT.md`.

## YAPLIX-FINAL-002: browser phases and validator routing (28 октября 2026)

Trace теперь сохраняет длительность старта документа, handshake, Canvas render,
input и restart. `browser.phase.completed` со статусом `SKIPPED` обязан включать
безопасный `reasonCode`; `browser.validator_routed` фиксирует выбор полного HTML
checker, а Canvas sample сообщает только размеры и числовые признаки. HTML,
prompt и значения игровых подписей в эти события не входят.

Canvas marker без подтверждённого YAPLIX event bridge больше не равен готовому
handshake: после ограниченного ожидания trace указывает
`YAPLIX_BRIDGE_NOT_OBSERVED / NO_GAME_READY_EVENT`, затем строгий Full HTML
checker выполняет обычную проверку. Это не повышает `NOT_VERIFIED` gameplay до
PASS. Offline replay и измерения по трём реальным checkpoint приведены в
`.local/yaplix-final-002/REPORT.md`.
