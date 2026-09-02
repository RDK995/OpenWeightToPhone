TASK

Correction task for M12a-ii cycle-1 review finding **OPTIONAL 2** (the
blank-app-with-no-way-back finding). Full finding:
`/Users/ryankenny/Projects/phoneToLocalModel/.harness/reviews/M12a-ii-cycle1.md`,
the second fenced `Severity: OPTIONAL` block ("enterPaired() destroys the pairing
view before constructing the conversation UI"). Read it there.

Routing: **Mid**. Reason above Cheap: **not low risk.** This changes `startApp`'s
unpaired/paired/unauthorized state machine — the component the milestone's
criteria 1, 3 and 5 all rest on, and the one whose original task was routed Top.
Getting the fallback wrong (double-mount, orphaned view, a credential cleared
when it should not be) breaks passing criteria rather than only failing to add
one. It is bounded and has a clear test oracle, which is why it is Mid and not Top.

Goal:
Make `enterPaired()` in `web/src/main.ts` survive a synchronous throw from
`bootstrap()`. Today `enterPaired()` calls `releasePairingTarget()` — which
does `section.remove()` — *before* calling `bootstrap()`. If `bootstrap()`
throws, `mountHandle` stays null and `pairingTarget` is null, so the root is
empty with no view and no control to touch. Because the credential was already
persisted by `adoptCredentialFromPastedText`, a relaunch takes the same branch
and throws again: a permanently blank installed app with no address bar. The
reviewer could not construct a live trigger, so this is a latent hazard, not a
live defect — fix it without changing any behaviour on the paths that work today.

Relevant Requirements:
M12a-ii acceptance criterion 5 (derived from FR9): "A token the harness rejects
surfaces the `unauthorized` guidance and returns to the pairing view rather than
a dead end the user cannot leave." This correction closes the same
"dead end the user cannot leave" hole for a synchronous construction failure,
which the criterion's existing tests do not reach.

Acceptance Criteria:
- AC1. A synchronous throw from `bootstrap()` leaves the app in the **unpaired**
  state with the pairing view on screen and a message, not with an empty root.
  Concretely, from the unpaired state, with a dep that makes `bootstrap` throw
  synchronously, after pairing with a valid pairing URL:
  - `handle.paired` is `false`
  - `[data-testid=pairing]` is present in `root`
  - `[data-testid=pairing-message]` has non-empty text
  - `startApp` / `submitPairing` did **not** propagate the throw to the caller
- AC2. The persisted credential is **cleared** in that case —
  `createCredentialStore(storage).getCredential()` is `null` — so a relaunch does
  not re-enter the same throwing branch. Read it back through a **fresh**
  `createCredentialStore(storage)` over the same storage, not through a
  captured object.
- AC3. Relaunch safety: constructing a second `startApp` over the same storage
  after AC2 comes up **unpaired**, showing the pairing view, and does not throw.
- AC4. The same protection applies to the **initial** `enterPaired()` at the
  bottom of `startApp` (the `credentialStore.getCredential() !== null` branch),
  not only to the one reached from `onSubmit`: `startApp` with a pre-seeded
  credential and a throwing dep must return normally, unpaired, showing the
  pairing view — it must not throw out of `startApp`.
- AC5. **No behaviour change on any path that works today.** Every one of the
  16 existing tests in `test/web/start-app.test.ts` must pass **unmodified**,
  and so must the whole suite. In particular the AC3/AC5 tests assert via
  `recordPaintedTestIds` that the pairing view is *never painted at all* on the
  already-paired and fragment-adoption paths — your change must not cause an
  extra paint on a successful path.
- AC6. `onSubmit` must not report success when the fallback fired. When
  `enterPaired()` fails, `onSubmit` returns `{ ok: false, message: <the failure
  message> }` rather than `{ ok: true }`. Suggested shape: have `enterPaired()`
  return a `boolean` and have `onSubmit` branch on it. Choose your own shape if
  a better one exists, but the observable contract above is fixed.
- AC7. **The detector must bite, and you must prove it.** After your new tests
  are green, temporarily remove the try/catch (restore the original
  `enterPaired()` body), run `bun test test/web/start-app.test.ts`, and confirm
  your new tests **FAIL** (the throw escapes). Then restore your implementation
  and confirm the full suite is green. Report the failing output verbatim.
- AC8. `bunx tsc --noEmit -p tsconfig.json` exits 0.

How to make `bootstrap()` throw, without adding a seam:
`enterPaired()` calls `bootstrap(root, { ...deps, storage, location,
onUnauthorized })`, and `deps.createTarget` and `deps.createApiClient` are both
already injectable through `BootstrapDeps` and are both invoked synchronously
inside `bootstrap()`. Pass `createTarget: () => { throw new Error("boom"); }` (or
the equivalent for `createApiClient`) through `startApp`'s deps. **Do not add a
new injection point, a new dep field, or any test-only hook to production code.**
Read `bootstrap()` first to confirm which of the two throws synchronously before
`mountHandle` would be assigned, and use that one.

Relevant Files:
- `web/src/main.ts` — read it in full. `startApp` is lines 186-288;
  `enterPaired`/`enterUnpaired`/`onSubmit`/`onUnauthorized` are lines 218-259;
  `BootstrapDeps` is at line 43; `bootstrap()` is above `startApp`. The file's
  header comment explains the invariant that exactly one of `mountHandle` /
  `pairingTarget` is non-null at a time — preserve it.
- `test/web/start-app.test.ts` — read it in full. Reuse the existing helpers
  (`createTestWindow`, `createLocation`, `switchableApiClient`, `q`, `count`,
  `click`, `tick`, `seedCredential`, `ORIGIN`); do not re-declare them. Match the
  style of the neighbouring tests.
- `web/src/ui/pairing-target.ts` — read it in full (94 lines). It is the view
  the fallback re-enters. Note `showMessage`, `destroy`, and that the click
  handler already has its own try/catch around `deps.onSubmit` writing
  `SUBMIT_THREW_MESSAGE`; make sure your change does not make that path
  double-report or write into a detached node in a way a test would see.
- `web/src/ui/view-model.ts` — `describeError`, already imported by `main.ts`
  and used by `onUnauthorized`. Read only.

Files Allowed To Change:
- `web/src/main.ts`
- `test/web/start-app.test.ts`

Constraints:
- Follow existing repository patterns. Keep the module's comment style: the
  existing comments explain *why*, not *what* — add one in that register
  explaining why the fallback clears the credential.
- Do not change `bootstrap()`'s name, signature or behaviour. Callers that
  supply no `onUnauthorized` must be entirely unaffected — that constraint is
  why 40 tests were added in this milestone with zero existing tests modified,
  and it still holds.
- Do not add a new field to `BootstrapDeps`.
- Do not change unrelated behaviour. Do not introduce dependencies.
- Do not weaken tests. Do not modify, rename or delete any existing test.
- Do not broaden this beyond the finding. Anything else you notice goes under
  `Unresolved Issues`.
- Never run `git stash`, `git checkout --`, `git restore`, `git reset --hard`
  or `git clean`. You share this worktree with the orchestrator and other
  workers, and uncommitted work is not recoverable from them. To revert an
  experiment, edit it back.
- Another correction task has just added a test to
  `test/web/start-app.test.ts`. Read the file fresh; do not assume the line
  numbers quoted above for that file are still exact.

Tests:
- `bun test test/web/start-app.test.ts` (focused)
- `bun test` (full suite — 0 fail, and the count must be the pre-existing count
  plus exactly the tests you added)
- `bunx tsc --noEmit -p tsconfig.json` (must be exit 0 — this repository
  type-checks and `bun test` will NOT catch a type error. Bun matchers take
  exactly one argument: `expect(x).toBe(y, "message")` is a TS2554 error that
  passes at runtime. Do not write one.)
- `bun run build` (exit 0)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
