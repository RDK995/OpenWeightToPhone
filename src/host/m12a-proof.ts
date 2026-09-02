// M12a live proof: milestone M12a-ii criterion 6, quoted verbatim:
//
//   (derived: FR1, FR2, live) Pairing with a real token read from
//   ~/.openweight-harness/token yields a working authenticated client against the live
//   harness, proven at a Mac-run entry point rather than asserted from client state.
//
// This script pairs through the real adopter code path (both the pasted-URL form and the
// bare-token form), then makes real, unmodified authenticated network calls against the
// live harness -- one that must succeed and one with a deliberately corrupted credential
// that must be rejected. It never prints the real token, the pairing URL, or any
// percent-encoded form of either.

import { readToken, resolveBaseUrl, pairingUrlWithToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore, adoptCredentialFromPastedText } from "../../web/src/credential-store.ts";
import { createApiClient, HarnessApiError } from "../../web/src/api-client.ts";

// -------------------------------------------------------------------------
// Console capture: every line passed to console.log is recorded so the
// token-leak guard at the end of main() can inspect exactly what was
// printed, not what we believe we printed.
// -------------------------------------------------------------------------
const capturedLines: string[] = [];
const realConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const line = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  capturedLines.push(line);
  realConsoleLog(...args);
};

function redactedPairingUrl(pairingUrl: string, encodedTokenLength: number): string {
  return pairingUrl.replace(/#t=.*$/, `#t=<redacted, ${encodedTokenLength} chars>`);
}

function buildCorruptedToken(realToken: string): string {
  if (realToken.length === 0) {
    return "corrupted";
  }
  const firstChar = realToken[0];
  const replacement = firstChar === "0" ? "1" : "0";
  return replacement + realToken.slice(1);
}

async function main() {
  let allPassed = true;

  console.log("=== STEP 1: READ THE REAL TOKEN ===");
  let realToken: string;
  const baseUrl = resolveBaseUrl();
  console.log(`  Base URL: ${baseUrl}`);
  try {
    realToken = readToken();
  } catch (error) {
    console.log(`  FAIL - could not read token: ${(error as Error).message}`);
    console.log("\nM12A LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }
  console.log(`  Token read: length=${realToken.length}`);
  console.log("STEP 1: PASS");

  console.log("\n=== STEP 2: BUILD THE PAIRING URL ===");
  const pairingUrl = pairingUrlWithToken(realToken);
  const encodedLength = encodeURIComponent(realToken).length;
  console.log(`  Pairing URL: ${redactedPairingUrl(pairingUrl, encodedLength)}`);
  console.log("STEP 2: PASS");

  console.log("\n=== STEP 3: PAIR VIA THE PASTED-URL FORM ===");
  let step3Passed = true;
  const storage1 = createMemoryStorage();
  const store1 = createCredentialStore(storage1);
  const credential1 = adoptCredentialFromPastedText(store1, pairingUrl, "https://unused.example");

  if (credential1 === null) {
    console.log("  FAIL - adoptCredentialFromPastedText returned null for the pairing URL");
    step3Passed = false;
  } else {
    console.log("  adoptCredentialFromPastedText returned a non-null credential: confirmed");
    if (credential1.baseUrl !== baseUrl) {
      console.log(`  FAIL - stored baseUrl "${credential1.baseUrl}" does not equal resolveBaseUrl() "${baseUrl}"`);
      step3Passed = false;
    } else {
      console.log("  Stored baseUrl equals resolveBaseUrl(): confirmed");
      console.log("  (the deliberately wrong currentOrigin argument was NOT used -- the pasted URL's own origin won)");
    }
    if (credential1.token !== realToken) {
      console.log("  FAIL - stored token does not equal the real token");
      step3Passed = false;
    } else {
      console.log("  Stored token equals the real token: confirmed");
    }
  }
  console.log(step3Passed ? "STEP 3: PASS" : "STEP 3: FAIL");
  allPassed = allPassed && step3Passed;

  console.log("\n=== STEP 4: PAIR VIA THE BARE-TOKEN FORM ===");
  let step4Passed = true;
  const storage2 = createMemoryStorage();
  const store2 = createCredentialStore(storage2);
  const credential2 = adoptCredentialFromPastedText(store2, realToken, baseUrl);

  if (credential2 === null) {
    console.log("  FAIL - adoptCredentialFromPastedText returned null for the bare token");
    step4Passed = false;
  } else {
    console.log("  adoptCredentialFromPastedText returned a non-null credential: confirmed");
    if (credential2.baseUrl !== baseUrl) {
      console.log(`  FAIL - stored baseUrl "${credential2.baseUrl}" does not equal resolveBaseUrl() "${baseUrl}"`);
      step4Passed = false;
    } else {
      console.log("  Stored baseUrl equals resolveBaseUrl(): confirmed");
    }
    if (credential2.token !== realToken) {
      console.log("  FAIL - stored token does not equal the real token");
      step4Passed = false;
    } else {
      console.log("  Stored token equals the real token: confirmed");
    }
  }
  console.log(step4Passed ? "STEP 4: PASS" : "STEP 4: FAIL");
  allPassed = allPassed && step4Passed;

  console.log("\n=== STEP 5: REAL AUTHENTICATED REQUEST AGAINST THE LIVE HARNESS ===");
  let step5Passed = true;
  if (credential1 === null) {
    console.log("  SKIPPED - step 3 did not produce a credential to authenticate with");
    step5Passed = false;
  } else {
    const apiClient = createApiClient({
      baseUrl: credential1.baseUrl,
      getToken: () => store1.getToken(),
    });
    try {
      console.log(`  GET ${credential1.baseUrl}/v1/profiles with the real credential...`);
      const profiles = await apiClient.listProfiles();
      if (profiles.length === 0) {
        console.log("  FAIL - listProfiles() returned zero profiles");
        step5Passed = false;
      } else {
        console.log(`  listProfiles() succeeded: ${profiles.length} profile(s) returned`);
        for (const profile of profiles) {
          console.log(`    - ${profile.id}: ${profile.label}`);
        }
      }
    } catch (error) {
      console.log(`  FAIL - authenticated request threw: ${(error as Error).message}`);
      step5Passed = false;
    }
  }
  console.log(step5Passed ? "STEP 5: PASS" : "STEP 5: FAIL");
  allPassed = allPassed && step5Passed;

  console.log("\n=== STEP 6: A CORRUPTED TOKEN IS REJECTED ===");
  let step6Passed = true;
  if (credential1 === null) {
    console.log("  SKIPPED - step 3 did not produce a credential to corrupt");
    step6Passed = false;
  } else {
    const corruptedToken = buildCorruptedToken(realToken);
    const corruptedApiClient = createApiClient({
      baseUrl: credential1.baseUrl,
      getToken: () => corruptedToken,
    });
    try {
      console.log(`  GET ${credential1.baseUrl}/v1/profiles with a deliberately corrupted credential...`);
      await corruptedApiClient.listProfiles();
      console.log("  FAIL - request with a corrupted token succeeded; the harness is not enforcing authentication");
      step6Passed = false;
    } catch (error) {
      if (error instanceof HarnessApiError) {
        console.log(`  Request rejected: status=${error.status} code=${error.code}`);
        if (error.status === 401 && error.code === "unauthorized") {
          console.log("  Rejected with HTTP 401 / unauthorized: confirmed");
        } else {
          console.log(
            `  FAIL - expected status 401 and code "unauthorized", got status ${error.status} and code "${error.code}"`
          );
          step6Passed = false;
        }
      } else {
        console.log(`  FAIL - request threw an unexpected error type: ${(error as Error).message}`);
        step6Passed = false;
      }
    }
  }
  console.log(step6Passed ? "STEP 6: PASS" : "STEP 6: FAIL");
  allPassed = allPassed && step6Passed;

  // =====================================================================
  // STEP 7: FINAL SUMMARY
  // =====================================================================
  console.log("\n=== M12A ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(`1. Real token read from disk via readToken(): PASS`);
  console.log(`2. Pairing URL built via pairingUrlWithToken(): PASS`);
  console.log(`3. Pasted-URL form pairs through the real adopter and the pasted URL's own origin wins: ${step3Passed ? "PASS" : "FAIL"}`);
  console.log(`4. Bare-token form pairs through the real adopter to the same credential: ${step4Passed ? "PASS" : "FAIL"}`);
  console.log(`5. Real authenticated request against the live harness succeeds: ${step5Passed ? "PASS" : "FAIL"}`);
  console.log(`6. Request with a corrupted credential is rejected (401 / unauthorized): ${step6Passed ? "PASS" : "FAIL"}`);

  // =====================================================================
  // Token-leak guard: no 8-character window of the real token, and none of
  // its percent-encoded form, may appear anywhere in anything this script
  // printed.
  // =====================================================================
  const fullOutput = capturedLines.join("\n");
  const encodedRealToken = encodeURIComponent(realToken);
  let leakFound = false;

  for (let i = 0; i <= realToken.length - 8; i++) {
    const window = realToken.slice(i, i + 8);
    if (fullOutput.includes(window)) {
      leakFound = true;
      break;
    }
  }
  if (!leakFound) {
    for (let i = 0; i <= encodedRealToken.length - 8; i++) {
      const window = encodedRealToken.slice(i, i + 8);
      if (fullOutput.includes(window)) {
        leakFound = true;
        break;
      }
    }
  }

  if (leakFound) {
    realConsoleLog(
      "\n!!! TOKEN-LEAK GUARD FAILURE !!! An 8-character window of the token (or its percent-encoded form) appeared in this script's own output."
    );
    realConsoleLog("M12A LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }
  console.log("\nToken-leak guard: no 8-character window of the real token or its percent-encoded form found in output: confirmed");

  if (allPassed) {
    console.log("\nM12A LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM12A LIVE PROOF: FAIL");
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
