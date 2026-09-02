# Task M12a-ii-T4 — `proof:m12a`: pairing with a real token against the live harness

Tier: **Mid** (`sonnet`), entering at attempt 3. Named reason: **not easily verified** by
a unit test. Milestone criterion 6 explicitly forbids satisfying it by asserting over
client state — it must run against the live harness on the Mac with the real operator
credential, so the oracle is a live HTTP exchange rather than a fixture. It also handles
the real bearer token and must not print it.

## Goal

Milestone `M12a-ii` criterion 6, quoted verbatim:

> (derived: FR1, FR2, live) Pairing with a real token read from `~/.openweight-harness/token`
> yields a working authenticated client against the live harness, proven at a Mac-run
> entry point rather than asserted from client state.

Build that entry point.

## Context

- Repository root: `/Users/ryankenny/Projects/phoneToLocalModel`. Use absolute paths.
- Bun 1.4.0 is at `~/.bun/bin/bun`, **not on PATH** in non-interactive shells. Prefix
  commands with `PATH="$HOME/.bun/bin:$PATH"`.
- **Follow the existing `proof:m*` pattern exactly.** Read
  `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m11-proof.ts` and
  `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m12-proof.ts` in full first, and
  match their structure, their console output style, their exit-code discipline and their
  section headings. Do not invent a new shape.
- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/config.ts` already gives you
  `readToken()` (reads `~/.openweight-harness/token`, refusing a file readable by group or
  other), `resolveBaseUrl()` and `pairingUrlWithToken(token)`. **Use them. Do not re-read
  the token file yourself and do not reimplement the path resolution.**
- The pairing logic under test is `adoptCredentialFromPastedText` in
  `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts`, and the
  client is `createApiClient` in `web/src/api-client.ts`. Import them directly; this is a
  Bun script on the Mac, so importing browser-targeted modules is fine as long as you
  supply a `StoragePort` — use `createMemoryStorage()` from `web/src/storage-port.ts`.

## What to implement

Create `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m12a-proof.ts` and add
`"proof:m12a": "bun run src/host/m12a-proof.ts"` to `package.json`'s `scripts`, placed
after `"proof:m12"` so the list stays in order.

The script must, in this order, printing a clearly labelled section for each step:

1. **Read the real token** via `readToken()`, and `resolveBaseUrl()` for the harness base
   URL. If the token file is missing or has bad permissions, fail loudly with a non-zero
   exit and a message naming the file — do not fall back to a fixture.
2. **Build the pairing URL** the human would paste, via `pairingUrlWithToken(token)`.
3. **Pair through the real code path**: create a `createMemoryStorage()` +
   `createCredentialStore(...)`, then call
   `adoptCredentialFromPastedText(store, <the pairing URL>, "https://unused.example")`.
   Assert it returns non-null, that the stored `baseUrl` equals `resolveBaseUrl()`, and
   that the stored token equals the real token. Passing a deliberately wrong
   `currentOrigin` is the point: it proves the pasted URL's own origin wins.
4. **Also prove the bare-token form** in a second memory store: call
   `adoptCredentialFromPastedText(store2, <the raw token>, resolveBaseUrl())` and assert
   the same stored credential results. This is the form the human will most often paste.
5. **Make a real authenticated request.** Build
   `createApiClient({ baseUrl: credential.baseUrl, getToken: () => store.getToken() })`
   and call its profile-listing method against the **live** harness. Assert the call
   succeeds and returns at least one profile, and print the profile ids and labels. This
   is the criterion's "working authenticated client" and it must be a real network call —
   **no mock fetch, no fixture server, no stub.**
6. **Prove the authentication is actually doing something.** Repeat the same request with
   a deliberately corrupted token and assert it is **rejected** with `unauthorized` / HTTP
   401. A proof that only shows success cannot distinguish a working credential from a
   harness that ignores credentials entirely. Build the corrupted token by mutating the
   real one; do not print either.
7. Print a final `PASS` / `FAIL` summary and `process.exit(0)` or `process.exit(1)`
   accordingly, as the existing proofs do.

## The token must never be printed

This is FR1 and it is not negotiable. The script prints the harness base URL, profile ids,
HTTP statuses and its own assertions — **never the token, never the pairing URL, and never
a percent-encoded form of either**. Where the existing proofs print a URL, print a
redacted form (e.g. `<baseUrl>/app/#t=<redacted, NN chars>`).

Add a guard you can point at: capture everything the script prints (accumulate the strings
you pass to `console.log`, or wrap `console.log`) and, immediately before exiting, assert
that no 8-character window of the real token and no 8-character window of
`encodeURIComponent(token)` appears anywhere in the captured output. If it does, print a
loud failure and exit non-zero. `src/host/pair.ts`'s tests use this same 8-char-window
technique — read `test/host/pair.test.ts` for the precedent.

## Acceptance Criteria

- **AC1.** `bun run proof:m12a` exits 0 on the Mac with the real harness reachable, and
  prints a section for each of steps 1-7.
- **AC2.** Its output contains no 8-character window of the real token and none of its
  percent-encoded form. Prove this by piping the output to a checker, not by reading it.
- **AC3.** Step 5 is a real network call. There is no mock, stub, fake fetch, or fixture
  server anywhere in the file — assert this by grepping your own source for `mock`,
  `stub`, `fake`, and by passing no `fetch` override to `createApiClient`.
- **AC4.** Step 6 genuinely fails closed: the corrupted-token request is rejected with
  `unauthorized`/401, and the script treats a *success* there as a FAIL.
- **AC5.** `package.json` gains exactly one line and no other change. Every existing
  script is byte-for-byte unchanged.
- **AC6.** The full test suite still passes with 0 fail.

## If the live harness is unreachable

**Do not stub it and do not weaken the proof.** Report back exactly what happened — the
command, the error, the exit status — and say the criterion is unproven pending a
reachable harness. A green proof achieved by mocking is worth less than an honest red one,
and this criterion exists precisely because mocked evidence was not acceptable.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/src/host/m12a-proof.ts` (new)
- `/Users/ryankenny/Projects/phoneToLocalModel/package.json` (one added script line)

Nothing else. Do not modify `web/src/*`, any test file, or any other proof script.

## Tests

```
cd /Users/ryankenny/Projects/phoneToLocalModel
PATH="$HOME/.bun/bin:$PATH" bun run proof:m12a; echo "exit=$?"
PATH="$HOME/.bun/bin:$PATH" bun test
```

## Report back

The full output of `bun run proof:m12a` **with your own eyes on it for token leakage**,
its exit status, the suite result, and confirmation that step 6 was observed to be
rejected rather than assumed.
