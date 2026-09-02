# Task M5a-T4 — Pin the replay start seq in the lastSeq === -1 test

Tier: Cheap. Reason routed here: none — a single assertion, stated verbatim
below, in one named test in one named file, verified by running that test.

## Context

Repo root: /Users/ryankenny/Projects/phoneToLocalModel
Toolchain: Bun 1.4.0 at `~/.bun/bin/bun`, NOT on PATH. Export
`PATH="$HOME/.bun/bin:$PATH"` in every shell invocation.

The milestone criterion this serves reads:

> A resume from `pending.lastSeq === -1` sends `Last-Event-ID: -1` and **replays
> from seq 0** with no gap, proven by a unit test.

The test that exists — `"resumes with lastSeq === -1 (no events received before
drop), sends it to resumeEvents, and replays from seq 0 with no gaps"` in
`test/web/session-coordinator.test.ts` — currently proves only the "no gap" half:

```
1382:        expect(result.seqs.length).toBeGreaterThan(0);
1384:        for (let i = 1; i < result.seqs.length; i++) {
1385:          expect(result.seqs[i]).toBe(result.seqs[i - 1]! + 1);
1386:        }
```

Contiguity is asserted, but the **starting** seq is not. A replay yielding
`[5, 6, 7]` would satisfy this test, even though it did not replay from 0.

## Goal

Make the test prove the "from seq 0" half as well.

## Acceptance criteria for this task

1. The named test additionally asserts that the first replayed seq is exactly 0,
   i.e. an assertion equivalent to `expect(result.seqs[0]).toBe(0);`, placed with
   the other seq assertions.
2. It also asserts the full expected sequence, i.e. an assertion equivalent to
   `expect(result.seqs).toEqual([0, 1, 2]);` — the helper
   `generateResumeFromSeqZeroEvents()` yields seqs `[0, 1, 2]`. Keep the existing
   `length > 0` and contiguity assertions; ADD to them, do not replace them.
3. `bun x tsc --noEmit` still exits 0.
4. `bun test` passes with no fewer than **279** tests.
5. Nothing else changes. No other test is touched, no production code is touched.

## Files allowed to change

- `test/web/session-coordinator.test.ts`

Nothing else. No production file, no config file.

## Tests / validation to run

```
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/ryankenny/Projects/phoneToLocalModel
bun test test/web/session-coordinator.test.ts 2>&1 | tail -10
bun x tsc --noEmit; echo "TSC_EXIT=$?"
bun test 2>&1 | tail -10
```

## Report back

The exact lines added; the tsc exit status; the per-file and whole-suite test
counts. If `expect(result.seqs).toEqual([0, 1, 2])` does NOT pass, do not adjust
the assertion to match whatever the code produces — stop and report the actual
value, because that would mean the replay does not start at 0 and the milestone
criterion is unmet.
