# MICRO-028.3 — Safe T2 Recorder

## Stage A: audit before implementation (2026-10-17)

Inspected the original `research/micro028-t1/manual.mjs` at 9d3c392, its README,
MICRO-028.2 report, browser tests, runtime sandbox/CSP and private manual plan.

- No explicit native keyboard/pointer/touch journal. Playwright trace records
  Playwright API operations and optional snapshots, not a replayable stream of
  the owner's native gameplay input. A screenshot is only one observation.
- Launch/newContext happen before the try/finally; failures can leave no record.
  Trace stop is success-only. Timeout closes browser concurrently with questions.
  A failed screenshot loses the current answer. Abrupt termination loses all
  in-memory answers; the record is written only in finally.
- SHA checks decoded text, not original bytes; provenance is copied from the plan
  without rechecking the original checkpoint/database. No final hash check.
- Original HTML is opened top-level via file URL. Offline mode and request routing
  do not reproduce the opaque origin, iframe sandbox, prepended GAME_CSP, blocked
  forms/popups/downloads/top navigation or Permissions Policy of the game host.
  Native file execution safety is not established.
- Human-entered VERIFIED is stored as an aspect status without evidence review.
  There is no independent EVIDENCE_REVIEWED gate or structured pending list.
- Session timestamp directories exist, but no UUID, durable progress checkpoints,
  explicit partial-log marker, trace absence reason or terminal failure category.

Root cause: success-oriented interactive script, with evidence durability and
input capture absent from its lifecycle. Scope: research recorder/tests and docs;
production runtime is read only. No new inference or repair requests are allowed.

## Result and boundaries

**MICRO-028.3 — Engineering PASS.** Gameplay PASS не присваивается. Две реальные
игры остаются HUMAN_ACCEPTANCE_PENDING, новых человеческих прохождений 0/2.
Дата: 2026-10-17, Europe/Moscow. Новых внешних LLM inference/repair POST: **0**.
Изменения только research recorder/tests и документации относительно 9d3c392.
Production-код, генератор, validator, CSP, prompts, SQLite и оригиналы не менялись.
Исторический MICRO-028.2 NO_GO сохранён. Весь PR #34 содержит и более ранние
production-изменения MICRO-028; это не новые изменения данного этапа.

## FACT: запись, изоляция и сохранность

- `manual.mjs` использует небольшой research-only `recorder.mjs`, существующие
  Node runner, playwright-core, установленный Chromium. Новых зависимостей нет.
- Наблюдатель в isolated world реального iframe установлен до owner input.
  Он не доступен игровому JS, не вызывает preventDefault/stopPropagation, не
  меняет RNG, таймеры, игровые переменные или обработчики. Начальная загрузка
  до установки наблюдателя не считается записанным пользовательским вводом.
- Trusted keydown/keyup: стрелки, WASD, Space/Enter/Escape/R; физический code,
  без символов key, Ctrl/Alt/Meta комбинаций и полей ввода. Pointer/touch:
  down/up/cancel, координаты внутри viewport, pointer type/id; held moves <=20/s.
  Есть phase, document index, viewport и относительное время получения события.
  Не наблюдаются terminal/другие окна, clipboard, пароли или произвольный текст.
- Журнал ограничен 12,000 entries / 2 MiB; сессия 15 минут, trace <=32 MiB.
  Лимиты, обработанные ошибки, navigation и обнаруженные input gaps отмечаются
  EVENT_LOG_INCOMPLETE. Дискретизация pointermove объявлена, не lossless replay.
- UUID + отдельная директория; actions.jsonl append+fsync каждого события;
  human-record.json через fsync temporary file + atomic rename после каждого
  ответа/фазы. Ответ сохраняется до screenshot. Частичный final screenshot —
  best effort; trace корректно закрывается при возможности, иначе есть причина.
- Manifest изначально RUNNING_EVENT_LOG_INCOMPLETE. При force-kill остаются
  durable checkpoint и prefix журнала, но trace не объявляется готовым. Последняя
  строка журнала при аварии может быть оборвана; eventCount manifest может отстать.
  Невозможно обещать сохранение ещё не полученных событий или при отказе диска.
- Screenshot маскирует input/textarea/select/contenteditable. Playwright trace
  без DOM snapshots/автоматических screenshots; native human ввод не является
  Playwright API action. Trace не служит replay-журналом. Параметры Playwright
  typing API могут содержать текст, поэтому recorder их не использует для владельца.
  Synthetic privacy test вводит sentinel через native-style CDP и проверяет ZIP.
- Каждый Start/Input/Progress/Win/Loss/Restart/Repeat/Export имеет отдельный
  результат. Ответ владельца — HUMAN_REPORTED, отсутствующий/UNKNOWN —
  NOT_VERIFIED; RECORDER_ERROR отделён от gameplay. EVIDENCE_REVIEWED возможно
  только после отдельного сопоставления артефактов. Автоматического повышения нет.

## FACT: source, sandbox, export и replay

SHA-256 считается по исходным bytes; проверяется перед запуском и при завершении.
Сохранённый corpus сравнивается с оригиналом и metadata.originalCheckpoint либо
точной version/game SQLite. SQLite открывается `mode=ro&immutable=1`, pending WAL
вызывает отказ; recorder не выполняет checkpoint или другие записи в исходную БД.
Данные plan/provenance сами по себе не являются новым фактом прохождения.

Действуют offline context, blocked service workers/downloads, disposable profile,
secret-free launch environment, Chromium OS sandbox, `sandbox=allow-scripts`,
Permissions Policy и исходный GAME_CSP до любого игрового script. Никакого
серверного listener или внешнего HTTP для игры: только два route-fulfilled URL,
остальные запросы блокируются. Проверены запрет parent DOM/storage, обычный
inline eval и fetch, недоступность recorder binding в игровом JS и отбрасывание
forged/untrusted keyboard. Production runtime import используется только для
совместимого CSP/UUID prelude.

Экспорт `export.html` byte-exact; копия перечитывается и открывается в новом
opaque offline iframe. Проверены startup/input/rendering безопасного эталона
после такого открытия. Это **не** нативный file запуск. Прямой original file URL
удалён: там терялись origin/sandbox, host CSP и Permissions Policy; offline routing
не заменяет эти ограничения. **NATIVE_FILE_EXPORT_NOT_VERIFIED** сохраняется.

Ограниченный replay API проверен на записанных native mouse/keyboard эталона:
совпал отдельно проверенный видимый score. Intentional mismatch возвращает
REPLAY_NOT_REPRODUCED. Вся запись валидируется до первого действия; incomplete,
touch/pen/key repeat, input gaps, multiple documents и недопустимые события дают
REPLAY_UNSUPPORTED. Native RNG/timing, sampled movement и реальная механика
не гарантируют повтор. Реальные игры не replay-ились. Действия не редактируются
ради PASS и внутреннее состояние игры не читается/не присваивается для replay.

## Stage E: два сценария для владельца

Фактические ID прочитаны из private manual-plan.json и provenance перепроверен.

| Игра | ID | SHA-256 | Источник и новый статус |
| --- | --- | --- | --- |
| A: MICRO-027 «Собери 3 яблока» | manual-02 | aafce7e3572e0c2db77853aa40928e736f6940c2a895c07961b9426d76f14e5d | exact acceptance.sqlite version/game; llm_code, ollama.com/gemma4:31b; HUMAN_ACCEPTANCE_PENDING |
| B: «Доброта для всех» | manual-01 | 8db53bfbfb6681cf82c3ac2582d4319c3888feaf3fedfa4c88216b5c50d5beac | original HTML и metadata.originalCheckpoint; ollama.com/gemma4:31b; HUMAN_ACCEPTANCE_PENDING |

**A:** прочитать правила, нажать «Начать игру», проверить стрелки клавиатуры и
экранные стрелки, движение и сбор яблока. Собрать три яблока с видимым счётчиком,
затем в новой партии отдельно столкнуться с камнем. Проверить «Играть снова» /
«Попробовать снова», сброс мира/счёта и новое действие. Повторить путь в Repeat.
В Export повторить Start/управление/прогресс в sandbox-копии и описать отдельно.
Исторические MICRO-027 evidence — только справка, не новое прохождение.

**B:** нажать «Начать путь добра», проверить WASD/стрелки и pointer/touch движение,
сбор сердечка и передачу грустному жителю. Зафиксировать реально достигнутый счёт
и видимые изменения; попытаться помочь всем пяти, описать дальнейшее состояние.
Известный source defect: пять одноразовых жителей против winCondition 20.
Не чинить исходник. Ограниченная игра сама по себе не доказывает недостижимость
победы; recorder не выводит такой диагноз. Для недостигнутой победы и отсутствующих
loss/restart controls оставить UNKNOWN с наблюдением и бюджетом. Repeat/Export
имеют тот же стандарт доказательств. Нельзя подставлять исторический результат.

Запускать по одной команде из PowerShell; переход в D:\YAPLIX включён:

```powershell
Set-Location -LiteralPath 'D:\YAPLIX'; node .\research\micro028-t1\manual.mjs manual-02
Set-Location -LiteralPath 'D:\YAPLIX'; node .\research\micro028-t1\manual.mjs manual-01
```

Играть в окне Chromium, вводить ответы в terminal. Перед ответом смотреть текущую
фазу; пустой ответ оставляет её непроверенной. Ctrl+C сохраняет partial evidence.
Результаты: `.local/micro028-t1/human/manual-02/<timestamp-UUID>/` и
`human/manual-01/<timestamp-UUID>/`: human-record.json, actions.jsonl, phase PNG,
export.html и browser.zip при успешной финализации. Не публиковать эти private
артефакты. План остаётся неизменным; статусы human records проверяются отдельно.

## TESTS

| Проверка | Результат |
| --- | --- |
| Recorder focused Node/Chromium suite | PASS 8/8: видимый запуск, trusted keyboard/mouse/touch, bounded moves, поля/forgery, viewport 320/360/390/430/tablet/desktop/rotation, screenshot и privacy trace, byte-exact sandbox export, ограниченный replay/mismatch, input gaps/reload, timeout/interrupt/window close/renderer crash/exception, readline EOF, hash/recheck/budget, force-kill prefix, real provenance без gameplay |
| Existing units + frozen research units | PASS 256/256 (248 + 8), sequential |
| Typecheck / production build | PASS / PASS |
| Existing short Playwright smoke | PASS 5: opaque runtime/CSP на chromium-390; Russian Start/Full HTML exception/checker IO на desktop. Два непрофильных сценария исходно SKIP |
| Repository Python tests / CI policy | PASS 19/19 / 8/8 |
| Repository text/link checker, diff check | PASS после исправления CRLF recorder |
| Gitleaks history + reviewed publication manifest | PASS; private evidence excluded |
| External LLM inference/repair POST | 0 |
| Hosted Windows/Ubuntu/secret-scan | NOT RUN: owner MICRO-019 Actions disabled, настройки не менялись |
| Heavy browser matrices, real gameplay, native file export, physical devices | NOT VERIFIED / не запускались по scope |

В managed shell Chromium GPU завершался access-denied до gameplay. Повтор того
же synthetic suite вне ограничения хоста прошёл с `chromiumSandbox:true`;
никакие browser sandbox/CSP флаги не отключались. Первые неудачные engineering
попытки сохранены отдельно от итогового synthetic прогона, не являются owner data.

## GIT / MAIN / MERGED / RUN / VERIFIED / MVP / LIVE / DOCS / NEXT

- MAIN: local main и origin/main `70fff011a8f01598863010366b3503fbd9d63396`.
  Current branch pull --ff-only: already up to date, origin/main ancestor HEAD.
- Branch: `test/micro-028-validator-calibration`; исходный HEAD `9d3c392`.
  Reviewed commit SHA доступен в git log и итоговом ответе.
- Draft PR [#34](https://github.com/Sashido01/YAPLIX/pull/34) остаётся Draft.
  MERGED: **нет, запрещён владельцем**. PR #35/ветка/visual-library не тронуты.
- RUN/VERIFIED: только перечисленная инженерная synthetic/read-only проверка;
  original HTML, private plan, SQLite, .env и untracked PDF сохранены.
- MVP/LIVE: уровень доказательств не повышен; новые реальные вызовы/прохождения 0.
- DOCS: этот отчёт, README recorder, ссылка из исторического spike, known-errors.
- NEXT: после двух owner sessions сопоставить журнал, screenshots и ответы по
  каждому аспекту; только затем оформить подтверждённые игровые дефекты отдельной
  инженерной задачей. Не продолжать универсальный validator или генератор здесь.
