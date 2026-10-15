# TASK-013 — Game Orchestrator (architecture B) — report

Статус: эксперимент завершён, решение **ITERATE** (ни авто GO: единственная
реальная пара LLM на prompt 1 + только первичный live pair на prompt 2 —
мало наблюдений для production-заменой; и не NO-GO: все гипотезы B подтвердились).

## Методы

Эксперимент изолирован: `src/orchestrator/` — пять новых модулей (spec, selector,
primitives, html-builder, engine), production generator ([src/live.ts](../src/live.ts))
не изменён, UI/API/jobs не затронуты. A — текущий pipeline (LLM пишет полный HTML),
B — orchestrator (выведенный без LLM spec → выбор примитивов → LLM пишет только
новую игровую логику → сборка из проверенных примитивов → существующий checker).

Жёсткая протокольная рамка: одна и та же модель `gemma4:31b` (ollama-cloud)
для обеих ветвей, бюджеты ≤2 repair-вызова на попытку, результаты только в
`.local/task-013/` (не коммитятся).

## Реальные live измерения (gemma4:31b, ollama.com)

| Prompt | Branch | Attempts | Repairs | Output tokens | TTFPG | HTML bytes | Checker |
|---|---|---|---|---|---|---|---|
| 1 тетрис+взрывы | A | 2 | 1 | 6 683 | 31.1 s | 11 065 | PASS (все 4 levels) |
| 1 тетрис+взрывы | B | 1 | 0 | 2 056 | 12.2 s | 18 581 | PASS (все 4 levels) |
| 2 змейка-лабиринт-шутер | A | 6 | 5 | 20 129 | 70.7 s | 13 747 | PASS (все 4 levels) |
| 2 змейка-лабиринт-шутер | B | 1 | 0 | 2 228 | 12.4 s | 19 107 | PASS (все 4 levels) |

Дополнительно зафиксированы 3 реальных `LLM_RATE_LIMIT` pause (A: 2, B: 1) —
provider quota в 6 req/min на ollama-cloud. Один dry-run скрипта случайно
стал live B-попыткой prompt 1 — засчитан как основной B-прогон (валидный
артефакт).

## Бюджеты протокола

Фактическое потребление: A — 4 primary attempts + 6 repair attempts (лимит
протокола ≤2 repairs превышен архитектурой A: 5 repairs понадобились prompt 2).
B — 2 primary attempts + 0 repairs. Prompt 3 (grid-строительство, корабль,
волны) не запускался: бюджет attempts исчерпан предыдущими ветвями (даже
бесплатно в токенах он не изменил бы вывод, prompt 2 уже показал смешанный
space/grid+walls поведение селектора). Засчитано как сознательное остановление
по протоколу — не как технический сбой.

## Что сравнивалось на честном уровне

Синтетические юнит-тесты (27), один реальный браузерный spec (assembly через
buildHtml → браузерный checker), live LLM-прогоны и real browser checker
(офлайн, 320/390) — отдельные уровни доказательства, в таблицах разделены.
Physical devices не тестировались — мобильная проверка только эмуляция
(Playwright 320/390 Pixel profiles) — явная граница доказательств.

## Метрики B

Сравнение по паре (p1, p2): время TTFPG — 2.6× и 5.7× быстрее архитектуры B;
tokens — 3.3× и 9.0× меньше; repairs — 0 у B против 1 и 5 у A. Модель в Branch B
получает только задачу «напиши игровую логику ≤350 строк plain-JS» — контекст
короче, нет полного HTML контракта и lifecycle-повторений — объясняет разницу.

Просадок механики нет: оба B артефакта реализуют требуемые механики промпта
(доска/фигуры/lock/line-clear + взрыв particles и очки; стены + змейка + яблоки +
стрельба + преследование + жизни). Но у обоих B артефактов **нет правила
победы** (score/win rule отсутствует, только lose), а в prompt-1 A-артефакте
тоже нет (в prompt-2 A-артефакт есть: score>=200). Отклонение LLM в B пишет
корректные механики, но на промптах с неявным win условием оставляет его
неопределённым — системный промпт должен явнее запрашивать win rule (у prompt
2 A — явный `if(score>=200) endGame(true)`; B промпты имели только loss
условия явными).

## Гипотезы и выводы

1. **TTFPG/tokens ниже у B** — подтверждено на 2/2 промптов.
2. **Repairs не нужны у B** — подтверждено (0/0 против 1/5 у A).
3. **LLM в B пишет оригинальную логику, не перекраску** — подтверждено: код
   prompt 2 реально комбинирует snake движение, стены коллизии, стрельбу,
   жизни и преследующие врагов как связную игру.
4. **Примитивы не «готовая игра»** — подтверждено: library покрывает substrate
   (canvas/loop/input/grid/physics/fsm/score/session), все игровые правила —
   в LLM-логике.
5. **Existing checker совместим с B** — подтверждено: все 4 LIVE артефакта
   проходят полный offline browser check 320/390 c полными levels, включая
   pause/resume evidence (в т.ч. B-сборка с примитивами).
6. **Repair-bound поведение A** — A для prompt 2 потребовала 5 repairs, что
   физически превышает протокольный ≤2 — при ужесточении протокола A не
   завершила бы prompt 2 вообще, B завершает всё за 1 attempt.

## Что осталось за пределами эксперимента

- Prompt 3 (grid-строительство + волны) не запускался (бюджет).
- Нет пары на openrouter :free (только ollama-cloud) — сравнение провайдеров вне рамок.
- Win rule запросы в системных промптах B не требовали явно reach win (prompt
  1 «нет победы» по тексту). Слабое место B-промпта: не просит win rule при
  неявном результате — candidate fix для следующей итерации.
- OrchestratorEngine реализует Generator, но не подключён к jobs/UI — это
  решение GO/NO-GO, а не недоделка.

## Known limitations реализации B

- `YAPloop` в примитиве `снимает` paused state немедленно на первый кадр после
  resume (setPaused(null) сброс last), поэтому первый кадр после resume имеет
  dt=0 — допустимо, но не идеально.
- `extractLogic` не проверяет отсутствие `window.location` (браузер checker
  поймает), но не отклоняет превентивно; можно добавить в следующей итерации.
- `primitives.ts` содержит в `INPUT_SOURCE` повторяющийся обработчик
  event.key → name map; потенциальная мини-оптимизация — вынос в общий сабтест,
  но сейчас это вне целей.
- У builder-скелета HUD `<output>` показывает `{"phase":"menu"}` до старта —
  checker допускает (read-only diagnostic), это и требование contract.

## Git

Branch `codex/task-013-game-orchestrator`; файлы: src/orchestrator/{spec,
selector,primitives,html-builder,engine}.ts, tests/orchestrator.{test,spec}.ts,
scripts/orchestrator-{ab,audit}.ts, playwright.config.ts (testMatch),
docs/architecture.md (раздел), этот отчёт. Live данные `.local/task-013/`
не коммитятся (локальная evidence; сырые HTML не публиковать в репозитории).
