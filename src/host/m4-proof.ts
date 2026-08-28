import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import { createApiClient, type ApiClient } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import {
  createSessionCoordinator,
  type SendResult,
} from "../../web/src/session-coordinator.ts";

const SHORT_PROMPT = "Reply with just the single word 'ready'.";
// Long enough to produce a stream of content deltas so there is genuinely
// something in flight to cancel mid-generation.
const LONG_PROMPT =
  "Write four or five sentences describing a quiet walk through a forest in autumn.";

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

  // Same safety-net pattern as m3-proof.ts: the session coordinator clears
  // its own pending-generation bookkeeping before rethrowing "Stream ended
  // without terminal event", so by the time sessionCoordinator.send() throws
  // there is no way to recover the generationId from the conversation store.
  // This wrapper records the (sessionId, generationId) of the most recently
  // admitted generation the moment it is admitted, so a stuck generation can
  // still be cancelled and the single global slot released.
  let lastAdmitted: { sessionId: string; generationId: string } | null = null;
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

  async function releaseIfStuck(): Promise<void> {
    const stuck = getLastAdmitted();
    if (!stuck) return;
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

  let allPassed = true;

  // ---------------------------------------------------------------------
  // PHASE 0 - discovery: profile ids are fetched at runtime, never hardcoded
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 0: DISCOVERY ===");
  const profiles = await apiClient.listProfiles();
  for (const p of profiles) {
    console.log(`  id=${p.id} latency_class=${p.latency_class} label=${p.label}`);
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    console.log("FAIL - no live profiles discovered, cannot proceed");
    console.log("\nM4 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  const profile = profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
  console.log(`Using profile: id=${profile.id} latency_class=${profile.latency_class}`);

  // ---------------------------------------------------------------------
  // PHASE 1 - Criterion 1 (AC6): cancel mid-generation returns "cancelled"
  // and output stops
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 1: CRITERION 1 - CANCEL MID-GENERATION ===");

  const conversation1 = conversationStore.createConversation({ profileId: profile.id });
  console.log(`Created conversation: ${conversation1.id}`);

  let deltaCount = 0;
  let deltaCountAtCancel: number | null = null;
  let cancelIssued = false;
  let cancelPromise: Promise<{ status: string }> | null = null;
  // Read through a function (rather than the bare variable) so TypeScript's
  // control-flow narrowing does not assume the value observed before
  // sessionCoordinator.send() still holds after an await that may have let
  // the onDelta closure below reassign it - same rationale as
  // getLastAdmitted() above and in m3-proof.ts.
  function getCancelPromise(): Promise<{ status: string }> | null {
    return cancelPromise;
  }
  let cancelledEventSeen = false;
  let deltaAfterCancelledEvent = false;

  let sendResult1: SendResult | null = null;
  let criterion1Passed = true;

  lastAdmitted = null;
  try {
    sendResult1 = await sessionCoordinator.send(conversation1.id, LONG_PROMPT, {
      onDelta: (delta) => {
        deltaCount++;
        if (cancelledEventSeen) {
          // A content delta arrived after the terminal cancelled event -
          // output did not actually stop.
          deltaAfterCancelledEvent = true;
        }
        if (!cancelIssued) {
          cancelIssued = true;
          deltaCountAtCancel = deltaCount;
          // Cancel must be *initiated* here, synchronously inside the
          // onDelta callback, while send() is still consuming the stream:
          // cancel() needs the conversation's `pending` record, which
          // send() writes before consuming the stream and clears only on
          // the terminal path. onDelta itself is synchronous, so the
          // promise is stored in an outer variable and awaited after
          // send() resolves - never awaited (or swallowed) inside onDelta.
          cancelPromise = sessionCoordinator.cancel(conversation1.id);
        }
      },
      onCancelled: () => {
        cancelledEventSeen = true;
      },
    });
    lastAdmitted = null;
  } catch (error) {
    console.log(
      `  send() failed: ${error instanceof Error ? error.message : String(error)}`
    );
    criterion1Passed = false;
  }

  await releaseIfStuck();

  if (!cancelIssued || !getCancelPromise()) {
    console.log("  FAIL - no content delta arrived; cancel was never issued");
    criterion1Passed = false;
  }

  let cancelResult1: { status: string } | null = null;
  const pendingCancelPromise = getCancelPromise();
  if (pendingCancelPromise) {
    try {
      cancelResult1 = await pendingCancelPromise;
    } catch (error) {
      console.log(
        `  sessionCoordinator.cancel() rejected: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      criterion1Passed = false;
    }
  }

  console.log(`  Deltas before cancel issued: ${deltaCountAtCancel ?? "n/a"}`);
  console.log(`  Deltas total (final): ${deltaCount}`);
  console.log(`  cancel() status: ${cancelResult1?.status ?? "n/a"}`);
  console.log(`  send() status: ${sendResult1?.status ?? "n/a (threw)"}`);

  if (cancelResult1?.status !== "cancelled") {
    console.log(
      `  FAIL - cancel() did not return status "cancelled" (got ${cancelResult1?.status})`
    );
    criterion1Passed = false;
  }
  if (sendResult1?.status !== "cancelled") {
    console.log(
      `  FAIL - send() SendResult.status was not "cancelled" (got ${sendResult1?.status})`
    );
    criterion1Passed = false;
  }
  if (!cancelledEventSeen) {
    console.log("  FAIL - onCancelled handler never fired");
    criterion1Passed = false;
  }
  if (deltaAfterCancelledEvent) {
    console.log("  FAIL - a content delta arrived after the terminal cancelled event");
    criterion1Passed = false;
  }

  if (criterion1Passed) {
    console.log(
      "Criterion 1 (AC6 - cancel mid-generation returns cancelled and output stops): PASS"
    );
  } else {
    console.log(
      "Criterion 1 (AC6 - cancel mid-generation returns cancelled and output stops): FAIL"
    );
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 2 - Criterion 2: idempotent cancel returns the ACTUAL final status
  //
  // NOTE: This phase proves the idempotency contract for TWO of the three
  // terminal states the requirement names: already-complete, already-failed,
  // and already-cancelled. Sub-case A exercises "complete" and sub-case B
  // exercises "cancelled" live against the API. The already-"failed" state
  // is NOT exercised, because a failed generation cannot be induced from the
  // client: malformed requests are rejected at the HTTP layer with 4xx before
  // any generation id exists (e.g., POST with nonexistent profile_id -> HTTP 400
  // {"api_version":"v1","error":"unknown_profile"}; POST with empty prompt ->
  // HTTP 400 {"api_version":"v1","error":"invalid_request"}; POST to nonexistent
  // session -> HTTP 404 {"api_version":"v1","error":"unknown_session"}). The only
  // remaining routes to a "failed" generation are inference_failed (requires the
  // backend inference to fail, no client-side lever) and generation_timed_out
  // (a 300s wait, out of budget). The "failed" case therefore rests on the
  // documented API contract and on the fact that cancel() forwards the service's
  // status string verbatim with no per-value branching — i.e. on inference, not
  // on live proof.
  // ---------------------------------------------------------------------
  console.log(
    "\n=== PHASE 2: CRITERION 2 - IDEMPOTENT CANCEL RETURNS THE ACTUAL FINAL STATUS ==="
  );

  let criterion2Passed = true;

  // Sub-case A: a generation that already reached "complete". cancel() must
  // return "complete", NOT "cancelled". sessionCoordinator.cancel() cannot be
  // used here: send() calls conversationStore.recordProgress(id, null) on
  // every terminal path (including complete), clearing `pending`, so C9's
  // cancel() would throw "No generation in flight for conversation: <id>".
  // This is a deliberate, commented direct use of apiClient.cancel() for
  // this sub-case only - Criterion 1 above exercises the architected
  // C10 -> C9 -> C7 path via sessionCoordinator.cancel().
  const conversation2 = conversationStore.createConversation({ profileId: profile.id });
  console.log(`Created conversation: ${conversation2.id}`);

  lastAdmitted = null;
  let sendResult2: SendResult | null = null;
  try {
    sendResult2 = await sessionCoordinator.send(conversation2.id, SHORT_PROMPT);
    lastAdmitted = null;
  } catch (error) {
    console.log(
      `  send() failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await releaseIfStuck();

  if (!sendResult2 || sendResult2.status !== "complete") {
    console.log(
      `  FAIL - generation did not reach complete (status=${sendResult2?.status ?? "threw"})`
    );
    criterion2Passed = false;
  } else {
    const conversation2Updated = conversationStore.getConversation(conversation2.id);
    const sessionId2 = conversation2Updated?.sessionId ?? null;
    if (!sessionId2) {
      console.log("  FAIL - conversation has no sessionId after a completed send()");
      criterion2Passed = false;
    } else {
      // Deliberate direct apiClient.cancel() call - see comment above.
      const completeCancelResult = await apiClient.cancel(
        sessionId2,
        sendResult2.generationId
      );
      console.log(
        `  cancel(already-complete generation) status: ${completeCancelResult.status}`
      );
      if (completeCancelResult.status !== "complete") {
        console.log(
          `  FAIL - expected status "complete" for cancelling an already-complete generation, got "${completeCancelResult.status}"`
        );
        criterion2Passed = false;
      }
    }
  }

  // Sub-case B: re-cancel the already-cancelled Criterion 1 generation, at
  // least twice. Its `pending` is likewise cleared by send()'s terminal
  // path, so this too goes through apiClient.cancel() directly rather than
  // sessionCoordinator.cancel().
  if (!sendResult1 || sendResult1.status !== "cancelled") {
    console.log("  FAIL - Criterion 1 did not produce a cancelled generation to re-cancel");
    criterion2Passed = false;
  } else {
    const conversation1Updated = conversationStore.getConversation(conversation1.id);
    const sessionId1 = conversation1Updated?.sessionId ?? null;
    if (!sessionId1) {
      console.log("  FAIL - conversation1 has no sessionId");
      criterion2Passed = false;
    } else {
      for (let i = 1; i <= 2; i++) {
        const repeatCancelResult = await apiClient.cancel(sessionId1, sendResult1.generationId);
        console.log(
          `  re-cancel #${i} of already-cancelled generation status: ${repeatCancelResult.status}`
        );
        if (repeatCancelResult.status !== "cancelled") {
          console.log(
            `  FAIL - re-cancel #${i} did not return "cancelled", got "${repeatCancelResult.status}"`
          );
          criterion2Passed = false;
        }
      }
    }
  }

  if (criterion2Passed) {
    console.log("Criterion 2 (idempotent cancel returns the actual final status: complete, cancelled): PASS");
  } else {
    console.log("Criterion 2 (idempotent cancel returns the actual final status: complete, cancelled): FAIL");
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 3 - Criterion 3: local transcript agrees with the service
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 3: CRITERION 3 - LOCAL TRANSCRIPT AGREES WITH THE SERVICE ===");

  let criterion3Passed = true;

  const localConversation1 = conversationStore.getConversation(conversation1.id);
  const localAssistantTurn = localConversation1?.turns.find(
    (t) => t.role === "assistant"
  );

  if (!localConversation1 || !localAssistantTurn) {
    console.log("  FAIL - no local assistant turn found");
    criterion3Passed = false;
  } else {
    console.log(
      `  Local turn: role=${localAssistantTurn.role} cancelled=${localAssistantTurn.cancelled} content=${JSON.stringify(localAssistantTurn.content)}`
    );

    const sessionId1 = localConversation1.sessionId;
    if (!sessionId1) {
      console.log("  FAIL - local conversation has no sessionId");
      criterion3Passed = false;
    } else {
      const snapshot = await apiClient.getSession(sessionId1);
      const serviceAssistantTurn = snapshot.turns.find(
        (t) => t.role === "assistant"
      );
      if (!serviceAssistantTurn) {
        console.log("  FAIL - no service-side assistant turn found");
        criterion3Passed = false;
      } else {
        console.log(
          `  Service turn: role=${serviceAssistantTurn.role} cancelled=${serviceAssistantTurn.cancelled} content=${JSON.stringify(serviceAssistantTurn.content)}`
        );

        if (localAssistantTurn.cancelled !== serviceAssistantTurn.cancelled) {
          console.log(
            `  FAIL - cancelled flag differs: local=${localAssistantTurn.cancelled} service=${serviceAssistantTurn.cancelled}`
          );
          criterion3Passed = false;
        }
        if (localAssistantTurn.content !== serviceAssistantTurn.content) {
          console.log("  FAIL - content differs between local transcript and service");
          console.log(`    local:   ${JSON.stringify(localAssistantTurn.content)}`);
          console.log(`    service: ${JSON.stringify(serviceAssistantTurn.content)}`);
          criterion3Passed = false;
        }
      }
    }
  }

  if (criterion3Passed) {
    console.log("Criterion 3 (local transcript agrees with the service): PASS");
  } else {
    console.log("Criterion 3 (local transcript agrees with the service): FAIL");
    allPassed = false;
  }

  // Final result
  if (allPassed) {
    console.log("\nM4 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM4 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
