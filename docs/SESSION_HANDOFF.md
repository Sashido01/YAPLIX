# MICRO-019 — текущее состояние

Работа от main `4ea156eca6881eb58269459205ecbd6fc1739f47`, ветка
`codex/micro-019-reliable-generation`. Дата: 16 октября 2026.
Git delivery и фактический merge SHA подтверждаются в PR receipt/итоговом ответе;
этот файл фиксирует проверку продукта до публикации.

## Реализовано и проверено локально

- Два production route: Ollama Cloud `gemma4:31b` и OpenRouter `openrouter/free`.
  UI: Auto / Ollama Cloud / OpenRouter Free; backend проверяет выбор.
- Auto переключается к резерву максимум один раз в задании; retired route
  сохраняется через restart и ручной Continue. Без providerMode старые задания
  нормализуются в Auto, без удаления исходных requests/черновиков.
- Нет повторного обхода provider list. Default budget 4 calls/300 s, bounded
  backoff, Retry-After, request default <=60 s, lifetime 12 calls/job.
- HTTP/SSE auth/quota не повторяются на том же route; quota в models API
  останавливает dispatch. Cancel, checkpoints, idempotency и SQLite сохраняются.
- Удаление ключа недоступного route не блокирует startup/доступ к старым jobs.
  Idempotent replay старого запроса не требует доступности текущего provider.
- Typecheck/build и 94 целевых generation/platform/MVP/network tests PASS.
  Python checker/tests (19), CI policy tests (8), diff secret scan PASS.
- Selector/draft reload: Chromium 320/360/390/430, tablet/desktop, WebKit390:
  7/7 PASS. Ещё 4/4 controlled worker/background smoke на Chromium320/WebKit390
  проверили sandbox, touch, сохранение и reload (LLM transport synthetic). Это эмуляция, не физические Android/iOS/Telegram клиенты.

## LIVE — PARTIAL, не PASS

Playwright отправил точный запрос «Собери игру три в ряд» через production
createApp/GenerationJobs в отдельной `.local/micro019/live.sqlite`.
Ровно **4 inference HTTP POST из 4 разрешённых**:

1. Ollama Cloud `gemma4:31b`: `LLM_CONNECTION_INTERRUPTED`, 11.0 s.
2. OpenRouter `openrouter/free`: `LLM_TIMEOUT`, 45.0 s.
3. Тот же разрешённый резерв: `LLM_TIMEOUT`, 45.0 s.
4. Тот же резерв: `LLM_TIMEOUT`, 45.0 s.

Job закончил `needs_attention`, сохранил идею, 4 attempts и исходную историю;
получено 0 HTML bytes, сохранено 0 игровых версий. Повторных обращений к Ollama
после switch не было. Причина сетевой недоступности не установлена; VPN/proxy
или исчерпание квоты по этим таймаутам не доказаны. Шаблон не подставлялся.
Gameplay (swap/match/score/goal/restart/touch и повторное открытие LIVE-игры)
**NOT VERIFIED**, потому что provider не вернул игру. Ещё inference без нового
разрешения владельца запрещён. Локальные synthetic PASS этого не заменяют.
Evidence (private ignored): `.local/micro019/live-job.json`,
`.local/micro019/inference-count.json`, `.local/micro019-units.log`,
`.local/micro019-final-units.log`, `.local/micro019-browser.log`,
`.local/micro019-jobs-browser.log`.

## CI и продолжение

Actions выключены на уровне **только этого private repo**: REST
`actions/permissions.enabled=false`. Исходно enabled=true, allowed_actions=all,
sha_pinning_required=false. Repository checks ID379465037 disabled_manually;
dynamic Dependabot ID379465492 не допускает отдельный disable (422), но
repository-wide off блокирует и его. Running/pending runs: 0. Main protected=false,
required checks/contexts пусты. Permissions/protection не обходились и не менялись.
[FAST/FULL и восстановление](ci-economy.md) сохранены; включать только по команде
владельца. Нельзя называть отсутствие hosted runs зелёным CI.

Windows запуск — `YAPLIX.cmd`; после обновления повторный запуск штатно заменяет
свой backend. `.env`, пользовательская SQLite, существующие игры и
`docs/Keys_Bilayn.pdf` не изменяются проверкой MICRO-019. Экспериментальный
Game Orchestrator, Telegram и внешняя сеть не исправляются в этой задаче.
Следующая продуктовая проверка — новый разрешённый live-бюджет при доступном API
и реальные Playwright действия до цели; без этого MVP приёмка остаётся PARTIAL.
