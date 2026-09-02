# Task M7-T4 — M7 proof: AC9 live, plus contract-decode proof of the rest

Tier: Mid
Reason for tier: **not low risk.** This file is the sole evidence for every one
of M7's acceptance criteria. A proof that asserts the wrong thing, or that
reports PASS off a condition it did not actually induce, produces false evidence
that a reviewer would have to catch. It also drives the **live** harness, where a
generation left running ties up a single-user service.

Milestone: M7 — Documented harness errors are surfaced meaningfully, not generically
Component: C7/C9 exercised end to end (new file `src/host/m7-proof.ts`)

## Context

Read `src/host/m6-proof.ts` **in full** before writing anything. Copy its
structure, its setup, its console-output conventions, its per-phase
`PASS`/`FAIL` reporting, its final per-criterion summary block, and its
`process.exit` discipline. Do not invent a new format.

The live harness is reachable and authenticated via `resolveBaseUrl()` and
`readToken()` from `./config.ts`. It is a **single-user service**: never leave a
generation running, and never issue a request whose only purpose is to degrade
it.

M7's acceptance criteria, verbatim from `.harness/milestones.md`:

1. **AC9** — A second generation on a session that already has one admitted
   returns `409 generation_in_flight`, and this is surfaced to the user. Proven live.
2. (derived: FR9) Each documented HTTP error code — `unauthorized`,
   `invalid_request`, `unknown_session`, `unknown_profile`,
   `generation_in_flight`, `queue_full`, `unknown_generation`,
   `seq_not_available`, `not_found`, `internal_error` — maps to a distinct typed
   error with its own surfaced guidance, with `unauthorized` prompting re-pairing
   and `queue_full` giving retry guidance.
3. (derived: FR9) Each documented SSE error code — `profile_resolution_failed`,
   `inference_failed`, `incomplete_stream`, `session_unavailable`,
   `generation_timed_out`, `stream_write_failed` — is decoded from an `error`
   event into its own typed error and surfaced.
4. (derived: edge cases) An unreachable harness produces a distinct offline state
   that allows retry, and the drafted prompt is not lost; an empty prompt is
   rejected client-side before any request is made.

**What is live and what is from the contract.** `generation_in_flight` is induced
live. `queue_full` and the six SSE codes cannot be induced on demand against a
single-user service without abusing it; they are proven by decoding the payload
shapes the API contract documents, through the real production code path. Every
phase must **say in its own output** which of the two it is. Never print or imply
live proof for a contract-decoded phase.

The taxonomy lives in `web/src/api-client.ts` (`HTTP_ERROR_CODES`,
`STREAM_ERROR_CODES`, `HTTP_ERROR_GUIDANCE`, `STREAM_ERROR_GUIDANCE`,
`httpErrorGuidance`, `streamErrorGuidance`, `HarnessApiError`,
`HarnessStreamError`, `HarnessOfflineError`, `EmptyPromptError`). C9's
`SendResult` now carries `streamError`. **Read both files first** and use what is
there — do not restate the tables in the proof.

## Goal

Write `src/host/m7-proof.ts` with the phases below, and add
`"proof:m7": "bun run src/host/m7-proof.ts"` to `package.json`'s `scripts`,
placed after `proof:m6` and changing nothing else in that file.

### PHASE 0 — discovery (live)

As in `m6-proof.ts`: print base URL, token presence, and the profiles fetched at
runtime. **Never hardcode a profile id.** Prefer a profile whose
`latency_class === "interactive"`, else the first. Fail the whole proof if no
profiles come back.

### PHASE A — AC9, live `409 generation_in_flight`

1. Create a real session via `apiClient.createSession()`.
2. Start generation #1 with `apiClient.generate(sessionId, { profileId, prompt })`
   using a prompt long enough to still be running a moment later — e.g.
   `"Count slowly from 1 to 40, one number per line."`. Capture its
   `generationId`. **Do not consume its event stream yet.**
3. Immediately call `apiClient.generate(sessionId, { ... })` a second time on the
   **same session**.
4. Assert the second call rejects with a `HarnessApiError` where
   `code === "generation_in_flight"` and `status === 409`.
5. Assert the error is **surfaced meaningfully**: print
   `error.guidance.title`, `error.guidance.detail` and `error.guidance.action`,
   and assert `guidance.documented === true`,
   `guidance.action === "wait_for_current"`, and that
   `guidance.detail !== httpErrorGuidance("no_such_code").detail` — i.e. it is
   the code's own message, not the generic fallback.
6. **Clean up, unconditionally.** In a `finally`, cancel generation #1 via
   `apiClient.cancel(sessionId, generationId1)` and print the returned status.
   Then drain or abort its event stream so nothing is left hanging. Phase A must
   not leave a generation in flight even if an assertion fails.

If generation #1 has already finished before step 3 (fast profile, short output),
the 409 will not fire. Handle that honestly: retry the phase at most twice with a
longer prompt, and if it still cannot be induced, print
`PHASE A: INCONCLUSIVE - could not induce a concurrent generation` and **fail**
the proof. Do not report PASS for a condition you did not observe.

### PHASE B — all ten documented HTTP codes, distinct typed errors + guidance (contract-decoded)

Build a **second** `ApiClient` with a stub `fetch` (the `fetch` option of
`createApiClient`) that returns, for each documented code, the documented status
and body `{"api_version":"v1","error":"<code>"}`. Statuses, verbatim:

```
unauthorized 401, invalid_request 400, unknown_session 404, unknown_profile 400,
generation_in_flight 409, queue_full 503, unknown_generation 404,
seq_not_available 409, not_found 404, internal_error 500
```

Drive each through a real client method (`getSession` is fine for all of them —
the point is the decoder, and the packet's own AC6 in M7-T1 already pins
per-method behaviour). For each code print the code, the status, the
`guidance.title`, `guidance.action` and `guidance.retryable`, and assert:

- a `HarnessApiError` was thrown with the expected `code` and `status`;
- `guidance.documented === true`;
- `guidance.code === code`.

Then assert **distinctness across the whole set**: collect the ten `title`s and
the ten `detail`s and assert each collection has ten unique values. Print the
count. Finally assert the two codes FR9 names specifically:
`unauthorized` → `guidance.action === "re_pair"`, and `queue_full` →
`guidance.action === "retry_later"` with `retryable === true`. Print both.

Label this phase's output `contract-decoded, not live`.

Additionally, in this phase, confirm live that `unauthorized` is real and not
only a table entry: with a deliberately invalid bearer token (as
`m6-proof.ts` Phase D does), call `apiClient.listProfiles()` against the **live**
harness and assert it rejects with `HarnessApiError`, `code === "unauthorized"`,
`status === 401`, `guidance.action === "re_pair"`. Print it and label it `live`.

### PHASE C — all six documented SSE codes decoded into typed errors (contract-decoded)

For each of the six codes, build a stub `fetch` returning a `text/event-stream`
response whose body is a real SSE byte stream ending in the documented error
event — e.g.

```
data: {"seq":0,"kind":"content","delta":"partial "}

data: {"seq":1,"kind":"error","error":"<code>"}

```

with an `x-generation-id` response header. Drive it through the **real**
`createSessionCoordinator(...).send(...)` with a real in-memory
`ConversationStore`, so the decode path under test is production code and not a
reimplementation.

For each code assert and print:

- `result.status === "error"`;
- `result.errorCode === code`;
- `result.streamError` is a `HarnessStreamError` with `code === code` and
  `generationId` equal to the stream's generation id;
- `result.streamError.guidance.documented === true` and `guidance.code === code`;
- the `onError` handler received `(code, streamError)` with the same instance.

Then assert the six `title`s are pairwise distinct and the six `detail`s are
pairwise distinct, and print the counts. Also drive one undocumented code
(`"weird_new_code"`) and assert `guidance.documented === false`,
`guidance.action === "report"`, and that its `detail` contains the code.

Label this phase's output `contract-decoded, not live`.

### PHASE D — unreachable harness is a distinct offline state that keeps the draft (live-ish)

Build an `ApiClient` pointed at a genuinely unreachable base URL — use
`http://127.0.0.1:1` (a port nothing listens on), so the failure is a real
`fetch` rejection rather than a stub. Wire it into a real
`SessionCoordinator` with a real conversation carrying at least one existing
turn, then call `send(conversationId, draft)` with
`const draft = "This draft must survive an offline failure."`.

Assert and print:

- the rejection is a `HarnessOfflineError` (`instanceof`);
- `error.draftPrompt === draft` — the drafted prompt is not lost;
- `error.guidance.action === "retry"` and `guidance.retryable === true`;
- the conversation's turns are **unchanged** (same length and same content as
  before the call) — nothing was half-written;
- retry is allowed: swap in a working stub `ApiClient` that completes normally,
  call `send(conversationId, error.draftPrompt!)` again, and assert it resolves
  with `status === "complete"`. Print the recovered text.

Label the unreachable-host part `live (real socket failure)` and the retry part
`stubbed completion`.

### PHASE E — an empty prompt is rejected client-side before any request

Using an `ApiClient` whose request log is cleared first, call `send(id, "")`,
`send(id, "   ")` and `send(id, "\n\t")`. For each assert:

- the rejection is an `EmptyPromptError` (`instanceof`) with
  `guidance.action === "edit_prompt"`;
- `apiClient.getRequestLog()` is **empty** afterwards — no request was made.

Print the log length for each. Also call `apiClient.generate(sessionId, { profileId, prompt: "" })`
directly and assert the same, since C7 rejects independently of C9.

### Final summary

A `=== M7 ACCEPTANCE CRITERIA SUMMARY ===` block, in `m6-proof.ts`'s style, with
one line per M7 acceptance criterion (the four quoted in Context), each reporting
`PASS`/`FAIL` and stating whether it was proven `live` or `contract-decoded`.
Then `M7 LIVE PROOF: PASS` and `process.exit(0)`, or `M7 LIVE PROOF: FAIL` and
`process.exit(1)`. Every phase contributes to `allPassed`.

## Acceptance Criteria

- AC1 — `src/host/m7-proof.ts` exists; `bun run proof:m7` runs it and exits 0.
- AC2 — Phase A induces a real `409 generation_in_flight` against the live
  harness and prints the code, status and the guidance shown to the user. It
  cancels generation #1 in a `finally` and prints the cancel status, leaving
  nothing in flight.
- AC3 — Phase B covers all ten documented HTTP codes, proves per-code guidance,
  proves title and detail distinctness across the ten, and proves
  `unauthorized` → `re_pair` and `queue_full` → `retry_later`/retryable. It also
  proves `unauthorized` live with an invalid token.
- AC4 — Phase C covers all six documented SSE codes through the real
  `SessionCoordinator.send`, proves each becomes its own `HarnessStreamError`
  with its own guidance, proves distinctness across the six, and covers one
  undocumented code.
- AC5 — Phase D proves the offline state is distinct, the draft survives, the
  transcript is untouched, and a retry succeeds.
- AC6 — Phase E proves all three empty-prompt forms are rejected with zero
  requests logged, at both C9 and C7.
- AC7 — Every phase's output states `live` or `contract-decoded`. No
  contract-decoded phase claims or implies live proof.
- AC8 — The proof exits non-zero if any assertion fails. Verify this by
  temporarily breaking one assertion, observing exit 1, then restoring it — and
  report that you did.
- AC9 — Profile ids are discovered at runtime. `grep -n "gpt\|llama\|qwen\|mistral"`
  over your new file returns nothing that looks like a hardcoded profile id.
  There is an existing test (`test/no-hardcoded-profile-ids.test.ts`) that
  enforces this — it must pass.
- AC10 — `bun test` and `bunx tsc --noEmit` both still exit 0.

## Files Allowed To Change

- `src/host/m7-proof.ts` (new)
- `package.json` (add the `proof:m7` script only)

Nothing else. Do **not** modify `web/src/api-client.ts`,
`web/src/session-coordinator.ts`, `web/src/sse-reader.ts`, any file under
`test/`, or anything under `.harness/`. If the proof cannot pass without changing
one of those, **stop and report that** — it is a finding, not something to fix
here.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun run proof:m7
bun test
bunx tsc --noEmit
```

All three must exit 0. Paste the **complete** stdout of `bun run proof:m7` in
your report — it is the milestone's evidence, and a summary of it is worthless.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.

Keep the whole run under about 90 seconds. Do not wait on the 300s generation
timeout. Do not restart, reconfigure or otherwise manage the harness process —
that is an explicit project non-goal.
