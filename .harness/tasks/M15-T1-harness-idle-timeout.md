TASK

Routing: **Mid tier** (`sonnet`). Named reason: **not low risk**. This edits a
security-reviewed, currently-live HTTP surface in a *second* repository, whose module
header encodes several invariants a careless edit could disturb, and the change must stay
a single independently-revertible hunk because a later milestone proves its own criterion
by reverting exactly this change. Nothing here is architectural or ambiguous, so it is not
Top.

Goal:

In the **external** repository `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`, make
the Phase 1 API surface's `Bun.serve` set an explicit `idleTimeout` of **255 seconds**, and
make that configured value readable from a *running* surface instance rather than only from
the source.

Relevant Requirements:

- `phoneToLocalModel/.harness/requirements.md` FR11 (lines 101-108) — the harness's
  `Bun.serve` sets an explicit `idleTimeout` sufficient to cover a cold model load; the
  value is **255s** (Bun's maximum), which sits below the 300s generation wall-clock budget
  so the generation timeout remains the governing limit rather than the socket.
- The diagnosis is already recorded at `phoneToLocalModel/.harness/requirements.md` lines
  283-303 under `### The cold-load failure — diagnosed 2026-09-02`. **Read it; do not
  re-derive it, and do not go looking for the bug.** It is: `harness/api/server.ts:150`
  calls `Bun.serve` without `idleTimeout`, so Bun's ~10s default applies and closes the SSE
  connection mid-generation during a cold model load (observed cutoffs 12.004s, 20.009s).
- Architecture component **C17 — Harness Stream Timeout**
  (`phoneToLocalModel/.harness/architecture.md` lines 241-247).

Acceptance Criteria:

1. `harness/api/server.ts`'s `Bun.serve` call (currently at line 150) passes
   `idleTimeout` set to exactly `255`. The number must come from a single named exported
   constant, not a bare literal at the call site, so a test can assert on it by name.
2. A **running** surface built by the module's own start function exposes the configured
   value, so it can be read off a live instance. `Bun.Server` itself does **not** expose
   `idleTimeout` (verified: its prototype has `timeout`, `port`, `hostname`, `development`,
   … but no `idleTimeout` getter, and `server.idleTimeout` is `undefined`), so the handle
   the module already returns must carry it: add a `readonly idleTimeout: number` field to
   the returned handle type, populated with the same constant that was passed to
   `Bun.serve`. It must be the *same* value by construction — do not restate `255` twice.
3. A new test file `harness/api/idle-timeout.test.ts`, following the conventions of the
   existing `harness/api/server.test.ts` (real `Bun.serve` listener on an ephemeral port,
   real `fetch`), asserts:
   - the exported constant is `255`;
   - a **really started** surface handle reports `idleTimeout === 255`;
   - the surface still answers a normal authenticated request and still stamps
     `x-api-version` (i.e. the option did not disturb the existing wiring).
   Write the test first and watch it fail against the unmodified source (Red), then make it
   pass (Green). Say in your return what the Red failure actually was.
4. The v1 API contract is untouched: **no endpoint added, removed or renamed; no response
   shape, status code, header, or documented semantic changed.** The only behavioural
   difference is how long an idle connection is allowed to live.
5. The module header comment at `harness/api/server.ts` lines 28-38 currently asserts
   "`Bun.serve` IS CONFIGURED EXACTLY AS `harness/security/auth/surface.ts`". After this
   change that sentence is false. Correct it so it records the single deliberate
   divergence and why, **and** state in the comment how to revert this change (which lines
   to remove) — a later milestone proves its own acceptance criterion by reverting exactly
   this change, so the revert must be obvious to a reader.

Relevant Files:

- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/server.ts` — the file to
  change. `Bun.serve` is at line 150; the header comment to correct is at lines 1-40; the
  returned handle is built at the end of the same function.
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/server.test.ts` — the
  convention to follow for the new test (do **not** edit this file).
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/cli.ts` — shows how the
  running service starts the surface (`startApiSurface`). Read only.
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/security/auth/surface.ts` —
  the M0 surface referenced by the header comment. **Read only. Do not change it.**

Files Allowed To Change:

- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/server.ts`
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/harness/api/idle-timeout.test.ts` (new)

Constraints:

- **You are editing a second repository.** Every path above is absolute for that reason.
  Change nothing in `/Users/ryankenny/Projects/phoneToLocalModel`.
- **Do not change `harness/security/auth/surface.ts`.** Its `Bun.serve` keeps Bun's default
  idle timeout. That surface is not the one the phone streams from, and widening its scope
  would both exceed FR11 and destroy the single-hunk revertibility this task exists to
  preserve.
- **Keep the change to one isolated, revertible hunk of concern** — the constant, the
  `Bun.serve` option, the handle field, and the corrected header comment. Nothing else.
  No refactoring, no tidying, no unrelated improvement, however obviously good. Note any
  such temptation under `Unresolved Issues` instead.
- Do **not** add any HTTP endpoint, route, or response field that reports the timeout. The
  value is read off the in-process handle, never over the wire.
- Do **not** restart, kill, or otherwise disturb the harness process that is currently
  running (`bun run harness/api/cli.ts`, and its parent `bun run serve:p1`). A later task
  owns restarting it. Your tests must use ephemeral ports (`port: 0`) exactly as the
  existing tests do.
- Do **not** run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or
  `git clean` in either repository. Both working trees carry uncommitted work.
- Do not commit.
- Follow existing repository patterns; do not introduce dependencies.
- Do not weaken or edit any existing test.

Tests:

Bun 1.4.0 is at `~/.bun/bin/bun` and is **not on PATH in non-interactive shells**; Node is
not installed. Export `PATH="$HOME/.bun/bin:$PATH"` first.

Run all of these from `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`, and report each
command with its exit status:

    bun test harness/api/idle-timeout.test.ts
    bun test harness/api/server.test.ts
    bun run check:documented
    bun run check:boundary

The last two are the repository's own contract guards and are listed because acceptance
criterion 4 is about the v1 contract; if either was already failing before your change, say
so explicitly rather than treating it as caused by you.

Return:
- Summary
- Files changed
- Tests run (each command + exit status)
- Test result
- The Red failure you observed before the fix
- Unresolved issues
