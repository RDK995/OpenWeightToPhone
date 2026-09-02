# Task M12a-ii-T5 — Record the M12a-ii architecture deviations

Tier: **Cheap**. No named gate fails: the classification judgement has already been made
by the orchestrator and is fixed below; this task is transcription into an existing,
append-only log with an established format.

## Goal

Milestone `M12a-ii`'s `### Architecture` field says:

> C10, C12. Adding an unpaired state to the app shell is new user-facing surface; record
> whether it warrants a `## Deviations` entry rather than assuming it does not.

The answer is **yes, two entries, both `Material: no`**. Append them to `## Deviations` in
`/Users/ryankenny/Projects/phoneToLocalModel/.harness/architecture.md`.

## Context

- Read the existing `## Deviations` section first (it starts around line 294) and match
  its format exactly: a bold lead sentence naming the milestone and the change, a
  paragraph of explanation, and a final `Material: no` line. Read the `M9` and `M12a-i`
  entries as your models.
- **Append only.** You may not edit any component block, the Interfaces section, the
  Diagram, or anything else in the file. Only the deviation log may be appended to
  without human agreement.
- Do not re-derive the classification. It is fixed below and both entries are
  `Material: no`, because no component boundary moves, no technology choice changes, and
  no responsibility changes owner.

## The two entries to write

**Entry 1 — C5's responsibility line is narrower than the code.** C5 — Credential Store
reads: "Capture the bearer token **from the URL fragment**, clear the fragment, and hold
the credential for the session." It now also captures the token from **text the human
pastes into the app**, via the new `adoptCredentialFromPastedText`, because iOS gives an
installed home-screen app its own storage container and no address bar, so a `#t=` URL can
never reach it. Say that the pasted path **delegates to `adoptCredentialFromFragment`**
rather than duplicating the parse, so there is still exactly one implementation of
token capture and validation. Same class of widening as the `M12a-i` entry already
recorded for C3. No boundary, technology or ownership change. `Material: no`.

**Entry 2 — C10 now has two DOM-touching modules, not one.** The `M9` deviation entry
records that within C10, "`dom-target.ts` is the single DOM-touching module". That is now
narrower than the code: `web/src/ui/pairing-target.ts` also touches the DOM. Say why it is
separate rather than folded into `dom-target.ts` — it renders *before* any conversation UI
exists, when the app holds no credential and every API call would `401`, so it shares none
of `dom-target.ts`'s state, actions map or controller. Note that the DOM-free split the
`M9` entry describes is **unchanged**: `view-model.ts`, `actions.ts` and `mount.ts` remain
DOM-free and their structural tests still enforce it. Note also that the agreed diagram
edge `C10 --> C5` labelled "pairing state" already covers the UI reaching the credential
store, so **no new edge and no new dependency** is introduced — C10's `Depends on: C5, C8,
C9` is unchanged. `Material: no`.

## Acceptance Criteria

- **AC1.** Both entries are appended under `## Deviations`, after the last existing entry.
- **AC2.** Each ends with a `Material: no` line, matching the existing entries' format.
- **AC3.** Nothing else in `.harness/architecture.md` changes. Prove it: snapshot the file
  with `cp` before editing and `diff` after, confirming every hunk is a pure addition at
  the end of the file.
- **AC4.** Hard-wrap the new text at ~95 columns to match its neighbours. (The `M12a-i`
  entry was written unwrapped and a review flagged it as a cosmetic defect — do not repeat
  it.) Use spaced em-dashes, not unspaced.
- **AC5.** `## Status` still reads `AGREED` and is untouched.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/.harness/architecture.md`

Nothing else.

## Tests

```
cd /Users/ryankenny/Projects/phoneToLocalModel
cp .harness/architecture.md /private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/arch-before.md
# ... edit ...
diff /private/tmp/claude-501/-Users-ryankenny-Projects-phoneToLocalModel/991c972a-6be8-4e15-a17e-fad269073d58/scratchpad/arch-before.md .harness/architecture.md
PATH="$HOME/.bun/bin:$PATH" bun test
```

## Report back

The `diff` output, confirming it is a pure append, and the suite result.
