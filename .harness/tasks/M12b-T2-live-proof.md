# Task M12b-T2 — Live proof: a changed profile is the profile the harness generates with

Tier: **Cheap**. Reason to go above: none. This is a proof script modelled directly
on two existing ones in the same directory, the oracle is named below, the blast
radius is one new file plus one line of `package.json`, and it either exits 0 or it
does not.

Working directory: /Users/ryankenny/Projects/phoneToLocalModel (use absolute paths).
`bun` is NOT on PATH — run `export PATH="/Users/ryankenny/.bun/bin:$PATH"` first.

## Goal

Milestone M12b's fourth acceptance criterion, quoted verbatim:

> (FR5, live) Driven against the live harness, a conversation whose profile has been
> changed generates using the newly selected profile — proven at a Mac-run entry
> point, not asserted from client state alone.

Write `src/host/m12b-proof.ts` and wire it up as `bun run proof:m12b`.

The live harness is up and reachable right now: `resolveBaseUrl()` from
`src/host/config.ts` resolves it, `readToken()` reads the real token, and
`GET /v1/profiles` returns 3 profiles.

## Model it on the existing proofs

Read `src/host/m12-proof.ts` first — it already builds the whole real chain under
happy-dom (real `createMemoryStorage`, real `createConversationStore`, real
`createApiClient` over `globalThis.fetch` with the real token, real
`createSessionCoordinator`, real `createDomTarget`, real `mount`) and drives the UI
by dispatching DOM events. Follow that structure, its console-logging style, its
`waitForCondition` helper, and its `process.exit(1)` on failure.

## What the proof must do

1. Read `resolveBaseUrl()` and `readToken()` from `./config.ts`.
2. Build the real module chain under happy-dom exactly as `m12-proof.ts` does —
   but pass `createApiClient` a **wrapping `fetch`** that records, for every
   request, the URL, the method and the request body. Keep the wrapper transparent:
   delegate to `globalThis.fetch` and return its response untouched.
3. `await apiClient.listProfiles()`. **Require at least 2 profiles**; fail with a
   clear message if there are fewer. Choose **profile A** and **profile B** as two
   *distinct* profiles from that list at runtime — e.g. `profiles[0]` and
   `profiles[profiles.length - 1]`, after checking their ids differ.
   **Never write a literal profile id into this file** — see Notes.
4. `handle.setProfiles(profiles)`, then create a conversation on **profile A**
   through the DOM: set `profile-select`'s value to A's id, dispatch `change`,
   click `[data-testid="create-conversation"]`, and wait for
   `[data-testid="open-conversation"]` to appear.
5. Confirm out of the DOM that the conversation currently shows **profile A**
   selected (the selected `<option>`, and `(selected)` against A's label in the
   profiles `<ul>`).
6. **Change the profile to B through the DOM**: set `profile-select`'s value to
   B's id and dispatch a `change` event. Do **not** call `handle.render()` or any
   controller method yourself afterwards — the whole point of M12b is that the
   app repaints on its own. Wait (via `waitForCondition`) for the DOM to show B.
7. Assert from the DOM that the selected `<option>` is now B and that
   `(selected)` sits against B's label and NOT A's. Fail loudly if not.
8. Generate. Call
   `handle.actions.send(conversationId, prompt, handlers)` with an `onComplete`
   handler that captures the **raw `Telemetry` object**.
   `handle.actions` is the exact object the DOM send button invokes — this is the
   app's real send path over the real network. It is invoked programmatically here
   only because the rendered status line projects telemetry through
   `toTelemetryDisplay`, which drops `profile_id`; the DOM cannot show it.
   Use a short prompt (e.g. "Reply with one short sentence.").
9. **Assert the two server-boundary oracles**, and print both:
   - **(a) What crossed the wire.** From the recorded fetch calls, find the
     `POST` to `/v1/sessions/<id>/generate` and parse its body. Assert
     `body.profile_id === profileB.id` and `body.profile_id !== profileA.id`.
     This is the request the app actually sent, not client state.
   - **(b) What the harness reported.** From the captured `Telemetry`, assert
     `telemetry.profile_id === profileB.id` and `!== profileA.id`. This is the
     harness's own statement of which profile it generated with.
10. Print a final `M12B LIVE PROOF: PASS` or `M12B LIVE PROOF: FAIL` line and
    `process.exit(0)` / `process.exit(1)` accordingly. Track failures the way
    `m12-proof.ts` does (an `allPassed` flag plus a `failures` list) so every
    check runs and all failures are reported, rather than bailing on the first.

Do not print the token, and do not print any pairing URL.

## Also change

Add to `package.json`'s `scripts`, alongside the existing `proof:*` entries:
```
"proof:m12b": "bun run src/host/m12b-proof.ts",
```

## Files Allowed To Change

- `src/host/m12b-proof.ts` (new)
- `package.json`

Nothing else. In particular do **not** touch `web/src/ui/dom-target.ts` or
`test/web/ui/dom-target.test.ts` — another task owns those and its fix is already
in place. If step 6/7 fails, that is a real finding to report, not a file to edit.

## Acceptance Criteria

- AC1: `bun run proof:m12b` exits 0 against the live harness.
- AC2: The proof changes the profile through a DOM `change` event and confirms the
  repaint from the DOM without calling `render()` itself.
- AC3: The proof asserts the generate request body carried profile B's id.
- AC4: The proof asserts the harness-returned `Telemetry.profile_id` is profile
  B's id.
- AC5: No literal profile id appears in `src/host/m12b-proof.ts`.

## Tests

```
export PATH="/Users/ryankenny/.bun/bin:$PATH"
bun run proof:m12b ; echo "EXIT: $?"
bun test test/no-hardcoded-profile-ids.test.ts
```

Report both commands, their exit statuses, and the **full output** of the proof run.

**Do NOT run the full `bun test` suite** — the build tests delete and rebuild
`web/dist` and another task may be running.

Do not weaken, skip, delete or loosen any existing test.

## Notes

- `bun` is at `/Users/ryankenny/.bun/bin/bun`, not on PATH.
- **`test/no-hardcoded-profile-ids.test.ts` scans every `.ts` file under `src/`,
  `web/src/` and `scripts/` and fails if it finds any of the literal strings
  `reasoning-baseline`, `reasoning-capable`, `reasoning-deep`.** Your new file is
  under `src/`, so it is scanned. Resolve both profiles at runtime from
  `listProfiles()`. Do not put one in a comment either — the check is a plain
  substring match over the whole file.
- Generation against the live harness can be slow. Allow a generous timeout
  (60s or more) for the send to complete.

---

# ATTEMPT 2 — Previous Attempt block

**Attempt 1 (Cheap) FAILED.** It returned BLOCKED claiming two product defects.
Both diagnoses were wrong; both are bugs in the proof script itself. Do not
repeat them, and do not conclude the product is broken.

Attempt 1 also left the repository with ~38 TypeScript errors, all in
`src/host/m12b-proof.ts`. That is a regression against a standing invariant
(M5a: "the repository type-checks"). Your attempt is NOT complete until
`bunx tsc --noEmit -p tsconfig.json` exits 0.

## What attempt 1 got right — keep it

- The wrapping `fetch` is correctly transparent (records `init.body`, then
  returns `globalThis.fetch(input, init)` untouched). Keep that shape.
- It correctly proved the generate request body carried profile B's id.
- It contains no literal profile ids. Keep it that way.
- `package.json` already has the `proof:m12b` script. Leave it.

## Bug 1 — reading `select.value` instead of the selected `<option>`

Attempt 1 asserted at roughly line 237:
```ts
return select.value === profileB.id;
```
This is the bug. Under happy-dom, `select.value` does not reliably reflect an
`<option>` whose `.selected` was set **before** `replaceChildren()` attached it —
which is exactly what `dom-target.ts`'s `paint()` does.

The repaint provably works. `test/web/ui/dom-target.test.ts`'s "Test A" asserts
the same behaviour with real wiring and PASSES, and it was mutation-checked: it
fails when the repaint is removed. Read that test and copy its assertion style:

```ts
const selectedOption = Array.from(select.querySelectorAll("option"))
  .find((opt: any) => opt.selected);
// assert selectedOption.value === profileB.id
```

Attempt 1 also *reported* that `select.value` showed a third profile's id. Its
own console output never printed that value. Do not carry that claim forward.
**Print the real values** — every option's `value` and `.selected`, plus the
profiles-list `<li>` text — before asserting, so any failure is diagnosable.

## Bug 2 — matching the profiles list by id when it renders labels

Attempt 1 searched the profiles `<ul>` with
`li.textContent.includes(profileB.id)`. `paint()` renders `profile.label`
(e.g. "Deep reasoning"), never the id — so the match always failed, the
variable was `undefined`, and the check **silently passed without asserting
anything**.

Match on `profile.label`. And make a missing `<li>` a hard FAILURE, never a
silent skip. Every branch that cannot find what it is looking for must push a
failure, not fall through.

## Bug 3 — choosing a slow batch profile, causing the send to time out

Attempt 1 chose `profiles[0]` and `profiles[profiles.length - 1]`. The last
profile is a `latency_class: "batch"` model. The generation did not finish
inside 60s and the socket reset. That is a profile-choice problem, not a harness
or streaming defect — `src/host/m12-proof.ts` deliberately selects the
`interactive` profile for exactly this reason.

**Choose profile B (the one generated with) as the `interactive` profile**, and
profile A as any other distinct profile. Assert both exist and their ids differ;
fail clearly if the harness offers fewer than 2 profiles. Resolve both at
runtime from `listProfiles()` — never hardcode.

Raise the generation timeout to **at least 120s**.

## Restated requirement

The proof must still do everything the original packet above says, in order, and
must still assert BOTH server-boundary oracles: (a) the generate request body
carried profile B's id, and (b) the harness-returned `Telemetry.profile_id` is
profile B's id. Neither may be skipped or softened.

If, after fixing all three bugs, a check still genuinely fails, report it
precisely with the printed values — that is a real finding. But verify against
"Test A" first.

## Tests for attempt 2

```
export PATH="/Users/ryankenny/.bun/bin:$PATH"
bunx tsc --noEmit -p tsconfig.json ; echo "TSC EXIT: $?"
bun run proof:m12b ; echo "PROOF EXIT: $?"
bun test test/no-hardcoded-profile-ids.test.ts
```
All three must be clean: tsc exit 0, proof exit 0, profile-id test passing.
Report each command, its exit status, and the proof's FULL output.

Do NOT run the full `bun test` suite.
