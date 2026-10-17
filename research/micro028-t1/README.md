# MICRO-028.2 isolated experiment

No production imports this directory. No inference, API, jobs, database writes,
prompt changes or universal T2. Same-author controls are not an independent blind
sample. `oracle.json` is for the separate evaluator only, never the probe.

Order: Stage 0 audit -> prepare six controls -> hash/oracle/seed commit -> develop
only on DEV -> freeze probe commit -> verify hashes -> ONE held-out campaign.
Changing the probe after inspecting held-out results invalidates that holdout.

Predeclared limits per execution arm: 20 seconds wall time, 30 seconds simulated
time, 100 user actions, 12 snapshots, 256 KiB JSON diagnostics, 2 MiB screenshots,
8 MiB optional browser trace (oversize artifact discarded and recorded).
Actual plan: 6 seconds observation, twelve generic interventions, three seeds
17/101/991, two repetitions, independent A/B contexts, 390x844 touch Chromium.
Restart adds at most 0.8 simulated seconds and two actions. No hidden state reads
or assignments. Numeric text is an observation, never a score/win certificate.

All private game copies and evidence belong in `.local/micro028-t1/`.
Held-out files are authored controls and immutable after the control commit.

## MICRO-028.3 owner recorder

Current procedure and two real pilot IDs: [T2 pilot](../../docs/micro-028-t2-pilot.md).
The historical T1 NO_GO and frozen controls remain unchanged. Run `manual.mjs`
with an actual ID from private `manual-plan.json`; no inference or repairs occur.
Play in the visible game window; answer in the terminal after each phase.
PASS/FAIL/VERIFIED text is only HUMAN_REPORTED. Empty/UNKNOWN stays NOT_VERIFIED.
Do not enter secrets in notes or the game. Ctrl+C, EOF and the 15-minute deadline
save partial results. A terminal result prints the exact session directory.

`recorder.mjs` attaches a Chromium CDP isolated world to the actual opaque frame,
after load and before the owner prompt. Passive observers capture trusted physical
game keys (arrows, WASD, Space, Enter, Escape, R), pointer down/up/cancel and held
pointer moves at most 20/s, including touch pointer events. It stores no `key`
characters, field values, clipboard, target text, DOM snapshots or outside-area
coordinates. DOM input/textarea/select/contenteditable are excluded and masked
in screenshots. Only that frame gets the observer/binding; the game world cannot
invoke it. Native RNG, game timers and original HTML bytes remain unchanged.
Receipt times are monotonic Node time relative to session creation, not an exact
hardware clock. The recorder observes input; it does not certify its game effect.

Budget: 12,000 journal entries / 2 MiB, 15 minutes, eight phase screenshots plus
one best-effort failure screenshot, finalized trace at most 32 MiB. Deliberately
sampled held-pointer moves are not a lossless trajectory. Focus loss with held
input, leaving the viewport with an active pointer, overflow, interruption or
unexpected navigation marks EVENT_LOG_INCOMPLETE. Native gestures outside this
allowlist and physical-device acceptance are unsupported.

Each session has a UUID directory, fsync JSONL input journal and atomic fsync JSON
checkpoints. Force-kill/power-loss can lose the last in-flight event or leave a
torn final JSONL line: preserve the valid prefix and `.tmp` file; never infer
COMPLETED from them. The last manifest retains EVENT_LOG_INCOMPLETE and an explicit
unfinished status; its eventCount can lag the journal after a crash. A finalized
Playwright trace records API operations, not native-human replay. Snapshots and
automatic trace screenshots are disabled; the recorder never types human text
through Playwright APIs. Synthetic privacy tests use native-style CDP text input
and inspect all finalized ZIP members for the test sentinel.

Export writes byte-exact `export.html`, checks SHA-256, then reads that copy into
a new offline allow-scripts opaque iframe with the unchanged GAME_CSP and runtime
UUID compatibility prelude. No file URL is opened. This is explicitly not native
file-export acceptance: NATIVE_FILE_EXPORT_NOT_VERIFIED always remains.

The bounded `replay(session, events, {complete, check})` research API is exercised
in `recorder.test.mjs`. Pass `complete` only for a COMPLETE_BOUNDED_INPUT_LOG;
`check` must compare separately established visible evidence. The entire stream
is validated before dispatch. Only a single document with supported mouse/keys
and viewport events is replayed. Touch/pen, native key repeat, incomplete/gap logs,
multiple document loads and invalid events return REPLAY_UNSUPPORTED. Native RNG
or timing can diverge: no match/no comparison is REPLAY_NOT_REPRODUCED, never an
edited action stream or gameplay PASS. Real pilot replay has not been performed.

Focused synthetic checks (existing Node runner and installed Chromium/Python,
no new dependencies): `node --test research/micro028-t1/recorder.test.mjs`.
Outputs labelled SYNTHETIC live separately in `human/synthetic-tests/`; they never
populate owner acceptance directories or modify the private plan.
