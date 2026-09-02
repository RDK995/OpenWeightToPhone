# Task M12a-ii-T6 — Restore `tsc --noEmit` to clean: 4 invalid matcher arguments in T1's tests

Tier: **Cheap**. Named reason: none — no gate fails. The defect is identified to the exact
lines, the fix is mechanical, the blast radius is four expression arguments in one test
file, and the oracle is `tsc --noEmit` exiting clean. This is a correction of task T1's
output, not new behaviour.

## Goal

`M5a` established that this repository type-checks as a standing invariant. Task T1 of this
milestone broke it, and neither T1's worker nor T1's verifier caught it, because the
project's runner is `bun test` — which strips types without checking them — so the suite is
green while `tsc` is red.

Current state, reproduced by the orchestrator:

```
test/web/credential-store.test.ts(728,9): error TS2554: Expected 1 arguments, but got 2.
test/web/credential-store.test.ts(736,9): error TS2554: Expected 1 arguments, but got 2.
test/web/credential-store.test.ts(742,9): error TS2554: Expected 1 arguments, but got 2.
test/web/credential-store.test.ts(748,9): error TS2554: Expected 1 arguments, but got 2.
```

All four are inside the `adoptCredentialFromPastedText` delegation / anti-drift structural
test. They are calls of the form:

```ts
expect(functionStart).toBeGreaterThan(
  -1,
  "adoptCredentialFromPastedText function not found"
);

expect(functionBody).toContain(
  "adoptCredentialFromFragment",
  "adoptCredentialFromPastedText must call adoptCredentialFromFragment"
);
```

Bun's `toBeGreaterThan` and `toContain` take **exactly one** argument. The trailing string is
not a Jest-style assertion message — it is an extra argument that Bun **silently discards at
runtime**. It has never been evaluated, never been displayed on failure, and removing it
changes no assertion's meaning or strength.

## What to do

Remove the second argument from each of those four `expect(...)` calls, leaving the matcher
and its single real argument intact. Do not delete an assertion, do not change a matcher, do
not change `.not.` to anything else, do not change the values being asserted.

**Preserve the intent the discarded strings carried** by moving each one to a `//` comment on
the line above its assertion, so a human reading a failure still learns what the check was
for. That is a comment, not an argument — it must not be passed to `expect` or the matcher.

Collapse each call back onto fewer lines if the result fits within the file's existing line
width; match the surrounding style.

## This is the one thing that would make the fix wrong

**Do not weaken any assertion.** Specifically:

- `expect(functionStart).toBeGreaterThan(-1)` must keep `-1`.
- The two `.toContain(...)` and two `.not.toContain(...)` calls must keep their exact
  subject strings: `"adoptCredentialFromFragment"`, `"store.setCredential"`,
  `"URLSearchParams"`. These are the anti-drift assertions that stop the pasted-text path
  growing a second copy of the credential parsing, and a verifier has already proved by
  mutation that they bite. If your edit makes any of them stop biting, the fix is worse than
  the defect.
- The test count in this file must stay at **51**, with the same test names.

## Acceptance Criteria

- **AC1.** `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p tsconfig.json` reports **zero**
  errors in `test/web/credential-store.test.ts`. Report the full command output.
  Errors in `test/web/start-app.test.ts` and `web/src/main.ts` may still be present — a
  concurrent task owns those files and you must **neither fix nor touch them**. Report them
  verbatim if you see them, attributing nothing.
- **AC2.** `PATH="$HOME/.bun/bin:$PATH" bun test test/web/credential-store.test.ts` → exit 0,
  **51 pass / 0 fail**, the same count as before your change.
- **AC3.** The four discarded message strings survive as comments; quote the before and after
  of each of the four assertions in your report.
- **AC4.** Prove the anti-drift assertions still bite after your edit, and do it by mutation
  rather than by reading: temporarily rewrite `adoptCredentialFromPastedText` in
  `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts` so that it parses
  with `URLSearchParams` and calls `store.setCredential` directly instead of delegating to
  `adoptCredentialFromFragment`; run the file's tests and observe the delegation test **fail**;
  then restore the file and confirm its SHA-256 is exactly
  `e8e8b44fe05f0915f15086048e04309062a4d5c66862b6cdd92a2170df5ca20a`
  and that the tests are back to 51 pass / 0 fail. Report both hashes and both test results.
  **The restore is mandatory** — leaving the mutation in place would defeat the milestone.
- **AC5.** No file other than `test/web/credential-store.test.ts` differs when you are done.
  `web/src/credential-store.ts` must be bit-identical to its starting state (AC4's hash).

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/test/web/credential-store.test.ts`

`web/src/credential-store.ts` may be **temporarily** mutated for AC4 and **must** be restored
to the hash above. Nothing else may be touched — in particular not `web/src/main.ts`,
`test/web/start-app.test.ts`, `package.json`, or `.harness/architecture.md`, all of which
concurrent tasks own.

## Tests

```
cd /Users/ryankenny/Projects/phoneToLocalModel
PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p tsconfig.json
PATH="$HOME/.bun/bin:$PATH" bun test test/web/credential-store.test.ts
PATH="$HOME/.bun/bin:$PATH" shasum -a 256 web/src/credential-store.ts
```

## Report back

The commands and exit statuses; the tsc output in full; the 51/0 count before and after; the
four before/after assertion pairs; the mutation result and both SHA-256 values proving the
source file was restored.
