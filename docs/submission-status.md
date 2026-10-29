# Submission status — 29 October 2026

**STATUS: PARTIAL / NOT_READY.** The local code and browser suites pass after a
bounded Canvas-input probe correction. Real generation acceptance remains
0/5 durable jobs; two of five saved outputs still have confirmed layout faults.
No release branch, Draft PR, push, or merge was prepared.

## Evidence

- PASS: `npm run typecheck` and `npm run build` on the isolated verification copy.
- PASS: unit suite, 578/578.
- PASS: full browser matrix, 638 passed, 2,218 conditional skips, 0 failed,
  25.9 minutes. It covered Chromium, Firefox, and WebKit profiles plus the
  configured 320/360/390/430 px and tablet layouts.
- PASS: `scripts/check_repo.py` against a temporary index mirroring the current
  worktree (the personal `docs/Keys_Bilayn.pdf` was excluded); Python repository
  tests, 20/20.
- PASS: Gitleaks 8.30.1 content scan of the isolated source copy; no leaks in
  about 2.98 MB. This did not scan Git history or a final publishable diff.
- LIMITATION: the aggregate `npm run check:full` in the nested copy stopped at
  repository checks because `git ls-files` resolved to the parent checkout.
  The repository checks then passed against the real source tree with a
  temporary index. The copy's build and browser runs did not overwrite the
  primary checkout's ignored `build/`.

## Generation sample

Five Ollama Cloud `gemma4:31b` jobs (Snake, space arcade, puzzle, racing,
reaction) used 9 POSTs and 4 repairs. Durable completion and first-pass
acceptance were both 0/5. Replaying the exact saved HTML through the adjusted
technical checker produced 3/5 technical PASS and 2/5 hard layout failures:
Snake Canvas layout at 844×390 and confirmed Racing text overlap at 844×390.
Gameplay score, rounds, Game Over, Restart, save/export and physical-device
behavior are NOT_VERIFIED for those generated games. The replay does not change
the durable job outcomes.

## Release boundary

The generic browser probe now checks center, y=0.58 and y=0.88, with at most
three taps. It stops before a fourth generic action that could advance unknown
gameplay to a terminal state. The checker still reports only technical HTML and
Canvas evidence; deeper mechanics remain NOT_VERIFIED. Minor clipping of at
most 2 CSS pixels is a warning; larger confirmed clipping and confirmed text
overlap remain hard failures.

The current checkout remains `codex/arena-mvp` at `78492bf`, with pre-existing
dirty work preserved. PR #66 is open and blocked for review/checks (10 files;
the owner had already requested changes); its large UI redesign was not
integrated. PR #67 is open and blocked (five docs/presentation files); its
evidence predates today's full run and was not integrated. The fresh-main
source integration attempt had conflicts. No commit, push, new PR, or merge was
made. Hosted Actions remain disabled under the owner's temporary exception.
Windows native, physical Android/iOS/Telegram, hosted CI and final-main smoke
are NOT_VERIFIED. The personal PDF `docs/Keys_Bilayn.pdf` remains excluded from
publication.

The detailed local evidence report is `.local/yaplix-submission-final-008/REPORT.md`
and is intentionally not part of a public diff.

## 29 October follow-up

**STATUS remains PARTIAL / NOT_READY.** The shared generation contract now
explicitly tells games to reflow or scale at 844×390 and keep labels in separate
regions. Its focused contract test passes. A clean five-genre direct LIVE
`GenerationEngine` re-probe (not durable UI jobs) of Ollama Cloud `gemma4:31b`
used 8 POSTs and 4 bounded repairs; all five final
results were rejected (`BROWSER_CANVAS_UI_OVERLAP` 2, `BROWSER_CANVAS_TEXT_CLIPPED`
1, `BROWSER_CANVAS_ACTIVITY_UNVERIFIED` 2). First-pass technical acceptance was
0/5; repair success was 0/4. Unknown POST outcomes: 0. The event journal and
summary agree for all five attempts. A prior exploratory v2 folder has inconsistent
stream/output evidence and is excluded from these rates.

This confirms the added landscape wording alone did not fix generated-output
quality. The previous five-job sample remains separate: 9 POSTs, 4 repairs,
3/5 technical PASS on replay of saved HTML, with two confirmed layout blockers.
Two exploratory saved HTML files in v2 were exercised in headless Chromium with
a deterministic clock; their association with the v2 generation records is
uncertain, so they are excluded from acceptance claims and are not physical-device
proof. Creation acceptance, gameplay evidence across the full
genre set, SQLite persistence, save/export on the accepted games, hosted CI and
release publication remain NOT_VERIFIED. No Draft PR or merge was created.
