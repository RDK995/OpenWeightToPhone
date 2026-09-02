# Task M16-T1 — A failing HTTP response carries its x-generation-id

Tier: Cheap. Reason to go above: none. Additive, single-file, fully specified,
verified by unit tests.

## Context

M16 makes a dropped stream during a live generation recover instead of erroring.

Today, `web/src/api-client.ts` `handleResponse()` (around line 450) throws
`HarnessApiError` for any non-ok response. `generate()` (around line 556) calls
`await handleResponse(response)` and only reads
`response.headers.get("x-generation-id")` on line 559 — i.e. AFTER the throw.

So on a 502 from `generate()`, the generation id is thrown away. The harness has
already started the generation and stamped its id on the response header, but the
client never reads it, so it has no resume point.

This task fixes ONLY that: make the generation id survive the throw. It does NOT
add retries, backoff, or any recovery behaviour — a later task does that.

## Goal

`HarnessApiError` carries the `x-generation-id` of the response that produced it,
when the response had one.

## Exactly what to do

1. `HarnessApiError` (around line 240) gains a readonly field
   `generationId: string | null`.

   It MUST be an OPTIONAL 4th constructor parameter:
   `constructor(code: string, status: number, body: unknown, generationId?: string | null)`
   and default to `null`. Every existing call site constructs it with 3 arguments
   and MUST keep compiling and behaving identically. Do not change the order or
   meaning of the first three parameters. Do not touch `this.guidance`.

2. `handleResponse(response)` reads `response.headers.get("x-generation-id")`
   BEFORE it throws, and passes it as the 4th argument.

   Read the header defensively: `response.headers` may be absent or `get` may be
   missing on a hand-rolled test double. If reading it throws, or the header is
   absent or an empty string, use `null` — reading the header must NEVER convert a
   `HarnessApiError` into a different failure.

3. Change NOTHING else. Do not touch `generate()`, `resumeEvents()`,
   `httpErrorGuidance()`, the `http_${response.status}` code minting on line 473,
   or any other method.

## Acceptance Criteria

- AC1: A non-ok response whose headers include `x-generation-id: gen-abc` produces a
  `HarnessApiError` with `.generationId === "gen-abc"`. Prove it through the public
  `generate()` path with a 502 response carrying that header — not by constructing
  the error directly.
- AC2: A non-ok response with NO `x-generation-id` header produces a
  `HarnessApiError` with `.generationId === null`.
- AC3: `new HarnessApiError("x", 500, null)` — the existing 3-argument form — still
  works and yields `.generationId === null`.
- AC4: A response double whose `headers` is undefined, and one whose `headers.get`
  throws, still produce a normal `HarnessApiError` with the correct `.code` and
  `.status` and `.generationId === null`. No new exception type escapes.
- AC5: **The error code is unchanged.** A 502 still yields `.code === "http_502"`
  from this task; a 500 with no usable error body still yields `.code === "http_500"`.
  This task changes only what the error CARRIES, never how it is classified.

## Do NOT weaken these — they are existing, correct behaviour

- `test/web/api-client.test.ts` lines ~899-940 lock `error.code === "http_500"` for a
  500 with no usable error body. That test must keep passing **exactly as written**.
  Do not edit it, do not relax it, do not delete it.
- Do not change the `code = \`http_${response.status}\`` fallback on line 473.
- Do not touch `src/host/m7-proof.ts` or anything it asserts.

## Files Allowed To Change

- `web/src/api-client.ts`
- `test/web/api-client.test.ts` (ADD new tests only; do not modify or delete existing ones)

Nothing else.

## Tests

Red -> Green -> Refactor. Write the failing tests first, in a NEW `describe` block
appended to `test/web/api-client.test.ts`, named
`"HarnessApiError carries x-generation-id (M16-T1)"`.

Run and report verbatim, with exit status:

- `~/.bun/bin/bun test test/web/api-client.test.ts`
- `~/.bun/bin/bun test` (the FULL suite)

**Baseline for the full suite: it is ALREADY RED — 851 pass, 3 fail, 854 tests
across 32 files, all 3 failures in `test/host/pair.test.ts` (`renderPairing`).**
Those 3 are pre-existing and unrelated. Your bar is: still exactly those 3 failures
and no others, with the pass count increased by the tests you added. Report the exact
pass/fail counts.

Also run and report: `~/.bun/bin/bun run scripts/build.ts` (the bundle must still build)
and a typecheck if the project has one (`~/.bun/bin/bunx tsc --noEmit` — report its
output even if it was already failing at baseline; say so if so).

Note: `bun` is at `~/.bun/bin/bun` and is NOT on PATH in non-interactive shells.

## Out Of Scope

No retry. No backoff. No timers. No changes to `session-coordinator.ts`,
`view-model.ts`, `main.ts`, `mount.ts` or `dom-target.ts`. No new files.
