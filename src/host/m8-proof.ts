import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import { createApiClient } from "../../web/src/api-client.ts";
import {
  createConversationStore,
  CONVERSATIONS_STORAGE_KEY,
  CONVERSATIONS_SCHEMA_VERSION,
  UnknownStorageVersionError,
  type Turn,
} from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";

const READY_PROMPT = "Reply with just the word 'ready'.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // =====================================================================
  // PHASE 0 - discovery: profile ids are fetched at runtime, never hardcoded
  // =====================================================================
  console.log("\n=== PHASE 0: DISCOVERY ===");
  const profiles = await apiClient.listProfiles();
  for (const p of profiles) {
    console.log(`  id=${p.id} latency_class=${p.latency_class} label=${p.label}`);
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    console.log("FAIL - no live profiles discovered, cannot proceed");
    console.log("\nM8 LIVE PROOF: FAIL");
    process.exit(1);
    return;
  }

  const profile =
    profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
  console.log(`Using profile: id=${profile.id} latency_class=${profile.latency_class}`);

  // =====================================================================
  // PHASE A - AC2: each conversation is backed by exactly one server session
  // =====================================================================
  console.log(
    "\n=== PHASE A: AC2 - EXACTLY ONE SERVER SESSION PER CONVERSATION (LIVE) ==="
  );

  let phaseAPassed = true;
  let conv1TurnsAfterSend: Turn[] = [];

  apiClient.clearRequestLog();
  const conv1 = await sessionCoordinator.createConversation({
    profileId: profile.id,
    title: "Conversation One",
  });
  console.log(`  Created conversation ${conv1.id} via coordinator.createConversation()`);
  console.log(`  Conversation's recorded sessionId: ${conv1.sessionId}`);

  if (!conv1.sessionId) {
    console.log("  FAIL - conversation has no sessionId after createConversation()");
    phaseAPassed = false;
  }

  const logAfterCreate = apiClient.getRequestLog();
  const sessionCreationRequestsAfterCreate = logAfterCreate.filter(
    (r) => r.method === "POST" && r.url === `${baseUrl}/v1/sessions`
  );
  console.log(
    `  Session-creation HTTP requests observed after createConversation(): ${sessionCreationRequestsAfterCreate.length}`
  );
  if (sessionCreationRequestsAfterCreate.length !== 1) {
    console.log(
      `  FAIL - expected exactly 1 session-creation request, got ${sessionCreationRequestsAfterCreate.length}`
    );
    phaseAPassed = false;
  } else {
    console.log("  Exactly one createSession() HTTP call: confirmed");
  }

  if (conv1.sessionId) {
    const snapshot = await apiClient.getSession(conv1.sessionId);
    console.log(
      `  Live getSession(${conv1.sessionId}) → session_id=${snapshot.session_id} created_at=${snapshot.created_at}`
    );
    if (snapshot.session_id !== conv1.sessionId) {
      console.log(
        `  FAIL - getSession returned session_id ${snapshot.session_id}, expected ${conv1.sessionId}`
      );
      phaseAPassed = false;
    } else {
      console.log("  Harness confirms the session is real: confirmed");
    }
  }

  apiClient.clearRequestLog();
  const sendResult = await sessionCoordinator.send(conv1.id, READY_PROMPT);
  console.log(
    `  send() result: status=${sendResult.status} text="${sendResult.text.replace(/\s+/g, " ").trim()}"`
  );

  const logAfterSend = apiClient.getRequestLog();
  const sessionCreationRequestsAfterSend = logAfterSend.filter(
    (r) => r.method === "POST" && r.url === `${baseUrl}/v1/sessions`
  );
  console.log(
    `  Session-creation HTTP requests observed during send() on the same conversation: ${sessionCreationRequestsAfterSend.length}`
  );
  if (sessionCreationRequestsAfterSend.length !== 0) {
    console.log(
      `  FAIL - send() on an already-provisioned conversation created ${sessionCreationRequestsAfterSend.length} further session(s)`
    );
    phaseAPassed = false;
  } else {
    console.log("  send() created no further session: confirmed");
  }

  const conv1AfterSend = conversationStore.getConversation(conv1.id);
  conv1TurnsAfterSend = conv1AfterSend ? conv1AfterSend.turns : [];
  console.log(`  Turns recorded on conv1 after send(): ${conv1TurnsAfterSend.length}`);
  if (conv1TurnsAfterSend.length < 2) {
    console.log(
      "  FAIL - expected at least a user turn and an assistant turn after send()"
    );
    phaseAPassed = false;
  }

  if (phaseAPassed) {
    console.log("PHASE A: PASS");
  } else {
    console.log("PHASE A: FAIL");
  }
  allPassed = allPassed && phaseAPassed;

  // =====================================================================
  // PHASE B - AC1: create/list newest-first/open/delete, survives rebuild
  // =====================================================================
  console.log(
    "\n=== PHASE B: AC1 - CREATE / LIST NEWEST-FIRST / OPEN / DELETE / REBUILD ==="
  );

  let phaseBPassed = true;

  await sleep(5);
  const conv2 = await sessionCoordinator.createConversation({
    profileId: profile.id,
    title: "Conversation Two",
  });
  console.log(`  Created conversation ${conv2.id}`);

  await sleep(5);
  const conv3 = await sessionCoordinator.createConversation({
    profileId: profile.id,
    title: "Conversation Three",
  });
  console.log(`  Created conversation ${conv3.id}`);

  const listed = conversationStore.loadConversations();
  const listedIds = listed.map((c) => c.id);
  console.log(`  loadConversations() order: ${listedIds.join(", ")}`);

  const expectedOrder = [conv3.id, conv2.id, conv1.id];
  const orderMatches = JSON.stringify(listedIds) === JSON.stringify(expectedOrder);
  if (!orderMatches) {
    console.log(
      `  FAIL - expected newest-first order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(listedIds)}`
    );
    phaseBPassed = false;
  } else {
    console.log("  Newest-first ordering: confirmed");
  }

  const openedConv2 = conversationStore.getConversation(conv2.id);
  if (!openedConv2 || openedConv2.id !== conv2.id) {
    console.log(`  FAIL - could not open conversation ${conv2.id} by id`);
    phaseBPassed = false;
  } else {
    console.log(`  Opened conversation by id: ${openedConv2.id} title="${openedConv2.title}"`);
  }

  conversationStore.deleteConversation(conv2.id);
  console.log(`  Deleted conversation ${conv2.id}`);

  const rebuiltStore = createConversationStore(sharedStorage);
  const rebuiltList = rebuiltStore.loadConversations();
  const rebuiltIds = rebuiltList.map((c) => c.id);
  console.log(
    `  Brand-new store constructed over the SAME storage sees: ${rebuiltIds.join(", ")}`
  );

  if (rebuiltIds.includes(conv2.id)) {
    console.log("  FAIL - deleted conversation is still present after rebuild");
    phaseBPassed = false;
  } else {
    console.log("  Deleted conversation is absent after rebuild: confirmed");
  }

  if (!rebuiltIds.includes(conv1.id) || !rebuiltIds.includes(conv3.id)) {
    console.log("  FAIL - a surviving conversation is missing after rebuild");
    phaseBPassed = false;
  } else {
    console.log("  Surviving conversations present after rebuild: confirmed");
  }

  if (phaseBPassed) {
    console.log("PHASE B: PASS");
  } else {
    console.log("PHASE B: FAIL");
  }
  allPassed = allPassed && phaseBPassed;

  // =====================================================================
  // PHASE C - AC3: full transcript persisted locally, recovered intact
  // =====================================================================
  console.log(
    "\n=== PHASE C: AC3 - TRANSCRIPT PERSISTED LOCALLY, RECOVERED INTACT ==="
  );

  let phaseCPassed = true;

  const freshStore = createConversationStore(sharedStorage);
  const conv1FromFreshStore = freshStore.getConversation(conv1.id);
  const turnsFromFreshStore = conv1FromFreshStore ? conv1FromFreshStore.turns : [];

  console.log(`  Turns before (captured right after the live send()): ${conv1TurnsAfterSend.length}`);
  console.log(`  Turns after rebuilding a brand-new store from storage: ${turnsFromFreshStore.length}`);

  for (const t of conv1TurnsAfterSend) {
    console.log(`    [before] role=${t.role} content="${t.content.replace(/\s+/g, " ").trim()}"`);
  }
  for (const t of turnsFromFreshStore) {
    console.log(`    [after]  role=${t.role} content="${t.content.replace(/\s+/g, " ").trim()}"`);
  }

  const userTurn = conv1TurnsAfterSend.find((t) => t.role === "user");
  const assistantTurn = conv1TurnsAfterSend.find((t) => t.role === "assistant");
  if (!userTurn || !assistantTurn) {
    console.log("  FAIL - did not capture a genuine user turn and assistant turn");
    phaseCPassed = false;
  }

  const turnsMatch =
    JSON.stringify(conv1TurnsAfterSend) === JSON.stringify(turnsFromFreshStore);
  if (!turnsMatch) {
    console.log("  FAIL - turns recovered from a fresh store do not match the originals");
    phaseCPassed = false;
  } else {
    console.log("  Turns recovered identically from persisted storage alone: confirmed");
  }

  if (phaseCPassed) {
    console.log("PHASE C: PASS");
  } else {
    console.log("PHASE C: FAIL");
  }
  allPassed = allPassed && phaseCPassed;

  // =====================================================================
  // PHASE D - AC4: versioned storage key, unknown version rejected
  // =====================================================================
  console.log(
    "\n=== PHASE D: AC4 - VERSIONED STORAGE KEY, UNKNOWN VERSION REJECTED ==="
  );

  let phaseDPassed = true;

  console.log(`  Storage key: ${CONVERSATIONS_STORAGE_KEY}`);

  const rawStored = sharedStorage.get(CONVERSATIONS_STORAGE_KEY);
  if (!rawStored) {
    console.log("  FAIL - nothing persisted under the conversations storage key");
    phaseDPassed = false;
  } else {
    let parsedEnvelope: unknown = null;
    try {
      parsedEnvelope = JSON.parse(rawStored);
    } catch {
      console.log("  FAIL - persisted payload is not valid JSON");
      phaseDPassed = false;
    }

    if (
      parsedEnvelope &&
      typeof parsedEnvelope === "object" &&
      "version" in parsedEnvelope
    ) {
      const version = (parsedEnvelope as { version: unknown }).version;
      console.log(`  Persisted envelope's version field: ${version}`);
      if (version !== CONVERSATIONS_SCHEMA_VERSION) {
        console.log(
          `  FAIL - expected version ${CONVERSATIONS_SCHEMA_VERSION}, got ${version}`
        );
        phaseDPassed = false;
      } else {
        console.log(
          `  Persisted envelope carries the expected schema version (${CONVERSATIONS_SCHEMA_VERSION}): confirmed`
        );
      }
    } else {
      console.log("  FAIL - persisted payload is not a recognised envelope shape");
      phaseDPassed = false;
    }
  }

  const unknownVersion = 999999;
  const badPayload = JSON.stringify({ version: unknownVersion, conversations: [] });
  const badStorage = createMemoryStorage();
  badStorage.set(CONVERSATIONS_STORAGE_KEY, badPayload);
  console.log(
    `  Wrote an unrecognised-version payload (version=${unknownVersion}) into a fresh storage object`
  );

  const badStore = createConversationStore(badStorage);
  let thrownError: unknown = null;
  try {
    badStore.loadConversations();
    console.log("  FAIL - loading a store over an unknown-version payload did not throw");
    phaseDPassed = false;
  } catch (error) {
    thrownError = error;
  }

  if (thrownError instanceof UnknownStorageVersionError) {
    console.log(
      `  Threw UnknownStorageVersionError: foundVersion=${thrownError.foundVersion} expectedVersion=${thrownError.expectedVersion}`
    );
    if (thrownError.foundVersion !== unknownVersion) {
      console.log(
        `  FAIL - expected foundVersion ${unknownVersion}, got ${thrownError.foundVersion}`
      );
      phaseDPassed = false;
    }
    if (thrownError.expectedVersion !== CONVERSATIONS_SCHEMA_VERSION) {
      console.log(
        `  FAIL - expected expectedVersion ${CONVERSATIONS_SCHEMA_VERSION}, got ${thrownError.expectedVersion}`
      );
      phaseDPassed = false;
    }
  } else if (thrownError !== null) {
    console.log(
      `  FAIL - expected UnknownStorageVersionError, got: ${
        thrownError instanceof Error ? thrownError.message : String(thrownError)
      }`
    );
    phaseDPassed = false;
  }

  const badStorageAfter = badStorage.get(CONVERSATIONS_STORAGE_KEY);
  if (badStorageAfter !== badPayload) {
    console.log(
      "  FAIL - the unrecognised-version bytes were overwritten instead of being left untouched"
    );
    phaseDPassed = false;
  } else {
    console.log("  Stored bytes unchanged after the rejected load: confirmed");
  }

  if (phaseDPassed) {
    console.log("PHASE D: PASS");
  } else {
    console.log("PHASE D: FAIL");
  }
  allPassed = allPassed && phaseDPassed;

  // =====================================================================
  // Final summary
  // =====================================================================
  console.log("\n=== M8 ACCEPTANCE CRITERIA SUMMARY ===");
  console.log(
    `1. Conversations can be created, listed newest-first, opened and deleted, and a deleted conversation is gone after the store is rebuilt from storage: ${phaseBPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `2. Each conversation is backed by exactly one server session id, proven live via getSession() and the request log, with no further session created on a subsequent send(): ${phaseAPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `3. The full transcript is persisted locally and recovered intact by a store constructed fresh from persisted storage alone: ${phaseCPassed ? "PASS" : "FAIL"}`
  );
  console.log(
    `4. The persisted payload is written under a versioned key, and a payload written under an unknown version is rejected rather than misread, leaving the stored bytes unchanged: ${phaseDPassed ? "PASS" : "FAIL"}`
  );

  if (allPassed) {
    console.log("\nM8 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM8 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
