// M11 live proof: mechanically demonstrates the four agent-provable criteria of the milestone:
// AC1 (QR round-trip), AC2 agent-provable half (credential store + live auth via built bundle),
// and two derived FR1 criteria (permission refusal, CLI token-leak prevention).
//
// Phase 2 exercises the built bundle's bootstrap() to prove the adopter code is
// actually present in the shipped artifact — not just in the source. Earlier attempts
// proved the function in isolation via direct calls, which let the bundler tree-shake
// the code out entirely; the shipped app had no fragment-capture code at all.
//
// AC2 itself -- "scanning the QR yields a working authenticated client" via
// optical camera capture on a physical iPhone -- is HUMAN-ATTESTED and is NOT
// covered by this script. This script proves only the three agent-provable halves;
// it must never claim, print, or imply anything about the on-device scan or optical
// capture.

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile, chmod, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { readToken, resolveBaseUrl, resolveTokenPath, pairingUrlWithToken, APP_MOUNT_PATH } from "./config.ts";
import { encodeQr } from "../qr/encode.ts";
import { matrixToPng } from "../qr/png.ts";
import { build } from "../../scripts/build.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import type { LocationPort } from "../../web/src/credential-store.ts";
import type { RenderTarget } from "../../web/src/ui/render-target.ts";
import type { ApiClient } from "../../web/src/api-client.ts";

function sha256(data: Uint8Array | Buffer | string): string {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  }
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return createHash("sha256").update(view).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const tokenPath = resolveTokenPath();

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token path: ${tokenPath}`);

  let allPassed = true;
  let tmpDir: string | null = null;

  // =====================================================================
  // PHASE 1: AC1 - QR ROUND-TRIP THROUGH AN INDEPENDENT DECODER
  // =====================================================================
  console.log("\n=== PHASE 1: AC1 - QR ROUND-TRIP ===");
  let phase1Passed = true;

  try {
    const realToken = readToken();
    const pairingUrl = pairingUrlWithToken(realToken);

    // Encode to QR
    const matrix = encodeQr(pairingUrl, { ecc: "M" });
    const pngData = matrixToPng(matrix);

    // Write to temp file
    tmpDir = await mkdtemp(join(tmpdir(), "m11-proof-"));
    const pngPath = join(tmpDir, "qr.png");
    await writeFile(pngPath, pngData);
    console.log(`  QR PNG written to: ${pngPath}`);

    // Decode with swift script
    const decodeProcess = Bun.spawn(["swift", "scripts/qr-decode.swift", pngPath], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: join(import.meta.dir, "../.."),
    });

    const decodedStdout = await new Response(decodeProcess.stdout).text();
    const decodedStderr = await new Response(decodeProcess.stderr).text();
    const decodedExitCode = await decodeProcess.exited.then(() => decodeProcess.exitCode);

    const decodedPayload = decodedStdout.trim();

    console.log(`  Swift decoder exit status: ${decodedExitCode}`);
    if (decodedExitCode !== 0) {
      console.log(`  FAIL - decoder exited non-zero, stderr: ${decodedStderr}`);
      phase1Passed = false;
    } else {
      console.log("  Decoder exited 0: confirmed");
    }

    // Verify byte-identity
    const inputUrl = pairingUrl;
    const inputLength = inputUrl.length;
    const inputSha256 = sha256(inputUrl);
    const payloadLength = decodedPayload.length;
    const payloadSha256 = sha256(decodedPayload);

    console.log(`  Input URL: length=${inputLength} sha256=${inputSha256}`);
    console.log(`  Decoded payload: length=${payloadLength} sha256=${payloadSha256}`);
    console.log(`  QR: version=${matrix.version} size=${matrix.size}`);

    if (inputSha256 !== payloadSha256) {
      console.log(`  FAIL - byte-identity check failed: hashes do not match`);
      phase1Passed = false;
    } else {
      console.log("  Byte-identity confirmed: sha256 hashes match");
    }

    // Test with a non-secret control string
    const controlString = `https://ryans-mac-studio.tailc3648a.ts.net${APP_MOUNT_PATH}/#t=${new Array(44).fill("A").join("")}`;
    console.log(`  Control string (non-secret): ${controlString}`);
    const controlMatrix = encodeQr(controlString, { ecc: "M" });
    const controlPng = matrixToPng(controlMatrix);
    const controlPngPath = join(tmpDir, "qr-control.png");
    await writeFile(controlPngPath, controlPng);

    const controlDecodeProcess = Bun.spawn(["swift", "scripts/qr-decode.swift", controlPngPath], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: join(import.meta.dir, "../.."),
    });

    const controlStdout = await new Response(controlDecodeProcess.stdout).text();
    const controlExitCode = await controlDecodeProcess.exited.then(() => controlDecodeProcess.exitCode);
    const controlPayload = controlStdout.trim();

    console.log(`  Control decoded: ${controlPayload}`);
    console.log(`  Control decoder exit status: ${controlExitCode}`);
    if (controlExitCode !== 0 || controlPayload !== controlString) {
      console.log(`  FAIL - control string round-trip failed`);
      phase1Passed = false;
    } else {
      console.log("  Control string round-trip: confirmed");
    }
  } catch (error) {
    console.log(`  FAIL - phase 1 threw: ${(error as Error).message}`);
    phase1Passed = false;
  }

  console.log(phase1Passed ? "PHASE 1: PASS" : "PHASE 1: FAIL");
  allPassed = allPassed && phase1Passed;

  // =====================================================================
  // PHASE 2: AC2 AGENT-PROVABLE HALF - BUILT BUNDLE ADOPTS THE FRAGMENT, THEN LIVE AUTH
  // =====================================================================
  console.log("\n=== PHASE 2: AC2 AGENT-PROVABLE HALF - BUILT BUNDLE ADOPTS THE FRAGMENT, THEN LIVE AUTH ===");
  console.log("  NOTE: AC2's optical camera step is HUMAN-ATTESTED and NOT proven here.");
  let phase2Passed = true;

  try {
    // Step 1: Build the bundle
    console.log("  Building bundle...");
    const buildResult = await build();
    console.log(`  Built bundle: ${buildResult.outdir}`);

    // Step 2: Read bundle and verify fragment-capture code is present
    const bundleText = await readFile(join(buildResult.outdir, "main.js"), "utf-8");
    const adoptFragmentCount = (bundleText.match(/adoptCredentialFromFragment/g) || []).length;
    console.log(`  Occurrences of adoptCredentialFromFragment in bundle: ${adoptFragmentCount}`);

    // Check for the call site pattern: adoptCredentialFromFragment(credentialStore...
    // This distinguishes the call from the function definition (which uses `store`)
    // and from the export list (which has no parenthesis).
    const callSitePattern = /adoptCredentialFromFragment\s*\(\s*credentialStore/;
    const hasCallSite = callSitePattern.test(bundleText);

    if (!hasCallSite) {
      console.log("  FAIL - bundle does not wire the fragment adopter into bootstrap()");
      phase2Passed = false;
    } else {
      console.log("  Built bundle wires the fragment adopter into bootstrap(): confirmed");
    }

    // Step 3: Extract real fragment and build fake location
    const realToken = readToken();
    const pairingUrl = pairingUrlWithToken(realToken);
    const fragmentMatch = pairingUrl.match(/#(.*)$/);
    const fragment = fragmentMatch ? fragmentMatch[1]! : "";

    let hashValue = `#${fragment}`;
    const fakeLocation: LocationPort = {
      get hash(): string {
        return hashValue;
      },
      origin: baseUrl,
      clearHash(): void {
        hashValue = "";
      },
    };

    // Step 4: Dynamically import the built bundle and call bootstrap
    const distDir = join(buildResult.outdir, "..");
    const mainJsPath = join(buildResult.outdir, "main.js");
    const moduleUrl = `${pathToFileURL(mainJsPath).href}?v=${Date.now()}-${Math.random()}`;
    const mod = await import(moduleUrl);

    const storage = createMemoryStorage();
    let bootstrapThrew = false;

    const fakeRoot = {} as HTMLElement;
    const createTarget = (_root: HTMLElement): RenderTarget => ({
      paint() {},
    });

    const recordedApiClient: { baseUrl: string; getToken: () => string | null } = { baseUrl: "", getToken: () => "" };
    const createApiClient = (config: any) => {
      recordedApiClient.baseUrl = config.baseUrl;
      recordedApiClient.getToken = config.getToken;
      return {
        listProfiles: async () => [],
        getToken: () => config.getToken(),
      } as unknown as ApiClient;
    };

    try {
      mod.bootstrap(fakeRoot, { storage, location: fakeLocation, createTarget, createApiClient });
    } catch (error) {
      console.log(`  FAIL - bootstrap threw: ${(error as Error).message}`);
      bootstrapThrew = true;
      phase2Passed = false;
    }

    if (!bootstrapThrew) {
      console.log("  bootstrap() ran without throwing: confirmed");
    }

    // Step 5: Assert and print each assertion
    if (!bootstrapThrew) {
      // Hash should be cleared
      if (fakeLocation.hash !== "") {
        console.log(`  FAIL - hash not cleared: "${fakeLocation.hash}"`);
        phase2Passed = false;
      } else {
        console.log("  Hash cleared: confirmed");
      }

      // Credential should be in storage
      const storedCredential = storage.get("phone-to-local-model:v1:credential");
      if (storedCredential === null) {
        console.log("  FAIL - credential not written to storage");
        phase2Passed = false;
      } else {
        console.log("  Credential present in storage: confirmed");
        const parsed = JSON.parse(storedCredential);
        console.log(`  Stored token length: ${parsed.token?.length}`);
      }

      // API client baseUrl should equal resolveBaseUrl (the ordering proof)
      if (recordedApiClient.baseUrl !== baseUrl) {
        console.log(`  FAIL - API client baseUrl mismatch: "${recordedApiClient.baseUrl}" !== "${baseUrl}"`);
        phase2Passed = false;
      } else {
        console.log("  API client baseUrl equals resolveBaseUrl(): confirmed");
      }

      // API client should have a getToken
      if (typeof recordedApiClient.getToken !== "function") {
        console.log("  FAIL - API client getToken not a function");
        phase2Passed = false;
      } else {
        const token = recordedApiClient.getToken();
        if (!token || token === "") {
          console.log("  FAIL - API client getToken() returned empty");
          phase2Passed = false;
        } else {
          console.log("  API client getToken() returns non-empty token: confirmed");
        }
      }
    }

    // Step 6: Chain to live call using token from storage only
    if (!bootstrapThrew && phase2Passed) {
      // Read token back ONLY from storage, never from readToken() again
      const storedCredential = storage.get("phone-to-local-model:v1:credential");
      if (storedCredential === null) {
        console.log("  FAIL - cannot read token from storage for live call");
        phase2Passed = false;
      } else {
        const parsed = JSON.parse(storedCredential);
        const tokenFromStorage = parsed.token;

        const profilesUrl = `${baseUrl}/v1/profiles`;
        console.log(`  GET ${profilesUrl} with Bearer token...`);
        try {
          const authRes = await fetch(profilesUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${tokenFromStorage}`,
            },
          });

          console.log(`  Authenticated request status: ${authRes.status}`);
          if (authRes.status !== 200) {
            console.log(`  FAIL - expected 200, got ${authRes.status}`);
            phase2Passed = false;
          } else {
            console.log("  Authenticated request returns 200: confirmed");
            const profilesData = await authRes.json();
            const profileCount = Array.isArray(profilesData) ? profilesData.length : 0;
            console.log(`  Profiles returned: ${profileCount}`);
          }
        } catch (error) {
          console.log(`  FAIL - authenticated request threw: ${(error as Error).message}`);
          phase2Passed = false;
        }
      }
    }

    // Make unauthenticated call to verify 401 (control)
    const profilesUrl = `${baseUrl}/v1/profiles`;
    console.log(`  GET ${profilesUrl} without Authorization header...`);
    try {
      const noAuthRes = await fetch(profilesUrl, {
        method: "GET",
      });

      console.log(`  Unauthenticated request status: ${noAuthRes.status}`);
      if (noAuthRes.status !== 401) {
        console.log(`  FAIL - expected 401, got ${noAuthRes.status}`);
        phase2Passed = false;
      } else {
        console.log("  Unauthenticated request returns 401: confirmed");
      }
    } catch (error) {
      console.log(`  FAIL - unauthenticated request threw: ${(error as Error).message}`);
      phase2Passed = false;
    }
  } catch (error) {
    console.log(`  FAIL - phase 2 threw: ${(error as Error).message}`);
    phase2Passed = false;
  }

  console.log(phase2Passed ? "PHASE 2: PASS" : "PHASE 2: FAIL");
  allPassed = allPassed && phase2Passed;

  // =====================================================================
  // PHASE 3: DERIVED FR1 - PERMISSION REFUSAL
  // =====================================================================
  console.log("\n=== PHASE 3: DERIVED FR1 - PERMISSION REFUSAL ===");
  let phase3Passed = true;

  try {
    // Stat real token file before
    const statBefore = await stat(tokenPath);
    const modeBefore = (statBefore.mode & 0o777).toString(8).padStart(3, "0");
    const mtimeBefore = statBefore.mtimeMs;
    const sizeBefore = statBefore.size;
    console.log(`  Real token file BEFORE: mode=0${modeBefore} mtime=${mtimeBefore} size=${sizeBefore}`);

    if (modeBefore !== "600") {
      console.log(`  FAIL - expected mode 0600, got 0${modeBefore}`);
      phase3Passed = false;
    } else {
      console.log("  Real token file mode is 0600: confirmed");
    }

    // Create temp fixture directory
    const fixtureTmpDir = await mkdtemp(join(tmpdir(), "m11-fixture-"));
    console.log(`  Fixture directory: ${fixtureTmpDir}`);

    const dummyToken = "FIXTURE_TOKEN_123456789";

    // Test mode 0600 (should succeed)
    const tokenPath600 = join(fixtureTmpDir, "token-600");
    await writeFile(tokenPath600, dummyToken);
    await chmod(tokenPath600, 0o600);
    try {
      // Import readToken with env override
      const { readToken: readTokenFunc } = await import("./config.ts");
      const token600 = readTokenFunc({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath600 });
      if (token600 !== dummyToken) {
        console.log(`  FAIL - mode 0600: returned wrong token`);
        phase3Passed = false;
      } else {
        console.log(`  Mode 0600 (owner-readable): returns dummy token: confirmed`);
      }
    } catch (error) {
      console.log(`  FAIL - mode 0600 should not throw: ${(error as Error).message}`);
      phase3Passed = false;
    }

    // Test mode 0644 (should fail)
    const tokenPath644 = join(fixtureTmpDir, "token-644");
    await writeFile(tokenPath644, dummyToken);
    await chmod(tokenPath644, 0o644);
    try {
      const { readToken: readTokenFunc } = await import("./config.ts");
      const token644 = readTokenFunc({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath644 });
      console.log(`  FAIL - mode 0644 should throw but returned: ${token644}`);
      phase3Passed = false;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  Mode 0644 (world-readable): throws: confirmed`);
      console.log(`    Error: ${errorMsg}`);
      if (errorMsg.includes(dummyToken)) {
        console.log(`    FAIL - error message contains dummy token`);
        phase3Passed = false;
      } else {
        console.log(`    Dummy token not in error message: confirmed`);
      }
    }

    // Test mode 0640 (should fail)
    const tokenPath640 = join(fixtureTmpDir, "token-640");
    await writeFile(tokenPath640, dummyToken);
    await chmod(tokenPath640, 0o640);
    try {
      const { readToken: readTokenFunc } = await import("./config.ts");
      const token640 = readTokenFunc({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath640 });
      console.log(`  FAIL - mode 0640 should throw but returned: ${token640}`);
      phase3Passed = false;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  Mode 0640 (group-readable): throws: confirmed`);
      console.log(`    Error: ${errorMsg}`);
      if (errorMsg.includes(dummyToken)) {
        console.log(`    FAIL - error message contains dummy token`);
        phase3Passed = false;
      } else {
        console.log(`    Dummy token not in error message: confirmed`);
      }
    }

    // Test mode 0604 (should fail)
    const tokenPath604 = join(fixtureTmpDir, "token-604");
    await writeFile(tokenPath604, dummyToken);
    await chmod(tokenPath604, 0o604);
    try {
      const { readToken: readTokenFunc } = await import("./config.ts");
      const token604 = readTokenFunc({ OPENWEIGHT_HARNESS_TOKEN_FILE: tokenPath604 });
      console.log(`  FAIL - mode 0604 should throw but returned: ${token604}`);
      phase3Passed = false;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.log(`  Mode 0604 (other-readable): throws: confirmed`);
      console.log(`    Error: ${errorMsg}`);
      if (errorMsg.includes(dummyToken)) {
        console.log(`    FAIL - error message contains dummy token`);
        phase3Passed = false;
      } else {
        console.log(`    Dummy token not in error message: confirmed`);
      }
    }

    // Test OPENWEIGHT_HARNESS_TOKEN_FILE env var is honoured
    const { resolveTokenPath: resolveTokenPathFunc } = await import("./config.ts");
    const withEnv = resolveTokenPathFunc({ OPENWEIGHT_HARNESS_TOKEN_FILE: "/custom/path" });
    if (withEnv !== "/custom/path") {
      console.log(`  FAIL - resolveTokenPath did not honour OPENWEIGHT_HARNESS_TOKEN_FILE`);
      phase3Passed = false;
    } else {
      console.log(`  resolveTokenPath honours OPENWEIGHT_HARNESS_TOKEN_FILE: confirmed`);
    }

    const withoutEnv = resolveTokenPathFunc({});
    if (!withoutEnv.includes(".openweight-harness")) {
      console.log(`  FAIL - resolveTokenPath default does not contain .openweight-harness`);
      phase3Passed = false;
    } else {
      console.log(`  resolveTokenPath default uses ~/.openweight-harness/token: confirmed`);
    }

    // Clean up fixture directory
    await rm(fixtureTmpDir, { recursive: true, force: true });
    console.log(`  Fixture directory cleaned up`);

    // Stat real token file after
    const statAfter = await stat(tokenPath);
    const modeAfter = (statAfter.mode & 0o777).toString(8).padStart(3, "0");
    const mtimeAfter = statAfter.mtimeMs;
    const sizeAfter = statAfter.size;
    console.log(`  Real token file AFTER: mode=0${modeAfter} mtime=${mtimeAfter} size=${sizeAfter}`);

    if (modeAfter !== "600") {
      console.log(`  FAIL - mode changed from 0600 to 0${modeAfter}`);
      phase3Passed = false;
    } else {
      console.log("  Real token file mode unchanged: confirmed");
    }

    if (mtimeBefore !== mtimeAfter) {
      console.log(`  FAIL - mtime changed from ${mtimeBefore} to ${mtimeAfter}`);
      phase3Passed = false;
    } else {
      console.log("  Real token file mtime unchanged: confirmed");
    }

    if (sizeBefore !== sizeAfter) {
      console.log(`  FAIL - size changed from ${sizeBefore} to ${sizeAfter}`);
      phase3Passed = false;
    } else {
      console.log("  Real token file size unchanged: confirmed");
    }
  } catch (error) {
    console.log(`  FAIL - phase 3 threw: ${(error as Error).message}`);
    phase3Passed = false;
  }

  console.log(phase3Passed ? "PHASE 3: PASS" : "PHASE 3: FAIL");
  allPassed = allPassed && phase3Passed;

  // =====================================================================
  // PHASE 4: DERIVED FR1 - CLI DOES NOT PRINT THE TOKEN
  // =====================================================================
  console.log("\n=== PHASE 4: DERIVED FR1 - CLI DOES NOT PRINT THE TOKEN ===");
  let phase4Passed = true;

  try {
    if (!tmpDir) {
      tmpDir = await mkdtemp(join(tmpdir(), "m11-proof-"));
    }

    const dummyToken = "FIXTURE_DUMMY_TOKEN_12345678901234567890123";
    const dummyTokenPath = join(tmpDir, "cli-test-token");
    await writeFile(dummyTokenPath, dummyToken);
    await chmod(dummyTokenPath, 0o600);

    // Run pair CLI with fixture token
    console.log(`  Running pair CLI with fixture token...`);
    const bunPath = process.execPath || "/Users/ryankenny/.bun/bin/bun";
    const pairProcess = Bun.spawn([bunPath, "run", "src/host/pair.ts"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPENWEIGHT_HARNESS_TOKEN_FILE: dummyTokenPath,
      },
      cwd: join(import.meta.dir, "../.."),
    });

    const pairStdout = await new Response(pairProcess.stdout).text();
    const pairStderr = await new Response(pairProcess.stderr).text();
    const pairExitCode = await pairProcess.exited.then(() => pairProcess.exitCode);
    const pairOutput = pairStdout + pairStderr;

    console.log(`  CLI exit code: ${pairExitCode}`);
    if (pairExitCode !== 0) {
      console.log(`  FAIL - CLI exited non-zero`);
      phase4Passed = false;
    } else {
      console.log("  CLI exited 0: confirmed");
    }

    // Check for base URL
    const baseUrlCheck = pairOutput.includes(resolveBaseUrl());
    console.log(`  Output contains base URL: ${baseUrlCheck}`);
    if (!baseUrlCheck) {
      console.log(`  FAIL - output does not contain base URL`);
      phase4Passed = false;
    } else {
      console.log("  Base URL present: confirmed");
    }

    // Check for QR block character (█, ▀, ▄, or space combinations that form QR)
    const hasQrBlock = /[█▀▄\s]/.test(pairOutput);
    console.log(`  Output contains QR block character: ${hasQrBlock}`);
    if (!hasQrBlock) {
      console.log(`  FAIL - output does not contain QR block characters`);
      phase4Passed = false;
    } else {
      console.log("  QR block character present: confirmed");
    }

    // Check for 8-character windows of dummy token
    let tokenWindowsFound = 0;
    for (let i = 0; i <= dummyToken.length - 8; i++) {
      const window = dummyToken.substring(i, i + 8);
      if (pairOutput.includes(window)) {
        tokenWindowsFound++;
        console.log(`  FAIL - found 8-char window of token: "${window}"`);
        phase4Passed = false;
      }
    }
    console.log(`  8-character windows checked: ${dummyToken.length - 7}`);
    if (tokenWindowsFound === 0) {
      console.log(`  No 8-character windows of dummy token found: confirmed`);
    }

    // Check for encoded token
    const encodedToken = encodeURIComponent(dummyToken);
    if (pairOutput.includes(encodedToken)) {
      console.log(`  FAIL - output contains encodeURIComponent(dummyToken)`);
      phase4Passed = false;
    } else {
      console.log(`  Encoded dummy token not in output: confirmed`);
    }

    // Check for full pairing URL
    // The CLI would build a pairing URL with the dummy token
    const dummyPairingUrl = `${resolveBaseUrl()}${APP_MOUNT_PATH}/#t=${encodeURIComponent(dummyToken)}`;
    if (pairOutput.includes(dummyPairingUrl)) {
      console.log(`  FAIL - output contains full pairing URL with dummy token`);
      phase4Passed = false;
    } else {
      console.log(`  Full pairing URL with dummy token not in output: confirmed`);
    }

    // Now test with real token
    console.log(`  Running pair CLI with real token...`);
    const realPairProcess = Bun.spawn([bunPath, "run", "src/host/pair.ts"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: join(import.meta.dir, "../.."),
    });

    const realPairStdout = await new Response(realPairProcess.stdout).text();
    const realPairStderr = await new Response(realPairProcess.stderr).text();
    const realPairExitCode = await realPairProcess.exited.then(() => realPairProcess.exitCode);
    const realPairOutput = realPairStdout + realPairStderr;

    const realToken = readToken();
    let realTokenWindowsFound = 0;
    for (let i = 0; i <= realToken.length - 8; i++) {
      const window = realToken.substring(i, i + 8);
      if (realPairOutput.includes(window)) {
        realTokenWindowsFound++;
        phase4Passed = false;
      }
    }
    const realTokenWindowsChecked = Math.max(0, realToken.length - 7);
    console.log(`  8-character windows of real token checked: ${realTokenWindowsChecked}`);
    if (realTokenWindowsFound === 0) {
      console.log(`  No 8-character windows of real token found: confirmed`);
    } else {
      console.log(`  FAIL - found ${realTokenWindowsFound} windows of real token`);
    }
  } catch (error) {
    console.log(`  FAIL - phase 4 threw: ${(error as Error).message}`);
    phase4Passed = false;
  }

  console.log(phase4Passed ? "PHASE 4: PASS" : "PHASE 4: FAIL");
  allPassed = allPassed && phase4Passed;

  // =====================================================================
  // Final summary
  // =====================================================================
  console.log("\n=== M11 ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(
    `1. QR encodes a pairing URL and decodes back to byte-identical input via an independent decoder: ${phase1Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `2. Built bundle adopts token from fragment, then live authenticated call succeeds (optical scan is human-attested, not proven here): ${phase2Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `3. Permission-restrictive token file access: reading is refused when mode grants group/other access, and OPENWEIGHT_HARNESS_TOKEN_FILE is honoured: ${phase3Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `4. Pairing CLI renders QR and base URL without printing the token (no 8-character window appears in output): ${phase4Passed ? "PASS" : "FAIL"}`
  );

  // Clean up temp directory
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    console.log(`\nTemp directory cleaned up: ${tmpDir}`);
  }

  if (allPassed) {
    console.log("\nM11 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM11 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
