## M12a-i — The Mac can hand the pairing URL to the phone

Status: DONE

### Outcome

**Split out of the original `M12a — The installed home-screen app can be paired` on
2026-09-01, which carried 8 acceptance criteria and so exceeded the milestone size budget.**
This part is the Mac end of the pairing handoff; `M12a-ii` is the phone end. All 8 original
criteria are conserved across the two parts, unchanged in wording — one here, seven in
`M12a-ii`. This part runs first, because the human cannot attest `M12a-ii`'s device criterion
without a way to get the pairing URL onto the phone.

The awkward step this exists to solve, recorded verbatim from the original entry:

> **Note the awkward step this creates, and solve it rather than assuming it away:** the human needs
> the pairing URL *on the phone* in order to paste it, and Safari cannot supply it, because
> `adoptCredentialFromFragment` calls `location.clearHash()` immediately on load — so by the time
> the address bar can be copied, the token is already gone from it. `src/host/pair.ts` currently
> only renders the QR (`console.log(output)` at line 39). FR1 requires the CLI not to print the
> token in plain text **by default**, so an emit-the-URL affordance must be explicitly opt-in.

The opt-in constraint is not a preference. FR1 requires the CLI not to print the token in plain
text by default, so the default output must remain exactly what it is today, and a test must
prove it.

### Architecture

C3 (Pairing CLI) realised, reading C1 (Host Config) via `readToken` / `resolveBaseUrl`. No new
component and no new boundary, as predicted.

**The milestone told me to confirm rather than assume whether a `## Deviations` entry was needed,
and the answer turned out to be yes.** Two written statements in `.harness/architecture.md` are now
narrower than the code: C3's responsibility line ("Print a scannable QR code carrying the pairing
URL") and the `C3 ⇢ C5 (out of band)` interface entry (the URL "crossing ... by camera"). The URL
may now also cross by the human copying text. This changes no boundary, technology choice or
ownership, so it is `Material: no` and was recorded without human agreement, following the
precedent of the existing `M3` and `M11` entries. Recorded as the first entry under
`## Deviations` in `.harness/architecture.md`. C3's component block and the Interfaces section
were deliberately left unedited — only the deviation log may be appended to without agreement.

### As-Built

`.harness/as-built/M12a-i.md` — RECORDED. 2 of 2 files attributed; components C1, C2, C3 and 2
edges observed. One claim mismatch: C3 reads C1 via **three** functions (`readToken`,
`resolveBaseUrl`, `pairingUrlWithToken`), where the `### Architecture` field above named only the
first two. An under-statement of an existing dependency, not an unrecorded boundary.

### Acceptance Criteria
- [x] (derived: FR1) `src/host/pair.ts` gains an **explicitly opt-in** way to emit the pairing URL
      as text for copying to the phone. Default behaviour is unchanged and still does not print
      the token in plain text, and a test proves the default does not.

### Baseline

`052db73fb28be6aff2699a57b5bdf2678d286fe9` on `main` (2026-09-01).

Both files this milestone touches were **untracked** at baseline, so a plain `git diff 052db73`
does not isolate this milestone's delta. Their pre-implementation SHA-256 hashes:

- `src/host/pair.ts` — `f507cd91161cba55be81e99390cd666a7acfa5ace71462f27fc4a5c2a21a8672` (53 lines)
- `test/host/pair.test.ts` — `62b9a342dd4705bf737f6a05ba50d30d48e5b03a38ce3a7d34af6eee2ba7cce2` (205 lines)

### Evidence

| Task | Tier | Outcome |
| --- | --- | --- |
| T1 — opt-in `--show-url` on the pairing CLI | Cheap | attempt 1, PASS |
| T2 — record the C3 deviation | Cheap | attempt 1, PASS |

Neither task needed the ladder. T1 was routed Cheap despite touching a bearer token because none
of the four gates failed: the packet fixed the flag spelling, the byte-for-byte default invariant
and every assertion, so nothing was left to worker judgement; the blast radius was two files; and
the failure mode (token reaching stdout by default) was already detected mechanically by seven
assertions that existed in `test/host/pair.test.ts` before this milestone and that the packet
forbade modifying. A strong pre-existing oracle is what made the cheap tier safe here.

Files changed:

- `src/host/pair.ts` — `renderPairing` gained an optional `showUrl?: boolean` (default `false`);
  new exported pure `parsePairArgs(argv: string[]): { showUrl: boolean }`; `main()` now parses
  `process.argv.slice(2)` and threads the result through. 53 → 71 lines.
- `test/host/pair.test.ts` — 10 tests added (10 → 20). The 10 pre-existing tests are byte-for-byte
  unmodified.
- `.harness/architecture.md` — one `Material: no` entry under `## Deviations` (T2).

Task packets: `.harness/tasks/M12a-i-T1.md`, `.harness/tasks/M12a-i-T2.md`.

### Validation

Baseline suite before any work: **783 pass / 0 fail** (`bun test`, exit 0), confirmed by this
orchestrator rather than taken on trust from the split note.

| Command | Result |
| --- | --- |
| `bun test test/host/pair.test.ts` | exit 0 — **20 pass / 0 fail** |
| `bun test` (full suite) | exit 0 — **793 pass / 0 fail** (+10, no regressions) |

**Independently verified.** A `harness:verifier` re-ran both commands, diffed both files against
their pre-change snapshots, and confirmed `Tests Weakened: NO` — specifically that the seven
assertions proving the default output leaks no token are present and unmodified. It reported no
discrepancies with the worker's claim.

**Proven end-to-end through the real CLI entry point**, not only through `renderPairing`. Both the
test suite and the verifier ran `src/host/pair.ts` as a subprocess against a fixture token file
(mode 0600) of 43 `A`s with a fixture base URL:

| Invocation | Exit | Observed |
| --- | --- | --- |
| `bun run pair` (default) | 0 | stdout contains **no** 8-char window of the token, no percent-encoded token, no pairing URL |
| `bun run pair --show-url` | 0 | stdout contains the exact pairing URL, preceded by a `WARNING:` line naming it as a secret |
| `bun run pair --bogus` | 1 | stderr names `--bogus`; neither stream contains the token |
| `bun run pair --show-urls` | 1 | near-miss spelling **rejected**, not silently accepted; no token in stdout |

The default path was also read directly rather than inferred from tests: in `renderPairing` the
pairing URL enters the output only inside `if (deps.showUrl)`, and the default string is built by
the same expression as before, pinned by a `toBe` equality test rather than a containment check.

FR1's binding clause — "The CLI does not print the token in plain text by default" — therefore
holds, with the opt-in as the only path to plaintext.

### Review

**Cycle 1 — PASS**, reviewed at **Mid tier (`sonnet`)**, the reviewer's pinned floor. The highest
tier that produced this milestone's work was Cheap, so the floor governs; the reviewer was never
overridden downwards.

Fresh context, given only the requirements, the architecture, this milestone entry and its
criteria, and the file-level delta (with the baseline-untracked caveat, so it read the files rather
than a `git diff`).

The reviewer did not credit the record: it re-ran `bun test test/host/pair.test.ts` (20 pass / 0
fail) and the full suite (793 pass / 0 fail), and ran `src/host/pair.ts` as a real subprocess
against a fixture token file rather than the operator's real credential.

**It mutation-tested the oracle** — the point this milestone turns on. Forcing the `showUrl` branch
to always execute made 6 assertions across 2 tests fail, so the assertions proving the default
leaks no token genuinely bite rather than being decorative containment checks that cannot fail. It
also confirmed by direct comparison of test bodies that the 10 pre-existing tests were unweakened,
that no environment variable or config path can flip the default (only `parsePairArgs` sets
`showUrl`), and that no scope creep occurred — `web/` source was untouched, which is `M12a-ii`'s
territory.

It independently confirmed the `Material: no` deviation classification is correct, and verified
byte-for-byte that C3's component block and the Interfaces entry were left unedited.

One **OPTIONAL** finding, no BLOCKER and no IMPORTANT: the new `## Deviations` entry's line
wrapping and an unspaced em-dash. Cosmetic, content correct, explicitly "not worth a dedicated fix
cycle" — already recorded under `### Follow-ups`.

Completion gate applied: the milestone's one acceptance criterion has a row in the reviewer's
per-criterion table, that row is PASS, and no BLOCKER or IMPORTANT finding remains.

### Review Cycles
0

### Follow-ups

- **For `M12a-ii`'s human attestation, the command is `bun run pair --show-url`.** Verified working
  as typed (the flag reaches the script through the npm-style alias, not only via
  `bun run src/host/pair.ts --show-url`). This is the affordance that milestone depends on.
- **No npm script was added for the flag and none is needed** — `bun run pair --show-url` already
  works. Recorded so a later milestone does not add a redundant `pair:url` script.
- **Cosmetic, not fixed:** the new `## Deviations` entry in `.harness/architecture.md` is written as
  one long unwrapped line, where its neighbours are hard-wrapped at ~95 columns, and it contains an
  unspaced em-dash in "unchanged—the token". Content is correct; not worth a fix cycle.
- **`parsePairArgs` accepts a repeated `--show-url`** (idempotent, last-wins). Harmless and
  deliberate — noted only so it is not mistaken for an oversight at review.

