## Review: M13 — "The app degrades honestly when the Mac is unreachable or the transcript is long"

### Scope actually reviewed

Full contents of `web/src/ui/view-model.ts`, `web/src/ui/dom-target.ts`, `test/web/ui/dom-target.test.ts`, `test/web/ui/view-model.test.ts`, plus surrounding code needed to judge them: `web/src/api-client.ts` (`HarnessOfflineError`), `web/src/session-coordinator.ts` (`send`'s draft-preservation catch), `web/src/ui/mount.ts` (confirms `setStreamingText`/`render` drive the real `paint()`), `web/src/ui/actions.ts`, `web/src/main.ts` (confirms `createDomTarget` is wired into the real bootstrap, not just tests), and the relevant sections of `.harness/requirements.md`, `.harness/architecture.md` (C10, `## Deviations`), and `.harness/milestones.md`'s M13 entry.

### Validation independently re-run

- `bun test` → 852 pass, 0 fail, matches claim.
- `bun x tsc --noEmit` → clean.
- `bun test test/web/ui/` → 155 pass, 0 fail, matches claim.
- **Falsifiability check (criterion 3), reproduced independently**: swapped `dom-target.ts` for the pre-M13 `dom-target.ts.bak` (found untracked in the working tree — see finding below), ran `bun test test/web/ui/dom-target.test.ts`: 4 tests fail against the old `replaceChildren` rebuild, including the exact scaling assertion (`Expected: < 20 ... Received:` a large delta). Restored the real file afterward and confirmed `md5` matches and the full suite is back to 852/0. The test genuinely drives `handle.setStreamingText` → `mount.paint()` → `target.paint()`, the real production paint path (`main.ts` wires `createDomTarget` into `mount`), not a hand-built view model.
- **Live-harness clause of criterion 2**: the harness is reachable in this environment — this machine is `RyansMacStudio.Home` itself, and `bun`/harness is listening on `127.0.0.1:7787`. I wrote and ran a standalone script using the project's real `createApiClient`, `createConversationStore`, `createSessionCoordinator` (no fakes) against the real token and real base URL: injected a single transport-layer failure (`TypeError("Failed to fetch")`) on the `generate` call, confirmed it surfaced as `HarnessOfflineError` with `draftPrompt` set and **zero** turns persisted, then retried through the same coordinator with the network path restored and reached the **live** harness: `status: "complete"` with real telemetry (`tokens_per_second: 111.26`, etc.), and exactly one user + one assistant turn recorded. This proves the live-harness clause the milestone recorded as unproven.

### Acceptance criteria

| # | Criterion | Implementation Evidence | Test Evidence | Result |
|---|---|---|---|---|
| 1 | Transport failure at network layer renders a distinct offline state, not generic `error`, names no harness error code, drafted prompt still present | `web/src/ui/dom-target.ts:53-54,62-63,197-205,427-437` — `offline` is a peer `GenerationDisplay` variant with no `code` field (`view-model.ts:20`); dedicated `data-testid="offline"` section with hardcoded `OFFLINE_MESSAGE`, never through `describeError` | `test/web/ui/dom-target.test.ts:1750-1804` — real `createApiClient` with a rejecting `fetch`, real `createSessionCoordinator`, asserts offline text present, `status`/`notice` unaffected, prompt-input value unchanged | PASS |
| 2 | Retry re-sends preserved draft without retyping; retry succeeding against the **live harness** proceeds to `complete`; failing attempt leaves no turn behind | `dom-target.ts:140-236` shared `doSend`, retry button reads `currentGeneration.draftPrompt`; `session-coordinator.ts:411-416` sets `draftPrompt` on the thrown error, turn-append only happens after a terminal outcome (step 7, after the point an offline error would have already propagated) | `dom-target.test.ts:1806-1949` (fake-level retry-to-complete + no-turn-leak); **live-harness clause independently proven by me** (see Validation above) — not proven by the implementation's own recorded evidence | PASS (with the live clause proven by the reviewer, not by the milestone's own recorded validation — see IMPORTANT finding below) |
| 3 | 500+-turn transcript, 200 deltas: element creation per delta does not scale with transcript length, asserted an order of magnitude apart | `dom-target.ts:376-409` — persistent `transcriptNodes` array, index-keyed reuse, `textContent` written only when changed, no `transcriptList.replaceChildren` | `dom-target.test.ts:2036-2083` — instruments `document.createElement`, measures 50 vs 500 turns × 200 deltas through the real mount/paint path. **Independently falsified against the old code** by me (see Validation): fails with the pre-fix renderer, passes with the fix | PASS |
| 4 | Same 500-turn transcript renders every turn intact, no truncation/reorder/drop, verified against the view model's own ordering | Same reconciliation code; append-only turn model with no mid-array insertion means index-keyed reuse has no reorder path within a conversation | `dom-target.test.ts:2085-2118` (fidelity vs `buildViewModel(...).transcript`), plus companion tests closing reconciliation failure modes: node-identity reuse (2120), conversation switch / whole-transcript replace (2152), pending→real-turn transition (2195), cancelled marker (2234) | PASS |
| 5 | Human-attested on physical iPhone, offline/airplane mode | N/A — explicitly not agent-provable | N/A | OUTSTANDING (correctly not attempted by any agent; awaits the human, per milestone record) |

### Findings

**Severity: IMPORTANT**

**Problem:** An untracked leftover file, `web/src/ui/dom-target.ts.bak`, containing the pre-M13 `dom-target.ts` (the version with `transcriptList.replaceChildren(...)` and no offline handling), is sitting in the working tree at `web/src/ui/dom-target.ts.bak`. This is debris from the T2 verifier's revert-and-measure experiment (described in the milestone's Evidence section) that was never cleaned up.

**Evidence:** `web/src/ui/dom-target.ts.bak` (confirmed via `diff` against the pre-M13 shape — it lacks the `offline` handling, `doSend`, `retryBtn`, and uses `transcriptList.replaceChildren(...transcriptItems)`). Not listed in `.gitignore`.

**Why it matters:** The milestone's own Evidence section states the orchestrator "re-ran the full suite after the T2 verifier's revert experiment to confirm the tree was left as found." The tree was not left as found — a stray file with a materially different (pre-fix, buggy) copy of a core UI module is sitting alongside the real one. It does not currently break `tsc` (not a recognized TS extension) or `bun test` (no matching test glob), but it is a landmine: an editor auto-import, a future glob change, or a careless `mv`/`cp` could reintroduce the old, broken renderer. It also directly contradicts a specific claim made in the milestone record.

**Suggested correction:** Delete `web/src/ui/dom-target.ts.bak`.

**Severity: IMPORTANT**

**Problem:** The live-harness clause of acceptance criterion 2 ("a retry that succeeds against the live harness proceeds to a normal `complete`") was recorded as unproven this phase, with the stated reason that the harness was unreachable (`OPENWEIGHT_HARNESS_BASE_URL` unset, probe returned `000`). In this review, the harness was reachable (this machine is the Mac Studio itself, harness listening on `127.0.0.1:7787`), and I was able to prove the clause directly against it using the project's real, unmocked client/coordinator stack (see Validation above). Every earlier milestone in this project (M1–M12b) carries a persistent `src/host/mN-proof.ts` + `proof:mN` script that performs exactly this kind of live-harness proof; M13 has none — a fact the milestone's own Follow-ups section already flags as "a real gap, not bookkeeping."

**Evidence:** `.harness/milestones.md`'s M13 "Not validated this phase" and Follow-ups sections; absence of `src/host/m13-proof.ts` (compare `src/host/m7-proof.ts` etc.); my own live-harness script output confirming the clause holds.

**Why it matters:** The behavior itself is correct (I proved it works), but the milestone shipped without exercising its own strongest, most specific acceptance clause against what it actually has to survive — a live network failure and a live recovery — and without leaving behind the same repeatable, project-standard proof artifact every prior milestone has. Given the harness turned out to be reachable in the very same environment this review runs in, the gap was avoidable, not an unavoidable environmental constraint.

**Suggested correction:** Add `src/host/m13-proof.ts` (and a `proof:m13` script) that performs the live-harness retry-to-`complete` proof, following the existing per-milestone convention, and run it before the milestone is considered DONE — not blocking this review's functional PASS (the behavior is now proven), but this should be closed before the milestone leaves REVIEW/moves toward being called finished.

**Severity: OPTIONAL**

**Problem:** `promptInput.value = ""` in `doSend`'s success `.then()` (`dom-target.ts:192`) clears whatever is currently in the input box, not specifically the prompt that was sent. If a user types new, unsent text into the box while a send or retry is in flight and that send then succeeds, the newly typed text is silently discarded — the same shape of defect (input cleared out from under the user) that M13-T1 was written to fix for the failure path, just left open on the success path, and it also existed before this milestone in weaker form.

**Evidence:** `web/src/ui/dom-target.ts:186-194`; no `promptInput.disabled` toggling anywhere in the send/retry lifecycle.

**Why it matters:** Low likelihood (requires typing during an in-flight send) and outside M13's stated criteria (which concern the failure path only), but it is the same class of silent-loss bug the milestone exists to eliminate.

**Suggested correction:** Either disable `promptInput` while a send is in flight, or snapshot the exact prompt string sent and only clear the input if its current value still equals that snapshot.

### Overall Verdict

**CHANGES REQUIRED**

Rationale: the functional behavior for all four agent-provable criteria is correct and well-tested — including the falsifiability of the performance assertion (criterion 3) and the reconciliation fidelity guards (criterion 4), both independently reproduced by me — and I was able to independently prove the live-harness clause of criterion 2 that the milestone left unproven. However, two IMPORTANT findings stand: a stray `.bak` file left in the source tree that directly contradicts the milestone's own "tree left as found" claim, and the milestone's own admitted gap (no live-harness proof, no `m13-proof.ts`) turning out to be closeable in this same environment and not yet closed. Both are correctable without touching the core logic. Criterion 5 remains correctly outstanding, awaiting the human, and does not itself block this verdict.
