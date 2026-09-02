# Task M5a-T1 — Make the whole-repo type check resolve its declarations

Tier: Cheap. Reason routed here: none — clearly specified (a named set of error
codes must disappear), bounded (two config files plus lockfile/node_modules),
low risk (type-check configuration only; it does not change runtime behaviour or
the build), and easily verified (`tsc` error counts by code).

## Context

Toolchain: Bun 1.4.0 at `~/.bun/bin/bun`, NOT on PATH in non-interactive shells.
Node is not installed. Every command must `export PATH="$HOME/.bun/bin:$PATH"`
or use the absolute path. Repo root: /Users/ryankenny/Projects/phoneToLocalModel

`bun x tsc --noEmit` currently exits 1 with 130 errors. Roughly 95 of them are
declaration-resolution noise rather than real type errors:

- **TS2591** (~50) `Cannot find name 'Bun' / 'process'` etc. — no Bun/Node type
  declarations are available. `node_modules` is absent and no type package is
  declared in `package.json`.
- **TS5097** (~23) — an import path ending in `.ts` is not allowed under the
  current `tsconfig.json`.
- **TS2307** (~10) `Cannot find module ...` — expected to clear once the two
  above are addressed; confirm rather than assume.
- **TS2503** (1) `Cannot find namespace ...`.
- **TS2868** (3) — check whether these are config-related or semantic; if
  semantic, LEAVE them, they belong to a later task.

Current `tsconfig.json` sets `noEmit: true`, `moduleResolution: "bundler"`,
`strict: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`,
and `include: ["src", "web/src", "scripts", "test"]`.

## Goal

Make the repository's type declarations resolve, so that `bun x tsc --noEmit`
reports ONLY genuine semantic type errors. Do not fix semantic errors in this
task — a later task owns those.

## Acceptance criteria for this task

1. `bun x tsc --noEmit` reports **zero** errors with codes TS2591, TS5097,
   TS2307 and TS2503.
2. The total error count is materially lower than 130 and every remaining error
   is a genuine semantic error (a real type mismatch in the source), not a
   missing declaration or a disallowed import form.
3. `bun test` still passes with no fewer than 276 tests passing.
4. `bun run build` (the `build` script) still succeeds.
5. `tsc` still covers every `.ts` file in the repository — do NOT narrow
   `include`, and do NOT add `exclude` entries, `// @ts-nocheck`, or
   `skipLibCheck`-style suppression of project files to reach the goal.

## Files allowed to change

- `package.json`
- `tsconfig.json`
- `bun.lock` / `bun.lockb` (lockfile, if the package manager writes one)
- `node_modules/**` (installed dependencies; gitignored)

Nothing under `src/`, `web/`, `test/` or `scripts/` may be edited by this task.

## Suggested approach (not binding)

Declare the Bun type package as a devDependency and install it, then reference
it from `tsconfig.json` (`compilerOptions.types`). For the `.ts` import
extensions, `allowImportingTsExtensions` is permitted because `noEmit` is
already true. Verify rather than assume — report what you actually did.

## Tests / validation to run

```
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/ryankenny/Projects/phoneToLocalModel
bun x tsc --noEmit 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c | sort -rn
bun x tsc --noEmit 2>&1 | grep -c 'error TS'
bun test 2>&1 | tail -20
bun run build 2>&1 | tail -20
```

## Report back

The exact edits made, the before/after error-code histogram, the total error
count after, the `bun test` pass count, and the `bun run build` result. If any
of TS2591/TS5097/TS2307/TS2503 survives, say which and why.
