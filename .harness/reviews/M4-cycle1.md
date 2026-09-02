# M4 Review — "A generation can be cancelled and the transcript reflects it honestly"

## Verification performed independently

- Re-derived the M4 diff via the recorded tree-object recipe: confirms exactly `package.json` (+3/-1), `src/host/m4-proof.ts` (+393, new), `test/web/session-coordinator.test.ts` (+230), `web/src/session-coordinator.ts` (+34/-1) — matches the recorded diff exactly.
- Read `web/src/session-coordinator.ts` in full (both `send` and the new `cancel`), the full new test file, and the full `src/host/m4-proof.ts` (393 lines).
- Ran `bun test` myself: **253 pass / 0 fail / 546 expect() calls**.
- Ran `bunx tsc --noEmit` and isolated `m4-proof.ts`'s errors: **6× TS5097 + 4× TS2591 = 10**, identical error classes/counts to `m3-proof.ts`'s pre-existing 10. Confirmed via `grep`.
- Ran `bun run proof:m4` against the live harness myself (fresh conversation ids `aa8adc22…`, `30cc0c73…`, distinct from all previously reported runs): **exit 0, all three criteria PASS**, output matches the shape of the recorded evidence.
- Checked `git ls-files --others --exclude-standard` outside `.harness/`: 30 files, all legitimate project sources — no stray artifacts.
- Read `.harness/architecture.md`'s C7/C8/C9/C10 responsibilities and interfaces, and its `## Deviations` section, to check for undeclared drift.
- Cross-checked the harness API doc's `POST .../cancel` section, which is the literal source of the idempotency edge case's wording ("Cancelling an already-completed, failed, or previously-cancelled generation returns 200 OK with that generation's actual final status").

## Assessment of the three flagged points

1. **Criterion 2's assertion.** Confirmed accurate: `completeCancelResult.status !== "complete"` (m4-proof.ts:275) sits in the `else` branch reached only after `sendResult2.status === "complete"` is verified (line 255). It is a real inequality check on the literal string, not a truthiness or "any terminal status" check. Sound.

2. **Direct C7 call bypassing C9.** Confirmed accurate and necessary: `send()` calls `conversationStore.recordProgress(conversationId, null)` unconditionally on every terminal path before branching on `status` (session-coordinator.ts:147), clearing `pending` regardless of whether the terminal status was `complete`, `error`, or `cancelled`. Since C9's `cancel()` requires `conversation.pending` to be set (lines 211-216), it cannot be invoked against an already-terminal generation — it would throw `No generation in flight`. The direct `apiClient.cancel()` calls in criterion 2's sub-cases A and B are therefore a genuine necessity, not a convenience bypass, and they are commented as such in the source. Criterion 1 does exercise `sessionCoordinator.cancel()` (the C9 path). This is sound, and it is also honestly surfaced in the milestone's own Follow-ups ("C9 `cancel()` is unusable once a generation reaches a terminal state").

3. **Redundant assertion in criterion 3.** Confirmed accurate: both `localAssistantTurn` and `serviceAssistantTurn` are selected via `.find(t => t.role === "assistant" && t.cancelled === true)` (lines 328-330, 346-348), so the subsequent `localAssistantTurn.cancelled !== serviceAssistantTurn.cancelled` (line 357) can structurally never fire. The criterion remains non-vacuous overall: if the service recorded the turn with `cancelled: false` or omitted it, `serviceAssistantTurn` would be `undefined` and the `!serviceAssistantTurn` branch (line 349) fails the criterion. The content-equality check (line 363) is a genuine, non-redundant assertion between two independently-sourced values (client-accumulated `text` vs. the service's `GET /v1/sessions` response). This is dead-code-adjacent but not a correctness defect — OPTIONAL cleanup at most.

## New finding from independent reading (not one of the three flagged points)

The milestone's second acceptance criterion, both in `milestones.md` and in `requirements.md`'s Edge Cases, explicitly names **three** terminal states requiring idempotent-cancel proof: "already complete, failed, or cancelled." This wording is taken directly from the harness API doc's idempotency clause (`docs/api/phone-reasoning-surface-v1.md` line 518: "Cancelling an already-completed, **failed**, or previously-cancelled generation..."). Reading `src/host/m4-proof.ts` Phase 2 in full: sub-case A cancels an already-`complete` generation, sub-case B re-cancels an already-`cancelled` generation (twice) — but there is no sub-case that cancels an already-**failed** generation. No `error`/`failed` terminal generation is ever produced or cancelled anywhere in the file. This gap is not disclosed anywhere in the milestone record (unlike the empty-partial-output gap, which is explicitly called out under Follow-ups), and the criterion is nonetheless checked `[x]` and marked "Proven live."

The residual functional risk is low — `cancel()` in both C9 and C7 forwards the service's `status` string verbatim with no per-value branching, so the mechanism that was proven for `complete` and `cancelled` almost certainly generalizes to `failed`. But the project's own standing rule (repeated in this task's brief) is that every acceptance criterion is proven against the live API, not inferred from code symmetry or from the API doc's stated guarantee — and this is exactly the class of doc-trusting inference the harness exists to avoid.

## Acceptance criteria

| # | Criterion | Implementation Evidence | Test Evidence | Result |
|---|---|---|---|---|
| 1 | AC6 — Cancelling mid-generation returns status `cancelled` and output stops | `web/src/session-coordinator.ts` `cancel()` (C9→C7) and `send()`'s event loop/terminal handling | `m4-proof.ts` Phase 1, independently re-run live by me (exit 0, `cancel() status: cancelled`, `send() status: cancelled`, 1 delta before cancel issued, no delta after the terminal `cancelled` event); unit tests in `session-coordinator.test.ts` cancel describe block | PASS |
| 2 | (derived: FR6, edge case) Cancelling an already complete, failed, or cancelled generation is idempotent and returns the actual final status | `apiClient.cancel()` (C7) forwards the raw `status` field unmodified; `SessionCoordinator.cancel()` (C9) forwards it unchanged too | `m4-proof.ts` Phase 2 sub-case A (complete→`complete`) and sub-case B (cancelled→`cancelled` ×2), independently re-run live by me and confirmed. **No sub-case for an already-`failed` generation exists anywhere in the proof or unit tests.** | **FAIL** — one of the three explicitly-named terminal states is entirely unproven and the gap is undisclosed |
| 3 | (derived: edge case) Cancelled generation's partial output stored locally as a turn marked `cancelled`, matching the service's `cancelled` field via `GET /v1/sessions/{id}` | `send()`'s `cancelled` branch (session-coordinator.ts:167-174) mirrors the assistant turn locally with `cancelled: true` | `m4-proof.ts` Phase 3, independently re-run live by me (`Local turn: ... cancelled=true content="As I"`, `Service turn: ... cancelled=true content="As I"`, byte-identical); unit tests for both non-empty and empty partial content | PASS |

## Findings

Severity:
IMPORTANT

Problem:
The idempotent-cancel acceptance criterion explicitly names three terminal states ("already complete, failed or cancelled") but the live proof only exercises two of them (complete, cancelled). The already-`failed` case is never produced or cancelled anywhere in `src/host/m4-proof.ts`, yet the criterion is checked off in `milestones.md` as "Proven live" with no caveat, and no Follow-up discloses the gap (unlike the analogous empty-partial-output gap, which is explicitly flagged).

Evidence:
`src/host/m4-proof.ts` lines 226-318 (Phase 2): sub-case A (lines 240-282) drives a generation to `complete`; sub-case B (lines 284-311) re-cancels the already-`cancelled` Criterion 1 generation. No code path anywhere in the file produces or cancels an already-`failed` generation. `.harness/milestones.md`'s M4 entry marks this criterion `[x]`/"Proven live" without qualification.

Why it matters:
This project's standing rule — restated in this task's brief — is that every acceptance criterion is proven against the live harness API, not inferred from documentation or code symmetry. A criterion bundling three named cases into one checkmark, where one of the three has zero live evidence, means the record overstates what was actually demonstrated. The functional risk is low (the passthrough is generic and value-agnostic), but that is an inference, not a live proof, and the project elsewhere goes out of its way to distinguish the two (e.g. explicitly disclosing the untested empty-partial-output case).

Suggested correction:
Either (a) add a live sub-case that drives a generation to `failed` (if a reliable, fast way exists to induce `inference_failed`/`profile_resolution_failed` without a 300s timeout wait) and re-cancel it, extending Phase 2 to cover all three named states; or (b) if inducing a live failure is impractical without a change the constraints forbid, narrow the criterion's recorded wording to "complete or cancelled" and explicitly disclose under Follow-ups (in the same style as the empty-partial-output note) that the `failed` sub-case relies on the documented API contract and code-path symmetry rather than live proof.

---

Severity:
OPTIONAL

Problem:
Criterion 3's `cancelled` flag-equality assertion (`localAssistantTurn.cancelled !== serviceAssistantTurn.cancelled`) can never fire, because both turns are selected from their respective arrays via a `.find()` predicate that already requires `cancelled === true`.

Evidence:
`src/host/m4-proof.ts` lines 328-330 (local selection), 346-348 (service selection), 357-362 (the dead comparison).

Why it matters:
It is not a correctness defect — a real divergence (service recording `cancelled: false` or no matching turn) is still caught via the `!serviceAssistantTurn` branch at line 349 — but the line reads as an active check when it is structurally inert, which could mislead a future reader into thinking flag-divergence is independently verified.

Suggested correction:
Either select the service-side turn by a criterion independent of `cancelled` (e.g. by matching `content` prefix or turn index) so the flag-equality check is live, or remove the redundant comparison and rely explicitly on the `!serviceAssistantTurn` branch, with a comment noting why that is sufficient.

---

Severity:
OPTIONAL

Problem:
Criterion 1's mid-generation cancel is timing-dependent against a live, non-deterministic service (cancel is raced against the next content delta / natural completion).

Evidence:
`src/host/m4-proof.ts` lines 106-221; the live run I performed showed 1 delta before cancel and 2 total, consistent with but not guaranteed by the design.

Why it matters:
Already acknowledged in the milestone record (routed to Mid tier for exactly this reason: "a timing-dependent proof against a live service with no deterministic oracle"). Not a defect, but worth noting for anyone debugging an intermittent CI failure of `proof:m4` in future.

Suggested correction:
No action required now; if `proof:m4` becomes flaky in CI, consider retry logic or a longer prompt to widen the cancel window.

## Verdict

CHANGES REQUIRED

IMPORTANT
- Criterion 2 (idempotent cancel) is proven live for only two of the three terminal states its own text names ("complete, failed, or cancelled"); the `failed` sub-case is untested and the gap is undisclosed. See finding above.

The two OPTIONAL findings (redundant flag-equality assertion in criterion 3; inherent live-proof timing sensitivity in criterion 1) do not block a PASS on their own and can be deferred or accepted as-is at the orchestrator's discretion.

Relevant files: `/Users/ryankenny/Projects/phoneToLocalModel/web/src/session-coordinator.ts`, `/Users/ryankenny/Projects/phoneToLocalModel/test/web/session-coordinator.test.ts`, `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m4-proof.ts`, `/Users/ryankenny/Projects/phoneToLocalModel/package.json`, `/Users/ryankenny/Projects/phoneToLocalModel/.harness/architecture.md`, `/Users/ryankenny/Projects/phoneToLocalModel/.harness/requirements.md`, `/Users/ryankenny/Projects/phoneToLocalModel/.harness/milestones.md`
