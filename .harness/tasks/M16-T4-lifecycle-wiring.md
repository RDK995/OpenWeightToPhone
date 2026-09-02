# Task M16-T4 — Wire recovery into the running app

Tier: **Mid** (`sonnet`). Named reason: **not low risk**. Lifecycle listeners are
re-entrancy and leak hazards: a duplicated listener starts a second recovery loop, and
a listener not released on unmount keeps painting into a dead view. Both are silent.

DEPENDS ON: M16-T1, M16-T2, M16-T3.

## Context

`resumeIfInterrupted` has **zero production call sites**. It is exported through
`web/src/ui/actions.ts` (line 44) and called only by tests. There is no
`visibilitychange`, `online`, `focus` or `pageshow` listener anywhere in `web/src`.
The resume point is preserved but nothing ever consumes it, so a drop that happens
while the app is backgrounded is never recovered.

M16-T3 built the recovery loop and the `onReconnecting` handler inside the coordinator.
This task makes the running app actually use them, and show the user what is happening.

`bootstrap()` in `web/src/main.ts` (lines 69-140) constructs the coordinator, mounts the
UI, and returns a `MountHandle`. `MountHandle` (`web/src/ui/mount.ts` lines 28-37) has
`setGeneration`, `setStreamingText`, `setNotice`.

## Goal

A drop during a live generation puts the app into the `reconnecting` state and recovers
it, both while the app is in the foreground and when the app is brought back after
being backgrounded.

## Exactly what to do

1. **Surface the reconnecting state.** Wherever the app drives a generation and passes
   `GenerationHandlers`, add `onReconnecting: (attempt) => handle.setGeneration({ kind:
   "reconnecting", attempt, draftPrompt })`, carrying the user's drafted prompt so it is
   never lost. On recovery success, move to the normal terminal display; on budget
   exhaustion, THEN surface the error.

   An `http_502` must never reach `setNotice(describeError(error))` while the generation
   is still recoverable.

2. **Lifecycle listeners.** In `bootstrap()`, attach listeners that ask the coordinator
   to resume an interrupted generation for the selected conversation:
   - `document` `visibilitychange` — only when `document.visibilityState === "visible"`
   - `window` `online`
   - `window` `pageshow`

   Each calls the coordinator's recovery entry point for the currently selected
   conversation. When there is no selected conversation, or no pending generation,
   `resumeIfInterrupted` already returns `{ resumed: false }` — that path must be a
   cheap no-op, never an error and never a visible state change.

   **Injectable, not global.** `BootstrapDeps` gains optional
   `documentTarget?` and `windowTarget?` (or one `lifecycleTarget`) exposing
   `addEventListener` / `removeEventListener`, defaulting to the real `document` and
   `window`. Tests drive fakes. Do NOT reach for the globals directly inside the
   listener wiring — `test/web/ui/mount.test.ts` and the bundle-purity tests police
   this kind of thing, and `bootstrap` must remain constructible in a non-browser
   process.

3. **Release them.** `MountHandle` gains a way to detach (e.g. `destroy()`), and
   `startApp`'s `enterUnpaired` / `enterPaired` transitions call it so leaving the
   conversation view removes its listeners. A second `bootstrap()` must never leave the
   first one's listeners attached.

4. **Never run two recoveries at once.** M16-T3 has a re-entrancy guard inside the
   coordinator. Do not duplicate it here — rely on it, and add a test proving that
   firing `visibilitychange`, `online` and `pageshow` in quick succession starts exactly
   one recovery.

## Acceptance Criteria

- AC1: A `visibilitychange` to `visible`, with a pending generation in the store,
  triggers exactly one recovery attempt for the selected conversation.
- AC2: `online` and `pageshow` each do the same.
- AC3: All three fired in quick succession start exactly ONE recovery, not three.
- AC4: With no selected conversation, or no pending generation, every listener is a
  silent no-op: no error, no notice, no generation state change.
- AC5: While recovering, `MountHandle.getState().generation.kind === "reconnecting"`,
  and it is NOT `error` and NOT `offline`. The drafted prompt is still present.
- AC6: An `http_502` received while a generation is in flight never reaches the notice
  region and never renders as an error while still recoverable. Assert the notice stays
  null and the generation state is `reconnecting`.
- AC7: Listeners are removed on destroy/unmount — after destroy, firing the events
  triggers no recovery. Assert `removeEventListener` was called for each event added.
- AC8: `bootstrap()` remains importable and constructible without a real browser: no
  top-level global access is added outside the existing
  `typeof document !== "undefined"` guard.

## Do NOT weaken these

- `web/src/ui/mount.ts` must NOT gain a DOM import or DOM access —
  `test/web/ui/mount.test.ts`'s "no bypass access" suite asserts over that file's text.
- The existing `onUnauthorized` flow (main.ts lines 119-159, 263-266) must be untouched.
- The `offline` variant, `OFFLINE_MESSAGE`, and the existing Retry-starts-a-new-
  generation behaviour stay exactly as they are. Reconnecting is a NEW state alongside
  them, not a replacement.
- Do not modify or delete any existing test.

## Files Allowed To Change

- `web/src/main.ts`
- `web/src/ui/mount.ts`
- `web/src/ui/dom-target.ts`
- `web/src/ui/actions.ts`
- `test/web/main-bootstrap.test.ts`, `test/web/start-app.test.ts`, `test/web/ui/`
  (ADD tests; do not modify or delete existing ones)

Do NOT touch `session-coordinator.ts`, `api-client.ts`, `sse-reader.ts`,
`conversation-store.ts`, or anything under `src/host/`. If you believe the coordinator
needs a change, STOP and say so in your return — that is a signal M16-T3 was incomplete,
not licence to edit it.

## Tests

Red -> Green -> Refactor. No test may take real wall-clock time — inject fake
`sleep`/`now` through the coordinator as M16-T3's tests do.

Run and report verbatim, with exit status:
- `~/.bun/bin/bun test test/web/`
- `~/.bun/bin/bun test` (FULL suite)
- `~/.bun/bin/bun run scripts/build.ts`
- `~/.bun/bin/bunx tsc --noEmit`

**Full-suite baseline: ALREADY RED — 851 pass, 3 fail (all `test/host/pair.test.ts`
`renderPairing`), pre-existing and unrelated**, plus whatever M16-T1/T2/T3 added. Your
bar: no NEW failures. Report exact counts.

## Out Of Scope

The live proof script is M16-T5. No changes under `src/host/`. No visual redesign —
M12c (the chat-app look) is DEFERRED by human decision and is explicitly not this
milestone's business.
