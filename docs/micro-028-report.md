# MICRO-028 — Validator calibration and gameplay reachability

2026-10-17, Europe/Moscow. **RESULT: PARTIAL. Merge prohibited.**

## Preflight and protected data

Actual main/origin/main was `70fff011a8f01598863010366b3503fbd9d63396`, exactly
the supplied baseline. `git pull --ff-only` was up to date. The requested branch
is `test/micro-028-validator-calibration`. No earlier MICRO-028 implementation,
tracked dirty changes or additional worktrees were found. The untracked
`docs/Keys_Bilayn.pdf` is preserved and excluded from publication.

Only this repository was used. No BGen content, other checkout, provider/prompt,
Visual Kit, network mode, firewall, VPN, Actions settings or dependencies changed.
Configured and default SQLite were opened read-only for investigation; complete
games/versions/jobs logical hashes and .env/PDF hashes are compared with preflight.
The configured database has 27 games, 46 versions and 32 jobs; the default has
1 game, 1 version and no jobs. Test/UI writes use new ignored databases only.
Private originals, checkpoints, request IDs, replay data and screenshots are not
committed. New external LLM inference POST: **0** for every provider and repair.

## Existing production path and limits

`GenerationEngine -> prepareDocument -> validateDocument -> browserCheck ->
transaction Save/Ready`. Chromium has an OS sandbox, secret-free launch env,
offline opaque iframe, existing CSP, two widths (320/390), and an 18-second total
deadline. Legacy marked HTML retains lifecycle/input/pause/reset probes.
Arbitrary Full HTML uses `checkFullHtml`, with no mandatory IDs, telemetry,
getState or genre contract. It checks load/layout/runtime and a short generic
sequence of real taps, then standalone offline load.

A technical acceptance returns `html-runs: VERIFIED` and deeper aspects
`NOT_VERIFIED`. It can still create a version labelled as technically checked;
the UI explicitly does not certify mechanics or win/loss. Calibration therefore
uses all six required aspects for the overall VERIFIED outcome. It does not
miscount a startup pass as gameplay acceptance. Historical `MOBILE_VERIFIED`
metadata is retained for API compatibility and is not physical/mobile-play proof.

## Investigation of the reported saved game

The exact prompt was found in the configured private SQLite and correlated by
its durable job ID to the original checkpoint and generation JSONL. No UUID was
guessed and no substitute game was selected. The private trace records the
original browser failure at 320px / `touch-input`, around 2100ms, and a subsequent
local revalidation with the same phase. These historical requests are not new
task inference calls.

Three separate findings:

1. **Observed checker limitation:** Start has a custom accessible name outside
   the generic recognized names. The startup overlay covers the canvas. The
   checker skips Start, taps the first canvas and encounters an actionability
   timeout. A fresh replay of unchanged HTML reproduces the same code/phase;
   direct canvas tap records the intercepting overlay. This is missing evidence,
   not proof that controls are broken. No infrastructure/network cause is needed
   to explain this reproduced failure; a historical browser trace did not exist.
2. **Proven artifact defect:** initialization creates five citizens. A citizen
   increments score only once, on its unhappy-to-happy transition; none respawn.
   Winning requires score >=20. Thus this exact program bounds score at 5 before
   every reset. Real keyboard/touch navigation collected hearts and helped all
   five citizens; score became 5, every citizen was happy, an extra heart remained
   held, and the game stayed PLAYING. The win screen exists but is unreachable.
3. **Missing loss/restart scenario:** this source has START, PLAYING and WIN,
   with no loss transition, health or failure rule. The restart button is the
   initial button relabelled only by the unreachable win screen. It is unavailable
   during the observed endless PLAYING run. Initial Start/control/progress work;
   a numeric target/end condition is not explained in the player-facing rules.

Source inspection establishes the exact finite score bound; the bounded replay
corroborates it. This is not a general mathematical proof procedure for arbitrary
JavaScript. The checker does not discover that semantic defect automatically.
Original HTML/checkpoint/job were not patched. A safe independently authored
Start-overlay regression reproduces the checker limitation without publishing
user code. Future generator/rules work is justified by the artifact defect but
was not implemented: prompts and LLM budgets are outside this task.

Private reproduction: `.local/micro028/case-replay.ts`, immutable source copy,
`case-trace.jsonl`, `case-replay.json/.zip`, and `case-attempt2/receipt.json`,
`trace.zip`, `overlay.png`, `five-of-twenty.png`. The second replay corrects only
the outer host viewport meta to 390px; the first host had mobile's default 980px
layout viewport. Controlled browser time advances the unmodified game loop;
DevTools reads lexical state, never assigns it or forces an outcome.

## Independent corpus, oracle and actual actions

`tests/calibration-fixtures.ts` creates 15 distinct documents: five good authored
turn-based miniatures and two exact single-location mutations per genre.
Their modest complexity is intentional; no existing user original is replaced.
`tests/calibration-oracle.ts` supplies separate expected actions/results to replay.
The checker sees HTML alone, with identical titles within a genre and no broken
flag, mutation ID, expected answer or oracle manifest. No production code imports
the catalog/oracle or uses fixture identifiers.

Replay opens each document under opaque sandbox/CSP, starts it, performs ordinary
keyboard or touch controls, observes visible HUD/world fields and checks actual
phase/result transitions. Actions never call setters or private game functions.
Both input modes independently reach win, loss and full world reset for every
good reference. Broken references reproduce their specific defect in both modes.
State changes are semantic (position, items, score, board, health, phase, reset),
not screenshot equality. Exact document SHA-256 agrees between Before and After.

| IDs | Genre | Winning actions | Losing actions | Independent observations / mutations |
| --- | --- | --- | --- | --- |
| 01–03 | Snake | Right x3 | Up x3 | Position/apple removal/score3/won; wall health0/lost; full reset. 02 movement disconnected; 03 target30 with only3 apples. |
| 04–06 | Match-three | Select cells1,4 (digits or taps) | Swap0,1 twice | Adjacent swap clears two horizontal triples, score6/won; invalid swaps exhaust2 moves/lost; board/reset. 05 selection throws; 06 invalid swap freezes resolving state. |
| 07–09 | Top-down collection | Right x3 | Down into hazard | Three items disappear, score3/won; collision health0/lost; world/reset. 08 item removal omits score; 09 restart is no-op. |
| 10–12 | Lane dodger | Left,Step,Right,Step,Step | Step in starting lane | Three explicit road turns avoid obstacles/won; collision health0/lost; reset. 11 health0 omits loss; 12 collision condition disabled. |
| 13–15 | Breakout | Step x3 | Up before launch, Step x7 | Ball moves/hits brick, removal/score1/won; aimed miss passes paddle/health0/lost; reset. 14 hit brick not removed; 15 requires2 points with only1 brick. |

The first independent oracle attempt had two harness assertion errors: the valid
swap scores6, not3, and fixture06 stalls after an invalid rather than winning swap.
Those failed records are preserved in `oracle/`. Only the test assertions/actions
were corrected; HTML corpus and the initial production baseline did not change.
`oracle-attempt2/` confirms 5/5 good and 10/10 defect reproductions, both input modes.

## Before/After through the actual production validation path

Baseline ran before any production source edit. Each pass executes
prepareDocument, production static checks and actual browserCheck, without replay
hints. Every result stores expected truth, actual classification, code/feedback,
per-aspect evidence, elapsed time and HTML hash. The private independent replay
records actual keyboard/touch/win/loss/reset actions separately. A production
NOT_VERIFIED row does not borrow proof from that oracle. The Full HTML production
probe uses touch only and does not verify keyboard, win, loss or state reset.

| Fixture | Ground truth | Before | After (final) | Corresponding defect detected by production | Evidence under .local/micro028 |
| --- | --- | --- | --- | --- | --- |
| 01 Snake | Good | NOT_VERIFIED | NOT_VERIFIED | n/a | before/after results, oracle-attempt2/01.zip |
| 02 Snake | Defective | NOT_VERIFIED | NOT_VERIFIED | No: disconnected movement | oracle-attempt2/02.zip |
| 03 Snake | Defective | NOT_VERIFIED | NOT_VERIFIED | No: unreachable target | oracle-attempt2/03.zip |
| 04 Match-three | Good | NOT_VERIFIED | NOT_VERIFIED | n/a | oracle-attempt2/04.zip |
| 05 Match-three | Defective | FAILED | FAILED | Yes: JAVASCRIPT_EXCEPTION; exact message now retained | oracle-attempt2/05.zip, after/results.json |
| 06 Match-three | Defective | NOT_VERIFIED | NOT_VERIFIED | No: resolving freeze | oracle-attempt2/06.zip |
| 07 Collection | Good | NOT_VERIFIED | NOT_VERIFIED | n/a | oracle-attempt2/07.zip |
| 08 Collection | Defective | NOT_VERIFIED | NOT_VERIFIED | No: collection omits goal increment | oracle-attempt2/08.zip |
| 09 Collection | Defective | NOT_VERIFIED | NOT_VERIFIED | No: restart no-op | oracle-attempt2/09.zip |
| 10 Lane dodger | Good | NOT_VERIFIED | NOT_VERIFIED | n/a | oracle-attempt2/10.zip |
| 11 Lane dodger | Defective | NOT_VERIFIED | NOT_VERIFIED | No: no loss at health0 | oracle-attempt2/11.zip |
| 12 Lane dodger | Defective | NOT_VERIFIED | NOT_VERIFIED | No: collision omitted | oracle-attempt2/12.zip |
| 13 Breakout | Good | NOT_VERIFIED | NOT_VERIFIED | n/a | oracle-attempt2/13.zip |
| 14 Breakout | Defective | NOT_VERIFIED | NOT_VERIFIED | No: hit brick remains | oracle-attempt2/14.zip |
| 15 Breakout | Defective | NOT_VERIFIED | NOT_VERIFIED | No: unreachable score2 | oracle-attempt2/15.zip |

Positive means **defective**: TP = defective classified FAILED; TN = good
classified VERIFIED. Unknowns stay in all denominators.

| Metric | Before | After |
| --- | --- | --- |
| False accept (defective VERIFIED) | 0/10 | 0/10 |
| False reject (good FAILED) | 0/5 | 0/5 |
| Inconclusive | 14/15 (93.3%) | 14/15 (93.3%) |
| Checker error | 0/15 | 0/15 |
| TP / corresponding defect detection coverage | 1/10 (10%) | 1/10 (10%) |
| TN / good verified by production | 0/5 | 0/5 |
| Determinate outcomes | 1/15 | 1/15 |
| Median wall time | 1679ms | 1768ms |
| Short technical gate accepts | 14/15 | 14/15 |

Nine defective documents pass the technical gate but receive NOT_VERIFIED, not
gameplay VERIFIED. If technical gate acceptance were used as a playability label,
these would be nine false accepts out of ten defective references. The distinction
must survive downstream UI/API use. No performance improvement is claimed.

Initial restricted-executor launches exited with unsettled top-level await before
any result; logs are kept as `before.log` / `oracle.log`. The successful baseline
and independent replay used the supported OS-sandbox browser launch outside that
executor restriction. No result row was discarded or retried to improve metrics.
The first After run remains in `after/` (median1709ms). A subsequent regression
proved that runtime feedback carried the later `restart` phase instead of the
original `action-controls` phase. After correcting first-error phase capture,
the unchanged complete corpus ran again in `after-attempt2/`: identical outcomes
and hashes, median1768ms. The final run overlapped local test load; these timings
are recorded measurements, not an optimization benchmark. `phase-before.log`
and its trace preserve the failing assertion, while the final regression passes.

## Minimal fixes and compatible contracts

* Preserve the first Full HTML pageerror message and its original phase (250 chars, owner-only feedback),
  rather than only `JAVASCRIPT_EXCEPTION`. Fixture05's baseline has no feedback;
  After retains `Cannot select cell`. Metadata traces remain source-free.
* Distinguish a Playwright action timeout (NOT_VERIFIED with phase) from an
  unexpected checker operation failure (`BROWSER_CHECKER_ERROR`). The latter is
  also exercised by an explicit synthetic checker IO failure, not a fabricated
  game defect or external outage.
* Add optional `validation.outcome`; keep existing three-valued `level` and old
  jobs/API valid. Checker failures use compatible NOT_VERIFIED level and distinct
  owner UI text. Preserve the actual diagnostic phase instead of `validation`.
* Block automatic repair for checker failures in fresh and checkpoint paths.
  Tests verify zero extra synthetic dispatch/repair for both paths. Existing
  routing, budgets, cancellation, originals and storage semantics remain.

No new generic gameplay heuristic, state protocol, engine, genre adapter, prompt
change, increased timeout, fallback or assertion-based certificate was introduced.
Recognizing a few additional Start words would not solve unreachable objectives.

## Local verification and real launcher UI

Typecheck and production build PASS. Unit/backend248/248, Python19/19,
CI-policy8/8, repository checks and diff hygiene PASS. Production generation plus
new checker regressions11/11 PASS, including runtime detail, unsupported overlay,
synthetic checker IO, original sandbox/runtime/restart/repair contracts.
Private logs: `build.log`, `units.log`, `browser-regression.log`.

Actual `D:/YAPLIX/YAPLIX.cmd --no-open` ran on loopback3268 against a new private
authored-only SQLite, with providers/Telegram off and an external-fetch guard.
Through the ordinary UI: library/version open, Start, touch victory, keyboard
progress, reload and version selection worked. The local fixture API saved a
second explicitly unverified authored version; the first HTML stayed byte exact.
Export matched saved bytes and reached touch victory offline from file.
Persisted synthetic FAILED / NOT_VERIFIED / CHECKER_ERROR job rows displayed
distinct messages through Create -> Jobs. These rows test rendering, not real
generation or an observed infrastructure outage. Authenticated own-backend
shutdown returned202. No original user data was used by this server.

Final evidence on the final source/build: `ui-final/ui-smoke.json`,
`ui-smoke.zip`, `ui-play.png`, `status-FAILED.png`, `status-NOT_VERIFIED.png`,
`status-CHECKER_ERROR.png`, `ui-export.html`, and launcher log. Status screenshots
were visually inspected. Earlier attempts remain:
attempt1 wrong shutdown nonce masked browser-path failure; attempt2 confirmed
Playwright was imported before its repository browser path, then was stopped via
verified HMAC shutdown; attempt3 passed play/export but screenshot review found
status rows were in a hidden ancestor on the Play screen. Attempt4 navigates the
existing Create screen and asserts actual visibility. The final run also captures
each status separately at desktop width to avoid the mobile scroll container
clipping a tall combined screenshot. No browser was installed
and no UI redesign was performed to repair these private harness mistakes.

The existing mobile/runtime/MVP/jobs matrix ran on desktop Chromium,
320/360/390/430, tablet and WebKit390: first run105 PASS,2 FAIL,5 intentional SKIP.
Both failures were the same pre-existing controlled-worker test adapter, whose
`synthetic` provider did not match the UI's explicit `ollama-cloud` selection.
Direct routesFor reproduction returned LLM_NOT_CONFIGURED before dispatch;
the unchanged baseline test source and provider filter corroborate the cause.
Only that test adapter now uses canonical ollama.com/gemma4:31b with its existing
held local complete callback. The two failed profiles then passed2/2. Production
routes were not weakened. First failure logs/traces remain, not hidden by reruns.
These scenarios cover touch, rotation, keyboard viewport, navigation, sandbox,
versions, persistence and offline export. Logs: `mobile-regression.log` and
`worker-regression-attempt2.log`. This is local synthetic proof.

Final typecheck/build PASS; complete units248/248 and checker/generation browser
regressions11/11 PASS on final production source (`*-final.log`). The bounded
first-runtime-phase regression failed before the fix and passed afterward.
A separate read-only ship completion audit found no new verified production/API
issue in the scoped diff and independently confirmed the PARTIAL classification.

No physical Android/iOS/Safari/WKWebView/Telegram result is
claimed. Windows local browser evidence is not hosted Ubuntu/Windows CI proof.
Actions remain disabled; FULL is the normal risk classification, the MICRO-019
local exception applies. This is not a release and no Actions dispatch is allowed.

Final protected-state verification: configured games/versions/jobs logical hashes
match preflight; default database matches its initial snapshot; .env/PDF hashes
match. All15 Before/final-After document hashes match and the independent replay
has15/15 expected outcomes with two input modes. Gitleaks8.24.3 scanned77 existing
history commits with no findings. The explicit publication manifest is scanned
separately before committing; private files are excluded. GitHub GET main still
returns the baseline SHA and GET Actions permissions returns enabled:false.
One initial permissions GET timed out; a later read succeeded. No network setting
was changed and the timeout is not attributed to an LLM provider.

## Files, Git and decision

Production scope: `src/full-html-check.ts`, `src/validation.ts`, `src/live.ts`,
`src/ui.ts`. Test/tool scope: calibration catalog/oracle/replay runner,
MICRO-028 unit/browser tests, controlled-worker fixture correction and Playwright registration. Documentation: this
report, game-validation guide and compact known-errors guide. Private evidence,
user PDF, env, SQLite, game source and checkpoint data are excluded.

Branch: `test/micro-028-validator-calibration`. Implementation commit:
`f78d6b67f4e4dda51edad568bf61842f09b8caf6`. Draft PR:
[YAPLIX #34](https://github.com/Sashido01/YAPLIX/pull/34), targeting main.
The subsequent documentation receipt commit changes only this publication record;
its final head is available in the PR and private Git receipt. The full reviewed
change is14 files /557 insertions /13 deletions before this receipt update.
Separate publication-manifest and PR-body/title Gitleaks scans found no findings.
The final documentation audit confirmed all three guides against the completed
logs and made no further changes. Merge: **not permitted (PARTIAL)**. Main remains
`70fff011a8f01598863010366b3503fbd9d63396`; no merge SHA exists for this task.

Strict acceptance fails because production cannot prove the five good games or
identify the nine remaining semantic defects. Absence of false VERIFIED is useful
but insufficient. The independent replay is not a production validator replacement
and authored miniatures do not establish real LLM generation reliability.

**NEXT:** extend the existing bounded gameplay replay with independently audited
semantic observations/actions for a supported Full HTML game, starting with the
observed finite collect/deliver objective; rerun the unchanged corpus and retain
NOT_VERIFIED for unsupported mechanics. Keep generator/prompt changes and any
real inference comparison separately authorized.
