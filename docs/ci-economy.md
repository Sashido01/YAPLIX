# Экономный CI (MICRO-018)

## Что выполняется

Один workflow `Repository checks` запускается на каждом `pull_request`,
на `merge_group`, вручную (`workflow_dispatch`) и при опубликованном release.
Нет `paths`/`paths-ignore`, расписания и повторного полного run на `push main`.
Перед релизом нужно вручную запустить FULL на точном release commit и дождаться
обоих checks и secret-scan; release event дополнительно проверяет опубликованный tag.
Публикация release сама по себе не заменяет предварительную проверку.

| Изменения | Ubuntu | Windows | Браузеры / performance |
| --- | --- | --- | --- |
| Только root `*.md` и `docs/**/*.md` | FAST: все unit/контракты | FAST: `platform.test.ts` + `engine.test.ts` | Не нужны |
| Только эти docs и `tests/*.test.ts` / `scripts/tests/test_*.py` | Все unit/контракты | Все unit/контракты | Не нужны |
| `src/**`, Canvas, генерация, backend, frontend, browser specs/helpers, scripts, зависимости, конфигурация, CI, неизвестный путь | Все unit/контракты | Все unit/контракты | FULL обеих ОС |
| Manual / release / merge queue / неизвестный event или diff | Все unit/контракты | Все unit/контракты | FULL обеих ОС |

Все режимы действительно выполняют Python checker и его тесты, тесты CI policy,
TypeScript typecheck, production build, `npm ci` и полную проверку секретов.
Отдельный lint в проекте не настроен. Windows FAST содержит реальные generator,
backend/SQLite, persistence и authorization contracts, а не пустой зелёный job.

FULL сохраняет весь существующий browser suite, все 12 профилей (320/360/390/430,
tablet, desktop, Chromium/WebKit/Firefox), offline export, sandbox/authorization,
generation checks и 7 cold mobile Slow 4G / CPU x4 повторов performance smoke.
Исходные intentional profile skips в Playwright не меняются. Эти проверки
синтетические: они не подтверждают реальный LLM inference или physical devices.

## Почему риск не теряется

`scripts/ci-policy.mjs` использует allowlist дешёвых изменений. Diff строится
локально между base SHA события PR и проверяемым merge SHA, без API pagination
и 300-file ограничения workflow path filters. Checkout получает историю целиком,
после чего удаляет Git credentials. Удаления и обе стороны rename учитываются.
Неполный/пустой diff, неизвестный SHA или ошибка Git включают FULL.
В условиях steps только явное `false` отключает дорогие проверки; отсутствующий
output выбирает FULL. Labels и ручной параметр для отключения FULL отсутствуют.

Стабильные checks сохранены:

- `repository-checks (ubuntu-24.04)`;
- `repository-checks (windows-latest)`;
- `secret-scan`.

Jobs не пропускаются целиком. Дополнительные тесты находятся внутри тех же jobs:
ошибка обязательного или выбранного расширенного step делает соответствующий
check красным. Нет `continue-on-error`, retries или зависимого skipped-job gate.
Typecheck и build разнесены на отдельные steps, чтобы последняя команда не могла
скрыть неуспешную предыдущую на PowerShell. Каждый PR проверяет свой merge SHA;
новый commit отменяет устаревший PR run, но не manual/release/merge queue.

**Состояние сервера 16 октября 2026:** GET branch main вернул `protected:false`,
`protection.enabled:false`, `enforcement_level:off`, `checks:[]`, `contexts:[]`.
Protection/rulesets endpoints вернули 403 с требованием Pro/Public.
Настройки не изменены. Checks выявляют отказ, но текущая серверная защита
не запрещает merge красного PR. Обязательное ожидание checks остаётся правилом
команды. Для технического запрета merge нужна отдельная разрешённая настройка
доступной серверной защиты; workflow не способен заменить её.
См. [границы защиты](github-ruleset.md).

## Локальная проверка

Из корня клона Windows/Ubuntu (на Ubuntu `python3`):

```sh
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
node --test scripts/ci-policy.test.mjs
npm ci
npm run typecheck
npm run build
node --test tests/*.test.ts
node --test tests/platform.test.ts tests/engine.test.ts
```

Для FULL дополнительно:

```sh
node scripts/browser-tests.mjs install --with-deps chromium webkit firefox
node scripts/browser-tests.mjs test
node scripts/browser-tests.mjs performance
```

На Ubuntu нужен проверенный sandbox helper по [setup](development-setup.md).
Проверку YAML делает `actionlint .github/workflows/repository-checks.yml`.
Для read-only диагностики policy можно передать стандартные `GITHUB_EVENT_NAME`,
`GITHUB_EVENT_PATH`, `GITHUB_SHA`: CLI печатает только выбранный режим, без ключей
и произвольных имён файлов. Тесты policy проверяют docs, mixed/unknown diffs,
1000+ файлов, потерянный base, rename/deletion, manual, release и merge queue.

## Где экономия

`setup-node` кэширует npm download cache по `package-lock.json`; `npm ci` остаётся
на каждой ОС. `node_modules`, browser binaries и build artifacts не переносятся
между ОС. Для FAST браузеры и системные зависимости вообще не устанавливаются.
FULL использует все три browser engines, потому что suite действительно их
проверяет; произвольное сокращение профилей здесь лишило бы покрытия.
Кэш браузеров и передача build между jobs не введены без замера выгоды.

Build выполняется один раз на ОС: прямые Node/Playwright команды обходят
`pretest` и повторный build в `test:browser` / `performance:smoke`. Public npm
scripts для разработчика сохранены. Общий timeout FULL остаётся 30 min,
browser install ограничен 8 min, suite 20 min, performance 3 min.
Failure diagnostics сохраняются 3 дня. Actions pinned по SHA, token read-only,
`pull_request_target` и внешние платные runners не используются.

FAST: начальный ориентир hosted p75 <=3 min на ОС, полный набор checks <=5
runner-min/PR суммарно. Это цель после локального замера, а не hosted результат.
Фактический baseline, расчёты и непроверенные границы:
[отчёт MICRO-018](micro-018-report.md).
