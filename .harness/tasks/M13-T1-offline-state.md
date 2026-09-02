TASK  (M13-T1 — the view shows a distinct offline state and never loses the drafted prompt)

Tier: Mid. Reason for tier: NOT LOW RISK. The failure this task exists to prevent — a
drafted prompt silently discarded on a failed send — is invisible to a superficially
passing test, and the current code discards the draft on a path that runs BEFORE the
failure is known. Getting the ordering subtly wrong reproduces the exact defect while
looking correct.

Goal:
Make the client render a **distinct offline state** when the transport fails outright, keep
the drafted prompt in the input, and offer a retry control that re-sends that preserved
draft. This is milestone M13's first two acceptance criteria.

Background you need, and must not exceed:
The transport half already exists and you must NOT rebuild it. `web/src/api-client.ts`
already throws `HarnessOfflineError` when `fetch` itself rejects (line ~440), and
`web/src/session-coordinator.ts` (line ~413) already attaches the prompt to that error as
`error.draftPrompt`. Both were built and reviewed in milestone M7. Your work is entirely in
the **view** layer: `web/src/ui/view-model.ts` and `web/src/ui/dom-target.ts`.

The two defects to fix, both in `web/src/ui/dom-target.ts`'s send-button click handler:
1. `promptInput.value = "";` runs unconditionally as the handler's last statement — before
   the send promise settles. So a failed send has already cleared the draft.
2. The `.catch` calls `d.controller.setNotice(describeError(error))`. For an offline error
   that renders the generic notice text `"Cannot reach the harness (offline): ..."` — which
   is the generic error surface AND names a harness error code. Acceptance criterion 1
   forbids both.

Relevant Requirements:
- Edge case, quoted from `.harness/requirements.md`: "The harness is offline or the tailnet
  is unreachable: show a clear offline state and allow retry without losing the drafted
  prompt."
- This is a DERIVED criterion. It is not FR9 and must not be recorded as covering FR9: M7
  covered documented harness error CODES returned by a reachable service. This is a
  transport failure where no response exists at all.

Acceptance Criteria:
- `web/src/ui/view-model.ts` gains a distinct offline representation in the view model.
  Add a new variant to the `GenerationDisplay` union:
  `| { kind: "offline"; draftPrompt: string | null }`.
  It is a peer of `{ kind: "error"; code; message }`, NOT a special case of it. It carries
  no `code` field and no harness error code anywhere in it. Update every exhaustive
  consumer of `GenerationDisplay` so the repository still type-checks.
- `web/src/ui/dom-target.ts` renders that variant as a state visually and structurally
  distinct from the generic error/notice surface:
  - a dedicated element with `data-testid="offline"` whose text tells the human the Mac
    could not be reached and that their prompt has been kept;
  - its text contains **no harness error code** — in particular it must not contain the
    substring `offline_` nor render `guidance.code`, and it must not be produced by
    `describeError`. Assert this in a test over the rendered text.
  - the generic status element (`data-testid="status"`) must NOT show
    `Error (offline): ...` for this state.
- The drafted prompt survives. After a send that fails at the transport layer,
  `promptInput.value` still equals exactly what the human typed (the trimmed prompt that was
  sent). Fix the clearing so the input is cleared only on a send that did NOT fail — do not
  "restore" the value from a variable after the fact if you can instead simply not clear it
  until success; prefer whichever is simplest, but the observable behaviour above is what is
  being tested.
- A retry control exists: an element with `data-testid="retry"`, present when the state is
  offline. Clicking it re-sends the **preserved draft** — `actions.send` is called again
  with the same conversation id and the same prompt string, with the human having typed
  nothing in between. A retry that then succeeds proceeds to a normal `complete` generation
  state and the input is cleared at that point.
- The failing attempt leaves **no user turn and no assistant turn** behind in the local
  transcript. Prove this with a test that drives a real `createConversationStore` over
  `createMemoryStorage`, fails the send at the transport layer, and asserts the stored
  conversation's `turns` array is unchanged (length and contents) versus before the attempt.
  If it already holds by construction, the test still must exist and must be written so it
  would fail if a turn were appended.
- Tests are added to `test/web/ui/dom-target.test.ts` (and `test/web/ui/view-model.test.ts`
  for the view-model change). Follow the existing fake/helper style in those files — read
  them first and reuse `createTestWindow`, the recording-actions helper and the existing
  store/coordinator fakes rather than inventing new ones.
- **Inject the failure at the network layer, not by an error code.** Criterion 1 is explicit
  about this: the fake must reject the way a dead network rejects (a rejecting `fetch` /
  a thrown `TypeError` surfacing as `HarnessOfflineError` with `draftPrompt` set), not a
  fabricated `{code: "offline"}` response. A test that simulates offline with an error code
  does not prove this criterion.
- The whole repository still type-checks and every existing test still passes. Do not weaken
  or delete any existing assertion in `test/web/ui/dom-target.test.ts`; several existing
  tests select sections and `<ul>`s **positionally**, and `dom-target.ts` carries a comment
  at the `noticeSection` declaration warning that new sections must be appended LAST to keep
  those indices valid. Honour that comment.

Relevant Files:
- `web/src/ui/dom-target.ts` — the send handler (~line 100-168) and `paint` (~line 254)
- `web/src/ui/view-model.ts` — `GenerationDisplay`, `describeError`
- `web/src/ui/mount.ts` — `setGeneration` (read-only unless the union change forces a touch)
- `web/src/api-client.ts` — `HarnessOfflineError` (read-only, already correct)
- `web/src/session-coordinator.ts` — line ~413 attaches `draftPrompt` (read-only)
- `test/web/ui/dom-target.test.ts`, `test/web/ui/view-model.test.ts`

Files Allowed To Change:
- `web/src/ui/view-model.ts`
- `web/src/ui/dom-target.ts`
- `web/src/ui/mount.ts`
- `test/web/ui/dom-target.test.ts`
- `test/web/ui/view-model.test.ts`
- `test/web/ui/mount.test.ts`

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour.
- Do not introduce dependencies unless required. No third-party code — a project constraint.
- Do not weaken tests.
- Do NOT change `web/src/api-client.ts` or `web/src/session-coordinator.ts`. If you believe
  one of them is wrong, say so in Unresolved Issues instead of editing it.
- Do NOT touch transcript rendering / `replaceChildren` performance. That is a separate task
  (M13-T2) and editing it here will collide.
- Follow Red -> Green -> Refactor: write the failing test first and state in your return
  that you saw it fail for the right reason before you made it pass.
- `web/src/` may not import Node or Bun APIs; it is browser code. There are bundle-purity
  tests that enforce this.

Tests:
  export PATH="$HOME/.bun/bin:$PATH"
  bun test test/web/ui/ test/web/
  bun x tsc --noEmit    (or the repository's existing type-check invocation — find it, do
                         not invent one; check package.json and tsconfig.json)

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
