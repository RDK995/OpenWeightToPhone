# Task M7-T0 — Archive M5a detail out of `milestones.md`

Tier: Cheap
Reason for tier: none of the four fails — this is a mechanical move of a
contiguous block of text between two files, fully specified below, and verified
by reconciling line counts.

Milestone: M7 — Documented harness errors are surfaced meaningfully, not generically
Component: none (harness state file only)

## Context

`.harness/milestones.md` is ~940 lines, past the ~400-line archiving threshold.
`M1`-`M5` detail is already archived under `.harness/archive/`. `M6` is the most
recently settled milestone and MUST NOT be archived. `M5a` is `DONE` and is not
the most recent, so it is the one milestone eligible to move.

The archiving rule is in
`/Users/ryankenny/Tools/AgenticCodingHarness/skills/implement/references/milestones-template.md`
under "Archiving settled milestones". Read it before you start.

## Goal

Move the detail of `## M5a — The repository type-checks, and the resume result matches what it reconciled`
out of `.harness/milestones.md` into a new file `.harness/archive/M5a.md`.

1. Create `.harness/archive/M5a.md` containing the **complete, byte-identical**
   M5a section as it currently stands in `milestones.md` (from its `## M5a — ...`
   heading up to, but not including, the next `## ` heading).
2. In `.harness/milestones.md`, replace that section with exactly:
   - the same `## M5a — ...` heading, unchanged,
   - its `Status: DONE` line, unchanged,
   - its `### Outcome` heading and the full Outcome body, unchanged,
   - a line `Detail: `.harness/archive/M5a.md``
   and nothing else. Keep one blank line between blocks, matching how the already
   archived M1-M5 entries are laid out in the same file — **open
   `.harness/milestones.md` and copy the exact shape of the M1-M5 stubs**, do not
   invent a layout.
3. Move content, never summarise it. Not one word of the moved detail may be
   reworded, reordered or dropped.

## Red -> Green -> Refactor

Not applicable — this is a text move with no code. Verify by reconciliation
instead (see Tests).

## Acceptance Criteria

- AC1 — `.harness/archive/M5a.md` exists and its content is the M5a section
  exactly as it appeared in `milestones.md` before the move.
- AC2 — `.harness/milestones.md` still contains a `## M5a — ...` heading, its
  `Status: DONE` line, its full `### Outcome` body, and a `Detail:` pointer to
  `.harness/archive/M5a.md`.
- AC3 — The M5a stub left behind matches the layout of the existing M1-M5 stubs
  in the same file.
- AC4 — No other milestone section in `.harness/milestones.md` is altered in any
  way. In particular `## M6` and `## M7` are byte-identical to before.
- AC5 — Line counts reconcile: report `wc -l .harness/milestones.md` before and
  after, and `wc -l .harness/archive/M5a.md`, and state the arithmetic showing
  that (lines removed from milestones.md) equals (lines in the archive file minus
  the lines retained in the stub). Show the numbers; do not assert it.

## Files Allowed To Change

- `.harness/milestones.md`
- `.harness/archive/M5a.md` (new)

Nothing else. Do not touch any source file, any test, or any other file under
`.harness/`.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
wc -l .harness/milestones.md .harness/archive/M5a.md
grep -n '^## ' .harness/milestones.md
bun test
bunx tsc --noEmit
```

`bun test` and `bunx tsc --noEmit` must still exit 0 (they were green before;
this task must not change that). `grep -n '^## '` must still list M1 through M11
in the same order.

Report every command, its exit status, and its output.

## Notes

Bun 1.4.0 lives at `~/.bun/bin/bun` and is not on PATH in non-interactive shells.
Export it as shown above.
