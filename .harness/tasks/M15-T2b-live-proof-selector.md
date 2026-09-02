TASK

Routing: **Mid tier** (`sonnet`). Named reason: **not easily verified** — a live proof is its
own oracle and is the sole evidence for two acceptance criteria.

Previous Attempt(s):

- Attempt 1 (Mid, packet `.harness/tasks/M15-T2-live-proof.md`): the proof file
  `src/host/m15-proof.ts` and the `proof:m15` script were built and are **good work that
  stays**. Phases RESTART, READBACK and COLD all passed live against the real harness. The
  run failed only at the tier selector: the packet said "select the deep tier as the profile
  whose `latency_class` is `batch`", and the live catalogue has **two** batch profiles —
  `Balanced reasoning` and `Deep reasoning` (the harness registry gives both
  `latency_class: "batch"` and `quality: "capable"`). The worker correctly refused to invent
  a different discriminator and failed the phase, as that packet instructed. **The defect was
  in the packet, not in the implementation.** Do not rewrite the file; change the selector
  and the phase structure as described below and keep everything else.
- The live harness is already restarted and healthy on the fixed code (pid was 18425 at the
  end of that attempt; re-derive it, do not trust the number). PHASE RESTART is idempotent
  and should simply run again.

Goal:

Replace the "exactly one `batch` profile" selector in `src/host/m15-proof.ts` with a
**measurement-based** identification of the tier that used to fail, and let phases AC13 and
AC12 actually run a real cold generation.

Why measurement rather than a name: the acceptance criteria name `reasoning-deep`, but
`test/no-hardcoded-profile-ids.test.ts` forbids that literal anywhere under `src/`, and no
API-exposed field distinguishes the two batch profiles. The property the criteria actually
turn on is *"the request that previously died at 12s"* — i.e. the tier whose **cold load
leaves the stream idle for longer than Bun's old ~10s default**. Identifying it by measuring
that gap is both name-free and a stricter reading of the criterion than any name match would
be.

Acceptance Criteria:

1. **PHASE AC13 becomes a sweep over the batch-class profiles.** Candidates are every
   profile with `latency_class === "batch"`, discovered at runtime (there are currently two;
   the code must not assume a count). For **each** candidate, in order:
   - force a cold load first, reusing the existing COLD helper (`ollama ps`, `ollama stop`
     every listed model, re-check) — **every** candidate gets its own cold start, because the
     previous candidate leaves a model resident;
   - send one short prompt on that profile through the real API client against the live
     tailnet base URL, timestamping every SSE event;
   - record and print, per candidate: its `id`, its `label`, every event type received in
     order, the total elapsed wall-clock, and the **largest idle gap** (the longest interval
     between consecutive received events, counting request-start → first event).

2. **PHASE AC13 passes only if all of the following hold:**
   a. every candidate delivered both a `content` event and a `complete` event;
   b. **at least one** candidate's largest idle gap is **greater than 10.0 seconds** — that
      candidate *is* the tier that previously died, identified by measurement, and the proof
      must print its `id` and `label` explicitly and prominently so a human can confirm which
      tier it was;
   c. **in-band, without resuming**, for every candidate: exactly ONE request to a
      `.../generate` path per candidate, and NO request to a resume/events endpoint at any
      point. Keep the existing `fetch` recorder and print every request URL issued.
   If no candidate exceeds a 10.0s gap, **FAIL the phase** with a message saying the models
   loaded too fast for the run to be evidence. Do not soften that into a pass, and do not
   lower the 10.0s threshold.

3. **PHASE AC12 runs on the tier AC13 identified.** Carry the winning profile forward as a
   value — never as a written-out id. Force cold again (its own cold start), then drive one
   prompt **through the UI** exactly as the existing AC12 phase already does (happy-dom
   `Window`, `createDomTarget`, `mount`, real client/store/coordinator), and keep the
   existing assertions: assistant text present in the **rendered DOM** (print the text
   found), generation state is neither `error` nor `offline`, notice empty, `http_502`
   absent from the DOM and from any surfaced message. Also print this run's elapsed time and
   largest idle gap. If AC13 failed and there is therefore no identified tier, AC12 must fail
   with a message saying so rather than silently picking something.

4. **Nothing else in `src/host/m15-proof.ts` changes in substance.** RESTART, READBACK and
   COLD keep their current behaviour and assertions. Do not weaken any assertion already
   present.

5. `bun test test/no-hardcoded-profile-ids.test.ts` still passes: no profile id literal
   anywhere under `src/`. Matching on `label` text is **also** not acceptable as the
   selector — the selector is the measured gap. Printing the label as evidence is fine and
   required.

Relevant Files:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m15-proof.ts` — read it in full
  first; it is your own prior attempt's output and it is mostly right.
- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m13-proof.ts` — the UI-driving and
  request-recording conventions.
- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/view-model.ts` —
  `GenerationDisplay` variants at lines 12-20, `UiState.notice` at line 43.

Files Allowed To Change:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m15-proof.ts`

Constraints:

- **Change nothing in `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`.** You read it
  and restart its process; you do not edit it. In particular, do **not** change the profile
  registry to make the tiers distinguishable — the v1 contract is frozen for this milestone.
- **Do not implement any client-side recovery, retry, backoff, reconnect, resume-on-drop, or
  "reconnecting" UI state, and do not touch `web/src/` at all.** A later milestone owns the
  client half and proves itself by reverting the harness fix; anything of that kind added
  here destroys its falsifiability. This is the single most important constraint here.
- Do not weaken, skip or edit any existing test.
- Do not add a dependency. Do not commit.
- Do not run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or
  `git clean`.
- Leave the live harness **running and healthy** whatever happens, and say what state you
  left it in.

Tests:

`export PATH="$HOME/.bun/bin:$PATH"` (Bun 1.4.0; Node is not installed).

From `/Users/ryankenny/Projects/phoneToLocalModel`, report each with its exit status:

    bun run proof:m15
    bun test test/no-hardcoded-profile-ids.test.ts

`bun run proof:m15` now performs **three** cold loads of large models and will take many
minutes. Use the maximum Bash timeout. Do not abandon it early and do not weaken an
assertion to make it finish.

Return:
- Summary
- Files changed
- Tests run (each command + exit status)
- The **full phase-by-phase output** of the `proof:m15` run — in particular the per-candidate
  table of id, label, elapsed and largest idle gap, and which profile was identified as the
  tier that previously died
- Test result
- What state the live harness was left in (pid, and the result of a `GET /v1/profiles`)
- Unresolved issues
