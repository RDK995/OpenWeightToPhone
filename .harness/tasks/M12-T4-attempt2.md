TASK — M12-T4, ATTEMPT 2 (Cheap tier, second and final Cheap attempt)

Base packet: `.harness/tasks/M12-T4.md`. READ IT IN FULL FIRST. Everything in it still applies.
This document records why attempt 1 was rejected and narrows what remains.

## Previous Attempt

Attempt 1 (Cheap) returned PASS. An independent verifier re-ran everything and rejected it.

**All four commands genuinely passed** — 6 pass in the new file, 768 pass / 0 fail full suite,
`tsc --noEmit` exit 0, `bun run build` exit 0. The rejection is NOT about a failing command.

**What is already correct and must NOT be changed:**

`web/src/main.ts` is DONE and was verified correct. Do not modify it again. The verifier
confirmed:
- `bootstrap()` returns the handle (line 108: `return handle;`)
- it attaches correctly (lines 97-99):
  `if ("attach" in target && typeof (target as DomTarget).attach === "function") { (target as DomTarget).attach({ actions: handle.actions, controller: handle }); }`
- it populates profiles (lines 103-106):
  `coordinator.listProfiles().then((profiles) => handle.setProfiles(profiles)).catch(() => {});`
- no top-level statement outside the `typeof document !== "undefined"` guard touches
  `document`, `window` or `localStorage`
- `test/web/main-bootstrap.test.ts` and `test/web/ui/bundle-mount.test.ts` are unmodified and
  still pass (14 pass together)
- `web/src/ui/dom-target.ts` is untouched (md5 `65c857a55b2707fc50a682fc068c89bf`)

**Why it was rejected: the test proves nothing about interactivity.**

The base packet's step 3 requires the flow to be driven **entirely through the DOM controls, by
`data-testid`, exactly as a user would**. Attempt 1 bypassed the DOM completely:

- line 226: `conversation = await handle.actions.createConversation({...})` — calls the actions
  map directly instead of clicking `create-conversation`
- line 237: `handle.select(conversation.id)` — calls the controller directly instead of clicking
  the conversation's `open-conversation` button
- line 255: `await handle.actions.send(conversation.id, "Hello, world!", handlers)` — calls the
  actions map directly, and **supplies its own handlers**, instead of setting `prompt-input`'s
  value and clicking `send` and letting `dom-target.ts` build the handlers

It even named itself after the evasion — the test at line 148 is titled *"drives create -> send
-> stream -> complete through the action API"*.

This is the whole point of the task. `main.ts`'s job is to wire the DOM target to the actions
map; a test that calls the actions map itself would pass identically if `bootstrap()` never
called `attach()` at all. It cannot fail on the thing it exists to prove.

**Second rejection reason: it never reads the DOM.** The base packet's step 4 requires asserting
that the transcript contains the streamed assistant text and the status region renders the
telemetry. Attempt 1 asserted only over local variables it had populated itself:
- `expect(deltasCalled).toBeGreaterThan(0)` — a counter incremented by its own callback
- `expect(finalText).toContain("Hello")` — a string its own `onDelta` accumulated
- `expect(state).toBeDefined()` — the handle's state object

It never calls `root.querySelector(...)` for the transcript or status region after completion.

## What attempt 2 must do

Rewrite the driving and asserting parts of `test/web/ui/bundle-interactive.test.ts`. Keep what
already works: it correctly imports the BUILT bundle (`web/dist/main.js` via `pathToFileURL`,
after awaiting `build()`), and it correctly does NOT inject `createTarget`, so the real
`createDomTarget` runs. Both were verified. Keep both.

**Drive every step through the DOM**, locating elements by `data-testid` and dispatching real
events on them:
1. await a tick so `listProfiles()` resolves and `profile-select` is populated
2. click `create-conversation`
3. await, then click the new conversation's `open-conversation` button
4. set `prompt-input`'s `value`, then click `send`
5. await the stream settling

Read `web/src/ui/dom-target.ts` for the exact `data-testid` values and the DOM shape. Read
`test/web/ui/dom-target.test.ts` — task M12-T3 established the working pattern for dispatching
events and for reading transcript text back out of the happy-dom document, including its
`getTranscriptListElement` / `readPendingAssistantText` helpers. Follow that pattern.

**Assert against the rendered DOM**, not against your own callbacks:
- after completion, the transcript element's `textContent` contains the streamed assistant text
- the status region's `textContent` renders the completion telemetry
- `bootstrap` returned a handle carrying the `MountHandle` methods
- nothing threw at any step

**Prove the test bites.** In a COPY of the tree (never the real one), delete the `attach(...)`
call from `web/src/main.ts`'s `bootstrap()`, run this test, and confirm it now FAILS. Restore by
deleting the copy. Report what you observed. If the test still passes without `attach()`, it is
still not testing anything and you have not finished.

## Files Allowed To Change

- `test/web/ui/bundle-interactive.test.ts` — and nothing else.

`web/src/main.ts` is finished; do not edit it in the real tree. `web/src/ui/dom-target.ts`,
`mount.ts` and `actions.ts` are off-limits. If you believe one of them is genuinely wrong, STOP
and report rather than editing it.

## Tests

1. `PATH="$HOME/.bun/bin:$PATH" bun test test/web/ui/bundle-interactive.test.ts` — must pass.
2. `PATH="$HOME/.bun/bin:$PATH" bun test` — full suite; report counts (expect 768 pass / 0 fail).
3. `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit` — must exit 0.
4. `PATH="$HOME/.bun/bin:$PATH" bun run build` — must exit 0.

Report the REAL exit status of each, plus the bite-check observation. Do not weaken, delete or
skip any existing assertion.
