TASK  (M13-T2 — transcript rendering stops rebuilding every node on every paint)

Tier: Mid. Reason for tier: NOT LOW RISK. This is a keyed DOM reconciliation replacing a
wholesale rebuild. The failure modes — a reordered transcript, a dropped turn, a stale node
reused for the wrong entry — are silent, are exactly what acceptance criterion 4 exists to
catch, and a naive "only touch the last node" optimisation passes the performance assertion
while corrupting the transcript.

Goal:
Make `paint` in `web/src/ui/dom-target.ts` update the transcript incrementally, so the DOM
work per paint does not scale with the number of turns already in the transcript — and prove
it with the two falsifiable assertions milestone M13 specifies.

Background you need, and must not exceed:
`web/src/ui/dom-target.ts`'s `paint` currently ends the transcript block with
`transcriptList.replaceChildren(...transcriptItems)`, having just rebuilt an `<li>` for every
entry via `view.transcript.map(...)`. Milestone M12 subscribed `paint` to streaming deltas:
every delta from the model repaints. So a conversation with N turns receiving D deltas does
O(N x D) DOM element creations across a single generation, on the slowest device in the
system (an iPhone). That is the concrete latent defect this task removes.

The shape of the transcript matters and is why this is not a trivial optimisation. Read
`buildViewModel` in `web/src/ui/view-model.ts` first. During streaming the transcript is:
the selected conversation's stored turns (stable, unchanged between deltas), followed by AT
MOST ONE synthetic `pending: true` assistant entry whose `content` grows on every delta.
So the common streaming case is "a long stable prefix plus one mutating tail entry". But do
NOT hardcode that assumption as the whole algorithm: turns are also appended, conversations
are switched (which replaces the entire transcript), and entries can change `cancelled` /
`pending` flags. Your reconciliation must stay correct in all of those cases, not only the
streaming one.

Relevant Requirements:
- Edge case, quoted from `.harness/requirements.md`: "A very long transcript must not break
  rendering."
- This is a DERIVED criterion. It proves no numbered acceptance requirement and must never
  be recorded as covering one.

Acceptance Criteria:
- `paint` no longer calls `transcriptList.replaceChildren(...)` with a freshly-built node per
  entry on every paint. Existing `<li>` nodes are reused when the entry they represent is
  unchanged; only genuinely new or changed entries cause element creation or text updates.
- **The scaling assertion (M13 acceptance criterion 3).** Add a test that:
  - mounts a transcript of at least **500 turns**;
  - applies **200 streaming deltas** (drive this the way the app does — through the mount
    handle's `setStreamingText` so the real `paint` path runs; do not call `paint` with a
    hand-built view model if that bypasses the real path);
  - counts how many DOM elements are CREATED across those 200 deltas — instrument
    `document.createElement` (wrap it before `createDomTarget` captures
    `root.ownerDocument`, or spy on it) and count calls;
  - repeats the whole measurement at a transcript size an **order of magnitude smaller**
    (e.g. 50 turns), with the same 200 deltas;
  - asserts the per-delta element-creation count does NOT scale with transcript length.
    Make the assertion tight enough that it FAILS against the current `replaceChildren`
    implementation. Verify this claim empirically: run the new test against the OLD code
    (stash your change, or temporarily restore the old line) and record in your return that
    you saw it fail, and the numbers it failed with. A performance assertion that passes
    against the unfixed code proves nothing and this task will be rejected for it.
  - State the actual measured numbers (old and new, both sizes) in your return.
- **The fidelity assertion (M13 acceptance criterion 4).** Add a test that mounts the same
  500-turn transcript and asserts every turn's text renders intact — no truncation, no
  reordering, no dropped turns — by comparing the rendered `<li>` list against
  **the view model's own `transcript` array** (`buildViewModel(state).transcript`), entry by
  entry and in order, NOT against a separately hand-written expectation and NOT against the
  renderer's own output. Give the turns distinguishable content so a reordering or an
  off-by-one is actually detectable (do not fill 500 turns with identical text). Assert the
  rendered count equals the view model's count.
- Additionally assert correctness across the cases the streaming shortcut would break:
  switching the selected conversation replaces the whole transcript; appending a turn after
  streaming completes (the pending entry becomes a real turn) leaves the list correct; and a
  cancelled turn still renders its `(cancelled)` marker. Reuse the existing text format
  exactly — `` `${entry.role}: ${entry.content}${cancelled ? " (cancelled)" : ""}${pending ?
  " (pending)" : ""}` `` — do not change what the transcript reads like. This milestone
  changes rendering MECHANISM only, never presentation.
- Every existing test still passes and the repository still type-checks. Existing tests in
  `test/web/ui/dom-target.test.ts` select sections and `<ul>` elements POSITIONALLY —
  the transcript `<ul>` must stay the same element at the same position. Do not replace the
  `transcriptList` element itself, and do not add or reorder sections.

Relevant Files:
- `web/src/ui/dom-target.ts` — `paint`, transcript block (currently ~line 370-400 after
  M13-T1's edits; re-locate it yourself, the file has just changed)
- `web/src/ui/view-model.ts` — `buildViewModel`, `TranscriptEntry` (read-only)
- `web/src/ui/mount.ts` — `setStreamingText` drives the paint path (read-only)
- `test/web/ui/dom-target.test.ts`

Files Allowed To Change:
- `web/src/ui/dom-target.ts`
- `test/web/ui/dom-target.test.ts`

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour.
- Do not introduce dependencies unless required. No third-party code and no virtual-DOM
  library — a project constraint. Hand-written reconciliation only.
- Do not weaken tests.
- Do NOT change the offline / retry / draft-preservation behaviour added moments ago by task
  M13-T1 in this same file, and do not touch its tests. If you believe M13-T1 is wrong, say
  so in Unresolved Issues instead of editing it.
- Do NOT change the transcript's visible text format or the DOM structure other than
  reusing nodes.
- `web/src/` may not import Node or Bun APIs; it is browser code, and bundle-purity tests
  enforce this.
- Follow Red -> Green -> Refactor. State explicitly in your return that you saw each new test
  fail against the unfixed code, and why it failed.

Tests:
  export PATH="$HOME/.bun/bin:$PATH"
  bun test test/web/ui/
  bun test                      (full suite)
  bun x tsc --noEmit

Return:
- Summary
- Files changed
- Tests run
- Test result (include the measured element-creation numbers, old vs new, both transcript
  sizes)
- Unresolved issues
