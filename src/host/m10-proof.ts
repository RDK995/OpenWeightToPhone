// M10 live proof: mechanically demonstrates the three agent-provable derived
// criteria of the milestone (manifest/icons resolve, network-first cache
// survives a rebuild, launch agent starts and restarts the asset server) and
// installs the production launch agent as part of doing so.
//
// AC10 itself -- "the app installs to the iOS home screen and runs in
// standalone mode" -- is HUMAN-ATTESTED and is NOT covered by this script.
// This script proves only the three derived criteria below; it must never
// claim, print, or imply anything about the on-device install.

import { mkdtemp, cp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { resolveBaseUrl, resolvePwaPort, resolveBundleRoot, APP_MOUNT_PATH } from "./config.ts";
import { createPwaServer } from "./pwa-server.ts";
import { build } from "../../scripts/build.ts";
import { handleShellRequest, CACHE_NAME, CACHE_VERSION } from "../../web/src/sw.ts";
import {
  LAUNCH_AGENT_LABEL,
  launchAgentPlistPath,
  renderPlist,
  installLaunchAgent,
  createRealLaunchAgentDeps,
} from "./launch-agent.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(bytes: Uint8Array | Buffer | ArrayBuffer): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return createHash("sha256").update(view).digest("hex");
}

/** Returns the loopback listener PIDs on `port`, via `lsof -ti tcp:<port>`. */
async function pidsOnPort(port: number): Promise<number[]> {
  const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`], { stdout: "pipe", stderr: "pipe" });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseInt(line, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Waits for `port` to settle on exactly one listening PID, seen on two
 * consecutive polls, excluding `exclude` if given. Right after a launchd
 * kickstart/restart, `lsof` can transiently report an outgoing and an
 * incoming process on the same port at once; treating a single unstable
 * reading as authoritative risks acting on a PID that is already gone (and
 * whose number the OS may already have reused for something unrelated).
 */
async function waitForStablePid(
  port: number,
  timeoutMs: number,
  intervalMs: number,
  exclude: number | null = null
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let lastCandidate: number | null = null;
  for (;;) {
    const pids = (await pidsOnPort(port)).filter((p) => p !== exclude);
    const candidate = pids.length === 1 ? pids[0]! : null;
    if (candidate !== null && candidate === lastCandidate) {
      return candidate;
    }
    lastCandidate = candidate;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/** Polls `check` every `intervalMs` until it returns truthy or `timeoutMs` elapses. */
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

async function fetchStatus(url: string): Promise<number | null> {
  try {
    const res = await fetch(url);
    return res.status;
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const mount = APP_MOUNT_PATH;

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mount path: ${mount}`);

  let allPassed = true;

  // =====================================================================
  // PHASE 1: Manifest and icons resolve at the served origin.
  // =====================================================================
  console.log("\n=== PHASE 1: MANIFEST AND ICONS RESOLVE AT THE SERVED ORIGIN ===");
  let phase1Passed = true;

  const shellUrl = `${baseUrl}${mount}/`;
  console.log(`  GET ${shellUrl}`);
  try {
    const shellRes = await fetch(shellUrl);
    console.log(`  status=${shellRes.status} content-type=${shellRes.headers.get("content-type")}`);
    if (shellRes.status !== 200) {
      console.log(`  FAIL - expected 200, got ${shellRes.status}`);
      phase1Passed = false;
    }
    const contentType = shellRes.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/html")) {
      console.log(`  FAIL - expected a text/html content type, got "${contentType}"`);
      phase1Passed = false;
    }
    const shellBody = await shellRes.text();
    if (!shellBody.includes('rel="manifest"')) {
      console.log('  FAIL - shell body does not contain rel="manifest"');
      phase1Passed = false;
    } else {
      console.log('  Shell body contains rel="manifest": confirmed');
    }
    if (!shellBody.includes("apple-mobile-web-app-capable")) {
      console.log("  FAIL - shell body does not contain apple-mobile-web-app-capable");
      phase1Passed = false;
    } else {
      console.log("  Shell body contains apple-mobile-web-app-capable: confirmed");
    }
  } catch (error) {
    console.log(`  FAIL - could not fetch ${shellUrl}: ${(error as Error).message}`);
    phase1Passed = false;
  }

  const manifestUrl = `${baseUrl}${mount}/app.webmanifest`;
  console.log(`  GET ${manifestUrl}`);
  let manifest: { display?: unknown; start_url?: unknown; icons?: unknown } | null = null;
  try {
    const manifestRes = await fetch(manifestUrl);
    console.log(
      `  status=${manifestRes.status} content-type=${manifestRes.headers.get("content-type")}`
    );
    if (manifestRes.status !== 200) {
      console.log(`  FAIL - expected 200, got ${manifestRes.status}`);
      phase1Passed = false;
    }
    const manifestContentType = manifestRes.headers.get("content-type") ?? "";
    if (manifestContentType !== "application/manifest+json") {
      console.log(
        `  FAIL - expected Content-Type application/manifest+json, got "${manifestContentType}"`
      );
      phase1Passed = false;
    }
    const manifestBody = await manifestRes.text();
    try {
      manifest = JSON.parse(manifestBody);
      console.log("  Manifest body parsed as JSON: confirmed");
    } catch (parseError) {
      console.log(
        `  FAIL - manifest body is not valid JSON: ${(parseError as Error).message}`
      );
      console.log(`  Raw manifest body: ${manifestBody}`);
      phase1Passed = false;
    }
  } catch (error) {
    console.log(`  FAIL - could not fetch ${manifestUrl}: ${(error as Error).message}`);
    phase1Passed = false;
  }

  if (manifest) {
    console.log(`  display="${manifest.display}" start_url="${manifest.start_url}"`);
    if (manifest.display !== "standalone") {
      console.log(`  FAIL - expected display "standalone", got "${manifest.display}"`);
      phase1Passed = false;
    } else {
      console.log('  display === "standalone": confirmed');
    }
    if (typeof manifest.start_url !== "string" || !manifest.start_url.startsWith(`${mount}/`)) {
      console.log(`  FAIL - expected start_url to start with "${mount}/", got "${manifest.start_url}"`);
      phase1Passed = false;
    } else {
      console.log(`  start_url starts with "${mount}/": confirmed`);
    }

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    if (icons.length === 0) {
      console.log("  FAIL - manifest declares no icons");
      phase1Passed = false;
    }
    for (const icon of icons) {
      const src = (icon as { src?: unknown }).src;
      if (typeof src !== "string") {
        console.log(`  FAIL - icon entry has a non-string src: ${JSON.stringify(icon)}`);
        phase1Passed = false;
        continue;
      }
      const iconUrl = new URL(src, `${baseUrl}/`).toString();
      try {
        const iconRes = await fetch(iconUrl);
        const iconBuf = new Uint8Array(await iconRes.arrayBuffer());
        const iconContentType = iconRes.headers.get("content-type") ?? "";
        console.log(
          `  icon ${iconUrl} -> status=${iconRes.status} content-type=${iconContentType} bytes=${iconBuf.length}`
        );

        if (iconRes.status !== 200) {
          console.log(`    FAIL - expected 200, got ${iconRes.status}`);
          phase1Passed = false;
        }
        if (!iconContentType.startsWith("image/")) {
          console.log(`    FAIL - expected an image/* content type, got "${iconContentType}"`);
          phase1Passed = false;
        }
        if (iconBuf.length === 0) {
          console.log("    FAIL - icon body is empty");
          phase1Passed = false;
        }
        const signatureMatches = PNG_SIGNATURE.every((byte, i) => iconBuf[i] === byte);
        if (!signatureMatches) {
          console.log(
            `    FAIL - first 8 bytes are not the PNG signature: ${Array.from(iconBuf.slice(0, 8))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ")}`
          );
          phase1Passed = false;
        }
      } catch (error) {
        console.log(`  FAIL - could not fetch icon ${iconUrl}: ${(error as Error).message}`);
        phase1Passed = false;
      }
    }
  }

  console.log(phase1Passed ? "PHASE 1: PASS" : "PHASE 1: FAIL");
  allPassed = allPassed && phase1Passed;

  // =====================================================================
  // PHASE 2: A rebuilt bundle is not pinned behind a stale cache.
  // =====================================================================
  console.log("\n=== PHASE 2: A REBUILT BUNDLE IS NOT PINNED BEHIND A STALE CACHE ===");
  let phase2Passed = true;
  let tmpDir: string | null = null;
  let tempServer: Bun.Server<never> | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "m10-proof-"));
    console.log(`  Temp dir: ${tmpDir}`);

    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const tmpWeb = join(tmpDir, "web");
    await cp(join(repoRoot, "web"), tmpWeb, { recursive: true });
    await rm(join(tmpWeb, "dist"), { recursive: true, force: true });
    console.log(`  Copied web/ into ${tmpWeb} (dist removed)`);

    await build({ root: tmpDir });
    const mainJsPath = join(tmpWeb, "dist", "main.js");
    const build1Bytes = await readFile(mainJsPath);
    const build1Hash = sha256(build1Bytes);
    console.log(`  BUILD 1: main.js sha256=${build1Hash} (${build1Bytes.length} bytes)`);

    tempServer = createPwaServer({ port: 0, bundleRoot: join(tmpWeb, "dist") });
    const tempPort = tempServer.port;
    console.log(`  Temp asset server listening on ${tempServer.url} (port ${tempPort})`);

    const cacheStore = new Map<string, ArrayBuffer>();
    const deps = {
      fetch: (req: Request) => fetch(req),
      cacheMatch: async (req: Request): Promise<Response | undefined> => {
        const cached = cacheStore.get(req.url);
        if (!cached) return undefined;
        return new Response(cached, { status: 200 });
      },
      cachePut: async (req: Request, res: Response): Promise<void> => {
        cacheStore.set(req.url, await res.arrayBuffer());
      },
    };

    const mainJsUrl = `http://127.0.0.1:${tempPort}/app/main.js`;

    const warmResponse = await handleShellRequest(new Request(mainJsUrl), deps);
    const warmBody = new Uint8Array(await warmResponse.arrayBuffer());
    const warmHash = sha256(warmBody);
    console.log(`  Warm call returned sha256=${warmHash}`);
    if (warmHash !== build1Hash) {
      console.log(`  FAIL - warm call did not return BUILD 1 (expected ${build1Hash}, got ${warmHash})`);
      phase2Passed = false;
    } else {
      console.log("  Warm call returned BUILD 1: confirmed");
    }
    const cacheAfterWarm = cacheStore.get(mainJsUrl);
    if (!cacheAfterWarm || sha256(cacheAfterWarm) !== build1Hash) {
      console.log("  FAIL - cache does not hold BUILD 1 after the warm call");
      phase2Passed = false;
    } else {
      console.log("  Cache holds BUILD 1 after the warm call: confirmed");
    }

    // Rebuild with a changed source.
    const mainTsPath = join(tmpWeb, "src", "main.ts");
    const mainTsContents = await readFile(mainTsPath, "utf-8");
    await Bun.write(
      mainTsPath,
      `${mainTsContents}\nexport const __M10_PROOF_MARKER = "rebuilt";\n`
    );
    await build({ root: tmpDir });
    const build2Bytes = await readFile(mainJsPath);
    const build2Hash = sha256(build2Bytes);
    console.log(`  BUILD 2: main.js sha256=${build2Hash} (${build2Bytes.length} bytes)`);

    if (build2Hash === build1Hash) {
      console.log("  FAIL - rebuild did not change main.js; this phase proves nothing");
      phase2Passed = false;
    } else {
      console.log("  BUILD 2 !== BUILD 1: confirmed");
    }

    // Discriminating control: the cache still holds the stale BUILD 1 before
    // the second call. A cache-first strategy would return this.
    const cacheBeforeSecondCall = cacheStore.get(mainJsUrl);
    const cacheBeforeSecondCallHash = cacheBeforeSecondCall
      ? sha256(cacheBeforeSecondCall)
      : "<empty>";
    console.log(`  Cache entry BEFORE the second call: sha256=${cacheBeforeSecondCallHash}`);
    if (!cacheBeforeSecondCall || cacheBeforeSecondCallHash !== build1Hash) {
      console.log(
        "  FAIL - discriminating control failed: cache did not hold BUILD 1 before the second call, so this proves nothing"
      );
      phase2Passed = false;
    } else {
      console.log("  Discriminating control confirmed: cache held the stale BUILD 1 going in");
    }

    const secondResponse = await handleShellRequest(new Request(mainJsUrl), deps);
    const secondBody = new Uint8Array(await secondResponse.arrayBuffer());
    const secondHash = sha256(secondBody);
    console.log(`  Second call returned sha256=${secondHash}`);
    if (secondHash !== build2Hash || secondHash === build1Hash) {
      console.log(
        `  FAIL - second call did not return BUILD 2 (expected ${build2Hash}, got ${secondHash})`
      );
      phase2Passed = false;
    } else {
      console.log("  Second call returned BUILD 2, not BUILD 1: confirmed");
    }

    const cacheAfterSecondCall = cacheStore.get(mainJsUrl);
    if (!cacheAfterSecondCall || sha256(cacheAfterSecondCall) !== build2Hash) {
      console.log("  FAIL - cache was not refreshed to BUILD 2 after the second call");
      phase2Passed = false;
    } else {
      console.log("  Cache refreshed to BUILD 2 after the second call: confirmed");
    }

    console.log(`  CACHE_NAME="${CACHE_NAME}" CACHE_VERSION="${CACHE_VERSION}"`);
    if (!CACHE_NAME.includes(CACHE_VERSION)) {
      console.log("  FAIL - CACHE_NAME does not contain CACHE_VERSION");
      phase2Passed = false;
    } else {
      console.log("  CACHE_NAME contains CACHE_VERSION: confirmed");
    }
  } catch (error) {
    console.log(`  FAIL - phase 2 threw: ${(error as Error).message}`);
    phase2Passed = false;
  } finally {
    if (tempServer) {
      tempServer.stop(true);
      console.log("  Temp asset server stopped");
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      console.log(`  Removed ${tmpDir}`);
    }
  }

  console.log(phase2Passed ? "PHASE 2: PASS" : "PHASE 2: FAIL");
  allPassed = allPassed && phase2Passed;

  // =====================================================================
  // PHASE 3: The launch agent starts the asset server and restarts it
  // after it dies. Installs the PRODUCTION agent -- this is the
  // milestone's deliverable, not a side effect to clean up.
  // =====================================================================
  console.log(
    "\n=== PHASE 3: LAUNCH AGENT STARTS THE ASSET SERVER AND RESTARTS IT AFTER IT DIES ==="
  );
  let phase3Passed = true;

  const port = resolvePwaPort();
  const bundleRoot = resolveBundleRoot();
  const home = homedir();
  const uid = process.getuid?.() ?? 0;
  const plistPath = launchAgentPlistPath(LAUNCH_AGENT_LABEL, home);
  const logDir = join(home, "Library", "Logs", "phone-pwa");
  const bunPath = process.execPath || join(home, ".bun", "bin", "bun");
  const hostDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = dirname(dirname(hostDir));
  const serverScript = join(hostDir, "pwa-server.ts");

  console.log(`  Port: ${port}`);
  console.log(`  Bundle root: ${bundleRoot}`);
  console.log(`  Plist path: ${plistPath}`);
  console.log(`  Bun path: ${bunPath}`);

  const deps = createRealLaunchAgentDeps();

  try {
    await mkdir(logDir, { recursive: true });
    console.log(`  Log directory ensured: ${logDir}`);

    // Free the port: kill whatever is currently listening (the
    // manually-started asset server from earlier milestones).
    const preExistingPids = await pidsOnPort(port);
    if (preExistingPids.length > 0) {
      console.log(`  Freeing port ${port}: killing PID(s) ${preExistingPids.join(", ")}`);
      for (const pid of preExistingPids) {
        try {
          process.kill(pid);
        } catch {
          // Already gone; ignore.
        }
      }
    } else {
      console.log(`  Port ${port} already free before install`);
    }

    const freed = await waitUntil(
      async () => {
        const pids = await pidsOnPort(port);
        return pids.length === 0 ? true : null;
      },
      10_000,
      500
    );
    if (!freed) {
      console.log(`  FAIL - port ${port} did not become free before install`);
      phase3Passed = false;
    } else {
      console.log(`  Port ${port} confirmed free`);
    }

    const plistContents = renderPlist({
      label: LAUNCH_AGENT_LABEL,
      bunPath,
      serverScript,
      workingDirectory: rootDir,
      port,
      bundleRoot,
      stdoutPath: join(logDir, "stdout.log"),
      stderrPath: join(logDir, "stderr.log"),
    });

    await installLaunchAgent(
      { label: LAUNCH_AGENT_LABEL, uid, plistPath, plistContents },
      deps
    );
    console.log(`  installLaunchAgent() completed`);

    const loopbackUrl = `http://127.0.0.1:${port}${mount}/`;

    const startedStatus = await waitUntil(
      () => fetchStatus(loopbackUrl).then((status) => (status === 200 ? status : null)),
      30_000,
      500
    );
    if (startedStatus !== 200) {
      console.log(`  FAIL - ${loopbackUrl} did not return 200 within 30s of install`);
      phase3Passed = false;
    } else {
      console.log(`  ${loopbackUrl} returned 200 after install: confirmed`);
    }

    const pid1 = await waitForStablePid(port, 20_000, 500);
    console.log(`  PID_1 (serving after install): ${pid1 ?? "<none>"}`);
    if (pid1 === null) {
      console.log("  FAIL - could not determine a stable serving PID after install");
      phase3Passed = false;
    }

    if (pid1 !== null) {
      console.log(`  kill -9 ${pid1}`);
      try {
        process.kill(pid1, "SIGKILL");
      } catch (error) {
        console.log(`  FAIL - could not send SIGKILL to PID_1 ${pid1}: ${(error as Error).message}`);
        phase3Passed = false;
      }

      const restart = await waitForStablePid(port, 45_000, 500, pid1);

      if (restart !== null) {
        const restartStatus = await fetchStatus(loopbackUrl);
        if (restartStatus !== 200) {
          console.log(
            `  FAIL - a new stable PID ${restart} appeared but ${loopbackUrl} returned ${restartStatus}, not 200`
          );
          phase3Passed = false;
        }
      }

      if (restart === null) {
        console.log(
          `  FAIL - did not observe ${loopbackUrl} serving 200 from a PID different from PID_1 within 45s`
        );
        phase3Passed = false;
      } else {
        console.log(`  PID_2 (serving after restart): ${restart}`);
        console.log("  Launch agent restarted the asset server under a new PID: confirmed");
      }
    }

    const tailnetUrl = `${baseUrl}${mount}/`;
    const tailnetStatus = await fetchStatus(tailnetUrl);
    console.log(`  GET ${tailnetUrl} -> status=${tailnetStatus}`);
    if (tailnetStatus !== 200) {
      console.log(`  FAIL - tailnet origin ${tailnetUrl} did not return 200 after the restart`);
      phase3Passed = false;
    } else {
      console.log("  Tailnet origin serves 200 after the restart: confirmed");
    }
  } catch (error) {
    console.log(`  FAIL - phase 3 threw: ${(error as Error).message}`);
    phase3Passed = false;
  }

  console.log(phase3Passed ? "PHASE 3: PASS" : "PHASE 3: FAIL");
  allPassed = allPassed && phase3Passed;

  console.log(`\n  Launch agent installed: label=${LAUNCH_AGENT_LABEL} plist=${plistPath}`);
  console.log(`  The agent is left loaded and running.`);
  console.log(`  To remove it: launchctl bootout gui/${uid}/${LAUNCH_AGENT_LABEL}`);

  // =====================================================================
  // Final summary
  // =====================================================================
  console.log("\n=== M10 DERIVED-CRITERIA SUMMARY (AC10 itself is human-attested, not proven here) ===");
  console.log(
    `1. Manifest parses, declares standalone display and a start_url under ${mount}/, and every named icon resolves 200 as an image at ${baseUrl}${mount}/: ${phase1Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `2. The service worker registers a versioned cache name and a network-first strategy: a rebuilt bundle is served fresh, not the stale cached build: ${phase2Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `3. The launch agent starts the asset server at load and restarts it after it exits: ${phase3Passed ? "PASS" : "FAIL"}`
  );

  if (allPassed) {
    console.log("\nM10 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM10 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
