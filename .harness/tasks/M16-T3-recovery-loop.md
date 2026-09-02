# Task M16-T3 — Recovery loop: backoff, wall-clock budget, and the 502 resume trigger

Tier: **Mid** (`sonnet`). Named reason: **not low risk**. This changes control flow in
`send()` around error classification. Getting the classification wrong either masks
real terminal errors as "recovering" (a silent hang) or converts recoverable drops
into errors (the bug M16 exists to fix). Both are expensive and hard to detect.

DEPENDS ON: M16-T1 (done — `HarnessApiError.generationId`) and M16-T2 (done —
the `reconnecting` `GenerationDisplay` variant).

## Context — read this before writing anything

`web/src/session-coordinator.ts` (617 lines at baseline). What already works, proven
at planning time — DO NOT re-implement:

- `send()` writes a pending record with `lastSeq: -1` immediately after `generate()`
  returns (lines 328-334), so a resume point exists even with zero SSE events.
- A transport failure deliberately leaves `pending` in place rather than clearing it
  (lines 360-366, and the comment at 68-81). A `HandlerInvocationError` clears it.
  That distinction is correct and must survive.
- `resumeIfInterrupted()` (lines 503-596) works end to end, including the
  `seq_not_available` fallback to `resumeFromSessionSnapshot()` (443-501).
  `resumeFromSessionSnapshot` returns `status: null` when the generation is still
  queued/in_flight — i.e. "nothing terminal yet, try again later".

What is missing, and what THIS task builds: there is no retry, no backoff, no
wall-clock budget, and a 502 from `generate()` is a terminal error.

## Goal

A generation that drops — by transport failure, or by an undocumented gateway status
— is recovered by retrying with backoff until it reaches a terminal state or its 300s
wall-clock budget expires. Only then is an error surfaced.

## Exactly what to do

### 1. Injectable clock and sleep

`createSessionCoordinator(deps)` gains two OPTIONAL deps:

- `now?: () => number` — defaults to `() => Date.now()`
- `sleep?: (ms: number) => Promise<void>` — defaults to a `setTimeout`-based sleep

They MUST be optional with those real defaults, so every existing construction site
and every existing test keeps working untouched. Tests for this task inject fakes so
the suite never actually waits.

### 2. Persist the generation's start time

The budget is measured **from the generation's start**, and recovery may run after a
page reload, so the start time must be persisted rather than held in memory.

Add an OPTIONAL field `startedAt?: string` (ISO-8601) to `PendingGeneration` in
`web/src/conversation-store.ts`. `send()` sets it when it first records progress.

It MUST be optional: pending records already persisted in a real browser's
localStorage have no `startedAt`. When it is absent, treat the first recovery attempt's
clock reading as the start — never treat an absent `startedAt` as "budget already
exhausted", and never throw on one.

### 3. The backoff policy

Write it as a pure, exported, separately-testable function — either in
`session-coordinator.ts` or a new `web/src/recovery-policy.ts`, your choice:

    export function recoveryDelayMs(attempt: number): number

`attempt` is 1-based. Schedule: 500, 1000, 2000, 4000, 8000, then 10000 for every
later attempt (capped). No randomness/jitter — the tests must be deterministic.

    export const RECOVERY_BUDGET_MS = 300_000;

300s, as the acceptance criterion requires. Name it as a constant; do not inline it.

### 4. `onReconnecting` handler

`GenerationHandlers` gains `onReconnecting?: (attempt: number) => void`, dispatched
once before each recovery attempt's wait, with the 1-based attempt number. It is
optional, like every other handler. A throw from it is a `HandlerInvocationError`,
consistent with the existing handlers.

### 5. The resume-trigger predicate — the heart of this task

Write it as a named, exported, separately-tested predicate. A caught error is a
**resume trigger** if and only if BOTH hold:

**(a) A generation is known to be in flight.** Either the conversation has a `pending`
record carrying a `generationId`, OR the error is a `HarnessApiError` with a non-null
`.generationId` read from the failing response header (M16-T1). If neither, it is NOT
a resume trigger.

**(b) It is a recoverable failure.** Either:
  - it is a transport failure (the existing non-`HandlerInvocationError` path — an
    aborted fetch, a network error, or a stream that ended without a terminal event); or
  - it is a `HarnessApiError` whose `.status` is in **502..504** AND whose `.code`
    starts with `http_`.

The `http_` prefix conjunct is load-bearing: it means the harness returned NO
structured error code, i.e. the status is **undocumented**. A documented harness error
(code taken from the response body, e.g. `unknown_session`) is NEVER a resume trigger,
whatever its status.

A `HarnessOfflineError` is NOT a resume trigger — it keeps today's offline behaviour
exactly. An `EmptyPromptError` is not either.

### 6. The recovery loop

When a resume trigger is caught while a generation is in flight:

1. Ensure a pending record exists. If `send()` failed at `generate()` before writing
   one, but the `HarnessApiError` carries a `generationId`, write a pending record
   from it now: that id, `lastSeq: -1`, `status: "in_flight"`, `partialText: ""`,
   `startedAt` = now. **This is what makes recovery work having received no SSE event
   at all, on a failing status.**
2. Loop, attempt = 1, 2, 3, ...:
   - If `now() - startedAt >= RECOVERY_BUDGET_MS`, stop and surface the error.
   - Dispatch `onReconnecting(attempt)`.
   - `await sleep(recoveryDelayMs(attempt))`.
   - Call the existing `resumeIfInterrupted(conversationId, handlers)`.
   - If it returns a terminal `status` (`complete` / `error` / `cancelled`), the
     recovery succeeded: return that outcome.
   - If it returns `status: null` (the snapshot says still queued/in_flight), or it
     throws another resume-trigger error, continue the loop.
   - If it throws a NON-resume-trigger error, stop and propagate that error unchanged.
3. On budget exhaustion, surface an error. It must be attributable — the caller must
   be able to tell "recovery was attempted and the budget ran out" apart from an
   ordinary first-attempt failure. Carry the attempt count and the elapsed time.

Recovery MUST be reachable from BOTH entry paths, and they must be separately
exercisable:
- a 200 stream that dies mid-flight (transport failure inside `consumeEventStream`)
- a failing gateway status from `generate()` before any SSE event arrived

### 7. Re-entrancy

Two recovery loops must never run concurrently for the same conversation. Guard it,
and test the guard: a second call while one is in flight must not start a second loop.

## Acceptance Criteria

- AC1: A 502 from `generate()` carrying `x-generation-id`, with no SSE event received,
  is recovered — the caller gets the full completed answer, never an `http_502` and
  never "Unexpected harness error".
- AC2: A 200 stream that dies after some deltas is recovered, and the recovered text
  is the full answer with no gaps and no duplicates.
- AC3: A run that succeeds only on the **third** attempt proves backoff actually
  retries more than once. Assert the exact delays passed to the injected `sleep`:
  `[500, 1000, 2000]`.
- AC4: A run whose generation never reaches a terminal state exhausts the 300s budget
  measured from `startedAt` and **does** surface an error. Assert with an injected
  clock that no attempt is made at or after 300_000ms elapsed, and that the surfaced
  error is attributable to budget exhaustion.
- AC5: `onReconnecting` fires once per attempt with 1-based numbers in order.
- AC6: The re-entrancy guard holds: a concurrent second recovery call for the same
  conversation does not start a second loop.
- AC7: `recoveryDelayMs` returns exactly 500, 1000, 2000, 4000, 8000, 10000, 10000
  for attempts 1..7.

## Do NOT weaken these — a worker will be tempted to weaken both

1. **`src/host/m7-proof.ts` Phase C (lines 458-509)** asserts an **undocumented SSE
   error code on a 200 response** maps to `documented: false` / `action: "report"`.
   That is a *stream* error (`HarnessStreamError` from `sse-reader.ts`), a completely
   different thing from an undocumented HTTP status. Do NOT touch `sse-reader.ts`, do
   NOT touch `HarnessStreamError`, and do NOT make an SSE `error` event a resume
   trigger. `bun run src/host/m7-proof.ts` must keep passing unchanged.

2. **`test/web/api-client.test.ts` lines ~899-940** lock `error.code === "http_500"`
   for a 500 with no usable error body, **with no generation in flight**. That is
   correct behaviour and stays. Your predicate's clause (a) is what protects it — 500
   is outside 502..504 AND there is no generation in flight. Do not edit that test.

Also preserve: the `HandlerInvocationError` vs transport-failure distinction (a handler
throw clears pending and is NEVER recovered); the `seq_not_available` snapshot
fallback; and the `unknown_session` session-rebuild recovery in `send()` (lines
291-326), which is a different mechanism and must keep working exactly as it does.

## Files Allowed To Change

- `web/src/session-coordinator.ts`
- `web/src/conversation-store.ts` (only to add the optional `startedAt` field)
- `web/src/recovery-policy.ts` (new, optional — only if you split the policy out)
- `test/web/session-coordinator.test.ts` (ADD tests; do not modify or delete existing ones)
- `test/web/recovery-policy.test.ts` (new, only if you created the module)
- `test/web/conversation-store.test.ts` (ADD tests only)

Nothing else. Do NOT touch `api-client.ts`, `sse-reader.ts`, `main.ts`, `mount.ts`,
`dom-target.ts`, `view-model.ts`, or anything under `src/host/`.

## Tests

Red -> Green -> Refactor. Every test injects fake `now` and `sleep` — **no test may
take real wall-clock time.** If the suite gets slower by more than a second, you have
done this wrong.

Run and report verbatim, with exit status:
- `~/.bun/bin/bun test test/web/session-coordinator.test.ts`
- `~/.bun/bin/bun test` (FULL suite)
- `~/.bun/bin/bun run src/host/m7-proof.ts` — must still pass; report its verdict lines
- `~/.bun/bin/bun run scripts/build.ts`
- `~/.bun/bin/bunx tsc --noEmit`

**Full-suite baseline: ALREADY RED — 851 pass, 3 fail, 854 tests across 32 files, all
3 failures in `test/host/pair.test.ts` (`renderPairing`), pre-existing and unrelated.**
Your bar: still exactly those 3 failures and no others. Report exact counts.

Note: `bun` is at `~/.bun/bin/bun`, NOT on PATH in non-interactive shells.

## Out Of Scope

No lifecycle listeners (`visibilitychange` / `online` / `pageshow` / `focus`) — that is
M16-T4. No UI wiring. No changes to `src/host/`. No new component: this stays inside
C9 (Session Coordinator). If you find you need a seam the agreed architecture does not
describe, STOP and say so in your return rather than inventing one.
