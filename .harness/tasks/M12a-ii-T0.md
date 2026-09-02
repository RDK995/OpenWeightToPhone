# Task M12a-ii-T0 — Archive milestone M11 out of `.harness/milestones.md`

Tier: Cheap. Reason to go above it: none. This is a mechanical, fully specified,
bounded text move with an exact arithmetic oracle.

## Goal

`.harness/milestones.md` is 2539 lines, far above the ~400-line guidance. `M11` is now
the next archive candidate: it is `DONE`, and `M12a-i` has settled after it, so `M11`
is no longer the most recently settled milestone. Move `M11`'s detail into
`.harness/archive/M11.md`, leaving a pointer stub behind.

**Archive `M11` and nothing else.** Do not touch `M12` (BLOCKED — protected),
`M12a-i` (most recently settled — protected), `M12a-ii` (active — protected), or any
other section.

## Context

- The repository root is `/Users/ryankenny/Projects/phoneToLocalModel`. Use absolute paths.
- Bun 1.4.0 is at `~/.bun/bin/bun` and is **not on PATH** in non-interactive shells.
  Export `PATH="$HOME/.bun/bin:$PATH"` if you need it. You almost certainly do not for
  this task.
- Eleven milestones are already archived this way (`.harness/archive/M1.md` …
  `M10.md`). **Read `.harness/archive/M10.md`'s first 20 lines and the M10 stub at
  `.harness/milestones.md` lines 264-286 first, and copy that exact shape.** Consistency
  with the existing convention matters more than your own judgement of a better format.
- At the time you start, `M11`'s section runs from line **287** (`## M11 — Scanning the
  QR code pairs the phone with the harness`) through line **998** (the line immediately
  before line 999, `## M12 — Typing a prompt on the phone drives a conversation end to
  end`). Verify these line numbers yourself before cutting — do not trust them blindly.

## What to do

1. Create `.harness/archive/M11.md`. Follow the shape of `.harness/archive/M10.md`.
2. Move `M11`'s detail there **verbatim, byte for byte**. Moving means the text is
   removed from one file and appears unchanged in the other. **Never summarise,
   reword, reflow, or "tidy" any moved line.**
3. What stays behind in `.harness/milestones.md`, and only this:
   - the `## M11 — …` heading line
   - the blank line and `Status: DONE`
   - the `### Outcome` heading and its body, unchanged
   - a `Detail: ` + backticked `.harness/archive/M11.md` pointer line, placed exactly
     where M10's pointer sits relative to its `### Outcome` body
   Everything from the `### Architecture` heading onward moves to the archive file.
4. Update the "Archiving status" paragraph in the preamble (currently lines 23-30).
   Follow the existing convention exactly: the new paragraph records that **M11 was
   archived by M12a-ii-T0 at the start of M12a-ii's implementation phase**, the
   before/after line counts, and the reconciliation arithmetic. Demote the current
   paragraph to a `Previously (M12-T0, …)` paragraph, matching how the existing
   `Previously (M9-T0, …)` and `Previously (M8-T0, …)` paragraphs are written. Note in
   the new paragraph that M12 is BLOCKED and protected, M12a-i is the most recently
   settled milestone and protected, and M12a-ii is active.

## Acceptance Criteria

- **AC-a.** `.harness/archive/M11.md` exists and contains, byte for byte, every line
  that was removed from `.harness/milestones.md`.
- **AC-b.** In `.harness/milestones.md`, the `## M11` section now consists of only the
  heading, `Status: DONE`, `### Outcome` and its unchanged body, and the `Detail:`
  pointer.
- **AC-c.** The reconciliation balances exactly: `(lines before) - (lines removed) +
  (lines added) = (lines after)`. State the four numbers explicitly in your return.
- **AC-d.** No section other than `## M11` and the preamble's archiving paragraphs is
  changed. Prove this: run `diff` of the file before and after (snapshot it with `cp`
  to `/private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/milestones-before.md`
  first) and confirm every hunk falls inside lines 23-30 or 287-998 of the original.
- **AC-e.** The `## M12`, `## M12a-i`, `## M12a-ii`, `## M12b`, `## M13` and `## M14`
  sections are byte-for-byte identical before and after.
- **AC-f.** Every one of `M11`'s moved lines appears exactly once across the two files
  combined — nothing duplicated, nothing dropped.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/milestones.md`
- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/archive/M11.md` (new)

Change nothing else. No source file, no test file.

## Tests

There is no unit test for this. Your validation is the arithmetic and the diff:

```
cd /Users/ryankenny/Projects/phoneToLocalModel
cp .harness/milestones.md /private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/milestones-before.md
# ... perform the move ...
wc -l /private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/milestones-before.md .harness/milestones.md .harness/archive/M11.md
diff /private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/milestones-before.md .harness/milestones.md
```

Also run, and report the exit status of, the full suite to prove you broke nothing:

```
PATH="$HOME/.bun/bin:$PATH" bun test 2>&1 | tail -5
```

It must still report the same pass count as before your change (it does not read this
file, so it must be unaffected).

## Report back

The four reconciliation numbers, the `wc -l` output, confirmation that the diff hunks
fall only where allowed, and the `bun test` exit status and pass/fail counts.
