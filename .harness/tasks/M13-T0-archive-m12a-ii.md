TASK  (M13-T0 — archive M12a-ii out of milestones.md)

Tier: Cheap. Reason for tier: none — a precisely-bounded verbatim move of a known line
range, with a line-count reconciliation as its oracle.

Goal:
`.harness/milestones.md` is 1484 lines, far past the ~400-line guidance. Move the detail of
milestone **M12a-ii** (and ONLY M12a-ii) into `.harness/archive/M12a-ii.md`, leaving a
pointer stub behind, exactly as M1-M11 and M12/M12a-i were already archived in this file.

Background you need, and must not exceed:
The file's own header already names M12a-ii as the next archive candidate: M12b is the most
recently settled milestone and is protected; M12c is DEFERRED and already archived; M13 is
the milestone now in flight; M14 is a forward plan. You are archiving exactly one milestone.

Read `.harness/archive/M12a-i.md` and the M12a-i stub inside `.harness/milestones.md` FIRST
and copy their shape exactly. Do not invent a new format.

Acceptance Criteria:
- `.harness/archive/M12a-ii.md` is created and contains the moved content **verbatim** —
  byte-for-byte the lines removed from `milestones.md`, not summarised, not reworded, not
  reformatted, nothing dropped. If the existing archive files begin with a one-line banner
  naming the milestone, match that convention and count that banner in your reconciliation.
- In `.harness/milestones.md`, the `## M12a-ii — ...` section is reduced to exactly:
  its `## ` heading (unchanged wording), its `Status:` line (unchanged), an `### Outcome`
  heading with the outcome text unchanged, and a final line
  ``Detail: `.harness/archive/M12a-ii.md` ``.
  Every other heading and all evidence under M12a-ii moves to the archive file.
- **No other milestone is touched.** M1-M12, M12a-i, M12b, M12c, M13 and M14 are
  byte-identical before and after, including M13's `Status: IN_PROGRESS` and its
  `### Baseline` block. Verify this — do not assume it.
- A new archiving-status paragraph is added to the header block at the top of
  `milestones.md`, immediately above the paragraph beginning "Archiving status (last
  performed by the implement skill directly", matching the wording style of the paragraphs
  already there. It must state: performed by M13-T0 at the start of M13's implementation
  phase; that M12a-ii was archived; the before and after `wc -l` of `milestones.md`; the
  `wc -l` of the archive file written; and the arithmetic reconciliation. It must also state
  which milestone is now the protected most-recently-settled one and which is the next
  archive candidate.
- The reconciliation actually reconciles: (lines before) - (lines removed) + (lines of stub
  and new header paragraph added) = (lines after). Compute it from real `wc -l` output, do
  not estimate. If it does not reconcile, stop and report BLOCKED rather than adjusting the
  numbers to fit.

Relevant Files:
- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/milestones.md` (M12a-ii is at lines
  414-1025 as of the start of this task; re-locate it yourself rather than trusting these
  numbers, since the file has been edited since.)
- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/archive/M12a-i.md` (read-only —
  the format to copy)

Files Allowed To Change:
- `.harness/milestones.md`
- `.harness/archive/M12a-ii.md`

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour.
- Do not introduce dependencies unless required.
- Do not weaken tests.
- Move content; never summarise, condense or drop it. This is the project's evidence record.
- Touch no source code and no test. This task changes harness state only.

Tests:
Reconciliation, not a test suite. Run and report the literal output of:
  wc -l .harness/milestones.md            (before, and after)
  wc -l .harness/archive/M12a-ii.md       (after)
and prove no other milestone changed, e.g. by diffing the pre-edit and post-edit file with
the M12a-ii range excluded, or an equivalent check you state explicitly.

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
