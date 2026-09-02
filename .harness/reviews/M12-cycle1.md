# M12 — Cycle 1 findings (human attestation of criterion 6, FAILED)

Source: the human's attestation attempt on `iphone-15-pro`, 2026-09-01, plus a code reading
confirming each reported symptom against a specific line. This report supersedes the agent
reviewer's cycle-1 `PASS` on the points below. That review was told, by the implement session
relaying the implementation phase's own framing, that the list-repaint and swallowed-error
items were logged follow-ups and "not criterion breaches" and should not be raised. **That
instruction was wrong.** They are the direct and sufficient cause of criterion 6 failing.

## What the human observed

1. On the installed home-screen app the controls sit under the iOS status bar, and **the prompt
   textarea cannot be tapped to type into**.
2. In Safari, typing `test` and pressing **Send** and **Create** produced **nothing at all** —
   no output, no error, no visible change.

## Verdict

**CHANGES REQUIRED.** Criterion 6 is not attestable in the current state, and the app cannot be
driven to a usable state through its own UI by any sequence of taps.

---

## BLOCKER 1 — Create never repaints, so Send is permanently inert. The app deadlocks.

`web/src/ui/dom-target.ts`, create handler (~line 165):

```ts
createConversationBtn.addEventListener("click", () => {
  if (!deps) return;
  const selectedProfileId = profileSelect.value;
  if (!selectedProfileId) return;
  deps.actions.createConversation({ profileId: selectedProfileId });
});
```

`createConversation` returns a `Promise<Conversation>`. It is not awaited, no `render()` follows
it, and nothing catches a rejection. `web/src/ui/mount.ts` repaints **only** when one of its own
methods is called (`paint()` at lines 63, 72, 77, 82, 87, 92); `web/src/conversation-store.ts`
has **no subscription mechanism at all** — grep for `subscribe|listener|notify|onChange` returns
nothing. So nothing repaints after a create.

The consequence is a hard deadlock, not a cosmetic lag:

- the conversation list never repaints, so no `open-conversation` button is ever created;
- `controller.select(...)` is therefore never called, so `selectedConversationId` stays `null`;
- the send handler opens with `if (!selectedConversationId) return;` (~line 85), so **Send is a
  silent no-op forever**.

There is no tap sequence that escapes this. That is exactly what the human saw.

**Why the suite did not catch it.** `test/web/ui/bundle-interactive.test.ts` and
`src/host/m12-proof.ts` both call `handle.render()` (or drive the controller) manually after
creating, which supplies the repaint the UI itself never performs. The tests compensate for the
defect instead of exposing it. The implementation phase noticed this — it recorded that the test
"needs a manual `handle.render()`" — and logged it as a follow-up rather than a defect. **A test
that performs an action the user cannot perform is not evidence for a criterion about the user
performing it.** 768 passing tests and two live proofs coexist with an app that cannot be used.

**Required:** creating a conversation must repaint and leave the new conversation selected, so
that Send works immediately afterwards. Deleting must repaint too (same omission, same file).
Prefer awaiting the promise and rendering on resolution over a fire-and-forget call.

## BLOCKER 2 — Every failure path is silent. The user cannot tell working from broken.

Three separate silencing mechanisms, all in the interactive path:

- `dom-target.ts` send handler: `.catch(() => {})` (~line 137) discards every send failure.
- `web/src/main.ts` (~line 103): `coordinator.listProfiles().then(...).catch(() => {})`
  discards profile-fetch failures. If this rejects — which it will whenever the client is
  unpaired or the token is invalid, since the harness returns **401** to an unauthenticated
  request (verified: `GET /status` → 401) — the `<select>` stays empty. `createConversation`
  then hits `if (!selectedProfileId) return;` and **Create is also a silent no-op.** The narrow,
  empty selector in the human's screenshot is consistent with exactly this.
- Bare guard `return`s in the send, cancel, profile-change and create handlers, none of which
  tell the user anything.

FR9 requires documented error codes to be "surfaced meaningfully rather than as a generic
failure", and `unauthorized` specifically to "prompt to re-pair". M7 built that surfacing; the
interactive layer added in M12 discards it before it can reach the screen. A user who is simply
unpaired is shown an idle app that ignores every tap.

**Required:** send failures and profile-fetch failures must reach the status region rather than
being swallowed; an unauthenticated client must say so and prompt to re-pair. Guard clauses that
decline to act must say why.

## BLOCKER 3 — Controls render under the iOS status bar; the textarea is untappable.

`web/public/index.html` sets, together:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

`viewport-fit=cover` plus `black-translucent` extends the web view **under** the status bar and
home indicator, and the page then compensates with nothing: `body { margin: 0; padding: 1rem; }`
uses no `env(safe-area-inset-*)`. The first element in the DOM is the prompt `<textarea>`, so it
lands beneath the clock and is not reliably tappable — the human's report and screenshot agree.

This is the standalone-mode layout that M10's packaging enabled but no criterion re-checked once
M12 put interactive controls at the top of the document.

**Required:** honour the safe-area insets, e.g. padding of
`max(1rem, env(safe-area-inset-top))` and the corresponding bottom/left/right, so no control
sits under the status bar or home indicator. Verify against the source `web/public/index.html`,
not only `web/dist/`.

---

## Not in scope for this cycle

Positional DOM selection in tests (`sections[2]`, `querySelectorAll("ul")[1]`) remains a logged
follow-up. Do not widen into it unless a correction above forces the document shape to change,
in which case fix the selectors it breaks and say so.

## Re-attestation

Criterion 6 stays unchecked and remains the human's alone. After these corrections the human
must re-attest on `iphone-15-pro`: type a prompt, send it, see output stream, and confirm cancel
stops a running generation.
