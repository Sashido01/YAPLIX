# YAPLIX workflow

Work only in this repository. Preserve user data, secrets, dirty changes and history.
Before a task, inspect status, sync main with `git pull --ff-only`, then create a
short-lived `codex/` feature branch. Never start from an obsolete feature branch.

Deliver a complete user scenario, tests, build, security checks and current docs.
Stage explicit reviewed files, commit, push the feature branch and create a PR
targeting main. Wait for successful Windows, Ubuntu and secret-scan checks for
the current head; fix failures and repeat. Review the diff and conflicts.

The owner authorizes autonomous standard PR merge for ordinary internal work
after those checks. Do not wait for a teammate's review unless GitHub protection
requires it. Never force-push, bypass protection, disable CI or change permissions.
Use an allowed merge method, preferring a merge commit to preserve commits.
If merge fails, check authoritative PR state before any further action.

A task is complete only after merge, ff-only update of local main, verification
of the actual merge SHA and critical post-merge smoke tests. Delete a temporary
local/remote branch only when fully merged and unused by other worktrees.

MVP must run from a clean clone: clear Windows/Ubuntu setup, key-free labelled
DEMO, available real LLM path, playable sandbox, persistence/restart, versions,
offline HTML export, diagnostics, backup and update instructions. Published
BGen components may be reused; do not alter participants' external repositories.
Implement the minimal UI here when no integrated UI exists.

Report MAIN, MERGED, RUN, VERIFIED, MVP, LIVE, DOCS and NEXT. Synthetic tests,
source audits, real LLM calls and physical devices have different proof boundaries.
