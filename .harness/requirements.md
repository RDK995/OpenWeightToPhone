# Requirements

## Goal

Control the OpenWeight harness's Phone Reasoning Surface from an iPhone: hold multi-turn
reasoning conversations against local models running on the Mac Studio, over the tailnet,
from a home-screen app that needs no App Store, no Xcode, and no Apple developer account.

The app must also make the **model tier** legible: which tier is loaded on the Studio right
now, and when a newly-selected tier is ready to use.

The service is documented at
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness/docs/api/phone-reasoning-surface-v1.md`.
This repository builds a client of that service and never becomes a second source of truth
for it.

## Functional Requirements

### FR1 — Pairing

- A Mac-side CLI renders a QR code encoding the PWA URL with the bearer token in the URL
  **fragment**.
- The token is read from `~/.openweight-harness/token` (honouring
  `OPENWEIGHT_HARNESS_TOKEN_FILE`, as the harness itself does).
- Reading is refused if the token file is group- or world-readable, mirroring the harness's
  own refusal: a disclosed credential should stop the tool, not be used anyway.
- Scanning with the iPhone camera opens the PWA, which captures the token from
  `location.hash`, persists it, and clears the hash immediately.
- The CLI does not print the token in plain text by default.

### FR2 — Installation

- The PWA is installable to the iOS home screen: web app manifest, icons, and standalone
  display mode.
- It is served on the same origin as the API, so requests carry no CORS requirement.

### FR3 — Conversations

- A list of conversations, newest first, supporting create, open, and delete.
- Each conversation is backed by exactly one server session.
- The full transcript of each conversation is persisted locally on the phone.

### FR4 — Generation

- Send a prompt and stream assistant output incrementally as `content` events arrive.
- Display queue position while the generation is `queued` (1-based; 1 means next to run).
- Display the `model-loading` state.
- On `complete`, display telemetry: tokens per second, eval count, quantization, and
  context limit.
- The client MUST NOT append turns around a generation. The service appends both the user
  turn and the assistant turn itself (see Decisions).

### FR5 — Profiles

- Fetch `/v1/profiles` at runtime. Profile ids are never hardcoded.
- Profile is selectable per conversation and changeable.

### FR6 — Cancel

- Cancel a running or queued generation and reflect the resulting terminal state.

### FR7 — Resume

- On reconnect or return to foreground, resume the event stream via
  `GET /v1/sessions/{id}/generations/{id}/events` using `Last-Event-ID` set to the last
  received seq, yielding no gaps and no duplicates.
- Disconnecting is distinguished from cancelling: a dropped connection leaves the
  generation running.

### FR8 — Session-loss recovery

- On `404 unknown_session`, create a fresh session, replay the locally stored transcript
  via `POST /v1/sessions/{id}/turns` to restore the model's context, then continue.
- `404 unknown_session` is distinguished from `401 unauthorized`: the former means the
  session is gone, the latter means the token is invalid.

### FR9 — Error surfacing

- Documented error codes are surfaced meaningfully rather than as a generic failure:
  `unauthorized` (prompt to re-pair), `queue_full` (retry guidance),
  `generation_in_flight`, `seq_not_available`, `invalid_request`, `unknown_profile`, and
  the SSE error codes (`profile_resolution_failed`, `inference_failed`,
  `incomplete_stream`, `session_unavailable`, `generation_timed_out`,
  `stream_write_failed`).

### FR10 — A dropped stream during an active generation is recovered, not surfaced as an error

- A mid-stream transport drop while a generation is in flight is a **resume trigger**, not
  a terminal error. The client recovers via the FR7 `Last-Event-ID` machinery.
- This includes an **undocumented gateway status** (notably `502`) received while a
  generation is known to be in flight. Such a status must never reach the user as
  `http_502` / "unexpected harness error" while the generation is still recoverable.
- The generation id needed to resume is available from the `x-generation-id` **response
  header**, which is present even when the stream carried no events at all. Recovery
  therefore does not depend on having received any SSE event first.
- Recovery retries with backoff until the generation reaches a terminal state or its 300s
  wall-clock budget expires. Only then is an error surfaced.
- While recovering, the user sees a reconnecting/loading state — not an error, and not a
  silent hang.

### FR11 — The harness stream is not killed during a cold model load

- The harness's `Bun.serve` sets an explicit `idleTimeout` sufficient to cover a cold model
  load. Today it sets none, so Bun's ~10s default applies and closes the SSE connection
  mid-generation whenever a model load exceeds it.
- The value is **255s** (Bun's maximum), which sits below the 300s generation wall-clock
  budget so the generation timeout remains the governing limit rather than the socket.

### FR12 — The currently loaded tier is visible

- The host PWA server exposes a **same-origin** endpoint under `/app` reporting which tier
  is currently resident on the Studio.
- Residency is derived from ollama's `GET /api/ps` and mapped back to profile ids using the
  harness's own `resolveProfileAgainstLocalOllama`, so the mapping is never duplicated or
  hardcoded.
- It reports "nothing loaded" **truthfully**, and reflects models loaded by other tools.
- **Tier labels only.** Physical model names, sizes, digests and quantization tags never
  reach the UI, preserving the v1 API's deliberate model-agnosticism.
- The client displays the currently-loaded tier and distinguishes it from the tier the open
  conversation has selected.

### FR13 — Selecting a tier warms it up

- Selecting a tier triggers a warm-up load so the human learns readiness at switch time
  rather than after committing to a prompt.
- Warm-up is performed by the host server **directly against ollama** (a `POST
  /api/generate` with an empty prompt, which returns `done_reason: "load"`), and **never
  through the v1 API**.
- Warm-up therefore creates **no session**, appends **no turns**, and does **not** consume
  the single global generation slot, so it can never block or queue behind a real prompt.
- The UI shows loading → ready for the selected tier.
- Rapid switching **supersedes**: only the most recently selected tier is warmed.

## Acceptance Criteria

Every criterion is proven against the live harness, not a mock.

1. **AC1** — An encoded pairing URL decodes back to byte-identical input via an
   independent decoder.
2. **AC2** — From a browser with no stored token, scanning the QR yields a working
   authenticated client, and `location.hash` is cleared afterwards.
3. **AC3** — A prompt produces incrementally rendered tokens, then a `complete` event whose
   telemetry is displayed.
4. **AC4** — A second prompt in the same conversation demonstrably has context from the
   first.
5. **AC5** — Exactly one user turn and one assistant turn are recorded per generation,
   verified via `GET /v1/sessions/{session_id}`. No duplication.
6. **AC6** — Cancelling mid-generation returns status `cancelled` and output stops.
7. **AC7** — Killing the connection mid-stream and resuming with `Last-Event-ID` yields no
   gaps, no duplicates, and delivers the terminal event.
8. **AC8** — After a harness restart, a prompt on an old conversation returns `404`, the
   client rebuilds the session and replays context, and the conversation continues.
9. **AC9** — A second generation on a session that already has one admitted returns
   `409 generation_in_flight`, and this is surfaced to the user.
10. **AC10** — The app installs to the iOS home screen and runs in standalone mode.
11. **AC11** — Profiles are fetched dynamically and all three live profiles are selectable.
12. **AC12** — With a **cold** load of `reasoning-deep` forced deterministically, a prompt
    sent from the client completes with its output rendered and **no error surfaced**.
13. **AC13** — With `idleTimeout` set, the request that previously died at 12s delivers
    `content` and `complete` **in-band**, on the original connection, without resuming.
14. **AC14** — The client recovers **independently of the harness fix**: with the harness
    `idleTimeout` change reverted, a killed stream still yields the full answer via resume.
    The two fixes must be separately falsifiable, so that neither can mask the other's
    regression.
15. **AC15** — The loaded-tier endpoint reports truthfully across all three states: nothing
    resident → reports none; after warming tier X → reports X; cross-checked against
    ollama's `/api/ps`.
16. **AC16** — Selecting a tier warms it and the UI shows ready, with **no session created
    and no turns appended**, verified via `GET /v1/sessions`.
17. **AC17** — No physical model name, size or digest appears anywhere in the rendered UI.

## Constraints

- The harness sends **no CORS headers**. The PWA must therefore be served **same-origin**
  with the API; a separate origin cannot call it from a browser.
- Tailscale Serve currently maps `/` to `http://127.0.0.1:7787` and `/app` to
  `http://127.0.0.1:7788`.
- Tailnet-only. No Tailscale Funnel and no public internet exposure.
- **The harness repository (`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`) MAY be
  modified.** This **reverses** the original constraint that it must never be modified —
  see Decisions for the rationale and scope.
- The service runs one generation at a time globally, and admits at most one generation per
  session. Warm-up (FR13) is deliberately outside this budget because it does not go
  through the API.
- Static PWA assets are served **unauthenticated**: a browser cannot attach a bearer token
  to a top-level navigation. Tailnet membership is the security boundary for the app shell.
  The API itself remains bearer-authenticated. **The FR12 loaded-tier endpoint inherits
  this**: it is unauthenticated and same-origin under `/app`, which is why it exposes tier
  labels only and never physical model identity.
- FR12 and FR13 depend on ollama's `GET /api/ps` and `POST /api/generate` on
  `127.0.0.1:11434`. This is an ollama surface, not a harness one, and may change
  independently of the v1 API.
- Setting `idleTimeout` applies to **all** harness requests, not only SSE, so idle
  connections linger longer than they do today. This is an accepted cost.
- The bearer token is persisted in `localStorage`, which is required for a home-screen app
  to stay paired across launches.
- Mac-side tooling targets the Bun runtime already used by the harness.
- API version is `v1`; within it the endpoint set is fixed and existing response fields are
  immutable, so the client may rely on documented fields but must tolerate new ones.

## Non-Goals

- A native SwiftUI iOS app. Explicitly deferred to a later requirements cycle.
- App Store distribution or code signing.
- Push notifications or APNs infrastructure.
- Public internet exposure, including Tailscale Funnel.
- Modifying the harness **API contract** — its documented endpoints, response shapes or
  semantics. The repository itself is now modifiable, but the v1 surface is not.
- **Pulling, removing or deleting models, and starting or stopping the harness process.**
  Loading a selectable profile's model into memory as part of tier switching (FR13) **is**
  in scope; this narrows the original blanket non-goal on model management.
- Multi-user or multi-device token management, token rotation, or revocation flows.
- Offline generation. The app is useless without the Mac reachable, by design.
- Exposing physical model identity in the UI.

## Edge Cases

- `503 queue_full` — the global queue is at capacity; surface retry guidance.
- `409 seq_not_available` on resume — the service cannot serve the requested resume point;
  fall back to fetching the session and reconciling from its recorded state. The client
  treats this as cause-agnostic on purpose. The service defines three causes
  (`harness/api/generation.ts:977-989`): a non-integer or sub-`-1` seq, a seq beyond
  `last_seq`, and a seq below what is still retained. Only the first two are reachable —
  `firstRetainedSeq` is set to `0` at record creation and never mutated, so the retention
  branch is dead code held for a trimming policy that does not exist yet. The client's
  obligation is the same whichever fires, and stays correct if trimming is ever added.
- A generation exceeding its 300s wall-clock budget emits `generation_timed_out`.
- Cancelling an already-complete, failed, or cancelled generation is idempotent and returns
  that generation's actual final status.
- An empty prompt is rejected client-side before a request is made.
- The harness is offline or the tailnet is unreachable: show a clear offline state and allow
  retry without losing the drafted prompt.
- The token is rotated on the Mac, so requests begin returning `401`: prompt to re-pair.
- The app is backgrounded mid-generation and the connection is suspended: resume on return.
- A very long transcript must not break rendering.
- A cancelled generation records partial output as a turn with `cancelled: true`; the
  transcript must reflect that rather than presenting it as a complete answer.
- Two devices paired to the same session could contend; last-writer behaviour is acceptable
  and out of scope to resolve.
- **ollama is unreachable** — the loaded-tier indicator shows an explicit unknown state and
  never crashes the app or blocks prompting.
- **A model self-unloads while the app is open.** ollama evicts after roughly five minutes
  idle, so a cached belief about residency goes stale quickly; the indicator must reflect
  the change rather than assert a stale tier.
- **Warm-up fails** because the tier's model is missing or ollama errors: surface it
  clearly and do not block the human from prompting anyway.
- **A tier is switched rapidly**, several times in a row: only the last selection is warmed.
- **A real prompt is sent while a warm-up is in flight** — the prompt must not be blocked,
  queued behind, or corrupted by the warm-up.
- **A generation whose stream dies before any SSE event arrives** — recovery must still work
  from the `x-generation-id` header alone.

## Decisions / Clarifications

These were established with the human, or verified against the harness source, and should
not be re-litigated.

- **Scope is the PWA only this cycle.** The native SwiftUI app is deferred so that every
  acceptance criterion is provable on this machine. Xcode is not installed (Command Line
  Tools only), so a native app could be written but never compiled or run here.
- **Local history is retained and context is rebuilt** by replaying turns after a harness
  restart, rather than starting empty or discarding the conversation.
- **Backgrounding resumes via `Last-Event-ID`** rather than cancelling the generation. A
  disconnect does not cancel work; the API's resume endpoint exists for exactly this.
- **Multiple conversations with a list view**, not a single replaceable conversation.
- **Pairing is by QR code with the token in the URL fragment.** Fragments are never sent to
  a server, so scanning cannot leak the credential into the harness's logs, Tailscale, or
  any intermediary.
- **The API document's "Building a Client" step 5 is wrong.** It instructs clients to append
  the assistant's answer as a turn. `harness/api/generation.ts` shows the service appends
  the user turn before generating (line 719), sends the whole of `session.turns` as the
  model's messages (line 727), and appends the assistant turn on completion (line 795). A
  client that also appended turns would duplicate them and corrupt the conversation.
  `POST /turns` is for seeding history, such as the FR8 replay, not for recording
  generations.
- **Live profile ids are `reasoning-baseline`, `reasoning-capable`, and `reasoning-deep`.**
  The document's `reasoning` example is stale, which is why FR5 requires fetching them.
- **Serving the app shell unauthenticated is an accepted trade.** Any device already on the
  tailnet can fetch the HTML and JavaScript. It cannot reach the API without the token.
- The `/status` response carries no `api_version` field by design; only the header. This is
  a frozen M0 contract and not an inconsistency to work around.

### The cold-load failure — diagnosed 2026-09-02, reproduced deterministically

Recorded so no future session re-derives it. Every step was observed against the live
harness, not inferred:

1. `harness/api/server.ts:150` calls `Bun.serve` **without** `idleTimeout`, so Bun's ~10s
   default applies.
2. A cold model load writes no bytes to the SSE stream for longer than that, so Bun closes
   the connection mid-generation. Observed cutoffs were exactly **12.004s** and **20.009s**
   — the idle clock, reset by each event (`model-loading`, then `queued`).
3. On loopback this looks like a truncated HTTP 200. Through Tailscale Serve the killed
   upstream becomes **HTTP 502**.
4. The PWA mints `http_502` at `web/src/api-client.ts:473`, its fallback for any status the
   API never documented, and surfaces "Unexpected harness error (http_502)".
5. **The generation keeps running and completes normally server-side.** Polling showed
   `status=complete` with the assistant turn recorded; resuming with `Last-Event-ID: 0`
   returned the full `content` event plus `complete` with telemetry.

Measured per tier on a **cold** load: `reasoning-baseline` 3.0s (OK), `reasoning-capable`
8.3s (OK), `reasoning-deep` killed at 12s. **Warm**, `reasoning-deep` completes in 9.8s. Only
the deep tier reliably exceeds the timeout, which is why the failure looked model-specific.

### Decisions taken on this cycle's work

- **Fix in both places.** The harness `idleTimeout` addresses the root cause; the client
  recovery addresses the symptom and hardens the phone against any future mid-stream drop.
  Fixing only one was explicitly rejected: the harness fix alone leaves the phone fragile,
  and the client fix alone leaves every cold switch taking a recovery round-trip.
- **The harness repository is now generally open**, not exempted for the one `idleTimeout`
  line only. The human chose the broadest of the three offered scopes. The v1 API contract
  remains frozen (see Non-Goals) — it is the repository, not the interface, that opened.
- **Switching a tier warms it up**, rather than loading lazily on the next prompt. Readiness
  is only an answerable question at switch time if switching actually causes a load.
- **Warm-up goes directly to ollama from the host server**, not through a throwaway session
  on the v1 API. A generation through the API appends both a user and an assistant turn and
  consumes the single global generation slot; warm-up must do neither.
- **The loaded-tier view is served by our own host endpoint**, not inferred client-side.
  Inference from `load_duration_ns` (measured 0.2s warm vs 7–8s cold) was considered and
  rejected as the primary mechanism: ollama evicts after roughly five minutes, so an
  inferred belief goes stale fast and cannot see loads made by other tools.
- **Tier labels only in the UI.** The v1 API deliberately never exposes physical model
  identity ("What This API Never Exposes"), and the UI keeps that discipline even though our
  own endpoint could report more. This keeps the phone independent of which physical model
  backs a tier.
- **`ollama stop` is acceptable inside proofs.** AC12 and AC15 need a deterministic cold
  start, which means evicting the resident model. It is reversible and normal operation.

## Open Questions

None
