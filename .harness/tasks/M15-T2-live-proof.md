TASK

Routing: **Mid tier** (`sonnet`). Named reason: **not easily verified**. A live proof is its
own oracle — a proof that asserts the wrong thing passes falsely, and this one is the sole
evidence for two acceptance criteria. It also restarts a service the user's phone depends
on. Not Top: nothing here is architectural or ambiguous.

Goal:

Create `src/host/m15-proof.ts` and a `proof:m15` script, following this project's
per-milestone live-proof convention, that proves **against the live harness** that a cold
model load no longer kills the SSE stream.

Background — READ IT, DO NOT RE-DERIVE IT:

`/Users/ryankenny/Projects/phoneToLocalModel/.harness/requirements.md` lines 283-303,
`### The cold-load failure — diagnosed 2026-09-02`. In one line: the harness's `Bun.serve`
set no `idleTimeout`, so Bun's ~10s default closed the SSE connection mid-generation during
a cold model load (observed cutoffs 12.004s and 20.009s); through Tailscale Serve that
became an HTTP 502 the PWA surfaced as "Unexpected harness error (http_502)", while the
generation completed normally server-side.

**That root cause is already fixed**, in the other repository, by task M15-T1: the working
tree of `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` now sets
`idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS` (255) on the API's `Bun.serve`, and exposes the
value on the handle `startApiSurface` returns. **The currently running harness process was
started on 28 Aug and is running the OLD code.** Your proof must restart it so the running
service is the fixed code. Do not change anything in the harness repository.

Relevant Requirements:

- FR11 (`requirements.md` lines 101-108) — explicit `idleTimeout` of 255s, below the 300s
  generation wall-clock budget so the generation timeout stays the governing limit.
- **AC13** (lines 159-160) — "With `idleTimeout` set, the request that previously died at
  12s delivers `content` and `complete` **in-band**, on the original connection, without
  resuming."
- **AC12** (lines 157-158) — "With a **cold** load of `reasoning-deep` forced
  deterministically, a prompt sent from the client completes with its output rendered and
  **no error surfaced**."
- `ollama stop` is explicitly permitted inside proofs to force a deterministic cold start
  (`requirements.md` line 327).

Acceptance Criteria:

1. **`src/host/m15-proof.ts` exists and `package.json` gains `"proof:m15": "bun run
   src/host/m15-proof.ts"`**, in the same style as the existing `proof:m13` entry. The proof
   prints a phase-by-phase log and exits **0 only if every phase passed**, non-zero
   otherwise, exactly like `src/host/m13-proof.ts` and `src/host/m7-proof.ts`.

2. **Phase RESTART.** The proof restarts the live harness so the running service is the
   fixed code, and refuses to continue if it cannot:
   - Find the running processes: `pgrep -f "harness/api/cli.ts"` and `pgrep -f "serve:p1"`.
   - Record their start times before killing, and print them.
   - `SIGTERM` them (the CLI installs a SIGTERM handler that stops the surface cleanly),
     wait for the pids to disappear, escalating to `SIGKILL` only after ~10s.
   - Start a replacement, detached, from `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`:
     `bun run harness/api/cli.ts`, stdout+stderr to a log file under the system temp dir
     whose path the proof prints. Use `Bun.spawn` with `stdio` to that file and
     `unref()`/detached semantics so the proof's own exit does not kill it.
     **No `OPENWEIGHT_HARNESS_*` environment overrides** — the process you are replacing had
     none, so the defaults must be preserved (verified: it binds `127.0.0.1:7787`, which
     `tailscale serve` proxies to `https://ryans-mac-studio.tailc3648a.ts.net/`).
   - Poll `GET {baseUrl}/v1/profiles` with the bearer token until it returns 200, up to 60s,
     where `baseUrl` comes from `resolveBaseUrl()` in `src/host/config.ts` (the tailnet URL,
     so this also proves the Tailscale Serve path is back up). Print the elapsed time.
   - **If the replacement does not come up, the proof must fail loudly and say so
     prominently** — the user's phone depends on this service.
   - Print the new pid, so a human can confirm it differs from the old one.

3. **Phase READBACK — the 255 is real on a running server.** `Bun.Server` exposes no
   `idleTimeout` getter, so the value is read off a genuinely started surface handle. Run
   the harness repository's own test as a subprocess and require exit 0:
   `bun test harness/api/idle-timeout.test.ts` with cwd
   `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`. That test starts a real
   `Bun.serve` surface on an ephemeral port and asserts the started handle reports
   `idleTimeout === 255`. Print its exit status and its output. **Also** print the
   `idleTimeout:` line the proof reads out of
   `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/server.ts`, clearly
   labelled as the source read, so a reader can see both.

4. **Phase COLD — force a deterministic cold load.** Run `ollama ps`; for every model listed,
   run `ollama stop <name>`; re-run `ollama ps` and require it lists no model. Print all
   three outputs. Do **not** hardcode a model name — read them from `ollama ps`. If nothing
   was loaded, that is already cold; say so and continue.

5. **Phase AC13 — in-band delivery across a >10s idle gap.** Using the real API client
   against the live tailnet base URL and the real token:
   - Discover profiles at runtime via the client's `listProfiles()`. Select the deep tier as
     **the profile whose `latency_class` is `"batch"`**. If there is not exactly one such
     profile, fail the phase with a clear message. **Never write a profile id literal
     anywhere in this file** — `test/no-hardcoded-profile-ids.test.ts` scans `src/` and will
     fail the build if you do.
   - Send one short prompt on that profile and consume the stream, **timestamping every SSE
     event as it arrives** and recording each event's type and `seq`.
   - Assert, and print the measured numbers:
     a. a `content` event and a `complete` event both arrived;
     b. the **largest idle gap** — the longest interval between consecutive received events,
        counting the interval from request start to the first event — is **greater than
        10.0 seconds**. This is the criterion's whole point: it is the gap that used to kill
        the connection. If the largest gap is under 10s the model loaded too fast for the
        run to be evidence; **fail the phase and say exactly that**, rather than passing on
        a run that proved nothing;
     c. **in-band, without resuming**: exactly ONE request to a `.../generate` path was made,
        and NO request to a resume/events endpoint was made. Prove this by wrapping `fetch`
        with a recorder (see `src/host/m13-proof.ts` lines 55-80 for the established pattern
        of recording requests) and printing every request URL the phase issued. Asserting
        that `resumeIfInterrupted` was not called is **not** sufficient evidence on its own —
        the request log is.
   - Print the total elapsed wall-clock for the generation.

6. **Phase AC12 — cold load, output rendered, no error surfaced.** Force cold again (repeat
   phase 4's procedure — the previous phase left the model warm, so a second run without
   this would prove nothing), then drive a prompt **through the UI**, in the style of
   `src/host/m13-proof.ts`: `happy-dom`'s `Window`, `createDomTarget`, `mount`, with the real
   `createApiClient`, `createConversationStore` and `createSessionCoordinator`. Assert:
   - the assistant's answer text is **present in the rendered DOM** (query the mounted DOM
     and print the text found — not merely that the store holds it);
   - **no error is surfaced**: the view's generation state is not `{ kind: "error" }` and not
     `{ kind: "offline" }`, and the notice area is empty. `GenerationDisplay`'s variants are
     in `web/src/ui/view-model.ts` lines 12-20; `UiState.notice` is at line 43. Print the
     final generation state and the notice value.
   - the string `http_502` appears nowhere in the rendered DOM or in any surfaced message.
   - Print the wall-clock elapsed and the largest idle gap for this run too.

7. The proof ends by printing a single unambiguous final line — `M15 LIVE PROOF: PASS` or
   `M15 LIVE PROOF: FAIL` — matching the convention in the other proofs, and exits 0/1
   accordingly.

Relevant Files:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m13-proof.ts` — the newest proof, and
  the model for the happy-dom/UI-driven phase and the fetch recorder. Read it.
- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m7-proof.ts` — the model for the
  phase-log/exit-code convention and runtime profile discovery.
- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/config.ts` — `resolveBaseUrl()`,
  `readToken()`.
- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/api-client.ts`,
  `web/src/session-coordinator.ts`, `web/src/conversation-store.ts`,
  `web/src/storage-port.ts`, `web/src/sse-reader.ts`, `web/src/ui/view-model.ts`,
  `web/src/ui/dom-target.ts`, `web/src/ui/mount.ts` — the client stack. Read only.
- `/Users/ryankenny/Projects/phoneToLocalModel/package.json` — add the script.

Files Allowed To Change:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m15-proof.ts` (new)
- `/Users/ryankenny/Projects/phoneToLocalModel/package.json` (the one new script line only)

Constraints:

- **Change nothing in `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`.** You read it
  and you restart its process; you do not edit it.
- **Do not implement any client-side recovery, retry, backoff, reconnect, resume-on-drop, or
  "reconnecting" UI state, and do not touch `web/src/` at all.** That is a *different*
  milestone's work, and a later acceptance criterion is proven by reverting the harness fix
  and showing the client still recovers **on its own**. If any part of that recovery leaks
  into this milestone, that criterion stops being falsifiable. This is the single most
  important constraint in this packet.
- Do not weaken, skip or edit any existing test.
- Do not add a dependency. `happy-dom` is already used by `m13-proof.ts`.
- Never write the literal text of a profile id in `src/` (see criterion 5).
- Do not run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or
  `git clean`. Both working trees carry uncommitted work.
- Do not commit.
- Leave the live harness **running and healthy** whatever happens — wrap the phases so a
  thrown error still leaves a serving process behind, and say in your return what state you
  left it in.

Tests:

Bun 1.4.0 is at `~/.bun/bin/bun`, **not on PATH in non-interactive shells**; Node is not
installed. `export PATH="$HOME/.bun/bin:$PATH"`.

From `/Users/ryankenny/Projects/phoneToLocalModel`, report each with its exit status:

    bun run proof:m15
    bun test test/no-hardcoded-profile-ids.test.ts

`bun run proof:m15` is the real validation and it is expected to take **several minutes**
(two cold loads of a large model). Set a generous timeout; do not abandon it early and do
not weaken an assertion to make it finish.

`test/build.test.ts` deletes `web/dist` in its `afterEach`, so if you run the full `bun test`
suite, run `bun run scripts/build.ts` afterwards to restore the served bundle.

Return:
- Summary
- Files changed
- Tests run (each command + exit status)
- The **full phase-by-phase output** of the `proof:m15` run, including the measured largest
  idle gap and elapsed times for both generation phases
- Test result
- What state the live harness was left in (pid, and the result of a `GET /v1/profiles`)
- Unresolved issues
