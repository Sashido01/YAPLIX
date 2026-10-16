# MICRO-027 — Reliability, diagnostics and delivery

2026-10-17 (Europe/Moscow). Baseline main/origin/main:
`ff1a9524b0958208dae42d15b20dec00dbaa0190` (PR32). ff-only pull was up to date.
Only untracked `docs/Keys_Bilayn.pdf` existed. No MICRO-025 implementation was
found in current source/docs/history; completion is not confirmed.

## Proven findings and changes

- A runtime exception followed by a blocked click was incorrectly replaced by
  `BROWSER_CHECK_INCONCLUSIVE`. A real Chromium regression failed before the fix
  and passes with `JAVASCRIPT_EXCEPTION` retained. Wait for `about:srcdoc` before
  probing; report safe validation phase/profile metadata. No timeout increase.
- OpenRouter worker retry, legacy queued retry and complete-checkpoint recovery
  could generate additional inference requests. Manual selection now has no
  automatic retry/repair, including restart; Continue remains explicit. Ollama
  default and legacy Auto never select OpenRouter. Fault tests cover recovery.
- QR was hidden in the global collapsed connection panel. Completed job cards now
  expose Play / Edit / On phone / Download HTML; the player exposes Edit / On
  phone. Explicit version selection overrides a stale phone dropdown. Existing
  private listener, exact-version capability, expiry, revoke and API exclusion stay.
- Trace IO must not strand a job or block cancellation. Failures set durable
  `diagnosticsUnavailable`, warn with a fixed safe code and return a source-free
  fallback report; completed transactions are not rewritten as generating.
- SSE supports split UTF-8, CRLF, multiline data fields and DONE without remote
  EOF. Truncation/interruption/HTTP errors retain distinct codes and checkpoints.
  Input/output and wire caps are unchanged; source is never silently accepted
  after truncation. Missing closing tags or unexplained trailing text still fail.

## Trace and audit

Job UUID is the durable correlation ID. UTC JSONL lives in ignored
`.local/diagnostics/generation/UUID.jsonl`, with one 128KiB rotation, seven-day
retention and 16MiB directory pruning on initialization/periodic writes. Only
owned trace filenames are pruned; linked/hardlinked files are rejected. Reports
reapply the metadata allowlist/redaction; unavailable metrics are null.

Events cover job creation/resume/terminal state, provider/catalog/prompt,
POST/headers/first byte/stream/error, HTML/short browser/repair and version save.
The wireBytes metric counts decoded SSE HTTP-body bytes, not compressed NIC
traffic. Fields separate request, static validation, browser, saving and total delivery
time, requested and actual model, attempts, HTTP status, limits/usage/finish
reason and byte counts when observed. Error text, prompt, HTML, credentials,
headers and environment contents are excluded. Filesystem failure is explicit.

The job card's Diagnostics → Download report calls owner-authorized
`GET /api/jobs/:id/diagnostics`; cookie-free Telegram uses its existing session
header. The report includes only metadata and a safe durable status snapshot.
Original source remains in private SQLite checkpoints; normal traces contain none.
No jobs were present in the user's default SQLite at audit time, so the exact
historical snake HTML/finish reasons cannot be reconstructed. Existing private
MICRO-023L evidence was read, without repeating its requests.

## LIVE — four POST, no hidden retries

All inference was ticket-guarded; repairs/retries count against the four-request
cap. The ordinary `npm run app -- --no-open` launcher used a separate
`.local/micro027/live/acceptance.sqlite`, with Telegram polling disabled. The
actual frontend bundle was compared byte-for-byte with build/public/ui.js.
No user database, .env, PDF, existing game or Visual Kit was edited.

| POST | Route / result | Evidence |
| --- | --- | --- |
| 1 Full HTML | gemma4:31b, connection timeout | No HTTP response; UND_ERR_CONNECT_TIMEOUT at 10494ms, job LLM_RESPONSE_TIMEOUT; not a format/model verdict |
| 2 Blueprint, same idea | gemma4:31b, HTTP200, 884 output tokens, 2814ms | JSON schema shape accepted, semantic BLUEPRINT_INCOMPATIBLE: topdown/move/collect included an incompatible board with 125 cells for 5x5; no assembly/gameplay claim |
| 3 Full HTML verification | gemma4:31b, HTTP200, stop, 2770 output tokens | Request8836ms, HTML9894 bytes; saved checkpoint revalidated without another POST, exported and played |
| 4 manual OpenRouter | openrouter/free → cohere/north-mini-code:free, HTTP200 | Headers10434ms; job57655ms, LLM_RESPONSE_BODY_TOO_LARGE before completed output; no finish reason/usage/full HTML, no automatic retry |

GET models succeeded separately for both routes. This is not inference proof.
OpenRouter reached the existing 1210000-byte wire cap while streaming; available
trace does not prove whether content, reasoning or framing dominated. Do not
attribute this solely to model quality, claim success from HTTP200, enlarge caps
without evidence, or select the reported upstream model directly.

During this task a source-edit encoding mistake temporarily broke the Russian
Start regex; it was corrected and has a Russian-overlay regression. The original
Full HTML checkpoint then passed the production checker and UI Continue with
zero additional inference POST. The LIVE guard initially denied the server's
LAN GET /phone probe; the guard was corrected to allow that exact read-only probe.
These corrected task/harness errors are not historical product root causes.

## UI / gameplay proof and limits

Actual UI creation/terminal job/Continue/read-trace/open/save/reload/export were
executed against the isolated ordinary server. Keyboard traversal collected all
three apples; HUD3/3, empty item set and visible victory agreed. Restart reset the
score, then real movement into a stone produced loss. No game state was injected.

The decoded QR opened that exact saved version in a separate Chromium context
on the real private-IP listener. Touch-only movement reached victory, loss and
restart; reload reopened the game, export matched saved bytes, revoke closed
access. The exported file also reached victory with touch in offline Chromium
without the backend. Portrait390x844 worked. Landscape844x390 screenshot shows cropped
controls/results in this generated game: landscape playability is NOT_VERIFIED.
No physical Android/iOS, WKWebView or Telegram client PASS is claimed.

The third POST verified Full HTML after the initial failure, so no real edit POST
remained. Synthetic UI E2E separately verifies full-source edit, two immutable
versions, replay/export, exact-version QR and independent touch client at
320/360/390/430, tablet and desktop. It is not real edit/model-quality evidence.

A safe complete checkpoint with BROWSER_CHECK_INCONCLUSIVE can open an explicitly
NOT_VERIFIED opaque preview. It does not become Ready or a saved accepted version.
Critical runtime/security failures and timeouts cannot use this preview endpoint.

## Validation and verdict

Typecheck/build, all units, repository/Python/CI-policy checks, targeted real
Chromium/WebKit and secret scans are required before publication. Execution logs,
source manifests and final counts are in `.local/micro027/`; final Git/merge and
post-merge receipt are recorded there at delivery. The seven obsolete synthetic
production tests now use canonical gemma4:31b routes and a test-process HTTP
redirect, never a production local-route escape hatch or real model call.

Final local gates: typecheck/build PASS; units246/246; Python19/19;
CI-policy8/8; repository conventions and diff checks PASS. Final UI/mobile/
Telegram run28 PASS/21 intentional profile SKIP; production/checker/phone
run28 PASS/8 intentional SKIP. All seven obsolete production scenarios pass
under current canonical routing. Earlier failed test attempts and their repaired
harness causes remain in the private logs, not counted as final PASS.
Gitleaks8.24.3: full history75 commits and explicit27-file manifest, no findings.
Gzip: initial ui.js11441 bytes, CSS2385 bytes; no timing/performance improvement
is claimed. Protected .env/PDF hashes and complete original games/versions/jobs
logical snapshots match baseline. Windows local proof does not establish Ubuntu.

Technical: PASS within tested scope after final local gates. Product: PARTIAL —
a LIVE game was delivered and played after recovery; first-attempt reliability,
real editing and generated landscape behavior remain unproven. OpenRouter:
UNRELIABLE (one current failed inference), optional/experimental/manual only.
Blueprint: ITERATE; schema compatibility and gameplay are not production-ready.
One paired idea is a preliminary observation, not a statistical comparison.

Actions remain disabled under MICRO-019; no enable/dispatch, workflow or permission
changes. Baseline79 runs/latest38877566527; final authoritative state/count are
checked at publication. Normal risk policy remains FULL; local exception is not
hosted Windows/Ubuntu PASS and is not release authorization. No public release.

NEXT: separately authorize real edit and repeatability testing; improve the
Blueprint prompt/semantic contract in research; investigate OpenRouter wire
composition from newly instrumented bounded metadata; verify physical phones
and fix generated landscape with a separately authorized repair budget.
