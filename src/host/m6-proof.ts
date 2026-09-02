import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import {
  createApiClient,
  HarnessApiError,
  type SessionTurn,
} from "../../web/src/api-client.ts";
import { createConversationStore, type Turn } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";

const NOTED_PROMPT_PREFIX =
  "Remember this 4-digit number for later: ";
const NOTED_PROMPT_SUFFIX =
  ". Reply with only the single word 'noted', nothing else.";
const RECALL_PROMPT =
  "What was the 4-digit number I asked you to remember earlier? " +
  "Reply with only the digits, nothing else.";
const D_PROMPT = "Reply with just the single word 'ready'.";

const INVALID_TOKEN = "invalid-token-for-m6-proof";

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

async function main() {
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

  const conversationStore = createConversationStore(sharedStorage);
  const sessionCoordinator = createSessionCoordinator({
    apiClient,
    conversationStore,
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
    console.log("\nM6 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  const profile =
    profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
  console.log(`Using profile: id=${profile.id} latency_class=${profile.latency_class}`);

  // ---------------------------------------------------------------------
  // PHASE A - establish a real conversation with a memorable fact
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE A: ESTABLISH CONVERSATION WITH A MEMORABLE FACT ===");

  const magicNumber = String(1000 + Math.floor(Math.random() * 9000));
  console.log(`  Random 4-digit number planted this run: ${magicNumber}`);

  const conversation = conversationStore.createConversation({ profileId: profile.id });
  console.log(`  Created conversation: ${conversation.id}`);

  const plantPrompt = `${NOTED_PROMPT_PREFIX}${magicNumber}${NOTED_PROMPT_SUFFIX}`;
  const sendResultA = await sessionCoordinator.send(conversation.id, plantPrompt);

  console.log(`  send() status=${sendResultA.status} text=${JSON.stringify(sendResultA.text)}`);
  console.log(
    `  sessionRebuilt=${sendResultA.sessionRebuilt} replayedTurns=${sendResultA.replayedTurns}`
  );

  let phaseAPassed = true;
  if (sendResultA.status !== "complete") {
    console.log(`  FAIL - expected status "complete", got "${sendResultA.status}"`);
    phaseAPassed = false;
  }
  if (sendResultA.sessionRebuilt !== false) {
    console.log(`  FAIL - expected sessionRebuilt=false, got ${sendResultA.sessionRebuilt}`);
    phaseAPassed = false;
  }
  if (sendResultA.replayedTurns !== 0) {
    console.log(`  FAIL - expected replayedTurns=0, got ${sendResultA.replayedTurns}`);
    phaseAPassed = false;
  }

  const convAfterA = conversationStore.getConversation(conversation.id);
  if (!convAfterA || !convAfterA.sessionId) {
    console.log("  FAIL - conversation has no sessionId after Phase A send()");
    phaseAPassed = false;
  }

  console.log(`  Local transcript after Phase A:`);
  for (const turn of convAfterA?.turns ?? []) {
    console.log(`    role=${turn.role} content=${JSON.stringify(turn.content)}`);
  }
  const phaseASessionId = convAfterA?.sessionId ?? null;
  console.log(`  Real sessionId now stored: ${phaseASessionId}`);

  if (!phaseAPassed || !phaseASessionId) {
    console.log("FAIL - Phase A setup did not hold; cannot proceed to Phase B");
    console.log("\nM6 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  // ---------------------------------------------------------------------
  // PHASE B - induce the 404 and prove recovery (AC8: session-loss recovery)
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE B: INDUCE 404 unknown_session AND PROVE RECOVERY ===");

  const bogusSessionId = crypto.randomUUID();
  console.log(`  Bogus session id: ${bogusSessionId}`);

  let bogusProved = false;
  try {
    await apiClient.getSession(bogusSessionId);
    console.log("  FAIL - expected getSession(bogusSessionId) to reject, but it resolved");
  } catch (error) {
    if (error instanceof HarnessApiError) {
      console.log(
        `  getSession(bogusSessionId) rejected with: code=${error.code} status=${error.status} body=${JSON.stringify(
          error.body
        )}`
      );
      if (error.code === "unknown_session" && error.status === 404) {
        bogusProved = true;
      } else {
        console.log(
          `  FAIL - expected code="unknown_session" status=404, got code="${error.code}" status=${error.status}`
        );
      }
    } else {
      console.log(
        `  FAIL - expected a HarnessApiError, got: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (!bogusProved) {
    console.log(
      "FAIL - could not prove the service genuinely does not hold the bogus session id; " +
        "the whole proof rests on this and cannot continue"
    );
    console.log("\nM6 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }
  console.log(
    "  Confirmed live: the service does not hold the bogus session id (404 unknown_session)."
  );

  conversationStore.setSessionId(conversation.id, bogusSessionId);
  const convBeforeB = conversationStore.getConversation(conversation.id);
  const N = (convBeforeB?.turns ?? []).filter((t: Turn) => t.content.trim() !== "").length;
  console.log(`  Overwrote stored sessionId with the bogus id. N (non-empty stored turns) = ${N}`);

  apiClient.clearRequestLog();

  let sendErrorB: unknown = null;
  const sendResultB = await sessionCoordinator
    .send(conversation.id, RECALL_PROMPT)
    .catch((error) => {
      sendErrorB = error;
      return null;
    });

  let phaseBPassed = true;

  if (sendErrorB) {
    console.log(
      `  FAIL - send() threw instead of recovering: ${
        sendErrorB instanceof Error ? sendErrorB.message : String(sendErrorB)
      }`
    );
    phaseBPassed = false;
  } else if (!sendResultB) {
    console.log("  FAIL - send() returned no result");
    phaseBPassed = false;
  } else {
    console.log(
      `  send() status=${sendResultB.status} sessionRebuilt=${sendResultB.sessionRebuilt} ` +
        `replayedTurns=${sendResultB.replayedTurns}`
    );
    console.log(`  Recall answer: ${JSON.stringify(sendResultB.text)}`);

    if (sendResultB.status !== "complete") {
      console.log(`  FAIL - expected status "complete", got "${sendResultB.status}"`);
      phaseBPassed = false;
    }
    if (sendResultB.sessionRebuilt !== true) {
      console.log(`  FAIL - expected sessionRebuilt=true, got ${sendResultB.sessionRebuilt}`);
      phaseBPassed = false;
    }
    if (sendResultB.replayedTurns !== N) {
      console.log(`  FAIL - expected replayedTurns=${N}, got ${sendResultB.replayedTurns}`);
      phaseBPassed = false;
    }
    if (!sendResultB.text.includes(magicNumber)) {
      console.log(
        `  FAIL - recall answer does not contain the Phase A number "${magicNumber}"`
      );
      phaseBPassed = false;
    }
  }

  const convAfterB = conversationStore.getConversation(conversation.id);
  const newSessionId = convAfterB?.sessionId ?? null;
  console.log(`  Conversation sessionId after Phase B: ${newSessionId}`);

  if (!newSessionId) {
    console.log("  FAIL - conversation has no sessionId after Phase B send()");
    phaseBPassed = false;
  } else if (newSessionId === bogusSessionId || newSessionId === phaseASessionId) {
    console.log(
      "  FAIL - conversation's stored sessionId was not actually rebuilt " +
        `(still "${newSessionId}")`
    );
    phaseBPassed = false;
  }

  const logB = apiClient.getRequestLog();
  console.log("  Request log during Phase B send():");
  for (const entry of logB) {
    console.log(`    ${entry.method} ${entry.url}`);
  }

  if (newSessionId && newSessionId !== bogusSessionId && newSessionId !== phaseASessionId) {
    const expectedLength = N + 3;
    if (logB.length !== expectedLength) {
      console.log(
        `  FAIL - expected exactly ${expectedLength} requests (1 failed generate + 1 createSession + ` +
          `${N} turns + 1 retried generate), got ${logB.length}`
      );
      phaseBPassed = false;
    } else {
      const expectedFirst = `${baseUrl}/v1/sessions/${bogusSessionId}/generate`;
      const expectedCreate = `${baseUrl}/v1/sessions`;
      const expectedLast = `${baseUrl}/v1/sessions/${newSessionId}/generate`;

      if (!(logB[0]?.method === "POST" && logB[0]?.url === expectedFirst)) {
        console.log(
          `  FAIL - request[0] expected POST ${expectedFirst}, got ${logB[0]?.method} ${logB[0]?.url}`
        );
        phaseBPassed = false;
      }
      if (!(logB[1]?.method === "POST" && logB[1]?.url === expectedCreate)) {
        console.log(
          `  FAIL - request[1] expected POST ${expectedCreate}, got ${logB[1]?.method} ${logB[1]?.url}`
        );
        phaseBPassed = false;
      }
      const expectedTurns = `${baseUrl}/v1/sessions/${newSessionId}/turns`;
      for (let i = 0; i < N; i++) {
        const entry = logB[2 + i];
        if (!(entry?.method === "POST" && entry?.url === expectedTurns)) {
          console.log(
            `  FAIL - request[${2 + i}] expected POST ${expectedTurns}, got ${entry?.method} ${entry?.url}`
          );
          phaseBPassed = false;
        }
      }
      const lastEntry = logB[2 + N];
      if (!(lastEntry?.method === "POST" && lastEntry?.url === expectedLast)) {
        console.log(
          `  FAIL - request[${2 + N}] expected POST ${expectedLast}, got ${lastEntry?.method} ${lastEntry?.url}`
        );
        phaseBPassed = false;
      }
    }
  } else {
    console.log("  Skipping request-log order check (sessionId rebuild did not hold above)");
    phaseBPassed = false;
  }

  if (phaseBPassed) {
    console.log(
      "Criterion (AC - a lost server session (404 unknown_session) triggers rebuild + " +
        "transcript replay + retry, live): PASS"
    );
  } else {
    console.log(
      "Criterion (AC - a lost server session (404 unknown_session) triggers rebuild + " +
        "transcript replay + retry, live): FAIL"
    );
  }
  allPassed = allPassed && phaseBPassed;

  // ---------------------------------------------------------------------
  // PHASE C - the replayed transcript matches the service
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE C: REPLAYED TRANSCRIPT MATCHES THE SERVICE ===");

  let phaseCPassed = true;

  if (!newSessionId) {
    console.log("  FAIL - no rebuilt sessionId available; cannot compare transcripts");
    phaseCPassed = false;
  } else {
    const localConv = conversationStore.getConversation(conversation.id);
    const localTurns: Turn[] = localConv?.turns ?? [];

    let serviceTurns: SessionTurn[] = [];
    try {
      const snapshot = await apiClient.getSession(newSessionId);
      serviceTurns = snapshot.turns;
    } catch (error) {
      console.log(
        `  FAIL - getSession(newSessionId) threw: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      phaseCPassed = false;
    }

    console.log(
      `  idx | local role | local content                  | service role | service content`
    );
    const maxLen = Math.max(localTurns.length, serviceTurns.length);
    for (let i = 0; i < maxLen; i++) {
      const local = localTurns[i];
      const remote = serviceTurns[i];
      console.log(
        `  ${i} | ${local?.role ?? "-"} | ${truncate(local?.content ?? "-", 30)} | ` +
          `${remote?.role ?? "-"} | ${truncate(remote?.content ?? "-", 30)}`
      );
    }

    if (localTurns.length !== serviceTurns.length) {
      console.log(
        `  FAIL - transcript length mismatch: local=${localTurns.length} service=${serviceTurns.length}`
      );
      phaseCPassed = false;
    }
    for (let i = 0; i < maxLen; i++) {
      const local = localTurns[i];
      const remote = serviceTurns[i];
      if (!local || !remote) {
        continue; // already reported as a length mismatch above
      }
      if (local.role !== remote.role) {
        console.log(
          `  FAIL - role mismatch at index ${i}: local="${local.role}" service="${remote.role}"`
        );
        phaseCPassed = false;
      }
      if (local.content !== remote.content) {
        console.log(
          `  FAIL - content mismatch at index ${i}: local=${JSON.stringify(
            local.content
          )} service=${JSON.stringify(remote.content)}`
        );
        phaseCPassed = false;
      }
    }
  }

  if (phaseCPassed) {
    console.log(
      "Criterion (AC - replayed transcript matches the service turn-by-turn, no normalisation): PASS"
    );
  } else {
    console.log(
      "Criterion (AC - replayed transcript matches the service turn-by-turn, no normalisation): FAIL"
    );
  }
  allPassed = allPassed && phaseCPassed;

  // ---------------------------------------------------------------------
  // PHASE D - 401 is distinguished from 404
  // ---------------------------------------------------------------------
  console.log("\n=== PHASE D: 401 IS DISTINGUISHED FROM 404 ===");

  const apiClient2 = createApiClient({
    baseUrl,
    getToken: () => INVALID_TOKEN,
  });
  const sessionCoordinator2 = createSessionCoordinator({
    apiClient: apiClient2,
    conversationStore,
  });

  const sessionIdBeforeD = conversationStore.getConversation(conversation.id)?.sessionId ?? null;
  const turnsBeforeD = conversationStore.getConversation(conversation.id)?.turns ?? [];
  console.log(`  Conversation sessionId before Phase D: ${sessionIdBeforeD}`);
  console.log(`  Conversation turn count before Phase D: ${turnsBeforeD.length}`);

  apiClient2.clearRequestLog();

  let phaseDPassed = true;
  let sendErrorD: unknown = null;
  try {
    await sessionCoordinator2.send(conversation.id, D_PROMPT);
    console.log("  FAIL - send() through the invalid-token coordinator resolved instead of rejecting");
    phaseDPassed = false;
  } catch (error) {
    sendErrorD = error;
  }

  if (sendErrorD) {
    if (sendErrorD instanceof HarnessApiError) {
      console.log(
        `  send() rejected with: code=${sendErrorD.code} status=${sendErrorD.status}`
      );
      if (sendErrorD.code !== "unauthorized" || sendErrorD.status !== 401) {
        console.log(
          `  FAIL - expected code="unauthorized" status=401, got code="${sendErrorD.code}" status=${sendErrorD.status}`
        );
        phaseDPassed = false;
      }
    } else {
      console.log(
        `  FAIL - expected a HarnessApiError, got: ${
          sendErrorD instanceof Error ? sendErrorD.message : String(sendErrorD)
        }`
      );
      phaseDPassed = false;
    }
  }

  const logD = apiClient2.getRequestLog();
  console.log("  Request log during Phase D send() (invalid-token client):");
  for (const entry of logD) {
    console.log(`    ${entry.method} ${entry.url}`);
  }

  const sessionCreateUrl = `${baseUrl}/v1/sessions`;
  const createdSession = logD.some(
    (entry) => entry.method === "POST" && entry.url === sessionCreateUrl
  );
  if (createdSession) {
    console.log("  FAIL - the invalid-token client's request log contains a session creation");
    phaseDPassed = false;
  }
  const replayedTurn = logD.some(
    (entry) => entry.method === "POST" && entry.url.endsWith("/turns")
  );
  if (replayedTurn) {
    console.log("  FAIL - the invalid-token client's request log contains a turn replay");
    phaseDPassed = false;
  }

  const sessionIdAfterD = conversationStore.getConversation(conversation.id)?.sessionId ?? null;
  const turnsAfterD = conversationStore.getConversation(conversation.id)?.turns ?? [];
  console.log(`  Conversation sessionId after Phase D: ${sessionIdAfterD}`);
  console.log(`  Conversation turn count after Phase D: ${turnsAfterD.length}`);

  if (sessionIdAfterD !== sessionIdBeforeD) {
    console.log(
      `  FAIL - conversation's stored sessionId changed (before=${sessionIdBeforeD} after=${sessionIdAfterD})`
    );
    phaseDPassed = false;
  }
  if (turnsAfterD.length !== turnsBeforeD.length) {
    console.log(
      `  FAIL - conversation's stored turn count changed (before=${turnsBeforeD.length} after=${turnsAfterD.length})`
    );
    phaseDPassed = false;
  } else {
    for (let i = 0; i < turnsBeforeD.length; i++) {
      const before = turnsBeforeD[i];
      const after = turnsAfterD[i];
      if (before?.role !== after?.role || before?.content !== after?.content) {
        console.log(`  FAIL - stored turn at index ${i} changed`);
        phaseDPassed = false;
      }
    }
  }

  if (phaseDPassed) {
    console.log(
      "Criterion (AC - 401 unauthorized is distinguished from 404: no session creation, " +
        "no turn replay, live): PASS"
    );
  } else {
    console.log(
      "Criterion (AC - 401 unauthorized is distinguished from 404: no session creation, " +
        "no turn replay, live): FAIL"
    );
  }
  allPassed = allPassed && phaseDPassed;

  // ---------------------------------------------------------------------
  // Final per-criterion summary
  // ---------------------------------------------------------------------
  console.log("\n=== M6 ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(
    `AC - a lost server session (404 unknown_session) triggers rebuild + transcript replay + ` +
      `retry, and the conversation continues with its context restored (proven live): ` +
      `${phaseBPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `AC - the replayed transcript matches the service turn-by-turn (role and content at every ` +
      `index, no normalisation): ${phaseCPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `AC - a 401 unauthorized response is distinguished from a 404: no session creation, no turn ` +
      `replay (proven live): ${phaseDPassed ? "PASS" : "FAIL"}`
  );

  if (allPassed) {
    console.log("\nM6 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM6 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
