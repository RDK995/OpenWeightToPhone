# Task M7-T2 — C7 turns an unreachable harness into a distinct offline error

Tier: Cheap
Reason for tier: none of the four fails. The change is one `try`/`catch` around
one existing `await`, the classification rule is stated exactly below, and the
293 pre-existing tests — which include the cancel and abort paths this touches —
settle whether it is right.

Milestone: M7 — Documented harness errors are surfaced meaningfully, not generically
Component: C7 — API Client (`web/src/api-client.ts`)

## Context

`.harness/requirements.md` "Edge Cases" (line ~155) says: "The harness is offline
or the tailnet is unreachable: show a clear offline state and allow retry without
losing the drafted prompt."

Today, when `fetch` rejects because the host is unreachable, that rejection escapes
`web/src/api-client.ts` untouched as a bare `TypeError`. It is indistinguishable
from a programming bug, and carries no guidance. M7 requires a distinct typed
offline state.

`HarnessOfflineError` already exists in `web/src/api-client.ts` (added by task
M7-T1). **Read it before you start** — do not redefine it, and do not change its
shape. This task only makes the client throw it.

## Goal

In `web/src/api-client.ts`, inside the private `makeRequest` helper, wrap the
single `await fetchFn(url, {...})` call:

```ts
let response: Response;
try {
  response = await fetchFn(url, { method, headers, body: options?.body, signal: options?.signal });
} catch (error) {
  if (isAbortError(error, options?.signal)) {
    throw error;
  }
  throw new HarnessOfflineError(url, error);
}
return response;
```

Add a module-private helper next to `makeRequest`:

```ts
function isAbortError(error: unknown, signal?: AbortSignal): boolean
```

It returns `true` when **any** of the following holds, and `false` otherwise:

1. `signal?.aborted === true`
2. `error` is an object with a `name` property equal to `"AbortError"`
3. `error` is an object with a `name` property equal to `"TimeoutError"`

Write it defensively — `error` may be `null`, a string, or any non-object, and
reading `.name` off those must not throw.

Nothing else in the file changes. In particular:

- Do not wrap `response.json()`, `handleResponse`, or any per-method logic. A
  failure *reading* an already-arrived response is not an offline condition.
- Do not wrap the SSE stream consumption in `web/src/sse-reader.ts` (a different
  file, and not yours to edit).
- Do not add retries, backoff, timeouts, or connectivity polling.
- `logRequest` must still be called before the fetch attempt, so an offline
  attempt is still visible in `getRequestLog()`. Do not move it.
- The existing `getToken()`-is-null check must still throw
  `new HarnessApiError("unauthorized", 401, null)` **before** anything is
  logged or fetched. Do not disturb it.

## Why abort must pass through unchanged

M4's cancellation and M5's resume both abort in-flight requests via
`AbortSignal`, and `web/src/session-coordinator.ts` distinguishes a transport
failure (leave `pending` in place so a resume can pick it up) from other
failures. If a deliberate abort were reclassified as an offline error, cancel
would silently change behaviour and the existing suite might still pass on the
happy paths. Get rule 1 above right: check the signal first.

## Red -> Green -> Refactor

Write the failing tests first, in the existing `test/web/api-client.test.ts`,
using the stub-`fetch` option `createApiClient` already accepts. Append your
tests; do not edit or delete any existing test.

## Acceptance Criteria

- AC1 — When the stub `fetch` rejects with `new TypeError("Failed to fetch")`,
  every client method that issues a request (`listProfiles`, `createSession`,
  `getSession`, `generate`, `resumeEvents`, `cancel`, `appendTurn`) rejects with a
  `HarnessOfflineError` (asserted with `instanceof`). Cover all seven.
- AC2 — The thrown `HarnessOfflineError` has `url` equal to the full request URL
  (`baseUrl + path`), `cause` strictly equal to the original rejection value, and
  `draftPrompt === null`.
- AC3 — Its `guidance` has `action === "retry"`, `retryable === true`, and
  `code === "offline"`.
- AC4 — When the stub `fetch` rejects with an error whose `name` is
  `"AbortError"`, the rejection propagates **unchanged** — the caller receives
  the identical error object (assert strict equality with the value the stub
  threw), not a `HarnessOfflineError`.
- AC5 — When the passed `AbortSignal` is already aborted and the stub rejects
  with a plain `TypeError` (i.e. rule 2 alone would not fire), the rejection
  still propagates unchanged rather than becoming a `HarnessOfflineError`. This
  pins rule 1.
- AC6 — An error whose `name` is `"TimeoutError"` also propagates unchanged.
- AC7 — `isAbortError` does not throw when handed `null`, `undefined`, `"string"`
  or `42`; each of those, thrown by the stub `fetch`, becomes a
  `HarnessOfflineError`.
- AC8 — A non-OK HTTP *response* (e.g. 503 `{"error":"queue_full"}`) still
  rejects with a `HarnessApiError`, **not** a `HarnessOfflineError`. A response
  that arrived is not an offline condition.
- AC9 — An offline attempt still appears in `getRequestLog()`.
- AC10 — Every pre-existing test in `test/web/` still passes, unmodified. The
  cancel/abort tests in `test/web/session-coordinator.test.ts` are the ones that
  matter most here; if any of them fails, your classification is wrong — fix the
  code, not the test.

## Files Allowed To Change

- `web/src/api-client.ts`
- `test/web/api-client.test.ts`

Nothing else. Do not touch `web/src/session-coordinator.ts`,
`web/src/sse-reader.ts`, `src/host/`, or `.harness/`.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun test test/web/api-client.test.ts
bun test test/web/session-coordinator.test.ts
bun test
bunx tsc --noEmit
```

All four must exit 0. Report the command, exit status and pass/fail counts for each.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.
