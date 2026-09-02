# Task M12a-ii-T2 — The pairing view: a DOM surface that takes a pasted credential

Tier: **Mid** (`sonnet`). Named reason: **not low risk**. This is the DOM surface that
holds a bearer token in an input element on a device whose app switcher screenshots the
screen. Acceptance criterion 4 of the milestone is a set of *negative* assertions — the
token must reach no attribute, no title, no URL — and negative assertions are the kind
that get written shallowly and pass vacuously. Everything else about the task is
bounded and specified; it is the cost of an undetected leak that lifts it off Cheap.

## Goal

Build the pairing view as a standalone DOM module with an injected submit callback. It
owns rendering and input handling only. It does **not** know about credential stores,
API clients, or bootstrap — those are wired in a later task. Build no bootstrap wiring
here.

## Context

- Repository root: `/Users/ryankenny/Projects/phoneToLocalModel`. Use absolute paths.
- Bun 1.4.0 is at `~/.bun/bin/bun`, **not on PATH** in non-interactive shells. Prefix
  commands with `PATH="$HOME/.bun/bin:$PATH"`.
- Read `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/dom-target.ts` in full
  first. It is the existing DOM module and your new module must match its house style:
  plain `doc.createElement` calls, `data-testid` attributes for test selection, **no
  framework, no `innerHTML` with interpolated content**, and no third-party imports of
  any kind. The shipped bundle must stay free of third-party runtime code —
  `happy-dom` is test-only and `test/web/bundle-purity.test.ts` enforces this. Import
  nothing you did not write.
- `dom-target.ts` opens with the comment `// The ONLY module in web/src/ permitted to
  touch the DOM.` That statement becomes false with this task. **Amend that comment** to
  say that `dom-target.ts` and `ui/pairing-target.ts` are the only two, and say why the
  pairing view is separate (it renders before any conversation UI exists, when the app
  has no credential and every API call would `401`). Do not otherwise modify
  `dom-target.ts` — no behaviour change in that file.
- Read `test/web/ui/dom-target.test.ts` for how DOM tests are set up in this repo
  (`happy-dom`, test-only).
- The pasted text is a secret. Nothing in this module may log it, put it in an
  attribute, or leave it in the DOM after a successful pair.

## What to implement

Create `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/pairing-target.ts`
exporting exactly this surface:

```ts
export type PairingSubmitResult = { ok: true } | { ok: false; message: string };

export interface PairingTargetDeps {
  onSubmit(pastedText: string): PairingSubmitResult;
}

export interface PairingTarget {
  showMessage(message: string | null): void;
  destroy(): void;
}

export function createPairingTarget(
  root: HTMLElement,
  deps: PairingTargetDeps
): PairingTarget;
```

`createPairingTarget` replaces `root`'s children with a single
`<section data-testid="pairing">` containing, in this order:

1. A heading element with static explanatory text. It must name what the human has to do
   and where the value comes from. Use exactly this text so a later task and the human's
   device attestation agree on what the screen says:
   `Pair this app with your Mac` as the heading, and a paragraph
   (`data-testid="pairing-instructions"`) reading:
   `On your Mac, run: bun run pair --show-url — then copy the URL it prints and paste it below. A bare token works too.`
2. `<input type="text" data-testid="pairing-input">` with attributes
   `autocapitalize="off"`, `autocorrect="off"`, `autocomplete="off"`,
   `spellcheck="false"`. It must have **no `name` attribute** and you must **never** set
   its `value` *attribute* — only the `.value` *property*. (An attribute would serialise
   the token into `outerHTML`.)
3. `<button data-testid="pairing-submit">Pair</button>`.
4. `<p data-testid="pairing-message"></p>` for feedback.

Behaviour:

- Clicking the submit button reads `input.value` and trims it.
  - If the trimmed value is `""`: set the message element's `textContent` to
    `Paste the pairing URL or token from your Mac.` and **do not** call `deps.onSubmit`.
  - Otherwise call `deps.onSubmit(trimmedValue)`.
    - On `{ ok: true }`: set `input.value = ""` and set the message element's
      `textContent` to `""`.
    - On `{ ok: false, message }`: set the message element's `textContent` to `message`,
      and **leave `input.value` as the human typed it** so they can correct a typo. The
      milestone requires clearing only after a *successful* pair; pin this asymmetry with
      a test so a later change cannot silently flip it in either direction.
  - If `deps.onSubmit` **throws**, catch it, set the message to
    `Pairing failed. Check the URL or token and try again.`, and leave the input alone.
    An exception must never leave the human on a frozen screen.
- `showMessage(message)` sets the message element's `textContent` to `message ?? ""`.
  It never touches the input.
- `destroy()` removes the pairing section from `root` (`section.remove()`). It must be
  safe to call twice.
- The module must never read or write `document.title`, `window.location`,
  `localStorage`, or call `console.*`.

## Acceptance Criteria

Write these in a new file
`/Users/ryankenny/Projects/phoneToLocalModel/test/web/ui/pairing-target.test.ts`, using
`happy-dom` exactly as `test/web/ui/dom-target.test.ts` does.

- **AC1.** After `createPairingTarget(root, deps)`, `root` contains a
  `[data-testid="pairing"]` section holding the input, the submit button, the
  instructions paragraph and the message paragraph. **This assertion must fail if the
  pairing view is removed** — assert on the presence of the specific `data-testid`
  elements, not on `root.children.length`.
- **AC2.** Clicking submit with `"  tok-abc  "` in the input calls `deps.onSubmit`
  exactly once with `"tok-abc"` — trimmed.
- **AC3.** Clicking submit with an empty or whitespace-only input does **not** call
  `deps.onSubmit`, and the message reads
  `Paste the pairing URL or token from your Mac.`
- **AC4.** On `{ ok: true }`, `input.value` is `""` and the message is `""`.
- **AC5.** On `{ ok: false, message: "Pairing needed (unauthorized): ..." }`, the message
  element shows that exact string and `input.value` is **unchanged** from what was typed.
- **AC6. The leak assertions — the ones this task exists for.** Submit the token
  `SECRET-TOKEN-VALUE-9f3a` and then assert, after a successful pair:
  - `root.innerHTML` does not contain `SECRET-TOKEN-VALUE-9f3a`;
  - `input.getAttribute("value")` is `null` (the attribute was never set);
  - `input.outerHTML` does not contain `SECRET-TOKEN-VALUE-9f3a`;
  - `doc.title` is unchanged from before the submit and does not contain it;
  - no element in `root` has any attribute whose value contains it — walk
    `root.querySelectorAll("*")` and check every entry of each element's `attributes`.
  Then assert the same five things after an **unsuccessful** pair, **except** that
  `input.value` legitimately still holds it (AC5) — so for the failure case assert the
  attribute/title/`getAttribute("value")` checks still hold, and state in a comment why
  the live `.value` property is the one permitted exception.
  Additionally assert `web/src/ui/pairing-target.ts`'s source text contains no
  `document.title`, no `window.location`, no `localStorage` and no `console.`.
- **AC7.** `deps.onSubmit` throwing leaves the message at
  `Pairing failed. Check the URL or token and try again.` and does not propagate.
- **AC8.** `showMessage("hi")` then `showMessage(null)` sets the message to `"hi"` then
  `""`, leaving `input.value` untouched in both cases.
- **AC9.** `destroy()` removes the pairing section; calling it a second time does not
  throw.
- **AC10.** `dom-target.ts`'s opening comment is amended as described, and
  `test/web/ui/dom-target.test.ts` still passes unmodified.

## Files Allowed To Change

- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/pairing-target.ts` (new)
- `/Users/ryankenny/Projects/phoneToLocalModel/test/web/ui/pairing-target.test.ts` (new)
- `/Users/ryankenny/Projects/phoneToLocalModel/web/src/ui/dom-target.ts` — **comment
  only**, no code change

Nothing else. Do **not** touch `web/src/main.ts`, `web/src/credential-store.ts`,
`package.json`, or `web/dist/*`. Another task is changing `credential-store.ts`
concurrently — leave it alone entirely.

## Tests

Red first: write the failing tests, watch them fail for the right reason, then implement.

```
cd /Users/ryankenny/Projects/phoneToLocalModel
PATH="$HOME/.bun/bin:$PATH" bun test test/web/ui/pairing-target.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test
```

The full suite was **793 pass / 0 fail** before this milestone began. Another task may
have added tests concurrently, so do not assert an exact total — assert **0 fail**, and
that no previously-passing test now fails.

## Report back

The two commands, their exit statuses and pass/fail counts; the new test count; and
explicitly: which of AC6's assertions you confirmed genuinely fail when you temporarily
set the input's `value` *attribute* instead of its property. A negative assertion you
have not seen fail is not evidence.
