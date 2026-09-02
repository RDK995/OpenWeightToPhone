TASK

Tier: Cheap (attempt 1). Routing reason: none of the four escalation reasons fails. This is a
pure text move with an exact, countable success condition.

Goal:
Archive milestone **M9**'s detail out of `.harness/milestones.md` into
`.harness/archive/M9.md`, following the archiving rule already demonstrated by the nine
existing archive files (`.harness/archive/M1.md` … `M8.md`).

Relevant Requirements:
`.harness/milestones.md` is 1642 lines against a ~400-line threshold. M9 is `DONE` and M10 is
also `DONE`, so M10 is the protected most-recently-settled milestone and M9 is now archivable.

Acceptance Criteria:
- **Read `.harness/archive/M8.md` FIRST and copy its exact structure and heading style.**
  Whatever convention those files use is the convention — do not invent a new one.
- In `.harness/milestones.md`, the `## M9 — The chat view and conversation list drive the
  client in the browser` section currently spans lines 236–536 (heading at 236, `Status: DONE`
  at 238, next `## ` heading `## M10` at line 537). After your change that section must retain
  **only**:
  - its `## M9 — ...` heading, unchanged verbatim
  - its `Status: DONE` line, unchanged verbatim
  - its `### Outcome` heading and the full `### Outcome` body, unchanged verbatim
  - a `Detail:` pointer line to `.harness/archive/M9.md`, in whatever exact form
    `.harness/archive/M1.md`'s counterpart stub in milestones.md uses — check how an
    already-archived milestone (M1–M8) is stubbed in milestones.md and match it exactly.
- **Everything else from the M9 section moves, unchanged, character for character**, into
  `.harness/archive/M9.md` — `### Architecture`, `### As-Built`, `### Acceptance Criteria`,
  `### Baseline`, `### Evidence`, `### Validation`, `### Review`, `### Review Cycles`,
  `### Follow-ups`. **Move content; never summarise, condense, reword or drop it.**
- `.harness/archive/M9.md` must open with a heading identifying the milestone, matching the
  style of `.harness/archive/M8.md`.
- **Do not touch any other milestone.** M10, M11, M12, M13 and M1–M8 must be byte-identical
  before and after. Do not touch M11 at all — another agent is working in it concurrently.
- Do not touch any file outside the two named below.

Relevant Files:
- `.harness/milestones.md` — the source
- `.harness/archive/M8.md` — the format to copy
- `.harness/archive/` — the existing archive files, for the stub convention

Files Allowed To Change:
- `.harness/milestones.md`
- `.harness/archive/M9.md` (new)

Constraints:
- Follow existing project conventions.
- Never summarise; this is a move, not a rewrite.
- Do not modify M11 — it is being edited concurrently by another agent.

Tests:
This task has no unit test. Verify it mechanically and report the numbers:
1. `wc -l .harness/milestones.md` before and after, and `wc -l .harness/archive/M9.md`.
   Report all three. The lines removed from milestones.md must be accounted for by the lines
   written to the archive file (allow a small delta for the added `Detail:` pointer line and
   the archive file's own heading — state the delta and explain it).
2. `grep -n '^## ' .harness/milestones.md` after the change — confirm every milestone heading
   M1..M13 is still present.
3. `grep -c '^## M11' .harness/milestones.md` returns 1, and
   `sed -n '/^## M11/,/^## M12/p' .harness/milestones.md | wc -l` — report it so the
   orchestrator can confirm M11 was untouched.
4. Confirm M9's `Status: DONE` line and `### Outcome` body are still in milestones.md.

Return:
- Summary
- Files changed
- Tests run
- Test result (the counts above)
- Unresolved issues
