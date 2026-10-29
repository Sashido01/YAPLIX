# YAPLIX workflow

## Current owner rule: local-only Git until separately authorized

For current local work, preserve the checked-out branch, HEAD, staged state and
all dirty files. Local commits of reviewed, complete and verified changes are
allowed. **Do not run fetch, pull, push, PR, merge, remote ref changes or GitHub
Actions unless the owner explicitly authorizes those remote operations for the
current task.** This rule overrides older generic pull/branch/publish instructions
below. Do not switch branches or clean/stash/reset the tree to make a task easier.

## Repository map and Ubuntu handoff

One Node 24.18+ (24.x) process serves Hono, SQLite and the browser client.
`src/server.ts` starts it; `src/api.ts` owns HTTP routes, `src/store.ts` persistence,
`src/jobs.ts` durable generation, `src/live.ts`/`src/transport.ts` provider calls,
and `src/browser-check.ts`/`src/canvas-check.ts` validation. `src/runtime.ts`
mounts opaque game iframes. Arena in this branch is in `src/arena*.ts`.
`scripts/build.mjs` bundles the client; `assets/` holds the application UI; synthetic games belong under `tests/fixtures/`.

Read [current context](docs/PROJECT_CONTEXT.md), [Ubuntu setup](docs/UBUNTU_SETUP.md)
and [shared development commands](docs/development-setup.md) before assuming a
historical report describes the current branch. GameDNA is a future concept.
Use lockfile `npm ci`, `npm run typecheck`, `npm run build`, `npm test`,
`npm run test:browser`, Python repository checks and `git diff --check`.
There is no separate lint script. Keep UTF-8/LF and exact filename case;
reinstall dependencies and browser binaries on each OS instead of sharing caches.

YAPLIX-UBUNTU-001 owner exception: preserve the current branch and HEAD; no pull,
branch switching, commits, push, PR, merge or Actions. Audit GitHub through an
independent clone under `.local/ubuntu-prep/`; all evidence stays in this repo.
This task's explicit restrictions override the publication workflow below.
Existing Windows worktrees and staged integration work must not be pruned.

Work only in this repository. Preserve user data, secrets, dirty changes and history.
Before investigating recurring errors, read [known solutions](docs/known-errors.md),
then verify that the current code and evidence still support the proposed fix.
Update that compact repository guide with observed failures and verified remedies;
do not treat an unverified network hypothesis or synthetic test as external proof.
For a task without separate publication authorization, inspect status and work
on the existing checkout; preserve its branch and HEAD. Create another branch
only when explicitly requested and after confirming the target state.

Deliver a complete user scenario, tests, build, security checks and current docs.
Stage explicit reviewed files and create local commits only for completed changes.
Remote publication requires separate owner authorization for the current task.
When authorized, wait for successful Windows, Ubuntu and secret-scan checks for
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

MVP must run from a clean clone: clear Windows/Ubuntu setup, no DEMO games or
routes, available real LLM path, playable sandbox, persistence/restart, versions,
offline HTML export, diagnostics, backup and update instructions. The generator
and prompts are independently authored here. Do not fetch/read/use BGen or its
old local checkout, templates, assets or docs as a reference. Do not modify external
repositories. Preserve unknown ignored files. Cloud is primary; OpenRouter is
FREE ONLY. MICRO-019 supersedes TASK-010 model selection: production LIVE routes
are only gemma4:31b at https://ollama.com/v1 with an explicit server credential,
and openrouter/free at exactly https://openrouter.ai/api/v1. No concrete :free
selection, generic provider, local route, paid or hidden fallback. MICRO-023: UI providers are ollama-cloud (default) and openrouter (manual only).
MICRO-029 Stage A1 owner exception: `chatgpt` is an additional manual-only
local/loopback route to `https://api.openai.com/v1/responses`, pinned
`gpt-6.1-sol`, reasoning medium, store false, stream true. In-memory personal
server OAuth only; no LAN/HTTPS/Telegram access, automatic refresh or token
persistence. Auto never selects ChatGPT. A durable job may use one initial POST
plus at most three sequential repair POSTs to the same pinned route/model when
its persisted repair budget permits. Unknown POST outcomes are never replayed;
network and infrastructure errors do not consume repair budget. This exception
does not authorize automatic refresh or token persistence. See
[ChatGPT setup](docs/chatgpt-setup.md).
Legacy auto aliases Ollama Cloud and never falls back to OpenRouter. This applies
to creation, editing, continuation and authorized repair. Full HTML is the core
contract; preserve current full source on edits, older versions and validator/CSP.
Optional telemetry, visual kits and genre-specific state are not core requirements.
Never launch real inference/repair without the owner's explicit request budget. Legacy model/fallback/local knobs cannot authorize routes. Production durable jobs persist a total POST budget capped at four, with at most three repairs. OpenRouter remains manual/free-only and auto-repair stays disabled because `openrouter/free` does not pin the actual upstream model. Never replay a provider request with an unknown outcome.
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

YAPLIX-INSTALL-001: desktop packaging is local-only in `.local/install-001/`.
Keep branch/HEAD and dirty work; no commits/push/PR/merge/Actions/releases.
Use `scripts/desktop.mjs` with bundled Node for installed builds, and keep
`YAPLIX_DATA_HOME` outside application files. See `INSTALL.md` and
`docs/installer-building.md`; extracted-payload tests do not prove graphical
installation or Windows support. Never bundle .env, user databases or keys.

YAPLIX-INSTALL-002 supersedes system installation: per-user/portable only.
Never install/upgrade OS packages or modify system libraries, firewall, AppArmor,
global Node/settings, or existing external programs. No administrator requirement.
Lite delivery uses only the explicit supported Chrome channel after protected
verification; full delivery keeps Chromium/libraries isolated. Never disable
sandbox or change browser after a failed validator. Test only isolated data.
