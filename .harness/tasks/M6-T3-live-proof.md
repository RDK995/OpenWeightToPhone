# Task M6-T3 — Live proof that a conversation survives losing its server session

Tier: Mid
Reason for tier: **not low risk.** This script is the *only* evidence for all three of
M6's acceptance criteria. A proof that runs green while asserting the wrong thing
produces false evidence, and false evidence is worse than no evidence. The mechanics
are well-precedented (four sibling proofs exist), which is why this is Mid and not Top.

Milestone: M6 — A conversation survives losing its server session
Depends on: M6-T1 (`ApiClient.appendTurn`) and M6-T2 (`send()` session-loss recovery),
both already merged. **Read `web/src/api-client.ts` and `web/src/session-coordinator.ts`
first** to confirm the exact shapes — do not assume them from this packet.

## Goal

Create `src/host/m6-proof.ts`, a live proof against the running harness, following the
established conventions of `src/host/m5-proof.ts` and `src/host/m4-proof.ts` (read
`m5-proof.ts` first; match its import style, its `main()` shape, its console reporting
and its exit-code discipline). Add `"proof:m6": "bun run src/host/m6-proof.ts"` to
`package.json`'s `scripts`, placed after `proof:m5`.

The proof must exit **non-zero** on any failed assertion, and print a per-criterion
PASS/FAIL summary at the end. It must never print the bearer token.

## Hard constraints

1. **Do not restart the harness process, and do not modify anything under
   `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/`.** That repository is
   read-only and restarting the service is an explicit project non-goal. The `404` is
   induced by driving a stored conversation at a session id the service does not hold.
   The API defines `unknown_session` as "Session id does not exist **or** was lost on
   service restart" — indistinguishable to a client, identical recovery path.
2. **Never hardcode a profile id.** `test/no-hardcoded-profile-ids.test.ts` fails the
   build if any file under `src/`, `web/src/` or `scripts/` contains the literal string
   `reasoning-baseline`, `reasoning-capable` or `reasoning-deep`. Fetch profiles with
   `apiClient.listProfiles()` and select one at runtime (prefer the fastest by
   `latency_class`, else take the first). Print which id was selected.
3. **Keep prompts short.** The reverse proxy closes idle SSE connections at roughly 12s
   and the service admits one generation per session at a time. Ask for one-word or
   few-token answers.
4. Read the base URL and token via `resolveBaseUrl` / `readToken` from `./config.ts`,
   exactly as the sibling proofs do.

## The four phases

### Phase A — establish a real conversation with a memorable fact

- Build a memory `StoragePort`, credential store, `ApiClient`, `ConversationStore` and
  `SessionCoordinator` the way `m5-proof.ts` does.
- Create a conversation with the runtime-selected profile id.
- `send()` a prompt that plants a specific token the model must later recall — for
  example asking it to remember a **4-digit number chosen at random by the script at
  runtime** (do not hardcode the number; generate it, and print it) and to reply with
  only the word `noted`.
- Assert the result is `status: "complete"`, `sessionRebuilt: false`, `replayedTurns: 0`.
- Capture and print the local transcript and the real `sessionId` now stored.

### Phase B — induce the `404` and prove recovery (AC8)

- Generate a fresh UUID (`crypto.randomUUID()`) as a **bogus session id**.
- **Prove the service genuinely does not hold it** before relying on it: call
  `apiClient.getSession(bogusId)` and assert it rejects with a `HarnessApiError` whose
  `code === "unknown_session"` and `status === 404`. Print that response. If this does
  not hold, fail immediately — the whole proof rests on it.
- Overwrite the conversation's stored session id with the bogus one via
  `conversationStore.setSessionId(...)`. This is the client-side stand-in for a session
  the service lost; nothing about the service is touched.
- Note the count of stored turns whose `content.trim()` is non-empty — call it `N`.
- Clear the api client's request log, then `send()` a second prompt asking the model to
  repeat the number from Phase A, replying with only the digits.
- Assert **all** of:
  - the send resolves with `status: "complete"`;
  - `sessionRebuilt === true`;
  - `replayedTurns === N`;
  - the conversation's stored `sessionId` is now neither the bogus id nor the Phase A id;
  - the answer text **contains the 4-digit number from Phase A** — this is what makes
    "the conversation continues with its context restored" a real claim rather than a
    formality;
  - the request log, in order, shows: a `POST .../v1/sessions/<bogus>/generate`, then
    exactly one `POST <base>/v1/sessions`, then exactly `N` `POST .../turns` calls, then
    a `POST .../v1/sessions/<new>/generate`. Print the log.

### Phase C — the replayed transcript matches the service (third acceptance criterion)

- Read the conversation back from the store and `apiClient.getSession(newSessionId)`.
- Assert the service's `turns` array matches the locally stored transcript **in length,
  and at every index in `role` and `content`**. Compare element by element and print a
  side-by-side table of index / role / local content / service content (truncate long
  content for display only, never for comparison).
- Any mismatch is a FAIL. Do not "normalise" whitespace or case to make it pass; if the
  two genuinely differ, report the difference and exit non-zero — that is a real finding
  about the implementation, not something for the proof to paper over.

### Phase D — `401` is distinguished from `404` (second acceptance criterion)

- Build a **second** `ApiClient` over the same base URL whose `getToken` returns a
  deliberately invalid bearer token (a literal like `"invalid-token-for-m6-proof"`),
  and a **second** `SessionCoordinator` over the same conversation store.
- Record the conversation's stored `sessionId` before this phase, and clear the second
  client's request log.
- `send()` a short prompt through the invalid-token coordinator and assert it **rejects**
  with a `HarnessApiError` whose `code === "unauthorized"` and `status === 401`.
- Assert **all** of:
  - the conversation's stored `sessionId` is **unchanged** — no rebuild happened;
  - the invalid-token client's request log contains **no** `POST <base>/v1/sessions`
    (no session was created);
  - the invalid-token client's request log contains **no** `POST .../turns`
    (no turn was replayed);
  - the conversation's stored `turns` array is unchanged in length and content.
  - Print the log so a reader can see the single failed request and nothing after it.

## Acceptance Criteria

- AC1 — `bun run proof:m6` exits `0` against the live harness and prints a summary in
  which every one of M6's three acceptance criteria is marked PASS.
- AC2 — Phase B proves the `404` was real by asserting `unknown_session`/`404` from the
  service before using the bogus id, and its assertions are the ones listed above.
- AC3 — Phase C compares every turn index by role and content, with no normalisation.
- AC4 — Phase D proves the `401` path performs no session creation and no turn replay.
- AC5 — No profile id literal appears in the file;
  `bun test test/no-hardcoded-profile-ids.test.ts` passes.
- AC6 — The bearer token is never printed to stdout or stderr.
- AC7 — `package.json` gains `"proof:m6"` and no other change.
- AC8 — Nothing under `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/` is modified,
  and the harness process is never restarted or killed.

## Files Allowed To Change

- `src/host/m6-proof.ts` (new)
- `package.json`

Nothing else. Do **not** modify `web/src/api-client.ts`, `web/src/session-coordinator.ts`,
`web/src/conversation-store.ts`, any test, or `.harness/`. If you believe the proof
cannot pass without changing one of those, **stop and report that** rather than changing
it — a failing proof is a real finding and this task is not authorised to fix it.

## Tests

Run from `/Users/ryankenny/Projects/phoneToLocalModel`:

```
export PATH="$HOME/.bun/bin:$PATH"
bun run proof:m6            # must exit 0
bun test                    # must exit 0
bunx tsc --noEmit           # must exit 0
```

Report each command, its exit status, and paste the **full stdout of `proof:m6`** into
your return — that transcript is the milestone's evidence and the orchestrator records it.

If the live harness is unreachable, say so plainly and report FAIL; do not substitute a
mock. Every M6 criterion is required to be proven against the live service.

## Notes

- Bun 1.4.0 is at `~/.bun/bin/bun`, not on PATH in non-interactive shells. Node is not
  installed.
- Live sanity check, already confirmed by the orchestrator:
  `GET /v1/sessions/00000000-0000-4000-8000-000000000000` returns
  `404 {"api_version":"v1","error":"unknown_session"}`, and the same request with a bad
  bearer token returns `401 {"error":"unauthorized"}`.
- Model responses vary. Assert `includes(theNumber)` on the recall answer rather than
  exact string equality, and keep the prompt explicit ("reply with only the digits").
  If the model reliably refuses to comply after a genuine retry, report it as a finding
  rather than weakening the assertion to something that proves nothing.
