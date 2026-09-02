# Task M16-T5 — The live proof, including AC14's falsifiability control

Tier: **Top** (`opus`). Named reason: **not low risk, and no clean test oracle.** The
proof manipulates a SECOND repository (the harness) and must restore it exactly; a
mistake here silently undoes M15's shipped fix, and nothing in this project's test
suite would detect that. It is also a live end-to-end script whose correctness cannot
be settled by a unit test.

DEPENDS ON: M16-T1, M16-T2, M16-T3, M16-T4.

## Context

The harness is a SEPARATE repository at `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`.
M15 fixed a cold-load stream death there by setting `idleTimeout` on the harness's
`Bun.serve` (`harness/api/server.ts`, `idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS,`).

**AC14 requires the client fix to be proven independently of the harness fix**: with the
harness `idleTimeout` change reverted, a killed stream must STILL yield the full answer
via the client's resume path. The two fixes must be separately falsifiable so neither
can mask the other's regression.

**Read `src/host/m15-proof.ts` first — especially its `PHASE REVERT-CONTROL` (lines
~927-1130).** It already solves the dangerous half of this: it reverts `idleTimeout` by
creating a **detached git worktree** at `REVERT_BASELINE_COMMIT` (line ~944:
`git -C $HARNESS_REPO worktree add --detach ...`), runs the pre-fix harness from that
worktree, and removes the worktree afterwards. **The live harness working tree is never
modified.** Reuse that pattern. It is the whole reason this is safe.

Do NOT `git checkout` / `git stash` / edit files in the harness's main working tree.

## Goal

`src/host/m16-proof.ts`, runnable as `bun run proof:m16`, proving M16's acceptance
criteria against the LIVE harness — not a mock.

## Exactly what to do

Write `src/host/m16-proof.ts` and add `"proof:m16": "bun run src/host/m16-proof.ts"`
to `package.json`'s scripts. Follow `m15-proof.ts`'s structure, console output style,
per-phase PASS/FAIL lines, and final summary block.

Phases it must contain, each printing the commands it ran and their real output:

- **PHASE HEADER-ON-FAILURE** — a failing gateway status (502) from `generate()`
  carrying `x-generation-id` yields a resume point with **no SSE event received at
  all**, and recovery produces the full answer. Never surfaces `http_502`.
- **PHASE MIDSTREAM-DROP** — a 200 stream killed after some deltas is recovered, and
  the reconciled text has no gaps and no duplicates. This is the second, separately
  exercised entry path.
- **PHASE BACKOFF** — a run that recovers only after MORE THAN ONE attempt, printing
  the observed attempt count and delays.
- **PHASE BUDGET** — a run that exhausts the 300s wall-clock budget and **does** surface
  an error. Do not actually wait 300s of real time: drive the coordinator with an
  injected clock, and say plainly in the output that the clock was injected and why.
- **PHASE REVERT-CONTROL (AC14)** — the falsifiability control. Using the m15-proof
  worktree pattern, run a harness built from the pre-`idleTimeout` commit, kill a
  stream against it, and show the client STILL yields the full answer via resume. This
  is what proves the client fix stands alone.
- **PHASE NO-REGRESSION** — run `bun run src/host/m7-proof.ts` and report its verdict
  lines, proving the two protected behaviours still hold (see below).

### Restoring the harness — non-negotiable

- Use a detached worktree; never touch the harness's main working tree.
- Wrap every phase that creates a worktree in `try { } finally { }` so the worktree is
  removed **even on failure or throw**.
- Record and PRINT `git -C $HARNESS_REPO rev-parse HEAD` and
  `git -C $HARNESS_REPO status --porcelain` **before and after** the whole run, and
  assert they are IDENTICAL. Print both, and FAIL loudly if they differ.
- Assert at the end that `harness/api/server.ts` in the main tree still contains
  `idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS,`. A proof that leaves the harness
  reverted would silently undo M15 — this assertion is what makes that impossible.

`ollama stop` is permitted to force a deterministic cold start.

## Acceptance Criteria

- AC1: `bun run proof:m16` runs end to end and prints a final summary with an explicit
  PASS/FAIL per phase and an overall verdict.
- AC2: Every phase above is present and actually exercises the live harness (except the
  BUDGET phase's injected clock, which must be declared as such).
- AC3: The harness repo's HEAD and `git status --porcelain` are byte-identical before
  and after the run, asserted by the proof itself and printed.
- AC4: `harness/api/server.ts` still contains `idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS,`
  after the run, asserted by the proof.
- AC5: Any worktree created is removed, including on the failure path. Prove it by
  printing `git -C $HARNESS_REPO worktree list` at the end.
- AC6: The proof exits non-zero if any phase fails. It must be capable of failing —
  do not write a script that always prints PASS.

## Do NOT weaken these

1. `src/host/m7-proof.ts` Phase C (lines 458-509): an **undocumented SSE error code on
   a 200 response** maps to `documented: false` / `action: "report"`. Different from an
   undocumented HTTP status. Must keep passing unchanged.
2. `test/web/api-client.test.ts` lines ~899-940: `error.code === "http_500"` for a 500
   with no usable error body and no generation in flight. Stays.

Do not edit `src/host/m15-proof.ts`, `src/host/m7-proof.ts`, or any harness file.

## Files Allowed To Change

- `src/host/m16-proof.ts` (new)
- `package.json` (add the `proof:m16` script only)

Nothing else. **No file in `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` may be
modified.**

## Tests

Run and report verbatim, with exit status:
- `~/.bun/bin/bun run proof:m16` — full output
- `~/.bun/bin/bun run src/host/m7-proof.ts` — verdict lines
- `~/.bun/bin/bun test` (FULL suite)
- `git -C /Users/ryankenny/Projects/OpenCodeOpenWeightHarness status --porcelain` and
  `rev-parse HEAD`, before and after
- `git -C /Users/ryankenny/Projects/OpenCodeOpenWeightHarness worktree list` after

**Full-suite baseline: ALREADY RED — 851 pass, 3 fail (all `test/host/pair.test.ts`
`renderPairing`), pre-existing and unrelated**, plus whatever T1-T4 added. Bar: no NEW
failures.

If the live harness cannot be started, say so plainly and return FAIL with the reason.
**Do not fake, stub, or mock a phase and report it as a live pass.**
