TASK

Tier: Cheap — no reason to go above it.
Routing reasoning: this is a decision record. It is clearly specified (the exact text to
write is dictated below), bounded (one insertion into one file), low risk (a documentation
entry that changes no behaviour), and easily verified (the full test suite must be unchanged
at 793 pass / 0 fail, since no source file is touched).

Goal:

Record, under `## Deviations` in `.harness/architecture.md`, that milestone `M12a-i` widened
C3's written responsibility and the written `C3 ⇢ C5` channel. The change is **not material** —
it alters no component boundary, no technology choice and no ownership — so it is recorded and
the project continues; you are not asking anyone's permission.

Why this entry exists (the reasoning, which you should preserve in the text you write):

- `.harness/architecture.md` line 87 states C3's responsibility as: "Print a scannable QR
  code carrying the pairing URL for this machine." M12a-i added an explicitly opt-in
  `--show-url` flag that additionally prints the pairing URL as plain text.
- The Interfaces section's `C3 ⇢ C5 (out of band)` entry (around line 181) describes the
  pairing URL as "crossing from the Mac's terminal to the phone by camera". After M12a-i it
  may also cross by the human copying the text. The token still never reaches a server —
  it remains in the URL fragment — so the security property that entry exists to state is
  unchanged.
- Neither line is wrong, but both are now narrower than the code, which is precisely the
  situation the existing `M3 — C8's surface is wider than the C9 -> C8 interface as written`
  entry was written for.

Relevant Requirements:

FR1 — Pairing (`.harness/requirements.md` lines 16-27), whose last bullet is:

> - The CLI does not print the token in plain text by default.

Your entry should note that the default is unchanged and that the affordance is opt-in
precisely because of this clause — that is why the deviation is safe.

Acceptance Criteria:

1. A new entry is added under the `## Deviations` heading in `.harness/architecture.md`
   (the heading is at line 294; entries follow it).
2. It follows the **exact format of the entries already there** — read at least the `M11`
   entry (starts line 296) and the `M1` entry before writing, and match their shape: a bold
   one-line title beginning with the milestone id and an em-dash, then a prose paragraph,
   then a final line reading exactly `Material: no`.
3. Its title begins `**M12a-i — ` and names the widening.
4. The body states: what was added (`--show-url`, an opt-in flag on `src/host/pair.ts`), which
   two written statements are now narrower than the code (C3's responsibility line and the
   `C3 ⇢ C5 (out of band)` interface entry), why the change is not material (no component
   boundary, technology choice or ownership change — C3 still owns pairing output, still lives
   at `src/host/pair.ts`, still depends only on C1 and C2, still realises FR1), and that the
   default output is unchanged and still prints no token, per FR1.
5. The last line of the entry is exactly `Material: no`.
6. **Placement**: insert it as the FIRST entry after the `## Deviations` heading, ahead of the
   existing `M11` entry, so the newest deviation reads first. Preserve the blank-line spacing
   used between existing entries.

Relevant Files:

- `.harness/architecture.md` — the only file you touch. Read line 294 to roughly line 330 to
  see the `## Deviations` heading and the first two existing entries before you write. Also
  read line 85-90 (C3's component block) and line 181-184 (the `C3 ⇢ C5` interface entry) so
  you quote them accurately.
- `src/host/pair.ts` — read it to describe the change accurately. **Do not modify it.**

Files Allowed To Change:

- `.harness/architecture.md`

Nothing else. Do not touch any source file, any test, or any other file under `.harness/`.
In particular do NOT edit `.harness/milestones.md` — the orchestrator owns that file.

Constraints:

- Follow the existing entries' formatting exactly.
- Do not change any other part of `.harness/architecture.md` — not C3's component block, not
  the Interfaces section, not the requirements-to-component table. **Recording the deviation is
  the task; editing the architecture to match it is NOT**, because the agreed architecture is
  a human-agreed document and only the `## Deviations` log may be appended to without agreement.
- Do not add a `Material: yes` entry. If while writing you come to believe the change IS
  material, stop and return BLOCKED with your reasoning instead of recording it either way.

Tests:

There is no unit test for a documentation change. Validate by:

    export PATH="$HOME/.bun/bin:$PATH"
    bun test

It must still report **793 pass / 0 fail** — unchanged, because you touched no code. Report the
totals you actually saw. Also paste the entry you wrote into your Summary so it can be checked
without re-reading the file.

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
