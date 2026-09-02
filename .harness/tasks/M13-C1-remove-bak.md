# Task M13-C1 — Remove the stray `dom-target.ts.bak` debris

## Context

This is a **correction task** answering an IMPORTANT finding from the M13 cycle-1 review.
Read the finding at `.harness/reviews/M13-cycle1.md` — the first IMPORTANT finding, headed
"An untracked leftover file, `web/src/ui/dom-target.ts.bak`". Do not re-derive it; the
report states the problem and the suggested correction.

Routing: **Cheap tier.** None of the four escalation reasons applies — the change is fully
specified, its blast radius is one untracked debris file, being wrong is trivially
detectable, and the validation is a full test run.

## Goal

Delete `web/src/ui/dom-target.ts.bak`, and add a `.gitignore` rule so backup files of this
shape cannot silently reappear in a future revert-and-measure experiment.

## Acceptance Criteria

1. `web/src/ui/dom-target.ts.bak` no longer exists on disk.
2. No other `.bak` / `.orig` / `.rej` debris exists anywhere under `web/`, `src/`, `test/`
   or `scripts/`. Check with `find`; delete any you find and say which in your return.
3. `.gitignore` gains `*.bak` (and only that — do not reorganise the file).
4. `web/src/ui/dom-target.ts` itself is **completely untouched**. Confirm this by recording
   its `md5` before and after your change and showing both in your return; they must match.
5. `bun test` passes with the same count as before (852 pass, 0 fail) and exits 0.
6. `bun x tsc --noEmit` exits 0.

## Files Allowed To Change

- `web/src/ui/dom-target.ts.bak` (delete only)
- `.gitignore`
- any other `*.bak`/`*.orig`/`*.rej` file you find under the directories in AC2 (delete only)

Nothing else. In particular do NOT touch `web/src/ui/dom-target.ts`,
`web/src/ui/view-model.ts`, any test file, or anything under `.harness/`.

## Tests

`bun` is at `~/.bun/bin/bun` and is NOT on PATH in non-interactive shells. Prefix your
commands with `export PATH="$HOME/.bun/bin:$PATH";`.

```
bun test
bun x tsc --noEmit
```

Report the exact command, its exit status, and the pass/fail counts you actually saw.

## Notes

Do not commit anything. Do not run `git stash`, `git checkout`, `git restore` or `git clean`
— the whole working tree is uncommitted work and those commands would destroy it.
