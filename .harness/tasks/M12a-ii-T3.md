# Task M12a-ii-T3 — `startApp`: the unpaired/paired state machine wired into the entry point

Tier: **Top** (`opus`), entering at attempt 4. Named reason: **architectural**. This
changes the app's browser entry contract and introduces an app-level state machine
(unpaired → paired → unauthorized → unpaired). It is also **not low risk**: the cheapest
detector for getting it wrong is a human physically picking up an iPhone and attesting
milestone criterion 7, which is the most expensive feedback loop on this project.

## Goal

Wire `web/src/credential-store.ts`'s `adoptCredentialFromPastedText` (task T1) and
`web/src/ui/pairing-target.ts` (task T2) into the app so that an installed home-screen
app with no stored credential shows a pairing screen, pairs from a paste, proceeds
straight into the conversation UI, stays paired across a relaunch, and falls back to the
pairing screen if the harness later rejects the token.

**Both dependencies are already implemented and merged. Read them before you start:**
- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts`
- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/pairing-target.ts`

## Context

- Repository root: `/Users/ryankenny/Projects/phoneToLocalModel`. Use absolute paths.
- Bun 1.4.0 is at `~/.bun/bin/bun`, **not on PATH** in non-interactive shells. Prefix
  commands with `PATH="$HOME/.bun/bin:$PATH"`.
- **Why this milestone exists** (from `.harness/milestones.md`, `M12a-ii`): iOS gives an
  installed home-screen app its own storage container, separate from Safari's, so a
  token captured by a QR scan in Safari is invisible to the standalone app; and
  `start_url` is `/app/` with no fragment, so `location.hash` is empty at launch. The
  installed app therefore reports `Pairing needed (unauthorized)` and has no address bar
  in which to enter a `#t=` URL. An in-app pairing screen is the agreed fix. **Do not
  propose or implement alternatives** — dropping `start_url` and in-app QR scanning were
  both considered and rejected on record.
- The shipped bundle must contain **no third-party runtime code**. `happy-dom` is
  test-only. `test/web/bundle-purity.test.ts` enforces this and must keep passing.
  Import nothing you did not write.

## The design, which is fixed — implement it, do not redesign it

The governing constraint is **minimal churn to existing tests**. `bootstrap()` keeps its
current name, signature and behaviour exactly, so every existing test that calls it keeps
passing unmodified. The branching lives in a **new** exported function.

### 1. `BootstrapDeps` gains one optional field

```ts
export interface BootstrapDeps {
  storage?: StoragePort;
  location?: LocationPort;
  createTarget?: (root: HTMLElement) => RenderTarget;
  createApiClient?: typeof createApiClient;
  onUnauthorized?: (error: unknown) => void;   // NEW
}
```

In `bootstrap()`'s existing fire-and-forget `coordinator.listProfiles().catch(...)`:
if the rejection's `guidance.code` is `"unauthorized"` **and** `deps?.onUnauthorized` is
supplied, call `deps.onUnauthorized(error)` **instead of** `handle.setNotice(...)`.
Otherwise behave exactly as today. Existing tests supply no `onUnauthorized`, so their
behaviour is unchanged — verify that claim, do not assume it.

Detect the code by reading `error.guidance.code`, guarded the same way
`view-model.ts`'s `isErrorGuidance` guards it. Do not match on the message string.

### 2. New exported function `startApp`

```ts
export interface AppHandle {
  /** True once a credential is stored and the conversation UI is mounted. */
  readonly paired: boolean;
  /** The mounted conversation UI, or null while the pairing view is showing. */
  readonly mount: MountHandle | null;
  /** Drives the pairing view programmatically; same contract as clicking Pair. */
  submitPairing(pastedText: string): PairingSubmitResult;
}

export function startApp(root: HTMLElement, deps?: BootstrapDeps): AppHandle;
```

`paired` and `mount` must be **live** — a getter or a closure read, not a value snapshotted
at construction. A test pairs and then reads `handle.paired`; if it is a frozen `false`
the test is worthless.

`startApp(root, deps)`:

1. Resolve `storage` and `location` with the same lazy defaults `bootstrap()` uses.
2. Build a `credentialStore` from that storage and call
   `adoptCredentialFromFragment(credentialStore, location)` **first**. This preserves
   today's Safari `#t=` path exactly: a QR-scanned URL still pairs without ever showing
   the pairing screen.
3. If `credentialStore.getCredential()` is non-null → go to **enterPaired()**.
   Otherwise → go to **enterUnpaired(null)**.

**enterPaired()**: destroy the pairing view if one is showing, then call
`bootstrap(root, { ...deps, storage, location, onUnauthorized })` and hold the returned
`MountHandle`. Set `paired` true. Pass the *resolved* `storage` and `location` through so
the pairing that just happened is visible to `bootstrap` — never re-resolve them.

**enterUnpaired(message)**: release any held `MountHandle` (set it to `null`) and call
`createPairingTarget(root, { onSubmit })`, holding the returned `PairingTarget`. Set
`paired` false. If `message` is non-null, call `showMessage(message)` on it.

**`onSubmit(pastedText)`**: call
`adoptCredentialFromPastedText(credentialStore, pastedText, location.origin)`.
- Returns a credential → call `enterPaired()` and return `{ ok: true }`.
- Returns `null` → return
  `{ ok: false, message: "That does not look like a pairing URL or token. On your Mac, run: bun run pair --show-url" }`.

**`onUnauthorized(error)`**: call `credentialStore.clear()`, then
`enterUnpaired(describeError(error))`. `describeError` is already exported from
`./ui/view-model` and yields `"Pairing needed (unauthorized): This device is no longer
authorised to reach the harness. …"` for this error, which is exactly the guidance
milestone criterion 5 requires.

### 3. Two traps you must handle explicitly

- **No double-mount.** `enterPaired()` must be safe to reach twice (pair → unauthorized →
  pair again). `createPairingTarget` and `bootstrap` both call `root.replaceChildren(...)`,
  so stale nodes are dropped, but you must not retain a stale `MountHandle` or a stale
  `PairingTarget` and keep painting through it. Null out the one you are leaving before
  constructing the one you are entering. Add a test that runs the full
  pair → unauthorized → pair cycle and asserts the DOM ends with exactly one
  `[data-testid="pairing"]`-free conversation UI and one live handle.
- **`onUnauthorized` fires asynchronously**, from a promise rejection inside `bootstrap()`.
  It can therefore fire *after* `startApp` has returned. Your `AppHandle`'s `paired` and
  `mount` must reflect that later transition — which is the reason they must be live reads.

### 4. The browser entry point

At the bottom of `main.ts`, the `typeof document !== "undefined"` guard currently calls
`bootstrap(root)`. Change it to `startApp(root)`. Nothing else in that guard changes.

Add `startApp` and `createPairingTarget` to `main.ts`'s existing `export { ... }` block so
they survive tree-shaking into the bundle, and export the `AppHandle` and
`PairingSubmitResult` types alongside `MountHandle` and `DomTarget`.

## Acceptance Criteria

These map onto milestone `M12a-ii`'s acceptance criteria 1, 3 and 5. Put the new tests in
`/Users/ryankenny/Projects/phoneToLocalModel/test/web/start-app.test.ts` (new file), using
`happy-dom` as `test/web/ui/dom-target.test.ts` does, and `createMemoryStorage()` for
storage so pairing state is observable across remounts.

- **AC1 (milestone criterion 1).** `startApp(root, { storage, location, ... })` with empty
  storage and an empty `location.hash` renders the pairing view: `root` contains
  `[data-testid="pairing-input"]` and `[data-testid="pairing-submit"]`, and contains
  **no** `[data-testid="prompt-input"]` and no `[data-testid="create-conversation"]`.
  `handle.paired` is `false` and `handle.mount` is `null`.
  **This assertion must fail if the pairing view is removed.**
- **AC2.** With a credential already in storage, `startApp` mounts the conversation UI
  directly: `[data-testid="prompt-input"]` is present, `[data-testid="pairing"]` is
  absent, `handle.paired` is `true`, `handle.mount` is non-null.
- **AC3 (milestone criterion 1, the Safari path is not regressed).** With empty storage
  but `location.hash = "#t=tok-abc"`, `startApp` adopts the fragment and goes **straight**
  to the conversation UI — the pairing view never appears.
- **AC4 (milestone criterion 3, "without a reload").** From the AC1 unpaired state, call
  `handle.submitPairing("https://mac.example.test/app/#t=tok-abc")`. It returns
  `{ ok: true }`; `handle.paired` becomes `true`; `handle.mount` becomes non-null;
  `root` now contains `[data-testid="prompt-input"]` and no `[data-testid="pairing"]` —
  **with no second `startApp` call and no page reload**. Also drive the same transition
  through a real click on `[data-testid="pairing-submit"]` after setting the input's
  `.value`, to prove the wiring works through the DOM and not only through the
  programmatic seam.
- **AC5 (milestone criterion 3, "stays paired across a relaunch").** After AC4, call
  `startApp(freshRoot, { storage: theSameStorage, ... })` — the same `StoragePort`
  instance, a fresh root, simulating a relaunch. It must come up `paired === true`,
  mount the conversation UI, and never show the pairing view.
- **AC6 (milestone criterion 5).** Start paired, with a `createApiClient` whose
  `listProfiles` rejects with `new HarnessApiError("unauthorized", 401, null)`. After the
  rejection settles (`await` a tick), the app is back on the pairing view
  (`[data-testid="pairing"]` present), `handle.paired` is `false`, `handle.mount` is
  `null`, the stored credential has been cleared (`credentialStore.getCredential()` is
  `null` — read it through a fresh store over the same storage), and the pairing view's
  `[data-testid="pairing-message"]` contains both `Pairing needed` and `unauthorized`.
  **It must not be a dead end**: from that state, `submitPairing` with a good token pairs
  successfully again and the conversation UI returns.
- **AC7 (the no-double-mount trap).** Running AC6's full cycle twice leaves `root` with
  exactly one conversation UI and no orphaned pairing section, and `handle.paired` is
  `true` at the end.
- **AC8 (non-unauthorized errors are unchanged).** With `listProfiles` rejecting with a
  **non**-`unauthorized` error, the app stays paired and the message goes to the existing
  notice region — `onUnauthorized` must not fire. This is the assertion that stops the
  new branch swallowing every error.
- **AC9 (no regression to `bootstrap`).** Every existing test in
  `test/web/main-bootstrap.test.ts`, `test/web/bundle-fragment.test.ts`,
  `test/web/ui/bundle-mount.test.ts` and `test/web/ui/bundle-interactive.test.ts` passes
  **byte-for-byte unmodified**. If you believe one of them must change, **stop and report
  it rather than changing it** — a test written for the old behaviour that this milestone
  deliberately supersedes is a decision for the orchestrator, not for you. Say which test,
  what it asserts, and why you think it is superseded.
- **AC10 (milestone criterion 4, the leak check at this level).** After a successful pair
  driven through the DOM, assert `root.innerHTML` does not contain the token, and that
  `main.ts`'s source contains no `document.title` assignment and no write to
  `location.hash` / `location.href`.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/main.ts`
- `/Users/ryankenny/Projects/phoneToLocalModel/test/web/start-app.test.ts` (new)

Nothing else. Do **not** modify `web/src/credential-store.ts`, `web/src/ui/*`,
`package.json`, `web/public/*`, `web/dist/*`, or any existing test file. If the task
appears to require touching one of those, stop and report why.

## Tests

Red first: write the failing tests, watch them fail for the right reason, then implement.

```
cd /Users/ryankenny/Projects/phoneToLocalModel
PATH="$HOME/.bun/bin:$PATH" bun test test/web/start-app.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test
```

Full suite must be **0 fail**. Report the totals before and after.

## Report back

The commands, exit statuses, pass/fail counts; the new test count; whether any existing
test needed to change (and if you think one does, which and why, **without changing it**);
and how you confirmed AC1's assertion genuinely fails when the pairing view is removed.
