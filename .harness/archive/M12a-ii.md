## M12a-ii — The installed home-screen app can be paired

Status: DONE

### Outcome

**Found by the human on the device on 2026-09-01, and it blocks more than it looks like.**
Loading from the QR works in Safari; the installed home-screen app reports
`Pairing needed (unauthorized)` and cannot be paired by any route available today.

Two mechanisms compound, either sufficient on its own:

1. **iOS gives an installed home-screen app its own storage container**, separate from Safari's.
   The token the QR scan wrote to `localStorage` in Safari is invisible to the standalone app, so
   `credentialStore.getCredential()` returns null, the client sends no bearer token, and the
   harness answers `401`.
2. **`start_url` is `/app/`, carrying no fragment** (`web/public/app.webmanifest:5`). iOS launches
   the app there, so `location.hash` is empty and `adoptCredentialFromFragment` returns null
   without touching storage.

The iPhone camera opens scanned URLs in Safari — the wrong container — and a standalone PWA has
no address bar in which to enter a `#t=` URL. **FR1's pairing flow assumed one shared origin
storage, and iOS does not provide it.** That assumption is the actual defect; the 401 is a
symptom.

**Agreed approach — an in-app pairing screen.** Settled with the human on 2026-09-01, over
dropping `start_url` (which depends on unverifiable iOS behaviour and would leave the token
sitting in the home-screen bookmark URL) and over in-app QR scanning (which would need a
third-party QR decoder in the shipped bundle, contradicting the architecture's settled mitigation
for holding the token in `localStorage` — do not revisit this without the human).

**Every criterion here is derived.** This closes a gap in FR1/FR2 that no existing AC covers for
the installed app. It **runs before M12b and M13**, because M12's criterion 6 and the whole of
M14 are unattestable until it lands.

**Split note.** This entry is the phone end of the original `M12a`, which carried 8 acceptance
criteria and exceeded the milestone size budget. The Mac end — emitting the pairing URL as text
so the human has something to paste — is `M12a-i`, which runs first. All 8 original criteria are
conserved across the two parts, unchanged in wording.

### Architecture

C10, C12. Adding an unpaired state to the app shell is new user-facing
surface; record whether it warrants a `## Deviations` entry rather than assuming it does not.

**Realised: C5, C10, C12.** C5 (Credential Store) gained `adoptCredentialFromPastedText`,
delegating to `adoptCredentialFromFragment`. C10 (UI) gained `ui/pairing-target.ts`, a second
DOM-touching module. C12 (app entry) gained `startApp`, which owns the
unpaired → paired → unauthorized → unpaired state machine and replaced `bootstrap(root)` in the
browser entry guard. **Two `Material: no` deviations recorded** in `.harness/architecture.md`
under `## Deviations` (task T5) — one for C5's responsibility line being narrower than the code,
one for C10 now having two DOM-touching modules. No component boundary moved, no technology
choice changed, no responsibility changed owner, and no new edge was introduced.

**Corrected in review cycle 1** (cycle-1 OPTIONAL 5). This paragraph previously justified
"no new edge" by claiming the agreed edge `C10 --> C5` ("pairing state") already covered the
UI reaching the credential store. The conclusion holds but that citation was wrong, and the
same wrong citation was in `architecture.md`'s deviation entry; both are now corrected.
`ui/pairing-target.ts` is deliberately credential-free — it has no imports at all and takes an
`onSubmit` callback (`web/src/ui/pairing-target.ts:9-11`), so it never reaches C5 and adds no
C10 edge. The component that reaches C5 is **C12** (`web/src/main.ts`), and that C12 -> C5
wiring was already recorded in the M11 deviation entry.

### As-Built

`.harness/as-built/M12a-ii.md` — RECORDED. 4 of 8 files attributed (the four unmapped are test
and proof files, not app components); components C5, C10, C12 and 2 edges observed; **no claim
mismatches**. All four load-bearing claims held: C5 delegates the pasted-text case to its
existing fragment parser rather than reimplementing it; `ui/pairing-target.ts` has no imports and
never reaches C5; C12 gained `startApp` with the stated state machine and the entry guard now
calls it instead of `bootstrap(root)`; and **no new C10 -> C5 edge exists** — C10's dependency on
C5 remains injected at mount time, and only C12 calls credential adoption directly. Edges observed
were C12 -> C5 and C12 -> C10.

### Acceptance Criteria
- [x] (derived: FR1, FR2) Launched with no stored credential, the app renders a pairing view with
      an input for a pairing URL or bare token, instead of a conversation UI whose every action
      would `401`. The assertion must fail if the pairing view is removed.
- [x] (derived: FR1) Pasting a full pairing URL (`https://<host>/app/#t=<token>`) stores the token
      and that origin; pasting a bare token stores it against the current origin. Both leave the
      app paired in its own storage container.
- [x] (derived: FR1, FR2) After pairing, the app proceeds to the normal conversation UI without a
      reload, and stays paired across a relaunch — proven by remounting against the same storage.
- [x] (derived: FR1) The token never reaches the URL, the document title, or any element that
      would carry it into a bookmark or the app switcher, and the pairing input does not retain it
      after a successful pair.
- [x] (derived: FR9) A token the harness rejects surfaces the `unauthorized` guidance and returns
      to the pairing view rather than a dead end the user cannot leave.
- [x] (derived: FR1, FR2, live) Pairing with a real token read from `~/.openweight-harness/token`
      yields a working authenticated client against the live harness, proven at a Mac-run entry
      point rather than asserted from client state.
- [x] **Human-attested on the physical iPhone (`iphone-15-pro`).** In the *installed home-screen*
      app, pairing by pasting succeeds, a prompt then streams, and the app is still paired after
      force-quitting and relaunching. **Not agent-provable** — no agent may check this box.

### Baseline

`052db73fb28be6aff2699a57b5bdf2678d286fe9` on `main` (2026-09-01), recorded before any
task ran.

**Most files this milestone touches were untracked at baseline**, so a plain
`git diff 052db73` does not isolate the delta — the same caveat `M12a-i` recorded.

**Corrected in review cycle 1** (cycle-1 OPTIONAL 4). The previous version of this block
listed only two modified pre-existing files, omitted `web/src/ui/dom-target.ts` entirely,
and annotated `credential-store.ts` with a line count that contradicted the hash beside it.
It also called every hash below "pre-implementation" when one of them was not. **Three**
pre-existing files were modified, and each hash is now labelled with the point in the
milestone it was taken at:

| File | SHA-256 | Taken at | Lines |
| --- | --- | --- | --- |
| `web/src/credential-store.ts` | `e8e8b44fe05f0915f15086048e04309062a4d5c66862b6cdd92a2170df5ca20a` | **post-T1** | 163 |
| `web/src/main.ts` | `11fd2382346febbad27f32fe2be352b28f950091759afbaa1a89499aec12a8a1` | pre-implementation | 127 |
| `web/src/ui/dom-target.ts` | `1e68d55700243567145fb2285579b0c618484d9bed58c64cb0b96eaa68c898b1` | **post-T2** | 319 |

Notes, so the table is not read as claiming more than it proves:

- `credential-store.ts`'s recorded hash is **post-T1, not pre-implementation** — the
  original record said so in a parenthetical but then described the whole list as
  pre-implementation hashes. Its pre-T1 content is recoverable from the T1 diff. Its line
  count at the recorded hash is **163**, not the 120 previously written here; 120 was the
  pre-T1 count and did not match the hash it was printed beside.
- `web/src/ui/dom-target.ts` was modified by **T2** and was missing from this list. T2's
  packet allowed it explicitly and narrowly — `Files Allowed To Change` reads
  "`web/src/ui/dom-target.ts` — **comment only**, no code change" — and the change is the
  rewritten header comment now at lines 1-7 ("One of the two modules in `web/src/`
  permitted to touch the DOM"). **The hash above is post-T2**: this file was untracked at
  baseline, so its pre-T2 content is not recoverable from git and no pre-T2 hash can be
  stated honestly. That the change was comment-only is what T2's packet *permitted*; it is
  not independently verified here, and a reviewer wanting that guarantee should read the
  file rather than trust this line.
- `web/src/main.ts` was further modified in review cycle 1 by correction task C3. Its hash
  on the settled post-cycle-1 tree is
  `88b1c28e959acf98b87dd4fdba0349a73ab3f4ed9dda99424a44eda9c8863e5f`.

`web/src/ui/pairing-target.ts`, `test/web/ui/pairing-target.test.ts`,
`test/web/start-app.test.ts` and `src/host/m12a-proof.ts` are new in this milestone.

**Baseline suite, confirmed by this orchestrator rather than taken on trust:**
`bun test` → exit 0, **793 pass / 0 fail** across 30 files.

### Evidence

**All six agent-provable criteria are now met and independently verified. Criterion 7 is a
human attestation on the physical iPhone and is deliberately left unchecked — no agent may
check it.** This entry covers two implementation phases: T0-T2 ran in the first, T3-T6 in this
continuation.

| Task | Tier | Reason above Cheap | Outcome |
| --- | --- | --- | --- |
| T0 — archive `M11` out of the state file | Cheap | — | attempt 1, PASS (self-evidencing; arithmetic reconciled) |
| T1 — `adoptCredentialFromPastedText` | Cheap | — | attempt 1, **PASS — independently verified**; later found to have broken `tsc` (see T6) |
| T2 — the pairing view (`ui/pairing-target.ts`) | **Mid** | not low risk | attempt 1, **PASS — independently verified** |
| T3 — `startApp` state machine + entry point | **Top** | architectural | attempt 4, **PASS — independently verified** |
| T4 — `proof:m12a` live pairing proof | **Mid** | not easily verified | attempt 3, **PASS — independently verified** |
| T5 — record the architecture deviations | Cheap | — | attempt 1, PASS after one orchestrator-directed correction |
| T6 — restore `tsc --noEmit` to clean | Cheap | — | attempt 1, **PASS — independently verified** |

Task packets: `.harness/tasks/M12a-ii-T0.md` … `-T6.md`.

**Routing outcome, recorded so a human can judge whether the tiering was sound.** Five of
seven tasks ran at Cheap and all five passed at attempt 1 — including T6, a correction of a
type-level defect, which is exactly the mechanical shape the Cheap default exists for. The two
tasks routed above Cheap in this phase both passed at their entry rung, so **no task in this
milestone ever needed the ladder** — which is weak evidence that T3's Top routing and T4's Mid
routing may both have been one rung high. T3's Top is still defensible on its stated reason
(it owns the app's entry contract, and the cheapest detector for getting it wrong is a human
holding an iPhone). T4's Mid is the more questionable call: it followed an established
`proof:m*` pattern with a fixed packet, and a Cheap attempt would have cost little to try.
**Recorded as a routing observation for future milestones, not as a defect.**

#### T3 — `startApp`, the unpaired/paired/unauthorized state machine (Top)

`web/src/main.ts` gained `startApp`, plus one optional `onUnauthorized` field on
`BootstrapDeps`. `bootstrap()` kept its name, signature and behaviour, which is why **no
existing test needed to change** — the design constraint the packet fixed for exactly that
reason. 14 tests added in `test/web/start-app.test.ts` (819 → 833).

`AppHandle.paired`/`.mount` are **getters over closure variables**, not snapshots, so the
asynchronous unauthorized transition is observable after `startApp` has already returned.
`enterPaired`/`enterUnpaired` null the field of the view being left before constructing the
one being entered, which is the no-double-mount trap the packet called out.

**Independently verified and ACCEPTED.** A `harness:verifier` re-ran the focused file
(exit 0, **14 pass / 0 fail**, 85 `expect()` calls) and the full suite (exit 0, **833 pass /
0 fail**, 32 files), confirmed both changed files are inside `Files Allowed To Change`, and
reported `Tests Weakened: NO`. It named a real test with a line number against each of
AC1-AC10.

**Two findings that mattered, neither taken on the worker's word:**

- **It redid the AC1 mutation itself.** It hashed `main.ts`
  (`24743340e2cf3763f5867769da1808dd0033bcf5961b2001adca6668dc3b8bbe`), replaced the pairing
  branch with an unconditional `enterPaired()` — i.e. deleted the pairing view — observed AC1
  **fail**, then restored and confirmed the hash matched byte-for-byte. Criterion 1's "the
  assertion must fail if the pairing view is removed" is therefore proven, not asserted.
- **AC3 and AC5 do not merely check the final DOM.** Both views call `root.replaceChildren`,
  so a final-DOM assertion cannot distinguish "never shown" from "shown then replaced" — the
  exact shape of a vacuous pass. The verifier confirmed both tests instrument
  `root.replaceChildren` via a `recordPaintedTestIds()` helper and assert the `pairing` testid
  was **never painted at all**. This is what makes criterion 3's Safari-path non-regression
  real.

AC6 reads the cleared credential back through a **fresh** store over the same storage, not the
same object. AC8 confirms a non-`unauthorized` rejection leaves the app paired and routes to
the existing notice region, matching on `error.guidance.code` and never on a message string —
that is the assertion stopping the new branch from swallowing every error.

**Deviation in form from the packet, judged sound.** The packet said to add `startApp` and
`AppHandle` to `main.ts`'s existing `export { ... }` block; they are instead declared with
inline `export`, because listing an identifier that is already exported at its declaration is
a duplicate-export error. The verifier confirmed both survive tree-shaking into
`web/dist/main.js`, and that the bundle still contains no `happy-dom`.

#### T4 — `proof:m12a`, the live pairing proof (Mid)

New `src/host/m12a-proof.ts` plus exactly one added line in `package.json`. It reads the real
token via `readToken()`, builds the pairing URL via `pairingUrlWithToken()`, pairs through
`adoptCredentialFromPastedText` in **both** the pasted-URL form (with a deliberately wrong
`currentOrigin`, proving the pasted URL's own origin wins) and the bare-token form, then makes
a real unmocked `listProfiles()` call against the live harness.

**Observed live against `https://ryans-mac-studio.tailc3648a.ts.net`:** exit 0, three real
profiles returned (`reasoning-baseline`, `reasoning-capable`, `reasoning-deep`).

**Independently verified and ACCEPTED**, with the two checks that decide whether this proof is
worth anything:

- **The token-leak guard was shown to bite.** A clean "no leak found" is exactly the vacuous
  shape, so the verifier injected a deliberate `console.log` of the real token, ran the script,
  and confirmed it **failed loudly and exited non-zero**; it then restored the file and
  confirmed the SHA-256 matched. The guard is a real detector.
- **Step 6 fails closed.** The corrupted-token request was observed returning
  `status=401 code=unauthorized` from the live harness — not assumed — and the script treats a
  *success* there as FAIL. Without this, the proof could not distinguish a working credential
  from a harness that ignores credentials entirely.

The verifier also scanned the captured output with its own checker, reading the real token
independently, for every 8-character window of the token and of `encodeURIComponent(token)`:
no leak. `package.json` gained exactly one line with every other script byte-for-byte
unchanged.

#### T6 — the type-check regression T1 introduced, found by T4 (Cheap)

**This was not planned work. T4 surfaced it, and it had already survived a worker and a
verifier.** `bunx tsc --noEmit` reported four `TS2554: Expected 1 arguments, but got 2` errors
in `test/web/credential-store.test.ts`, all inside T1's anti-drift structural test:

```
expect(functionStart).toBeGreaterThan(-1, "…message…");
expect(functionBody).toContain("adoptCredentialFromFragment", "…message…");
```

Bun's matchers take exactly one argument and **silently discard the trailing string at
runtime**, so `bun test` was green while `tsc` was red. `M5a` established that this repository
type-checks, so this was a real regression against a standing invariant. It survived T1's
review because the project's runner is `bun test`, and nothing in T1's validation ran `tsc`.

Fixed by removing the four discarded arguments and preserving each message as a `//` comment
above its assertion. No assertion, matcher, subject string or test name changed.

**Independently verified and ACCEPTED.** The verifier enumerated all **51** test names in the
file to confirm none was renamed, removed or weakened, re-ran the anti-drift mutation itself
(rewriting `adoptCredentialFromPastedText` to parse with `URLSearchParams` and call
`store.setCredential` directly, observing **50 pass / 1 fail**), then restored
`web/src/credential-store.ts` and confirmed its SHA-256 is
`e8e8b44fe05f0915f15086048e04309062a4d5c66862b6cdd92a2170df5ca20a`. `Tests Weakened: NO`.

#### T5 — the architecture deviations (Cheap, one correction)

Two `Material: no` entries appended to `## Deviations` in `.harness/architecture.md`.

The worker's own `diff` output looked wrong — it reported `418a419,444`, showing a bare
`Material: no` as the first appended line, which reads like a stray line attached to nothing.
**It was a `diff` anchoring artefact, not a defect:** the appended block and the existing tail
share a `Material: no` line, so `diff` anchored the insertion one line early. The orchestrator
settled it by hashing the first 418 lines of the worker's own backup against the live file —
`92f03dfac1cb702545a5cb523ea8099adef3c8f0e823139e70eac123f2afb1aa` on both — proving the
prefix is byte-identical and the change is a genuine pure append.

**One real defect was found and sent back.** The entry cited the agreed diagram edge as
`C10 ⇢ C5`, but the diagram at line 56 reads `C10 -->|"pairing state"| C5` — a citation that
misquotes the artifact it cites, and the same class of cosmetic defect a review had already
flagged on the `M12a-i` entry. Corrected to `C10 --> C5` and re-checked: prefix hash unchanged,
`## Status` still `AGREED`, all new lines within 95 columns.

### Validation

| Command | Result |
| --- | --- |
| `bun test` (baseline, before any task) | exit 0 — **793 pass / 0 fail**, 30 files |
| `bun test` (after T0, T1, T2) | exit 0 — **819 pass / 0 fail**, 31 files |
| `bun test` (after T3-T6, run by this orchestrator) | exit 0 — **833 pass / 0 fail**, 6136 `expect()` calls, 32 files |
| `bunx tsc --noEmit -p tsconfig.json` (after T6) | **exit 0 — zero errors** |
| `bun run proof:m12a` (live harness, T4) | exit 0 — 3 profiles returned; corrupted token rejected `401 unauthorized` |
| `bun test` (**after review cycle 1**, run by this orchestrator) | exit 0 — **837 pass / 0 fail**, 6161 `expect()` calls, 32 files |
| `bunx tsc --noEmit -p tsconfig.json` (after cycle 1) | **exit 0** |
| `bun run build` (after cycle 1) | **exit 0** |
| `bun run proof:m12a` (live harness, after cycle 1) | **exit 0** — all 6 criteria PASS, token-leak guard clean |

+40 tests over the milestone (793 → 833), no regressions. The final `bun test` and `tsc` runs
above were executed by this orchestrator against the settled tree, **after** every worker and
verifier had finished, so they are not a mid-flight reading.

Source files confirmed at their verified hashes on the settled tree:
`web/src/credential-store.ts` = `e8e8b44f…`, `web/src/main.ts` = `24743340…`. This matters
because two independent mutation checks (T6's and T3's verifier's) temporarily rewrote those
files; both restores are confirmed by hash rather than by the mutating agent's say-so.

**A cross-task sighting worth recording.** T3's worker independently noticed that
`web/src/credential-store.ts` had been rewritten mid-run, 19 seconds after its own last write,
with the delegation removed — and reported it verbatim without attributing it, exactly as
instructed. That was T6's AC4 mutation window, and it was restored. Concurrent tasks in a
shared tree make each other's mutation checks visible; the discipline of reporting rather than
guessing is what kept it from being mis-diagnosed.

Criteria 1-5 are met by T1-T3, criterion 6 by T4. **Criterion 7 is a human attestation on
`iphone-15-pro` and is not checked** — see `### Follow-ups` for exactly what the human must do.

### Review

#### Cycle 1 — CHANGES REQUIRED, corrections applied

Report: `.harness/reviews/M12a-ii-cycle1.md`. Reviewer tier Top (`opus`), scope the whole
milestone. Verdict **CHANGES REQUIRED**: 1 IMPORTANT (criterion 2 graded FAIL) and
4 OPTIONALs. Criteria 1, 3, 4, 5 and 6 passed with detectors the reviewer re-ran and
confirmed bite; criterion 7 is PENDING-HUMAN and remains unchecked.

**Pre-correction snapshot:** `c8bfe6ee80519ee6c6b66c156fddca2643b1ed21`
**Post-correction snapshot:** `a20da78de9080dbd499dcc04ee6d7f54925d7f01`
**Correction diff:** `.harness/reviews/M12a-ii-cycle1.patch` — `git diff c8bfe6ee a20da78d`,
850 lines, 8 files, 700 insertions / 21 deletions.

Both snapshots are `git commit-tree` objects capturing tracked and untracked work alike —
necessary because most of this milestone's files were untracked at baseline, so no diff
against a ref isolates the corrections. They are unreachable from any branch and will not
survive `git gc --prune=now`; the patch file is the durable artefact.

*One honest gap, stated so the next reviewer does not have to find it.* The post-correction
snapshot necessarily precedes the writing of its own SHA into this paragraph, so the patch
shows `.harness/milestones.md` as of just before these four lines were finalised. Everything
else in this cycle is inside the patch. An intermediate snapshot,
`0a55d78e5ac68cc751ef269c623e96ef39e4fe69`, captures the tree after the three code
corrections but before the two record corrections, and is what the C3 verification below
diffs against.

**All 5 findings resolved.** Correction tasks, tier, reason above Cheap, and outcome:

| Finding | Task | Tier | Reason above Cheap | Outcome |
| --- | --- | --- | --- | --- |
| IMPORTANT 1 — criterion 2's bare-token half undefended | C1 | Cheap | — | attempt 1, **PASS — independently verified** |
| OPTIONAL 1 — bundle entry path untested | C2 | Cheap | — | attempt 1, **PASS — independently verified** |
| OPTIONAL 2 — a `bootstrap()` throw leaves a blank app | C3 | **Mid** | not low risk | attempt 3, **PASS — independently verified** |
| OPTIONAL 4 — `### Baseline` incomplete/inconsistent | — | orchestrator record correction | — | applied |
| OPTIONAL 5 — misquoted `C10 --> C5` citation | — | orchestrator record correction | — | applied |

Packets: `.harness/tasks/M12a-ii-C1.md`, `-C2.md`, `-C3.md`.

**C1 — the IMPORTANT.** Added one test to `test/web/start-app.test.ts` pairing with the bare
token `"tok-bare-1234"` through `startApp`, asserting the stored credential equals
`{ baseUrl: ORIGIN, token: "tok-bare-1234" }` — the whole object, so `baseUrl` is genuinely
checked. **This orchestrator re-ran the reviewer's mutation itself**: replacing
`location.origin` in `onSubmit` with `"https://WRONG.example"` produced `14 pass / 1 fail`,
failing on exactly the new test with `"baseUrl": "https://WRONG.example"` against
`"https://mac.example.test"`. That *only* the new test fails confirms it was the sole missing
detector, which was precisely the finding. `web/src/main.ts` was then restored and confirmed
byte-identical by SHA-256 (`24743340…`).

**C2 — the bundle entry path.** Added a test to `test/web/bundle-fragment.test.ts` importing
the **built** `web/dist/main.js` and calling its exported `startApp` with a happy-dom root,
asserting `[data-testid=pairing-input]`, `[data-testid=pairing-submit]` and the heading text
render. Detector re-run by this orchestrator: deleting `section.appendChild(input)` from
`pairing-target.ts` gave `4 pass / 1 fail` on exactly the new test; the file was restored and
confirmed at `e58f0e71…`. `happy-dom` appears **0** times in both `web/dist/main.js` and
`web/dist/sw.js`, so the bundle-purity invariant is intact.

**C3 — the blank-app hazard (Mid).** `enterPaired()` released the pairing view before calling
`bootstrap()`, so a synchronous throw left the root empty with no view and no control — and
because the credential had already been persisted, a relaunch re-entered the same throw,
permanently. On a home-screen app with no address bar that is unrecoverable. `enterPaired()`
now returns `PairingSubmitResult`, and on catch clears the credential, falls back to
`enterUnpaired(message)` and reports failure; `onSubmit` forwards that result instead of
unconditionally returning `{ ok: true }`. The initial pre-seeded-credential branch gets the
same protection because it is the same function. `bootstrap()`'s name, signature and behaviour
are unchanged and `BootstrapDeps` gained no field — the tests inject a throwing `createTarget`
through the **existing** dep, so no test-only seam was added to production code.

**Why C3's verification is more than a green suite.** This orchestrator reverted *only*
`web/src/main.ts` to its pre-C3 content and re-ran the focused file: exactly the 2 new tests
failed with the throw escaping, and all 15 pre-existing tests still passed. The reverted file
hashed to `24743340…`, the exact pre-C3 hash — which proves C3's only change to `main.ts` is
the guard, and that the guard is the thing the new tests detect. The `start-app.test.ts` diff
is **63 insertions, 0 deletions**, so no existing test was touched.

**Verification was performed by this orchestrator rather than by a `harness:verifier`, and
that is a deviation worth recording.** A verifier was invoked for C1 and reported that it
could not perform the mutation step at all: its sandbox blocked file edits. It also reported
`831 pass / 3 fail` where the worker claimed `834 / 0`. **That discrepancy was investigated
and is not a regression** — the 3 failures are in `test/host/pair.test.ts`, which writes to
`/tmp`, calls `chmodSync`, and spawns subprocesses via `execSync`/`spawnSync`: exactly the
operations its sandbox was refusing. `pair.test.ts` passes 20/20 in isolation, and the full
suite ran **834/0 on three consecutive runs** for this orchestrator. Since the mutation
re-runs are the only part of this verification worth having, they were performed directly.
**Follow-up recorded below:** the verifier subagent cannot mutate files in this environment,
which silently degrades it from an independent checker to a test-runner.

#### Files the corrections changed

Source and test:

- `web/src/main.ts` — C3 only. SHA-256 now
  `88b1c28e959acf98b87dd4fdba0349a73ab3f4ed9dda99424a44eda9c8863e5f` (was `24743340…`).
- `test/web/start-app.test.ts` — C1 (+25) and C3 (+63). 88 insertions, 0 deletions.
- `test/web/bundle-fragment.test.ts` — C2 only. 45 insertions, 0 deletions.

Harness record (the two record-correction findings, plus this cycle's own bookkeeping):

- `.harness/milestones.md` — `### Architecture`, `### Baseline`, `### Validation`,
  `### Review`, `### Review Cycles`, `### Follow-ups`.
- `.harness/architecture.md` — **`## Deviations` only.** `## Status` is still `AGREED`.
- `.harness/tasks/M12a-ii-C1.md`, `-C2.md`, `-C3.md` — new correction packets.

**Did any correction touch a file no cycle-1 finding named? One, and only one.** Every code
file changed was named by a finding: `web/src/main.ts` by IMPORTANT 1's and OPTIONAL 2's
evidence, `test/web/start-app.test.ts` by IMPORTANT 1's suggested correction,
`test/web/bundle-fragment.test.ts` by OPTIONAL 1's, and both harness records by OPTIONAL 4's
and OPTIONAL 5's. The exception is **the `### Architecture` paragraph of this milestone entry
in `.harness/milestones.md`**: OPTIONAL 5 named only `architecture.md`, but the identical
misquoted `C10 --> C5` citation was also present here, and correcting one while leaving the
other would have left the record self-contradicting. **That edit is record-only and touches
no code.** No production or test file outside the findings' named set was modified.

`web/dist/**` is build output, regenerated by `bun run build`; it is not hand-edited and is
git-ignored.

**Cycle 2 — verdict PASS. Reviewer tier: Top (`opus`). Scope: the correction patch
(`.harness/reviews/M12a-ii-cycle1.patch`), with every criterion re-graded.** The narrow scope
held: the reviewer confirmed no *code* file in the patch went unnamed by a cycle-1 finding, and
judged the one disclosed out-of-findings edit — the same misquoted `C10 --> C5` citation in this
entry's own `### Architecture` paragraph — record-only and accurate, so no widening was owed.

Per-criterion result: criteria 1, 2, 3, 4, 5 and 6 **PASS**; criterion 7 **PENDING-HUMAN**.
Criterion 2, which cycle 1 graded FAIL, is genuinely closed. No BLOCKER or IMPORTANT findings.
One OPTIONAL, recorded under Follow-ups.

It re-ran validation itself rather than crediting the record: `bun test` 837/0 (6161 expects, 32
files), `bunx tsc --noEmit` 0, `bun run build` 0, `proof:m12a` exit 0 live against
`https://ryans-mac-studio.tailc3648a.ts.net` — 3 real profiles, corrupted token rejected `401
unauthorized`, leak guard clean. No phantom `test/host/pair.test.ts` failures in its environment.

It generated its own mutation evidence for every claim rather than accepting the fix cycle's.
Mutating `web/src/main.ts:250`'s `location.origin` to a wrong-origin literal gave **836 pass /
1 fail**, failing on exactly the new `AC4` test and nothing else — the IMPORTANT's detector both
bites and is precisely targeted. For the `enterPaired()` guard it wrote its own scratch tests
going beyond the two shipped ones: after an injected `bootstrap()` throw it asserted the visible
root holds one actionable pairing section with an empty input and a cleared credential, then
paired again through a real click on `[data-testid=pairing-submit]` and reached
`[data-testid=prompt-input]`. Reverting only the guard turned exactly the two new tests red with
all 15 pre-existing `start-app` tests green. For the bundle test it commented out
`root.replaceChildren(section)` in `pairing-target.ts` and saw 4 pass / 1 fail on the new test.
All four cycle-1 detectors were re-run and still bite; every mutated file was restored and
confirmed by hash (`main.ts` `88b1c28e…`, `pairing-target.ts` `e58f0e71…`, `credential-store.ts`
`e8e8b44f…`, `dom-target.ts` `1e68d557…`).

Architecture: no undeclared drift. The patch moves no boundary, adds no dependency and changes no
ownership; the only `architecture.md` edit is inside `## Deviations`, `## Status` is still
`AGREED`, and the corrected paragraph now cites the real edge (C12 → C5, already recorded under
the M11 deviation entry) rather than one the code does not use. `pairing-target.ts` has zero
`import` statements, which is what makes "deliberately credential-free, callback-only" exactly
right.

**The review cap is now spent.** Two cycles are recorded and cycle 2 passed with nothing open, so
there is nothing to route and no third review is permitted.

### Human Attestation Required

Six of seven criteria are met, independently reviewed at Top tier across two cycles, and checked.
**Criterion 7 is a human attestation on `iphone-15-pro` that no agent may perform or check** —
which is why this milestone is `BLOCKED` rather than `DONE`. Nothing is wrong with it; it is
waiting on a person holding the phone.

**What to do** — the detailed steps are the first bullet under `### Follow-ups`, in short: on the
Mac run `bun run pair --show-url`, get the printed URL onto the iPhone, and in the **installed
home-screen app** (not Safari) paste it into the pairing screen and tap **Pair**. Expected: the
conversation UI appears with no reload, a prompt then streams, and the app is still paired after
a force-quit and relaunch. Delete the AirDropped URL afterwards — it carries the token in plain
text.

Once attested, check criterion 7's box and set `Status: DONE`; `harness:as-built` should then be
run for this milestone in RECORD mode. **This also unblocks `M12`**, whose criterion 6 was
unattestable precisely because the installed app could not be paired at all.

### Human Attestation — RECORDED

**Attested by the human on `iphone-15-pro` on 2026-09-02, in the installed home-screen app.**
Three observations, each reported separately as it was made:

- **Cancel works.** Conversation `30ed78db-5745-41fe-a35f-b995501ee72f`: a prompt was sent and
  cancelled; the app showed `Cancelled` and the transcript recorded `assistant: (cancelled)`
  rather than presenting the partial output as a finished answer.
- **Pairing survives a force-quit.** Swiped out of the app switcher and relaunched, the app
  returned to the conversation UI rather than the pairing screen.
- **A generation streams and reports telemetry.** Conversation
  `7ac21b7e-f3dc-44a0-8a21-a7177a37847d` on `Fast reasoning`: output rendered incrementally and
  ended with `Complete — 100.0450202591166 tok/s, 70 tokens evaluated, quantization Q4_K_M,
  context limit 131072`. All three profiles were listed and selectable.

Screenshots of both conversations were supplied. This attestation covers **M12 criterion 6** and
**M12a-ii criterion 7** — the same device session satisfied both, which is why they are recorded
identically in each entry.

### Review Cycles
2

### Follow-ups

- **OPTIONAL, raised by the cycle-2 review and left open deliberately — the browser entry
  guard's call site is unasserted.** `test/web/bundle-fragment.test.ts:212` proves the built
  bundle *exports* a working `startApp`, but nothing proves the `typeof document !== "undefined"`
  guard at `web/src/main.ts:287-293` actually calls it: that file asserts
  `typeof document === "undefined"` in-process, so the guard cannot execute there. Changing
  `startApp(root)` back to `bootstrap(root)`, or dropping it, would leave the whole suite green
  while returning the installed home-screen app to the 401 dead end this milestone exists to
  remove. **This is the M11 regression shape** — M11 lost a *call site* to tree-shaking while the
  exported symbol survived, which is why that file's static-assertion block exists. The reviewer
  confirmed by hand that both the guard and the literal `startApp(root)` are present in
  `web/dist/main.js` today, and rated the residual risk low because the guard is a top-level side
  effect rather than a tree-shakeable reference. Suggested fix, in the register of the
  neighbouring `/adoptCredentialFromFragment\s*\(\s*credentialStore/` match: add
  `expect(bundleText).toMatch(/if\s*\(root\)\s*\{?\s*startApp\(root\)/)` to that same
  static-assertion block, with the existing comment noting minification would invalidate it.

- **What the human must do for criterion 7, which no agent may check.** On the Mac, run
  `bun run pair --show-url` (the affordance `M12a-i` built and verified) and get the
  printed URL onto the iPhone — AirDrop, Messages to self, or Notes. Then, in the
  **installed home-screen app** (not Safari), paste it into the pairing screen and tap
  **Pair**. Expected: the conversation UI appears with no reload; a prompt then streams;
  and after force-quitting and relaunching, the app is still paired and shows no pairing
  screen. Criterion 7 is checked only on the human's recorded attestation.
- **The token is a secret in transit.** The `--show-url` output and anything the human
  AirDrops or messages to themselves carries the bearer token in plain text. That is the
  deliberate, explicitly opt-in trade `M12a-i` recorded against FR1. Worth deleting the
  message afterwards; not a defect.
- **RESOLVED (cycle-1 review). The `doc.title` leak check is proven to bite.** T2's worker
  had honestly reported that its injected mutation (setting the input's `value` attribute)
  did not exercise the `doc.title` assertion, leaving that one assertion unproven. **The
  cycle-1 reviewer ran the missing mutation**: it added `doc.title = trimmedValue;` to the
  click handler in `pairing-target.ts` and observed **both AC6 leak tests go red**. The
  assertion is a real detector. Closed — no further work.
- **Do not let the pairing view become a second source of truth for credential handling.**
  `adoptCredentialFromFragment` already parses `#t=`, validates, stores and clears. The pasted-URL
  path should reuse that parsing rather than reimplement it, or the two will drift.
- **Size note (recorded at split time).** This part carries 7 acceptance criteria, at the top of
  the acceptable band. One of them (the last) is a human attestation carrying no implementation,
  but the count is still worth watching: if the implementation phase finds it cannot be driven to
  a reviewable state within its budget, that is a planning finding to record, not a ceiling to
  bounce off.
- **Dangling cross-reference in M12, for a human to correct — not corrected here.** M12's
  `### Follow-ups` opens with `**DEFERRED TO M12a — the profile selector does not reflect a
  change (FR5).**`. That item is the profile-selector repaint defect, which is **M12b's**
  subject and is already covered in full by M12b's outcome and criteria; none of the original
  M12a's 8 criteria mention it. The reference appears to be a typo for `M12b`, and the 2026-09-01
  split of `M12a` into `M12a-i`/`M12a-ii` makes it doubly stale. It was left untouched
  deliberately: M12 is `BLOCKED` on a human attestation with its review cap spent, and editing
  its body is not this phase's business. **No work is lost** — M12b carries it.

- **`tsc` is not part of any routine validation, and that is how T1's regression survived a
  worker and a verifier.** The project's runner is `bun test`, which strips types without
  checking them, so a type error is invisible to every task whose `Tests` block lists only
  `bun test`. T6 fixed the four errors; it did **not** fix the gap. `M5a` established that
  this repository type-checks, so the invariant exists but nothing enforces it per-task.
  Worth either adding `bunx tsc --noEmit` to the `test` script or naming it in future task
  packets' `Tests` blocks. Recorded rather than fixed: changing the project's validation
  command is outside this milestone's criteria.
- **`startApp` has no guard against a stale `bootstrap`'s late `onUnauthorized`.** T3's worker
  flagged this rather than acting on it, correctly — it was outside the fixed design. A
  `listProfiles` rejection from a *previous* paired session could in principle unpair the
  current one. It cannot occur today because only one `listProfiles` is ever in flight, so
  this is a latent hazard rather than a live defect. If a later milestone adds a second
  concurrent call, this needs a per-generation token before it becomes reachable.
- **Routing observation: no task in this milestone ever needed the escalation ladder.** All
  seven passed at their entry rung. T4's Mid routing in particular looks one rung high in
  hindsight — see the routing note under `### Evidence`. Watch this across the next few
  milestones: consistent first-rung passes above Cheap are the signal that routing has drifted
  upward, and nothing else in this system reports it.

- **The `harness:verifier` subagent cannot edit files in this environment, and fails silently
  into a weaker role.** Invoked for correction task C1, it reported that its sandbox blocked
  every file-editing route (`sed`, Python writes, the edit tools) and so it could not perform
  the mutation step — which for a "prove the detector bites" task is the entire job. It
  returned a partial result rather than a failure. It also reported `831 pass / 3 fail`
  against `test/host/pair.test.ts` where the true figure is `834 / 0`, because that file
  writes to `/tmp`, calls `chmodSync` and spawns subprocesses — the same operations its
  sandbox refused. **Both symptoms are environmental, not defects in the code**, but together
  they mean a verifier's report in this project currently cannot be trusted for either
  mutation evidence or full-suite counts. Cycle-1 verification was therefore done directly by
  the orchestrator. Worth resolving before the next milestone: either grant the verifier write
  access in its sandbox, or stop routing mutation-proof work to it and record that the
  orchestrator owns that step. **This is a harness-configuration issue, not a project defect,
  so it was recorded rather than fixed here.**

- **`test/host/pair.test.ts` is environment-sensitive and will fail under a restricted
  sandbox.** It `mkdtempSync`es under `/tmp`, `writeFileSync`s a token fixture, `chmodSync`es
  it for a permissions test, mutates the process-global `process.env.OPENWEIGHT_HARNESS_TOKEN_FILE`,
  and shells out with `execSync`/`spawnSync`. That is legitimate for what it tests, but it
  means "the suite is green" is not a portable claim, and any agent running it without
  filesystem and subprocess permissions will report false failures. Worth a note in the test
  file itself so the next reader does not chase a phantom regression. Not this milestone's
  business to change.


