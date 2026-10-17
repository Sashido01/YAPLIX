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
