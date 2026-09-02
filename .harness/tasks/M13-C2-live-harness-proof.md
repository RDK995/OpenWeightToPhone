# Task M13-C2 — Add `src/host/m13-proof.ts`: the live-harness proof for M13's criterion 2

## Context

This is a **correction task** answering the second IMPORTANT finding of the M13 cycle-1
review. Read it at `.harness/reviews/M13-cycle1.md` — the finding headed "The live-harness
clause of acceptance criterion 2 ... was recorded as unproven this phase".

The milestone recorded that the harness was unreachable. **That was wrong.** The orchestrator
has re-probed it: both `http://127.0.0.1:7787/v1/profiles` and the default base URL
`https://ryans-mac-studio.tailc3648a.ts.net/v1/profiles` return HTTP `401` (harness up,
auth required), and `~/.openweight-harness/token` exists with mode 600. This machine is the
Mac Studio. `OPENWEIGHT_HARNESS_BASE_URL` is unset, so `resolveBaseUrl()`'s default is
correct and you must NOT set that variable — use the project's own config helpers unchanged.

Routing: **Mid tier.** NOT CLEARLY SPECIFIED and NOT EASILY VERIFIED — exactly where a
transport failure must be injected inside the real client/coordinator streaming path (and
how to un-inject it for the retry) is not derivable from this packet and requires reading
`web/src/api-client.ts` and `web/src/session-coordinator.ts`; and a live-network proof can
pass for the wrong reason (never actually reaching the harness) unless it asserts positively
that it did.

## Goal

Add `src/host/m13-proof.ts` and a `"proof:m13"` script to `package.json`, following the
established per-milestone live-proof convention, proving M13's acceptance criterion 2
end to end against the **live** harness.

## The convention you must follow

`src/host/m12b-proof.ts` is the closest template and the most recent one — **read it first**
and match its shape: a `happy-dom` `Window`, `resolveBaseUrl()`/`readToken()` from
`./config.ts`, the real `createApiClient` / `createConversationStore` /
`createSessionCoordinator` / `createDomTarget` / `mount` imported from `../../web/src/...`,
a fetch wrapper around `globalThis.fetch`, a `waitForCondition` poller, an accumulating
`failures: string[]`, per-assertion `PASS` logging, and a final
`M13 LIVE PROOF: PASS` / `FAIL` banner with `process.exit(0)` / `process.exit(1)` and an
`if (import.meta.main)` entry point.

Drive the interaction **through the UI's own DOM**, as `m12b-proof.ts` does — click the
`data-testid="send"` button and the `data-testid="retry"` button, do not call the coordinator
directly. That is what makes this a proof of the shipped path rather than of a helper.

## Acceptance Criteria

The proof script must assert, in order, and fail loudly if any does not hold:

1. **Setup is live.** It reaches the real harness at `resolveBaseUrl()` with the real token
   and lists real profiles / creates a real conversation. If the harness is unreachable it
   must exit **non-zero** with a clear message — it must never "pass" by skipping.
2. **Injected transport failure.** With a prompt typed into `data-testid="prompt-input"` and
   the send button clicked, a transport-layer failure injected on the `generate` call only
   (reject with `TypeError("Failed to fetch")` — a rejected fetch, NOT a synthesized HTTP
   error response or a `{code: ...}` body) produces:
   - the `data-testid="offline"` section present in the DOM;
   - the generic `data-testid="status"` element NOT showing a harness error code;
   - the drafted prompt still present in the prompt input.
3. **No turn leaked.** After that failed attempt, the conversation holds **zero** user turns
   and **zero** assistant turns. Assert the count explicitly, from the conversation store.
4. **Live retry succeeds.** With the injection removed so fetch reaches the network again,
   clicking `data-testid="retry"` re-sends the preserved draft and the generation reaches
   `complete` **against the live harness** — assert on real telemetry actually returned by
   the harness (e.g. a numeric `tokens_per_second` > 0 and a non-empty `profile_id`), not on
   a locally-constructed value. This is the clause the milestone left unproven; it is the
   point of the whole task.
5. **Exactly one user turn and one assistant turn** exist afterwards, and the assistant turn
   has non-empty text.
6. The proof asserts the retry sent the **preserved draft** — capture the request body of the
   successful `generate` call through the fetch wrapper and assert its prompt equals the
   originally-typed text. The human did not retype it.

Plus:

7. `package.json` gains `"proof:m13": "bun run src/host/m13-proof.ts"` placed immediately
   after `"proof:m12b"`, matching the existing formatting exactly. Change nothing else in
   that file.
8. `bun x tsc --noEmit` exits 0.
9. `bun test` exits 0 with **854 pass, 0 fail** (do not change the test count — this task
   adds no unit tests; the proof script is the artifact).
10. `bun run proof:m13` **actually runs and exits 0**, against the live harness. Paste its
    full stdout into your return. A proof you did not run is not a proof.

## Files Allowed To Change

- `src/host/m13-proof.ts` (new)
- `package.json`

Nothing else. Do NOT modify `web/src/ui/dom-target.ts`, `web/src/ui/view-model.ts`,
`web/src/api-client.ts`, `web/src/session-coordinator.ts`, `web/src/ui/mount.ts`, any test
file, or anything under `.harness/`. If you believe production code must change for the
proof to work, **stop and say so in your return** rather than changing it — that is an
orchestrator decision, not yours.

## Tests

`bun` is at `~/.bun/bin/bun` and is NOT on PATH in non-interactive shells. Prefix your
commands with `export PATH="$HOME/.bun/bin:$PATH";`.

```
bun run proof:m13
bun x tsc --noEmit
bun test
```

Report the exact commands, their exit statuses, and the output you actually saw.

## Notes

- Generation against a live local model takes real time. Give the completion poller a
  generous timeout (60s or more) and keep the prompt very short (e.g. "Reply with the single
  word: ready") so the run is quick and cheap.
- Do not commit anything. Do not run `git stash`, `git checkout`, `git restore` or
  `git clean` — the whole working tree is uncommitted work and those commands would destroy
  it.
