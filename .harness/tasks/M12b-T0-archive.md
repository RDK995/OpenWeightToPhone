# Task M12b-T0 — Archive settled milestones M12 and M12a-i

Tier: Cheap. Reason to go above: none — pure mechanical text movement, fully
specified, bounded to two files, verified by line-count reconciliation.

## Goal

`.harness/milestones.md` is 2540 lines, far past the harness's ~400-line
archiving threshold. Move the detail of the two settled milestones that are
eligible into `.harness/archive/`, leaving stubs behind.

**Eligible: `## M12` and `## M12a-i` only.**
Do NOT archive `## M12a-ii` (it is the most recently settled milestone and the
rule protects it), and do NOT touch `## M12b`, `## M12c`, `## M13`, `## M14`,
or any milestone that already has a `Detail:` pointer.

## Exact procedure

Working directory: /Users/ryankenny/Projects/phoneToLocalModel

1. Record `wc -l .harness/milestones.md` before you start.
2. Find the exact line ranges: `grep -n '^## ' .harness/milestones.md`.
   - `## M12 — ...` starts at ~line 326 and runs to the line before `## M12a-i`.
   - `## M12a-i — ...` starts at ~line 1418 and runs to the line before `## M12a-ii`.
   Confirm the real numbers yourself; do not trust these.
3. For each of the two milestones, write the **entire section, byte-for-byte
   unchanged**, to `.harness/archive/M12.md` and `.harness/archive/M12a-i.md`
   respectively. Content unchanged — **move, never summarise, never reword,
   never reformat**. These archive files do not exist yet; create them.
4. Replace each section in `.harness/milestones.md` with a stub consisting of
   exactly, and only:
   - the original `## ` heading line, verbatim
   - a blank line
   - the original `Status: DONE` line, verbatim
   - a blank line
   - the original `### Outcome` heading and its full body text, verbatim
   - a blank line
   - `Detail: ` followed by a backticked path — `.harness/archive/M12.md` or
     `.harness/archive/M12a-i.md`
   - a blank line
   Match the stub formatting of the milestones already archived in this file
   (look at `## M9`, `## M10`, `## M11` in milestones.md — copy their exact
   stub shape, including whether `Detail:` is backticked and the blank-line
   placement).
5. Reconcile: `wc -l` on milestones.md after, plus `wc -l` on both new archive
   files. Report all the numbers. The lines removed from milestones.md must
   account for the lines written to the archives (minus the stub lines you
   left behind). Report the arithmetic explicitly.

## Files Allowed To Change

- `.harness/milestones.md`
- `.harness/archive/M12.md` (new)
- `.harness/archive/M12a-i.md` (new)

Nothing else. Do not touch any source file, any test, or `package.json`.

## Acceptance Criteria

- AC1: `.harness/archive/M12.md` and `.harness/archive/M12a-i.md` exist and
  contain the moved sections byte-for-byte unchanged from the original.
- AC2: `.harness/milestones.md` still contains `## M12`, `## M12a-i`,
  `## M12a-ii`, `## M12b`, `## M12c`, `## M13`, `## M14` headings, in the same
  order as before.
- AC3: The `## M12a-ii` and `## M12b` sections are **completely unmodified** —
  verify with a diff of those ranges against git stash / a pre-edit copy.
- AC4: milestones.md line count is reduced by roughly 1200 lines.

## Tests

There is no unit test for this. Validate by:
```
cp .harness/milestones.md /tmp/m-before.md      # BEFORE you edit
# ... make the edits ...
wc -l /tmp/m-before.md .harness/milestones.md .harness/archive/M12.md .harness/archive/M12a-i.md
grep -n '^## ' .harness/milestones.md
# prove M12b is untouched:
sed -n '/^## M12b/,/^## M12c/p' /tmp/m-before.md > /tmp/m12b-before.txt
sed -n '/^## M12b/,/^## M12c/p' .harness/milestones.md > /tmp/m12b-after.txt
diff /tmp/m12b-before.txt /tmp/m12b-after.txt && echo "M12b UNTOUCHED: PASS"
# prove M12a-ii is untouched:
sed -n '/^## M12a-ii/,/^## M12b/p' /tmp/m-before.md > /tmp/m12aii-before.txt
sed -n '/^## M12a-ii/,/^## M12b/p' .harness/milestones.md > /tmp/m12aii-after.txt
diff /tmp/m12aii-before.txt /tmp/m12aii-after.txt && echo "M12a-ii UNTOUCHED: PASS"
# prove the archived content round-trips:
sed -n '/^## M12 —/,/^## M12a-i/p' /tmp/m-before.md | head -n -1 > /tmp/m12-orig.txt
diff /tmp/m12-orig.txt .harness/archive/M12.md && echo "M12 ARCHIVE EXACT: PASS"
```
Report every command and its exit status.

Also run the repository test suite to prove you broke nothing:
```
export PATH="/Users/ryankenny/.bun/bin:$PATH" && bun test
```
(Note: `bun` is NOT on the default PATH. You must export that PATH first.)
Expected: 837 pass, 0 fail.

## Notes

`bun` lives at `/Users/ryankenny/.bun/bin/bun` and is not on PATH by default.
