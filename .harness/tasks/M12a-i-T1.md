TASK

Tier: Cheap — no reason to go above it.
Routing reasoning (recorded so a human can judge it later): this task is clearly
specified (this packet fixes the flag spelling, the default-output invariant, and
every assertion below, so nothing is left to your judgement), bounded (two files),
and easily verified (`bun test test/host/pair.test.ts`). The one arguable gate is
"low risk", because the subject is a bearer token: but the failure mode — the token
reaching stdout by default — is already detected mechanically by seven assertions
that exist in `test/host/pair.test.ts` today and that you are forbidden to modify.
A strong pre-existing oracle is what makes the cheap tier safe here.

Goal:

Give `src/host/pair.ts` an **explicitly opt-in** way to emit the pairing URL as
plain text, so a human at the Mac can copy it and get it onto the phone. The
default behaviour of the CLI must remain exactly what it is today and must still
never print the token in plain text.

Background — why this exists (do not implement any of it, it is context only):
the phone cannot supply the pairing URL to itself. The PWA clears the URL fragment
on load, so by the time Safari's address bar could be copied, the token is gone
from it. The human therefore needs the URL from the Mac side. A later milestone
(`M12a-ii`) builds the phone end; **it is not yours** — do not touch anything under
`web/`, and do not add any pairing UI.

Relevant Requirements:

FR1 — Pairing (`.harness/requirements.md` lines 16-27). The binding clause, quoted
verbatim, is the last bullet:

> - The CLI does not print the token in plain text by default.

"by default" is the whole point of this task. An opt-in affordance is permitted by
that clause; changing the default is forbidden by it.

Acceptance Criteria:

The milestone has a single acceptance criterion, quoted verbatim:

> `src/host/pair.ts` gains an **explicitly opt-in** way to emit the pairing URL
> as text for copying to the phone. Default behaviour is unchanged and still does not
> print the token in plain text, and a test proves the default does not.

Implement it to this exact specification, so that nothing below is a judgement call:

1. **`renderPairing` gains an optional `showUrl` field**, i.e. its `deps` parameter
   becomes `{ token: string; baseUrl: string; showUrl?: boolean }`. It defaults to
   `false`. Existing callers that pass only `{ token, baseUrl }` must keep working
   unchanged — ten existing tests call it that way.

2. **When `showUrl` is absent or `false`, the returned string must be byte-for-byte
   what it is today**, namely:

   `qrRendered + "\n\n" + baseUrl + "\n\n" + "Scan this QR code with your phone to pair this machine.\n"`

3. **When `showUrl` is `true`**, the returned string must additionally contain the
   full pairing URL produced by `pairingUrlWithToken(token, { OPENWEIGHT_HARNESS_BASE_URL: baseUrl })`,
   on a line of its own so it can be selected and copied cleanly, together with a
   short caution line making clear the text contains a secret. Keep the QR and the
   existing lines in the output as well — the opt-in adds to the output, it does not
   replace it.

4. **Add an exported pure argument parser** with the signature
   `parsePairArgs(argv: string[]): { showUrl: boolean }`.
   - The opt-in flag is spelled exactly `--show-url`. That spelling and no other.
   - An empty argument list yields `{ showUrl: false }`.
   - Any argument that is not `--show-url` must cause it to **throw** an `Error`
     whose message names the offending argument. Do not silently ignore unknown
     arguments. The error message must not contain the token (it has no access to
     one — keep it that way).
   - `argv` here is the list of user arguments only, i.e. what you get from
     `process.argv.slice(2)`. Do not make the function itself slice.

5. **Wire it into `main()`**: parse `process.argv.slice(2)`, pass the resulting
   `showUrl` through to `renderPairing`. A parse error must be reported on stderr
   and exit non-zero, via the existing `try`/`catch` error path — do not add a
   second error-handling style.

Tests you must add to `test/host/pair.test.ts`. These are the proof, so write them
precisely:

  (a) **Default output is unchanged.** Assert that `renderPairing({ token, baseUrl })`
      is exactly equal to the string described in point 2 above, reconstructed in
      the test from `encodeQr` + `renderToAnsi` (both already imported or trivially
      importable). This pins the default rather than merely sampling it.
  (b) Assert `renderPairing({ token, baseUrl })` deep-equals
      `renderPairing({ token, baseUrl, showUrl: false })`.
  (c) **`showUrl: true` emits the URL**: assert the output contains the exact string
      returned by `pairingUrlWithToken(token, { OPENWEIGHT_HARNESS_BASE_URL: baseUrl })`.
  (d) `parsePairArgs([])` → `{ showUrl: false }`; `parsePairArgs(["--show-url"])` →
      `{ showUrl: true }`; `parsePairArgs(["--nope"])` throws with a message
      containing `--nope`; `parsePairArgs(["--show-urls"])` throws (the near-miss
      spelling must not be accepted).
  (e) **End-to-end through the real CLI entry point, as a subprocess.** This is the
      criterion's actual subject, so it must go through the real binary, not through
      `renderPairing` alone. Create a temp dir, write a fixture token file with
      `chmodSync(path, 0o600)`, and run the CLI with
      `OPENWEIGHT_HARNESS_TOKEN_FILE` and `OPENWEIGHT_HARNESS_BASE_URL` pointing at
      your fixtures. Follow the temp-dir + `try`/`finally` cleanup pattern already
      used by the two subprocess-ish tests at the bottom of `test/host/pair.test.ts`.
      Three cases:
        - **default run** (no arguments): exit code 0, and stdout does **not**
          contain the fixture token, nor any 8-character window of it, nor
          `encodeURIComponent(token)`, nor the full pairing URL. Use a fixture token
          made of a repeated character (e.g. `"A".repeat(43)`) for the 8-char window
          check, exactly as the existing test at line 49 does.
        - **`--show-url` run**: exit code 0, and stdout **does** contain the exact
          pairing URL.
        - **unknown-argument run** (e.g. `--bogus`): exit code non-zero, stderr
          names `--bogus`, and neither stdout nor stderr contains the token.
      Invoke the CLI as `bun run src/host/pair.ts [args]` from the repository root.
      Capture exit code and streams; `Bun.spawnSync` or node's `spawnSync` are both
      fine — prefer whichever matches surrounding style.

Relevant Files:

- `src/host/pair.ts` — the CLI. 53 lines; read it in full. `renderPairing` is at
  the top, `main()` below it, `import.meta.main` guard at the bottom.
- `test/host/pair.test.ts` — 205 lines, 10 existing tests, all under a single
  `describe("pair.ts")` → `describe("renderPairing")`. Read it in full before
  adding to it. Note the seven assertions that the default output leaks nothing:
  they are the safety net for this change and must keep passing untouched.
- `src/host/config.ts` — read `pairingUrlWithToken` (line 87) and `readToken`
  (line 99). Do not change this file.

Files Allowed To Change:

- `src/host/pair.ts`
- `test/host/pair.test.ts`

Nothing else. In particular do not touch `package.json`, `src/host/config.ts`,
anything under `web/`, or any other test file. `bun run src/host/pair.ts --show-url`
already works without a new npm script, so none is needed.

Constraints:

- Follow existing repository patterns (Bun + TypeScript, `bun:test`, `.ts` import
  specifiers, `describe`/`it`/`expect`).
- Do not change unrelated behaviour.
- Do not introduce dependencies.
- **Do not weaken tests.** The ten existing tests in `test/host/pair.test.ts` must
  remain byte-for-byte unmodified. If one of them starts failing, that is your
  change being wrong — fix the change, never the test. This is the single most
  important constraint in this packet: the tests you must not touch are precisely
  the ones proving a credential does not leak.
- Do not print the token, or any part of it, on any path other than the explicit
  `--show-url` opt-in.
- Do not implement any part of `M12a-ii` (the phone-side pairing view).

Tests:

Run, from the repository root, with bun on PATH:

    export PATH="$HOME/.bun/bin:$PATH"
    bun test test/host/pair.test.ts

That focused command is the one that must pass. Before you return, also run the
full `bun test` and report its totals — the baseline is **783 pass / 0 fail**, so
anything below 783 passing means you broke something outside your own file.

Note: `bun` is not on the default PATH in this environment. Export it as shown
above or the command will fail with `command not found: bun`.

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
