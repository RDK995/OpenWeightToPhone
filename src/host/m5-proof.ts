import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import {
  createApiClient,
  HarnessApiError,
  type ApiClient,
} from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import {
  createSessionCoordinator,
  type SendResult,
  type ResumeResult,
} from "../../web/src/session-coordinator.ts";
import type { HarnessEvent } from "../../web/src/sse-reader.ts";

const SHORT_PROMPT = "Reply with just the single word 'ready'.";
// Long enough to produce a genuine run of several content deltas so there is
// something real in flight to kill mid-stream (same rationale/shape as
// LONG_PROMPT in m4-proof.ts, just a little longer so 3 deltas is nowhere
// near the end of the generation).
const LONG_PROMPT =
  "Write eight to ten sentences describing a long, meandering walk through a " +
  "quiet autumn forest, including the sounds, smells, and colors along the way.";

/**
 * Wraps an events AsyncIterable with a pure pass-through tee that records
 * each event's seq into `sink` as a side effect. It changes nothing about
 * the sequence of events and does none of the decision-making (progress
 * recording, terminal handling, text accumulation) that is C9's job -
 * instrumentation only, in the same spirit as the admitted-generation
 * tracking wrappers below and in m4-proof.ts's `lastAdmitted`.
 */
function withSeqCapture(
  events: AsyncIterable<HarnessEvent>,
  sink: number[]
): AsyncIterable<HarnessEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of events) {
        sink.push(event.seq);
        yield event;
      }
    },
  };
}

async function main() {
  // Read config
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token present: ${token.length > 0} (length ${token.length})`);

  const sharedStorage = createMemoryStorage();
  const credentialStore = createCredentialStore(sharedStorage);
  credentialStore.setCredential({ baseUrl, token });

  const apiClient = createApiClient({
    baseUrl,
    getToken: () => credentialStore.getToken(),
  });

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
    console.log("\nM5 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  const profile = profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
  console.log(`Using profile: id=${profile.id} latency_class=${profile.latency_class}`);

  // ---------------------------------------------------------------------
  // PHASE 1 - the mid-stream transport kill (Acceptance Criterion 3, the
  // vacuity guard). This is the most important phase in the script: a run
  // that could not abort mid-stream MUST fail loudly here, never pass with
  // a warning.
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 1: MID-STREAM TRANSPORT KILL (vacuity guard) ===");

  const conversationStoreA = createConversationStore(sharedStorage);

  const abortController = new AbortController();
  const firstConnectionSeqs: number[] = [];
  let admittedGeneration1: { sessionId: string; generationId: string } | null = null;

  // Thin instrumentation wrapper around apiClient.generate: injects the
  // AbortController's signal (sessionCoordinator.send() itself takes no
  // signal in its public handlers, so this is the only way to perform a
  // genuine transport kill while still driving the coordinator's public
  // send() method - see the "signal support on generate" note in
  // api-client.ts) and tees each event's seq into firstConnectionSeqs. It
  // does not perform any of C9's decision-making itself.
  const dropApiClient: ApiClient = {
    ...apiClient,
    async generate(sessionId, options) {
      const result = await apiClient.generate(sessionId, {
        ...options,
        signal: abortController.signal,
      });
      admittedGeneration1 = { sessionId, generationId: result.generationId };
      return {
        generationId: result.generationId,
        events: withSeqCapture(result.events, firstConnectionSeqs),
      };
    },
  };

  const sessionCoordinatorA = createSessionCoordinator({
    apiClient: dropApiClient,
    conversationStore: conversationStoreA,
  });

  const conversation1 = conversationStoreA.createConversation({ profileId: profile.id });
  console.log(`Created conversation: ${conversation1.id}`);

  let deltaCount = 0;
  let abortIssued = false;
  let terminalKindObserved: string | null = null;

  let sendResult1: SendResult | null = null;
  let sendError1: unknown = null;
  try {
    sendResult1 = await sessionCoordinatorA.send(conversation1.id, LONG_PROMPT, {
      onDelta: () => {
        deltaCount++;
        if (deltaCount === 3 && !abortIssued) {
          abortIssued = true;
          // Kill the transport mid-stream: at least 3 content deltas have
          // just been observed (asserted below) and no terminal event has
          // been processed yet - events are consumed strictly in seq order
          // and the loop stops the instant a terminal event is seen, so a
          // 3rd content delta structurally cannot follow a terminal event.
          abortController.abort();
        }
      },
      onComplete: () => {
        terminalKindObserved = "complete";
      },
      onError: () => {
        terminalKindObserved = "error";
      },
      onCancelled: () => {
        terminalKindObserved = "cancelled";
      },
    });
  } catch (error) {
    sendError1 = error;
  }

  async function drainIfAdmitted(
    admitted: { sessionId: string; generationId: string } | null,
    label: string
  ): Promise<void> {
    if (!admitted) return;
    try {
      const snapshot = await apiClient.getSession(admitted.sessionId);
      const gen = snapshot.generations.find(
        (g) => g.generation_id === admitted.generationId
      );
      if (gen && (gen.status === "queued" || gen.status === "in_flight")) {
        console.log(
          `  draining leftover ${label} generation ${admitted.generationId} (status=${gen.status})`
        );
        await apiClient.cancel(admitted.sessionId, admitted.generationId);
      }
    } catch (drainError) {
      console.log(
        `  WARNING - drain of ${label} failed: ${
          drainError instanceof Error ? drainError.message : String(drainError)
        }`
      );
    }
  }

  console.log(`  Content deltas observed before abort: ${deltaCount}`);
  console.log(`  Abort issued mid-stream: ${abortIssued}`);
  console.log(
    `  Terminal kind observed on first connection (if any): ${terminalKindObserved ?? "none"}`
  );
  console.log(
    `  send() outcome: ${
      sendError1
        ? `threw (${sendError1 instanceof Error ? sendError1.message : String(sendError1)})`
        : `resolved with status "${sendResult1?.status}"`
    }`
  );

  // THE VACUITY GUARD. Both facts are asserted explicitly: (a) at least 3
  // content deltas were actually observed, and (b) the abort happened
  // before any terminal event (send() must have failed with a transport
  // error, not resolved normally).
  if (!abortIssued) {
    console.log(
      `FAIL - Criterion 3 (vacuity guard): fewer than 3 content deltas were observed ` +
        `(got ${deltaCount}) before the stream reached a terminal state ` +
        `(${terminalKindObserved ?? "none"}). The abort was never issued, so a mid-stream ` +
        `kill could not be proven. A vacuous pass is not acceptable here.`
    );
    await drainIfAdmitted(admittedGeneration1, "generation1");
    console.log("\nM5 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }
  if (!sendError1) {
    console.log(
      `FAIL - Criterion 3 (vacuity guard): abort() was issued after ${deltaCount} content ` +
        `deltas, but sessionCoordinator.send() resolved normally with status ` +
        `"${sendResult1?.status}" instead of throwing a transport failure. The abort did not ` +
        `actually interrupt the connection mid-stream, so nothing was left running to resume ` +
        `- this would be a vacuous pass.`
    );
    console.log("\nM5 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  console.log(
    `  Vacuity guard satisfied: ${deltaCount} content deltas were actually observed ` +
      `(>= 3 required) before abort was issued, no terminal event had been observed at that ` +
      `point, and send() failed with a transport error as expected: ` +
      `${sendError1 instanceof Error ? sendError1.message : String(sendError1)}`
  );
  console.log("Criterion 3 (mid-stream transport kill is genuine, not vacuous): PASS");

  // ---------------------------------------------------------------------
  // PHASE 2 - status between drop and resume: a dropped connection must
  // leave the generation running, not cancel it.
  // ---------------------------------------------------------------------
  console.log(
    "\n=== PHASE 2: STATUS BETWEEN DROP AND RESUME (dropped connection leaves generation running) ==="
  );

  const conversation1AfterDrop = conversationStoreA.getConversation(conversation1.id);
  if (!conversation1AfterDrop?.sessionId || !conversation1AfterDrop.pending) {
    console.log(
      "FAIL - conversation has no sessionId/pending after the drop; cannot proceed to resume"
    );
    await drainIfAdmitted(admittedGeneration1, "generation1");
    console.log("\nM5 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  const sessionId1 = conversation1AfterDrop.sessionId;
  const generationId1 = conversation1AfterDrop.pending.generationId;
  const partialTextAtDrop = conversation1AfterDrop.pending.partialText;
  console.log(
    `  Persisted pending after drop: generationId=${generationId1} ` +
      `lastSeq=${conversation1AfterDrop.pending.lastSeq} ` +
      `partialText=${JSON.stringify(partialTextAtDrop)}`
  );

  let criterionDroppedRunningPassed = true;

  // Deliberate direct C7 call - the out-of-band status read required by
  // criterion 4 ("(derived: FR7) A dropped connection leaves the generation
  // running"): this must be an independent check of the service's own
  // record, not anything derived from the coordinator's local state.
  const snapshotAfterDrop = await apiClient.getSession(sessionId1);
  const matchingGenAfterDrop = snapshotAfterDrop.generations.find(
    (g) => g.generation_id === generationId1
  );
  console.log(
    `  Observed live status via GET /v1/sessions/${sessionId1}: ${matchingGenAfterDrop?.status ?? "not found"}`
  );

  if (!matchingGenAfterDrop) {
    console.log("  FAIL - generation not found in session snapshot");
    criterionDroppedRunningPassed = false;
  } else if (
    matchingGenAfterDrop.status === "cancelled" ||
    matchingGenAfterDrop.status === "complete"
  ) {
    console.log(
      `  FAIL - status is "${matchingGenAfterDrop.status}"; a dropped connection must NOT cancel or complete the generation`
    );
    criterionDroppedRunningPassed = false;
  } else if (
    matchingGenAfterDrop.status !== "queued" &&
    matchingGenAfterDrop.status !== "in_flight"
  ) {
    console.log(
      `  FAIL - unexpected status "${matchingGenAfterDrop.status}", expected "queued" or "in_flight"`
    );
    criterionDroppedRunningPassed = false;
  }

  if (criterionDroppedRunningPassed) {
    console.log(
      "Criterion (derived FR7 - dropped connection leaves generation running, not cancelled): PASS"
    );
  } else {
    console.log(
      "Criterion (derived FR7 - dropped connection leaves generation running, not cancelled): FAIL"
    );
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 3 - resume from a genuinely fresh coordinator, and prove the seq
  // union (Criteria 5 and 6: AC7's no-gaps/no-duplicates/terminal-delivered,
  // and the fresh-coordinator resume).
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 3: FRESH-COORDINATOR RESUME + SEQ UNION ===");

  // A genuinely fresh ConversationStore and SessionCoordinator, built over
  // the SAME sharedStorage instance used above, using the plain (unwrapped)
  // apiClient. Nothing from the interrupted run - conversationStoreA,
  // sessionCoordinatorA, dropApiClient, abortController, deltaCount, or any
  // other local variable holding partial text/lastSeq - is reused here.
  console.log(
    "  Fresh objects for resume: conversationStoreFresh (new), sessionCoordinatorFresh (new), " +
      "apiClient (plain, unwrapped) - all over the SAME sharedStorage instance."
  );
  const conversationStoreFresh = createConversationStore(sharedStorage);
  const sessionCoordinatorFresh = createSessionCoordinator({
    apiClient,
    conversationStore: conversationStoreFresh,
  });

  let criterionFreshCoordinatorPassed = true;
  let criterionAC7Passed = true;

  let resumeResult1: ResumeResult | null = null;
  let resumeError1: unknown = null;
  try {
    resumeResult1 = await sessionCoordinatorFresh.resumeIfInterrupted(conversation1.id);
  } catch (error) {
    resumeError1 = error;
  }

  if (resumeError1) {
    console.log(
      `  FAIL - resumeIfInterrupted threw: ${
        resumeError1 instanceof Error ? resumeError1.message : String(resumeError1)
      }`
    );
    criterionFreshCoordinatorPassed = false;
    criterionAC7Passed = false;
  } else if (!resumeResult1 || !resumeResult1.resumed) {
    console.log("  FAIL - resumeIfInterrupted reported nothing to resume (resumed=false)");
    criterionFreshCoordinatorPassed = false;
    criterionAC7Passed = false;
  } else if (resumeResult1.reconciledFromSession) {
    console.log(
      "  FAIL - resume unexpectedly fell back to reconciling from the session snapshot " +
        "(seq_not_available); this run cannot prove the primary resume path"
    );
    criterionFreshCoordinatorPassed = false;
    criterionAC7Passed = false;
  } else {
    console.log(
      `  Resume succeeded from the fresh coordinator. status=${resumeResult1.status} ` +
        `text (recovered from persisted storage, not a local variable)=${JSON.stringify(resumeResult1.text)}`
    );
    const textFromStorage = resumeResult1.text.startsWith(partialTextAtDrop);
    console.log(`  Recovered text starts with the partial text persisted before resume: ${textFromStorage}`);
    if (!textFromStorage) {
      console.log(
        `  FAIL - resumed text does not start with the partial text persisted at drop time ` +
          `(partialTextAtDrop=${JSON.stringify(partialTextAtDrop)})`
      );
      criterionFreshCoordinatorPassed = false;
    }

    if (resumeResult1.status === null) {
      console.log("  FAIL - no terminal event was delivered on the resumed connection");
      criterionAC7Passed = false;
    } else {
      console.log(`  Terminal event delivered on resumed connection: status=${resumeResult1.status}`);
    }

    // Criterion 6 - prove the seq union: no gaps, no duplicates, across the
    // seqs observed on the first (dropped) connection and the seqs returned
    // by the resumed connection.
    const resumedSeqs = resumeResult1.seqs;
    const allSeqs = [...firstConnectionSeqs, ...resumedSeqs];
    const uniqueSeqCount = new Set(allSeqs).size;
    const sortedSeqs = [...allSeqs].sort((a, b) => a - b);
    const minSeq = sortedSeqs[0];
    const maxSeq = sortedSeqs[sortedSeqs.length - 1];
    let contiguous = allSeqs.length > 0;
    if (allSeqs.length > 0) {
      for (let i = 0; i < sortedSeqs.length; i++) {
        if (sortedSeqs[i] !== minSeq! + i) {
          contiguous = false;
          break;
        }
      }
    }
    console.log(
      `  First connection seqs: [${firstConnectionSeqs.join(",")}] (n=${firstConnectionSeqs.length})`
    );
    console.log(`  Resumed connection seqs: [${resumedSeqs.join(",")}] (n=${resumedSeqs.length})`);
    console.log(
      `  Union bounds: [${minSeq}..${maxSeq}], count=${allSeqs.length}, ` +
        `unique=${uniqueSeqCount === allSeqs.length}, contiguous=${contiguous}`
    );

    if (allSeqs.length === 0) {
      console.log("  FAIL - no seqs observed on either connection");
      criterionAC7Passed = false;
    }
    if (uniqueSeqCount !== allSeqs.length) {
      console.log("  FAIL - a seq appeared more than once across the two connections (duplicate)");
      criterionAC7Passed = false;
    }
    if (!contiguous) {
      console.log("  FAIL - the union of seqs is not contiguous (a gap exists)");
      criterionAC7Passed = false;
    }
  }

  await drainIfAdmitted(admittedGeneration1, "generation1 (post-resume safety net)");

  if (criterionAC7Passed) {
    console.log(
      "Criterion (AC7 - mid-stream kill + resume: no gaps, no duplicates, terminal delivered): PASS"
    );
  } else {
    console.log(
      "Criterion (AC7 - mid-stream kill + resume: no gaps, no duplicates, terminal delivered): FAIL"
    );
    allPassed = false;
  }

  if (criterionFreshCoordinatorPassed) {
    console.log(
      "Criterion (derived FR7 - resume succeeds from a genuinely fresh coordinator, no in-memory carry-over): PASS"
    );
  } else {
    console.log(
      "Criterion (derived FR7 - resume succeeds from a genuinely fresh coordinator, no in-memory carry-over): FAIL"
    );
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // PHASE 4 - prove the seq_not_available fallback live (edge case,
  // Criterion 7), on a second, separate generation run to completion.
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE 4: seq_not_available FALLBACK (edge case) ===");

  let criterionSeqFallbackPassed = true;

  const conversation2 = conversationStoreFresh.createConversation({ profileId: profile.id });
  console.log(`Created conversation: ${conversation2.id}`);

  let admittedGeneration2: { sessionId: string; generationId: string } | null = null;
  const trackingApiClient2: ApiClient = {
    ...apiClient,
    async generate(sessionId, options) {
      const result = await apiClient.generate(sessionId, options);
      admittedGeneration2 = { sessionId, generationId: result.generationId };
      return result;
    },
  };
  const sessionCoordinatorForGen2 = createSessionCoordinator({
    apiClient: trackingApiClient2,
    conversationStore: conversationStoreFresh,
  });

  let sendResult2: SendResult | null = null;
  try {
    // Allowed to run to completion, unlike generation1.
    sendResult2 = await sessionCoordinatorForGen2.send(conversation2.id, SHORT_PROMPT);
    admittedGeneration2 = null; // reached terminal normally, nothing to drain
  } catch (error) {
    console.log(
      `  FAIL - second generation's send() failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    criterionSeqFallbackPassed = false;
  }

  await drainIfAdmitted(admittedGeneration2, "generation2");

  if (sendResult2) {
    const conversation2After = conversationStoreFresh.getConversation(conversation2.id);
    const sessionId2 = conversation2After?.sessionId ?? null;
    if (!sessionId2) {
      console.log("  FAIL - conversation2 has no sessionId after a completed send()");
      criterionSeqFallbackPassed = false;
    } else {
      // Deliberate direct C7 call - required to discover the generation's
      // actual last_seq so the bad-resume probe below can construct a seq
      // that is genuinely out of range (last_seq + 1000), per criterion 7.
      const snapshot2 = await apiClient.getSession(sessionId2);
      const matchingGen2 = snapshot2.generations.find(
        (g) => g.generation_id === sendResult2!.generationId
      );

      if (!matchingGen2) {
        console.log("  FAIL - second generation not found in its own session snapshot");
        criterionSeqFallbackPassed = false;
      } else {
        const badSeq = matchingGen2.last_seq + 1000;
        console.log(
          `  Second generation last_seq=${matchingGen2.last_seq}; probing resume at seq=${badSeq}`
        );

        // Deliberate direct C7 call - the bad-resume probe itself, required
        // by criterion 7: sessionCoordinator.resumeIfInterrupted() only
        // ever resumes from the conversation's own persisted
        // pending.lastSeq, so proving the live 409 from an arbitrary
        // out-of-range seq requires calling apiClient.resumeEvents
        // directly.
        let probeError: unknown = null;
        try {
          await apiClient.resumeEvents(sessionId2, sendResult2.generationId, badSeq);
        } catch (error) {
          probeError = error;
        }

        if (!(probeError instanceof HarnessApiError)) {
          console.log(
            `  FAIL - expected a HarnessApiError from the bad-resume probe, got: ${
              probeError instanceof Error ? probeError.message : String(probeError)
            }`
          );
          criterionSeqFallbackPassed = false;
        } else {
          console.log(
            `  Bad-resume probe result: HarnessApiError code=${probeError.code} status=${probeError.status}`
          );
          if (probeError.code !== "seq_not_available" || probeError.status !== 409) {
            console.log(
              `  FAIL - expected code "seq_not_available" and status 409, got ` +
                `code="${probeError.code}" status=${probeError.status}`
            );
            criterionSeqFallbackPassed = false;
          }
        }

        // Now prove the client's fallback: arrange the conversation's
        // persisted pending to carry the unreachable lastSeq (via
        // ConversationStore.recordProgress, a legitimate C9-level call, not
        // a bypass of it), then drive resumeIfInterrupted() through the
        // coordinator's public method as normal.
        conversationStoreFresh.recordProgress(conversation2.id, {
          generationId: sendResult2.generationId,
          lastSeq: badSeq,
          status: "in_flight",
          partialText: "",
        });

        let fallbackResult: ResumeResult | null = null;
        let fallbackError: unknown = null;
        try {
          fallbackResult = await sessionCoordinatorFresh.resumeIfInterrupted(conversation2.id);
        } catch (error) {
          fallbackError = error;
        }

        if (fallbackError) {
          console.log(
            `  FAIL - resumeIfInterrupted threw instead of falling back: ${
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            }`
          );
          criterionSeqFallbackPassed = false;
        } else if (!fallbackResult || !fallbackResult.reconciledFromSession) {
          console.log(
            `  FAIL - expected reconciledFromSession=true, got ${fallbackResult?.reconciledFromSession}`
          );
          criterionSeqFallbackPassed = false;
        } else {
          console.log(`  Recovered status via fallback: ${fallbackResult.status}`);
          const conversation2Reconciled = conversationStoreFresh.getConversation(conversation2.id);
          const reconciledAssistantTurn = conversation2Reconciled?.turns.find(
            (t) => t.role === "assistant"
          );
          if (!reconciledAssistantTurn) {
            console.log(
              "  FAIL - transcript was not reconciled from the session snapshot (no assistant turn found locally)"
            );
            criterionSeqFallbackPassed = false;
          } else if (reconciledAssistantTurn.content !== sendResult2!.text) {
            console.log(
              "  FAIL - reconciled transcript content does not match the completed generation's text"
            );
            console.log(`    reconciled: ${JSON.stringify(reconciledAssistantTurn.content)}`);
            console.log(`    expected:   ${JSON.stringify(sendResult2!.text)}`);
            criterionSeqFallbackPassed = false;
          } else {
            console.log(
              `  Transcript reconciled from session snapshot: assistant turn content matches service`
            );
          }
        }
      }
    }
  }

  if (criterionSeqFallbackPassed) {
    console.log(
      "Criterion (edge case - seq_not_available 409 + client fallback reconciliation): PASS"
    );
  } else {
    console.log(
      "Criterion (edge case - seq_not_available 409 + client fallback reconciliation): FAIL"
    );
    allPassed = false;
  }

  // ---------------------------------------------------------------------
  // Final per-criterion summary, naming all four M5 acceptance criteria.
  // ---------------------------------------------------------------------
  console.log("\n=== M5 ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(
    `AC7 - killing the connection mid-stream and resuming with Last-Event-ID yields no gaps, ` +
      `no duplicates, and delivers the terminal event (proven live): ${criterionAC7Passed ? "PASS" : "FAIL"}`
  );
  console.log(
    `Derived (FR7) - a dropped connection leaves the generation running, status read as ` +
      `"queued"/"in_flight" (not "cancelled") between drop and resume (proven live): ` +
      `${criterionDroppedRunningPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `Derived (FR7) - a resume succeeds from a coordinator constructed fresh from persisted ` +
      `storage alone, with no in-memory carry-over: ${criterionFreshCoordinatorPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `Derived (edge case) - a resume point older than the buffer surfaces seq_not_available ` +
      `(409) as its own typed error, and the client falls back to reconciling from ` +
      `GET /v1/sessions/{id}: ${criterionSeqFallbackPassed ? "PASS" : "FAIL"}`
  );

  if (allPassed) {
    console.log("\nM5 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM5 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
