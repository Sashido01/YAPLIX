# YAPLIX-RELEASE-007F — 28 октября 2026

## Текущий контрольный статус

**NOT_READY; публикации нет.** Исправлено нестабильное холодное открытие игры:
opaque iframe теперь получает `srcdoc` на следующем animation frame после
вставки в разложенный host. Парный probe дал 19/20 открытий старым порядком и
20/20 новым; после изменения новая LIVE-версия открылась 20/20 раз. Старт,
пауза, продолжение, перезапуск, клавиатурное движение и автономный экспорт
подтверждены. Победа/15-секундное прохождение настоящей игры не подтверждены:
управляемые попытки закончились `LOSE` на 2,6–8,27 с. LIVE create использовал 2
POST (один repair), пользовательский edit — 1 POST без repair; обе версии
сохранены, edit является продолжением той же игры.

`check:quick` PASS (финальный повтор 10,0 с), `check:integration` PASS (28,1 с),
unit suite 576/576, Python repository tests 20/20 и doc-link check PASS. Финальный
`check:full` завершился `634 PASS / 3 FAIL / 2,207 SKIP`; все WebGL/WebGL2 cases
прошли. Три ошибки были одной WebKit offline-export test assertion, которая
захватила POST предыдущей `/host` страницы до `file://`. Трасса подтвердила
неверную атрибуцию, исправлено условие по frame URL; адресный повтор прошёл 5/5
на Chromium и WebKit. Весь suite после test-only правки не повторялся, поэтому
формальный `FULL=PARTIAL`. Gitleaks 8.30.1 подтвердил текущий candidate tree,
staged candidate diff и четыре local ahead-коммита без утечек; PR diff отсутствует.
Ubuntu Lite installer собран и прошёл actual isolated install/launch/restart smoke.
Windows native package, hosted CI, Telegram native client и физические устройства
— `NOT_VERIFIED`.

Точный ход работ, IDs, SHA и границы proof: [RELEASE-007F report](../.local/yaplix-release-007f/REPORT.md).

# YAPLIX-FINAL-005 — 28 октября 2026

## Исторический статус этапа FINAL-005; актуальное состояние см. выше

**NOT_READY; публикация и merge не выполнены.** RELEASE-007 продолжает удаление
продуктовых DEMO и перенос синтетических HTML в test-only fixtures. Текущие
результаты и ограничения ведутся в
[отчёте RELEASE-007](../.local/yaplix-release-007/REPORT.md). Исторические
снимки ниже описывают состояние на дату соответствующего этапа и не являются
актуальными инструкциями или доказательством текущего release gate.

## YAPLIX-RELEASE-006 — 28 октября 2026

**Статус: PARTIAL / NOT_READY; публикацию не выполнять.** Root cause прежней
ошибки FINAL-005 скорректирован: `localStorage SecurityError` создавал
Playwright context init script, применённый и к opaque game iframe. Точная
сохранённая версия без него открылась в actual player; checker был технически
PASS, но game mechanics в нём остались `NOT_VERIFIED`. Устранён подтверждённый UI
дефект возврата из Library к видимому player; diagnostics/backup раскрыты из
Library. Chromium MVP scenarios — 3/3; полный выбранный mobile spec в Chromium desktop — 5/5.
Мобильный UI subset первоначально
имел 2 PASS и 1 FAIL из-за неучтённого UI preflight в synthetic delayed-POST
fixture; после общей fixture правки весь mobile spec прошёл 5/5. Полный browser
matrix не повторялся, а прежние **158 FAIL** остаются открытым релизным gate.

Сохранённая LIVE версия FINAL-005 прошла exact version checker, библиотеку,
перезапуск изолированного backend и export SHA match; synthetic UI gameplay
наблюдал Start/score/growth/direction/collision/restart, но RNG был
детерминирован тестом. В landscape 844×390 поле мало (4 колонки), результат
ограничен. Новые LIVE POST, Gitleaks, doc-link/release FULL, hosted Windows/
Ubuntu CI, физические устройства, PR и merge не выполнялись. Локальные link
targets восьми синхронизированных документов существуют; fragment anchors и
полный docs audit не проверялись. Подробности —
[локальный отчёт](../.local/yaplix-release-006/REPORT.md). Причина блокировки
публикации: browser gate остаётся 158 FAIL, а актуальные Windows/Ubuntu/secret
scan checks на точном кандидате отсутствуют.

**Статус: PARTIAL / NOT_READY.** В обычном UI выполнен Ollama Cloud edit, затем
LIVE repair job. Трасса job `fb42b696-9938-4a14-bd89-641f6f38f692` показывает
3 POST к `gemma4:31b`: два подтверждённых отказа из-за перекрытия Canvas UI и
финальный технический PASS; версия `15dcddd9-5c3a-4f97-94ad-423970a0cddc`
сохранена. Одна игра с её историей версий и SQLite `quick_check` сохранены.
Экспорт обычной кнопкой UI побайтно совпал с записью версии; SHA-256
`3974420198129cae64e617d3ea7ff44cb45f9330e0ceeef7061374475b632f84`.

Полный игровой PASS отсутствует: при открытии сохранённой версии в UI браузер
сообщил `SecurityError` доступа к `localStorage` из opaque sandboxed iframe.
Прямой литерал в экспортированном HTML не найден, поэтому точный источник
вызова остаётся неустановленным. Механика конечной LIVE-версии, завершение партии,
restart и landscape rotate не подтверждены; экспорт не проверен после перезапуска
приложения. Повторные LIVE inference/repair исчерпали разрешённый бюджет этого
этапа. `npm test` после снятия proxy только для процесса: 573/573 PASS. Полный
`test:browser`: 479 PASS / 158 FAIL / 2,207 SKIP, включая mobile UI, export/backup,
Arena и synthetic production checks. Gitleaks/doc links не запускались; hosted CI
недоступен по текущей owner rule. Публикации не было. Подробности и локальные защищённые артефакты: [FINAL-005 report](../.local/yaplix-final-005/REPORT.md).

# Текущий статус локальной копии

## YAPLIX-FINAL-002 — 28 октября 2026

**Статус: PARTIAL / NOT_READY.** Canvas sampler, нижние Start probes, bridge
fallback и фаза таймаутов исправлены; три исходных LIVE checkpoint прошли новый
offline technical replay. Неизменённый repaired checkpoint отдельно подтвердил
start, touch direction, score/food/growth, collision, game over и restart на
320×700, 390×700 и 844×390 в headless Chromium. Физические устройства не
проверялись.

Новая LIVE-генерация и пользовательский edit не запускались: 7/12 ранее
разрешённых POST уже израсходованы; все существующие контрольные jobs достигли
`JOB_DURATION_LIMIT`. Продолжение с checkpoint в копии SQLite было безопасно
отклонено, так как исходный durable deadline уже истёк. Поэтому новый save,
restart/export для нового результата и Create/Edit PASS отсутствуют.

`npm test`: сборка прошла, 557/569 тестов прошли, 12 упали. Playwright
`jobs.spec.ts --project=chromium-390`: 6 passed, 5 failed, 1 skipped. Отдельные
Canvas regression (3/3), synthetic engine/jobs/trace (44/44), launcher (4/4) и
create/edit/history/export test (1/1) прошли. Gitleaks 8.30.1 с проверенным
официальным checksum обнаружил 0 секретов в 107 исходниках кандидатного diff;
общий scan выявил 3 срабатывания в уже существующем игнорируемом `.env` (значения
не выводились и файл не изменялся). Не выполнялись commit, fetch/push, PR, merge
или Actions; удалённый `main` в этом этапе не проверялся.

Полная карта причин, hashes, test results и proof boundaries: локальный
`.local/yaplix-final-002/REPORT.md`.

## YAPLIX-FINAL-001 — 28 октября 2026

**Статус: PARTIAL; release не готов.** Причина прежнего `repairCount=0` найдена:
Canvas checker сохранял подтверждение в `canvasTextLayout`, а repair eligibility
искал поля на верхнем уровне. Парсер теперь принимает только фактическую
структуру подтверждённых evidence; после restart полный checkpoint был
перепроверен и отправлен в same-model repair внутри сохранённого лимита.

LIVE: три генерации и один repair POST на Ollama Cloud `gemma4:31b`. Реальные
результаты завершились `BROWSER_CANVAS_RENDER_UNVERIFIED`,
`BROWSER_CANVAS_ACTIVITY_UNVERIFIED` и `BROWSER_TIMEOUT_RENDER`; исправленная
версия не прошла весь обязательный gate и не сохранена. Поэтому Technical PASS,
Gameplay PASS, пользовательский edit, export/offline acceptance и готовность к
публикации не подтверждены. Целевые engine/jobs tests и typecheck прошли; полный
unit suite прерван после timeout launcher harness и нескольких устаревших или
несвязанных проверок. Gitleaks Linux executable недоступен; secret scan и remote
publication не выполнялись. Доказательства — локальный
[FINAL-001 report](../.local/yaplix-final-001/REPORT.md).

## YAPLIX-GENERATION-RECOVERY-002 — 28 октября 2026

**Generation recovery: PARTIAL.** Четыре metadata traces найдены; оригинальные
HTML/replay и связь browser tab с backend остаются `NOT_VERIFIED`: API вернул 401,
вкладка недоступна, а отдельного разрешения на read-only пользовательские
SQLite/checkpoints нет. Текущий checkout исправляет ChatGPT trace gap и проходит
47 targeted tests плюс typecheck; исторический POST count это не восстанавливает.
Новые inference/repair, browser spec и full CI не запускались. См. локальный
[Recovery-002 report](../.local/yaplix-generation-recovery-002/REPORT.md).

## Обновление YAPLIX-GENERATION-RECOVERY-001 — 28 октября 2026

**Generation recovery: PARTIAL.** Исправлен один подтверждённый пробел общего
Canvas tap search; offline Chromium-контроль с центральной Start проходит, inert
Canvas по-прежнему отклоняется. Реальные случаи разных провайдеров имели
различные исходы, поэтому общий сбой всех моделей не подтверждён. LIVE после
изменения не запускался. Текущий checkout dirty; runtime на `:3000` сообщает
commit, отсутствующий в локальной Git-истории, API jobs закрыт авторизацией, а
владелец процесса/подключённая UI-вкладка не установлены. Полный recovery и
release остаются `NOT_READY`; подробности — в локальном отчёте.

Снимок аудита: **27 октября 2026**, ветка `codex/arena-mvp`, исходный HEAD до аудита
`e074974629c2c871589ec560e8e0d463ac456358`. После аудита отдельный локальный commit
`23b91bb` обновил только `CONTRIBUTING.md`; дальнейшие doc/code изменения остаются
незакоммиченными. На момент аудита рабочее дерево имело
незакоммиченный локальный коммит поверх upstream и много изменённых/новых файлов;
полный manifest сохранён только локально в
`.local/yaplix-docs-local-git-001/initial-manifest.txt`.

## Подтверждённые свойства и границы

- Strict Canvas/WebGL v2 требует видимый игровой UI внутри Canvas/WebGL; защищённый
  Chromium проверяет static/runtime/render/layout/activity gates. Canvas text
  clipping и подтверждённое пересечение отдельных Canvas text draws имеют разные
  evidence и error codes. Смысл hitboxes и покрытие текста произвольной графикой
  остаются ограниченными/`NOT_VERIFIED`.
- Локальный Game Vocabulary описывает 25 архетипов, 22 жанра, 16 mechanic groups
  и 379 алиасов; 109/109 относится только к авторскому development корпусу,
  качество сгенерированных игр этим не доказывается.
- LIVE-001: новая Ollama `gemma4:31b` игра прошла блокирующие gates и была
  сохранена/экспортирована; итог PARTIAL из-за неполной проверки mobile/standalone.
- LIVE-002: новая игра прошла автоматические gates, gameplay, save/restart/export;
  последующий осмотр обнаружил перекрытие HUD на мобильном viewport. Итог
  PARTIAL, self-repair LIVE NOT_VERIFIED.
- Реальный успешный model repair POST в текущих зафиксированных live reports не
  подтверждён. Успех synthetic repair tests не является LIVE доказательством.
- YAPLIX-UI-SMOKE-002: старые мобильные тесты использовали удалённый
  `#jobs-toggle`, прежнюю кнопку `Обычный экран` и неподтверждённое ожидание
  analytics при блокировке busy-state. Тесты переведены на UI-002 workspace,
  детали текущего задания и реальные запросы; UI/API errors добавлены в
  существующий version trace. Результат текущего Chromium smoke и перечень
  оставшихся ограничений зафиксированы в `.local/yaplix-ui-smoke-002/REPORT.md`.
  Физические Android/iOS устройства и standalone `file:` запуск не подтверждены.
- Исторические LIVE отчёты и локальные тестовые отчёты не означают, что текущая
  грязная копия собрана или установлена как release candidate.

## Git и публикация

Рабочее дерево после этого аудита остаётся локальным. Разрешены локальные коммиты
только для явно просмотренных, завершённых и проверенных файлов. **До отдельного
прямого разрешения владельца запрещены все remote operations**, включая fetch,
pull, push, PR, merge, remote branch/tag mutations и запуск GitHub Actions. Не
переключайте ветку и не переписывайте историю для уборки незавершённой работы.

## Готовность

YAPLIX-OBSERVABILITY-GIT-001 добавляет metadata-only operation JSONL для
bootstrap/startup/desktop, installer transaction recovery/update/rollback и
maintenance backup verification, с корреляцией `operationId`/`jobId`. Целевой локальный smoke, проверки и
ограничения зафиксированы в `.local/yaplix-observability-git-001/REPORT.md`;
операционные traces и сборка в этой dirty copy не являются release proof.
YAPLIX-DESKTOP-LOCK-GIT-001 закрыл Desktop lifecycle: изолированный тест 6/6,
два профиля стартуют на разных портах; полный start/reuse/stop/restart проходит,
синтетическая сохранённая версия читается после restart, `PRAGMA integrity_check`
возвращает `ok`, а отдельный тест подтверждает сохранение чужого live lock.
Сквозной trace содержит ready/reuse/stop/restart и operation IDs.
Проблема startup была связана с разрывом launcher IPC после readiness; параллельный
портовый отказ — с расхождением внутреннего fallback-порта и сохранённого порта.
Текущие исходники не собирались в новый Full payload и реальная установка не
проверялась. Текущие изменения не закоммичены из-за смешанного dirty worktree;
детали и исключённые файлы перечислены в `.local/yaplix-desktop-lock-git-001/REPORT.md`.

**Release candidate: NOT_READY.** Причины: текущая копия dirty; новый LIVE-002
показал мобильное перекрытие, которое блокирует пользовательскую готовность;
реальный autonomous repair не подтверждён; физические устройства не закрыты;
повторный mobile browser smoke в текущем checkout FAIL; secret scan сделан только
ограниченной локальной проверкой, поскольку `gitleaks` отсутствует. Typecheck,
build, 50 целевых unit tests, Markdown-link check и whitespace checks прошли на
грязной рабочей копии с Node 24.22.1; это не полный release gate.

Исторические подробные результаты: `.local/yaplix-live-001/REPORT.md`,
`.local/yaplix-live-002/REPORT.md`, `.local/yaplix-game-vocabulary-002/REPORT.md`,
`.local/pipeline-trace-001/REPORT.md` и `.local/yaplix-canvas-overlap-001/REPORT.md`.
`.local` не является частью переносимой документации или Git.

**YAPLIX-GAMEPLAY-RECOVERY-004: NOT_READY.** Editor availability/636-character
edit input passed synthetic checks and the original saved version remained
unchanged. The sole authorized Ollama Cloud edit was rejected by protected
Chromium at 320×700 with confirmed Canvas text clipping before save; no repair or
second provider POST ran. Gameplay semantics, remaining viewports, export/offline
and real restart for the candidate are NOT_VERIFIED. See
`.local/yaplix-gameplay-recovery-004/REPORT.md`.
