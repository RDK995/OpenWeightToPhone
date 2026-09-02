# M8 Review — Cycle 1

## Validation Re-run (independently)

- `bun test` → **370 pass, 0 fail**, exit 0 (matches reported).
- `bunx tsc --noEmit` → exit 0 (matches reported).
- `bun run src/host/m8-proof.ts` against the live harness → **`M8 LIVE PROOF: PASS`**, exit 0. Fresh conversation/session ids observed on my run (`b6db197e-...` / `a3a3c68d-...`) that match neither the worker's nor the verifier's recorded ids — corroborates live, non-replayed execution.
- **My own mutation test** (independent of the one already recorded): inverted the Phase A assertion (`sessionCreationRequestsAfterCreate.length !== 1` → `=== 1`). Result: `PHASE A: FAIL`, `M8 LIVE PROOF: FAIL`, exit code **1**, while B/C/D still printed PASS in the summary — confirming the accumulator (`allPassed = allPassed && phase<X>Passed`) genuinely tracks each phase independently and the exit code is not hardcoded to a single check. This is a different mutation than the one recorded in the milestone entry (which hit Phase B), so it strengthens rather than duplicates that evidence.
- Read `web/src/conversation-store.ts` in full: confirmed `ensureLoaded()` throws (both the JSON-parse-failure and unrecognised-envelope paths) strictly before any assignment to `conversations` and before `loaded = true`. `persist()` is called only from mutator methods, none of which execute on the throw path. The claim that a rejected load cannot destroy data is correct by construction.
- Read `web/src/session-coordinator.ts`'s `createConversation` and `send`: `apiClient.createSession()` is called unconditionally, exactly once, not in a loop; `send()`'s pre-existing `if (!sessionId)` lazy-creation guard is untouched; the 404 `unknown_session` rebuild path (M6) is untouched.
- Read `web/src/api-client.ts`'s `createSession`, `getSession`, `listProfiles`, and the request-log implementation: all make real `fetch` calls through `makeRequest`; the log is populated by real requests, not synthesized. This is pre-existing infrastructure, consistent with the claim that only `conversation-store.ts`, `session-coordinator.ts`, `m8-proof.ts` and `package.json` changed.
- Read `test/web/conversation-store.test.ts` (deleteConversation and unknown-version-error blocks) and `test/web/session-coordinator.test.ts` (createConversation block) in full: coverage matches the milestone's claims — the "exactly once" test counts invocations with a real counter, the transcript-recovery test uses deep `toEqual` including unicode/multiline/`cancelled:true` content, and the newest-first-after-rebuild test orders insertion as conv1→conv2→conv3 with expected output conv3→conv2→conv1 (cannot pass by accident).
- Confirmed `test/no-hardcoded-profile-ids.test.ts` passes and that `m8-proof.ts` discovers `profile.id` via `listProfiles()` rather than hardcoding it.
- `git status --porcelain` shows nothing outside the standing untracked-repo condition (all of `web/`, `src/`, `test/` untracked, as documented) — no stray scope-creep files.

## Acceptance Criteria

**AC1** — Conversations can be created, listed newest first, opened and deleted, and a deleted conversation is gone after the store is rebuilt from storage.
Implementation Evidence: `web/src/conversation-store.ts` — `createConversation`, `loadConversations` (sorts by `updatedAt` desc), `getConversation`, `deleteConversation` (line 288, via `requireConversation`).
Test Evidence: `test/web/conversation-store.test.ts` lines 810-825 ("deleted conversation is absent from loadConversations after rebuild"), 875-918 (newest-first, non-trivial insertion-vs-output-order reversal); live proof Phase B (create 3, list newest-first, open by id, delete, rebuild over same storage, survivors present / deleted absent) — reproduced live on my own run.
Result: **PASS**

**AC2** — Each conversation is backed by exactly one server session id, and creating a conversation creates exactly one session against the live harness.
Implementation Evidence: `web/src/session-coordinator.ts` lines 240-247, `createConversation` calls `apiClient.createSession()` once, unconditionally.
Test Evidence: `test/web/session-coordinator.test.ts` lines 112-122 (counts calls with a real counter, asserts `1`); live proof Phase A — request-log filtered to `POST /v1/sessions` = 1 after creation, 0 during subsequent `send()`, and `getSession()` confirms the id is real against the live harness — reproduced live on my own run.
Result: **PASS**

**AC3** — The full transcript of each conversation is persisted locally and is recovered intact by a store constructed fresh from persisted storage alone.
Implementation Evidence: `web/src/conversation-store.ts` `persist()`/`ensureLoaded()`, `appendTurn`.
Test Evidence: `test/web/conversation-store.test.ts` lines 827-873 (multi-line/unicode/cancelled turns, deep `toEqual` per turn); live proof Phase C — a real user turn and a real harness-generated assistant turn recovered byte-identically (`JSON.stringify` equality) by a brand-new store over the same storage — reproduced live on my own run.
Result: **PASS**

**AC4** — The persisted payload is written under a versioned key, and a payload written under an unknown version is rejected rather than misread.
Implementation Evidence: `CONVERSATIONS_SCHEMA_VERSION`, `UnknownStorageVersionError`, `isRecognisedEnvelope`/`readEnvelopeVersion`, throw-before-mutate ordering in `ensureLoaded` (verified by reading the code, not just tests).
Test Evidence: `test/web/conversation-store.test.ts` lines 73-138 (corrupt JSON, unrecognised shape, bare pre-envelope array, wrong version with found/expected values, and two tests asserting the raw stored string is byte-unchanged after a rejected load); live proof Phase D — writes `version: 999999`, confirms throw with `foundVersion=999999`/`expectedVersion=1`, confirms stored bytes unchanged — reproduced live on my own run.
Result: **PASS**

## Findings

Severity:
IMPORTANT

Problem:
`SessionCoordinator.createConversation` is a new public entry point added to C9's interface, but the architecture's `Interfaces` section only documents `C10 → C9` as `send`, `cancel`, `resumeIfInterrupted`, plus a subscription. No entry was added under `## Deviations` for this addition, even though the project has an established, repeatedly-used convention for exactly this situation: M3 and M5 both recorded analogous interface-surface widenings (`C9 -> C8`'s undocumented `createConversation`/`setSessionId`/`getConversation`/`appendTurn`; `C9`'s `ResumeResult` return type) as `Material: no` deviations specifically so "a reader should not have to discover that from the code." M8's milestone-entry `### Architecture` note ("No deviation... session provisioning was placed in C9 rather than C8") only addresses the dependency-edge question (C9 already may depend on C7 and C8), not the fact that a brand-new public method was added to C9's documented interface signature.

Evidence:
`.harness/architecture.md` lines 172, 205-206 (`C10 → C9` interface list, no `createConversation`); `web/src/session-coordinator.ts` lines 49-53 (new method on the `SessionCoordinator` interface) and 240-247 (implementation); compare to the precedent at `.harness/architecture.md` lines 307-316 (M3 deviation) and 326-337 (M5 deviation).

Why it matters:
This is precisely the class of drift the architecture-review rule exists to catch: an undocumented interface change means `architecture.md` no longer describes the system, and — per the project's own prior practice — nobody explicitly decided that this widening was fine, they just didn't write it down this time. The cost of leaving it unrecorded compounds: M9 (the next milestone, building C10) will read `architecture.md` to learn what C9 exposes and won't find `createConversation` there.

Suggested correction:
Either (a) add `createConversation(input): Promise<Conversation>` to the `C10 → C9` line in the Interfaces section, or (b) add a short `## Deviations` entry for M8 following the exact form of the M3/M5 entries ("C9's `C10 -> C9` surface is wider than written... Material: no"). Given the project's established pattern favors documenting even immaterial widenings explicitly, (b) matching the existing convention is probably the better fit, but either closes the gap.

---

Severity:
OPTIONAL

Problem:
No test exercises `apiClient.createSession()` rejecting inside `SessionCoordinator.createConversation()`. On that path, `conversationStore.createConversation()` has already run and persisted a conversation with `sessionId: null` before the rejection propagates, leaving a "sessionless" conversation in storage. It's not silently broken — `send()`'s lazy-creation guard (`if (!sessionId)`) would provision a session on first use — but that specific recovery path for this specific caller isn't proven anywhere.

Evidence:
`web/src/session-coordinator.ts` lines 240-247; searched `test/web/session-coordinator.test.ts` for a matching case, found none.

Why it matters:
Low impact since the fallback exists and is independently tested elsewhere, but it's an edge case in exactly the method this milestone introduces, and an untested one is worth a note rather than an assumption.

Suggested correction:
Add a test that makes `fakeApiClient.createSession` reject once during `createConversation`, and assert the conversation still exists in the store with `sessionId: null`, and that a subsequent `send()` on it succeeds and results in exactly one `createSession()` call overall.

---

Severity:
OPTIONAL

Problem:
Two already-disclosed follow-ups are legitimate but explicitly deferred to M9 by the milestone entry: (1) nothing at runtime catches `UnknownStorageVersionError`, so an app with an unreadable stored payload will surface a raw exception; (2) `deleteConversation` throws on an unknown id, so a UI delete button firing twice would surface a raw throw.

Evidence:
`.harness/milestones.md` Follow-ups section (lines ~761-778); `web/src/conversation-store.ts` lines 288-295 (`deleteConversation` via `requireConversation`) and 111-141 (`ensureLoaded` throw).

Why it matters:
Neither is required by any of M8's four acceptance criteria (which are about the store/coordinator layer, not UI), and M9 owns C10 where these would be surfaced or guarded. Recording this only so it isn't lost before M9.

Suggested correction:
None needed for M8 itself; confirm M9's task packets pick these up (the milestone entry already names them as M9's responsibility).

## Verdict

CHANGES REQUIRED

IMPORTANT
- Undocumented widening of the `C10 → C9` interface (`createConversation`) with no corresponding entry in `architecture.md`'s `## Deviations`, breaking with the project's own established documentation practice (see M3/M5 precedents).

All four acceptance criteria independently verified PASS with live-harness evidence I reproduced myself, including an independent mutation test beyond the one already on record. The single IMPORTANT finding is a documentation gap, not a functional defect — the fix is a small, low-risk addition to `architecture.md` (or the interface list), not a code change.
