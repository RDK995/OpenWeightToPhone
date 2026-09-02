TASK

Tier: Cheap (attempt 1). Routing reason: none of the four escalation reasons fails. This is a
few-line change to one test, with an exact oracle — the test must fail when the thing it tests
is broken, and that is directly demonstrable.

Goal:
Harden the Swift round-trip test in `test/host/pair.test.ts` so that it cannot pass when the
QR round-trip fails. As written it swallows failure and reports success.

Relevant Requirements:
The M11-T6 packet's `Tests` item 7 and its standing constraint "Do not weaken tests". The task
packet also states, of round-trip tests, that they must not be "inside a try/catch that
swallows failure".

Background — what is wrong:
The test `"should round-trip through QR decode correctly (swift)"` in
`test/host/pair.test.ts` (roughly lines 153-209) contains **two silent success paths**:

```typescript
      // Check if swift is available
      try {
        execSync("which swift", { stdio: "ignore" });
      } catch {
        // Swift not available, skip this test gracefully
        return;
      }
      ...
      try {
        decodedPayload = execSync(`swift "${swiftDecoderPath}" "${pngPath}"`, {
          encoding: "utf-8",
        }).trim();
      } catch (error) {
        // If decoding fails, skip gracefully
        console.log("Swift QR decoding failed, test skipped");
        return;
      }
```

The **second** one is the defect: if the decoder exits non-zero — precisely the failure this
test exists to catch — the test logs a line and returns, and the runner records a pass. A test
that cannot fail is worth nothing. This is the same class of bug that let an earlier attempt
report eight passing tests that had never executed.

Acceptance Criteria:
- **Remove the second try/catch entirely.** A non-zero exit from `swift scripts/qr-decode.swift`
  must FAIL the test. Let `execSync` throw, or capture the exit status explicitly and assert it
  is 0 — either is fine, but a decode failure must produce a red test.
- **Keep the first guard** (`which swift`) — the packet explicitly permits skipping when `swift`
  is genuinely absent from the machine. But make the skip **loud and unmistakable**: if it
  fires, `console.warn` that the round-trip assertion did not run. It must never be possible to
  read a green run and believe the round trip was checked when it was not.
- The existing assertion `expect(decodedPayload).toBe(expectedPairingUrl)` stays exactly as it
  is, and must still execute on this machine.
- Change nothing else in the file. The other 9 tests stay exactly as they are.

**Prove the test can now fail — this is the point of the task, not an optional extra.**
Temporarily corrupt the input so the decode genuinely fails (for example, point the decoder at
a PNG that contains no QR code, or truncate the PNG bytes before writing), run the test, and
**observe it FAIL**. Quote the failing runner output in your return. Then revert your temporary
corruption and confirm the test passes again. Do not commit the corruption.

Relevant Files:
- `test/host/pair.test.ts` — the only file to change.
- `test/qr/encode.test.ts` — for reference, its Vision round-trip tests assert
  `expect(result.exitCode).toBe(0)` rather than swallowing failure. Match that standard.

Files Allowed To Change:
- `test/host/pair.test.ts`

Constraints:
- Do not touch any other file. `src/host/pair.ts`, `src/qr/render.ts` and everything else are
  verified and final.
- **Never read, write or chmod the real token file `~/.openweight-harness/token`.**
- Do not modify anything under `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`.
- Do not weaken any other test. Do not delete the round-trip test — strengthen it.

Tests:
- `bun test test/host/pair.test.ts` — quote the runner's own summary line (pass/fail/expect
  counts). It must be 10 pass / 0 fail, with the expect() count HIGHER than the current 79 if
  you added an assertion, and never lower.
- `bun test` — the full suite must stay green; quote the summary line.
- `bunx tsc --noEmit` — must exit 0.
- The deliberate-failure demonstration described above, with the failing output quoted.

Return:
- Summary
- Files changed
- Tests run
- Test result (quoted runner summary lines for every command, plus the quoted output of the
  deliberate-failure run showing the test going red, and confirmation it is green again after
  reverting)
- Unresolved issues
