# MICRO-022 — Production Game Validation & Automatic Recovery

16 октября 2026. FACT: baseline main/origin/main
`8465feac701932cf074e7215fa0d49fe6f9f921a`, ff-only pull подтвердил актуальность.
Tracked baseline чистый, untracked `docs/Keys_Bilayn.pdf` сохранён. Ветка
`codex/micro-022-production-validation`. Это внутренний increment, не release.

## ARCHITECTURE / DETECTION / RECOVERY

Расширен production `browserCheck`, вызываемый GenerationEngine перед Save/Ready
и при восстановлении полного checkpoint. Static/security и event validation
сохранены. Короткий probe добавляет per-aspect evidence, reset/restart input,
контроль disabled input/удалённого Canvas и budgets. Существующий gameplay
summarizer используется повторно; экспериментальный Orchestrator source не изменён.

Новый `prepareDocument` исправляет только целый JSON-string HTML и missing doctype.
Любой candidate повторно проверяется. Селекторы, JavaScript и игровые правила
автоматически не переписываются. Первый rejected raw response сохраняется в
durable originalCheckpoint; текущий checkpoint может содержать repair candidate.
Два draft учитываются в storage quota, summary не содержит raw HTML.

Cloud LLM repair default off; отдельное owner разрешение и `LLM_AUTO_REPAIR=1`
нужны для дополнительных inference. Механизм протестирован на mocks: максимум
один rewrite, тот же бесплатный route, durable claim перед dispatch, повторная
валидация, no duplicate versions. Continue/restart/неполный ответ не обходят cap.
Полный checkpoint можно revalidate без POST. Raw logs не передаются модели.
Неподтверждённый checker timeout не требует LLM rewrite.

При review воспроизведён обход cap для incomplete repair + Continue; исправлен
guard перед любым новым dispatch. Отдельные regressions проверяют SQLite reopen
и CloudOutputFailure → automatic retry без третьего вызова. Дополнительно проверены
pinning восстановленного OpenRouter checkpoint при новом primary и запрет rewrite
неполного checkpoint при disabled production repair, missing/unconfigured origin
и отсутствие provider fallback после failure repair transport.

[Подробные границы, diagnostics и budgets](game-validation.md).

## GAMEPLAY

На **неизменённом** private MICRO-020 HTML production job завершился
`needs_attention / JAVASCRIPT_EXCEPTION / FAILED`: `Cannot set properties of null
(setting 'textContent')`. Оба original/current checkpoint сохранены, 0 versions.
Старый checker также находил этот дефект; это подтверждённый baseline, а не новое
заявление об отсутствии прежней проверки. Deterministic repair данного селектора
безопасно не обобщается и не выполняется.

Повторно проверена **ранее вручную восстановленная** private копия MICRO-021:

- Touch adjacent swaps; invalid swap rollback; match score 0→30, moves 20→19.
- Gravity/refill без пустых клеток и последующие настоящие ходы.
- Победа 1020 points / 2 moves left; поражение 910 / 0 moves, видимые финалы.
- Restart и pause/resume с сохранением board/score/moves.
- Видимость Canvas 320/360/390/430, tablet/desktop и landscape.
- Short production gate PASS, JS errors 0, offline/opaque CSP.
- Отдельная SQLite save/close/reopen, WebKit390 touch Start/reload, offline export,
  integrity PASS. Версия остаётся authored/manual-recovery, не новая LLM generation.

Synthetic Tetris/Snake: существующие controlled probes подтверждают input,
progress, score, win/loss и restart в своём scope. Дополнительные runtime fixtures:
syntax error, startup exception, input exception, unhandled Promise rejection,
disabled input, удалённый Canvas, crashing/no-op Restart, inert logic,
format repair и broken repair. Неизвестная/inert механика получает NOT_VERIFIED;
HTML text/pixel activity не доказывают win. Полная случайная игровая логика и
physical Android/iOS/Telegram NOT_VERIFIED.

## PERFORMANCE / TESTED

Baseline direct checker: authored fixture 3042 ms, original rejection 4120 ms.
Новый production rejection на том же оригинале 4334 ms; recovered gate 2998 ms.
7 отдельных новых Chromium на recovered HTML: 2766, 2713, 2712, 2742, 2705,
2747, 2707 ms; median 2713, range 2705..2766 ms. Это локальный Windows probe
без CPU/network throttling, не оптимизация, shell/API/LLM benchmark или shared CI.
Initial render ≤3.5 s/operation, startup ≤8 s, interaction ≤6 s/viewport,
marked restart ≤2.5 s/viewport, вся validation/revalidation ≤18 s; repair использует
прежний request deadline (default ≤60 s), engine/job budgets сохранены.

| Проверка | Результат |
| --- | --- |
| TypeScript typecheck / build | PASS |
| Все Node unit/contracts | 217/217 PASS; MICRO-022 17/17 |
| Runtime/generation + CSP/session Chromium | 11/11 PASS |
| Short mobile jobs/provider/offline/session Chromium320 + WebKit390 | 10/10 PASS |
| Existing controlled Snake/Tetris gameplay | 3/3 PASS |
| Python tests / CI economy policy | 19/19 и 8/8 PASS |
| Repository checker / Gitleaks history | PASS / no leaks |
| Physical devices / fresh live generation / hosted Ubuntu FULL | NOT_TESTED |

## LLM / SECURITY / CI / DOCS

**0 новых настоящих inference POST**. Использованы fixtures, существующие private
checkpoints, mocked transport и local HTTP servers. Новое LIVE E2E требует отдельного
разрешения; старый checkpoint не даёт LIVE PASS.

CSP и opaque sandbox сохранены; generated JS исполняется только в Chromium.
OS firewall/proxy/VPN не менялись. `.env`, PDF, оба исходных HTML и три существующие
SQLite из preflight manifest: 7/7 SHA-256 unchanged после тестов. Visual Kit и
пользовательские игры/jobs не редактировались; новые БД только `.local/tests` и
`.local/micro022`. Private HTML/checkpoints/SQLite/logs не включаются в Git.

Actions disabled подтверждено GitHub API перед push; hosted workflows не запускались.
MICRO-019 exception действует до 29.10.2026; обычная FAST/FULL policy сохранена,
но unavailable Windows/Ubuntu/secret-scan не объявляются зелёными. Это не release.
Staged/commit secret scan, PR/merge receipt и post-merge actual SHA проверяются при
публикации; итоговые hashes доступны в Git и финальном отчёте, не предсказываются здесь.

Обновлены README, architecture, development setup, known errors, этот отчёт,
[validation guide](game-validation.md) и SESSION_HANDOFF.

VERDICT: Technical local PASS; Gameplay PASS в перечисленном scope; LIVE NOT_TESTED.
Публикация/merge не являются доказательством новой успешной LLM игры. Следующее
действие владельца — отдельно разрешённое fresh LIVE E2E и physical acceptance.
