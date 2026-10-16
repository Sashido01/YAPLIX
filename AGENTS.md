# YAPLIX workflow

Work only in this repository. Preserve user data, secrets, dirty changes and history.
Before investigating recurring errors, read [known solutions](docs/known-errors.md),
then verify that the current code and evidence still support the proposed fix.
Update that compact repository guide with observed failures and verified remedies;
do not treat an unverified network hypothesis or synthetic test as external proof.
Before a task, inspect status, sync main with `git pull --ff-only`, then create a
short-lived `codex/` feature branch. Never start from an obsolete feature branch.

Deliver a complete user scenario, tests, build, security checks and current docs.
Stage explicit reviewed files, commit, push the feature branch and create a PR
targeting main. Wait for successful Windows, Ubuntu and secret-scan checks for
the current head, with the risk-selected FAST/FULL coverage in
[CI economy](docs/ci-economy.md); fix failures and repeat. Before releases run
manual FULL on the exact release commit. Review the diff and conflicts.
MICRO-019 owner exception through 2026-10-29: hosted Actions are temporarily
disabled at repository level; do not wait for unavailable hosted checks or claim
them green. Run local typecheck/build, critical units, short Playwright and secret
scan, with real LLM evidence separately. Restore Actions only on owner instruction
using the recorded procedure in [CI economy](docs/ci-economy.md). FAST/FULL policy
and release FULL requirements remain intact.

The owner authorizes autonomous standard PR merge for ordinary internal work
after those checks. Do not wait for a teammate's review unless GitHub protection
requires it. Never force-push or bypass protection. Do not disable CI or change
permissions outside the explicit temporary MICRO-019 owner exception above.
Use an allowed merge method, preferring a merge commit to preserve commits.
If merge fails, check authoritative PR state before any further action.

A task is complete only after merge, ff-only update of local main, verification
of the actual merge SHA and critical post-merge smoke tests. Delete a temporary
local/remote branch only when fully merged and unused by other worktrees.

MVP must run from a clean clone: clear Windows/Ubuntu setup, key-free labelled
authored offline examples (DEMO fixtures/API only), available real LLM path, playable sandbox, persistence/restart, versions,
offline HTML export, diagnostics, backup and update instructions. The generator
and prompts are independently authored here. Do not fetch/read/use BGen or its
old local checkout, templates, assets or docs as a reference. Do not modify external
repositories. Preserve unknown ignored files. Cloud is primary; OpenRouter is
FREE ONLY. MICRO-019 supersedes TASK-010 model selection: production LIVE routes
are only gemma4:31b at https://ollama.com/v1 with an explicit server credential,
and openrouter/free at exactly https://openrouter.ai/api/v1. No concrete :free
selection, generic provider, local route, paid or hidden fallback. MICRO-023: UI providers are ollama-cloud (default) and openrouter (manual only).
Legacy auto aliases Ollama Cloud and never falls back to OpenRouter. This applies
to creation, editing, continuation and authorized repair. Full HTML is the core
contract; preserve current full source on edits, older versions and validator/CSP.
Optional telemetry, visual kits and genre-specific state are not core requirements.
Never launch real inference/repair without the owner's explicit request budget. Legacy model/fallback/local knobs cannot authorize routes.
Never buy credits or change plans automatically or infer paid entitlement.
Preserve existing jobs, checkpoints, cancellation, idempotency and restart state.
Implement the minimal UI here when no integrated UI exists.

Report MAIN, MERGED, RUN, VERIFIED, MVP, LIVE, DOCS and NEXT. Synthetic tests,
source audits, real LLM calls and physical devices have different proof boundaries.

Mobile First is permanent: Android Chrome/System WebView, iOS Safari/WKWebView
and Telegram clients have priority. Keep the browser client light; Node/SQLite
and LLM run on the server. Test 320/360/390/430 px, tablet and desktop, touch,
rotation, keyboard viewport and safe-area. Do not claim physical device PASS
from browser emulation. Preserve opaque sandbox and session authorization.

Measure a baseline before optimization. Repeat the same cold mobile Slow 4G /
CPU ×4 profile at least seven times; separate shell, API, LLM, game start and
rendering. Gzip budgets: initial JS 150 KB, CSS 30 KB, critical assets 250 KB.
Interactive p75 target 3 s is a reported timing goal on shared CI, not an excuse
to increase budgets. Keep bounded caches/queues; dispose iframe and listeners,
pause animation in background, cancel abandoned generation. Do not guarantee
arbitrary LLM code performance. Default loopback; LAN is explicit, private-IP,
key protected and trusted-network only. Public use requires HTTPS reverse proxy
and protected API. Never change firewall or expose Ollama automatically.
