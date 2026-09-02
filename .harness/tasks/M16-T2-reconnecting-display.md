# Task M16-T2 — A distinct "reconnecting" generation display state

Tier: Cheap. Reason to go above: none. Additive variant on a discriminated union
plus its render text; bounded, specified, and verified by unit tests.

## Context

M16 makes a dropped stream during a live generation recover instead of erroring.
While the client is recovering, the user must see a distinct reconnecting state —
NOT an error, and NOT a silent hang.

`GenerationDisplay` in `web/src/ui/view-model.ts` (lines 12-20) today has:
`idle | queued | model-loading | streaming | complete | cancelled | error | offline`.

There is no reconnecting variant. `offline` is the nearest thing but is WRONG for
this: it is a terminal, manual-retry surface whose Retry button starts a brand-new
generation rather than resuming the in-flight one.

This task adds the state and its rendering ONLY. It does NOT wire it to any
recovery logic — a later task does that.

## Goal

A `reconnecting` variant exists on `GenerationDisplay`, renders distinct status
text, and is distinguishable from both `error` and `offline`.

## Exactly what to do

1. In `web/src/ui/view-model.ts`, add to the `GenerationDisplay` union, placed
   immediately after the `offline` variant:

   `| { kind: "reconnecting"; attempt: number; draftPrompt: string | null }`

   - `attempt` is the 1-based recovery attempt currently being made.
   - `draftPrompt` carries the user's drafted prompt so it is never lost, exactly
     as the `offline` variant carries one. It is `null` when there is none.

2. In `web/src/ui/dom-target.ts`, `generationStatusText()` is an exhaustive switch
   over `GenerationDisplay`. Add a `case "reconnecting":` arm returning:

   `` `Reconnecting (attempt ${generation.attempt})...` ``

   Place the arm immediately after the `case "offline":` arm. Do not alter any
   other arm's returned string — several tests assert them verbatim.

3. If, and ONLY if, adding the variant makes some other exhaustive switch or type
   check in `web/src` fail to compile, add the minimal arm needed there too, and
   say so explicitly in your return. Do not go looking for places to change.

## Acceptance Criteria

- AC1: `buildViewModel` passes a `{ kind: "reconnecting", attempt: 2, draftPrompt: "hi" }`
  generation through to `ViewModel.generation` unchanged, with `attempt` and
  `draftPrompt` intact.
- AC2: `generationStatusText` for `{ kind: "reconnecting", attempt: 3, draftPrompt: null }`
  returns exactly `Reconnecting (attempt 3)...`.
- AC3: The reconnecting state is distinguishable from `error` and from `offline`:
  its rendered status text is not equal to the `error` text, not equal to `"Offline"`,
  and does not contain the word `Error`. Assert this explicitly.
- AC4: The drafted prompt is preserved: a reconnecting state carrying
  `draftPrompt: "my prompt"` still carries exactly `"my prompt"` after
  `buildViewModel`.
- AC5: Every pre-existing `generationStatusText` arm still returns its exact
  previous string. Prove it by running the existing dom-target tests unchanged.

## Do NOT weaken these

- Do not change the `error` or `offline` variants, their fields, or their rendered
  text. `OFFLINE_MESSAGE` in `dom-target.ts` stays exactly as written.
- Do not modify or delete any existing test.
- `web/src/ui/mount.ts` must NOT gain a DOM import — `test/web/ui/mount.test.ts`
  has a "no bypass access" suite asserting over that file's text.

## Files Allowed To Change

- `web/src/ui/view-model.ts`
- `web/src/ui/dom-target.ts`
- `test/web/ui/` — ADD new tests only (put them in the existing view-model and
  dom-target test files if those exist; otherwise add a new file under `test/web/ui/`)

Nothing else. Do not touch `session-coordinator.ts`, `api-client.ts` or `main.ts`.

## Tests

Red -> Green -> Refactor. Write the failing tests first, in a new `describe` block
named `"reconnecting generation display (M16-T2)"`.

Run and report verbatim, with exit status:

- `~/.bun/bin/bun test test/web/ui/`
- `~/.bun/bin/bun test` (the FULL suite)

**Baseline for the full suite: it is ALREADY RED — 851 pass, 3 fail, 854 tests
across 32 files, all 3 failures in `test/host/pair.test.ts` (`renderPairing`).**
Those 3 are pre-existing and unrelated. Your bar is: still exactly those 3 failures
and no others, with the pass count increased by the tests you added. Report exact counts.

Also run and report: `~/.bun/bin/bun run scripts/build.ts` and
`~/.bun/bin/bunx tsc --noEmit` (report its output even if already failing at
baseline; say so if so).

Note: `bun` is at `~/.bun/bin/bun` and is NOT on PATH in non-interactive shells.

## Out Of Scope

No recovery logic. No retry. No backoff. No timers. No lifecycle listeners. Do not
set this state anywhere — nothing may produce a `reconnecting` value yet except tests.
