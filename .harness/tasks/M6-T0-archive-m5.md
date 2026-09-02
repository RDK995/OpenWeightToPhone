# Task M6-T0 — Archive milestone M5's detail out of milestones.md

Tier: Cheap
Reason for tier: none — mechanical file move with an exact line-count oracle.

## Goal

`.harness/milestones.md` is 959 lines, past the 400-line archiving threshold.
Move the **detail** of milestone **M5** (and only M5) into
`.harness/archive/M5.md`, content unchanged, leaving a stub behind.

M1-M4 are already archived. M5a is the most recently settled milestone and is
**protected** — do not touch it. M6 onward are not settled — do not touch them.

## Exact steps

All paths relative to `/Users/ryankenny/Projects/phoneToLocalModel`.

1. Record `wc -l .harness/milestones.md` BEFORE (expect 959).
2. The M5 section runs from the line `## M5 — A dropped stream resumes with no gaps and no duplicates`
   (currently line 119) up to but **not including** the line
   `## M5a — The repository type-checks, and the resume result matches what it reconciled`
   (currently line 415). Verify these line numbers with `grep -n '^## M5'` before cutting —
   do not trust the numbers above blindly.
3. Write the **entire** cut range verbatim, byte for byte, into a NEW file
   `.harness/archive/M5.md`. Do not reformat, do not renumber, do not summarise,
   do not drop trailing blank lines within the range.
4. Replace that range in `.harness/milestones.md` with exactly this stub
   (using M5's real `### Outcome` text, copied verbatim from the archived content):

```
## M5 — A dropped stream resumes with no gaps and no duplicates

Status: DONE

### Outcome

<M5's existing Outcome text, unchanged, copied verbatim>

Detail: `.harness/archive/M5.md`

```

   Keep exactly one blank line between the stub and the `## M5a` heading that follows.
5. Record `wc -l` AFTER for both `.harness/milestones.md` and `.harness/archive/M5.md`.

## Acceptance Criteria

- AC1 — `.harness/archive/M5.md` exists and contains the full original M5 section
  verbatim, including every `### ` heading M5 had (`### Outcome`, `### Architecture`,
  `### As-Built`, `### Acceptance Criteria`, `### Baseline`, `### Evidence`,
  `### Validation`, `### Review`, `### Review Cycles`, `### Follow-ups`).
- AC2 — `.harness/milestones.md` still contains a `## M5 — ...` heading with
  `Status: DONE`, an `### Outcome` whose text is byte-identical to the archived one,
  and a line `Detail: \`.harness/archive/M5.md\``.
- AC3 — Line counts reconcile: (lines removed from milestones.md) + (lines in the
  stub) == (lines written to archive/M5.md). State the arithmetic explicitly in
  your return: before, after, archive size, stub size, and the check.
- AC4 — No other milestone section changed. `grep -c '^## M' .harness/milestones.md`
  is unchanged (12), and `git diff`-equivalent inspection shows no edits outside
  the M5 range. In particular M5a's and M6's sections are byte-identical to before.
- AC5 — No file outside `.harness/` is touched.

## Files Allowed To Change

- `.harness/milestones.md`
- `.harness/archive/M5.md` (new)

## Tests

There is no unit test for this. Validate mechanically and show the output of each:

```
wc -l .harness/milestones.md .harness/archive/M5.md
grep -n '^## M' .harness/milestones.md
grep -n '^### ' .harness/archive/M5.md
sed -n '/^## M5 —/,/^## M5a/p' .harness/milestones.md
```

Also confirm M6's section is intact:
```
sed -n '/^## M6 —/,/^## M7/p' .harness/milestones.md | head -50
```

## Notes

Take a safety copy first (`cp .harness/milestones.md /tmp/milestones.bak`) and
diff against it at the end to prove nothing outside the M5 range moved:
```
diff <(grep -v -f /dev/null /tmp/milestones.bak) .harness/milestones.md | head -40
```
State files have been lost to rewrites assumed to have worked. Prove it worked.
