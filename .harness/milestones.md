# Milestones

Acceptance criteria labelled **AC<n>** are the requirements' own criteria, quoted.
Criteria labelled **(derived: FRn)** are strictly narrower, verifiable derivations of a
named functional requirement, constraint or edge case.

Criteria labelled **(chore)** are the one deliberate exception, added when M5a was inserted.
They derive from a review finding rather than from the requirements, so they prove no
requirement and must never be counted as covering one. Only a chore milestone may carry
them, and only for work a review demanded. Nothing else is a criterion.

Baseline convention: this repository has no commits, so `git rev-parse HEAD` fails on the
unborn `main` branch. M1's implementation phase makes an empty initial commit as its very
first act and records that SHA. Every later milestone records a normal SHA. The empty-tree
ref `4b825dc642cb6eb9a060e54bf8d69288fbee4904` is the fallback only if M1 is entered
without that commit having been made.

Toolchain fact for every phase: Bun 1.4.0 is installed at `~/.bun/bin/bun` and is **not on
PATH** in non-interactive shells. Node is not installed at all. Commands must either export
`PATH="$HOME/.bun/bin:$PATH"` or invoke the absolute path.




Archiving status (performed by M16-T0, at the start of M16's implementation phase, on 2026-09-02): M13 was archived. The file went 1837 -> 1452 lines; `.harness/archive/M13.md` holds the moved lines verbatim (reconciliation 1837 - 418 + 33 + 4 = 1456: 418 lines moved out, 33 lines of stub kept in their place, and 4 lines added by this archiving-status paragraph itself). **M15 is now the most recently settled milestone and is therefore protected. M16 is active; M17, M18, M19, and M14 are forward plans rather than accumulated detail.**


Archiving status (performed by M15-T0, at the start of the M15-M19 planning phase, on
2026-09-02): M12b was archived. The file went 1260 -> 1030 lines;
`.harness/archive/M12b.md` holds the moved lines verbatim (reconciliation
1260 - 276 + 39 + 7 = 1030: 276 lines moved out, 39 lines of stub kept in their place, and
7 lines added by this archiving-status paragraph itself — verified at archiving, and
corrected here after the task's own first reconciliation omitted the 7 and reported 1023
against an actual 1030). The file then grew to 1541 lines in the same phase when M15-M19
were written into it (1030 + 4 lines correcting this paragraph + 507 lines of new plan);
that growth is forward plan rather than accumulated detail and is not archivable. **M13 is now the most recently settled milestone and is therefore protected.
M12a-ii and M12c were already archived. M14 and M15-M19 are forward plans.**

Archiving status (performed by M13-T0, at the start of M13's implementation phase): M12a-ii
was archived that phase. The file went 1485 -> 922 lines; `.harness/archive/M12a-ii.md`
holds the moved lines verbatim (reconciliation 1485 - 612 + 42 + 7 = 922, verified at
archiving). **M12b is now the most recently settled milestone and is therefore protected.
M13 is active; M14 is a forward plan.**

Archiving status (last performed by the implement skill directly, on 2026-09-02, at the
human's instruction rather than as a phase task): **M12c was archived while DEFERRED, not
while settled.** It is the first archiving of a milestone that was never implemented, so
the usual "protect the most recently settled milestone" rationale does not apply to it —
there was no accumulated evidence to protect, only forward plan. The file went 1541 ->
1468 lines; `.harness/archive/M12c.md` holds the moved lines verbatim beneath a deferral
banner (reconciliation 1541 - 100 + 27 = 1468, verified at archiving).

**M12b is now the most recently settled milestone and is therefore protected. M12a-ii is
the next archive candidate** — it settled before M12b and is the largest remaining block
at 612 lines; it was already queued for the next implementation phase under M12b's
Follow-ups. M13-M14 are forward plans rather than accumulated detail. Note that the
entry below this one records M12 as BLOCKED; that is stale — M12 reached DONE and is
archived.

Archiving status (last performed by M12a-ii-T0, at the start of M12a-ii's implementation phase): M11
was archived that phase, joining M1-M10 as pointers into `.harness/archive/`.
The file went 2548 -> 1866 lines; `.harness/archive/M11.md` holds the moved lines verbatim
(reconciliation 2548 - 684 + 2 = 1866, verified at archiving). **M12 is BLOCKED and protected; M12a-i is now the most recently
settled milestone and is therefore protected; M12a-ii is active; M13-M14 are forward plans rather
than accumulated detail.** The file sits above the 400-line guidance solely because M12a-i's
detail (and active evidence) is protected; the moment M12a-ii settles and a later milestone
settles after it, M12a-i becomes the next archive candidate.

Previously (M12-T0, at the start of M12's implementation phase): M10 was archived that phase,
joining M1-M9 as pointers into `.harness/archive/`.
The file went 1927 -> 1216 lines; `.harness/archive/M10.md` holds the moved lines verbatim
(reconciliation 1927 - 742 + 23 + 8 = 1216, verified at archiving). **M11 is now the most recently
settled milestone and is therefore protected; M12 is active; M13-M14 are forward plans rather
than accumulated detail.** The file sits above the 400-line guidance solely because M11's
detail (and active evidence) is protected; the moment M11 settles and a later milestone
settles after it, M11 becomes the next archive candidate.

Previously (M9-T0, at the start of M9's implementation phase): M7 was archived that phase,
joining M1, M2, M3, M4, M5 and M6 as pointers into `.harness/archive/`.
The file went 1078 -> 755 lines; `.harness/archive/M7.md` holds the moved lines verbatim
(reconciliation 1078 - 340 + 17 = 755, verified at archiving).

Previously (M8-T0, at the start of M8's implementation phase): M6 was archived that phase,
joining M1, M2, M3, M4 and M5 as pointers into `.harness/archive/`. The file went 1026 -> 749
lines; `.harness/archive/M6.md` holds the moved lines verbatim (reconciliation 1026 - 296 +
19 = 749, verified at archiving).


## M1 — The app shell is served on the same origin as the harness API

Status: DONE

### Outcome

A page fetched from `https://ryans-mac-studio.tailc3648a.ts.net/app/` is served by this
repository's asset server, while `https://ryans-mac-studio.tailc3648a.ts.net/v1/...`
continues to reach the untouched harness on the same scheme, host and port. This is the
constraint the entire design rests on — the harness sends no CORS headers, so if the app
cannot be published on the harness's own origin, nothing else in this plan can work. It is
therefore proven first, before any client code exists.

Recon established that the mapping is currently **absent**: `tailscale serve status` shows
only `/ proxy http://127.0.0.1:7787`, and `GET https://<host>/app/` returns `401` because
the `/` handler proxies it to the harness. Adding the second handler is operator
configuration outside this repository and may require the operator to run the install
script themselves; the script must therefore be idempotent and must say clearly when the
mapping is missing rather than failing obscurely.

This milestone also establishes the repository scaffolding, the Bun toolchain and the
baseline commit convention. Those are tasks, not criteria.
Detail: `.harness/archive/M1.md`

## M2 — A prompt to the live harness streams incrementally and reports telemetry

Status: DONE

### Outcome

The walking skeleton of the client stack. A Mac-run entry point, built from the same
TypeScript modules the browser will load, creates a session against the live harness,
sends a prompt, prints assistant output incrementally as `content` events arrive, and
prints the `complete` event's telemetry. It then sends a second prompt in the same
conversation and shows the model had context from the first.

The entry point is a CLI because there is no browser under this agent's control; the
modules exercised (C5, C6, C7, C8, C9, C11) are the same ones the PWA mounts, with C11
memory-backed under test and `localStorage`-backed in the browser. **AC3 is owned here and
proven at this entry point** — incremental rendering means output written as deltas
arrive, not buffered. M9 re-exercises the same coordinator through the browser view and
does not re-own AC3.

Everything is proven against the live service.

**Resolved blocker (was: BLOCKED).** A previous phase found the live harness serving a
build predating the session routes, so `POST /v1/sessions` and every generation endpoint
returned `404 not_found`. The cause was a stale, unsupervised process (PID 32470, started
26 Aug 07:28) running code older than commit `3135f70` (27 Aug 22:02) which added the
routes. The fix required killing an operator-started process, which the sandbox denied, so
the phase escalated. The human granted permission and restarted the service from
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` at `phase1/reasoning-surface` /
`65c1fde`. The blocker is confirmed cleared by this phase's own probes (see Validation);
no code in this repository was ever at fault and none was changed by the blocked phase.

Detail: `.harness/archive/M2.md`

## M3 — A conversation's profile is chosen at runtime and drives the generation

Status: DONE

### Outcome

Profiles come only from `GET /v1/profiles` at runtime. A conversation carries a profile id,
that id can be changed, and the next generation demonstrably runs under it — confirmed by
`telemetry.profile_id` on the `complete` event rather than by the client's own claim.

The three live ids are `reasoning-baseline`, `reasoning-capable` and `reasoning-deep`
(verified during planning), but they are discovered, never written down. `reasoning-capable`
and `reasoning-deep` are `batch` latency class and may be slow; selectability for those may
be proven by admission (`200` plus an `x-generation-id` header) followed by a cancel,
provided at least one profile is carried through to a full `complete` with matching
telemetry.

Detail: `.harness/archive/M3.md`

## M4 — A generation can be cancelled and the transcript reflects it honestly

Status: DONE

### Outcome

Cancelling a running or queued generation stops output and leaves the generation in a
terminal `cancelled` state, and the locally stored transcript records the partial output as
a cancelled turn rather than presenting it as a finished answer. Proven live.

Detail: `.harness/archive/M4.md`

## M5 — A dropped stream resumes with no gaps and no duplicates

Status: DONE

### Outcome

The connection is killed mid-stream and the client reconnects to
`GET /v1/sessions/{id}/generations/{id}/events` with `Last-Event-ID` set to the last seq it
received. The union of events across both connections is a contiguous run from seq 0 to the
terminal event, with every seq appearing exactly once.

Crucially, the drop must not cancel the generation — that distinction is what FR7 exists
for, and it is checked by reading the generation's status from the service between the drop
and the resume.

Resume state (generation id and last seq) is persisted through C11 rather than held in
memory, because iOS may terminate a backgrounded page outright. That is proven by resuming
from a freshly constructed coordinator that has read nothing but persisted storage.

Detail: `.harness/archive/M5.md`

## M5a — The repository type-checks, and the resume result matches what it reconciled

Status: DONE

### Outcome

A chore milestone clearing the three `OPTIONAL` findings from M5's cycle-1 review. It adds
no user-facing behaviour and completes no requirement on its own; it exists because two of
the three are invisible where they were recorded, and the third hides future defects.

The substantive item is that **this repository has no working whole-project type check**.
`bunx tsc --noEmit` fails with ~130 errors that are all declaration-resolution noise —
`node_modules` is absent, no Bun or Node type package is declared, and `.ts`-extension
imports are not permitted by `tsconfig.json`. None are semantic errors under `web/src/`, but
that is exactly the problem: a genuine type error in the client would be indistinguishable
from the noise, and would stay invisible through the final review, whose broadest validation
is otherwise `bun test`. Turning the check on may surface real errors, which is the reason
this runs through the harness with a review rather than being fixed by hand.

The second item is a latent trap rather than a live bug. On the `seq_not_available` fallback
path, `web/src/session-coordinator.ts:379-388` returns `text: pending.partialText` — the
text held before the drop — while `reconcileTurnsFromSnapshot`, called two lines earlier,
has already written the correct full text into the store. Nothing reads the field today
because C10 does not exist. A UI that renders `ResumeResult.text` after a fallback recovery
would show stale partial content while the correct answer sat in `conversation.turns`. The
field is corrected at source rather than documented as a hazard.

The third is a test gap with no defect behind it. A drop before any SSE event arrives leaves
`pending.lastSeq = -1`, so a resume sends `Last-Event-ID: -1`. That was checked against the
service and is **correct**: `harness/api/generation.ts:975-976` defines `-1` as the valid
floor meaning "I hold nothing", `harness/api/router.ts:325-331` accepts it, and the harness's
own `create` calls `subscription(record, -1)`. The client interoperates properly and needs no
change — only a test, because no unit test and no live-proof phase reaches the path (the
proof always aborts after 3 content deltas, so `lastSeq` is never below 0 in any observed
run).

Detail: `.harness/archive/M5a.md`

## M6 — A conversation survives losing its server session

Status: DONE

### Outcome

A prompt sent against a session the service no longer holds returns `404 unknown_session`.
The client creates a fresh session, replays the locally stored transcript via
`POST /v1/sessions/{id}/turns`, and continues the conversation with its context restored.

**How the `404` is induced.** Restarting the harness process is an explicit non-goal
("Managing models or the harness process itself"), so the agent must not restart it. The
API contract defines `unknown_session` as "Session id does not exist **or was lost on
service restart**" — the two are indistinguishable to a client, and the recovery path is
identical. The live proof therefore drives a stored conversation at a session id the
service does not hold. If the operator wants confirmation across a genuine restart, that is
a human-attested extra and is recorded as such; it is not this milestone's mechanical proof.

Detail: `.harness/archive/M6.md`
## M7 — Documented harness errors are surfaced meaningfully, not generically

Status: DONE

### Outcome

Every documented failure the client can meet becomes its own typed error carrying its own
user-facing guidance, so that no documented condition falls through to a generic failure.

**What is proven live and what is proven from the contract.** AC9 is induced live: a second
generation on a session that already has one admitted returns `409 generation_in_flight`.
`queue_full` and the six SSE error codes cannot be induced on demand against a single-user
service without abusing it, so their handling is proven by decoding the payload shapes the
API contract documents. That is a real check of the decoder, and the milestone says so
rather than implying live proof it did not obtain.

Detail: `.harness/archive/M7.md`
## M8 — Conversations are created, listed, opened and deleted, and survive a reload

Status: DONE

### Outcome

The local conversation store becomes the durable spine of the app: many conversations,
newest first, each backed by exactly one server session, each with its full transcript
persisted locally. Persistence is what makes M6's replay possible, so this milestone
proves the store rebuilds correctly from storage alone rather than from anything held in
memory.

Exercised through the coordinator and store from a CLI entry point against the live
harness, so that a created conversation's session id is a real one.

Detail: `.harness/archive/M8.md`

## M9 — The chat view and conversation list drive the client in the browser

Status: DONE

### Outcome

The browser UI: a conversation list and a chat view that translate user actions into
coordinator calls and render streamed deltas, queue position, the model-loading state and
completion telemetry.

**What this agent can and cannot prove.** There is no browser under the agent's control —
no Node, no Playwright, and the only iOS device is the human's. The mechanical proof is
therefore confined to the layer that does not need a DOM: the view-model is a pure function
from store and coordinator state to what should be displayed, unit-tested headlessly, and
the bundle is proven to build and to load without throwing when mounted against injected
state. What the browser renders is attested on the device in M10. The design consequence is
deliberate: keep the DOM glue thin enough that the attested part is small.

Detail: `.harness/archive/M9.md`


## M10 — The app installs to the iOS home screen and runs standalone

Status: DONE

### Outcome

The PWA shell — manifest, icons, service worker — plus the launch agent that keeps the
asset server alive, so the app is there whenever the phone is picked up.

**AC10 is human-attested.** Installing to the iOS home screen and observing standalone
display can only be done by the human on the physical iPhone; the agent cannot self-certify
it and must not be recorded as having done so. What the agent proves mechanically, and what
a reviewer should hold it to, is everything that would make the install fail: the manifest
parses and declares what iOS needs, every icon it names actually resolves at the served
origin, the service worker registers with a versioned cache and a network-first shell
strategy so a rebuilt bundle is not pinned behind a stale cache, and the launch agent
brings the asset server back after it dies.

The reviewer signs off the mechanical criteria on evidence. AC10 is signed off only on the
human's recorded attestation, and stays unchecked until that attestation exists.

Detail: `.harness/archive/M10.md`

## M11 — Scanning the QR code pairs the phone with the harness

Status: DONE

### Outcome

The Mac-side pairing CLI renders a QR code encoding
`https://ryans-mac-studio.tailc3648a.ts.net/app/#t=<token>`. The token sits in the URL
fragment specifically because fragments are never transmitted to a server, so scanning
cannot leak the credential into the harness's logs or Tailscale's. The PWA captures the
token from `location.hash`, persists it, and clears the hash immediately.

The token is read from `~/.openweight-harness/token` (honouring
`OPENWEIGHT_HARNESS_TOKEN_FILE`), and reading is refused outright if the file is group- or
world-readable — a disclosed credential should stop the tool, not be used anyway. The live
file is currently mode `0600`, so the refusal path is proven against a fixture file created
with looser permissions, not by changing the real one.

**AC2 is split by what is provable.** The camera scan itself is human-attested: only the
human can point an iPhone at the terminal. Everything either side of the camera is proven
mechanically — the QR round-trip (AC1), and the credential store's behaviour given the
pairing URL's fragment: it extracts the token, persists it through C11, clears the
fragment, and a subsequent call to the live harness with the stored token returns `200`.
A reviewer is therefore asked to sign off an attestation covering only the optical step.

Pairing comes last because it needs the app already served at `/app` (M1) and installable
(M10) for a scan to land somewhere useful.

Detail: `.harness/archive/M11.md`

## M12 — Typing a prompt on the phone drives a conversation end to end

Status: DONE

### Outcome

The client becomes usable on the device. Today `web/src/ui/dom-target.ts` paints four
read-only regions and `web/src/main.ts` discards the handle `mount()` returns, so the served
app is a static painting: no prompt input, no send or cancel control, no profile selector, no
create/open/delete affordance, and nothing subscribed to C9's progress so nothing repaints
when deltas arrive. Every layer beneath the DOM already exists and is proven — M9 built the
pure view-model and the actions map and reviewed them headlessly; this milestone wires them
to real controls and real events.

This is a coverage gap between milestones rather than a defect in one. M9's third criterion
covers the *actions map* mapping one-to-one onto coordinator calls, tested headlessly, and it
does. DOM event wiring was outside M9's criteria, outside M10's packaging scope, and outside
M11's pairing scope — so after M11 the phone would still have no way to start a conversation,
while FR3 ("create, open, and delete") and FR4 ("send a prompt") are user-facing.

**No architecture change.** C10's agreed responsibility is already "Render the conversation
list and chat view, **and translate user actions into coordinator calls**"
(`architecture.md:142`), realising FR3, FR4, FR5, FR6, FR9. This milestone builds the second
half of a component that was only half built.

**Every acceptance criterion here is derived.** All eleven of the requirements' own ACs are
owned by M1-M11, so this milestone proves no AC on its own and must never be recorded as
covering one. It closes the distance between criteria that are already checked and an app a
human can actually use.

**Settled decision — `happy-dom` is a devDependency for the DOM tests.** `dom-target.ts` is
the only module permitted to touch the DOM and currently has no test file at all. The human
agreed to `happy-dom` over a hand-rolled fake `Document` on 2026-08-31: this milestone is
almost entirely event wiring, and a fake that hand-waves event dispatch would prove the thing
least likely to be right. It is test-only and never bundled, so the architecture's "ship no
third-party code" mitigation for the `localStorage` token is unaffected. It is the
repository's first non-type dependency, which is why it needed agreement. Do not re-litigate
this; do not let it reach the shipped bundle.

**It runs after M11**, because the live criterion needs a token the pairing flow stores.

Detail: `.harness/archive/M12.md`


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

Detail: `.harness/archive/M12a-i.md`


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


Detail: `.harness/archive/M12a-ii.md`
## M12b — Changing a conversation's profile actually changes it

Status: DONE

### Outcome

**Found by the human on the device, on 2026-09-01, after M12's cycle-2 review had already
returned PASS.** The profile selector is inert from the user's point of view: picking a
different profile leaves the app showing the old one, so the human reported being "stuck on
Fast reasoning".

This milestone exists because the human chose to **defer** the fix rather than override M12's
spent review/fix cap. It is not new scope: FR5 requires that "Profile is selectable per
conversation and changeable", and M12's criterion 1 already covers the profile selector. M12 is
therefore settled on its own recorded criteria and this repairs a requirement it left unmet. It
**runs before M13**.

**The defect is the same one M12's fix cycle already repaired twice, in the one place it did not
apply the correction.** `web/src/ui/dom-target.ts`'s profile `change` handler calls

```ts
deps.actions.chooseProfile(selectedConversationId, selectedProfileId);
```

with no `await`, no `render()`, and no `.catch()` — exactly the shape that BLOCKER 1 fixed for
`create-conversation` and `delete-conversation`. Verified downstream while diagnosing:
`session-coordinator.ts`'s `setProfile` (line 602) delegates to `conversation-store.ts`'s
`setProfileId`, which does mutate `profileId`, stamp `updatedAt` and `persist()`; and
`dom-target.ts`'s `paint` rebuilds the `<option>` list marking `view.selectedProfileId`
(`view-model.ts:123`, `selectedConversation?.profileId`). So the write lands, but nothing
repaints at the moment of change and any rejection is unhandled.

**Why two agent reviews passed over it.** The tests assert that the `change` event *dispatches*
`chooseProfile` with the right arguments — not that the selection is *reflected* afterwards.
This is the same lesson M12 recorded in blood and did not finish applying: **evidence that an
action was invoked is not evidence that it took effect.** Any test written here must fail if the
repaint is removed.

Detail: `.harness/archive/M12b.md`
## M12c — The app reads as a phone chat app, not a debug page

Status: DEFERRED

### Outcome

**Deferred by the human on 2026-09-02** — "we will do a UI pass in a future milestone."
A planning decision, not a defect and not a review outcome. Nothing was implemented.

The client presents FR3's conversation list and FR4's streamed transcript as stacked
bullet lists — a debug rendering of a working client. This milestone would have changed
that presentation only: it **adds no capability and removes none**, so deferring it leaves
**no requirement unmet**. FR3 and FR4 are built, reviewed and attested.

The settled design decisions (slide-over drawer rather than a permanent left column;
hand-written CSS, no third-party code) and the M13 sequencing analysis are preserved in
the archive. With M13 now running first, its long-transcript guard lands before any
bubble rewrite, so the future UI pass arrives on already-protected code.

**The loop skips DEFERRED and proceeds to M13.** Do not treat this as BLOCKED — there is
no escalation contract to honour and nothing to unblock. When the UI pass is taken up, it
should be entered as a fresh milestone superseding this one, not by flipping this status
back to TODO: the archived criteria were written against a pre-M13 renderer.

Detail: `.harness/archive/M12c.md`


## M15 — A cold model load no longer kills the stream

Status: DONE

### Outcome

The root-cause half of the cold-load failure the human diagnosed on 2026-09-02. The
harness's `Bun.serve` sets no `idleTimeout`, so Bun's ~10s default applies and closes the
SSE connection mid-generation whenever a model load writes no bytes for longer than that.
Observed cutoffs were exactly 12.004s and 20.009s. Through Tailscale Serve the killed
upstream becomes an HTTP 502, which the PWA mints as `http_502` and surfaces as
"Unexpected harness error" — while the generation keeps running and completes normally
server-side.

**This is the first milestone in this project to modify a second repository.** The
constraint forbidding changes to `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` was
reversed by the human on 2026-09-02. The v1 API contract remains frozen: this milestone
adds no endpoint, changes no response shape, and alters no documented semantics. It sets
one server option.

**The change must be revertible on its own.** `M16` proves AC14 by reverting exactly this
change and showing the client still recovers, so C17 is deliberately a separate component
from C16 (the FR12 resolver route, which lands in `M17` and touches the same file). If
these two harness changes become entangled, AC14 stops being falsifiable. Keep the
`idleTimeout` edit to a single, independently revertible hunk and record how to revert it.

**Do not re-derive the diagnosis.** The requirements' `### The cold-load failure` section
records every observed step, the measured per-tier cold-load times
(`reasoning-baseline` 3.0s, `reasoning-capable` 8.3s, `reasoning-deep` killed at 12s), and
the reason 255s was chosen: it is Bun's maximum and sits below the 300s generation
wall-clock budget, so the generation timeout stays the governing limit rather than the
socket.

`ollama stop` is explicitly permitted inside the proof to force a deterministic cold start.

### Architecture

C17 — Harness Stream Timeout. Realised, in the external repository.

No component in this repository changes. If the harness's `Bun.serve` call site has moved
from `harness/api/server.ts:150`, record that under `## Deviations` in
`.harness/architecture.md` with `Material: no`.

### As-Built

`.harness/as-built/M15.md` — RECORDED. C17 realised entirely in the external repository, no
component in this repository changed, **no claim mismatches**. It observed that the
`Bun.serve` call site moved from `server.ts:150` to `:182`; that is now recorded under
`## Deviations` in `.harness/architecture.md`, `Material: no`.


### Acceptance Criteria

- [x] **AC13** — With `idleTimeout` set, the request that previously died at 12s delivers
      `content` and `complete` **in-band**, on the original connection, without resuming.
- [x] **AC12** — With a **cold** load of `reasoning-deep` forced deterministically, a prompt
      sent from the client completes with its output rendered and **no error surfaced**.
- [x] **(derived: FR11)** The harness's `Bun.serve` sets `idleTimeout` to exactly **255**
      seconds — below the 300s generation wall-clock budget, so the generation timeout
      remains the governing limit rather than the socket. Proven by reading the value the
      running server was configured with, not only by reading the source.
- [x] **(derived: FR11, Constraints)** The v1 API contract is untouched: no endpoint added,
      removed or renamed, no response shape or documented semantic changed. Proven by
      diffing the harness change and by re-running this repository's existing live proofs
      (`proof:m2`, `proof:m7`) green against the modified harness.
- [x] **(derived: FR11, AC14 precondition)** The change is revertible as a single isolated
      hunk: reverting it and restarting the harness reproduces the original 12s cutoff on a
      cold `reasoning-deep` load. This is what makes `M16`'s AC14 falsifiable, so it must be
      demonstrated here rather than assumed.

### Baseline

**Two repositories.** Both read at 2026-09-02, before any task ran:

- `/Users/ryankenny/Projects/phoneToLocalModel` — `052db73fb28be6aff2699a57b5bdf2678d286fe9`
  on `main`. Working tree carries the usual uncommitted project files (45 untracked).
- `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` —
  `65c1fdee1b01ebe288456dfeaa74af083bcc9dfe` on `phase1/reasoning-surface`, working tree
  **clean**. This clean baseline is what makes the harness half of the diff, and the
  revert demonstration, unambiguous.

The review for this milestone must diff **both** baselines.

### Evidence

**Repository `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` (C17 — Harness Stream Timeout):**

- `harness/api/server.ts` — modified. Adds the exported constant
  `HARNESS_IDLE_TIMEOUT_SECONDS = 255`, passes `idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS`
  to `Bun.serve`, mirrors the same constant onto the `ApiSurfaceHandle` returned by
  `startApiSurface` as `readonly idleTimeout: number`, and corrects the module header
  comment. The header previously asserted this `Bun.serve` was configured *exactly* as
  `harness/security/auth/surface.ts`; it now carries a `THE ONE DIVERGENCE` paragraph
  naming the divergence, why it exists, and **exactly which lines to remove to revert it**.
- `harness/api/idle-timeout.test.ts` — new. Starts a real surface on an ephemeral port and
  asserts the started handle reports `idleTimeout === 255`, that the constant is `255`, and
  that the surface still answers an authenticated request with `x-api-version` stamped.
- `harness/security/auth/surface.ts` — **deliberately unchanged.** The M0 auth surface keeps
  Bun's default idle timeout. It is not the surface the phone streams from, and widening the
  change to it would have destroyed the single-hunk revertibility `M16`'s AC14 depends on.
- Verified working tree at the end of this phase: exactly `M harness/api/server.ts` and
  `?? harness/api/idle-timeout.test.ts`. No third file.

**Repository `/Users/ryankenny/Projects/phoneToLocalModel`:**

- `src/host/m15-proof.ts` — new (**1196 lines**; 784 after `T2b`, extended to 1196 by `T3`).
  The live proof. `T3` added the `REVERT-CONTROL` phase and the shared `runProbeGeneration`
  helper, plus the `REVERT_BASELINE_COMMIT` constant. The addition is purely additive: the
  verifier diffed the pre-`T3` snapshot against the current file and confirmed no existing
  phase, threshold or `allPassed` fold was weakened or removed.
- `package.json` — one added line: `"proof:m15": "bun run src/host/m15-proof.ts"`.
- `web/src/` — **untouched.** Confirmed by re-checking the four invariants `M16`'s entry
  records as its own preconditions: `resumeIfInterrupted` still has **zero** production call
  sites (only its definition in `session-coordinator.ts` and the pass-through in
  `ui/actions.ts` that `M16` already documents); no `visibilitychange`/`online`/`focus`/
  `pageshow` listener anywhere; no `setTimeout`, `backoff` or `reconnect`; no `reconnecting`
  UI variant. **AC14 therefore remains falsifiable — M15 implemented none of M16's half.**

**Why the deep tier is selected by measurement, not by name.** The acceptance criteria name
`reasoning-deep`, but `test/no-hardcoded-profile-ids.test.ts` forbids that literal anywhere
under `src/`, and the live catalogue turned out to give **two** profiles
`latency_class: "batch"` (`reasoning-capable`/"Balanced reasoning" and
`reasoning-deep`/"Deep reasoning"), with `quality: "capable"` on both — no API-exposed field
distinguishes them. The proof therefore sweeps every batch-class profile, forces its own cold
start before each, and identifies the tier that previously died as the one whose **measured
idle gap exceeds 10.0s**, printing its id and label as evidence. On both independent runs
that resolved to `reasoning-deep`. This is a stricter reading of AC13 than a name match: it
asserts the property the criterion is actually about.

### Validation

Toolchain: Bun 1.4.0 at `~/.bun/bin/bun`, not on PATH in non-interactive shells; no Node.

**Task M15-T1 — the harness change.** Verified independently by a verifier that re-ran
everything from `/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`:

| Command | Exit |
| --- | --- |
| `bun test harness/api/idle-timeout.test.ts` | 0 (3 pass) |
| `bun test harness/api/server.test.ts` | 0 (20 pass) |
| `bun test harness/api/api-doc-correspondence.test.ts` | 0 (15 pass) |
| `bun run check:documented` | 0 |
| `bun run check:boundary` | 0 |

The last three are the harness's own v1-contract guards. `Tests Weakened: NO` — no existing
test was edited; only a new file was added.

**Tasks M15-T2 / M15-T2b — the live proof.** `bun run proof:m15` exit **0**, re-run
independently by a verifier against the live harness (its numbers differ from the
implementer's, as expected of a live run; the thresholds held on both):

```
PHASE RESTART   PASS  old pid 18544 SIGTERMed, replacement pid 18628,
                      GET https://ryans-mac-studio.tailc3648a.ts.net/v1/profiles -> 200
                      in 1.1s (so the Tailscale Serve path came back up too)
PHASE READBACK  PASS  harness/api/idle-timeout.test.ts exit 0 — a really-started
                      Bun.serve surface reports idleTimeout === 255
PHASE AC13      PASS  reasoning-capable "Balanced reasoning": model-loading,content,complete
                        elapsed 10.680s, largest idle gap 10.659s, 1 generate, 0 resume
                      reasoning-deep    "Deep reasoning":     model-loading,content,complete
                        elapsed 17.089s, largest idle gap 17.005s, 1 generate, 0 resume
                      TIER IDENTIFIED BY MEASUREMENT: reasoning-deep (17.005s > 10.0s)
PHASE COLD      PASS  ollama stop qwen3.6:27b; ollama ps confirms no model resident
PHASE AC12      PASS  final generation state {"kind":"complete", telemetry ...}
                      elapsed 22.098s, largest idle gap 21.606s
                      notice "" (empty); assistant text "ready" found in the RENDERED DOM
                      "http_502" absent everywhere
M15 LIVE PROOF: PASS
```

| Command | Exit |
| --- | --- |
| `bun run proof:m15` | 0 |
| `bun test test/no-hardcoded-profile-ids.test.ts` | 0 |
| `bunx tsc --noEmit -p tsconfig.json` | 0 |

**How AC13's three claims are actually proven, not asserted:**

- *In-band, without resuming* — from the **recorded request log**, not from "we did not call
  `resumeIfInterrupted`". The proof wraps `fetch` and prints every URL issued. Per candidate:
  `POST /v1/sessions` and `POST /v1/sessions/{id}/generate`, and nothing else. Zero requests
  to a resume/events endpoint.
- *Across an idle gap that would have killed the old connection* — gaps are measured from
  real event-arrival timestamps, with request-start counting as the first interval's start.
  17.005s and 21.606s were observed; the old Bun default was ~10s and the recorded failures
  were 12.004s and 20.009s.
- *The proof can fail* — `allPassed` is `&&`-folded across every phase and mapped to
  `process.exit(0|1)` (`src/host/m15-proof.ts:771-783`); the >10.0s threshold and the
  `content`+`complete` requirement are hard assertions, and the first attempt of this proof
  genuinely exited 1.

**Ollama was left cold** (`ollama stop`, permitted by the requirements for a deterministic
cold start), and the live harness was left **running and healthy** on the fixed code.

**Task M15-T3 — the revert / negative control.** Independently verified: a verifier re-ran
`bun run proof:m15` end to end itself (four fresh cold loads of `qwen3.6:27b`, 34 GB) rather
than reading the implementer's log.

The `REVERT-CONTROL` phase runs the **pre-fix** harness from a detached git worktree at
`65c1fdee1b01ebe288456dfeaa74af083bcc9dfe`, on a runtime-chosen ephemeral loopback port, so
the live service on 7787 is never touched. It first proves the revert really is one hunk,
then runs a cold A/B on the tier AC13 identified by measurement:

```
single-hunk precheck
  grep -c "idleTimeout" <worktree>/harness/api/server.ts -> 0        PASS
  git diff --stat HEAD -> harness/api/server.ts | 55 +++++---        (1 file changed)
  git status --porcelain -> " M harness/api/server.ts"
                            "?? harness/api/idle-timeout.test.ts"
  exactly one tracked file modified                                   PASS

A/B on id="reasoning-deep" label="Deep reasoning", cold before each, B run first

  metric                | B (reverted, cold)              | A (fixed, cold)
  events, in order      | model-loading                   | model-loading,content,complete
  stream ended at (s)   | 12.000                          | 17.331
  saw content           | false                           | true
  saw complete          | false                           | true
  largest idle gap (s)  | n/a (killed before completing)  | 17.245
  stream error          | "The socket connection was      | <none>
                        |  closed unexpectedly."          |

  B: ended without `complete` at 12.000s, inside the (5s, 60s) band  PASS
  A: content + complete, largest idle gap 17.245s > 10.0s            PASS

  worktree remove --force -> exit 0, "Worktree removal SUCCEEDED."
  live 7787: pid before=19351 after=19351, GET /v1/profiles -> 200   PASS
PHASE REVERT-CONTROL: PASS
```

**B reproduced the cutoff at 12.000s** — against the 12.004s the human originally recorded.
That is the whole point of the phase: the failure is reproduced on demand from the reverted
code, so `M16`'s AC14 is falsifiable by construction rather than by assertion. A and B differ
only in which tree the server was started from; same tier, same prompt, cold both times, and
B was run first so an unexpectedly fast load could not be spent on A. On loopback the killed
stream is a truncated 200 (socket closed after `model-loading`, no `complete`), not the 502
seen through Tailscale Serve — the shape the requirements predicted.

The phase is designed to **fail** if B completes normally, with an explicit "the negative
control did not reproduce the cutoff" message. It was not softened; the assertion is intact
in `src/host/m15-proof.ts`.

| Command | Exit |
| --- | --- |
| `bun run proof:m15` (with REVERT-CONTROL) | 0 — `M15 LIVE PROOF: PASS` |
| `bun test test/no-hardcoded-profile-ids.test.ts` | 0 (1 pass) |
| `bunx tsc --noEmit -p tsconfig.json` | 0 |

Post-run state, checked by the verifier and re-checked by the orchestrator: the harness repo
is still at `65c1fde` with exactly `M harness/api/server.ts` and
`?? harness/api/idle-timeout.test.ts`; `git worktree list` shows only the main worktree (no
leftover temporary one); the live harness answers 200 through Tailscale Serve.

**The v1-contract criterion — this repository's half.** Re-run by the orchestrator against
the modified harness, after `T3`:

| Command | Exit |
| --- | --- |
| `bun run proof:m2` | 0 — `M2 LIVE PROOF: PASS` (AC3, AC4, AC5, FR4 all PASS) |
| `bun run proof:m7` | 0 — `M7 LIVE PROOF: PASS` (phases A-E; 10 HTTP + 6 SSE error codes) |

`proof:m7` is the sharper of the two here: it asserts every documented HTTP and SSE error
code still maps to its own typed error, so a silent change to a response shape or a
documented semantic would fail it. Together with the harness-side guards already recorded
above (`check:documented`, `check:boundary`, `api-doc-correspondence.test.ts`, all exit 0)
and a harness diff of exactly two files, the v1 contract is evidenced as untouched from both
sides.

**AC14 falsifiability re-confirmed by the orchestrator at the end of this phase**, absolutely
rather than diff-relatively: under `web/src`, `resumeIfInterrupted` has **zero production
call sites** (only its definition at `session-coordinator.ts:503`, its type declarations, its
export, and the documented pass-through at `ui/actions.ts:44-45`), and there is **no**
`visibilitychange`/`online`/`focus`/`pageshow` listener and **no** `backoff`/`reconnect`
match anywhere. `M15` implemented no part of `M16`.

### Tasks and routing

| Task | Tier | Reason for going above Cheap | Outcome |
| --- | --- | --- | --- |
| T1 — harness `idleTimeout` (C17) | Mid, attempt 3 | not low risk: edits a security-reviewed, live external API surface whose header encodes invariants, and the hunk must stay independently revertible | PASS |
| T2 — live proof `m15-proof.ts` | Mid, attempt 3 | not easily verified: a live proof is its own oracle and is the sole evidence for AC12/AC13 | **FAIL** — the *packet* was wrong, not the work: it said "select the deep tier as the one profile with `latency_class: batch`" and the live catalogue has two. The worker refused to invent a different discriminator and failed the phase, which is the correct behaviour. RESTART/READBACK/COLD passed. |
| T2b — corrected selector | Mid, attempt 3 (corrected packet, not a ladder rung) | same as T2 | PASS |
| T3 — revert/negative control | Mid, attempt 3 | not low risk: spawns extra harness instances and manipulates git worktree state beside a live service | PASS |

### Review

**Cycle 1 — PASS.** Reviewer tier **sonnet**, matching the highest tier that produced the
work (Mid; every task T1/T2b/T3 ran at Mid). Fresh context, whole-milestone scope, both
baselines diffed.

All five acceptance criteria returned a per-criterion row and every row was `PASS`. One
`OPTIONAL` finding, recorded under `### Follow-ups`; no `BLOCKER` and no `IMPORTANT`, so the
completion gate opened without a fix cycle.

Validation the reviewer re-ran itself rather than crediting: `bunx tsc --noEmit` (exit 0),
`test/no-hardcoded-profile-ids.test.ts` (1 pass), and in the harness repository
`idle-timeout.test.ts` (3 pass), `server.test.ts` (20 pass),
`api-doc-correspondence.test.ts` (15 pass), `check:documented` and `check:boundary` (both
OK). It independently re-derived the AC14 falsifiability invariant (`resumeIfInterrupted`
zero production call sites; no `visibilitychange`/`online`/`focus`/`pageshow` listener, no
backoff or reconnect, in `web/src`), confirmed `git worktree list` shows no leftover
worktree, and confirmed `harness/security/auth/surface.ts` is untouched.

**Disclosed judgment call: the reviewer did NOT re-run `bun run proof:m15`.** It read all
1196 lines of the proof instead, verifying the gating logic directly — that
REVERT-CONTROL's "control completed normally" branch sets `revertControlPassed = false`
rather than warning, that A and B differ only in which tree the server starts from, and
that the `allPassed` fold gates `process.exit`. It weighed that against restarting the live
harness the phone depends on and forcing four cold loads of a 34 GB model. The verdict
therefore rests on static verification of the proof plus independently reproduced cheaper
checks, not on an independent execution of the live proof itself.

### Review Cycles
0

### Remaining Work

None. All three tasks (`T1`, `T2`/`T2b`, `T3`) are complete and independently verified, and
every acceptance criterion has recorded evidence. This phase set `Status: REVIEW` and
returned without invoking the reviewer.

**Operational facts worth not rediscovering.** The live harness binds `127.0.0.1:7787` with
**no** `OPENWEIGHT_HARNESS_*` environment overrides; `tailscale serve` proxies
`https://ryans-mac-studio.tailc3648a.ts.net/` to it and `/app` to `127.0.0.1:7788`.
`proof:m15` restarts it itself and is idempotent, so re-running it is safe; it now takes
roughly ten minutes because it forces **four** real cold loads of a 34 GB model. Each run
replaces the live pid (19351 as of the end of this phase), which is expected.
`test/build.test.ts` deletes `web/dist` in its `afterEach`, so run `bun run scripts/build.ts`
after any full `bun test`.

**For the reviewer.** Diff **both** baselines recorded above. The harness half is
`git -C /Users/ryankenny/Projects/OpenCodeOpenWeightHarness diff HEAD` plus the untracked
`harness/api/idle-timeout.test.ts`; this repository's half is `src/host/m15-proof.ts` (new,
untracked) and one added `package.json` line.

### Follow-ups

- **Cycle-1 `OPTIONAL` finding, recorded NOT taken — the 255 readback is self-referential.**
  `harness/api/idle-timeout.test.ts` starts a real `Bun.serve` surface and reads
  `idleTimeout === 255` off the handle `startApiSurface` returns, but that field is
  populated by mirroring the same `HARNESS_IDLE_TIMEOUT_SECONDS` constant passed to
  `Bun.serve`. `Bun.Server` exposes no `idleTimeout` getter, so nothing independently
  queries Bun's internal socket state: the test proves the two sites agree with each other,
  not that Bun honoured the value. A future edit changing one literal and not the other
  would pass it.

  The behavioural evidence is real but cannot pin the number — AC13 and REVERT-CONTROL show
  the live socket surviving 16-21s idle gaps where the reverted code dies at 12.000s, which
  proves the timeout is now *much larger than the old default*, not that it is *exactly
  255*. The "exactly 255" half of the derived criterion rests on source-level consistency.

  The reviewer rated it OPTIONAL and non-blocking, calling it the best proof available given
  a genuine Bun API limitation. Its suggestion (b) — spread one object literal into both the
  `Bun.serve` options and the handle, making agreement structural rather than coincidental —
  is a small change worth taking if `server.ts` is touched again. Recorded here rather than
  implemented, under scope discipline: M15's criteria are met and the finding was not
  blocking.


- **The v1 profile catalogue cannot identify the deep tier by any exposed field.**
  `reasoning-capable` and `reasoning-deep` share `latency_class: "batch"` *and*
  `quality: "capable"`, so of the five fields `/v1/profiles` exposes (`id`, `role`,
  `quality`, `latency_class`, `label`) only `id` and `label` are unique — and `id` literals
  are banned from `src/` by `test/no-hardcoded-profile-ids.test.ts`. `M15` worked around this
  by selecting the tier by measured cold-load gap, which is fine for a proof but is not a
  mechanism the app could use. `M18` ("the phone shows which tier is loaded") will meet the
  same wall. Worth a human decision then, not now — it is a v1-contract question and the
  contract is frozen for this milestone.
- **`reasoning-capable`'s cold load is now borderline.** It measured 8.12s on one run and
  10.66s on another, straddling the old ~10s default. That means the pre-fix failure was
  intermittent for the balanced tier too, not deep-tier-only as the diagnosis recorded.
  No action; recorded because it strengthens the case for the fix rather than weakening it.
- **`.harness/milestones.md` is 1643 lines and archiving cannot currently reduce it.** Every
  settled milestone except `M13` is already a `Detail:` pointer, and `M13` (417 lines) is the
  most recently settled, which the archiving rule protects. It becomes archivable as soon as
  `M15` settles.


## M16 — A dropped stream during a live generation recovers instead of erroring

Status: IN_PROGRESS

### Outcome

The client half of the same failure, and the hardening that makes the phone survive any
future mid-stream drop. The human explicitly rejected fixing only one side: the harness fix
alone leaves the phone fragile, the client fix alone leaves every cold switch taking a
recovery round-trip.

**Recon performed at planning time, 2026-09-02 — most of FR10 is genuinely missing, but
some of it is already built. Do not re-implement what works.**

Already satisfied, with proof:

- `generate()` reads `x-generation-id` from the response header before the stream is pulled
  (`web/src/api-client.ts:559`), and `send()` writes it to the store with `lastSeq: -1`
  immediately, so a resume point exists even when zero SSE events arrived.
- The `Last-Event-ID` resume machinery works end to end, including the `seq_not_available`
  snapshot fallback (`web/src/session-coordinator.ts:503-596`).
- A transport drop deliberately leaves `pending` in place rather than clearing it
  (`web/src/session-coordinator.ts:347-367`, and the comment at `:68-81`).

Missing, and what this milestone builds:

- **`resumeIfInterrupted` has zero production call sites.** It is exported through
  `web/src/ui/actions.ts` and called only by tests. There is no `visibilitychange`,
  `online`, `focus` or `pageshow` listener anywhere in `web/src`. The resume point is
  preserved but nothing ever consumes it, so a drop is still a thrown error.
- **A failing HTTP status never reads the generation id.** `handleResponse` throws at
  `web/src/api-client.ts:556`, before the `headers.get("x-generation-id")` at `:559`. On a
  502 from `generate()` the header is never read, no pending record is written, and
  `HarnessApiError` has no field to carry a generation id. `api-client.ts:473` mints
  `http_${status}` unconditionally.
- **No backoff, no retry loop, no wall-clock budget.** There is no `setTimeout` or delay
  anywhere in `web/src`. The only `300` in client code is a display string at
  `api-client.ts:196`.
- **No reconnecting UI state.** `GenerationDisplay` (`web/src/ui/view-model.ts:12-20`) has
  no such variant. The nearest state, `offline`, is a terminal manual-retry surface whose
  Retry button starts a **brand-new generation** rather than resuming the in-flight one —
  and an `http_502` does not even reach it, falling through to
  `setNotice(describeError(error))`.

**Two existing behaviours must NOT be weakened, and a worker will be tempted to weaken
both.** Scope the change to "a status received while a generation is known to be in
flight":

1. `src/host/m7-proof.ts` Phase C (`:458-509`) asserts an **undocumented SSE error code on
   a 200 response** maps to `documented: false` / `action: "report"`. That is a different
   thing from an undocumented HTTP status and must keep passing unchanged.
2. `test/web/api-client.test.ts:899-940` locks `error.code === "http_500"` for a 500 with no
   usable error body, with no generation in flight. That is correct behaviour and stays.

### Architecture

C6 — SSE Reader, C7 — API Client, C9 — Session Coordinator, C10 — UI. Advanced, not
completed; all four already exist.

No new component. If recovery turns out to need a seam the architecture does not describe,
record it under `## Deviations` in `.harness/architecture.md` before this milestone
completes, and stop for human agreement if it moves a responsibility between components.

### As-Built

### Acceptance Criteria

- [ ] **AC14** — The client recovers **independently of the harness fix**: with the harness
      `idleTimeout` change reverted, a killed stream still yields the full answer via resume.
      The two fixes must be separately falsifiable, so that neither can mask the other's
      regression.
- [ ] **(derived: FR10)** An **undocumented gateway status** — specifically `502` — received
      while a generation is known to be in flight is treated as a **resume trigger**, not a
      terminal error. It never surfaces as `http_502` or "Unexpected harness error" while
      the generation is still recoverable. The generation id needed to resume is taken from
      the `x-generation-id` **response header of the failing response**, so recovery works
      having received **no SSE event at all**.
- [ ] **(derived: FR10)** Recovery **retries with backoff** until the generation reaches a
      terminal state or its **300s wall-clock budget** expires, measured from the
      generation's start. Only then is an error surfaced. Proven by a run that recovers
      after more than one attempt, and by a run that exhausts the budget and *does* surface
      an error.
- [ ] **(derived: FR10, Edge Cases)** A generation whose stream **dies before any SSE event
      arrives** is recovered from the header alone, on a 200 stream as well as on a failing
      status — the two entry paths are separately exercised.
- [ ] **(derived: FR10, Edge Cases)** While recovering, the user sees a distinct
      **reconnecting/loading** state — **not** an error, and **not** a silent hang. It is
      distinguishable in the view model from both `error` and `offline`, and the drafted
      prompt is never lost.

### Baseline

Recorded at the start of M16's implementation phase, before any task ran:
`052db73fb28be6aff2699a57b5bdf2678d286fe9` on branch `main`.

Pre-existing baseline state, recorded so it is not attributed to M16: `bun test` at this
baseline is **already red** — 851 pass, 3 fail, 854 tests across 32 files. All 3 failures
are in `test/host/pair.test.ts` (`renderPairing` subprocess assertions: `result.status`
undefined, stderr empty). They are unrelated to M16 and predate it. M16's validation gate
is therefore "no new failures, and the 3 pre-existing `pair.test.ts` failures unchanged",
not "the suite is green".

`/Users/ryankenny/Projects/phoneToLocalModel` only — record `git rev-parse HEAD` and branch
before any task runs. This milestone changes no harness source.

It does, however, **revert and restore** the harness's `idleTimeout` during its proof to
satisfy AC14. Record the harness SHA before and after and confirm the harness working tree
is returned to its `M15` state; a proof that leaves the harness reverted would silently undo
`M15`.

### Evidence

Task packets for this milestone are written once to `.harness/tasks/M16-T*.md` and passed
by path to workers, verifiers and retries.

**M16-T0 — archive M13 out of the state file.** Cheap, attempt 1, PASS.
Independently verified by the orchestrator, not accepted on the worker's claim:
`.harness/milestones.md` 1837 -> 1456 lines; `.harness/archive/M13.md` created with 420
lines (418 moved verbatim + a 2-line title header); `grep -c '^## '` = 24 before and
after, so no milestone heading was gained or lost; the M13 stub retains its heading,
`Status: DONE`, its full `### Outcome` and a `Detail:` pointer; M15 (protected, most
recently settled) and M16 (active) both intact. Reconciliation 1837 - 418 + 33 + 4 = 1456,
checked against actual `wc -l`.

### Validation

Per-milestone live proof: `src/host/m16-proof.ts` with a `proof:m16` script, run against
the live harness, not a mock.

AC14 requires the harness `idleTimeout` reverted for part of the run. The proof must
restore it before exiting, including on failure — use a `finally`. `ollama stop` is
permitted to force a deterministic cold start.

`proof:m7` and the full `bun test` suite must still pass, unweakened — see the two
behaviours named in `### Outcome`.

### Review

### Review Cycles
0

### Follow-ups


## M17 — The Studio's resident tier is reported truthfully, mapped through the harness's own resolver

Status: TODO

### Outcome

The host-side half of FR12. A same-origin, unauthenticated `GET /app/tier` endpoint answers
which tier is resident on the Studio right now, deriving residency from ollama's
`GET /api/ps` per request and mapping physical model names back to profile ids through the
harness's own `resolveProfileAgainstLocalOllama`.

**The mapping is never duplicated here.** FR12 requires reuse, and the architecture's
settled choice (C16) is an HTTP boundary: the harness exposes its resolver over a **non-v1**
loopback route `GET /internal/tier-models` returning `{ tiers: [{ id, model }] }`, added
inside `routeAuthenticated` so `withBearerAuth` covers it without changing the harness's
authentication posture. Importing `resolve.ts` by relative path and adding a `file:`
dependency were both considered and rejected — do not revisit without the human.

**Physical model identity stops inside C15 and never enters a response body.** This is
structural, not procedural, and it is the mitigation the architecture records for the
authentication downgrade at the C4 boundary: `/app/tier` is unauthenticated because the app
shell it serves is already unauthenticated, so it is only safe while it carries tier ids
alone.

**Residency is re-derived per request and never cached.** ollama evicts after roughly five
minutes idle, so a cached belief goes stale fast and is blind to loads made by other tools.
Inferring residency from `load_duration_ns` was explicitly rejected as the primary
mechanism.

Nothing to do with a tier is client-visible in this milestone — that is `M18`. This slice
ends at HTTP, which is a real entry point, and is independently reviewable by curling
`/app/tier` while manipulating ollama underneath it.

**Second harness change.** C16 lands in the same file as `M15`'s C17. Keep them separate
hunks; `M16`'s AC14 depends on C17 being revertible without disturbing C16.

### Architecture

C14 — Ollama Client (new), C15 — Tier Service (new), C16 — Harness Tier Resolver (new, in
the external repository), C4 — App Origin Server (extended), C1 — Host Config (reused
unchanged for `readToken`).

### As-Built

### Acceptance Criteria

- [ ] **AC15** — The loaded-tier endpoint reports truthfully across all three states: nothing
      resident → reports none; after warming tier X → reports X; cross-checked against
      ollama's `/api/ps`.
- [ ] **(derived: FR12)** The tier→model map is obtained at request time from C16's non-v1
      loopback route, which calls the harness's own `resolveProfileAgainstLocalOllama`. No
      profile→model mapping is duplicated, hardcoded or cached in this repository — proven
      by a guard test in the manner of the existing
      `test/no-hardcoded-profile-ids.test.ts`, and by observing the endpoint follow a
      change made only in the harness.
- [ ] **(derived: FR12, AC17)** No physical model name, size, digest or quantization tag
      appears in any `/app/tier` response body, in any state including the error states.
      They stop inside C15.
- [ ] **(derived: FR12, Edge Cases)** With **ollama unreachable**, `/app/tier` returns an
      explicit **unknown** state — distinct from "nothing loaded", not an unhandled error,
      and it does not crash or hang the server.
- [ ] **(derived: FR12, Edge Cases)** A model **self-unloading** is reflected on the next
      read rather than a stale tier being asserted, because residency is re-derived per
      request. Proven by `ollama stop` between two reads without restarting anything.

### Baseline

**Two repositories**, as `M15`. Record `git rev-parse HEAD` and branch for both
`/Users/ryankenny/Projects/phoneToLocalModel` and
`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness` before any task runs. The review must
diff both.

If `M15` has already landed C17 in the harness, this milestone's harness baseline includes
it; the review must attribute the `idleTimeout` hunk to `M15` and not to this milestone.

### Evidence

### Validation

Per-milestone live proof: `src/host/m17-proof.ts` with a `proof:m17` script, run against
the live harness and the live ollama on `127.0.0.1:11434`, not a mock. `ollama stop` is
permitted and is required for the "nothing resident" and self-unload states.

The unreachable-ollama state must be proven against a genuinely absent listener, not a
stubbed client.

### Review

### Review Cycles
0

### Follow-ups


## M18 — The phone shows which tier is loaded, and shows no physical model identity anywhere

Status: TODO

### Outcome

The client half of FR12, and the correction of existing UI that already violates it.

**This milestone corrects existing UI, it does not only constrain new UI.** M13's
attestation screenshots recorded the completion telemetry line rendering
`quantization Q4_K_M` and `context limit 262144`. That display is M2's work and predates
the 2026-09-02 requirements, so nothing was changed at the time — it was recorded under
M13's Follow-ups precisely so that whichever milestone took FR12 would treat it as a defect
to fix. This is that milestone.

**Resolution of the FR4 / FR12 tension, applied here — a human may overturn it cheaply.**

- FR4 requires the completion telemetry to display "tokens per second, eval count,
  quantization, and context limit".
- FR12 requires that "Physical model names, sizes, digests and **quantization tags** never
  reach the UI".
- AC17 forbids "physical model name, size or digest" anywhere in the rendered UI. It does
  **not** name quantization or context limit.

The resolution applied: **quantization is removed from the UI.** FR12 is the later
requirement (2026-09-02) and names quantization explicitly and by that word; FR4's
quantization clause predates it and is superseded on that one field only. **Tokens per
second, eval count and context limit stay** — they are performance and capability facts
rather than model identity, none of them is named by AC17, and FR4 still requires them.

This is recorded as a **planning finding rather than a silent decision**, because narrowing
an agreed requirement is a human's call. It does not block: the change is one field in one
display line, and reversing it is a one-line edit. If the human disagrees, say so before
this milestone is implemented and the criterion below is rewritten instead. See
`### Follow-ups`.

**C18 must never attach the bearer token.** It is deliberately independent of C5 and C7:
`/app/tier` is unauthenticated and same-origin, and the token belongs only to the v1 API.
A tier client that sends `Authorization` would leak the credential onto a surface the
architecture sanctioned precisely because it carries none.

### Architecture

C18 — Tier Client (new), C10 — UI (extended), C6 — SSE Reader (reused; C18 maps its generic
frames, which is the second consumer that justifies the frame layer existing).

Depends on `M17` having shipped `/app/tier`.

### As-Built

### Acceptance Criteria

- [ ] **AC17** — No physical model name, size or digest appears anywhere in the rendered UI.
- [ ] **(derived: FR12)** The UI displays the **currently-loaded** tier and **distinguishes
      it** from the tier the open conversation has selected, including when they differ and
      when nothing is loaded.
- [ ] **(derived: FR12, AC17 — existing UI to correct)** The completion telemetry line no
      longer renders the **quantization** tag. Tokens per second, eval count and context
      limit remain displayed, as FR4 requires. Proven against the rendered output, not only
      against the view model.
- [ ] **(derived: FR12, Edge Cases)** With ollama unreachable or `/app/tier` unavailable,
      the indicator shows an explicit **unknown** state — distinct from "nothing loaded" —
      and **never blocks prompting** or crashes the app.
- [ ] **(derived: FR12, Constraints)** C18 attaches **no** `Authorization` header to
      `/app/tier` and never reads the credential store. Proven by a guard test over the
      built bundle in the manner of the existing `test/web/bundle-purity.test.ts`, and by
      observing the request the client actually issues.

### Baseline

`/Users/ryankenny/Projects/phoneToLocalModel` only — record `git rev-parse HEAD` and branch
before any task runs. No harness source changes here.

### Evidence

### Validation

Per-milestone live proof: `src/host/m18-proof.ts` with a `proof:m18` script, run against
the live `/app/tier` endpoint from `M17` and the live ollama, not a mock.

AC17 is a claim about the **rendered** UI, so prove it by asserting over rendered DOM text
across every generation state — including `complete` with real live telemetry — rather than
by inspecting the view model. The `happy-dom` dependency already in `devDependencies` is the
established route for this.

`test/build.test.ts` deletes `web/dist` in its `afterEach`; run `bun run scripts/build.ts`
before any bundle-level assertion or anything served.

### Review

### Review Cycles
0

### Follow-ups

- **PLANNING FINDING, raised 2026-09-02 — FR4 and FR12 directly contradict each other on
  quantization, and the resolution above was chosen rather than escalated.** FR4 requires
  quantization displayed; FR12 forbids quantization tags reaching the UI. AC17's own
  enumeration ("name, size or digest") does not mention quantization, so the conflict is
  between FR4's prose and FR12's prose, not between two acceptance criteria. The chosen
  resolution — later-and-more-specific FR12 wins on that one field, FR4's other three fields
  are untouched — is recorded in `### Outcome` and is implemented by the third criterion.
  It was not escalated as a blocker because the milestone is implementable either way and
  holding the plan for it would stall four other milestones.

  **CONFIRMED BY THE HUMAN on 2026-09-02: "keep FR12 winning on quantization."** The
  orchestrator's resolution stands as the human's own decision, not merely as a planning
  default left unchallenged. **Do not re-litigate it.** Quantization is removed from the UI;
  tokens per second, eval count and context limit stay, since AC17 enumerates "name, size or
  digest" and FR12's prose names quantization but neither touches those three.


## M19 — Selecting a tier warms it up without touching the v1 API

Status: TODO

### Outcome

FR13. Selecting a tier triggers a warm-up load, so the human learns readiness at switch
time rather than after committing to a prompt.

**Warm-up goes directly to ollama and never through the v1 API.** `POST /api/generate` with
an empty prompt, which returns `done_reason: "load"`. A warm-up through the v1 API would
append both a user and an assistant turn and consume the single global generation slot, so
it could queue behind or outright block a real prompt. This is the whole reason the tier
surface exists outside the API, and it is the substance of AC16.

**Supersede is an explicit event, not an inferred race.** `POST /app/tier/warm` responds
with an SSE stream of `loading` (a liveness heartbeat), `ready`, `superseded` and `error`.
The heartbeat is what keeps the connection alive, so C4 needs no long idle window of its
own — note this is a different mechanism from `M15`'s harness `idleTimeout` and does not
depend on it.

**The stream carries no progress percentage, and that is not a defect.** ollama's
`/api/generate` reports load completion but not load progress; a percentage exists only for
`/api/pull`, which is a different operation. The UI shows loading → ready with liveness.
This is recorded in the architecture's Risks so no future session treats the missing
progress bar as a bug.

Depends on `M17` (C14, C15, C4) and `M18` (C18, the tier indicator this milestone drives to
`ready`).

### Architecture

C15 — Tier Service (extended with the warm-up lifecycle), C14 — Ollama Client (extended
with `warm`), C4 — App Origin Server (extended with `POST /app/tier/warm`), C18 — Tier
Client (extended to consume the warm stream), C6 — SSE Reader (reused), C10 — UI
(extended).

### As-Built

### Acceptance Criteria

- [ ] **AC16** — Selecting a tier warms it and the UI shows ready, with **no session created
      and no turns appended**, verified via `GET /v1/sessions`.
- [ ] **(derived: FR13, Edge Cases)** **Rapid switching supersedes**: several tier
      selections in a row warm only the most recently selected tier, and the abandoned
      warm-ups emit an explicit `superseded` event rather than the client inferring it from
      a race.
- [ ] **(derived: FR13, Edge Cases)** A **real prompt sent while a warm-up is in flight** is
      not blocked, queued behind, or corrupted. Proven against the live harness with a
      warm-up genuinely in flight, by timing the prompt's admission rather than by asserting
      it eventually completes.
- [ ] **(derived: FR13, Edge Cases)** **Warm-up failure** — the tier's model is missing, or
      ollama errors — is surfaced clearly as an `error` event and **does not block the human
      from prompting anyway**.
- [ ] **(derived: FR13)** The UI shows **loading → ready** for the selected tier, driven by
      the `/app/tier/warm` SSE stream parsed through C6's shared frame layer. No progress
      percentage is shown or expected.

### Baseline

`/Users/ryankenny/Projects/phoneToLocalModel` only — record `git rev-parse HEAD` and branch
before any task runs. No harness source changes here; C16 and C17 both landed earlier.

### Evidence

### Validation

Per-milestone live proof: `src/host/m19-proof.ts` with a `proof:m19` script, run against the
live harness, the live `/app/tier` and `/app/tier/warm` endpoints, and the live ollama on
`127.0.0.1:11434`. Not a mock.

AC16's "no session created and no turns appended" must be verified by comparing
`GET /v1/sessions` before and after a warm-up, against the live API.

`ollama stop` is permitted and is required to make the warm-up observably cold.

The warm-up-failure criterion needs a tier whose model is genuinely absent from ollama, or
a genuine ollama error — not a stubbed client.

### Review

### Review Cycles
0

### Follow-ups


## M14 — The pairing QR is scanned with the iPhone camera at the Studio

Status: TODO

### Outcome

The single acceptance criterion this project cannot prove without a human standing at the
Mac Studio. Split out of M11 by human decision on 2026-09-01: the human was phone-only,
every mechanical half of AC2 was already proven, and holding M11 open on an optical step
would have blocked M12 and M13 for days.

**This milestone contains no implementation.** Nothing is built here. If the scan fails, the
defect belongs to M11 and is fixed there — this milestone only records what the human saw.
An orchestrator invoked for it should route no tasks; there is nothing to route.

It is deliberately last. The human asked for it to be the final thing proven on the project.

**Prerequisite that is easy to get wrong:** `test/build.test.ts` deletes `web/dist` in its
`afterEach`, so a full `bun test` run leaves the served bundle absent. Run
`bun run scripts/build.ts` as the last command before serving, or the scan will land on a
404 and look like a pairing failure.

**Rotate the bearer token before attesting.** During the 2026-09-01 phone-only session a QR
encoding the live token was transmitted through an assistant conversation to reach the
phone, and remains decodable in that transcript. The attestation should be performed against
a rotated token so the proven credential is not the disclosed one.

### Architecture

C1, C2, C3, C5 — attested, not modified.

### As-Built

### Acceptance Criteria
- [ ] **AC2 (optical step)** — **Human-attested on the physical iPhone (`iphone-15-pro`).
      Not agent-provable — no agent may check this box.** From the installed home-screen app
      with no stored token, `bun run pair` is run on the Studio, the QR is scanned with the
      iPhone camera, and the human confirms: the app opens, the URL bar shows **no `#t=`
      fragment** afterwards, and the pairing survives relaunching the app.

### Baseline

### Evidence

### Validation

### Review

### Review Cycles
0

### Follow-ups

- **PLANNING FINDING, raised 2026-09-02 — this milestone's sole criterion may be unsatisfiable as
  written, and a human must decide.** M14 was drafted before `M12a-ii` established *why* the
  camera route fails: iOS gives the installed home-screen app a **different storage container**
  than Safari, and the iPhone camera opens a scanned URL in Safari. So a scan can pair Safari —
  it demonstrably does, which is what `M11` proved — but it cannot pair the *installed* app,
  which is what this criterion requires ("From the installed home-screen app with no stored
  token ... the QR is scanned with the iPhone camera"). This is the same mechanism that produced
  the original `Pairing needed (unauthorized)` report.

  **Not rewritten here.** Narrowing a criterion is a human decision, and the record should show
  the criterion as agreed alongside the reason it may not hold. The plausible resolutions are:
  narrow M14 to Safari (proving AC2's optical step, but not for the home-screen app); fold M14
  into the paste-based pairing the human attested on 2026-09-02 under `M12a-ii` criterion 7; or
  keep it and accept it cannot pass. **Do not choose one without the human.**

- **Consider attesting M12 and M13's on-device criteria in the same sitting.** Each carries
  its own human-attested criterion requiring the physical iPhone, and M12's additionally
  requires the phone already paired. Sequencing this milestone's scan first makes the other
  two attestable in one visit to the machine.
- **The `#t=` check is the only device-observable signal of pairing.** A paired and an
  unpaired app render identically today — see M11's Follow-ups. Do not instruct an attester
  to "check that profiles load".


## M13 — The app degrades honestly when the Mac is unreachable or the transcript is long

Status: DONE

### Outcome

The two requirement-named edge cases that no other milestone owns. Both are UI-shaped, both
were split out of M12 deliberately to keep it from arriving oversized, and neither is covered
anywhere in M1-M12.

**Offline.** The requirements' edge case reads: "The harness is offline or the tailnet is
unreachable: show a clear offline state and allow retry without losing the drafted prompt."
This is distinct from M7 and is not a re-claim of it — M7 surfaced *documented harness error
codes* returned by a reachable service, whereas this is a transport failure where no response
exists at all. A drafted prompt discarded on a failed send is the worst version of this: the
human retypes into a phone keyboard.

**Long transcripts.** "A very long transcript must not break rendering." There is a concrete
latent defect behind this rather than a hypothetical: `dom-target.ts`'s `paint` calls
`transcriptList.replaceChildren(...transcriptItems)`, rebuilding every transcript node on
every paint. Once M12 subscribes paint to streaming deltas, a long conversation does O(turns)
DOM work per delta — so the cost is O(turns x deltas) across a single generation, on the
slowest device in the system. The criterion below is written to be falsifiable against that
specific shape rather than as a vague performance wish.

**Every acceptance criterion here is derived.** All eleven ACs are owned by M1-M11; this
milestone proves none of them and must never be recorded as covering one.

**It runs after M12**, which builds the controls and the subscription this milestone hardens.


Detail: `.harness/archive/M13.md`

