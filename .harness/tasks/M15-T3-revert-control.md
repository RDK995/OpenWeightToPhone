TASK

Routing: **Mid tier** (`sonnet`). Named reason: **not low risk**. It spawns extra harness
instances and manipulates git worktree state next to a live service, so being wrong is
expensive and not immediately obvious. Not Top: the procedure below is fully specified.

Goal:

Extend the existing `src/host/m15-proof.ts` with a final phase that demonstrates — rather
than assumes — that the harness `idleTimeout` change is **revertible as a single isolated
hunk**, and that with it reverted the original cold-load cutoff comes back.

Why this matters (do not skip it as ceremony): a later milestone proves its own acceptance
criterion by reverting exactly this change and showing the client still recovers. If the
change is not cleanly revertible, or if reverting it does not actually reproduce the
failure, that criterion is unfalsifiable. This phase is the evidence that it is.

Relevant Requirements:

- `.harness/milestones.md`, milestone `M15`, acceptance criterion: "The change is revertible
  as a single isolated hunk: reverting it and restarting the harness reproduces the original
  12s cutoff on a cold `reasoning-deep` load. This is what makes `M16`'s AC14 falsifiable, so
  it must be demonstrated here rather than assumed."
- The observed failure, already diagnosed at `.harness/requirements.md` lines 283-303: on
  **loopback** the killed stream looks like a truncated HTTP 200 (no `complete` event); it is
  only through Tailscale Serve that it becomes an HTTP 502. Your negative control runs on
  loopback, so expect the truncated-200 shape, not a 502.

Acceptance Criteria:

1. **A new phase REVERT-CONTROL is added to `src/host/m15-proof.ts`**, after the existing
   phases, and its result participates in the proof's overall pass/fail and exit code exactly
   as the others do.

2. **The reverted code comes from a git worktree, not from editing the live tree.** In
   `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`, the commit
   `65c1fdee1b01ebe288456dfeaa74af083bcc9dfe` on branch `phase1/reasoning-surface` is the
   baseline *before* the `idleTimeout` change (the change is uncommitted in the working
   tree). So:
   - `git -C /Users/ryankenny/Projects/OpenCodeOpenWeightHarness worktree add --detach <tmpdir> 65c1fdee1b01ebe288456dfeaa74af083bcc9dfe`
   - If the worktree needs dependencies, symlink the existing ones:
     `ln -s /Users/ryankenny/Projects/OpenCodeOpenWeightHarness/node_modules <tmpdir>/node_modules`.
   - **Never** run `git stash`, `git checkout --`, `git restore`, `git reset --hard` or
     `git clean` in either repository, and never edit the harness working tree. Both trees
     carry uncommitted work and a worktree is exactly how you avoid touching it.
   - Remove the worktree at the end (`git worktree remove --force <tmpdir>`), in a `finally`,
     so a failure does not leave it behind. Print whether the removal succeeded.

3. **The revert really is the single hunk.** Before running anything, the phase asserts and
   prints:
   - `grep -c "idleTimeout" <tmpdir>/harness/api/server.ts` is **0** — the baseline copy has
     no such option;
   - `git -C /Users/ryankenny/Projects/OpenCodeOpenWeightHarness diff --stat HEAD` names
     **only** `harness/api/server.ts` among modified tracked files (the new test file is
     untracked and is expected to show under `git status --porcelain` as `??`; report both
     verbatim). Fail the phase if any other tracked file is modified.

4. **A controlled A/B on loopback, cold both times.** Both instances are started with
   `bun run harness/api/cli.ts` and `OPENWEIGHT_HARNESS_BIND_PORT` set to a **free ephemeral
   port chosen at runtime** (never 7787 — that is the live service, and it must not be
   disturbed). Each instance is stopped again before the next starts. Before **each** of the
   two generations, force a cold load by the same procedure the earlier COLD phase already
   uses in this file (`ollama ps`, `ollama stop` every listed model, re-check) — reuse that
   helper, do not duplicate it. Then, against `http://127.0.0.1:<port>` with the real bearer
   token from `readToken()`:

   - **B (control, reverted):** the instance started from `<tmpdir>`. Send one short prompt
     on the deep tier (the profile whose `latency_class` is `"batch"`, discovered at runtime —
     **never write a profile id literal**, `test/no-hardcoded-profile-ids.test.ts` scans
     `src/`). Expect the stream to **end without a `complete` event**. Record and print: the
     elapsed time at which the stream ended, every event type received, and whether a
     `complete` event arrived.
   - **A (fixed):** the instance started from
     `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` (the working tree, which carries
     the change). Same prompt, same cold procedure. Expect `content` **and** `complete`, and
     a largest idle gap greater than 10.0s.

   Run **B first**, so that if B unexpectedly succeeds you have not already spent a cold load
   on A.

5. **The phase passes only if the comparison is real:**
   - B ended **without** a `complete` event, and it ended after more than 5s and less than
     60s (the observed cutoffs were 12.004s and 20.009s; the band exists so an instant
     connection error is not mistaken for the timeout);
   - A delivered `content` and `complete`, with a largest idle gap **greater than 10.0s**;
   - and the phase prints both timelines side by side.

   If B *completes normally*, the phase **FAILS** with a message saying explicitly that the
   negative control did not reproduce the cutoff, so the revert demonstration is
   inconclusive — most likely because the model loaded in under ~10s. Do not soften this into
   a pass, and do not widen the band to make it pass.

6. **The live service on 7787 is untouched by this phase** and is still serving at the end.
   The phase must assert this itself: `GET {resolveBaseUrl()}/v1/profiles` returns 200 after
   the phase finishes, and the pid on 7787 is the same one that was there when the phase
   started. Print both.

Relevant Files:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m15-proof.ts` — the file to extend.
  **Read it in full first**; reuse its existing helpers (cold-forcing, profile discovery,
  event timestamping, the request recorder) rather than writing second copies.
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/cli.ts` — how the surface
  starts, and which env vars it honours. Read only.
- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/config.ts` — `readToken()`,
  `resolveBaseUrl()`.

Files Allowed To Change:

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m15-proof.ts`

Constraints:

- **Change nothing in `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`**, including its
  working tree, its index, and its branches. A detached worktree, removed afterwards, is the
  only git operation permitted there.
- **Do not kill, restart or reconfigure the live harness on port 7787 in this phase.**
- **Do not implement any client-side recovery, retry, backoff, reconnect or resume-on-drop
  behaviour, and do not touch `web/src/` at all.** A later milestone owns the client half and
  proves itself by reverting the harness fix; anything of that kind added here destroys its
  falsifiability. When the control stream dies, the phase **observes and reports** the death.
  It must not recover from it.
- Do not weaken, skip or edit any existing test, and do not weaken any assertion already in
  `m15-proof.ts`.
- Do not add a dependency. Do not commit.
- Never write a profile id literal in `src/`.
- Do not run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or
  `git clean`.

Tests:

`export PATH="$HOME/.bun/bin:$PATH"` (Bun 1.4.0; Node is not installed).

From `/Users/ryankenny/Projects/phoneToLocalModel`, report each with its exit status:

    bun run proof:m15
    bun test test/no-hardcoded-profile-ids.test.ts

`bun run proof:m15` now performs **four** cold loads of a large model and will take many
minutes. Set a generous timeout. Do not abandon it early, and do not weaken an assertion to
make it finish.

Return:
- Summary
- Files changed
- Tests run (each command + exit status)
- The **full output of the REVERT-CONTROL phase**, including both timelines, and confirmation
  that the temporary worktree was removed
- The overall proof result and final line
- Test result
- Confirmation that the live service on 7787 is still serving, with its pid
- Unresolved issues
