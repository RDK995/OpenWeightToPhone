// M15 live proof: proves against the LIVE harness that a cold model load no
// longer kills the SSE stream (FR11, AC12, AC13).
//
// The currently running harness process predates the fix (M15-T1, which sets
// `idleTimeout` on the harness's `Bun.serve`). This proof therefore starts by
// restarting that process with the fixed code before doing anything else --
// every later phase is otherwise proving nothing, since it would still be
// talking to the old, unfixed process.
//
// Do not touch web/src/. This proof drives the real, unmodified client stack
// (api-client, session-coordinator, conversation-store, and -- for AC12 --
// the DOM layer under happy-dom) against the live tailnet harness. It never
// hardcodes a profile id: `test/no-hardcoded-profile-ids.test.ts` scans
// `src/` for the literal text of the three known ids and fails the build if
// found, and profiles here are always discovered via listProfiles().

import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSync, readFileSync, symlinkSync } from "node:fs";
import { Window } from "happy-dom";

import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createApiClient, type Profile } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";
import { createDomTarget } from "../../web/src/ui/dom-target.ts";
import { mount } from "../../web/src/ui/mount.ts";
import { readEvents } from "../../web/src/sse-reader.ts";

const HARNESS_REPO = "/Users/ryankenny/Projects/OpenCodeOpenWeightHarness";
const CLI_PATTERN = "harness/api/cli.ts";
const SERVE_PATTERN = "serve:p1";
const bunPath = process.execPath;
// The commit immediately before the uncommitted `idleTimeout` change (M15-T1)
// was made on top of it -- i.e. the pre-fix baseline for PHASE REVERT-CONTROL.
const REVERT_BASELINE_COMMIT = "65c1fdee1b01ebe288456dfeaa74af083bcc9dfe";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  condition: () => boolean,
  timeout: number = 10000,
  intervalMs: number = 100
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

async function waitUntil<T>(
  check: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== null) return result;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

async function runCommand(
  cmd: string[],
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * `pgrep -f <pattern>` always matches its own process too, because the
 * pattern is passed as one of pgrep's own command-line arguments and `-f`
 * matches against the full command line of every process, pgrep's own
 * included. Filters that self-match out by checking each candidate pid's
 * actual command: the real target processes are always `bun run ...`, never
 * `pgrep ...`.
 */
async function findPids(pattern: string): Promise<number[]> {
  const { stdout } = await runCommand(["pgrep", "-f", pattern]);
  const rawPids = stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

  const real: number[] = [];
  for (const pid of rawPids) {
    const cmd = (await runCommand(["ps", "-o", "command=", "-p", String(pid)])).stdout.trim();
    if (cmd && !cmd.startsWith("pgrep")) {
      real.push(pid);
    }
  }
  return real;
}

async function startTimeForPid(pid: number): Promise<string> {
  const { stdout } = await runCommand(["ps", "-o", "lstart=", "-p", String(pid)]);
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : "<unknown>";
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pids: number[], timeoutMs: number, intervalMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = pids.filter(pidAlive);
    if (remaining.length === 0) return [];
    if (Date.now() >= deadline) return remaining;
    await sleep(intervalMs);
  }
}

async function ollamaPs(): Promise<{ output: string; models: string[] }> {
  const { stdout } = await runCommand(["ollama", "ps"]);
  const lines = stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  // First line is the header ("NAME ID SIZE PROCESSOR CONTEXT UNTIL"); every
  // subsequent line names a resident model in its first whitespace-delimited
  // field. Never hardcode a model name here -- read it off this output.
  const models = lines
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((name): name is string => Boolean(name));
  return { output: stdout, models };
}

/** Forces a deterministic cold start by evicting every model ollama reports resident. */
async function forceCold(label: string): Promise<boolean> {
  console.log(`  [${label}] ollama ps (before):`);
  const before = await ollamaPs();
  console.log(before.output.trimEnd().length > 0 ? before.output.trimEnd() : "    <empty output>");

  if (before.models.length === 0) {
    console.log(`  [${label}] nothing was resident -- already cold.`);
    return true;
  }

  for (const model of before.models) {
    console.log(`  [${label}] ollama stop ${model}`);
    const stopResult = await runCommand(["ollama", "stop", model]);
    if (stopResult.stdout.trim()) console.log(`    stdout: ${stopResult.stdout.trim()}`);
    if (stopResult.stderr.trim()) console.log(`    stderr: ${stopResult.stderr.trim()}`);
  }

  console.log(`  [${label}] ollama ps (after):`);
  const after = await ollamaPs();
  console.log(after.output.trimEnd().length > 0 ? after.output.trimEnd() : "    <empty output>");

  if (after.models.length !== 0) {
    console.log(
      `  FAIL - [${label}] ${after.models.length} model(s) still resident after ollama stop: ${after.models.join(", ")}`
    );
    return false;
  }
  console.log(`  [${label}] confirmed cold: no model resident`);
  return true;
}

/**
 * The live catalogue currently has two profiles with `latency_class ===
 * "batch"`, and no API-exposed field distinguishes which one is the tier
 * that used to die at ~10-12s under a cold load -- so AC13 does not pick a
 * profile by name or label at all. It sweeps every batch-class candidate,
 * forces a fresh cold start for each, measures the largest idle gap between
 * SSE events on a real generation, and identifies the tier that previously
 * died as whichever candidate's gap is the one that exceeds Bun's old ~10s
 * default. That measured profile is then carried forward as a value into
 * AC12 -- never re-derived from a name or label.
 */
function discoverBatchProfiles(profiles: readonly Profile[]): Profile[] {
  return profiles.filter((p) => p.latency_class === "batch");
}

/** Asks the OS for a free ephemeral TCP port on loopback, never 7787. */
async function getFreePort(): Promise<number> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = server.port!;
  await server.stop(true);
  return port;
}

/** Finds the pid(s) listening on `port`, read-only (never used to touch the live service). */
async function getListeningPid(port: number): Promise<number | null> {
  const { stdout } = await runCommand(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const pids = stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return pids.length > 0 ? pids[0]! : null;
}

/** Polls GET `<baseUrl>/v1/profiles` for a 200, exactly the shape RESTART already polls for. */
async function waitForLocalUp(baseUrl: string, token: string, timeoutMs: number): Promise<number | null> {
  return waitUntil(
    async () => {
      try {
        const res = await fetch(`${baseUrl}/v1/profiles`, { headers: { authorization: `Bearer ${token}` } });
        return res.status === 200 ? res.status : null;
      } catch {
        return null;
      }
    },
    timeoutMs,
    1000
  );
}

/** Starts `bun run harness/api/cli.ts` in `cwd`, bound to `port`, with a clean env (see RESTART). */
async function startHarnessInstance(
  cwd: string,
  port: number,
  label: string
): Promise<{ pid: number; logPath: string }> {
  const logPath = join(tmpdir(), `m15-revert-control-${label}-${Date.now()}.log`);
  console.log(`  [${label}] starting "bun run harness/api/cli.ts" in ${cwd} on 127.0.0.1:${port}; log: ${logPath}`);

  const cleanEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("OPENWEIGHT_HARNESS_")) {
      cleanEnv[key] = value;
    }
  }
  cleanEnv.OPENWEIGHT_HARNESS_BIND_PORT = String(port);

  const logFd = openSync(logPath, "a");
  const child = Bun.spawn({
    cmd: [bunPath, "run", "harness/api/cli.ts"],
    cwd,
    env: cleanEnv,
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
  });
  console.log(`  [${label}] pid=${child.pid}`);
  return { pid: child.pid, logPath };
}

/** Stops a process started by `startHarnessInstance`, escalating to SIGKILL, reusing the RESTART primitives. */
async function stopHarnessInstance(pid: number, label: string): Promise<void> {
  console.log(`  [${label}] SIGTERM ${pid}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  let remaining = await waitUntilGone([pid], 10_000, 250);
  if (remaining.length > 0) {
    console.log(`  [${label}] pid ${pid} still alive 10s after SIGTERM -- SIGKILL`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    remaining = await waitUntilGone(remaining, 10_000, 250);
  }
  console.log(
    remaining.length > 0
      ? `  [${label}] FAIL - pid ${pid} still alive after SIGTERM and SIGKILL`
      : `  [${label}] confirmed stopped`
  );
}

/** Starts an instance, runs `fn` against its base URL, and guarantees it is stopped again even if `fn` throws. */
async function withHarnessInstance<T>(
  cwd: string,
  port: number,
  label: string,
  fn: (baseUrl: string, logPath: string) => Promise<T>
): Promise<T> {
  const instance = await startHarnessInstance(cwd, port, label);
  try {
    return await fn(`http://127.0.0.1:${port}`, instance.logPath);
  } finally {
    await stopHarnessInstance(instance.pid, label);
  }
}

interface ProbeResult {
  eventKinds: string[];
  sawContent: boolean;
  sawComplete: boolean;
  elapsedSeconds: number;
  largestGapSeconds: number;
  threw: string | null;
}

/**
 * Sends one prompt on `profile` against `baseUrl` and times out the raw SSE
 * events exactly as AC13's sweep does (same gap-measurement convention), but
 * factored out so PHASE REVERT-CONTROL's B and A runs share one copy rather
 * than each re-implementing the loop.
 */
async function runProbeGeneration(
  baseUrl: string,
  token: string,
  profile: Profile,
  prompt: string,
  label: string
): Promise<ProbeResult> {
  const apiClient = createApiClient({ baseUrl, getToken: () => token });
  const sessionId = await apiClient.createSession();
  console.log(`    [${label}] created session ${sessionId}`);

  const requestStart = performance.now();
  let lastEventAt = requestStart;
  let largestGapSeconds = 0;
  let sawContent = false;
  let sawComplete = false;
  const eventKinds: string[] = [];
  let threw: string | null = null;

  try {
    const { events } = await apiClient.generate(sessionId, { profileId: profile.id, prompt });
    for await (const event of events) {
      const now = performance.now();
      const gapSeconds = (now - lastEventAt) / 1000;
      if (gapSeconds > largestGapSeconds) largestGapSeconds = gapSeconds;
      lastEventAt = now;
      eventKinds.push(event.kind);
      console.log(`    [${label}] t=${((now - requestStart) / 1000).toFixed(3)}s seq=${event.seq} kind=${event.kind}`);
      if (event.kind === "content") sawContent = true;
      if (event.kind === "complete") sawComplete = true;
    }
  } catch (error) {
    threw = (error as Error).message;
    console.log(`    [${label}] stream iteration ended by throwing (expected if the connection was killed): ${threw}`);
  }

  const elapsedSeconds = (performance.now() - requestStart) / 1000;
  console.log(
    `    [${label}] stream ended at t=${elapsedSeconds.toFixed(3)}s; events=[${eventKinds.join(",") || "<none>"}]; complete=${sawComplete}`
  );

  return { eventKinds, sawContent, sawComplete, elapsedSeconds, largestGapSeconds, threw };
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);

  let allPassed = true;

  // =====================================================================
  // PHASE RESTART - the running harness predates the fix; replace it.
  // =====================================================================
  console.log("\n=== PHASE RESTART: replacing the running harness with the idleTimeout-fixed code ===");
  let restartPassed = true;
  let newPid: number | null = null;

  try {
    const cliPids = await findPids(CLI_PATTERN);
    const servePids = await findPids(SERVE_PATTERN);
    console.log(`  pgrep -f "${CLI_PATTERN}" -> ${cliPids.length > 0 ? cliPids.join(", ") : "<none>"}`);
    console.log(`  pgrep -f "${SERVE_PATTERN}" -> ${servePids.length > 0 ? servePids.join(", ") : "<none>"}`);

    const oldPids = Array.from(new Set([...cliPids, ...servePids]));
    for (const pid of oldPids) {
      console.log(`  PID ${pid} started: ${await startTimeForPid(pid)}`);
    }

    if (oldPids.length === 0) {
      console.log("  No running harness process found to restart -- starting one fresh.");
    } else {
      for (const pid of oldPids) {
        console.log(`  SIGTERM ${pid}`);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }

      let remaining = await waitUntilGone(oldPids, 10_000, 250);
      if (remaining.length > 0) {
        for (const pid of remaining) {
          console.log(`  PID ${pid} still alive 10s after SIGTERM -- SIGKILL`);
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
        remaining = await waitUntilGone(remaining, 10_000, 250);
      }

      if (remaining.length > 0) {
        console.log(`  FAIL - PID(s) ${remaining.join(", ")} still alive after SIGTERM and SIGKILL`);
        restartPassed = false;
      } else {
        console.log("  Old process(es) confirmed stopped.");
      }
    }

    const logPath = join(tmpdir(), `m15-harness-${Date.now()}.log`);
    console.log(`  Replacement's combined stdout+stderr: ${logPath}`);

    // No OPENWEIGHT_HARNESS_* overrides: the process being replaced ran with
    // none, so any such variable that happens to be set in this proof's own
    // environment is stripped rather than leaked into the replacement.
    const cleanEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("OPENWEIGHT_HARNESS_")) {
        cleanEnv[key] = value;
      }
    }

    // A single shared fd for both stdout and stderr, so interleaved writes
    // land in file order instead of each stream truncating the other.
    const logFd = openSync(logPath, "a");

    const child = Bun.spawn({
      cmd: [bunPath, "run", "harness/api/cli.ts"],
      cwd: HARNESS_REPO,
      env: cleanEnv,
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
      detached: true,
    });
    child.unref();
    newPid = child.pid;
    console.log(`  Started replacement: pid=${newPid}`);

    if (oldPids.includes(newPid)) {
      console.log(`  FAIL - new pid ${newPid} collides with an old pid; cannot confirm this is a distinct process`);
      restartPassed = false;
    }

    const profilesUrl = `${baseUrl}/v1/profiles`;
    const pollStart = Date.now();
    const upStatus = await waitUntil(
      async () => {
        try {
          const res = await fetch(profilesUrl, { headers: { authorization: `Bearer ${token}` } });
          return res.status === 200 ? res.status : null;
        } catch {
          return null;
        }
      },
      60_000,
      1000
    );
    const pollElapsed = (Date.now() - pollStart) / 1000;

    if (upStatus !== 200) {
      console.log("");
      console.log("  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.log("  !! FAIL - THE REPLACEMENT HARNESS DID NOT COME UP. THE USER'S PHONE       !!");
      console.log("  !! DEPENDS ON THIS SERVICE AND IT MAY NOW BE DOWN. CHECK THE LOG BELOW.   !!");
      console.log("  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.log(`  GET ${profilesUrl} never returned 200 within 60s (waited ${pollElapsed.toFixed(1)}s).`);
      console.log(`  Replacement log: ${logPath}`);
      restartPassed = false;
    } else {
      console.log(`  GET ${profilesUrl} -> 200 after ${pollElapsed.toFixed(1)}s: replacement (and Tailscale Serve) is up.`);
    }
  } catch (error) {
    console.log(`  FAIL - RESTART phase threw: ${(error as Error).message}`);
    restartPassed = false;
  }

  console.log(restartPassed ? "PHASE RESTART: PASS" : "PHASE RESTART: FAIL");
  allPassed = allPassed && restartPassed;

  if (!restartPassed) {
    console.log(
      "\nRESTART did not confirm a healthy replacement -- refusing to continue with phases that require a live, fixed harness."
    );
    console.log("\nM15 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  // =====================================================================
  // PHASE READBACK - the 255s idleTimeout is real on a running server.
  // =====================================================================
  console.log("\n=== PHASE READBACK: the 255s idleTimeout is real on a running server ===");
  let readbackPassed = true;

  try {
    console.log(`  Running: bun test harness/api/idle-timeout.test.ts (cwd=${HARNESS_REPO})`);
    const result = await runCommand([bunPath, "test", "harness/api/idle-timeout.test.ts"], { cwd: HARNESS_REPO });
    console.log(`  exit status: ${result.exitCode}`);
    console.log("  --- stdout ---");
    console.log(result.stdout);
    console.log("  --- stderr ---");
    console.log(result.stderr);

    if (result.exitCode !== 0) {
      console.log(`  FAIL - idle-timeout.test.ts exited ${result.exitCode}, expected 0`);
      readbackPassed = false;
    } else {
      console.log("  PASS - idle-timeout.test.ts exited 0");
    }

    const serverSourcePath = join(HARNESS_REPO, "harness/api/server.ts");
    const serverSource = readFileSync(serverSourcePath, "utf-8");
    const sourceLine = serverSource
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l === "idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS,");

    console.log(`  Source read (${serverSourcePath}):`);
    console.log(`    ${sourceLine ?? "<idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS, line not found>"}`);

    if (!sourceLine) {
      console.log("  FAIL - could not find the idleTimeout: HARNESS_IDLE_TIMEOUT_SECONDS, line in server.ts");
      readbackPassed = false;
    }
  } catch (error) {
    console.log(`  FAIL - READBACK phase threw: ${(error as Error).message}`);
    readbackPassed = false;
  }

  console.log(readbackPassed ? "PHASE READBACK: PASS" : "PHASE READBACK: FAIL");
  allPassed = allPassed && readbackPassed;

  // =====================================================================
  // PHASE AC13 - sweep every batch-class profile, each with its own forced
  // cold start, identifying the tier that previously died by measuring
  // which candidate's largest idle gap exceeds Bun's old ~10s default.
  // =====================================================================
  console.log("\n=== PHASE AC13: sweep over batch-class profiles for a >10s idle gap, no resume ===");
  let ac13Passed = true;
  let identifiedProfile: Profile | null = null;

  try {
    const discoveryClient = createApiClient({ baseUrl, getToken: () => token });
    const profiles = await discoveryClient.listProfiles();
    console.log(
      `  Discovered ${profiles.length} profile(s): ${profiles
        .map((p) => `${p.label} (latency_class=${p.latency_class})`)
        .join(", ")}`
    );

    const candidates = discoverBatchProfiles(profiles);
    console.log(
      `  ${candidates.length} candidate(s) with latency_class="batch": ${
        candidates.length > 0 ? candidates.map((p) => `${p.id} (${p.label})`).join(", ") : "<none>"
      }`
    );

    if (candidates.length === 0) {
      console.log('  FAIL - no profile with latency_class="batch" was found to sweep');
      ac13Passed = false;
    } else {
      type CandidateResult = {
        profile: Profile;
        coldPassed: boolean;
        eventKinds: string[];
        elapsedSeconds: number;
        largestGapSeconds: number;
        sawContent: boolean;
        sawComplete: boolean;
        generateCount: number;
        resumeCount: number;
      };
      const results: CandidateResult[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const profile = candidates[i]!;
        console.log(`\n  --- Candidate ${i + 1}/${candidates.length}: id="${profile.id}" label="${profile.label}" ---`);

        // Every candidate gets its own cold start -- the previous candidate
        // (if any) leaves a model resident.
        const coldPassed = await forceCold(`AC13-COLD (candidate ${i + 1}/${candidates.length})`);
        if (!coldPassed) ac13Passed = false;

        const recordedRequests: { method: string; url: string }[] = [];
        const recordingFetch = (async (input: any, init?: any) => {
          const url = typeof input === "string" ? input : input.url;
          const method = init?.method || "GET";
          recordedRequests.push({ method, url });
          return globalThis.fetch(input, init);
        }) as unknown as typeof fetch;

        const apiClient = createApiClient({ baseUrl, getToken: () => token, fetch: recordingFetch });

        const sessionId = await apiClient.createSession();
        console.log(`    Created session ${sessionId}`);

        const prompt = "Reply with the single word: ready";
        const requestStart = performance.now();
        const { events } = await apiClient.generate(sessionId, { profileId: profile.id, prompt });

        let lastEventAt = requestStart;
        let largestGapSeconds = 0;
        let sawContent = false;
        let sawComplete = false;
        const eventKinds: string[] = [];

        for await (const event of events) {
          const now = performance.now();
          const gapSeconds = (now - lastEventAt) / 1000;
          if (gapSeconds > largestGapSeconds) largestGapSeconds = gapSeconds;
          lastEventAt = now;
          eventKinds.push(event.kind);
          console.log(`    t=${((now - requestStart) / 1000).toFixed(3)}s seq=${event.seq} kind=${event.kind}`);
          if (event.kind === "content") sawContent = true;
          if (event.kind === "complete") sawComplete = true;
        }

        const elapsedSeconds = (performance.now() - requestStart) / 1000;
        console.log(`    Total elapsed wall-clock for this candidate: ${elapsedSeconds.toFixed(3)}s`);
        console.log(
          `    Largest idle gap between consecutive events (request-start counts as the first interval's start): ${largestGapSeconds.toFixed(3)}s`
        );
        console.log(`    Event kinds received, in order: ${eventKinds.join(", ") || "<none>"}`);

        console.log("    All requests issued for this candidate:");
        for (const req of recordedRequests) {
          console.log(`      ${req.method} ${req.url}`);
        }

        const generateRequests = recordedRequests.filter((r) => r.url.includes("/generate"));
        const resumeRequests = recordedRequests.filter((r) => r.url.includes("/events"));
        console.log(
          `    .../generate requests: ${generateRequests.length}; resume/.../events requests: ${resumeRequests.length}`
        );

        if (!sawContent || !sawComplete) {
          console.log(
            `    FAIL - candidate did not deliver both a content event and a complete event; content=${sawContent} complete=${sawComplete}`
          );
          ac13Passed = false;
        } else {
          console.log("    PASS - both a content event and a complete event arrived");
        }

        if (generateRequests.length !== 1) {
          console.log(`    FAIL - expected exactly 1 request to a .../generate path, found ${generateRequests.length}`);
          ac13Passed = false;
        } else {
          console.log("    PASS - exactly one request to a .../generate path");
        }

        if (resumeRequests.length !== 0) {
          console.log(`    FAIL - expected no request to a resume/events endpoint, found ${resumeRequests.length}`);
          ac13Passed = false;
        } else {
          console.log("    PASS - no request to a resume/events endpoint: delivery was in-band, without resuming");
        }

        results.push({
          profile,
          coldPassed,
          eventKinds,
          elapsedSeconds,
          largestGapSeconds,
          sawContent,
          sawComplete,
          generateCount: generateRequests.length,
          resumeCount: resumeRequests.length,
        });
      }

      console.log("\n  --- AC13 per-candidate summary ---");
      console.log("  id | label | events (in order) | elapsed(s) | largest idle gap(s)");
      for (const r of results) {
        console.log(
          `  ${r.profile.id} | ${r.profile.label} | ${r.eventKinds.join(",")} | ${r.elapsedSeconds.toFixed(3)} | ${r.largestGapSeconds.toFixed(3)}`
        );
      }

      const slowCandidates = results.filter((r) => r.largestGapSeconds > 10.0);
      if (slowCandidates.length === 0) {
        console.log(
          "\n  FAIL - no candidate's largest idle gap exceeded 10.0s: the models loaded too fast for this run to be evidence"
        );
        ac13Passed = false;
      } else {
        // If more than one candidate happens to exceed the threshold, the
        // one with the largest gap is the strongest evidence of being the
        // tier that previously died.
        const winner = slowCandidates.reduce((a, b) => (b.largestGapSeconds > a.largestGapSeconds ? b : a));
        identifiedProfile = winner.profile;
        console.log("");
        console.log("  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
        console.log(`  >> TIER IDENTIFIED BY MEASUREMENT: id="${winner.profile.id}" label="${winner.profile.label}"`);
        console.log(`  >> largest idle gap = ${winner.largestGapSeconds.toFixed(3)}s (exceeds the 10.0s threshold)`);
        console.log("  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
        console.log("  PASS - at least one candidate's largest idle gap exceeds 10.0s");
      }
    }
  } catch (error) {
    console.log(`  FAIL - AC13 phase threw: ${(error as Error).message}`);
    ac13Passed = false;
  }

  console.log(ac13Passed ? "PHASE AC13: PASS" : "PHASE AC13: FAIL");
  allPassed = allPassed && ac13Passed;

  // =====================================================================
  // PHASE COLD (before AC12) - AC13 left the identified tier's model warm;
  // force cold again before driving AC12 through the UI.
  // =====================================================================
  console.log("\n=== PHASE COLD (before AC12): forcing a deterministic cold load for the identified tier ===");
  let cold2Passed: boolean;
  if (!ac13Passed || !identifiedProfile) {
    console.log("  SKIPPED - AC13 did not identify a tier (or failed); nothing to force cold for.");
    cold2Passed = false;
  } else {
    cold2Passed = await forceCold("AC12-COLD");
  }
  console.log(cold2Passed ? "PHASE COLD (before AC12): PASS" : "PHASE COLD (before AC12): FAIL");
  allPassed = allPassed && cold2Passed;

  // =====================================================================
  // PHASE AC12 - cold load driven through the UI, on the tier AC13
  // identified by measurement. Carried forward as a value; never re-derived
  // from a name, label or id literal.
  // =====================================================================
  console.log("\n=== PHASE AC12: cold load driven through the UI on the tier AC13 identified ===");
  let ac12Passed = true;

  if (!ac13Passed || !identifiedProfile) {
    console.log(
      "  FAIL - AC13 did not identify a tier (or failed); refusing to guess which profile to drive through the UI"
    );
    ac12Passed = false;
  } else {
  try {
    const identified = identifiedProfile;
    const w = new Window() as any;
    const root = w.document.body as HTMLElement;

    let generateStartedAt: number | null = null;
    let tapLargestGapSeconds = 0;
    let tapSawComplete = false;

    const wrappingFetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      const isGenerateCall = method === "POST" && url.includes("/generate");
      if (isGenerateCall) {
        generateStartedAt = performance.now();
      }

      const response = await globalThis.fetch(input, init);

      if (isGenerateCall && response.ok && response.body && generateStartedAt !== null) {
        const startedAt = generateStartedAt;
        const tapped = response.clone();
        if (tapped.body) {
          (async () => {
            try {
              let last = startedAt;
              for await (const event of readEvents(tapped.body!)) {
                const now = performance.now();
                const gap = (now - last) / 1000;
                if (gap > tapLargestGapSeconds) tapLargestGapSeconds = gap;
                last = now;
                if (event.kind === "complete") tapSawComplete = true;
              }
            } catch {
              // Best-effort tap; the app's own consumption is authoritative.
            }
          })();
        }
      }

      return response;
    }) as unknown as typeof fetch;

    const storage = createMemoryStorage();
    const conversationStore = createConversationStore(storage);
    const apiClient = createApiClient({ baseUrl, getToken: () => token, fetch: wrappingFetch });
    const sessionCoordinator = createSessionCoordinator({ apiClient, conversationStore });

    const target = createDomTarget(root);
    const handle = mount({ target, coordinator: sessionCoordinator, store: conversationStore });
    target.attach({ actions: handle.actions, controller: handle });

    const profiles = await apiClient.listProfiles();
    const profile = identified;
    console.log(`  Using the tier identified by AC13's measurement: id="${profile.id}" label="${profile.label}"`);

    {

      handle.setProfiles(profiles);
      handle.render();

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
      const createBtn = root.querySelector('[data-testid="create-conversation"]') as HTMLButtonElement | null;

      if (!profileSelect || !createBtn) {
        console.log("  FAIL - profile-select or create-conversation not found in DOM");
        ac12Passed = false;
      } else {
        profileSelect.value = profile.id;
        createBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

        const conversationCreated = await waitForCondition(
          () => root.querySelector('[data-testid="open-conversation"]') !== null,
          15000
        );

        if (!conversationCreated) {
          console.log("  FAIL - could not create a conversation against the live harness");
          ac12Passed = false;
        } else {
          const conversations = conversationStore.loadConversations();
          const conversation = conversations[0]!;
          console.log(`  Created a real conversation: ${conversation.id}`);

          const promptInput = root.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
          const sendBtn = root.querySelector('[data-testid="send"]') as HTMLButtonElement | null;

          if (!promptInput || !sendBtn) {
            console.log("  FAIL - prompt-input or send button not found in DOM");
            ac12Passed = false;
          } else {
            const prompt = "Reply with the single word: ready";
            promptInput.value = prompt;

            const sendStart = performance.now();
            console.log(`  Clicking send with a forced-cold deep-tier prompt: "${prompt}"`);
            sendBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

            const reachedTerminal = await waitForCondition(() => {
              const kind = handle.getState().generation.kind;
              return kind === "complete" || kind === "error" || kind === "cancelled" || kind === "offline";
            }, 180000, 500);

            const sendElapsedSeconds = (performance.now() - sendStart) / 1000;
            const finalGeneration = handle.getState().generation;

            console.log(`  Reached a terminal state: ${reachedTerminal}`);
            console.log(`  Final generation state: ${JSON.stringify(finalGeneration)}`);
            console.log(`  Wall-clock elapsed for this generation: ${sendElapsedSeconds.toFixed(3)}s`);

            if (finalGeneration.kind === "complete") {
              // Give the independent tap a moment to finish draining the
              // cloned stream after the app itself already reached "complete".
              await waitForCondition(() => tapSawComplete, 5000, 100);
            }
            console.log(`  Largest idle gap observed on the tapped stream: ${tapLargestGapSeconds.toFixed(3)}s`);

            if (!reachedTerminal) {
              console.log("  FAIL - generation did not reach a terminal state within 180s");
              ac12Passed = false;
            } else if (finalGeneration.kind === "error" || finalGeneration.kind === "offline") {
              console.log(`  FAIL - generation surfaced an error/offline state: ${JSON.stringify(finalGeneration)}`);
              ac12Passed = false;
            } else {
              console.log(`  PASS - generation state is not error/offline (kind="${finalGeneration.kind}")`);
            }

            const noticeEl = root.querySelector('[data-testid="notice"]');
            const noticeText = (noticeEl?.textContent ?? "") as string;
            console.log(`  Notice area text: "${noticeText}"`);
            if (noticeText !== "") {
              console.log(`  FAIL - notice area is not empty: "${noticeText}"`);
              ac12Passed = false;
            } else {
              console.log("  PASS - notice area is empty");
            }

            const conversationAfter = conversationStore.getConversation(conversation.id);
            const assistantTurns = (conversationAfter?.turns ?? []).filter((t) => t.role === "assistant");
            const assistantText = assistantTurns.length > 0 ? assistantTurns[assistantTurns.length - 1]!.content : "";
            const domText = (root.textContent ?? "") as string;

            console.log(`  Assistant answer text: "${assistantText}"`);

            if (assistantText.trim() === "") {
              console.log("  FAIL - no non-empty assistant answer text was recorded");
              ac12Passed = false;
            } else if (!domText.includes(assistantText)) {
              console.log("  FAIL - the assistant's answer text is not present in the rendered DOM");
              ac12Passed = false;
            } else {
              console.log("  PASS - the assistant's answer text is present in the rendered DOM (queried from the mounted DOM)");
            }

            if (domText.includes("http_502") || noticeText.includes("http_502")) {
              console.log('  FAIL - "http_502" appears in the rendered DOM or a surfaced message');
              ac12Passed = false;
            } else {
              console.log('  PASS - "http_502" appears nowhere in the rendered DOM or any surfaced message');
            }
          }
        }
      }
    }
  } catch (error) {
    console.log(`  FAIL - AC12 phase threw: ${(error as Error).message}`);
    console.error(error);
    ac12Passed = false;
  }
  }

  console.log(ac12Passed ? "PHASE AC12: PASS" : "PHASE AC12: FAIL");
  allPassed = allPassed && ac12Passed;

  // =====================================================================
  // PHASE REVERT-CONTROL - proves (rather than assumes) that the idleTimeout
  // change is revertible as a single isolated hunk, and that reverting it
  // reproduces the original cold-load cutoff (M15 acceptance criterion).
  // Runs against a detached git worktree checked out at the pre-fix commit,
  // never against the live tree, and never touches the live service on 7787.
  // =====================================================================
  console.log("\n=== PHASE REVERT-CONTROL: the idleTimeout fix is a single revertible hunk ===");
  let revertControlPassed = true;
  let worktreePath: string | null = null;
  let worktreeAdded = false;
  let worktreeRemoved = false;

  const livePidBefore = await getListeningPid(7787);
  console.log(`  Live service pid on 7787 before this phase: ${livePidBefore ?? "<none found>"} (RESTART recorded ${newPid})`);

  try {
    worktreePath = join(tmpdir(), `m15-revert-control-${Date.now()}`);
    console.log(`  git -C ${HARNESS_REPO} worktree add --detach ${worktreePath} ${REVERT_BASELINE_COMMIT}`);
    const addResult = await runCommand([
      "git",
      "-C",
      HARNESS_REPO,
      "worktree",
      "add",
      "--detach",
      worktreePath,
      REVERT_BASELINE_COMMIT,
    ]);
    console.log(`  exit status: ${addResult.exitCode}`);
    if (addResult.stdout.trim()) console.log(`  stdout: ${addResult.stdout.trim()}`);
    if (addResult.stderr.trim()) console.log(`  stderr: ${addResult.stderr.trim()}`);
    worktreeAdded = addResult.exitCode === 0;

    if (!worktreeAdded) {
      console.log("  FAIL - git worktree add failed; cannot proceed with the revert control.");
      revertControlPassed = false;
    } else {
      const nodeModulesSrc = join(HARNESS_REPO, "node_modules");
      const nodeModulesDst = join(worktreePath, "node_modules");
      console.log(`  ln -s ${nodeModulesSrc} ${nodeModulesDst}`);
      symlinkSync(nodeModulesSrc, nodeModulesDst);

      // ---- AC3: the revert really is the single hunk, verified BEFORE anything runs ----
      const baselineServerPath = join(worktreePath, "harness/api/server.ts");
      const grepResult = await runCommand(["grep", "-c", "idleTimeout", baselineServerPath]);
      const grepCount = parseInt(grepResult.stdout.trim() || "0", 10);
      console.log(`  grep -c "idleTimeout" ${baselineServerPath} -> ${grepCount}`);
      const grepOk = grepCount === 0;
      console.log(
        grepOk
          ? '  PASS - the baseline worktree copy of server.ts has no "idleTimeout" occurrences'
          : `  FAIL - the baseline worktree copy of server.ts still mentions "idleTimeout" (${grepCount} occurrence(s))`
      );

      const diffStat = await runCommand(["git", "-C", HARNESS_REPO, "diff", "--stat", "HEAD"]);
      console.log(`  git -C ${HARNESS_REPO} diff --stat HEAD:`);
      console.log(diffStat.stdout.trimEnd().length > 0 ? diffStat.stdout.trimEnd() : "    <empty>");

      const statusPorcelain = await runCommand(["git", "-C", HARNESS_REPO, "status", "--porcelain"]);
      console.log(`  git -C ${HARNESS_REPO} status --porcelain:`);
      console.log(statusPorcelain.stdout.trimEnd().length > 0 ? statusPorcelain.stdout.trimEnd() : "    <empty>");

      const modifiedTrackedFiles = diffStat.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.includes("|"))
        .map((l) => l.split("|")[0]!.trim());
      console.log(`  Modified tracked files per --stat: ${modifiedTrackedFiles.join(", ") || "<none>"}`);
      const diffOk = modifiedTrackedFiles.length === 1 && modifiedTrackedFiles[0] === "harness/api/server.ts";
      console.log(
        diffOk
          ? "  PASS - exactly one tracked file modified: harness/api/server.ts"
          : `  FAIL - expected only harness/api/server.ts modified among tracked files, found: ${modifiedTrackedFiles.join(", ") || "<none>"}`
      );

      const precheckPassed = grepOk && diffOk;
      if (!precheckPassed) revertControlPassed = false;

      if (!precheckPassed) {
        console.log(
          "\n  SKIPPED A/B - the single-hunk revert precondition failed; running the comparison would prove nothing."
        );
      } else if (!ac13Passed || !identifiedProfile) {
        console.log(
          "\n  FAIL - AC13 did not identify a tier (or failed); refusing to guess which profile to test the revert against."
        );
        revertControlPassed = false;
      } else {
        const profile = identifiedProfile;
        const prompt = "Reply with the single word: ready";
        console.log(`\n  Using the tier identified by AC13's measurement for the A/B: id="${profile.id}" label="${profile.label}"`);

        // ---- B (control, reverted): run FIRST, so an unexpectedly fast ----
        // ---- cold load doesn't waste a cold load on A first.           ----
        console.log("\n  --- B (control, reverted): cold load against the pre-fix baseline (from the worktree) ---");
        const bColdPassed = await forceCold("REVERT-CONTROL-B-COLD");
        if (!bColdPassed) revertControlPassed = false;

        const bPort = await getFreePort();
        console.log(`  [B] chosen ephemeral port: ${bPort}`);
        const bResult = await withHarnessInstance(worktreePath, bPort, "B", async (bBaseUrl, bLogPath) => {
          const bUp = await waitForLocalUp(bBaseUrl, token, 60_000);
          if (bUp !== 200) {
            console.log(`  FAIL - [B] instance never answered GET ${bBaseUrl}/v1/profiles with 200; log: ${bLogPath}`);
            revertControlPassed = false;
            return null;
          }
          console.log(`  [B] GET ${bBaseUrl}/v1/profiles -> 200: instance is up.`);
          return runProbeGeneration(bBaseUrl, token, profile, prompt, "B");
        });

        if (bResult) {
          if (bResult.sawComplete) {
            console.log(
              "\n  FAIL - [B] the negative control COMPLETED NORMALLY (a `complete` event arrived): the revert " +
                "demonstration is INCONCLUSIVE -- it does not reproduce the pre-fix cutoff, most likely because the " +
                "model loaded in under ~10s this run."
            );
            revertControlPassed = false;
          } else if (!(bResult.elapsedSeconds > 5 && bResult.elapsedSeconds < 60)) {
            console.log(
              `  FAIL - [B] stream ended without \`complete\` at t=${bResult.elapsedSeconds.toFixed(3)}s, outside the expected (5s, 60s) idle-timeout band`
            );
            revertControlPassed = false;
          } else {
            console.log(
              `  PASS - [B] stream ended without \`complete\` at t=${bResult.elapsedSeconds.toFixed(3)}s, inside the (5s, 60s) band -- the pre-fix cutoff reproduced`
            );
          }
        }

        // ---- A (fixed): the working tree, which carries the change ----
        console.log("\n  --- A (fixed): cold load against the working tree, which carries the change ---");
        const aColdPassed = await forceCold("REVERT-CONTROL-A-COLD");
        if (!aColdPassed) revertControlPassed = false;

        const aPort = await getFreePort();
        console.log(`  [A] chosen ephemeral port: ${aPort}`);
        const aResult = await withHarnessInstance(HARNESS_REPO, aPort, "A", async (aBaseUrl, aLogPath) => {
          const aUp = await waitForLocalUp(aBaseUrl, token, 60_000);
          if (aUp !== 200) {
            console.log(`  FAIL - [A] instance never answered GET ${aBaseUrl}/v1/profiles with 200; log: ${aLogPath}`);
            revertControlPassed = false;
            return null;
          }
          console.log(`  [A] GET ${aBaseUrl}/v1/profiles -> 200: instance is up.`);
          return runProbeGeneration(aBaseUrl, token, profile, prompt, "A");
        });

        if (aResult) {
          if (!aResult.sawContent || !aResult.sawComplete) {
            console.log(
              `  FAIL - [A] expected both a content event and a complete event; content=${aResult.sawContent} complete=${aResult.sawComplete}`
            );
            revertControlPassed = false;
          } else if (!(aResult.largestGapSeconds > 10.0)) {
            console.log(`  FAIL - [A] largest idle gap was ${aResult.largestGapSeconds.toFixed(3)}s, expected > 10.0s`);
            revertControlPassed = false;
          } else {
            console.log(
              `  PASS - [A] content and complete both arrived; largest idle gap ${aResult.largestGapSeconds.toFixed(3)}s > 10.0s`
            );
          }
        }

        console.log("\n  --- REVERT-CONTROL timelines, side by side ---");
        console.log("  metric                | B (reverted, cold)                    | A (fixed, cold)");
        console.log(
          `  events, in order      | ${bResult ? bResult.eventKinds.join(",") || "<none>" : "<did not run>"} | ${aResult ? aResult.eventKinds.join(",") || "<none>" : "<did not run>"}`
        );
        console.log(
          `  stream ended at (s)   | ${bResult ? bResult.elapsedSeconds.toFixed(3) : "n/a"} | ${aResult ? aResult.elapsedSeconds.toFixed(3) : "n/a"}`
        );
        console.log(
          `  saw content           | ${bResult ? bResult.sawContent : "n/a"} | ${aResult ? aResult.sawContent : "n/a"}`
        );
        console.log(
          `  saw complete          | ${bResult ? bResult.sawComplete : "n/a"} | ${aResult ? aResult.sawComplete : "n/a"}`
        );
        console.log(
          `  largest idle gap (s)  | ${bResult ? "n/a (killed before completing)" : "n/a"} | ${aResult ? aResult.largestGapSeconds.toFixed(3) : "n/a"}`
        );
        console.log(`  stream error, if any  | ${bResult?.threw ?? "<none>"} | ${aResult?.threw ?? "<none>"}`);
      }
    }
  } catch (error) {
    console.log(`  FAIL - REVERT-CONTROL phase threw: ${(error as Error).message}`);
    revertControlPassed = false;
  } finally {
    if (worktreeAdded && worktreePath) {
      console.log(`\n  git -C ${HARNESS_REPO} worktree remove --force ${worktreePath}`);
      const removeResult = await runCommand([
        "git",
        "-C",
        HARNESS_REPO,
        "worktree",
        "remove",
        "--force",
        worktreePath,
      ]);
      console.log(`  exit status: ${removeResult.exitCode}`);
      if (removeResult.stdout.trim()) console.log(`  stdout: ${removeResult.stdout.trim()}`);
      if (removeResult.stderr.trim()) console.log(`  stderr: ${removeResult.stderr.trim()}`);
      worktreeRemoved = removeResult.exitCode === 0;
      console.log(`  Worktree removal ${worktreeRemoved ? "SUCCEEDED" : "FAILED"}.`);
      if (!worktreeRemoved) revertControlPassed = false;
    } else {
      console.log("\n  No worktree was added (or add failed); nothing to remove.");
    }
  }

  // ---- AC6: the live service on 7787 is untouched by this phase ----
  console.log("\n  --- confirming the live service on 7787 is untouched ---");
  const livePidAfter = await getListeningPid(7787);
  console.log(`  Live service pid on 7787: before=${livePidBefore ?? "<none>"} after=${livePidAfter ?? "<none>"}`);
  if (livePidBefore === null || livePidAfter === null || livePidBefore !== livePidAfter) {
    console.log("  FAIL - the pid listening on 7787 changed (or could not be determined) across this phase");
    revertControlPassed = false;
  } else {
    console.log(`  PASS - the same pid (${livePidBefore}) is listening on 7787 before and after this phase`);
  }

  let liveStillUp = false;
  try {
    const res = await fetch(`${baseUrl}/v1/profiles`, { headers: { authorization: `Bearer ${token}` } });
    console.log(`  GET ${baseUrl}/v1/profiles -> ${res.status}`);
    liveStillUp = res.status === 200;
  } catch (error) {
    console.log(`  GET ${baseUrl}/v1/profiles threw: ${(error as Error).message}`);
  }
  console.log(
    liveStillUp
      ? "  PASS - the live service still answers 200 after this phase"
      : "  FAIL - the live service did not answer 200 after this phase"
  );
  if (!liveStillUp) revertControlPassed = false;

  console.log(revertControlPassed ? "PHASE REVERT-CONTROL: PASS" : "PHASE REVERT-CONTROL: FAIL");
  allPassed = allPassed && revertControlPassed;

  // =====================================================================
  // Final summary
  // =====================================================================
  console.log("\n=== M15 ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(`RESTART - live harness replaced with the idleTimeout-fixed code, confirmed serving: ${restartPassed ? "PASS" : "FAIL"}`);
  console.log(`READBACK - HARNESS_IDLE_TIMEOUT_SECONDS=255 is real on a running Bun.serve surface: ${readbackPassed ? "PASS" : "FAIL"}`);
  console.log(
    `AC13 - sweep of batch-class profiles (each own forced cold start) identifies, by measured idle gap, the tier that previously died: ${ac13Passed ? "PASS" : "FAIL"}` +
      (identifiedProfile ? ` (identified: id="${identifiedProfile.id}" label="${identifiedProfile.label}")` : "")
  );
  console.log(`COLD (before AC12) - the identified tier forced cold again: ${cold2Passed ? "PASS" : "FAIL"}`);
  console.log(`AC12 - cold load driven through the UI, on the identified tier, completes with output rendered and no error surfaced: ${ac12Passed ? "PASS" : "FAIL"}`);
  console.log(
    `REVERT-CONTROL - the idleTimeout change is a single revertible hunk, and reverting it reproduces the pre-fix cutoff on loopback: ${revertControlPassed ? "PASS" : "FAIL"} (worktree removed: ${worktreeRemoved})`
  );

  if (allPassed) {
    console.log("\nM15 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM15 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  console.log("\nM15 LIVE PROOF: FAIL");
  process.exit(1);
});
