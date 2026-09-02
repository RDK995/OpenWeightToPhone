# Task M6-T2 — C9 rebuilds a lost session and replays the local transcript

Tier: Mid
Reason for tier: **not low risk.** The change sits inside `send()`, the path every
previously-completed milestone's behaviour runs through, and it introduces a retry.
Two ways of being wrong here are expensive and not obvious from a green test run:
replaying a transcript in response to a `401` (an authentication failure treated as a
session failure), and recovering more than once (an unbounded retry against a live
service). The requirement is precise and testable, which is why this is Mid and not Top.

Milestone: M6 — A conversation survives losing its server session
Component: C9 — Session Coordinator (`web/src/session-coordinator.ts`)
Depends on: task M6-T1, which added `appendTurn` to C7. It is already merged; read
`web/src/api-client.ts` to confirm the exact signature before you use it.

## Background you need

`.harness/requirements.md` FR8 — Session-loss recovery:

> - On `404 unknown_session`, create a fresh session, replay the locally stored
>   transcript via `POST /v1/sessions/{id}/turns` to restore the model's context,
>   then continue.
> - `404 unknown_session` is distinguished from `401 unauthorized`: the former means
>   the session is gone, the latter means the token is invalid.

One decision from `.harness/requirements.md` that governs this task:

> **The API document's "Building a Client" step 5 is wrong.** It instructs clients to
> append the assistant's answer as a turn. [...] A client that also appended turns
> would duplicate them and corrupt the conversation. `POST /turns` is for seeding
> history, such as the FR8 replay, not for recording generations.

So `appendTurn` is used **only** for the replay in this task, and never to record a
generation's own turns. The existing `send()` already relies on the service appending
both turns itself; do not change that.

## Goal

Teach `send()` in `web/src/session-coordinator.ts` to recover from a lost server
session, and only from a lost server session.

### Behaviour required

Inside `send()`, the call to `apiClient.generate(sessionId, {...})` may reject.

**If it rejects with a `HarnessApiError` whose `code === "unknown_session"`**, recover,
in exactly this order:

1. `const newSessionId = await apiClient.createSession()`
2. `conversationStore.setSessionId(conversationId, newSessionId)`
3. Replay the conversation's locally stored transcript into the new session, **in
   stored order, oldest first**: for each turn in the conversation's `turns` array,
   call `await apiClient.appendTurn(newSessionId, { role: turn.role, content: turn.content })`.
   - **Skip any turn whose `content.trim()` is empty.** The service rejects empty
     content with `400 invalid_request`, and a cancelled generation that produced no
     output before it was cancelled is stored locally as exactly such a turn. Skipping
     it is required for the replay to survive a transcript that contains one.
   - Replay sequentially (`await` each one), not concurrently: order is part of the
     restored context, and the acceptance criteria check it.
   - Count the turns actually appended.
4. Retry `apiClient.generate(newSessionId, { profileId, prompt })` **exactly once**.
5. Continue the rest of `send()` unchanged, using the new session id and the retried
   generation's `generationId` and `events`.

**If the retry in step 4 also rejects with `unknown_session`, do not recover again** —
let it propagate. Recovery happens at most once per `send()` call.

**If `generate` rejects with anything else, let it propagate unchanged.** In
particular a `HarnessApiError` with `code === "unauthorized"` (status `401`) must
result in **no** `createSession` call, **no** `appendTurn` call, **no** retry, and
**no** change to the conversation's stored `sessionId`. The caller sees the
`unauthorized` error and is responsible for prompting a re-pair. This is the single
most important line in this packet.

### Result shape

`SendResult` gains two fields so a caller (and M6's live proof) can observe that
recovery happened:

```ts
export interface SendResult {
  generationId: string;
  text: string;
  status: "complete" | "error" | "cancelled";
  telemetry: Telemetry | null;
  errorCode: string | null;
  sessionRebuilt: boolean;   // NEW - true only when the unknown_session path ran
  replayedTurns: number;     // NEW - turns actually appended during the replay
}
```

On the normal path these are `false` and `0`. Populate them on every return from
`send()`; do not make them optional.

### Out of scope — do not do these

- Do **not** add recovery to `resumeIfInterrupted`, `cancel`, or
  `resumeFromSessionSnapshot`. M6's acceptance criteria cover `send()` only.
- Do **not** change `ResumeResult`, `consumeEventStream`, `reconcileTurnsFromSnapshot`,
  `mapSnapshotStatus`, or any existing behaviour on the non-error path.
- Do **not** add retry/backoff for network errors, `queue_full`, or
  `generation_in_flight`. Those belong to other milestones.
- Do **not** modify `web/src/api-client.ts` or `web/src/conversation-store.ts`.

## Red -> Green -> Refactor

Write the failing tests first, in the existing `test/web/session-coordinator.test.ts`,
using the mock `ApiClient` / in-memory store patterns already established there. Match
the surrounding style rather than introducing a new one.

## Acceptance Criteria

- AC1 — When `generate` rejects with `HarnessApiError("unknown_session", 404, ...)` and
  then succeeds on retry: `createSession` is called exactly once, the store's
  `sessionId` for that conversation is updated to the new id, and the generation
  completes normally.
- AC2 — During that recovery, `appendTurn` is called once per stored turn with
  non-empty content, **in stored order**, each with the new session id and that turn's
  exact `role` and `content`. Assert the recorded call sequence, not just the count.
- AC3 — A stored turn whose `content` is `""` or whitespace-only is skipped: no
  `appendTurn` call is made for it, and `replayedTurns` does not count it.
- AC4 — The successful recovery returns `sessionRebuilt: true` and `replayedTurns`
  equal to the number of turns actually appended.
- AC5 — When `generate` rejects with `HarnessApiError("unauthorized", 401, ...)`:
  `send()` rejects with that same error, `createSession` is **never** called,
  `appendTurn` is **never** called, and the conversation's stored `sessionId` is
  unchanged. Assert all four.
- AC6 — When `generate` rejects with `unknown_session` **both** times, `send()` rejects
  with the second `unknown_session` error and `createSession` was called exactly once
  (no second recovery attempt).
- AC7 — On the normal path (no error), the returned `SendResult` has
  `sessionRebuilt: false` and `replayedTurns: 0`, and `appendTurn` is never called.
- AC8 — A conversation with no stored `sessionId` still creates its session up front
  exactly as before, and makes no `appendTurn` calls.
- AC9 — Every pre-existing test in `test/web/session-coordinator.test.ts` still passes,
  unmodified, **except** where an existing test asserts the exact shape of a
  `SendResult` object with a strict deep-equality check. If and only if such a test
  exists, extend its expected object with the two new fields — do not weaken the
  assertion, do not delete the test, and list any such edit explicitly in your return.

## Files Allowed To Change

- `web/src/session-coordinator.ts`
- `test/web/session-coordinator.test.ts`

Nothing else. Do not touch `.harness/`, `src/host/`, or anything under
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/` (that repository is read-only).

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun test test/web/session-coordinator.test.ts
bun test
bunx tsc --noEmit
```

All three must exit 0. `bunx tsc --noEmit` is a working whole-repository check as of
M5a — errors it reports are real and must be fixed, not suppressed.

Report the command, exit status and the pass/fail counts for each.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Node is not installed.
