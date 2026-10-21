> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# MICRO-018 — GitHub Actions CI Economy

Аудит 16 октября 2026. Работа локальная: push, PR, merge, удаление веток и новые
Actions runs в этой задаче запрещены владельцем и не выполнялись.

## FACT / исходное состояние

`main == origin/main == a90234307369692dcabec0a14a0b31919dec471d`, PR 23 merged.
`git pull --ff-only origin main`: Already up to date. Создана ветка
`codex/micro-018-ci-economy`. Исходное дерево чистое, кроме untracked
`docs/Keys_Bilayn.pdf`; PDF не изменяется и не входит в commit.
Продуктовый код, LLM routes, зависимости/lockfile и пользовательские данные
не изменяются. MICRO-019 не начиналась.

## BASELINE / наблюдения GitHub

Read-only `gh api actions/runs --paginate --slurp`: 78 runs за
2026-10-09 09:34:39Z — 2026-10-16 07:36:41Z, из них 71 `Repository checks`
(50 pull_request, 21 push), 7 dynamic Dependabot. Scheduled/manual runs в выборке
отсутствуют. Workflow до изменения: PR, push main, dispatch; concurrency уже был.

`actions/runs/{id}/jobs?filter=all&per_page=100`: получены 219 jobs для 74 runs,
включая прошлые attempts; total_count проверен, pagination jobs не требовалась.
Для 4 runs сетевой timeout остался после повторного чтения:
38392770795, 38298933215, 37914473761, 37912237254. Статистика ниже относится
**только к полученным jobs**, не ко всему аккаунту и не является billing export.
Raw responses/логи и скрипты расчёта сохранены в игнорируемых
`.local/micro018-{runs,jobs}.json`, `.local/micro018-api/`,
`.local/micro018-{summary,details,retries}.py`.

| Workflow / job | Jobs / attempts | ОС | Среднее wall time | Failure / cancel / повторные jobs | Оценка округлённых runner-min |
| --- | ---: | --- | ---: | --- | ---: |
| Repository checks / repository-checks (ubuntu-24.04) | 69 | Ubuntu | 406.7 s | 16 / 7 / 5 | 503 |
| Repository checks / repository-checks (windows-latest) | 69 | Windows | 695.7 s | 17 / 14 / 5 | 839 |
| Repository checks / secret-scan | 72 | Ubuntu | 8.9 s | 0 / 1 / 5 | 72 |
| Repository checks / ранний repository-checks без matrix | 3 | Ubuntu | 4.3 s | 0 / 0 / 0 | 3 |
| Dynamic Dependabot (6 доступных runs) | 6 | Ubuntu | 55.2 s | 0 / 0 / 0 | 7 |

Формула wall time: `completed_at - started_at`, без времени ожидания runner.
Средние включают failure/cancelled jobs. Формула оценки минут:
`sum(ceil(job_seconds / 60))`; фактическая сумма wall time всех jobs —
1284.15 min, округлённая оценка — 1424 min (1417 checks + 7 Dependabot).
По event: PR 978, push 439, dynamic 7 округлённых runner-min.
Это timestamps proxy: он не отражает billing discounts, free quotas,
освобождение Dependabot от оплаты, другие репозитории и весь billing cycle.

Четыре runs имеют run_attempt >1: три с attempt 2 и один с attempt 3,
то есть пять дополнительных attempts. В полученных данных 15 повторных jobs
заняли 145 округлённых runner-min (уже входят в итог, повторно не складывать).
В списке workflow conclusions 15 cancelled и 18 failure runs.

Самые дорогие steps по всем доступным attempts:

| Step | Ubuntu sum / avg | Windows sum / avg |
| --- | --- | --- |
| Browser suite (67 jobs/OS) | 331.9 min / 297.2 s | 456.6 min / 408.9 s |
| Browser install (67 jobs/OS) | 58.2 min / 52.1 s | 219.3 min / 196.4 s |
| Typecheck / integration (67 jobs/OS) | 39.9 min / 35.8 s | 41.2 min / 36.9 s |
| Performance (60 jobs/OS) | 17.9 min / 17.9 s | 20.4 min / 20.4 s |

Browser install + suite: 1066 min wall time, примерно 83% всей доступной
job runtime. В failed steps: browser 23, conventions/links 8, integration 2.

У одного SHA 654a19b73d3f12ba92c6e8b12a03203a2d3f48ed два разных PR runs;
push+PR одного SHA в выборке нет. Основной повтор — новый merge SHA после
успешного PR: полная матрица проверяет почти то же дерево снова. Это полезная
post-merge проверка, но в рамках экономии её заменяет обязательный локальный
smoke фактической main. Нет оснований обещать устранение всех reruns.

## CAUSE / тариф и остаток

Проверены официальные [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
и [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions):
GitHub Free включает 2000 min/month, partial job minutes округляются вверх;
текущие list rates стандартных x64 runners — Linux $0.006/min, Windows
$0.010/min. Старый Windows multiplier 2x не используется здесь как доказанный
коэффициент текущей квоты: актуальная документация перечисляет rates,
а доступного account billing readback для сверки нет. Отношение цен 1.667
не доказывает такой же коэффициент free-quota accounting.

Иллюстрация list-price proxy для checks, без квоты/скидок/storage:
`(503+72+3)*0.006 + 839*0.010 = $11.858`. Это **не списание и не счёт**.
Dynamic Dependabot вынесен отдельно: официальная документация указывает
бесплатное использование стандартных runners для Dependabot.

`users/Sashido01/settings/billing/usage?year=2026&month=10` вернул 404 и сообщение
о недостающем `user` scope. Scopes, plans, credits и budgets не менялись.
Исторические 1811/2000 и остаток 189 не подтверждены. Документация говорит
о месячном сбросе, но account-specific дата следующего сброса не прочитана.
Старый timing endpoint для run 38868311721 доступен, но вернул нулевые
`billable.total_ms` при workflow wall time 1260000 ms — эти нули не годятся
для вывода о расходе.

## CHANGED / выбор минимальных изменений

Сохранён один workflow и все три имени checks. Добавлена простая policy
без dependencies: docs -> FAST; unit tests -> units обеих ОС; все executable,
config, browser helpers, зависимости, unknown diff -> FULL. Отдельного
dispatcher/gate job и передачи build artifacts нет. Рискованные steps внутри
существующих jobs: их failure нельзя потерять через skipped dependent job.

Убран push main trigger, сохранён PR, добавлены merge_group и release; dispatch
всегда FULL. Перед release обязателен manual FULL на точном commit. PR-only
cancellation использует PR number и event, не отменяет manual/release runs.
Добавлен npm download cache по lockfile; browser cache не введён без доказанной
выгоды. FAST не устанавливает browsers; FULL сохраняет все engines/profiles.
Убраны два повторных build на ОС из цепочки test/browser/performance: теперь
один build и прямые команды. Timeouts и pinned actions сохранены/ограничены.
Полная [policy, команды и покрытие](../ci-economy.md).

## TESTED / локальные результаты

До изменений: typecheck 0.58 s, `npm test` (с build) 14.49 s,
149/149 PASS; Python 19/19 PASS; repository checker PASS.
После изменений: typecheck/build/all units 14.90 s, 149/149 PASS;
Windows FAST contracts 1.48 s, 20/20 PASS; policy 8/8 PASS;
actionlint 1.7.12 PASS. Это локальная Windows машина, с установленными npm
dependencies и браузерами; hosted setup/cache-hit/cache-miss не измерены.
Измерения выполнялись при работающем browser suite; небольшую разницу времени
не выдаём за измеренную экономию.

Policy tests проверяют docs-only, mixed source, неизвестные пути, более 1000
файлов, отсутствующий base, ошибки Git, deletion/rename в настоящем временном
локальном Git repo, manual/release/merge_group и явные FULL outputs CLI.
Actionlint валидирует YAML/expressions. Source review подтверждает отсутствие
workflow path skips, job-level skips, continue-on-error, retries и write token.
Реальный отказ required check/merge блокировки в GitHub не испытывался:
это потребовало бы отдельного Actions запуска и доступной server protection.

Первый FULL запуск в restricted tool sandbox остановлен после timeout при
создании страницы sandboxed Chromium; trace сохранился отдельно. Тот же
узкий checker вне tool sandbox прошёл (1/1, 4.2 s), sandbox Chromium оставлен
включённым. Полный browser suite: **234 PASS, 342 intentional skips, 0 FAIL**,
448.57 s (12 профилей). Оба теста с отказом на hosted main локально прошли;
их source/assertions/timeouts не менялись. Лог и trace output:
`.local/micro018-full-browser.log`, `.local/micro018-full-browser/`.
Это не Ubuntu/hosted/physical device PASS.

Performance smoke: PASS, 25.34 s; 7 cold mobile Slow 4G / CPU x4 runs,
interactive p75 639.8 ms, game start p75 961.2 ms, touch p75 5.8 ms,
API p75 3.18 ms. Gzip: JS 9661 B / CSS 2332 B / critical total 14631 B,
все исходные budgets соблюдены. LLM latency здесь не измеряется (key-free DEMO).
JSON: `.local/performance/micro018.json`; это локальные данные, не hosted timing.

Финальный Python: 19/19 PASS; repository conventions/links и staged whitespace
PASS. Gitleaks 8.24.3: staged diff и вся Git history (61 commits) — no leaks.
Локальные actionlint/Gitleaks archives сверены с сохранёнными checksums.
`npm ls --depth=0` подтверждает установленные exact versions lockfile.
Финальные SHA-256 `.env` и `docs/Keys_Bilayn.pdf` совпали с исходными.

## ECONOMY / расчёт, не новый hosted результат

Новые Actions runs: **0**. Измеренная hosted экономия: **не установлена**.
Доказано исключение конкретных операций из docs-only scope; их историческая
стоимость известна. Для последних 10 успешных PR jobs каждой ОС средний
округлённый total двух платформ + scan: `11.8+18.7+1 = 31.5 runner-min/run`.
Историческая средняя сумма browser install/helper/suite/performance, которую
новый docs-only scope не выполняет: `10.14+16.18 = 26.32 min/PR`.
Это проекция удалённых steps, не измеренный after.

Рабочая цель FAST после локального замера: <=3 min p75 на ОС и <=5 суммарных
runner-min на PR. Если она подтвердится, успешный merged docs PR вместо
примерно 63 min (PR + main FULL) потребует <=5 min, то есть около 92% меньше.
Source PR останется FULL; только устранение post-merge FULL даёт около 50%
в модели одинаковых PR/main длительностей. Cache savings в прогноз не включены.

Прогноз при прежних 50 PR runs + 21 push за условные 7 дней:
если все PR source/FULL — `(50*31.5)*30/7 = 6750 runner-min/month`;
если половина docs/FAST — `(25*31.5+25*5)*30/7 = 3910.7`;
старая та же модель — `(50+21)*31.5*30/7 = 9585`.
Это сценарии по частоте выборки, а не billing forecast аккаунта: состав PR,
cancel/fail/rerun, старый рост suite и точный elapsed interval меняют результат.
Даже экономный CI не гарантирует укладывание в 2000 минут при этой частоте.

## SECURITY / RISKS / VERDICT

GET branch main вернул `protected:false`, `protection.enabled:false`,
`required_status_checks.checks:[]`, `contexts:[]`, `enforcement_level:off`.
GET protection и rulesets: HTTP 403 Pro/Public. Никакие settings не менялись;
серверная защита **не была действующей по доступному readback**. Имена checks
сохранены для совместимости, но это не создаёт required checks автоматически.
Программно запретить merge красного рискованного PR одним workflow невозможно
при такой server configuration. Это отдельный внешний blocker, не повод
ослаблять проверки или автоматически менять тариф/видимость/permissions.

Текущий main run [38868311721](https://github.com/Sashido01/YAPLIX/actions/runs/38868311721):
Ubuntu 12m30s PASS, Windows 20m56s FAIL, secret-scan 8s PASS. Windows browser:
232 passed / 342 intentional skipped / 2 failed. Первый отказ — jobs background
offline сценарий: timeout 20 s на Start после reload. Второй — unresponsive
gameplay: ожидаемый `BROWSER_GAMEPLAY_TIMEOUT` получен, но total 24881 ms >
assertion 22000 ms. Точная причина и безопасное исправление не подтверждены;
production gameplay и timeouts в этой задаче не менялись, тесты остаются в FULL.
Сравнение: [успешный PR run](https://github.com/Sashido01/YAPLIX/actions/runs/38866137375)
и [предыдущий отказ](https://github.com/Sashido01/YAPLIX/actions/runs/38862850604).

**VERDICT: PARTIAL.** Локальная реализация подготовлена; production/hosted PASS
не заявляется. Нужны разрешённый push/PR и один FULL нового workflow (сам diff
CI выбирает FULL), затем фактический docs-only run при следующем обычном PR.
Отдельно нужно решение владельца по доступной серверной защите и readback billing
(например, вручную в Billing UI), без автоматической смены тарифа/scopes.
Новый запуск расходует Actions minutes; необходимость денежной оплаты
неизвестна без текущего остатка. MICRO-018 не даёт разрешения такой запуск делать.

## GIT / MAIN / MERGED / RUN / VERIFIED / MVP / LIVE / DOCS / NEXT

MAIN остаётся a902343; MERGED: MICRO-018 не merged; RUN: только локально;
VERIFIED: перечисленные проверки; MVP/LIVE: функциональность не менялась,
новых LLM calls и проверки физических устройств нет. DOCS: обновлены CI guide,
отчёт, known-errors, setup, README, CONTRIBUTING, AGENTS и PR template.
Локальный логический commit включает только явный manifest этих файлов и policy;
его SHA и итоговый Git status приводятся в сообщении передачи, чтобы не создавать
самоссылку на ещё не существующий commit. NEXT: отдельное разрешение на публикацию
и расход Actions; merge и удаление веток в MICRO-018 запрещены.
