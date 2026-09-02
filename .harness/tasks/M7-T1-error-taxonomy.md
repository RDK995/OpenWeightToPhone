# Task M7-T1 — C7 gains a documented-error taxonomy with per-code guidance

Tier: Cheap
Reason for tier: none of the four fails. The set of codes is closed and stated
verbatim below, the change is additive to one source file plus its test file,
the blast radius is knowable (every existing throw site keeps working because
nothing existing is removed or renamed), and 293 existing tests plus `tsc`
settle it immediately.

Milestone: M7 — Documented harness errors are surfaced meaningfully, not generically
Component: C7 — API Client (`web/src/api-client.ts`)

## Context

`.harness/architecture.md` gives C7 the responsibility: "Call the documented v1
endpoints with authentication and **map every documented failure to a typed
error**." Today `web/src/api-client.ts` has a single `HarnessApiError` carrying a
free-form `code: string` and nothing a user interface could show. FR9 in
`.harness/requirements.md` (lines 74-81) requires that documented error codes be
"surfaced meaningfully rather than as a generic failure".

M7 supplies the taxonomy. A later milestone (M9, the UI) consumes it. Nothing in
this task renders anything.

**The documented HTTP error codes and statuses, verbatim from the API contract:**

```
unauthorized 401, invalid_request 400, unknown_session 404, unknown_profile 400,
generation_in_flight 409, queue_full 503, unknown_generation 404,
seq_not_available 409 (body also includes last_seq), not_found 404,
internal_error 500
```

**The documented SSE error codes** (carried as the `error` field of a
`{"seq":N,"kind":"error","error":"<code>"}` event; see `web/src/sse-reader.ts`):

```
profile_resolution_failed, inference_failed, incomplete_stream,
session_unavailable, generation_timed_out, stream_write_failed
```

## Goal

Add the following to `web/src/api-client.ts`. Everything is **additive**: do not
remove, rename, or change the meaning of any existing export, field or behaviour.

### 1. Code unions

```ts
export type HttpErrorCode =
  | "unauthorized" | "invalid_request" | "unknown_session" | "unknown_profile"
  | "generation_in_flight" | "queue_full" | "unknown_generation"
  | "seq_not_available" | "not_found" | "internal_error";

export type StreamErrorCode =
  | "profile_resolution_failed" | "inference_failed" | "incomplete_stream"
  | "session_unavailable" | "generation_timed_out" | "stream_write_failed";

export const HTTP_ERROR_CODES: readonly HttpErrorCode[];   // frozen, all ten
export const STREAM_ERROR_CODES: readonly StreamErrorCode[]; // frozen, all six
```

### 2. Guidance shape

```ts
export type GuidanceAction =
  | "re_pair" | "retry" | "retry_later" | "wait_for_current"
  | "choose_profile" | "edit_prompt" | "report" | "none";

export interface ErrorGuidance {
  readonly code: string;      // the error code this guidance is for
  readonly title: string;     // short user-facing headline
  readonly detail: string;    // what happened and what to do, in the user's terms
  readonly action: GuidanceAction;
  readonly retryable: boolean;
  readonly documented: boolean; // false only for the unknown-code fallback
}
```

### 3. Two exhaustive guidance tables

`HTTP_ERROR_GUIDANCE: Readonly<Record<HttpErrorCode, ErrorGuidance>>` and
`STREAM_ERROR_GUIDANCE: Readonly<Record<StreamErrorCode, ErrorGuidance>>`, both
exported and frozen. Typing them as `Record<HttpErrorCode, ...>` is what makes a
missing code a `tsc` failure — do not widen the type to `Record<string, ...>`.

**Use exactly these entries.** Do not reword them; the wording is the
user-facing guidance the acceptance criteria are judged against.

`HTTP_ERROR_GUIDANCE`:

| code | title | action | retryable |
| --- | --- | --- | --- |
| `unauthorized` | `Pairing needed` | `re_pair` | `false` |
| `invalid_request` | `That request was rejected` | `edit_prompt` | `true` |
| `unknown_session` | `Conversation session was lost` | `none` | `true` |
| `unknown_profile` | `That model profile is unavailable` | `choose_profile` | `false` |
| `generation_in_flight` | `A reply is already in progress` | `wait_for_current` | `true` |
| `queue_full` | `The harness is busy` | `retry_later` | `true` |
| `unknown_generation` | `That generation is no longer known` | `retry` | `true` |
| `seq_not_available` | `Cannot resume from that point` | `none` | `false` |
| `not_found` | `That address was not found` | `report` | `false` |
| `internal_error` | `The harness hit an internal error` | `retry` | `true` |

`detail` strings, verbatim:

- `unauthorized`: `This device is no longer authorised to reach the harness. Scan the pairing QR code on your Mac again to re-pair.`
- `invalid_request`: `The harness rejected the request as malformed. Edit the prompt and send it again.`
- `unknown_session`: `The harness no longer holds this conversation's session. It will be rebuilt and your transcript replayed automatically.`
- `unknown_profile`: `The harness does not recognise the selected model profile. Choose a different profile.`
- `generation_in_flight`: `This conversation already has a reply being generated. Wait for it to finish, or cancel it, before sending another prompt.`
- `queue_full`: `The harness queue is at capacity right now. Wait a few moments and send the prompt again.`
- `unknown_generation`: `The harness has no record of the generation being resumed or cancelled. Send the prompt again.`
- `seq_not_available`: `The harness cannot replay the reply from where this device left off. The conversation will be reconciled from the harness's own record instead.`
- `not_found`: `The harness did not recognise the address this app requested. The app and the harness may be out of step.`
- `internal_error`: `Something failed inside the harness. Send the prompt again; if it keeps happening, check the harness logs on your Mac.`

`STREAM_ERROR_GUIDANCE`:

| code | title | action | retryable |
| --- | --- | --- | --- |
| `profile_resolution_failed` | `The model profile could not be loaded` | `choose_profile` | `false` |
| `inference_failed` | `The model failed while replying` | `retry` | `true` |
| `incomplete_stream` | `The reply was cut short` | `retry` | `true` |
| `session_unavailable` | `The conversation session became unavailable` | `retry` | `true` |
| `generation_timed_out` | `The reply took too long` | `edit_prompt` | `true` |
| `stream_write_failed` | `The connection dropped while streaming` | `retry` | `true` |

`detail` strings, verbatim:

- `profile_resolution_failed`: `The harness could not resolve the selected profile into a running model. Choose a different profile and try again.`
- `inference_failed`: `Generation stopped because the model itself failed. Send the prompt again.`
- `incomplete_stream`: `The harness stopped sending before the reply was complete. The partial text is kept; send the prompt again for a full answer.`
- `session_unavailable`: `The harness lost this conversation's session while replying. Send the prompt again to rebuild it.`
- `generation_timed_out`: `The reply passed the harness's 300 second budget and was stopped. Try a shorter prompt or a faster profile.`
- `stream_write_failed`: `The harness could not keep writing the reply to this device. Check the connection and send the prompt again.`

Every entry's `documented` is `true`, and every entry's `code` equals its key.

### 4. Two lookup functions with a distinct fallback

```ts
export function httpErrorGuidance(code: string): ErrorGuidance;
export function streamErrorGuidance(code: string): ErrorGuidance;
```

For a code present in the corresponding table, return that entry. For any other
string, return a fallback built as:

- `code`: the code passed in, verbatim
- `title`: `Unexpected harness error`
- `detail`: `` `The harness reported an error this app does not recognise: ${code}. Send the prompt again; if it keeps happening, check the harness logs on your Mac.` ``
- `action`: `report`
- `retryable`: `false`
- `documented`: `false`

The fallback's `detail` embeds the code, so two different unknown codes still
produce different guidance rather than one generic message.

### 5. `HarnessApiError` gains guidance

Add `readonly guidance: ErrorGuidance` to `HarnessApiError`, set in the
constructor to `httpErrorGuidance(code)`. Leave `code`, `status`, `body`, the
`message` string and the prototype fix-up exactly as they are — `code` stays
typed `string` because the class is also thrown with `invalid_response` and
`http_<status>`, which are not documented service codes and must land on the
fallback.

### 6. `HarnessStreamError`

```ts
export class HarnessStreamError extends Error {
  readonly code: string;
  readonly generationId: string | null;
  readonly guidance: ErrorGuidance;
  constructor(code: string, generationId?: string | null);
}
```

`message` is `` `HarnessStreamError: ${code}` `` (mirroring `HarnessApiError`),
`generationId` defaults to `null`, `guidance` is `streamErrorGuidance(code)`, and
the constructor ends with `Object.setPrototypeOf(this, HarnessStreamError.prototype);`
exactly as `HarnessApiError` does.

### 7. `HarnessOfflineError`

```ts
export class HarnessOfflineError extends Error {
  readonly url: string;
  readonly cause: unknown;
  readonly guidance: ErrorGuidance;
  draftPrompt: string | null;   // deliberately mutable, and NOT readonly
  constructor(url: string, cause: unknown);
}
```

`message` is `HarnessOfflineError: harness unreachable`. `draftPrompt` starts
`null`; a later task sets it so a failed send does not lose the user's draft.
`guidance` is the literal:

- `code`: `offline`
- `title`: `Cannot reach the harness`
- `detail`: `Your Mac's harness did not answer. Check that it is running and that this device is on the tailnet, then retry — your prompt has been kept.`
- `action`: `retry`
- `retryable`: `true`
- `documented`: `true`

Same `Object.setPrototypeOf` treatment.

### 8. `EmptyPromptError`

```ts
export class EmptyPromptError extends Error {
  readonly guidance: ErrorGuidance;
  constructor();
}
```

`message` is `EmptyPromptError: prompt is empty`. `guidance` is the literal:

- `code`: `empty_prompt`
- `title`: `Nothing to send`
- `detail`: `Type a prompt before sending.`
- `action`: `edit_prompt`
- `retryable`: `false`
- `documented`: `true`

Same `Object.setPrototypeOf` treatment.

### 9. One behaviour change inside `generate`

`generate` currently rejects an empty or whitespace-only prompt with
`new HarnessApiError("invalid_request", 400, null)`. Change **only that throw**
to `throw new EmptyPromptError();`. It must still happen before any call to
`makeRequest`, so no request is issued and nothing is written to the request log.
Change nothing else in `generate`.

## Red -> Green -> Refactor

Write the failing tests first, in the existing `test/web/api-client.test.ts`,
following the mock-`fetch` patterns already used there. Match the surrounding
style; do not introduce a new test harness. Append your tests — do not edit or
delete any existing test.

## Acceptance Criteria

- AC1 — Every symbol in sections 1-8 above is exported from
  `web/src/api-client.ts` with exactly the stated name, shape and values.
- AC2 — `HTTP_ERROR_GUIDANCE` has exactly ten entries, one per `HttpErrorCode`,
  and `STREAM_ERROR_GUIDANCE` exactly six, one per `StreamErrorCode`. A test
  iterates `HTTP_ERROR_CODES` / `STREAM_ERROR_CODES` and asserts a table entry
  exists for each, with `documented === true` and `code` equal to the key.
- AC3 — **Distinctness.** A test collects the guidance for all sixteen documented
  codes plus the offline and empty-prompt guidance (eighteen in total) and asserts
  that the `title` values are pairwise distinct AND the `detail` values are
  pairwise distinct. No two documented conditions may share user-facing wording.
- AC4 — `unauthorized` guidance has `action === "re_pair"`, and `queue_full`
  guidance has `action === "retry_later"` with `retryable === true`. Asserted
  explicitly, because FR9 names these two specifically.
- AC5 — `httpErrorGuidance("no_such_code")` and
  `streamErrorGuidance("no_such_code")` both return `documented === false`,
  `action === "report"`, and a `detail` containing the string `no_such_code`; and
  `httpErrorGuidance("other_unknown").detail !== httpErrorGuidance("no_such_code").detail`.
- AC6 — For every documented HTTP code, a stubbed non-OK response with body
  `{"api_version":"v1","error":"<code>"}` at the documented status makes the
  client reject with a `HarnessApiError` whose `code` is that code, whose
  `status` is the documented status, and whose `guidance` is the matching table
  entry (assert `guidance.title` and `guidance.action`, not just identity). Drive
  this through real client methods with a stub `fetch` — for example `getSession`
  for the 404s, `generate` for the 400/409/503s — in the style of the existing
  tests.
- AC7 — `new HarnessApiError("invalid_response", 200, null).guidance.documented`
  is `false`, confirming undocumented internal codes land on the fallback rather
  than borrowing a documented message.
- AC8 — `generate` called with `""`, `"   "` or `"\n\t"` rejects with an
  `EmptyPromptError` (asserted with `instanceof`), the stub `fetch` is never
  called, and `getRequestLog()` is empty.
- AC9 — `new HarnessStreamError("inference_failed", "gen-1")` has
  `code === "inference_failed"`, `generationId === "gen-1"`, and guidance matching
  the table; `new HarnessStreamError("incomplete_stream")` has
  `generationId === null`.
- AC10 — Every pre-existing test in `test/web/` still passes, unmodified. If an
  existing test fails, fix your change — do not edit the test.

## Files Allowed To Change

- `web/src/api-client.ts`
- `test/web/api-client.test.ts`

Nothing else. In particular do not touch `web/src/session-coordinator.ts`,
`web/src/sse-reader.ts`, `web/src/credential-store.ts`, `src/host/`, or
`.harness/`.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun test test/web/api-client.test.ts
bun test
bunx tsc --noEmit
```

All three must exit 0. `bun test` was `293 pass, 0 fail` before this task; report
the counts after. `bunx tsc --noEmit` is a working whole-repository check as of
M5a — if it reports errors, they are yours and must be fixed, not suppressed.

Report the command, exit status and the pass/fail counts for each.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.

Do not add retry logic, backoff, network-failure detection, or any UI. Those are
other tasks in this milestone or later milestones. This task is the taxonomy and
nothing more.
