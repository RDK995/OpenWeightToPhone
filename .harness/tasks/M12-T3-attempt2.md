TASK — M12-T3, ATTEMPT 2 (Cheap tier, second and final Cheap attempt)

Your base task packet is `.harness/tasks/M12-T3.md`. READ IT IN FULL FIRST. Everything in it
still applies — Goal, Files Allowed To Change, Constraints, Tests, Return format — EXCEPT the
`onComplete` ordering, which attempt 1 proved wrong and which this document corrects.

## Previous Attempt

Attempt 1 (Cheap) returned PASS. An independent verifier re-ran the validation and it was
FALSE. Do not repeat any of this.

**Observed failures at attempt 1:**

- `bun test test/web/ui/dom-target.test.ts` — exit 1: 18 pass, **5 fail**. All five of the new
  tests failed. Full suite: 757 pass, **5 fail**.
- `bunx tsc --noEmit` — exit 1, **18 errors**:
  - 12 × `TS18047: 'deps' is possibly 'null'` in `web/src/ui/dom-target.ts` at lines 100, 103,
    109, 111, 114, 115, 119, 122, 123, 124, 127, 128. The `attach()` pattern means `deps`
    starts as `null`, so every use inside the handlers needs real narrowing — capture it into
    a local `const d = deps; if (!d) return;` at the top of the handler rather than reaching
    through the mutable binding.
  - 6 × in the test file: `'chooseProfile' does not exist` (lines 632, 744, 840, 920, 982) and
    one `Object is possibly 'undefined'` (line 668). The fake coordinator was given a
    `chooseProfile` member; the real `SessionCoordinator` interface has **`setProfile`**.
    Read the interface and mirror it exactly.

**Root cause of the 5 test failures — the tests did not exercise the wiring at all.**
Each new test called `await controller.actions.send(conversation.id, "test prompt")` directly,
with only two arguments. The whole point of this task is that **`dom-target.ts`'s send handler**
supplies the third argument. Calling `actions.send` yourself means `handlers` arrives
`undefined` at the fake coordinator, every `handlers?.onDelta?.(...)` is a no-op, and the
assertions then fail against a generation state that never left `"idle"`.

**The tests must drive the DOM, not the actions map.** Set `prompt-input`'s value and
`dispatchEvent` a real click on the `send` element, exactly as the M12-T2 tests already do for
every other control. That is the difference between proving the criterion and appearing to.

## The design defect attempt 1 uncovered — this is the substantive part

Attempt 1 read `web/src/session-coordinator.ts` correctly and reported, and the verifier
independently confirmed, that **the assistant turn is persisted AFTER `onComplete` fires**:

- `session-coordinator.ts:143` — `handlers?.onComplete?.(event.telemetry);` fires inside
  `consumeEventStream()`.
- `consumeEventStream()` then returns (line ~184).
- Only then, back in `send()` at lines ~386-391, does
  `conversationStore.appendTurn(conversationId, { role: "assistant", ... })` run.

**Therefore the base packet's specified ordering is wrong, and so was attempt 1's
"corrected" ordering.** Both call `controller.render()` from inside `onComplete`. At that
instant the store does not yet contain the assistant turn, and `setStreamingText("")` has
already dropped the streamed projection — so the transcript is left **missing the assistant
text entirely**, not duplicating it. Neither ordering works, because the problem is not the
order of the three calls: it is that `render()` is being called at the wrong moment.

**What to do instead.** Inside `onComplete`, do NOT clear the streaming text and do NOT
render. Set the completion generation state only. Then render **after the send promise
settles**, when `appendTurn()` has actually run:

- `onComplete(telemetry)` -> `controller.setGeneration({ kind: "complete", telemetry:
  toTelemetryDisplay(telemetry) })`. Leave `streamingText` alone here.
- The send handler currently attaches `.catch(() => {})` to the `actions.send(...)` promise.
  Extend that to render on settle: on resolve, `controller.setStreamingText("")` and then
  `controller.render()` — in that order, and only once the promise has resolved, so the store
  has the turn. Keep a `.catch` so a rejection still cannot become an unhandled rejection.
- Apply the same reasoning to `onCancelled()`: the cancelled turn is likewise persisted by the
  coordinator after the handler runs, so clear-and-render on settle rather than inside the
  handler. Set the `{ kind: "cancelled" }` generation state inside the handler.
- `onError` may keep clearing `streamingText` inside the handler — nothing is persisted on the
  error path — but verify that against the coordinator rather than assuming it.

**Read the coordinator and confirm this for yourself before implementing it.** If what you
observe contradicts the above, STOP and report what you saw rather than coding around it.

## What your tests must now prove

The base packet's test list stands, with these made explicit because attempt 1 evaded them:

- Drive every case by **dispatching real DOM events** on elements found by `data-testid`.
  Never call `actions.send` / `actions.cancel` directly in a test for this task.
- Assert the DOM transcript text **after each individual delta** — `"He"`, then `"Hello"`,
  then `"Hello world"` — by reading the DOM between deltas. `expect(texts).toContain("He")`
  over a list collected at the end is NOT sufficient; assert the sequence.
- After `complete`, assert the final assistant text is present in the transcript and appears
  **exactly once** — assert a COUNT equal to 1. An assertion that merely rules out duplication
  would also pass if the text were missing, which is precisely the bug above.
- After `complete`, assert the status region renders the telemetry.
- `queued` renders the position; `model-loading` renders the loading state; `cancelled` and
  `error` drive their kinds; `error` carries the real code and `guidance.detail` message.

`HarnessStreamError.guidance.detail` was attempt 1's one correct finding — the verifier
confirmed the field is real (`web/src/api-client.ts:256-267`, `ErrorGuidance.detail`). Keep it.

## Non-negotiable

- Do NOT weaken, delete, skip or loosen any of the 18 M12-T2 test blocks. The verifier
  confirmed all 18 were intact after attempt 1; they must stay intact.
- Files Allowed To Change remain exactly: `web/src/ui/dom-target.ts` and
  `test/web/ui/dom-target.test.ts`. Nothing else. Not `main.ts`, not `mount.ts`, not
  `actions.ts`, not `session-coordinator.ts`.
- Run every command in the base packet's `Tests` section and report the REAL exit status of
  each. Attempt 1 said tests "should pass" without running them. If a command fails, say so
  and return FAIL — a false PASS is worse than a reported failure.

================================================================================

## ATTEMPT 3 — Mid tier (`sonnet`). Escalated: tier.

Two Cheap attempts have been spent on this task. This is the third rung.

**Scope is much narrower than the previous attempts. Read this before touching anything.**

### What is already correct — DO NOT CHANGE IT

An independent verifier traced the implementation and confirmed it is now RIGHT. All of this
is settled and must survive your change untouched:

- `web/src/ui/dom-target.ts` — **the implementation is correct. Do not modify this file.**
  The verifier confirmed the runtime ordering: `onComplete` sets only the generation state;
  `setStreamingText("")` and `controller.render()` run in the `.then()` of the
  `actions.send(...)` promise; and by the time that promise settles, the coordinator has
  already run `appendTurn()` (session-coordinator.ts lines 377-399, after
  `consumeEventStream()` returns at line 184). So `render()` genuinely sees the assistant
  turn. That was the defect in attempt 1 and in the original packet's sketch, and it is fixed.
- Validation is green: `bun test` 762 pass / 0 fail across 29 files; `bunx tsc --noEmit`
  exit 0; `bun run build` exit 0.
- All 18 M12-T2 test blocks are present, unmodified and unskipped. Keep them that way.
- All five new tests correctly dispatch real DOM events (set `prompt-input`'s value, then
  `dispatchEvent(new win.Event("click"))` on `send`). Keep that pattern.

### The only thing wrong: two assertions cannot fail on what they claim to prove

Both are in `test/web/ui/dom-target.test.ts`, in the "GenerationHandlers integration with
streaming" describe block. The implementation is right, but these tests would stay green if it
were reverted to the broken version — so they are not evidence for the milestone's criterion.

**Defect 1 — the exactly-once assertion reads the STORE, not the DOM.** Around lines 687-694:

```ts
const state = controller.getState() as any;
const conv = state.conversations.find((c: any) => c.id === conversation.id);
const assistantTurns = conv?.turns.filter((t: any) => t.role === "assistant") || [];
expect(assistantTurns.length).toBe(1);
expect(assistantTurns[0]?.content).toBe("Hello world");
```

This asserts the coordinator persisted one turn — which was never in doubt and is M5's
behaviour, not this task's. It would pass with a **completely empty DOM transcript**. The
milestone criterion is about what the mounted app *renders*. Replace it with an assertion over
the **real rendered DOM**: query the transcript region out of the happy-dom document, count the
occurrences of the final assistant text `"Hello world"` in the rendered transcript, and assert
that count is **exactly 1** — proving it is present (not missing) and not duplicated between
the store's turn and the streaming projection.

**Defect 2 — the incrementality assertion is membership over a list, not a sequence, and reads
the view model rather than the DOM.** Around lines 658-685, a `target.paint` override collects
`view.transcript`'s last assistant entry into `transcriptTexts`, then asserts:

```ts
expect(transcriptTexts).toContain("He");
expect(transcriptTexts).toContain("Hello");
expect(transcriptTexts).toContain("Hello world");
```

Two problems. It reads `view.transcript` — the view model handed to `paint`, one layer above
the DOM — whereas the criterion says "the DOM reflects each one". And `toContain` proves
membership, not growth in order. Replace it with an assertion that, **after each individual
delta**, reads the transcript text **out of the happy-dom DOM** and checks the sequence of
observed values is exactly `"He"`, `"Hello"`, `"Hello world"` in that order. Capture the DOM
text inside the paint hook (or between deltas) rather than assembling a list and testing
membership at the end.

### How to make the deltas observable one at a time

The fake coordinator currently drives all three deltas synchronously inside `send`, so every
paint happens before the test regains control. Keep driving them from the fake coordinator, but
capture the **DOM** text at each step — e.g. inside the `target.paint` override, read the
transcript element's `textContent` from the document after calling through to the real paint,
and push that. That gives you a genuine per-delta DOM observation without restructuring the
test.

If you find that reading the DOM inside the paint hook is not possible for a structural reason,
STOP and report exactly what blocks it rather than falling back to asserting over the view model.

### Prove your new assertions actually bite

This is the point of the whole attempt, so demonstrate it rather than asserting it:
temporarily revert `dom-target.ts`'s send handler to the broken ordering (call
`setStreamingText("")` and `render()` inside `onComplete` instead of in the promise's `.then()`),
confirm your two new assertions FAIL, then restore `dom-target.ts` byte-for-byte and confirm
they pass again. Report both observations. A test that passes both before and after that
revert has not fixed anything.

Leave `dom-target.ts` exactly as you found it when you are done.

### Files Allowed To Change

- `test/web/ui/dom-target.test.ts` — and nothing else.

`web/src/ui/dom-target.ts` may be temporarily edited ONLY for the bite-check above, and MUST be
restored to its current exact contents. Verify with a checksum taken before and after.

### Tests

1. `PATH="$HOME/.bun/bin:$PATH" bun test test/web/ui/dom-target.test.ts` — must pass.
2. `PATH="$HOME/.bun/bin:$PATH" bun test` — full suite; report counts (expect 762 pass / 0 fail).
3. `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit` — must exit 0.
4. `PATH="$HOME/.bun/bin:$PATH" bun run build` — must exit 0.

Report the REAL exit status of each. Do not weaken, delete or skip any existing assertion.
