import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import {
  createApiClient,
  HarnessApiError,
  type ApiClient,
  type Profile,
} from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import {
  createSessionCoordinator,
  type SendResult,
} from "../../web/src/session-coordinator.ts";

const SHORT_PROMPT = "Reply with just the single word 'ready'.";

const TERMINAL_GENERATION_STATUSES = ["cancelled", "complete", "failed"];

async function main() {
  // Read config
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token present: ${token.length > 0} (length ${token.length})`);

  // Build module chain
  const storage = createMemoryStorage();
  const credentialStore = createCredentialStore(storage);
  credentialStore.setCredential({ baseUrl, token });

  const apiClient = createApiClient({
    baseUrl,
    getToken: () => credentialStore.getToken(),
  });

  const conversationStore = createConversationStore(storage);

  // The session coordinator clears its own pending-generation bookkeeping
  // before rethrowing "Stream ended without terminal event", so by the time
  // sessionCoordinator.send() throws there is no way to recover the
  // generationId from the conversation store. This wrapper records the
  // (sessionId, generationId) of the most recently admitted generation the
  // moment it is admitted, so a stuck generation can still be cancelled and
  // the single global slot released.
  let lastAdmitted: { sessionId: string; generationId: string } | null = null;
  // Read through a function (rather than the bare variable) so TypeScript's
  // control-flow narrowing does not assume the value observed at the top of
  // guardedSend still holds after an `await` that may have let the
  // trackingApiClient closure below reassign it.
  function getLastAdmitted(): { sessionId: string; generationId: string } | null {
    return lastAdmitted;
  }
  const trackingApiClient: ApiClient = {
    ...apiClient,
    async generate(sessionId, options) {
      const result = await apiClient.generate(sessionId, options);
      lastAdmitted = { sessionId, generationId: result.generationId };
      return result;
    },
  };

  const sessionCoordinator = createSessionCoordinator({
    apiClient: trackingApiClient,
    conversationStore,
  });

  let allPassed = true;

  // ---------------------------------------------------------------------
  // PHASE 1 - discovery (criteria 1 and 2)
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 1: DISCOVERY ===");
  const profiles = await apiClient.listProfiles();
  for (const p of profiles) {
    console.log(
      `  id=${p.id} role=${p.role} quality=${p.quality} latency_class=${p.latency_class} label=${p.label}`
    );
  }

  const phase1Passed = Array.isArray(profiles) && profiles.length >= 3;
  if (phase1Passed) {
    console.log(
      `Criterion 1/2 (profiles fetched dynamically, >=3 live): count=${profiles.length} PASS`
    );
  } else {
    console.log(
      `Criterion 1/2 (profiles fetched dynamically, >=3 live): count=${profiles.length} FAIL - expected at least 3 profiles`
    );
    allPassed = false;
  }

  if (!phase1Passed) {
    console.log("\nM3 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  // ---------------------------------------------------------------------
  // PHASE 2 - every profile is selectable (criterion 1 / AC11)
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 2: EVERY DISCOVERED PROFILE IS SELECTABLE ===");
  let admittedCount = 0;

  for (const profile of profiles) {
    const sessionId = await apiClient.createSession();
    let generationId: string | null = null;

    try {
      const generateResult = await apiClient.generate(sessionId, {
        profileId: profile.id,
        prompt: SHORT_PROMPT,
      });
      generationId = generateResult.generationId;
    } catch (error) {
      console.log(
        `  profile=${profile.id}: generate() threw: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      // Release the slot on every path, including when admission itself failed.
      if (generationId) {
        try {
          const cancelResult = await apiClient.cancel(sessionId, generationId);
          const terminal = TERMINAL_GENERATION_STATUSES.includes(
            cancelResult.status
          );
          console.log(
            `  profile=${profile.id}: admitted generationId=${generationId} cancel_status=${cancelResult.status} ${
              terminal ? "released" : "WARNING - cancel status not terminal"
            }`
          );
          if (terminal) {
            admittedCount++;
          }
        } catch (cancelError) {
          console.log(
            `  profile=${profile.id}: WARNING - cancel() threw: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`
          );
        }
      } else {
        console.log(`  profile=${profile.id}: FAIL - not admitted (no generationId)`);
      }
    }
  }

  const phase2Passed = admittedCount === profiles.length;
  if (phase2Passed) {
    console.log(
      `Criterion 1 (AC11 - all live profiles selectable): admitted=${admittedCount}/${profiles.length} PASS`
    );
  } else {
    console.log(
      `Criterion 1 (AC11 - all live profiles selectable): admitted=${admittedCount}/${profiles.length} FAIL`
    );
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 3 - changing the profile changes the generation (criterion 3)
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 3: CHANGING PROFILE CHANGES THE GENERATION ===");

  const profileA =
    profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
  console.log(
    `Profile A: id=${profileA.id} latency_class=${profileA.latency_class}`
  );

  const conversation = conversationStore.createConversation({
    profileId: profileA.id,
  });
  console.log(`Created conversation: ${conversation.id}`);

  async function guardedSend(
    conversationId: string,
    prompt: string
  ): Promise<SendResult | null> {
    lastAdmitted = null;
    try {
      const result = await sessionCoordinator.send(conversationId, prompt, {
        onQueued: (position) => console.log(`    queued at position ${position}`),
        onModelLoading: () => console.log("    model loading..."),
      });
      // A terminal event was reached: the server itself released the slot.
      lastAdmitted = null;
      return result;
    } catch (error) {
      console.log(
        `    send() failed: ${error instanceof Error ? error.message : String(error)}`
      );
      const stuck = getLastAdmitted();
      if (stuck) {
        console.log(
          `    releasing stuck generation ${stuck.generationId} on session ${stuck.sessionId}`
        );
        try {
          await apiClient.cancel(stuck.sessionId, stuck.generationId);
        } catch (cancelError) {
          console.log(
            `    WARNING - cancel of stuck generation failed: ${
              cancelError instanceof Error ? cancelError.message : String(cancelError)
            }`
          );
        } finally {
          lastAdmitted = null;
        }
      }
      return null;
    }
  }

  let phase3Passed = true;
  let telemetryProfileIdA: string | null = null;

  console.log(`Sending under profile A (${profileA.id})...`);
  const resultA = await guardedSend(conversation.id, SHORT_PROMPT);
  if (resultA && resultA.status === "complete" && resultA.telemetry) {
    telemetryProfileIdA = resultA.telemetry.profile_id;
    console.log(
      `  status=${resultA.status} telemetry.profile_id=${telemetryProfileIdA}`
    );
    if (telemetryProfileIdA !== profileA.id) {
      console.log(
        `  FAIL - telemetry.profile_id (${telemetryProfileIdA}) does not match profile A (${profileA.id})`
      );
      phase3Passed = false;
    }
  } else {
    console.log(
      `  FAIL - generation under profile A did not reach complete (status=${resultA?.status ?? "threw"})`
    );
    phase3Passed = false;
  }

  let profileB: Profile | null = null;
  let telemetryProfileIdB: string | null = null;

  for (const candidate of profiles) {
    if (candidate.id === profileA.id) continue;
    console.log(`Trying profile B candidate: ${candidate.id}...`);
    conversationStore.setProfileId(conversation.id, candidate.id);
    const resultCandidate = await guardedSend(conversation.id, SHORT_PROMPT);
    if (
      resultCandidate &&
      resultCandidate.status === "complete" &&
      resultCandidate.telemetry
    ) {
      profileB = candidate;
      telemetryProfileIdB = resultCandidate.telemetry.profile_id;
      console.log(
        `  candidate=${candidate.id} status=complete telemetry.profile_id=${telemetryProfileIdB}`
      );
      break;
    }
    console.log(
      `  candidate=${candidate.id} did not reach complete (status=${
        resultCandidate?.status ?? "threw"
      }) - trying next candidate`
    );
  }

  if (!profileB || telemetryProfileIdB === null) {
    console.log("  FAIL - no candidate profile B reached complete");
    phase3Passed = false;
  } else {
    if (profileB.id === profileA.id) {
      console.log("  FAIL - profile B equals profile A");
      phase3Passed = false;
    }
    if (telemetryProfileIdB !== profileB.id) {
      console.log(
        `  FAIL - telemetry.profile_id (${telemetryProfileIdB}) does not match profile B (${profileB.id})`
      );
      phase3Passed = false;
    }

    const finalConversation = conversationStore.getConversation(conversation.id);
    if (!finalConversation || finalConversation.profileId !== profileB.id) {
      console.log(
        `  FAIL - stored conversation profileId (${finalConversation?.profileId}) does not equal profile B (${profileB.id})`
      );
      phase3Passed = false;
    }

    console.log(
      `  Profile A: id=${profileA.id} observed telemetry.profile_id=${telemetryProfileIdA}`
    );
    console.log(
      `  Profile B: id=${profileB.id} observed telemetry.profile_id=${telemetryProfileIdB}`
    );
  }

  if (phase3Passed && profileB) {
    console.log(
      `Criterion 3 (profile change confirmed by server telemetry): A=${profileA.id} B=${profileB.id} PASS`
    );
  } else {
    console.log("Criterion 3 (profile change confirmed by server telemetry): FAIL");
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 4 - unknown profile is a typed error (criterion 4)
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 4: UNKNOWN PROFILE IS A TYPED ERROR ===");

  const unknownProfileId = "unknown-profile-" + crypto.randomUUID();
  const knownIds = new Set(profiles.map((p) => p.id));

  let phase4Passed = true;

  if (knownIds.has(unknownProfileId)) {
    console.log(
      `  FAIL - generated id ${unknownProfileId} unexpectedly collides with a live profile`
    );
    phase4Passed = false;
  } else {
    console.log(
      `  Using id ${unknownProfileId} - confirmed absent from Phase 1 list`
    );

    const unknownSessionId = await apiClient.createSession();
    try {
      await apiClient.generate(unknownSessionId, {
        profileId: unknownProfileId,
        prompt: SHORT_PROMPT,
      });
      console.log("  FAIL - generate() did not throw for an unknown profile id");
      phase4Passed = false;
    } catch (error) {
      if (error instanceof HarnessApiError) {
        console.log(`  Caught HarnessApiError code=${error.code} status=${error.status}`);
        if (error.code === "unknown_profile" && error.status === 400) {
          console.log(
            "  code is the specific unknown_profile error, not the generic http_400 fallback"
          );
        } else {
          console.log(
            `  FAIL - expected code=unknown_profile status=400, got code=${error.code} status=${error.status}`
          );
          phase4Passed = false;
        }
      } else {
        console.log(`  FAIL - expected a HarnessApiError, got: ${error}`);
        phase4Passed = false;
      }
    }
  }

  if (phase4Passed) {
    console.log(
      `Criterion 4 (unknown profile is a typed error): unknown_id=${unknownProfileId} PASS`
    );
  } else {
    console.log("Criterion 4 (unknown profile is a typed error): FAIL");
    allPassed = false;
  }

  // Final result
  if (allPassed) {
    console.log("\nM3 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM3 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
