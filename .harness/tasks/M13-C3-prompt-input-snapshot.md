# Task M13-C3 — Do not clear the prompt input if the human typed into it mid-send

## Context

This is a **correction task** answering the OPTIONAL finding from the M13 cycle-1 review.
Read it at `.harness/reviews/M13-cycle1.md` — the finding headed
"`promptInput.value = ""` in `doSend`'s success `.then()`". The orchestrator has elected to
take this finding rather than defer it: it is the same class of silent-data-loss defect that
M13-T1 was written to eliminate on the failure path, left open on the success path.

Routing: **Cheap tier.** None of the four escalation reasons applies — the correction is
stated precisely below, it is confined to one function in one file, a mistake is caught by
the existing 852-test suite, and there is a clear test oracle.

## Goal

In `web/src/ui/dom-target.ts`, make `doSend`'s success branch clear the prompt input **only
when the input still holds what was sent**. If the human typed new text into the box while a
send or retry was in flight, that new text must survive the send completing.

## How

`doSend(conversationId, prompt)` is called from two places: the send button (where
`promptInput.value` holds the raw text whose trimmed form is `prompt`) and the retry button
(where `promptInput.value` holds the preserved draft). In both cases the input's value **at
the moment `doSend` is entered** is the text the send is consuming.

So: capture `promptInput.value` into a local `const` at the top of `doSend`, and in the
success `.then()` replace the unconditional `promptInput.value = "";` with a guard that
clears only if `promptInput.value` is still exactly equal to that captured snapshot.

Do not disable the input; do not change the `.catch()` branch; do not change the trimming
behaviour; do not change what `doSend` sends. `prompt` remains the trimmed string.

Add a short comment saying why the guard exists, matching the house style of the existing
M13-T1 comment directly above the line you are changing.

## Acceptance Criteria

1. A send that succeeds with the input untouched still clears the input (existing behaviour
   preserved — there are existing tests asserting this; they must still pass unmodified).
2. A **new test** in `test/web/ui/dom-target.test.ts`: drive a real send through the real
   mount/paint path where the send's promise is still pending; while it is in flight, set
   `promptInput.value` to different, newly-typed text; then let the send resolve
   successfully. Assert the input still holds the newly-typed text — it was not cleared.
3. A **new test**: the offline-retry path — after an offline failure the draft is preserved,
   the human does NOT retype, retry succeeds, and the input IS cleared (the retry consumed
   the draft that was in the box). This guards against the guard being too aggressive.
4. Both new tests fail against the current unguarded code. **Verify this yourself**: apply
   your tests first, run them against the unmodified `dom-target.ts`, record the failure
   output, then apply the fix and record the pass. Report both in your return. A test that
   passes before the fix proves nothing.
5. No existing test is weakened, skipped, deleted, or has an assertion loosened.
6. `bun test` exits 0 with 854 pass, 0 fail (852 + your 2 new tests).
7. `bun x tsc --noEmit` exits 0.

Follow Red -> Green -> Refactor: write the failing tests first (AC4 makes that explicit).

## Files Allowed To Change

- `web/src/ui/dom-target.ts`
- `test/web/ui/dom-target.test.ts`

Nothing else. Do NOT touch `web/src/ui/view-model.ts`, `web/src/session-coordinator.ts`,
`web/src/api-client.ts`, `web/src/ui/mount.ts`, any file under `src/host/`, `package.json`,
or anything under `.harness/`.

## Tests

`bun` is at `~/.bun/bin/bun` and is NOT on PATH in non-interactive shells. Prefix your
commands with `export PATH="$HOME/.bun/bin:$PATH";`.

```
bun test test/web/ui/dom-target.test.ts
bun test
bun x tsc --noEmit
```

Report the exact commands, their exit statuses, and the pass/fail counts you actually saw —
both for the pre-fix (red) run and the post-fix (green) run.

## Notes

Do not commit anything. Do not run `git stash`, `git checkout`, `git restore` or `git clean`
— the whole working tree is uncommitted work and those commands would destroy it.
