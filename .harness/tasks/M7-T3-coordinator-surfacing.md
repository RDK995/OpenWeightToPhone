# Task M7-T3 — C9 surfaces typed errors and keeps the draft prompt

Tier: Mid
Reason for tier: **not low risk.** The change is inside `send()` and
`resumeIfInterrupted()`, the paths every milestone from M2 to M6 runs through,
and it widens two result types and one handler signature that ~1800 lines of
existing tests assert against. Being wrong here is expensive and not obviously
visible: a mis-placed `catch` could swallow the `unknown_session` recovery M6
proved live, or clear `pending` on a transport failure that M5's resume depends
on finding.

Milestone: M7 — Documented harness errors are surfaced meaningfully, not generically
Component: C9 — Session Coordinator (`web/src/session-coordinator.ts`)

## Context

`.harness/architecture.md` gives C9 `Realises: ... FR9`, and C9 is the only
component between the API client and the (not yet written) UI. FR9 requires
documented failures to be surfaced meaningfully; the typed errors and their
guidance now exist in `web/src/api-client.ts` (tasks M7-T1 and M7-T2). **Read
that file first** — specifically `ErrorGuidance`, `HarnessStreamError`,
`HarnessOfflineError`, `EmptyPromptError`, `streamErrorGuidance` — and use them
as they are. Do not redefine or re-export any of them.

Today, in `web/src/session-coordinator.ts`:

- an empty prompt throws a bare `Error("Prompt cannot be empty or whitespace-only")`;
- an SSE `error` event is reduced to `errorCode: string | null` on the result and
  a bare code string passed to `handlers.onError`, with no guidance anywhere;
- an unreachable harness now throws `HarnessOfflineError` from C7, but the
  user's drafted prompt is not attached to it, so a caller catching it has no way
  to restore the draft.

M7 fixes those three. Nothing in this task renders anything — the UI is M9.

## Goal

Four changes, all in `web/src/session-coordinator.ts`, all additive to the
existing result shapes.

### 1. Empty prompt becomes a typed client-side rejection

In `send()`, replace

```ts
throw new Error("Prompt cannot be empty or whitespace-only");
```

with `throw new EmptyPromptError();` (imported from `./api-client`). It must stay
where it is: the very first statement, before the conversation lookup and before
any `apiClient` call, so no request is issued.

### 2. SSE error events become typed stream errors

In `consumeEventStream`:

- add `streamError: HarnessStreamError | null` to the `ConsumeOutcome` interface,
  initialised `null`;
- in the `case "error":` branch, build
  `const streamError = new HarnessStreamError(event.error, generationId);`
  **before** dispatching the handler, assign it to the outcome, keep
  `errorCode = event.error` exactly as now, and dispatch
  `handlers?.onError?.(event.error, streamError);`
- return `streamError` in the outcome object.

Widen the handler type:

```ts
onError?: (code: string, error: HarnessStreamError) => void;
```

The first parameter keeps its existing meaning and position, so every existing
caller compiles and behaves identically.

### 3. Both result types carry the typed error

Add to `SendResult` **and** `ResumeResult`:

```ts
streamError: HarnessStreamError | null; // the typed SSE error, when status === "error"
```

- `send()` returns `outcome.streamError`.
- `resumeIfInterrupted()`'s streaming path returns `outcome.streamError`.
- `resumeFromSessionSnapshot()` returns `streamError: null` on every path — a
  session snapshot reports a `failed` status with no error code, so there is no
  code to type. Do not invent one.
- The `emptyResult` in `resumeIfInterrupted` gets `streamError: null`.

Do **not** remove or change `errorCode`. It stays exactly as it is; `streamError`
is added alongside it. When `streamError` is non-null, `streamError.code` must
equal `errorCode`.

### 4. An offline failure keeps the drafted prompt

Wrap the body of `send()` **after** the empty-prompt check in a `try`/`catch`
that attaches the draft and rethrows:

```ts
try {
  ... everything send() currently does after the empty-prompt check ...
} catch (error) {
  if (error instanceof HarnessOfflineError && error.draftPrompt === null) {
    error.draftPrompt = prompt;
  }
  throw error;
}
```

Rules for this wrapper, all of which matter:

- It **only** mutates `draftPrompt`, and only when it is still `null` (so an
  inner call that already attributed a draft is not overwritten). It changes no
  other field and swallows nothing.
- It rethrows **every** error unchanged, including `HarnessApiError`,
  `HandlerInvocationError`-unwrapped originals, and plain `Error`s.
- It must not disturb the existing `unknown_session` recovery, the existing
  `HandlerInvocationError` handling, or the rule that a transport failure leaves
  `pending` in place. Put the wrapper *outside* those, not inside them.

Do the same in `resumeIfInterrupted()`? **No.** A resume has no drafted prompt —
the prompt was already sent. Leave `resumeIfInterrupted` alone apart from change 3.

## Explicitly out of scope

- Any retry, backoff, reconnection or queueing behaviour.
- Any change to `web/src/api-client.ts`, `web/src/sse-reader.ts`,
  `web/src/conversation-store.ts` or `web/src/credential-store.ts`.
- Any UI, rendering, or `unauthorized`-triggered re-pairing flow. C9's obligation
  is to let a typed `HarnessApiError` (which already carries
  `guidance.action === "re_pair"`) propagate out of `send()` untouched. It
  already does. Do not add handling for it.

## Red -> Green -> Refactor

Write the failing tests first, in the existing
`test/web/session-coordinator.test.ts`, following the stub-`ApiClient` patterns
already used there. Append your tests; do not edit or delete any existing test.

## Acceptance Criteria

- AC1 — `send(id, "")`, `send(id, "   ")` and `send(id, "\n\t")` each reject with
  an `EmptyPromptError` (asserted with `instanceof`), whose
  `guidance.action === "edit_prompt"`. In each case the stub `ApiClient` records
  **zero** calls — no `createSession`, no `generate`, nothing — proving the
  rejection is client-side before any request.
- AC2 — For each of the six documented SSE codes (`profile_resolution_failed`,
  `inference_failed`, `incomplete_stream`, `session_unavailable`,
  `generation_timed_out`, `stream_write_failed`), a stubbed event stream ending in
  `{ seq: N, kind: "error", error: "<code>" }` makes `send()` resolve with
  `status === "error"`, `errorCode === "<code>"`, and `streamError` a
  `HarnessStreamError` whose `code` is that code, whose `generationId` is the
  generation id, and whose `guidance.documented === true` with the code's own
  `title`. Assert the title is the code-specific one, not a shared string —
  compare the six titles and assert they are pairwise distinct.
- AC3 — `handlers.onError` is called with `(code, streamError)` where the second
  argument is the same `HarnessStreamError` instance the result carries (strict
  equality).
- AC4 — An undocumented SSE code (e.g. `"weird_new_code"`) still yields a
  `HarnessStreamError` with `guidance.documented === false`,
  `guidance.action === "report"`, and a `detail` containing the code. It must not
  throw and must not be dropped.
- AC5 — When `apiClient.generate` rejects with
  `new HarnessOfflineError("https://host/v1/...", new TypeError("Failed to fetch"))`,
  `send(id, "my drafted prompt")` rejects with that same
  `HarnessOfflineError` instance, now carrying
  `draftPrompt === "my drafted prompt"` and
  `guidance.action === "retry"`.
- AC6 — In the AC5 scenario the conversation is left unchanged and retryable: no
  turn was appended (`getConversation(id).turns` is identical to before the call),
  and a subsequent `send(id, "my drafted prompt")` against a now-working stub
  succeeds normally. Assert both.
- AC7 — When `apiClient.createSession` (rather than `generate`) rejects with a
  `HarnessOfflineError`, `draftPrompt` is likewise attached. This pins that the
  wrapper covers the whole of `send()`, not just the generate call.
- AC8 — A `HarnessOfflineError` that already has a non-null `draftPrompt` is
  rethrown with that value intact, not overwritten.
- AC9 — A `HarnessApiError` with `code === "unauthorized"` still propagates out
  of `send()` unchanged (same instance), with `guidance.action === "re_pair"`, and
  causes no session creation and no turn replay. This is M6's proven behaviour;
  pin that M7 did not disturb it.
- AC10 — The M6 `unknown_session` rebuild-and-replay path still works end to end
  through `send()`, returning `sessionRebuilt === true` with the expected
  `replayedTurns`. Every pre-existing test in `test/web/` must pass unmodified —
  if one fails, fix your change, not the test.
- AC11 — `resumeIfInterrupted` returns `streamError` populated on the streaming
  path when the stream ends in an `error` event, and `streamError: null` from
  `emptyResult` and from the `seq_not_available` snapshot-reconciliation path.

## Files Allowed To Change

- `web/src/session-coordinator.ts`
- `test/web/session-coordinator.test.ts`

Nothing else. If you believe a change to `web/src/api-client.ts` is required,
stop and report that instead of making it.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun test test/web/session-coordinator.test.ts
bun test
bunx tsc --noEmit
```

All three must exit 0. Report the command, exit status and pass/fail counts for each.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.
