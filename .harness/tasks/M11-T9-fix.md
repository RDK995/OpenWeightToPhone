# Task M11-T9-fix — Make the static bundle assertion discriminating

Tier: **Cheap**, attempt 2 (T9 attempt 1 FAILED on AC-T9.3). Reason for going above Cheap:
**none named**. Single, precisely-stated defect; two files; total oracle (a red/green cycle).

## Previous Attempt

**M11-T9 attempt 1 — Cheap — FAILED on AC-T9.3.** Everything else in T9 was accepted:
`test/web/bundle-fragment.test.ts` exists, the behavioural bundle proof is correct and
genuinely discriminating, `src/host/m11-proof.ts` Phase 2 is rewritten to run the built
bundle's `bootstrap()` and chain the recovered token to a live `200`, `bunx tsc --noEmit` is
clean, `bun test` is 734 pass / 0 fail, and `bun run src/host/m11-proof.ts` exits 0 with four
phases PASS. **Do not redo any of that.**

The defect, confirmed independently: the packet required that removing the
`adoptCredentialFromFragment(credentialStore, location)` call from `bootstrap()` make **both**
the static text assertion and the behavioural assertion fail. Reproduced result was
**3 pass / 1 fail** — only the behavioural one failed.

Root cause: `web/src/main.ts` re-exports `adoptCredentialFromFragment` on its export list, so
the identifier stays in `web/dist/main.js` whether or not anything calls it. With the call
removed the bundle still contained **2** occurrences (down from 3). The assertion
`expect(bundleText).toContain("adoptCredentialFromFragment")` therefore cannot fail while the
export exists — it is a presence check masquerading as a tree-shaking guard.

This matters beyond the letter of the criterion. M11's whole reason for existing right now is
that a **non-discriminating proof** let a broken app ship past 711 green tests. Shipping
another non-discriminating proof in the fix for it is the same mistake twice.

## Goal

Make the static assertion — in **both** places it appears — fail when the adoption call is
removed from `bootstrap()`, while still being a genuine assertion about the built artefact.

## Files Allowed To Change

- `test/web/bundle-fragment.test.ts`
- `src/host/m11-proof.ts` (the Phase 2 bundle-text check only)

Nothing else. **Do not** modify `web/src/main.ts` — in particular, do **not** solve this by
removing the `adoptCredentialFromFragment` export. That export is deliberate and other checks
rely on the bundle exposing it.

## Required change

The assertion must target the **call site inside `bootstrap`**, not the bare identifier.
`scripts/build.ts` sets `minify: false`, so the bundle preserves identifiers and argument
names, and the call appears as `adoptCredentialFromFragment(credentialStore, location)` while
the function's own definition appears as `function adoptCredentialFromFragment(store, location)`
and the export as a bare name in an `export { … }` list.

Note that a naive `/adoptCredentialFromFragment\s*\(/` regex is **also** non-discriminating:
the function *definition* matches it, and the definition survives because the symbol is
exported. Your assertion must distinguish the call from the definition and from the export.

Do this:

1. Assert the bundle contains `function bootstrap(` (so the check below is anchored to real
   bundle structure, and fails loudly if the bundler ever renames the entry function).
2. Assert the bundle contains a **call** to `adoptCredentialFromFragment` whose first argument
   is the credential store — i.e. match `adoptCredentialFromFragment(credentialStore` (a
   regex tolerating whitespace is fine). The definition takes `store`, not `credentialStore`,
   so it cannot satisfy this; the export list has no `(` at all.
3. Keep the existing `URLSearchParams` and `replaceState` assertions and the existing
   `minify: false` comment, and extend that comment to record **why the bare-identifier check
   was insufficient**: the symbol is exported from `main.ts`, so it survives tree-shaking
   whether or not it is called — a bare `toContain("adoptCredentialFromFragment")` passed with
   the wiring removed and was therefore vacuous. State that anyone tightening or minifying the
   build must re-establish that this assertion can still fail, or delete it in favour of the
   behavioural test rather than leaving a check that cannot fail.

Apply the same correction to `src/host/m11-proof.ts` Phase 2. It currently counts occurrences
of `adoptCredentialFromFragment` in the built bundle and fails on `0`, which is vacuous for the
identical reason. Change it to require the **call-site** pattern above. Keep printing a count,
but make the pass/fail condition the call-site match. Print a line such as
`Built bundle wires the fragment adopter into bootstrap(): confirmed` and fail Phase 2 when the
pattern is absent. Do not print any part of the real token, pairing URL or fragment.

## Validation (run these and report exact output)

```
bunx tsc --noEmit
bun test test/web/bundle-fragment.test.ts
bun test
bun run src/host/m11-proof.ts
bun run scripts/build.ts
```

Run `bun run scripts/build.ts` **last** so `web/dist` is left freshly built (`test/build.test.ts`
deletes `web/dist` in its `afterEach`, so a full `bun test` leaves it absent).

**The red/green cycle is the point of this task — it is not optional.**

1. `sha256` `web/src/main.ts` and save a copy outside the repository.
2. Remove **only** the `adoptCredentialFromFragment(credentialStore, location)` call from
   `bootstrap()`. Leave the import and the export list intact.
3. `bun run scripts/build.ts`, then `bun test test/web/bundle-fragment.test.ts`. Record the
   exact output. **The static assertion must now fail, and so must the behavioural one.**
   Report which named tests failed. If only one fails, the task is not done — fix the
   assertion and repeat.
4. Also run `bun run src/host/m11-proof.ts` in this broken state and record that **Phase 2
   FAILs** and the script exits non-zero. (Phases 1, 3 and 4 should be unaffected.)
5. Restore `web/src/main.ts` from your copy, confirm byte-identical by `sha256`, rebuild, and
   record the green runs: `bun test test/web/bundle-fragment.test.ts` and
   `bun run src/host/m11-proof.ts` exit 0 with four phases PASS.
6. Leave the repository in the restored, freshly-built state.

## Constraints

- Never modify `/Users/ryankenny/.openweight-harness/token` (mode 0600).
- Never modify anything under `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`.
- No changes to `package.json`, `scripts/build.ts`, or `web/src/`.
- The proof script's stdout is human-read milestone evidence: no token, pairing URL or fragment
  bytes in it, whole or partial.

## Acceptance Criteria

- AC-T9F.1 With the adoption call removed from `bootstrap()` and the bundle rebuilt,
  `bun test test/web/bundle-fragment.test.ts` fails on **both** the static assertion and the
  behavioural assertion — demonstrated by actually doing it and recording the output.
- AC-T9F.2 With the adoption call removed, `bun run src/host/m11-proof.ts` reports
  **PHASE 2: FAIL** and exits non-zero.
- AC-T9F.3 With the call restored, everything is green: `bunx tsc --noEmit` clean, `bun test`
  0 fail, `bun run src/host/m11-proof.ts` exit 0 with four phases PASS.
- AC-T9F.4 `web/src/main.ts` is byte-identical to its state before this task (sha256 recorded
  before and after), and no file outside the two allowed files changed.
- AC-T9F.5 The comment in the test records why the bare-identifier assertion was vacuous and
  what a future build change must re-establish.
