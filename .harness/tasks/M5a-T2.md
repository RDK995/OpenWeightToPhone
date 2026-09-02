# Task M5a-T2 — Resume result reports reconciled text; prove the lastSeq === -1 resume

Tier: Cheap. Reason routed here: none — both halves are clearly specified (the
exact wrong expression and its file/line are named; the second half is a test
written from an assertion this packet states), bounded to one source file and
one test file, low risk (a single fallback branch that nothing currently reads),
and easily verified by unit tests.

## Context

Repo root: /Users/ryankenny/Projects/phoneToLocalModel
Toolchain: Bun 1.4.0 at `~/.bun/bin/bun`, NOT on PATH in non-interactive shells.
Node is not installed. Every command must `export PATH="$HOME/.bun/bin:$PATH"`
or use the absolute path.

Follow Red -> Green -> Refactor: write the failing test first, watch it fail for
the right reason, then make it pass.

### Half A — the defect (milestone acceptance criterion 3)

`web/src/session-coordinator.ts`, in `resumeFromSessionSnapshot`:

```
379:    conversationStore.recordProgress(conversationId, null);
380:    reconcileTurnsFromSnapshot(conversationId, snapshot);
381:
382:    return {
383:      resumed: true,
384:      generationId: pending.generationId,
385:      text: pending.partialText,     // <-- WRONG: pre-drop partial text
...
```

`reconcileTurnsFromSnapshot` (line 194) has already written the authoritative
turns from `snapshot.turns` into the store via
`conversationStore.saveConversation`. The returned `ResumeResult.text` must
equal the reconciled assistant text now held in `conversation.turns`, not the
stale pre-drop partial.

Required behaviour: after the reconcile, read the conversation back from
`conversationStore` and set `text` to the content of the reconciled assistant
turn for this generation — in practice the **last** turn in `conversation.turns`
whose `role` is `"assistant"`. If there is no such turn, fall back to
`pending.partialText` so the field is never undefined.

**Do NOT change the earlier `status === null` early return at lines 367-376.**
That branch does not reconcile, so `pending.partialText` is correct there. Only
the post-reconcile return is wrong.

### Half B — the test gap (milestone acceptance criterion 4)

A drop before any SSE event arrives leaves `pending.lastSeq = -1`, so the resume
sends `Last-Event-ID: -1`. This was checked against the harness service and is
**correct**: the service defines `-1` as the valid floor meaning "I hold
nothing", accepts it, and replays from seq 0. No client change is expected.

No unit test and no live proof currently reaches this path (the live proof always
aborts after 3 content deltas, so `lastSeq` is never below 0 in any observed
run). The gap is a missing test, not a defect.

**If the test passes without any production change, that is the criterion
satisfied — it is not a vacuous result and you must NOT invent a change to make
it look like work.** If the test instead fails, stop and report that: it would
mean a real defect, which is outside this task's remit.

Read `resumeIfInterrupted` (from line 394) and the api client's resume/stream
call to find where `Last-Event-ID` is set, and follow the existing mocking
conventions in `test/web/session-coordinator.test.ts`.

## Goal

1. `ResumeResult.text` on the `seq_not_available` fallback path equals the
   reconciled assistant text in `conversation.turns`.
2. A unit test proves a resume from `pending.lastSeq === -1` sends
   `Last-Event-ID: -1` and replays from seq 0 with no gap.

## Acceptance criteria for this task

1. A new unit test reconciles a snapshot whose full assistant text **differs
   from** the pre-drop partial (e.g. partial `"The ans"`, full
   `"The answer is 42."`) and asserts the returned `ResumeResult.text` is the
   full one. It must fail before the fix and pass after.
2. A new unit test drives a resume with `pending.lastSeq === -1`, asserts the
   request carries `Last-Event-ID: -1`, and asserts the replayed seqs start at 0
   with no gap (the `seqs` array on the result is contiguous from 0).
3. `bun test test/web/session-coordinator.test.ts` is green.
4. `bun test` (whole suite) passes with no fewer than 276 tests.
5. No existing test is weakened, deleted, skipped, or had an assertion loosened.

## Files allowed to change

- `web/src/session-coordinator.ts`
- `test/web/session-coordinator.test.ts`

## Tests / validation to run

```
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/ryankenny/Projects/phoneToLocalModel
bun test test/web/session-coordinator.test.ts 2>&1 | tail -20
bun test 2>&1 | tail -20
```

## Report back

The exact edit to `session-coordinator.ts`; the names of the two new tests; proof
of Red for the Half A test (the failure message before the fix); whether the Half
B test passed with no production change (and if not, exactly how it failed); the
whole-suite pass count before and after.
