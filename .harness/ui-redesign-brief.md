# UI redesign — rough brief for roast-requirements

Raised by the human on 2026-09-02, after M12 and M12a-ii were attested on the device.
**This is new scope beyond the agreed `requirements.md`.** It is written here rather than
implemented so that `harness:roast-requirements` can turn it into agreed requirements with real
acceptance criteria. Nothing here is agreed yet except the three decisions marked SETTLED.

## What the human asked for

1. A list of previous conversations down the left-hand side.
2. An indicator of what is currently loaded on the machine, with the others selectable from a
   dropdown.
3. A chat interface resembling iPhone Messages / WhatsApp rather than the current bulleted list.

## SETTLED — decided with the human on 2026-09-02, do not re-litigate

**The conversation list is a slide-over drawer, not a permanent split.** At iPhone width (390pt) a
fixed left column leaves roughly 250pt for messages. The chat fills the screen; the list slides in
from the left over it, dismissed by tap or swipe — what iOS and WhatsApp actually do at this size.

**The "loaded model" indicator is warm/cold inference from the `model-loading` SSE event, and it
must be labelled as inference.** See the constraint below for why nothing better is available. The
client observes that a generation completed *without* a `model-loading` event and infers that
profile was already resident. This is a guess: it goes stale as soon as something else evicts the
model, and it knows nothing before the first generation of a session.

**It displays the profile type, never a physical model name** — the existing labels "Fast
reasoning", "Balanced reasoning", "Deep reasoning", as the app shows today. This is the human's
explicit instruction and also the only possibility (see below).

## Hard constraint discovered while scoping this — verified against the API doc

**The harness exposes no loaded-model state at all.** Verified in
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/docs/api/phone-reasoning-surface-v1.md`:

- `GET /v1/profiles` returns exactly five fields per profile — `id`, `role`, `quality`,
  `latency_class`, `label` — and the document states outright that the API "never exposes physical
  model names".
- `GET /status` is a frozen M0 contract: `status`, `surface`, `milestone`. Nothing else.
- There is no models endpoint. The complete endpoint set is `/status`, `/v1/profiles`,
  `/v1/sessions`, `/v1/sessions/{id}`, `/turns`, `/generate`, `/cancel`, `/events`.

A truthful residency indicator would require a new harness endpoint, which `requirements.md` makes
both a hard constraint ("The harness repository must not be modified") and an explicit non-goal
("Modifying the harness API, its behaviour, or its repository"). The human chose the inference
approach over reopening that. **If the inference proves too misleading to ship, the fallback is to
drop the indicator and keep the dropdown — not to modify the harness.**

## Other constraints that bind this work

- **No third-party runtime code in the shipped bundle.** `architecture.md` settles this as the
  mitigation for holding the bearer token in `localStorage`, and `test/web/bundle-purity.test.ts`
  enforces it. So: hand-written CSS, no framework, no icon library.
- **`web/src/ui/dom-target.ts` is one of only two modules permitted to touch the DOM** (the other
  is `ui/pairing-target.ts`). The view-model / actions / mount split is structurally enforced by
  tests; a redesign must stay inside it rather than routing around it.
- **Safe-area insets already matter.** M12 shipped a fix for controls rendering under the iOS
  status bar and home indicator (`web/public/index.html`). A layout change must not regress it.
- **The long-transcript performance criteria in M13 are about this same renderer.** M13 requires
  that streaming deltas not create DOM elements proportional to transcript length. A chat-bubble
  redesign lands on exactly that code, so the two should be sequenced deliberately rather than
  allowed to collide.

## Relationship to the existing plan

`M12b` is a narrow FR5 bug fix — the profile `change` handler calls `chooseProfile(...)` with no
`await`, no `render()` and no `.catch()`, so picking a profile never repaints. **This brief does
not replace it.** The redesign's dropdown sits on top of a selector that must first actually work.
The human has not yet settled whether the redesign runs before, after, or merged with `M12b`,
`M13` and `M14`.
