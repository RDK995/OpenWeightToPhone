TASK

Correction task for M12a-ii cycle-1 review finding **IMPORTANT 1**.
Full finding: `/Users/ryankenny/Projects/phoneToLocalModel/.harness/reviews/M12a-ii-cycle1.md`,
the first fenced `Severity: IMPORTANT` block. Read it there — it names the exact
mutation that must go red.

Routing: **Cheap**. No reason above Cheap: it is clearly specified (the reviewer
wrote the suggested correction), bounded (one existing test file), low risk
(test-only, no production code), and easily verified (a named source mutation
must turn it red).

Goal:
Add one test to `test/web/start-app.test.ts` that drives a **bare token** (not a
full pairing URL) through `startApp` and proves `startApp` supplies the app's own
origin as `currentOrigin`. Today every `startApp` test pastes a full URL, whose
own origin wins and masks the argument at `web/src/main.ts:236`, so mutating that
line to a wrong-origin literal leaves the whole suite green.

Relevant Requirements:
M12a-ii acceptance criterion 2 (derived from FR1): "Pasting a full pairing URL
(`https://<host>/app/#t=<token>`) stores the token and that origin; pasting a bare
token stores it against the current origin. Both leave the app paired in its own
storage container."

Acceptance Criteria:
- AC1. A new `it(...)` in the existing `describe("startApp", ...)` block in
  `test/web/start-app.test.ts`, placed with the other `AC4:` tests (after the
  test at line 208, before the `AC5:` test at line 231), named so it is clearly
  the bare-token case.
- AC2. It starts from the **unpaired** state: `startApp(root, { storage,
  location: createLocation(""), createApiClient: api.factory })` with a fresh
  `createMemoryStorage()`, exactly like the existing AC4 tests.
- AC3. It pairs with a **bare token** — `handle.submitPairing("tok-bare-1234")`,
  or by setting that value on `[data-testid=pairing-input]` and clicking
  `[data-testid=pairing-submit]`.
- AC4. It asserts `createCredentialStore(storage).getCredential()` equals
  `{ baseUrl: ORIGIN, token: "tok-bare-1234" }` — the whole object, so the
  `baseUrl` is genuinely checked and not just the token.
- AC5. It asserts `handle.paired` is `true`, that `[data-testid=prompt-input]`
  is present and `[data-testid=pairing]` is absent (the app really is paired,
  not merely storing a credential).
- AC6. **The detector must bite, and you must prove it.** Temporarily replace
  `location.origin` on `web/src/main.ts:236` with the literal
  `"https://WRONG.example"`, run `bun test test/web/start-app.test.ts`, and
  confirm your new test **FAILS**. Then restore `web/src/main.ts` and confirm
  its SHA-256 is exactly
  `24743340e2cf3763f5867769da1808dd0033bcf5961b2001adca6668dc3b8bbe`
  (`shasum -a 256 web/src/main.ts`). Report both the failing output and the
  restored hash. A restore you did not verify by hash is not a restore.
- AC7. No existing test is renamed, removed, weakened or otherwise modified.
  The file gains exactly one `it(...)` and nothing else. `bun test` goes from
  833 pass to 834 pass, 0 fail.

Relevant Files:
- `test/web/start-app.test.ts` — read it in full. `ORIGIN`, `createTestWindow`,
  `createLocation`, `switchableApiClient`, `q`, `click`, `count` and
  `createCredentialStore` are already imported/defined at the top; reuse them,
  do not re-declare them.
- `web/src/main.ts` lines 232-245 — `onSubmit`, the code under test. Read only;
  the only edit permitted here is the temporary AC6 mutation, which you must
  revert.
- `web/src/credential-store.ts` lines 122-163 — `adoptCredentialFromPastedText`,
  for the bare-token branch's behaviour. Read only.

Files Allowed To Change:
- `test/web/start-app.test.ts`

(`web/src/main.ts` may be mutated **temporarily** for AC6 and must be returned to
the hash above. It is not a permitted change.)

Constraints:
- Follow existing repository patterns — match the style of the neighbouring AC4
  tests exactly.
- Do not change unrelated behaviour. Do not touch production code.
- Do not introduce dependencies.
- Do not weaken tests.
- Do not add any test beyond the one this packet asks for. If you notice
  something else worth testing, put it under `Unresolved Issues`.
- Never run `git stash`, `git checkout --`, `git restore`, `git reset --hard`
  or `git clean`. You share this worktree with the orchestrator and other
  workers. To revert your AC6 mutation, edit that one line back.

Tests:
- `bun test test/web/start-app.test.ts` (focused)
- `bun test` (full suite — must be 834 pass / 0 fail)
- `bunx tsc --noEmit -p tsconfig.json` (must be exit 0 — this repository
  type-checks, and `bun test` will NOT catch a type error. Bun matchers take
  exactly one argument: `expect(x).toBe(y, "message")` is a TS2554 error that
  passes at runtime. Do not write one.)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
