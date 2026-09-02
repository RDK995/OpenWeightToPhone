# Task M12a-ii-T1 — `adoptCredentialFromPastedText`: pair from pasted text, reusing the fragment parser

Tier: **Cheap**, attempt 1. No named gate fails. It is clearly specified (this packet
fixes the signature and every case), bounded (two files), verifiable (unit tests), and
its risk is contained because it delegates all storage and validation to
`adoptCredentialFromFragment`, which is already implemented, tested and reviewed.

## Goal

The installed iOS home-screen app has its own storage container and no address bar, so
a `#t=` pairing URL can never reach it. Milestone `M12a-ii` adds an in-app pairing
screen where the human **pastes** either a full pairing URL or a bare token. This task
builds the pure adoption function behind that screen. It builds **no UI** — that is a
separate task. Do not touch `web/src/main.ts` or anything under `web/src/ui/`.

## Context

- Repository root: `/Users/ryankenny/Projects/phoneToLocalModel`. Use absolute paths.
- Bun 1.4.0 is at `~/.bun/bin/bun` and is **not on PATH** in non-interactive shells.
  Prefix commands with `PATH="$HOME/.bun/bin:$PATH"`.
- Read `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts` in full
  before writing anything. It already contains `adoptCredentialFromFragment(store,
  location)`, which parses `#t=<token>` out of a `LocationPort`, validates it, stores
  `{ baseUrl: location.origin, token }` via `store.setCredential`, and calls
  `location.clearHash()`.
- **Binding constraint from the milestone's `### Follow-ups`, quoted verbatim:**
  > **Do not let the pairing view become a second source of truth for credential
  > handling.** `adoptCredentialFromFragment` already parses `#t=`, validates, stores
  > and clears. The pasted-URL path should reuse that parsing rather than reimplement
  > it, or the two will drift.

  Your new function **must delegate to `adoptCredentialFromFragment`**. It must not
  contain its own `URLSearchParams` parse of a `t` parameter, its own emptiness
  validation, or its own call to `store.setCredential`. Its only job is to turn a
  pasted string plus a current origin into a synthetic `LocationPort` and hand that to
  the existing function. A reviewer will check this by reading the code, not only the
  tests.

## What to implement

In `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts`, add one
exported function. Place it after `adoptCredentialFromFragment`. Change nothing else in
that file — every existing export keeps its current behaviour byte for byte.

```ts
export function adoptCredentialFromPastedText(
  store: CredentialStore,
  pastedText: string,
  currentOrigin: string
): Credential | null
```

Behaviour, exactly:

1. Trim `pastedText`. If the trimmed result is `""`, return `null` without touching
   storage.
2. **Full-URL form.** If the trimmed text parses as an absolute URL via `new URL(text)`
   (wrap in `try`/`catch`; a throw means it is not a URL, fall through to step 3):
   - Build a synthetic `LocationPort` whose `hash` is that URL's `hash`, whose `origin`
     is that URL's `origin`, and whose `clearHash()` is a no-op (there is no address bar
     to clear — the text came from a paste, not from `window.location`).
   - Return `adoptCredentialFromFragment(store, syntheticLocation)`.
   - **The stored `baseUrl` must be the pasted URL's origin, not `currentOrigin`.** This
     is the point of accepting a full URL at all: the phone may be launched from a
     different origin than the one the Mac is serving. Getting this backwards is the
     single most important thing this task can get wrong.
   - A URL with no `#t=` fragment yields `null` (delegated: `adoptCredentialFromFragment`
     returns `null` when the `t` parameter is absent). Do not fall through to step 3 in
     that case — a parseable absolute URL is a URL, and treating
     `https://example.test/app/` as a bare token would store a nonsense credential.
3. **Bare-token form.** Otherwise, treat the trimmed text as the token itself:
   - Build a synthetic `LocationPort` whose `hash` is
     `"#t=" + encodeURIComponent(trimmedText)`, whose `origin` is `currentOrigin`, and
     whose `clearHash()` is a no-op.
   - Return `adoptCredentialFromFragment(store, syntheticLocation)`.
   - `encodeURIComponent` is required: `adoptCredentialFromFragment` parses with
     `URLSearchParams`, so a raw `&`, `=`, `+` or `#` in the token would otherwise be
     mis-parsed. A token containing `+` is the sharpest case — `URLSearchParams` decodes
     an unescaped `+` as a space.

## Acceptance Criteria

Every one of these needs a test in
`/Users/ryankenny/Projects/phoneToLocalModel/test/web/credential-store.test.ts`, in a
new `describe("adoptCredentialFromPastedText", ...)` block appended after the existing
`describe("adoptCredentialFromFragment", ...)` block. Use `createMemoryStorage()` and
`createCredentialStore` exactly as the existing tests in that file do.

- **AC1.** A full pairing URL `https://mac.example.test/app/#t=tok-abc` with
  `currentOrigin = "https://phone.example.test"` returns a credential and stores
  `{ baseUrl: "https://mac.example.test", token: "tok-abc" }`. Assert the `baseUrl` is
  the **pasted URL's** origin and explicitly **not** `currentOrigin`.
- **AC2.** A bare token `tok-abc` with `currentOrigin = "https://phone.example.test"`
  returns a credential and stores
  `{ baseUrl: "https://phone.example.test", token: "tok-abc" }`.
- **AC3.** Leading and trailing whitespace is tolerated on both forms — iOS paste
  frequently carries a trailing newline or space. `"  https://mac.example.test/app/#t=tok-abc\n"`
  and `"  tok-abc\n"` both pair identically to AC1 and AC2.
- **AC4.** `""`, `"   "` and `"\n"` all return `null` and leave storage untouched
  (assert `store.getCredential()` is still `null`, and that a *previously stored*
  credential is left intact by a second call with empty text).
- **AC5.** A token containing URL-significant characters survives a round trip exactly.
  Use at least `"tok+with/slash&amp=and space"` as a bare token and assert
  `store.getCredential()!.token` equals that string character for character. Add a
  second case for the full-URL form with a percent-encoded token in the fragment.
- **AC6.** An absolute URL carrying **no** `#t=` fragment (`https://mac.example.test/app/`)
  returns `null` and stores nothing — it is **not** treated as a bare token.
- **AC7.** An absolute URL whose fragment has an **empty** token (`...#t=`) returns
  `null` and stores nothing.
- **AC8.** A fragment with several parameters (`#a=1&t=tok-abc&b=2`) yields token
  `tok-abc` — proving the delegation to the existing parser rather than a naive
  `split("#t=")`.
- **AC9. Reuse, asserted structurally.** Add a test that reads
  `web/src/credential-store.ts` as text (the existing test file already has file-reading
  precedent elsewhere in the repo; use `readFileSync` with a path built from
  `import.meta.dir`) and asserts that the body of `adoptCredentialFromPastedText`
  **calls `adoptCredentialFromFragment`** and does **not** call `store.setCredential`
  or construct a `URLSearchParams`. Slice the source text from the
  `export function adoptCredentialFromPastedText` marker to the end of file so the
  assertion is about this function only. This test is what stops the two paths drifting;
  make it genuinely fail if the delegation is removed, and say in your return that you
  checked it fails by temporarily inlining the parse.
- **AC10.** The existing `describe("adoptCredentialFromFragment", ...)` tests are
  **byte-for-byte unmodified** and still pass.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/credential-store.ts`
- `/Users/ryankenny/Projects/phoneToLocalModel/test/web/credential-store.test.ts`

Nothing else. Do not touch `web/src/main.ts`, `web/src/ui/*`, `web/dist/*`, or any other
test file. Do not run the build.

## Tests

Red first: write the failing tests, watch them fail for the right reason, then implement.

```
cd /Users/ryankenny/Projects/phoneToLocalModel
PATH="$HOME/.bun/bin:$PATH" bun test test/web/credential-store.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test
```

The full suite was **793 pass / 0 fail** before this task. It must be 793 + (your new
test count), with **0 fail**. Any pre-existing test that now fails is a regression you
caused; fix your code, never the test.

## Report back

The two commands, their exit statuses and pass/fail counts; the new test count; and your
confirmation that AC9's structural test genuinely fails when the delegation is removed.
