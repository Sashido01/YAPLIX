> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# TASK-016 — Полноценные игровые правила в Game Orchestrator — report

Статус: **ITERATE**. Гипотеза подтверждена: orchestrator теперь carries и
встраивает в артефакт обязательные, честные правила игры (цель, действия,
взаимодействия, прогресс, win/loss, restart, mobile) с приоритетом дословных
условий пользователя; контролируемые регрессии доказывают достижимость win/loss
реальной автоматической игрой. Но единственная модель наблюдений (2 промпта,
ollama-cloud, частые 429/quota cooldowns) снова недостаточна для production
замены, а на артефактах с неявной win-целью (score-цель, выведенная из правил,
а не дословно из промпта) целевой результат реальной автоматической игрой не
доказан — остаётся открытым вопросом следующей итерации.

## Что изменилось

- [spec.ts](../../src/orchestrator/spec.ts): OrchestratorGameSpec несёт обязательный
  блок `rules` — objective, actions[], interactions[], progress, win, loss,
  restart, mobile, userRulesPriority. Win/loss по умолчанию выводятся из
  резолведного space (lives→loss жизней, enemies→захват, grid→переполнение
  …), никогда не выдумываются на unresolved; дословные условия пользователя
  из промпта всегда выигрывают (sentence-level regex). userRulesPriority
  фиксирует, были ли условия заданы пользователем.
- [engine.ts](../../src/orchestrator/engine.ts): user message содержит дословный
  промпт + derived spec + MANDATORY RULES block (JSON) + «win и loss должны
  быть оба достижимы»; run metadata включает rules. Видимый rules banner
  (Goal | Lose | Win | Controls) строится из rules и попадает в артефакт.
- [html-builder.ts](../../src/orchestrator/html-builder.ts): ORCHESTRATOR_SYSTEM_PROMPT
  требует обязательных правил: RULES ARE MANDATORY AND REAL — `_game.win()`
  из заявленного win-условия, `_game.lose()` из заявленного loss-условия,
  никогда loss-only games, HUD несёт прогресс к win-цели, restart начинает
  свежий run. Скелет получает видимый `<p id="yapBanner">`; BuildTask
  требует `rulesBanner`.
- [gameplay-check.ts](../../src/orchestrator/gameplay-check.ts) (новый): evidence
  checker уровня gameplay — real Chromium-сессия (дисциплина browser-check.ts:
  OS sandbox, offline, opaque iframe, GAME_CSP), которая честно играет в игру:
  Start → ввод (клавиши/экранные кнопки) → управляемые ходы или scripted
  sequence, terminal drive loop, passive idle stretch, restart probe.
  Уровни evidence: VERIFIED / NOT_VERIFIED / FAILED per aspect (html-runs,
  input-works, gameplay-observed, win-reachable, loss-reachable,
  restart-works). Пиксельные изменения не считаются геймплеем: нужны
  state-level доказательства (distinct HUD states/score events). Чистая
  функция summarizeSession тестируется unit-уровнем; игровой driver — уже
  real-browser, не LLM.
- [scripts/orchestrator-gameplay-audit.ts](../../scripts/orchestrator-gameplay-audit.ts) (новый):
  аудит существующих артефактов (.local/task-016/*.html) — static validation +
  gameplay evidence per aspect. Не LLM.
- tests/orchestrator.test.ts: unit-тесты на правила (priority user дословных
  условий, documented defaults per space, unresolved остаётся rule-free) и
  honest evidence mapping (parseTarget, summarizeSession).
- tests/orchestrator.spec.ts: контролируемые регрессии доказывают
  достижимость win и loss реальной автоматической игрой на двух контролируемых
  жанрах (tetris+explosions: 2 линии clear → win, переполнение → loss;
  snake+enemies: 5 яблок trail → win, idle catch → loss, restart после
  конца). Управляемые пути используют scripted sequences, не random taps.

## Контролируемые регрессии (real browser, не LLM)

| Проверка | Результат |
|---|---|
| tetris win: 2 lines cleared by guided drops | VERIFIED (win+score+restart) |
| tetris loss: stack overflow by idling | VERIFIED |
| snake win: 5 apples by riding trail | VERIFIED (win+score) |
| snake loss: enemy catch while idling | VERIFIED |
| restart works after real session end | VERIFIED (both genres) |

## Реальные live измерения (gemma4:31b, ollama-cloud)

| Prompt | Attempts | Repairs | Output tokens | TTFPG | HTML bytes | Static | Gameplay evidence |
|---|---|---|---|---|---|---|---|
| 1 тетрис+взрывы | 1 | 0 | 1 795 | 8.6 s / 17.5 s | 17 282 | none | html-runs+input VERIFIED; win/loss NOT_VERIFIED (blind probe) |
| 2 змейка+враги | 1 | 0 | 2 283 | 13.9 s | 19 015 | none | html-runs+input+gameplay+loss+restart VERIFIED; win NOT_VERIFIED |

TTFPG prompt 1: 8.6 s — первая успешная попытка (валидный артефакт сохранён);
17.5 s — контрольный повтор той же генерации на финальных метриках. Сравнение
vs TASK-013 B (12.2 s / 12.4 s, 2056/2228 tokens, 0 repairs): время
сопоставимо, repairs 0, tokens 1 795 / 2 283 (тяжелее на правила: до +250
tokens на промпт).

- prompt 1 (тетрис+взрывы): rules выведены, banner в артефакте; static check
  none; gameplay: html-runs VERIFIED, input-works VERIFIED, win/loss
  NOT_VERIFIED (target 200 не достигнута за бюджет blind probe; loss не
  достигнута — стек не добрался до верха за бюджет). Честно: НЕ доказано
  в probe, не PASS.
- prompt 2 (змейка+враги): rules выведены (lives-based loss default, score-
  based win default); static none; gameplay: html-runs/input/gameplay-observed
  VERIFIED (4 distinct HUD states), loss-reachable VERIFIED (enemy pursuit до
  потери жизней), restart VERIFIED; win NOT_VERIFIED (5 яблок не собраны за
  бюджет blind probe).
- Зафиксированы множественные реальные LLM_RATE_LIMIT/LLM_CONNECTION_INTERRUPTED
  паузы ollama-cloud quota (6 req/min); secondary openrouter route также в
  cooldown в эти окна. Модель наблюдений: 2 successful runs, 9 failed попыток
  из-за провайдера — provider reliability снова главный ограничитель.

## Доказательные уровни

Синтетические юнит-тесты (145 Node total), controlled real-browser probes,
live LLM прогоны, gameplay checker — отдельные уровни доказательства.
Physical devices не тестировались: mobile только эмуляция 320/390 (Pixel
profiles) — граница доказательств. `.local/task-016/` артефакты не коммитятся.

## Что осталось за пределами

- Win-цели, выведенные из правил (score 200 / 5 яблок), не доказаны
  достижимости реальной игрой на live артефактах — blind probe не находит
  оптимальную стратегию. Candidate fix: rules-aware probe (parse target из
  rules и вести игру к цели) — это следующий шаг, не часть этой задачи.
- Нет сравнения A vs B на этой итерации (TASK-013 уже зафиксировал пару);
  фокус был на правилах и доказуемости, не на повторном сравнении ветвей.
- Оркестратор по-прежнему не подключён к jobs/UI — решение GO/NO-GO отдельно.

## Git

Branch `codex/task-016-game-rules`; файлы: src/orchestrator/{spec,engine,
html-builder}.ts, src/orchestrator/gameplay-check.ts (новый),
scripts/orchestrator-gameplay-audit.ts (новый),
tests/orchestrator.{test,spec}.ts, docs/architecture.md (обновлён раздел),
docs/task-016-report.md (новый). Playwright config не требовал изменений
(testMatch уже покрывает tests/*.spec.ts patterns).
