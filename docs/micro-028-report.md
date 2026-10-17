# MICRO-028 — Validator calibration and gameplay reachability

**Latest revision: MICRO-028.1 — STOP_GATE (2026-10-17).** Production checker is
unchanged. See the revision section below for the feasibility decision, audited
oracle dependencies, case-by-case causes and current regression results. The
original MICRO-028 measurements below are historical, not a new PASS claim.

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

**Historical MICRO-028 NEXT (superseded by the MICRO-028.1 STOP-GATE):** extend the existing bounded gameplay replay with independently audited
semantic observations/actions for a supported Full HTML game, starting with the
observed finite collect/deliver objective; rerun the unchanged corpus and retain
NOT_VERIFIED for unsupported mechanics. Keep generator/prompt changes and any
real inference comparison separately authorized.

## MICRO-028.1 revision — Stage A feasibility decision

**RESULT: STOP_GATE. No production, test, fixture, prompt, route, contract,
Blueprint, Visual Kit, engine or network code changed in this revision.**
The current branch and Draft PR34 are retained. The revised user instruction
explicitly requires Stage A before implementation and permits documentation/PR
updates at STOP_GATE. Stages B/C/D2/E implementation acceptance are not entered.

Revision preflight: HEAD and remote feature head
`5ae7c105a30d0769073d2005967cbd4d2e7a92ad`; local main, origin/main and remote
main `70fff011a8f01598863010366b3503fbd9d63396`. No tracked dirty work existed;
the pre-existing untracked PDF remains untouched. No new branch/worktree/PR,
ff-update of the feature branch, or switch away from the requested branch.
Actions GET reports enabled:false. External LLM inference/repair POST: **0**.

### Why 14 results are NOT_VERIFIED

All15 documents enter the arbitrary Full HTML path: none has the legacy
data-yaplix-start marker. In `src/full-html-check.ts`, the successful return
explicitly assigns VERIFIED only to html-runs and NOT_VERIFIED to the other
five aspects. This is the existing honest technical-gate contract, not an
unhandled timeout, hidden semantic test failure, or a claim of gameplay proof.
`validationOutcome` consequently cannot return overall VERIFIED for these
successful Full HTML probes. Merely increasing time/actions will not change
that return policy or supply semantic evidence.

Stage A replayed all15 unchanged documents against that frozen checker. A
private observer records ordinary locator taps, DOM snapshots and traces without
changing verdict logic, adding controls, reading fixture oracle, setting game
state, advancing its clock, or passing hints to production. Extra read-only
sampling adds overhead, so these timings are not a performance comparison.
Before/final-MICRO-028/Stage-A document hashes and all15 classifications agree.

The actual per-profile trace is usually **Start, Start, Start, Restart, Left,
Restart**, not a meaningful path to the objective. The second Start comes from
the first visible generic input locator: in these documents Start precedes the
canvas in DOM order. The third is the first of three generic action buttons.
For match-three, the fifth tap selects Cell0 (displayed value1), not Left.
These observations correct any inference that the corpus probe necessarily
tapped a canvas or exercised a completed swap. Two profiles produce12 taps per
document; the JS-exception document stops after6 taps at its first profile.
Total174 taps, zero keyboard actions. None of the14 completes the reference
winning/losing sequences or evaluates semantic progress/reset invariants.

**Classification convention:** primary = immediate reason the production run
does not establish the mechanism. Supplementary ORACLE_DEPENDENT = the existing
independent proof recipe relies on preselected paths and semantic/defect-specific
assertions not supplied to or derived by production. It does **not** mean the
fixture's DOM is secret, unreadable or fundamentally unobservable. All14 have
readable rendered HUD state. Unknown-genre interpretation is a separate problem
from acquiring text/pixels. No case is classified fundamentally NOT_OBSERVABLE
merely because it uses Canvas.

In the table, N = NOT_ATTEMPTED (primary), O = ORACLE_DEPENDENT proof recipe
(supplementary). Trace and before/after snapshots are in private
`.local/micro028/revision1/audit.json` and numbered 320/390 ZIP files.

| Case | Primary / extra | Actually observed and missing proof | Oracle-dependent reference capability |
| --- | --- | --- | --- |
| 01 Snake good | N / O | Left moves head; restart resets. No apples, declared goal, win or loss evaluated. | Right x3, Up x3, coordinate/apple/score/terminal/reset assertions. |
| 02 Snake movement defect | N / O | Left leaves head in place and produces loss through self-contact; checker does not interpret it. | Knows movement invariant, compares unchanged position to directional action. |
| 03 Snake target defect | N / O | Left, score0, reset; target30/available3 contradiction not examined. | Collects the known three apples and interprets inventory/goal/phase. |
| 04 Match-three good | N / O | Cell0 selected; no completed adjacent swap or exhausted moves. | Preselected cells1,4 and losing swaps; board/score/moves mapping. |
| 06 Match-three freeze | N / O | Cell0 selected only; resolving state never entered. | Specific invalid swap0,1, then another input and stable-state check. |
| 07 Collection good | N / O | Left at boundary; no collection, hazard or goal reached. | Right x3 and Down hazard route; item/score/health/reset assertions. |
| 08 Collection score defect | N / O | No item contact; removal-to-progress relationship not tested. | Known item route and comparison of remaining items with score. |
| 09 Collection restart defect | N / O | Restart tapped after boundary action; turn remains1, no semantic reset assertion. No collected progress or win established. | Reaches win first and checks full initial-world restoration. |
| 10 Lane good | N / O | Lane changes, road turn stays0. No Step, obstacle, goal or loss. | Knows obstacle order and steering/Step sequence; health/phase/reset. |
| 11 Lane loss defect | N / O | No road advancement/contact; health exhaustion not exercised. | Step on starting obstacle, health0 with no loss transition. |
| 12 Lane collision defect | N / O | No road advancement/contact; collision effect absent from the probe. | Knows initial obstacle lane; checks missing damage/progress mismatch. |
| 13 Breakout good | N / O | Paddle moves; ball/brick unchanged because Step is never used. | Ball-advance and launch-miss paths; brick, score, health, terminal/reset. |
| 14 Breakout brick defect | N / O | No ball advance or hit; no removal comparison. | Known three-step hit, remaining-brick assertion. |
| 15 Breakout target defect | N / O | No brick route/score progression; absence of win is not impossibility proof. | Hits the single brick and applies the known goal/score/phase assertions. |

Case05 is outside the14 missing-evidence rows: the actual cell selection throws
`Cannot select cell`, yielding FAILED with action-controls phase. That concrete
runtime defect is still correctly detected; it is not CHECKER_ERROR.

Counts over the14: primary NOT_ATTEMPTED14/14; supplementary oracle-dependent
reference recipes14/14; proven fundamental NOT_OBSERVABLE0/14; demonstrated
BUDGET_LIMIT0/14; demonstrated checker malfunction causing the mass result0/14;
unexplained primary cause UNKNOWN0/14. An incomplete semantic capability is not
automatically labelled CHECKER_BUG. The 1007–2013ms completed corpus checks do not
exhaust the18-second deadline; waiting longer cannot execute absent assertions.

### Independent replay audit

| Question | Calibration replay | Saved real-game investigation |
| --- | --- | --- |
| Prepared input paths? | Yes: win/loss arrays per genre; extra branches use genre and mutation index. No search/planning is demonstrated. | Adaptive path still has source-specific target selection, not generic perception. |
| Internal state available? | Nearly the whole world is serialized into visible #hud JSON; replay reads/compares fields. This is public DOM, not direct lexical state injection. | The kindness replay reads lexical player/citizens/hearts/gameState through DevTools. |
| Special API? | No getState/GameBlueprint API. However #hud/#result/#start, data-action and cell labels form a fixture-specific schema, not a Full HTML requirement. | Source-specific evaluate expressions and #start-btn selector; not a portable black-box observer. |
| Seed/time? | No installed seed or virtual clock. Worlds are hard-coded, deterministic, turn-based; normal browser time. | Kindness uses page.clock.install/runFor to drive the unchanged RAF loop; random positions are not seeded. |
| Coordinates known? | Winning/losing routes embed knowledge of item/hazard/road/board/brick positions. Positions are not discovered from Canvas. | Reads exact object coordinates from lexical state and dispatches touch movement toward them. |
| Oracle/defect manifest? | Yes: imports calibrationOracle, knows index%3 ground truth and genre/variant-specific assertions. Production gets only HTML. | Source was manually inspected; trajectory is designed using that knowledge. |
| What is missing in production? | Those paths, HUD schema/meaning, target/rule interpretation, variant-specific invariants, paired win/loss/reset assertions. | No general mapping from arbitrary Canvas pixels/JS bindings to citizen/heart/goal semantics. |

Thus the old replay is independent of **production verdict**, not universal or
blind to the game. Its140 logged directional/cell/Step actions exclude clicks
on Start/Restart and keyboard-focus canvas; that number is not directly comparable
to the174 production taps. It is an authored regression suite, not an automatic
gameplay verifier or an external audit. Reading a rich HUD does not establish that
an arbitrary game truthfully exposes its world or terminal conditions.

### The 5/20 claim: MIXED_EVIDENCE

The source copy is byte-identical to both checkpoint and originalCheckpoint in
the preserved private job capture. This revision did not reopen or write user
SQLite. The exact captured program has one inline script. Relevant source paths
and every ordinary callback were re-inspected; a private reference index and
syntax-only parse are in `revision1/static-proof.json`. Syntax parsing is not a
semantic proof tool and no game code runs in Node.

Static reasoning for this exact artifact:

1. Score is initialized to0 (line150) and reset to0 by initGame (line247).
   The latter clears citizens, constructs exactly5 unhappy citizens (lines250–257),
   and resets held hearts. Configuration specifies5 citizens and winning score20.
2. The **only** score increment is line319, inside the !happy/collision/held-heart
   branch. That same synchronous branch first changes that citizen to happy
   (line317). No path changes a happy citizen back to unhappy within a round.
3. spawnCitizen has no ordinary call other than the five-iteration init loop.
   No in-round citizen append, respawn, removal/refill or alternate round transition
   exists. Heart spawning repeats (lines295–298), but collection changes inventory,
   not score or the number of citizens. More hearts cannot add scoring opportunities.
4. Therefore the invariant **score = current happy-citizen count**, with0<=score<=5,
   holds at initialization and every scoring transition. A further initGame resets
   score and the five citizens together; there is no cross-round accumulation,
   persistence reload or alternative source of points. FrameCount may carry across
   resets, affecting heart timing only, not this score invariant.
5. WIN is entered only at score>=20 (lines323–325). showWinScreen is scheduled only
   there, and the restart label is set only in that callback. No loss transition
   is implemented. Other callbacks move the player, resize, or draw/age particles;
   they do not invalidate the score bound.

The historical controlled replay corroborates this: all5 citizens happy, score5,
extra held heart, PLAYING, no visible restart, no runtime errors. A bounded replay
alone would be RUNTIME_OBSERVATION and insufficient to prove a global bound.
Here the result is **MIXED_EVIDENCE**: a static invariant argument over all relevant
ordinary program paths plus runtime corroboration. It is scoped to this exact
captured program without source/DevTools mutation, not a mechanized mathematical
verifier or a method for proving arbitrary JavaScript unsolvable. The production
checker itself does not perform this static proof and must not borrow it for FAILED.

A first private helper attempted an unavailable bundled TypeScript AST API and
failed before analysis; it is recorded in static-ast-attempt1.log. No dependency
was installed. The final helper only parses syntax and indexes references; the
static semantic argument above remains explicit human/code inspection.

### Before/current measurements and real regressions

Checker frozen before Stage A at
`5ae7c105a30d0769073d2005967cbd4d2e7a92ad`; browser-check/full-html-check/
validation/live source hashes were taken before the run and rechecked afterward.
There is no candidate checker implementation and no claim of improvement.

| Metric | MICRO-028 Before | MICRO-028 final After | MICRO-028.1 Stage A, same checker |
| --- | --- | --- | --- |
| Good VERIFIED | 0/5 | 0/5 | 0/5 |
| Proven, correctly diagnosed defects | 1/10 | 1/10 | 1/10 |
| Defective VERIFIED | 0/10 | 0/10 | 0/10 |
| Good FAILED | 0/5 | 0/5 | 0/5 |
| NOT_VERIFIED | 14/15 | 14/15 | 14/15 |
| Determinate verdicts | 1/15 | 1/15 | 1/15 |
| CHECKER_ERROR | 0/15 | 0/15 | 0/15 |
| Completed without checker technical error (game exception counts as completed detection) | 15/15 | 15/15 | 15/15 |
| Median duration | 1679ms | 1768ms | 1964ms with diagnostic observer |
| Recorded production inputs | Not recorded | Not recorded | 174 taps, 0 keys over15 cases |

Specific per-case missing-evidence reasons emitted by **production**:0/14;
the generic aspect names are not a reason. Stage A analyst explanations backed
by source and recorded actions:14/14. The five aspect names appear as
NOT_VERIFIED in70/70 aspect slots across14 cases, but this is a fixed policy,
not a useful100% semantic-accuracy score. Independent correctness/generalization
of a reason-generating algorithm was not measured: there is no such algorithm.
Low false-accept/reject counts must be read together with only1/15 determinate
outcomes and1/10 detection coverage, never as a reliability score.

| Existing real regression | Source provenance | Fresh production result | What this revision does not establish |
| --- | --- | --- | --- |
| Kindness | Hash matches captured checkpoint and originalCheckpoint | NOT_VERIFIED; BROWSER_CHECK_INCONCLUSIVE, touch-input,1 attempted tap,2292ms; no page errors | Checker does not prove win impossible; static 5/20 reasoning is separate. No new full gameplay replay. |
| Successful MICRO-027 LIVE export | Preserved9894-byte HTML hash matches delivered version metadata | Technical gate passes320/390; overall NOT_VERIFIED,4 taps,1667ms; no page errors | Win/loss/reset not re-proven by this generic run. Historical manual keyboard/touch proof remains historical; no new FAILED is justified. |

Neither is a blind held-out. **D2 prospective held-out: NOT_RUN_STOP_GATE,
0 examples, no success/failure denominators available.** Freezing the existing
checker for diagnostics does not turn previously known games into held-out data.
No four-game prospective corpus is created after a decision to stop development.

### STOP-GATE rationale and comparison

The majority threshold is exceeded by the14/14 **current reference proof
recipes** that depend on supplied game-specific semantics/paths. This is not
14 proofs that the underlying DOM information is inherently inaccessible. The
immediate reason remains NOT_ATTEMPTED; no universal semantic recovery method
has been demonstrated. Some extra generic actions are feasible and the HUDs can
be read cheaply, but that does not establish that a goal, collision, loss or
reset rule held. Pixel movement, a literal won string, or self-reported score
alone cannot justify the requested gameplay VERIFIED.

Transferring these exact oracle trajectories/field assertions would tune the
checker to15 known examples. Making #hud/state fields mandatory would change
the Full HTML contract. A new visual/planning system has no demonstrated
practical advantage here. The existing optional rules-aware Orchestrator probe
also needs explicit rules, marked HUD/controls, sequences or a calibrated visual
adapter; it is not automatically applicable to arbitrary Full HTML. Consequently
there is no demonstrated universal, minimal correction of this checker that
meets5/5 semantic verification honestly. **Stop before Stage B.** This is a
feasibility/no-go decision under the task's evidence/scope constraints, not a
theorem that black-box testing can never be useful or that every case is impossible.

The following comparison uses the requirements recorded in
[project brief](project-brief.md) and [case acceptance matrix](demo-readiness.md):
natural-language creation, actual original LLM game code, a complete playable
loop, autonomous HTML5/JS/WebView, mobile controls and preserved versions/exports.
The protected official PDF is not reopened; this is an engineering comparison,
not a new independent legal/organizer acceptance of the competition rules.
Costs below are relative engineering/operational judgments, not measured budgets.

| Approach | Engineering / ongoing cost | Reliability and honest boundary | Full HTML compatibility | Fit to recorded Beeline requirements |
| --- | --- | --- | --- | --- |
| Generic black-box validation | Existing technical gate is cheap; general rule understanding/input planning across arbitrary games is substantial, unmeasured work. | Good at observed runtime/security faults. Bounded exploration may add evidence, but cannot infer impossibility or certify arbitrary goals; unknowns remain. | Highest: existing arbitrary self-contained HTML unchanged. Canvas-only semantics are challenging. | Preserves model-authored code and export. Current technical gate alone does not establish a complete playable loop. |
| Voluntary observability contract | Moderate initial protocol/validator/adapter work plus per-game integration and independent corroboration. Not implemented or measured. | Explicit goals, progress, controls and outcomes make targeted proof easier. Self-reported state can lie or be wrong; contract compliance alone is not gameplay proof. | HTML remains full/self-contained if hooks are optional/offline. Legacy and opt-out games retain NOT_VERIFIED; must not silently impose a core requirement. | Can support generated original mechanics, mobile/export/history. Any prompt/contract integration needs a separate decision and task. |
| GameBlueprint plus checked runtime | High schema/runtime/semantic/compiler/coverage work; existing experiment remains ITERATE, advantage unproven. | Shared tested mechanics reduce repeated implementation bugs, but wrong/unreachable game configurations or generated extensions still need checks. No automatic universal guarantee. | Changes generator output contract; compiled HTML may export, but adoption/edits/freedom/novel modules must be proven. Production migration is prohibited here. | Risk if it becomes template selection instead of model-written original mechanics. Earlier experiment does not establish case acceptance or quality advantage. |
| Bounded manual MVP acceptance | Low new platform engineering; recurring human scenario design/execution cost for each accepted version. Not scalable universal automation. | Concrete keyboard/touch progress, win/loss and restart can be independently observed and recorded; untested mechanics/devices remain unverified. Scope and reviewer errors must be explicit. | Fully preserves current Full HTML, immutable versions and offline export. | Best immediate compatibility with demonstrating an actually generated playable artifact. Authored examples cannot replace failed LIVE generation; no physical-device PASS without device checks. |

No option is adopted automatically. For the MVP, an explicitly limited manual
acceptance process is compatible with the already observed proof style; an
optional observability experiment could be evaluated separately. That judgment
does not authorize a contract, prompts, runtime migration or additional inference.

### Revision checks, publication and next gate

Fresh in MICRO-028.1: source/fixture fingerprint consistency,15 production browser
diagnostic runs plus2 real regression checks, recorded actions/traces, checkpoint
capture matching, full relevant source-path inspection, documentation/diff review
and publication secret scan. Only documentation is eligible for commit. Private
helpers, source copies, snapshots, traces and user PDF are excluded.

Full typecheck/build/unit/browser suite and actual launcher UI smoke from MICRO-028
remain **historical**; Stage E was not rerun after STOP_GATE because no code changed
and it cannot resolve the semantic feasibility barrier. No new UI PASS, new
generated-game improvement, new physical-device result or held-out PASS is claimed.
User SQLite, saved versions, checkpoints, env/secrets and original HTML are not
written. New LLM POST remains0. Draft PR34 must stay Draft; merge is prohibited.
Final revision commit/head is recorded in the PR and private revision Git receipt.
Main/origin-main remain separately verified at publication.

**NEXT:** make an explicit acceptance-architecture decision from the four options
before further checker implementation; define a bounded proof scope and a
prospective evaluation protocol. Do not implement oracle-specific heuristics or
an observability contract inside this revision.
