# Task M16-T0 — Archive M13 out of milestones.md

Tier: Cheap. Reason to go above: none. Mechanical move of text between two files,
fully specified, bounded, and verified by arithmetic on `wc -l`.

## Context

`.harness/milestones.md` is 1837 lines, far above the harness's ~400-line guidance.
The harness rule: at the start of an implementation phase, move *settled* milestones'
accumulated detail into `.harness/archive/M<n>.md`, leaving behind only a stub.

Settled = DONE, or closed out short of DONE by a recorded human decision.

Protected, and MUST NOT be touched: M16 (active this phase), M15 (the most recently
settled milestone), and every milestone that is a forward plan (M17, M18, M19, M14).
M1-M12c are already archived — they are stubs carrying `Detail:` pointers already.

The one archive candidate this phase is **M13**, which is DONE and settled before M15.

## Goal

Move the accumulated detail of `## M13 — The app degrades honestly when the Mac is
unreachable or the transcript is long` out of `.harness/milestones.md` and into a new
file `.harness/archive/M13.md`, leaving a stub in its place.

## Exactly what to do

1. Locate the section: it starts at the line `## M13 — The app degrades honestly when
   the Mac is unreachable or the transcript is long` and runs to the END OF FILE (it is
   the last `## ` section in the file). Confirm this with
   `grep -n '^## ' .harness/milestones.md` before touching anything.

2. Create `.harness/archive/M13.md` containing, VERBATIM and byte-for-byte unchanged,
   every line of that section. Do not summarise, reword, reformat, reflow, or re-wrap
   a single line. Prepend nothing except a single leading line
   `# M13 — archived detail (moved verbatim from .harness/milestones.md)` followed by a
   blank line.

3. In `.harness/milestones.md`, REPLACE that whole section with a stub consisting of
   exactly, in this order:
   - the original `## M13 — ...` heading line, unchanged
   - a blank line
   - the original `Status: DONE` line, unchanged
   - a blank line
   - the original `### Outcome` heading and its body, copied VERBATIM (this stays
     behind; it is the one part that is NOT only in the archive)
   - a blank line
   - the line: `Detail: `.harness/archive/M13.md``
   - a trailing blank line

   Match the shape of the existing already-archived stubs — look at the M12b stub
   (`grep -n -A 40 '^## M12b' .harness/milestones.md`) and copy its structure exactly.

4. Update the archiving-status preamble at the TOP of `.harness/milestones.md`. Insert
   a NEW paragraph immediately after line 22 (i.e. as the newest entry, above the
   existing `Archiving status (performed by M15-T0, ...)` paragraph). It must state:
   - that it was performed by M16-T0, at the start of M16's implementation phase, on
     2026-09-02
   - that M13 was archived
   - the before -> after line counts of `.harness/milestones.md` and the reconciliation
     arithmetic, in the same style as the existing paragraphs
     (before - moved + stub_kept + lines_added_by_this_paragraph = after)
   - that **M15 is now the most recently settled milestone and is therefore protected**,
     M16 is active, and M17/M18/M19/M14 are forward plans rather than accumulated detail

   Do NOT edit, reword or delete any of the existing archiving-status paragraphs.

## Acceptance Criteria

- AC1: `.harness/archive/M13.md` exists and contains the moved lines verbatim.
  Prove it: `diff <(git show HEAD:.harness/milestones.md 2>/dev/null | sed -n '<start>,$p') ...`
  is NOT required (the file is untracked); instead prove it by extracting the section from
  a pre-edit copy you take yourself before editing (e.g. `cp .harness/milestones.md
  /tmp/m16t0-before.md`) and `diff`ing the moved range against the archive file body.
  The diff must be empty apart from the one added title line and blank line.
- AC2: `.harness/milestones.md` no longer contains M13's detail, but DOES still contain
  the `## M13` heading, its `Status: DONE`, its full `### Outcome`, and a `Detail:` line
  pointing at `.harness/archive/M13.md`.
- AC3: No other milestone section is modified. Prove it:
  `diff <(sed -n '1,<line before M13 heading>p' /tmp/m16t0-before.md) <(sed -n '1,<same>p' .harness/milestones.md)`
  differs ONLY by the newly inserted preamble paragraph from step 4, and by nothing else.
- AC4: The line-count reconciliation in the new preamble paragraph is arithmetically
  correct against the actual before/after `wc -l` values. Compute it, do not guess it.
  Report the exact arithmetic in your return.
- AC5: `grep -c '^## ' .harness/milestones.md` returns the SAME count as before the edit
  (no milestone heading gained or lost).

## Files Allowed To Change

- `.harness/milestones.md`
- `.harness/archive/M13.md` (new)

Nothing else. Do not touch any source file, any test, or any other `.harness/` file.

## Tests

There is no unit test for this task. Your validation is the arithmetic and the diffs
named in AC1-AC5. Run each one and report its actual output.

Additionally run, and report exit status verbatim:
- `wc -l .harness/milestones.md` before and after
- `grep -n '^## ' .harness/milestones.md` after
- `grep -c '^## ' .harness/milestones.md` before and after

## Out Of Scope

Do NOT archive M15. Do NOT archive or alter M16, M17, M18, M19 or M14. Do NOT touch
`.harness/architecture.md` or `.harness/requirements.md`. Do not "tidy" anything.
