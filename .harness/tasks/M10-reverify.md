# Task Packet: M10-reverify — independent re-verification of M10's Evidence claims

Tier: Cheap. Reason to go above it: none nameable — the task is clearly specified
(each claim below names a file and a concrete, checkable property), bounded (read-only,
a fixed file list), low risk (changes nothing), and easily verified (each check is a
grep/parse with a yes-or-no answer).

## Goal

M10's `### Evidence` section in `.harness/milestones.md` claims specific behaviour lives in
specific files. Confirm from the CURRENT working tree that each claim below actually holds.
This is a READ-ONLY audit. Change nothing. Run no builds, no `bun run build`, no
`bun run proof:m10`, no `launchctl` command, no `kill`. Do not touch `web/dist/`.

Repository: /Users/ryankenny/Projects/phoneToLocalModel

## Claims to check, one by one

C12 — PWA shell
1. `web/public/app.webmanifest` exists, is valid JSON, has `"display": "standalone"`,
   `start_url` and `scope` both under `/app/`, and names exactly three icons by absolute
   `/app/...` paths.
2. `web/public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon-180.png` all exist and
   each begins with the 8-byte PNG signature. Report each file's byte size.
3. Every icon path named inside `app.webmanifest` corresponds to a file that exists on disk
   under `web/public/` (map `/app/X` -> `web/public/X`). Report any named icon with no file.
4. `web/public/index.html` contains: a `rel="manifest"` link, an `apple-touch-icon` link,
   `apple-mobile-web-app-capable`, `mobile-web-app-capable`, a status-bar-style meta, and a
   `theme-color` meta. Quote the matching lines with line numbers.
5. `web/src/sw.ts` defines a `CACHE_VERSION` and a `CACHE_NAME` where `CACHE_NAME`
   incorporates `CACHE_VERSION`; defines `shouldHandle` restricting to GET + same-origin +
   a `/app/` scope (so `/v1/...` is never intercepted); defines a NETWORK-FIRST
   `handleShellRequest` (network attempted first, cache used as fallback and refreshed on a
   successful network response — quote the code that shows the ordering); and defines
   `staleCacheNames` used for activation-time eviction.
6. `web/src/main.ts` registers `./sw.js` as a CLASSIC worker (i.e. NOT `type: "module"`),
   inside a `typeof document !== "undefined"` guard AND a `"serviceWorker" in navigator`
   guard, with the registration rejection swallowed. Quote it.
7. `scripts/build.ts` performs a SECOND `Bun.build` that emits `sw.js` with
   `format: "iife"`. Quote it.

C13 — launch agent
8. `src/host/launch-agent.ts` exports `renderPlist`, `installLaunchAgent`,
   `uninstallLaunchAgent`; `renderPlist` emits `RunAtLoad` true and `KeepAlive` true;
   `installLaunchAgent` performs bootout -> bootstrap -> enable -> kickstart, tolerating
   bootout and enable failures while treating bootstrap and kickstart failures as fatal;
   and the exec used is INJECTED (a parameter/dependency), not a hardcoded direct call.
   Quote the relevant lines.
9. `deploy/install-launch-agent.sh` exists, is executable, and invokes the launch-agent
   module. Quote it in full.

Proof and tests
10. `src/host/m10-proof.ts` exists and has three phases matching the three derived criteria:
    phase 1 = manifest + icons at the served origin; phase 2 = versioned cache +
    network-first surviving a rebuild; phase 3 = launch agent restarts the asset server
    after a kill. Quote each phase's banner/label line. DO NOT RUN IT.
11. `package.json` has `"proof:m10": "bun run src/host/m10-proof.ts"`.
12. These test files exist and contain real assertions (not skipped/todo/empty):
    `test/icons.test.ts`, `test/web/manifest.test.ts`, `test/web/sw.test.ts`,
    `test/host/launch-agent.test.ts`. Report the count of `test(`/`it(` blocks in each and
    confirm none are `.skip`/`.todo`.
13. `test/build.test.ts` contains an assertion that the emitted `sw.js` is a classic script
    (not an ES module). Quote it.

## Files Allowed To Change

NONE. This task is read-only. If you change any file, the task has failed.

## Tests

None to run. Report findings only.

## Report format

For each numbered claim: HOLDS / DOES NOT HOLD / PARTIAL, with the quoted evidence or the
specific gap. Do not summarise the file — quote the lines that settle the claim. If a claim
does not hold, say precisely what is present instead.
