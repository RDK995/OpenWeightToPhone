## M5a — The repository type-checks, and the resume result matches what it reconciled

Status: DONE

### Outcome

A chore milestone clearing the three `OPTIONAL` findings from M5's cycle-1 review. It adds
no user-facing behaviour and completes no requirement on its own; it exists because two of
the three are invisible where they were recorded, and the third hides future defects.

The substantive item is that **this repository has no working whole-project type check**.
`bunx tsc --noEmit` fails with ~130 errors that are all declaration-resolution noise —
`node_modules` is absent, no Bun or Node type package is declared, and `.ts`-extension
imports are not permitted by `tsconfig.json`. None are semantic errors under `web/src/`, but
that is exactly the problem: a genuine type error in the client would be indistinguishable
from the noise, and would stay invisible through the final review, whose broadest validation
is otherwise `bun test`. Turning the check on may surface real errors, which is the reason
this runs through the harness with a review rather than being fixed by hand.

The second item is a latent trap rather than a live bug. On the `seq_not_available` fallback
path, `web/src/session-coordinator.ts:379-388` returns `text: pending.partialText` — the
text held before the drop — while `reconcileTurnsFromSnapshot`, called two lines earlier,
has already written the correct full text into the store. Nothing reads the field today
because C10 does not exist. A UI that renders `ResumeResult.text` after a fallback recovery
would show stale partial content while the correct answer sat in `conversation.turns`. The
field is corrected at source rather than documented as a hazard.

The third is a test gap with no defect behind it. A drop before any SSE event arrives leaves
`pending.lastSeq = -1`, so a resume sends `Last-Event-ID: -1`. That was checked against the
service and is **correct**: `harness/api/generation.ts:975-976` defines `-1` as the valid
floor meaning "I hold nothing", `harness/api/router.ts:325-331` accepts it, and the harness's
own `create` calls `subscription(record, -1)`. The client interoperates properly and needs no
change — only a test, because no unit test and no live-proof phase reaches the path (the
proof always aborts after 3 content deltas, so `lastSeq` is never below 0 in any observed
run).

### Architecture

No component is added, removed or re-scoped. C9 (Session Coordinator) changes behaviour on
one branch only. Repository-wide type-checking is build tooling, not a component, and does
not appear in `.harness/architecture.md`. No deviation is expected; record one if the type
check forces an interface change.

### As-Built

`.harness/as-built/M5a.md` — RECORDED. 10 of 10 files attributed; components C4, C6, C7,
C8, C9 observed across 3 edges; **no claim mismatch**, so the `### Architecture` field's
no-deviation claim holds as recorded.

### Acceptance Criteria
- [x] (chore) `bunx tsc --noEmit` exits 0 across the whole repository, including `src/host/`,
      `test/` and `web/src/`. If any error cannot be eliminated, it is not left in the exit
      code: it is suppressed explicitly at its site with a comment saying why, and listed
      under `### Evidence`. A green run that skips files is not a pass — the file count the
      check covers is recorded and is not lower than the repository's `.ts` file count.
- [x] (chore) Every type error the newly-working check surfaces under `web/src/` is either
      fixed or recorded, and `bun test` is still green afterwards at no fewer than the 276
      tests passing at M5's close.
- [x] (derived: FR7) On the `seq_not_available` fallback path, `ResumeResult.text` equals the
      reconciled assistant text held in `conversation.turns`, not the pre-drop partial.
      Proven by a unit test that reconciles a snapshot whose full text differs from the
      partial and asserts the returned `text` is the full one.
- [x] (derived: FR7) A resume from `pending.lastSeq === -1` sends `Last-Event-ID: -1` and
      replays from seq 0 with no gap, proven by a unit test. No client change is expected;
      if the test passes without one, that is the criterion satisfied, not a vacuous result.

### Baseline

`052db73fb28be6aff2699a57b5bdf2678d286fe9` on `main` (recorded before any task ran).

`src/`, `test/`, `web/` and `scripts/` are still entirely **untracked** at this baseline —
as they were for M5 — so `git diff 052db73` shows nothing and is useless to a reviewer.
A pre-M5a worktree snapshot was therefore written as a git ref before any task ran:

    refs/harness/m5a-pre = cef79bf51491231ab8237ee81c5ca7d5d29803bc

M5a's diff is obtained with a temporary index, which is the only way to diff untracked
files against a commit:

    export GIT_INDEX_FILE=/tmp/m5a-review-idx; rm -f /tmp/m5a-review-idx
    git add -A .
    git diff --cached refs/harness/m5a-pre
    unset GIT_INDEX_FILE

That diff is exactly M5a's work and nothing else. Baseline broad validation was **red by
design**: `bun x tsc --noEmit` -> exit 1, 130 errors (that failure is the milestone's
subject). `bun test` was green at 276 pass / 0 fail across 11 files.

### Evidence

**Status: implementation complete, awaiting review.** Four tasks, every one routed to the
**Cheap** tier and every one passing on its first attempt. No escalation was needed and no
rung above Cheap was used anywhere in this milestone.

| Task | Tier / outcome | What it did |
| --- | --- | --- |
| T1 — type declarations resolve | Cheap, attempt 1, PASS | `@types/bun` devDependency; `allowImportingTsExtensions: true` and `types: ["bun"]` in `tsconfig.json`. Errors 130 -> 26. |
| T2 — AC3 fix + AC3/AC4 tests | Cheap, attempt 1, PASS | `ResumeResult.text` now reads the reconciled turn; two new unit tests. |
| T3 — remaining semantic errors + header test | Cheap, attempt 1, PASS | All 26 semantic errors fixed; `tsc` reaches exit 0; api-client `Last-Event-ID: -1` test. |
| T4 — pin the replay start seq | Cheap, attempt 1, PASS | Added `seqs[0] === 0` and `seqs == [0,1,2]` to the AC4 test. |

Task packets: `.harness/tasks/M5a-T1.md` … `M5a-T4.md`. Each result was re-validated by an
independent verifier that re-ran the task's own commands; no task was accepted on a worker's
say-so.

**Files changed by M5a** (verified against `refs/harness/m5a-pre`):

- `package.json`, `tsconfig.json`, `bun.lock` — T1 only.
- `web/src/session-coordinator.ts` — the AC3 fix, plus narrowing of the value it reads back.
- `web/src/sse-reader.ts` — **one line**: `readEvents` return type `AsyncIterable<HarnessEvent>`
  -> `AsyncGenerator<HarnessEvent>`. The function is already an `async function*`, so the old
  annotation was imprecise rather than wrong; runtime behaviour is identical and
  `AsyncGenerator` is assignable to `AsyncIterable`, so the `api-client.ts` consumers
  (lines 249, 284, fields at 64, 70) are unaffected.
- `src/host/pwa-server.ts` — `Bun.Server` -> `Bun.Server<never>`, type-level only.
- `test/web/session-coordinator.test.ts`, `test/web/api-client.test.ts`,
  `test/web/conversation-store.test.ts`, `test/web/sse-reader.test.ts` — new tests and
  strict-mode type corrections.

**AC1 — suppressions, listed as the criterion requires.** `tsc` reaches exit 0 with **no**
error left in the exit code and the following seven explicit, commented, at-site
suppressions, all in test code and all for `noUncheckedIndexedAccess` array indexing:

    test/web/conversation-store.test.ts:120, 122, 124, 592, 594, 654, 659
    // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified

Repo-wide: **zero** `@ts-nocheck`. **Zero** `as any` or `as unknown as` introduced anywhere by
M5a — confirmed by grepping the added lines of the milestone diff, which returns nothing. The
pre-existing `as unknown as` at `web/src/sse-reader.ts:30` and the `as any` uses in
`test/web/api-client.test.ts` and `test/web/session-coordinator.test.ts` all predate this
milestone and were not touched.

**AC1 — coverage.** The check covers **26** project `.ts` files; the repository contains
**26** `.ts` files outside `node_modules`/`.git`/`.harness`. Equal, so nothing is skipped:

    bun x tsc --noEmit --listFiles | grep -E '\.ts$' | grep -v node_modules | wc -l   -> 26
    find . -name '*.ts' -not -path './node_modules/*' -not -path './.git/*' \
         -not -path './.harness/*' | wc -l                                            -> 26

`tsconfig.json` `include` is still `["src", "web/src", "scripts", "test"]`, with no `exclude`
added — verified after every task.

**AC2 — errors surfaced under `web/src/`.** Turning the check on surfaced two, both fixed
rather than recorded: a `TS2532` in the AC3 fix itself in `session-coordinator.ts` (fixed by
real narrowing, not `!` or a cast) and the imprecise `readEvents` return type in
`sse-reader.ts`. `bun test` went 276 -> 279, above the 276 floor.

**AC3.** `resumeFromSessionSnapshot` now reads the conversation back after
`reconcileTurnsFromSnapshot` and returns the last assistant turn's content, falling back to
`pending.partialText` only when no assistant turn exists. The earlier `status === null` early
return — which does **not** reconcile — still returns `pending.partialText` and was
deliberately left alone. Proven by a new test where the partial is `"The ans"` and the
reconciled full text is `"The answer is 42."`; the worker observed it Red before the fix
(`Expected: The answer is 42. Received: The ans`).

*One item the reviewer should re-confirm rather than take from here:* T2 changed an
**existing** assertion at `test/web/session-coordinator.test.ts:~1054` from
`expect(result.text).toBe("Partial answer")` to `"Full answer"`. This was adjudicated as an
assertion that **encoded the very bug AC3 exists to fix** — the same test's own setup asserts
the reconciled turn holds `"Full answer"` — and therefore had to change. It is not a
weakening (the new assertion demands the correct value), but it is the one place in this
milestone where an existing test's expectation moved, so it deserves independent eyes.

**AC4.** Confirmed as a test gap with no defect behind it: the Half B test passes with **no**
production change, which is the criterion satisfied, not a vacuous result. Proven at two
levels — the coordinator passes `-1` down to `resumeEvents`, and a new `api-client` test
asserts the outgoing request header `last-event-id` is exactly `"-1"`. The first version of
the test asserted contiguity and `length > 0` but never the **starting** seq, so a `[5,6,7]`
replay would have passed it; T4 was routed specifically to close that, adding
`expect(result.seqs[0]).toBe(0)` and `expect(result.seqs).toEqual([0, 1, 2])` alongside the
existing assertions rather than replacing them.

No test anywhere is skipped, `.todo`, deleted or commented out; the suite grew 276 -> 279.

### Validation

Final state, run after the last task and independently re-run by a verifier:

| Command | Result |
| --- | --- |
| `bun x tsc --noEmit` | **exit 0**, no output (was exit 1 / 130 errors at baseline) |
| `bun test` | **279 pass, 0 fail**, 653 expect() calls, 11 files (was 276 at M5's close) |
| `bun run build` | **exit 0** — built `index.html`, `main.js` |
| `tsc --listFiles` project `.ts` count vs `find` count | **26 vs 26** — equal, nothing skipped |

All commands run with `PATH="$HOME/.bun/bin:$PATH"` from the repository root.

### Review

**Cycle 1 — PASS.** Reviewer tier: **sonnet** (the pinned floor; the highest tier that
produced this work was Cheap/haiku, and the reviewer is never overridden downwards).
Fresh context, full-milestone scope, invoked from the implement skill.

Completion gate applied: all four acceptance criteria have a per-criterion row in the
reviewer's table and every row is PASS. No BLOCKER and no IMPORTANT finding.

The reviewer re-ran the validation itself rather than crediting the record: `bun x tsc
--noEmit` exit 0, `bun test` 279 pass / 0 fail across 11 files, and the AC1 coverage check
independently at 26 `tsc --listFiles` files vs 26 repository `.ts` files. It confirmed
`tsconfig.json` gained no `exclude`, that `noUncheckedIndexedAccess` was already `true`
before this milestone rather than newly loosened, that exactly seven commented
`@ts-expect-error` suppressions exist at the recorded sites, and that there is no
`@ts-nocheck` anywhere in the repository.

The two items flagged for independent adjudication both held. The changed assertion at
`test/web/session-coordinator.test.ts:~1058` was traced from the test's own fixture — which
sets the assistant turn to `"Full answer"` while `partialText` is `"Partial answer"` — and
judged a legitimate correction of an assertion that encoded the pre-fix bug, not a
weakening. The AC4 test was confirmed non-vacuous: the `[5,6,7]`-would-have-passed gap was
genuinely present before T4 and is closed by assertions added alongside, not replacing, the
originals.

Two `OPTIONAL` findings, neither blocking and both already recorded under `### Follow-ups`
before the review ran: the type check is not wired into a script or CI gate, and the seven
suppressions could be collapsed into one typed helper.

### Review Cycles
0

### Follow-ups

- **The type check is not wired into anything.** `package.json` has no `typecheck` script and
  nothing runs `tsc` in CI, so the exit-0 state M5a just established can regress silently —
  which is the same class of problem M5a was created to fix. Adding a `typecheck` script and
  running it alongside `bun test` is outside M5a's criteria; it is the obvious next chore.
- The seven `@ts-expect-error` suppressions in `test/web/conversation-store.test.ts` are all
  `noUncheckedIndexedAccess` array indexing in assertions. They are honest and commented, but
  a small typed helper (or `toMatchObject` on the array) would remove all seven.
- Pre-existing and untouched by M5a, recorded only so they are not mistaken for new: the
  `as unknown as` at `web/src/sse-reader.ts:30`, and the `as any` uses in
  `test/web/api-client.test.ts` and `test/web/session-coordinator.test.ts`.
- `web/src/sse-reader.ts` `readEvents` is now typed `AsyncGenerator`. If a future consumer
  should not be able to call `.return()`/`.throw()` on it, the narrower `AsyncIterable` should
  be reinstated at the consumer's field type rather than at the function's return type.


