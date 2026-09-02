# Task M15-T0 — Archive the M12b milestone entry

Tier: Cheap. Reason to go up: none. Mechanical text move with an arithmetic check.

## Context

`.harness/milestones.md` in `/Users/ryankenny/Projects/phoneToLocalModel` is 1260 lines,
well over the ~400-line archiving threshold. The project's own recorded convention is to
move a settled milestone's detail into `.harness/archive/M<n>.md` verbatim, leaving a stub
behind, and to reconcile the line counts.

**M12b is the archive candidate.** It is `DONE`, and it is no longer the most recently
settled milestone (M13 settled after it on 2026-09-02). M12a-ii is ALREADY archived — do
not touch it. **Do not archive M13** (most recently settled, protected), **M12c**
(already archived), or **M14** (TODO).

## Goal

Move the detail of the `## M12b` entry out of `.harness/milestones.md` into
`.harness/archive/M12b.md`, following the convention the file already demonstrates.

## Exactly what to do

1. `cd /Users/ryankenny/Projects/phoneToLocalModel` and record `wc -l .harness/milestones.md`
   BEFORE the edit.
2. Locate the `## M12b — Changing a conversation's profile actually changes it` section.
   It runs from that heading up to (but NOT including) the next `## ` heading, which is
   `## M12c — The app reads as a phone chat app, not a debug page`.
3. Write the ENTIRE original section, byte-for-byte unchanged, to
   `.harness/archive/M12b.md`. Verbatim — do not summarise, reword, reformat or reflow it.
4. Replace that section in `.harness/milestones.md` with a stub that keeps ONLY:
   - the `## M12b — ...` heading line, unchanged
   - a blank line, then `Status: DONE`, then a blank line
   - the `### Outcome` heading and the FULL, UNCHANGED body of `### Outcome`
   - a blank line, then `Detail: ` followed by a backticked path `.harness/archive/M12b.md`
   Study the shape of the existing `## M12a-ii` stub (around line 421) and the `## M12`
   stub (around line 348) and match it exactly. Drop every other `###` heading
   (Architecture, As-Built, Acceptance Criteria, Baseline, Evidence, Validation, Review,
   Review Cycles, Follow-ups) — their content is preserved in the archive file.
   **Preserve the blank-line spacing between sections that the neighbouring stubs use.**
5. Record `wc -l` AFTER, and `wc -l .harness/archive/M12b.md`.
6. Add a new "Archiving status" paragraph to the preamble of `.harness/milestones.md`,
   inserted as the FIRST archiving-status paragraph (immediately above the existing one
   that begins "Archiving status (performed by M13-T0"), in the same prose style as the
   existing ones. It must state: that M12b was archived at the start of the M15-M19
   planning phase on 2026-09-02; the before -> after line counts; that
   `.harness/archive/M12b.md` holds the moved lines verbatim; the arithmetic
   reconciliation (before - moved + kept = after, with the real numbers); and that
   **M13 is now the most recently settled milestone and is therefore protected**, that
   M12a-ii and M12c were already archived, and that M14 and M15-M19 are forward plans
   rather than accumulated detail.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/milestones.md`
- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/archive/M12b.md` (new)

Change NOTHING else. Do not touch source, tests, other milestones, or the archive's
existing files.

## Acceptance Criteria

1. `.harness/archive/M12b.md` exists and its content is byte-identical to the lines removed
   from `milestones.md` (verify by diffing the archive file against the original section
   extracted from `git`-less backup you take before editing, or by careful comparison).
2. `.harness/milestones.md` still contains `## M12b — Changing a conversation's profile
   actually changes it`, `Status: DONE`, the unchanged `### Outcome` body, and a
   `Detail:` pointer to the archive file.
3. `.harness/milestones.md` no longer contains M12b's Acceptance Criteria / Evidence /
   Validation / Review sections.
4. The line-count arithmetic in the new preamble paragraph is correct and verifiable:
   (lines before) - (lines moved out) + (lines kept in the stub) = (lines after).
5. NO other milestone entry is modified in any way. In particular `## M13`, `## M14`,
   `## M12c` and `## M12a-ii` are byte-identical before and after.
6. The count of `^## M` headings in `milestones.md` is unchanged.

## Tests

There is no unit test for this. Validate with these commands and report their exact output:

```
cd /Users/ryankenny/Projects/phoneToLocalModel
cp .harness/milestones.md /tmp/milestones-before.md   # take this FIRST, before editing
wc -l .harness/milestones.md .harness/archive/M12b.md
grep -c '^## M' .harness/milestones.md
grep -n '^## M12b\|^Detail: `.harness/archive/M12b.md`' .harness/milestones.md
diff <(sed -n '/^## M13 /,$p' /tmp/milestones-before.md) <(sed -n '/^## M13 /,$p' .harness/milestones.md) && echo "M13 UNCHANGED"
diff <(sed -n '/^## M14 /,/^## M13 /p' /tmp/milestones-before.md) <(sed -n '/^## M14 /,/^## M13 /p' .harness/milestones.md) && echo "M14 UNCHANGED"
```

`grep -c '^## M'` must return the same number before and after. The two `diff`s must both
report no differences.

## Notes

Bun 1.4.0 is at `~/.bun/bin/bun` and is not on PATH in non-interactive shells; you do not
need it for this task.
