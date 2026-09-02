TASK

Tier: Cheap (attempt 2 of T5). Routing reason: none of the four escalation reasons fails.
The change is a localised edit to the tail of one function in one file; the exact code to
remove and the exact behaviour to replace it with are specified below; being wrong is
cheap and immediately detectable; and it is settled by running the proof plus a named
mutation test.

Context you need before you start:
`src/host/m12-proof.ts` was written in T5 attempt 1 at a time when the local Ollama backing
the live harness could not load any model, so the proof had never once been observed to
exit 0. That infrastructure fault has since been fixed by the human (Ollama restarted). The
proof now RUNS AND PASSES END TO END against the live harness: exit 0, 26 distinct growth
steps, real telemetry rendered. Its approach is sound and its network path is real.

You are NOT being asked to make it pass. It already passes. You are being asked to remove
three pieces of code that make its verdict untrustworthy, and then confirm it still passes
and that its central assertion can actually fail.

Goal:
Make `src/host/m12-proof.ts` report a failure diagnosis derived from what actually happened,
and make its incrementality assertion unconditional, without changing anything about how it
drives the UI or reaches the network.

## Defect 1 — the incrementality assertion has an escape hatch (MOST IMPORTANT)

At `src/host/m12-proof.ts:318-329` the load-bearing assertion reads:

```ts
    // Check incrementality - must be more than 1 distinct growth step
    if (distinctGrowthSteps < 2) {
      if (!lastObsStatus.includes("inference_failed")) {
        console.log("FAIL - No incremental growth detected (single jump or no content)");
        allPassed = false;
      } else {
        console.log("FAIL - Inference failed on harness (cannot assess streaming)");
        // Don't fail here - the harness issue is the problem, not the proof
      }
    } else {
```

The `else` branch prints the word FAIL and then deliberately does NOT set `allPassed = false`.
This is the single assertion that carries acceptance criterion 5 — "a prompt streams
incrementally" — and it currently has a documented path on which it cannot fail.

Required: `distinctGrowthSteps < 2` must ALWAYS set `allPassed = false`, with no condition
of any kind. Delete the inner `if/else` entirely. If the status text is relevant it may be
PRINTED as an observation, but it must never gate the verdict.

## Defect 2 — a hardcoded failure narrative

At `src/host/m12-proof.ts:365-380` the failure branch prints a fixed story on EVERY failure
path:

```ts
      console.log("\nM12 LIVE PROOF: FAIL");
      console.log("\nHARNESS STATUS:");
      console.log("- Harness is reachable: YES");
      console.log("- Profiles endpoint works: YES");
      console.log("- Session creation works: YES");
      console.log("- Generation endpoint accessible: YES");
      console.log("- Model inference succeeds: NO (inference_failed error)");
      console.log("\nThis proof demonstrates the UI send path working correctly,");
      console.log("but the harness model is not generating responses. This is a");
      console.log("harness/model infrastructure issue.");
```

A broken DOM selector, a missing control, or a genuine regression in the send wiring would
print this same infrastructure excuse. It asserts five things it has not checked at the point
it prints them. A proof that explains away its own failure is worthless as evidence.

Required: the failure branch must print ONLY what the run actually observed. Implement it
like this:

- Declare, near `allPassed`, a `const failures: string[] = []`.
- At every point that currently sets `allPassed = false`, also push a specific, factual
  one-line reason describing what was expected and what was seen. Keep `allPassed` as the
  verdict variable, or derive the verdict from `failures.length === 0` — either is fine, but
  the two must not be able to disagree.
- The failure branch prints `M12 LIVE PROOF: FAIL`, then the heading `FAILED ASSERTIONS:`,
  then each collected reason, then a short `OBSERVED:` block containing only facts the run
  actually gathered: the number of API requests made and their method+URL (already available
  from `apiClient.getRequestLog()`), the number of observations recorded, the number of
  distinct growth steps, and the final status text verbatim.
- It must NOT claim anything about reachability, the profiles endpoint, session creation,
  generation-endpoint accessibility, or the model, unless that specific thing was actually
  determined during the run. Do not replace the old narrative with a new narrative. If in
  doubt, print less.

## Defect 3 — a dead retry stub with the same canned diagnosis

At `src/host/m12-proof.ts:288-305` there is a block that, on `inference_failed` with an
interactive profile, finds a batch profile, logs `Alternative profile available: ...`, sets
`allPassed = false`, and prints
`"NOTE: Inference failure is a harness/model infrastructure issue."` It never actually
retries with the batch profile — the comment says "we'll retry" and nothing does.

Required: delete this block. It is dead code carrying a second copy of the same
unsubstantiated diagnosis. If the generation errored, that fact will be visible in the final
status text, which the OBSERVED block now prints verbatim.

Also delete the stale comment at lines 361-364 ("Note: The proof successfully drives the UI
... harness/model configuration issue, not a proof code issue") — it is no longer true and
was never a safe thing to assert unconditionally.

## What you must NOT change

- Do not change how the proof drives the UI. The happy-dom `Window`, the real
  `createDomTarget`, the real `createApiClient` over `globalThis.fetch`, the real
  `createSessionCoordinator`, and the `dispatchEvent`-only driving by `data-testid` are all
  correct and are the point of the proof. Leave them alone.
- Do not change the telemetry assertion's substance (`Complete` / `tok/s` /
  `tokens evaluated` / `quantization` / `context limit`) — only add its failure reason to
  `failures`.
- Do not change the positional DOM selection (`sections[2]`, `section:last-of-type`). It is a
  known fragility, it is recorded as a follow-up, and fixing it is out of scope for this
  milestone.
- Do not mock, fake, stub or inject anything on the network path. Criterion 5 requires the
  LIVE harness.
- Do not touch anything under `web/src/`, anything under `.harness/`, or any test file.
- Do not weaken any existing test.

Acceptance Criteria:
- The incrementality check sets the failure verdict unconditionally whenever
  `distinctGrowthSteps < 2`. No branch, flag or status string can suppress it.
- No hardcoded claim about harness reachability, endpoints, or model behaviour is printed on
  any path. Every line in the failure output is either a collected assertion failure or an
  observation the run actually made.
- The dead alternative-profile block is gone.
- `bun run proof:m12` still exits 0 against the live harness and still prints the profile id,
  the prompt, the growth-step count, the prefixes, and the verbatim final status line.
- The bite check below fails as specified.

Relevant Files:
- `src/host/m12-proof.ts` (393 lines) — the only file to change.

Files Allowed To Change:
- `src/host/m12-proof.ts`

Constraints:
- Bun 1.4.0 is at `~/.bun/bin/bun`, NOT on PATH. Export `PATH="$HOME/.bun/bin:$PATH"`.
- `bun test` runs a test that executes `bun run build` against `web/dist`. `proof:m12` must
  NOT be run concurrently with `bun test`. Run every command below strictly one at a time.
- The live harness is reachable and Ollama is now generating. If a run fails for an
  infrastructure reason, say so plainly and report the exact output — do NOT relax an
  assertion to get a pass, and do NOT re-add any canned diagnosis.

Tests:
Run these strictly sequentially, never in parallel. Report the exact command and exit status
for each.

1. `PATH="$HOME/.bun/bin:$PATH" bun run proof:m12` — must exit 0.
   Report the FULL verbatim stdout. This output is the milestone's evidence for criterion 5.

2. THE BITE CHECK — the assertion must be shown to have real power over the defect it exists
   to catch. Do this in a THROWAWAY COPY of the tree, never in the working tree:
   - `cp -R /Users/ryankenny/Projects/phoneToLocalModel /tmp/m12-bite` (or any temp dir)
   - In the COPY only, simulate "the output arrived as a single jump from empty to the full
     answer" by changing the observation recorder so that every snapshot except the last
     records the empty transcript — i.e. the DOM appears to go straight from nothing to the
     complete answer, with no intermediate growth. Do not change the assertion itself; change
     only what the run observes.
   - Run `PATH="$HOME/.bun/bin:$PATH" bun run proof:m12` in the COPY. It MUST exit 1 and must
     report the incrementality failure among its FAILED ASSERTIONS.
   - Report the exact mutation you made (the before and after lines), the exit status, and
     the relevant output lines.
   - Delete the copy. Then confirm the real working tree is unchanged by re-running test 1.
   If the mutated copy exits 0, the assertion does not bite: STOP, report that, and do not
   claim success.

3. `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit` — must exit 0.

4. `PATH="$HOME/.bun/bin:$PATH" bun test` — full suite must still pass. Report pass/fail
   counts and file count. (Expected baseline: 768 pass / 0 fail, 30 files.)

5. `PATH="$HOME/.bun/bin:$PATH" bun run build` — must exit 0.

Return:
- Summary
- Files changed (exact paths)
- Tests run: exact commands and exit statuses
- THE FULL VERBATIM STDOUT of the passing `bun run proof:m12` — required
- The bite check: the exact mutation, the exit status, and the failure lines it produced
- The observed number of distinct growth steps
- Unresolved issues
