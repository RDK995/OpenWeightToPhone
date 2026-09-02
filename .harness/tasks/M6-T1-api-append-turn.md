# Task M6-T1 — C7 API Client gains `appendTurn`

Tier: Cheap
Reason for tier: none of the four fails — the endpoint is fully documented, the
method mirrors four existing methods in the same file, the blast radius is one
new method, and unit tests settle it.

Milestone: M6 — A conversation survives losing its server session
Component: C7 — API Client (`web/src/api-client.ts`)

## Context

The agreed `C9 -> C7` interface in `.harness/architecture.md` names
`appendTurn(sessionId, turn)`, but `ApiClient` does not have it. M6's session-loss
recovery replays the locally stored transcript through it, so it must exist first.

The endpoint is documented at
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/docs/api/phone-reasoning-surface-v1.md`
lines 307-358 (`POST /v1/sessions/{session_id}/turns`). **That repository is
read-only — do not modify anything under it.**

Documented contract, restated so you do not need to open the doc:

- Request: `POST /v1/sessions/{session_id}/turns`, `content-type: application/json`,
  body `{"role": "user" | "assistant", "content": "<non-empty text>"}`.
- Success: `201 Created` with body
  `{"api_version":"v1","session_id":"...","turn":{"index":2,"role":"user","content":"...","created_at":"...","cancelled":false}}`.
- Failures: `401 unauthorized`; `400 invalid_request` (bad role, empty/missing
  content, malformed JSON); `404 unknown_session`.

## Goal

Add exactly one method to the `ApiClient` interface and to the object returned by
`createApiClient`, following the existing conventions in that file precisely:

```ts
appendTurn(
  sessionId: string,
  turn: { role: "user" | "assistant"; content: string }
): Promise<SessionTurn>;
```

Implementation requirements:

1. Go through the existing private `makeRequest("POST", `/v1/sessions/${sessionId}/turns`, {...})`
   helper, with `headers: { "content-type": "application/json" }` and
   `body: JSON.stringify({ role: turn.role, content: turn.content })`. This is what
   attaches the bearer token and writes the request log — do not call `fetch` directly.
2. Pass the response through the existing `handleResponse` helper, so every documented
   failure becomes a `HarnessApiError` carrying the body's `error` string as `code`
   and the HTTP status. Do not add bespoke error handling.
3. On success, `await response.json()` and return `data.turn` as a `SessionTurn`.
   If `data` is not an object, or `data.turn` is missing or not an object, throw
   `new HarnessApiError("invalid_response", response.status, data)` — matching how
   `createSession`, `getSession` and `cancel` already handle malformed success bodies.
4. Do **not** validate `role` or `content` client-side. The service is the authority
   on `invalid_request`, and the caller in M6 needs the real service error. (This is
   deliberately unlike `generate`, which pre-validates the prompt for FR-level reasons.)
5. Change nothing else in the file. Do not alter `makeRequest`, `handleResponse`, any
   existing method, or any existing type.

## Red -> Green -> Refactor

Write the failing tests first, in the existing
`test/web/api-client.test.ts`, following the mock-`fetch` patterns already used there
(match the surrounding style — do not invent a new harness).

## Acceptance Criteria

- AC1 — `appendTurn` is declared on the `ApiClient` interface with exactly the
  signature above, and implemented in `createApiClient`.
- AC2 — A successful call issues `POST` to `<baseUrl>/v1/sessions/<sessionId>/turns`
  with an `authorization: Bearer <token>` header, `content-type: application/json`,
  and body exactly `{"role":"...","content":"..."}` (no extra fields), and resolves to
  the `turn` object from the response body.
- AC3 — A `404 {"error":"unknown_session"}` response rejects with a `HarnessApiError`
  whose `code` is `"unknown_session"` and whose `status` is `404`.
- AC4 — A `401 {"error":"unauthorized"}` response rejects with a `HarnessApiError`
  whose `code` is `"unauthorized"` and whose `status` is `401`.
- AC5 — A `400 {"error":"invalid_request"}` response rejects with a `HarnessApiError`
  whose `code` is `"invalid_request"` and whose `status` is `400`.
- AC6 — A `201` response whose body lacks a `turn` object rejects with a
  `HarnessApiError` whose `code` is `"invalid_response"`.
- AC7 — The call appears in `getRequestLog()` as `{ method: "POST", url: "<baseUrl>/v1/sessions/<id>/turns" }`.
- AC8 — Every pre-existing test in `test/web/api-client.test.ts` still passes,
  unmodified. Do not edit or delete any existing test.

## Files Allowed To Change

- `web/src/api-client.ts`
- `test/web/api-client.test.ts`

Nothing else. In particular, do not touch `web/src/session-coordinator.ts`,
`web/src/conversation-store.ts`, `.harness/`, or anything under
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/`.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun test test/web/api-client.test.ts
bun test
bunx tsc --noEmit
```

All three must exit 0. `bunx tsc --noEmit` is a working whole-repository check as of
M5a — if it reports errors, they are yours and must be fixed, not suppressed.

Report the command, exit status and the pass/fail counts for each.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.
