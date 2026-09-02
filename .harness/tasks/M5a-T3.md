# Task M5a-T3 — Fix every remaining semantic type error; close the Last-Event-ID linkage

Tier: Cheap. Reason routed here: none — clearly specified (`tsc --noEmit` must
exit 0), bounded (only the files `tsc` itself names), low risk (type-level
corrections; the test suite must stay green at its current count, which detects
any behaviour change), and trivially verified by an exit code.

## Context

Repo root: /Users/ryankenny/Projects/phoneToLocalModel
Toolchain: Bun 1.4.0 at `~/.bun/bin/bun`, NOT on PATH in non-interactive shells.
Node is not installed. Every command must `export PATH="$HOME/.bun/bin:$PATH"`
or use the absolute path.

Task M5a-T1 made the repository's type declarations resolve. `bun x tsc --noEmit`
went from 130 errors to **26**, and every remaining one is a genuine semantic
error. The last verified histogram was:

```
9 error TS2532   (object is possibly 'undefined' — mostly noUncheckedIndexedAccess)
6 error TS2741   (missing property — mostly fetch mocks)
3 error TS2769   (no overload matches)
2 error TS2339   (property does not exist)
2 error TS2322   (type not assignable)
2 error TS1484   (type-only import required by verbatimModuleSyntax)
1 error TS2345   (argument type mismatch)
1 error TS2314   (generic type requires type arguments)
```

Run `tsc` yourself to get the current, authoritative list — do not work from the
histogram above.

`tsconfig.json` is strict: `strict: true`, `noUncheckedIndexedAccess: true`,
`verbatimModuleSyntax: true`.

### Two errors deserve individual attention

- **`web/src/session-coordinator.ts` around line 391, TS2532** — this is inside
  code added by the immediately preceding task, which reads the reconciled
  assistant turn back out of the conversation store. It is **production code on
  a real fallback path**, not test scaffolding. Fix it by properly narrowing the
  possibly-undefined value (the existing code already intends to fall back to
  `pending.partialText` when there is no assistant turn — make that narrowing
  explicit and correct). Do NOT silence it with `!` or `as`.
- **`test/web/session-coordinator.test.ts` around line 1367, TS2769** — inside a
  newly added test. Fix the types; do not delete or weaken the test.

## Goal

**Part A.** `bun x tsc --noEmit` exits **0** across the whole repository, with the
test suite still green.

**Part B.** Close a small evidence gap. A test added by the previous task asserts
that a resume with `lastSeq === -1` passes `-1` down to `apiClient.resumeEvents`.
The milestone's criterion is about the wire: that the resume actually **sends
`Last-Event-ID: -1`**. Check whether an existing test in
`test/web/api-client.test.ts` already proves that `resumeEvents(..., lastSeq)`
sets the `Last-Event-ID` request header to that value (grep for `Last-Event-ID`).
- If such a test exists, report its name and the assertion — nothing to add.
- If it does not, add one: a focused test that calls `resumeEvents` with
  `lastSeq === -1` and asserts the outgoing request's `Last-Event-ID` header is
  exactly `"-1"`.

## Acceptance criteria for this task

1. `bun x tsc --noEmit` exits 0 and prints no errors.
2. `bun test` passes with **no fewer than 278** tests (the current count). No test
   deleted, skipped (`.skip`/`.todo`/commented out), or given a loosened
   assertion.
3. `bun run build` still succeeds.
4. The type check still covers every project `.ts` file. Report both numbers:
   ```
   bun x tsc --noEmit --listFiles | grep -E '\.ts$' | grep -v node_modules | wc -l
   find . -name '*.ts' -not -path './node_modules/*' -not -path './.git/*' -not -path './.harness/*' | wc -l
   ```
   These were 26 and 26 before this task. The first must not be lower than the
   second.
5. `tsconfig.json` `include` is NOT narrowed, no `exclude` is added, and no
   blanket suppression (`@ts-nocheck`, `skipLibCheck` extended to project files)
   is introduced.
6. **Suppression policy.** Prefer a real fix. If an error genuinely cannot be
   eliminated, suppress it **at its site** with `@ts-expect-error` plus a comment
   saying why, and list every such site in your report. Do not use `any`, `as
   unknown as`, or non-null `!` to paper over an error you could have fixed
   properly — in particular never in `web/src/` or `src/host/` production code.
   Casts inside test fixtures/mocks are acceptable where the mock legitimately
   implements only part of an interface, but say where you used them.
7. Part B is answered: either the existing api-client test is named and quoted,
   or a new one is added and passes.

## Files allowed to change

- Any `.ts` file that `tsc` reports an error in, under `src/`, `scripts/`,
  `test/`, or `web/src/`.
- `test/web/api-client.test.ts` (for Part B).

Do NOT change `tsconfig.json`, `package.json`, or the lockfile — the previous
task settled those and Part A must be reached by fixing code, not by relaxing
configuration.

## Tests / validation to run

```
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/ryankenny/Projects/phoneToLocalModel
bun x tsc --noEmit; echo "TSC_EXIT=$?"
bun test 2>&1 | tail -20
bun run build 2>&1 | tail -10
bun x tsc --noEmit --listFiles | grep -E '\.ts$' | grep -v node_modules | wc -l
find . -name '*.ts' -not -path './node_modules/*' -not -path './.git/*' -not -path './.harness/*' | wc -l
```

## Report back

The tsc exit status; the full list of errors you fixed grouped by file, with a
one-line description of the fix for each; every suppression or cast you
introduced and its justification; the `bun test` count before and after; the
build result; both file counts from criterion 4; and the answer to Part B.
