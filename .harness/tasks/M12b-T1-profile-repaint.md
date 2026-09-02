# Task M12b-T1 — Changing the profile repaints, persists, and surfaces failures

Tier: **Cheap**. Reason to go above: none. The defect, the fix shape, the file and
the assertions are all named below; the blast radius is two files; being wrong is
immediately visible in a DOM assertion.

Working directory: /Users/ryankenny/Projects/phoneToLocalModel (use absolute paths).
`bun` is NOT on PATH — run `export PATH="/Users/ryankenny/.bun/bin:$PATH"` first.

## Goal

`web/src/ui/dom-target.ts`'s profile `<select>` `change` handler fires a promise and
then does nothing with it:

```ts
profileSelect.addEventListener("change", () => {
  if (!deps) return;
  if (!selectedConversationId) { ...setNotice...; return; }
  const selectedProfileId = profileSelect.value;
  if (selectedProfileId) {
    deps.controller.setNotice(null);
    deps.actions.chooseProfile(selectedConversationId, selectedProfileId);   // <-- no await, no render, no catch
  }
});
```

The write *does* land (`chooseProfile` -> `coordinator.setProfile` ->
`conversationStore.setProfileId`, which mutates `profileId`, stamps `updatedAt` and
persists). But **nothing repaints**, so the user picks a profile and the app keeps
showing the old one. A human found this on the device: "stuck on Fast reasoning".

Fix it the same way `create-conversation` was already fixed in this file
(lines ~222-229) — `.then()` a repaint, `.catch()` a notice.

## Required changes

### Change 1 — profile `change` handler repaints and catches

Capture `deps` into a local const (the file's existing convention — see the send
and create handlers), then:

```ts
d.actions.chooseProfile(selectedConversationId, selectedProfileId)
  .then(() => {
    d.controller.render();   // reloads conversations from the store and repaints
  })
  .catch((error) => {
    d.controller.setNotice(describeError(error));
  });
```

`describeError` is already imported at the top of the file. `controller.render()`
is the right call: `mount.ts`'s `render()` reloads conversations from the store,
and `view-model.ts` derives `selectedProfileId` from
`selectedConversation?.profileId`, so the repaint picks up the new value.

### Change 2 — cancel handler catches (FR9 gap only)

`cancelBtn`'s handler calls `deps.actions.cancel(selectedConversationId)` with no
`.catch()`. If the cancel request itself fails (offline tailnet, a 401) the
rejection is unhandled and the user is told nothing.

Add **only** a `.catch()` that surfaces the failure via
`d.controller.setNotice(describeError(error))`.

**Do NOT add a `render()` to the cancel handler.** This was deliberately analysed:
cancel's visible effect already arrives via the generation's own event stream
(`onCancelled` -> `controller.setGeneration({kind:"cancelled"})`, which repaints
through mount). Adding a repaint there is out of scope for this milestone.

### Nothing else

Do not change the delete handler, the send handler, `mount.ts`, `actions.ts`,
`view-model.ts`, `session-coordinator.ts` or `conversation-store.ts`. If you spot
another defect, report it in your return under "observations" — do not fix it.

## Required tests (Red -> Green -> Refactor)

Add these to `test/web/ui/dom-target.test.ts`. Write them FIRST and watch them
fail against the unfixed code, then apply the fix, then watch them pass.

The existing test at ~line 359 ("profile-select change dispatches
actions.chooseProfile") uses a **no-op controller** and only asserts the action was
*invoked*. That is exactly the blind spot that let this defect through two reviews.
**Leave that test in place** (it still guards the dispatch), but your new tests must
be different in kind: they must build a **real** wiring and read the **DOM** after
the change.

Build the real wiring like this:

```ts
const storage = createMemoryStorage();
const store = createConversationStore(storage);
// create a conversation whose profileId is profile A
const coordinator = createSessionCoordinator({ apiClient: <minimal stub>, conversationStore: store });
const target = createDomTarget(root as any);
const handle = mount({ target, coordinator, store, initialState: { profiles, selectedConversationId: conv.id } });
target.attach({ actions: handle.actions, controller: handle });
handle.render();
```

Use the **real** `createSessionCoordinator` (imported from
`../../../web/src/session-coordinator`) — its `setProfile` only touches the
conversation store, so an unused minimal `apiClient` stub is fine. Do not stub
`setProfile` itself; the point is to prove the real path repaints.

Note: the profile `change` handler's promise resolves on a microtask, so `await`
a tick (e.g. `await new Promise((r) => setTimeout(r, 0));`) before asserting.

### Test A — (AC1) the change is reflected in the DOM, with no further user action

After dispatching `change` with profile B's id on the `[data-testid="profile-select"]`:

- The `<select>`'s selected `<option>` has `value === "<profile B id>"` — read it
  from the DOM (e.g. the option with `.selected === true`), not from
  `profileSelect.value`, since the browser leaves `.value` set to what was picked
  regardless of whether a repaint happened.
- The profiles `<ul>` (the list `paint()` builds with `" (selected)"` appended)
  shows `(selected)` against **profile B's label** and NOT against profile A's.

**This test must fail if the repaint is removed.** Prove that: after it passes,
temporarily delete the `.then(() => { d.controller.render(); })` from the handler,
re-run the test, confirm it FAILS, then restore the fix. **Report the failure
output in your return** — this is a required piece of evidence, not optional.

### Test B — (AC2) the chosen profile persists across a remount

After the change in Test A, mount a **fresh** target and handle against the **same
storage** (a new `createConversationStore(storage)` over the same
`createMemoryStorage()` instance, or the same store re-read). Assert the newly
mounted `<select>` shows profile B selected for that conversation. This proves the
choice was persisted, not just painted.

### Test C — (AC3, derived FR9) a failing chooseProfile reaches the notice region

With an actions object whose `chooseProfile` **rejects** (use `HarnessApiError` —
already imported in this test file — so the assertion exercises the real guidance
surface), dispatch the change and assert that `[data-testid="notice"]`'s
`textContent` is non-empty and contains the error's guidance text (match what
`describeError` produces: `"<title> (<code>): <detail>"`). Assert it is not the
generic fallback.

### Test D — (AC3, derived FR9) a failing cancel reaches the notice region

Same shape, for the cancel button: an actions object whose `cancel` rejects must
put the described error into `[data-testid="notice"]` rather than leaving an
unhandled rejection.

## Files Allowed To Change

- `web/src/ui/dom-target.ts`
- `test/web/ui/dom-target.test.ts`

Nothing else.

## Acceptance Criteria

- AC1: Changing the profile selector on a selected conversation repaints, and both
  the `<select>` and the rendered profiles list then show the newly chosen profile
  as selected, with no further user action. Test A asserts this from the DOM and
  fails if the repaint is removed.
- AC2: The chosen profile persists across a remount against the same storage
  (Test B).
- AC3: A failing `chooseProfile` and a failing `cancel` both surface in the notice
  region rather than becoming unhandled rejections (Tests C and D).

## Tests

Focused validation — run exactly this and report the command, exit status and the
tail of the output:

```
export PATH="/Users/ryankenny/.bun/bin:$PATH"
bun test test/web/ui/dom-target.test.ts test/web/ui/mount.test.ts test/web/ui/actions.test.ts test/web/ui/view-model.test.ts
```

Then also run:
```
bun test test/web/ui/bundle-interactive.test.ts
```

**Do NOT run the full `bun test` suite** — another task is running concurrently and
the build tests delete and rebuild `web/dist`, which would race.

Do not weaken, skip, delete or loosen any existing test. If an existing test now
fails, that is a signal about your change, not a test to edit.

## Notes

- `bun` is at `/Users/ryankenny/.bun/bin/bun`, not on PATH.
- Profile ids must never be hardcoded in `web/src/**` or `src/**`
  (`test/no-hardcoded-profile-ids.test.ts` enforces this). Test files are not
  scanned, so fixture ids inside `test/` are fine — but do not put a real profile
  id into `web/src/ui/dom-target.ts`.
