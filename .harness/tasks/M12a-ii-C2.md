TASK

Correction task for M12a-ii cycle-1 review finding **OPTIONAL 1** (the bundle
entry-path finding). Full finding:
`/Users/ryankenny/Projects/phoneToLocalModel/.harness/reviews/M12a-ii-cycle1.md`,
the first fenced `Severity: OPTIONAL` block ("No test proves the shipped bundle's
entry path renders the pairing view"). Read it there.

Routing: **Cheap**. No reason above Cheap: clearly specified (the reviewer wrote
the suggested correction), bounded (one existing test file), low risk (test-only),
easily verified (`bun test` plus a named mutation).

Goal:
Add one test to `test/web/bundle-fragment.test.ts` that imports the **built
bundle** (`web/dist/main.js`) and calls its exported `startApp`, asserting the
pairing view renders. The device runs the bundle, not the source; today both
bundle tests exercise the exported `bootstrap` only, so nothing would catch
`startApp` being lost on the way to `web/dist/main.js` — which is exactly the
defect class `bundle-fragment.test.ts` was created for in M11.

Relevant Requirements:
M12a-ii acceptance criterion 1 (derived from FR1, FR2): "Launched with no stored
credential, the app renders a pairing view with an input for a pairing URL or bare
token ... The assertion must fail if the pairing view is removed." This correction
extends that guarantee from the source to the shipped artefact.

Acceptance Criteria:
- AC1. A new `it(...)` inside the existing `describe("bundle-fragment", ...)`
  block in `test/web/bundle-fragment.test.ts`, added after the existing
  behavioural test. It must use the existing `importBuiltBundle()` helper (which
  already cache-busts) and rely on the existing `beforeAll` that runs `build()`.
- AC2. It asserts `typeof mod.startApp === "function"` — i.e. the export survived
  bundling.
- AC3. It calls `mod.startApp(root, { storage, location, createApiClient })`
  where:
  - `root` is a **real DOM element**. This test file runs with **no `document`
    global** (its first test asserts `typeof document === "undefined"`), so you
    must construct one with `happy-dom`: `import { Window } from "happy-dom"`,
    `const win = new Window(); const root = win.document.createElement("div")`.
    Do **not** introduce a global `document`, and do not disturb the existing
    `it("runs with no document global, ...")` test — it must still pass.
  - `storage` is `createMemoryStorage()` (already imported).
  - `location` is a `LocationPort` with `hash: ""` (empty — no fragment), a real
    `origin`, and a `clearHash()` no-op. `LocationPort` is already imported.
  - `createApiClient` is a stub like the ones already in this file, so no network
    call is attempted.
- AC4. It asserts the pairing view was actually rendered into `root`:
  `root.querySelector('[data-testid="pairing-input"]')` is not null, and
  `root.querySelector('[data-testid="pairing-submit"]')` is not null. Also
  assert the built bundle rendered the real copy — the rendered `root`
  text contains `"Pair this app with your Mac"`.
- AC5. **The detector must bite, and you must prove it.** After the test is
  green, temporarily edit `web/src/ui/pairing-target.ts` so the pairing input is
  not rendered (e.g. delete the `section.appendChild(input);` line), re-run
  `bun test test/web/bundle-fragment.test.ts` (the `beforeAll` rebuilds the
  bundle, so no manual build step is needed) and confirm your new test **FAILS**.
  Then restore `web/src/ui/pairing-target.ts` and confirm its SHA-256 is exactly
  `e58f0e71ffece320d76247c5511334d2ff91dea7e134858f4832e7c561b6b591`
  (`shasum -a 256 web/src/ui/pairing-target.ts`). Report the failing output and
  the restored hash. Then run `bun run build` once so `web/dist/` is left holding
  a bundle built from the restored source, and confirm `bun test` is fully green
  afterwards.
- AC6. No existing test in the file is renamed, removed, weakened or modified.
  `bun test` gains exactly one passing test relative to whatever the count is
  when you start, 0 fail.
- AC7. `web/dist/` is a build output. If the build writes to it, that is expected
  and is not a violation — but do not hand-edit anything under `web/dist/`.

Relevant Files:
- `test/web/bundle-fragment.test.ts` — read it in full. Reuse
  `importBuiltBundle`, the `beforeAll` build, `createMemoryStorage`, the
  `LocationPort` type, and the stub-`createApiClient` pattern already there.
- `web/src/main.ts` lines 186-288 — `startApp`, its `BootstrapDeps` (`storage`,
  `location`, `createTarget`, `createApiClient`, `onUnauthorized`) and the
  browser entry guard. Read only.
- `web/src/ui/pairing-target.ts` — the view being asserted on; gives you the
  `data-testid` values and the heading text. Read only, except for the temporary
  AC5 mutation which you must revert.
- `test/web/start-app.test.ts` lines 25-45 — `createTestWindow` and
  `createLocation`, for the happy-dom + LocationPort idiom this project uses.
  Read only; do not import from a test file.

Files Allowed To Change:
- `test/web/bundle-fragment.test.ts`

(`web/src/ui/pairing-target.ts` may be mutated **temporarily** for AC5 and must be
returned to the hash above. It is not a permitted change. `web/dist/**` is
regenerated by `bun run build` and is expected to differ.)

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour. Do not touch production source permanently.
- Do not introduce dependencies. `happy-dom` is already a dev dependency and is
  used by other tests in `test/web/`.
- **`happy-dom` must not leak into the shipped bundle.** `test/web/bundle-purity.test.ts`
  enforces that `web/dist/main.js` contains no `happy-dom`. Import it in the test
  file only, never from anything under `web/src/`. Confirm `bun test
  test/web/bundle-purity.test.ts` is green before you return.
- Do not weaken tests.
- Do not add any test beyond the one this packet asks for.
- Never run `git stash`, `git checkout --`, `git restore`, `git reset --hard` or
  `git clean`. You share this worktree with the orchestrator and other workers.
  To revert your AC5 mutation, edit that line back.

Tests:
- `bun test test/web/bundle-fragment.test.ts` (focused)
- `bun test test/web/bundle-purity.test.ts` (the happy-dom leak guard)
- `bun test` (full suite — 0 fail)
- `bun run build` (exit 0)
- `bunx tsc --noEmit -p tsconfig.json` (must be exit 0 — this repository
  type-checks and `bun test` will NOT catch a type error. Bun matchers take
  exactly one argument: `expect(x).toBe(y, "message")` is a TS2554 error that
  passes at runtime. Do not write one.)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
