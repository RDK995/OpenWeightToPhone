import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createCredentialStore } from "../../web/src/credential-store.ts";
import { createApiClient } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";

interface ContentMetrics {
  deltas: number;
  firstDeltaMs: number | null;
  completeMs: number | null;
  telemetry: {
    tokens_per_second: number;
    eval_count: number;
    quantization: string;
    context_limit: number;
  } | null;
}

async function main() {
  // Read config
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token: ${token.substring(0, 20)}...`);

  // Build module chain
  const storage = createMemoryStorage();
  const credentialStore = createCredentialStore(storage);
  credentialStore.setCredential({ baseUrl, token });

  const apiClient = createApiClient({
    baseUrl,
    getToken: () => credentialStore.getToken(),
  });

  const conversationStore = createConversationStore(storage);
  const sessionCoordinator = createSessionCoordinator({
    apiClient,
    conversationStore,
  });

  // List profiles and pick one
  const profiles = await apiClient.listProfiles();
  console.log(`Found ${profiles.length} profiles`);

  let selectedProfile = profiles.find((p) => p.latency_class === "interactive");
  if (!selectedProfile) {
    selectedProfile = profiles[0];
  }
  if (!selectedProfile) {
    throw new Error("No profiles available");
  }

  console.log(`Selected profile: ${selectedProfile.id}`);

  // Create conversation
  const conversation = conversationStore.createConversation({
    profileId: selectedProfile.id,
  });
  console.log(`Created conversation: ${conversation.id}`);

  // Generation 1
  console.log("\n=== GENERATION 1 ===");
  const prompt1 = "My favourite number is 41. Acknowledge this in one short sentence.";
  console.log(`Prompt: ${prompt1}`);

  const gen1Metrics: ContentMetrics = {
    deltas: 0,
    firstDeltaMs: null,
    completeMs: null,
    telemetry: null,
  };

  let gen1Started = false;
  const gen1Start = performance.now();

  const result1 = await sessionCoordinator.send(conversation.id, prompt1, {
    onQueued: (position) => {
      console.log(`Queue position: ${position}`);
    },
    onModelLoading: () => {
      console.log("Model loading...");
    },
    onDelta: (delta) => {
      process.stdout.write(delta);
      gen1Metrics.deltas++;

      if (!gen1Started) {
        gen1Started = true;
        gen1Metrics.firstDeltaMs = Math.round(performance.now() - gen1Start);
      }
    },
    onComplete: (telemetry) => {
      console.log(""); // newline after content
      gen1Metrics.completeMs = Math.round(performance.now() - gen1Start);
      gen1Metrics.telemetry = {
        tokens_per_second: telemetry.tokens_per_second,
        eval_count: telemetry.eval_count,
        quantization: telemetry.quantization,
        context_limit: telemetry.context_limit,
      };
    },
  });

  console.log(`\nGeneration 1 complete: ${result1.status}`);
  console.log(`Text: ${result1.text}`);

  // Reload conversation to get updated sessionId
  const updatedConversation = conversationStore.getConversation(conversation.id);
  if (!updatedConversation) {
    throw new Error("Conversation not found after generation 1");
  }
  const sessionId = updatedConversation.sessionId;
  if (!sessionId) {
    throw new Error("Session ID not set after generation 1");
  }
  console.log(`Session ID: ${sessionId}`);

  // Generation 2
  console.log("\n=== GENERATION 2 ===");
  const prompt2 = "What is my favourite number? Reply with only the digits.";
  console.log(`Prompt: ${prompt2}`);

  const gen2Metrics: ContentMetrics = {
    deltas: 0,
    firstDeltaMs: null,
    completeMs: null,
    telemetry: null,
  };

  let gen2Started = false;
  const gen2Start = performance.now();

  const result2 = await sessionCoordinator.send(conversation.id, prompt2, {
    onQueued: (position) => {
      console.log(`Queue position: ${position}`);
    },
    onModelLoading: () => {
      console.log("Model loading...");
    },
    onDelta: (delta) => {
      process.stdout.write(delta);
      gen2Metrics.deltas++;

      if (!gen2Started) {
        gen2Started = true;
        gen2Metrics.firstDeltaMs = Math.round(performance.now() - gen2Start);
      }
    },
    onComplete: (telemetry) => {
      console.log(""); // newline after content
      gen2Metrics.completeMs = Math.round(performance.now() - gen2Start);
      gen2Metrics.telemetry = {
        tokens_per_second: telemetry.tokens_per_second,
        eval_count: telemetry.eval_count,
        quantization: telemetry.quantization,
        context_limit: telemetry.context_limit,
      };
    },
  });

  console.log(`\nGeneration 2 complete: ${result2.status}`);
  console.log(`Text: ${result2.text}`);

  // Get session snapshot
  console.log("\n=== SESSION SNAPSHOT ===");
  const snapshot = await apiClient.getSession(sessionId);
  console.log(`Turns count: ${snapshot.turns.length}`);
  for (const turn of snapshot.turns) {
    console.log(`Turn ${turn.index}: ${turn.role} - ${turn.content.substring(0, 50)}${turn.content.length > 50 ? "..." : ""}`);
  }

  // Print request log
  console.log("\n=== REQUEST LOG ===");
  const requestLog = apiClient.getRequestLog();
  console.log(`Total requests: ${requestLog.length}`);
  for (const req of requestLog) {
    console.log(`${req.method} ${req.url}`);
  }

  // Assertions
  console.log("\n=== ASSERTIONS ===");

  let allPassed = true;

  // AC3: At least 2 content events, timing proves incremental delivery, telemetry present
  const ac3Passed =
    gen1Metrics.deltas >= 2 &&
    gen1Metrics.firstDeltaMs !== null &&
    gen1Metrics.completeMs !== null &&
    gen1Metrics.firstDeltaMs < gen1Metrics.completeMs &&
    gen1Metrics.telemetry !== null &&
    typeof gen1Metrics.telemetry.tokens_per_second === "number" &&
    typeof gen1Metrics.telemetry.eval_count === "number" &&
    typeof gen1Metrics.telemetry.quantization === "string" &&
    typeof gen1Metrics.telemetry.context_limit === "number";

  if (ac3Passed) {
    console.log(
      `AC3: deltas=${gen1Metrics.deltas} firstDeltaMs=${gen1Metrics.firstDeltaMs} completeMs=${gen1Metrics.completeMs} tps=${gen1Metrics.telemetry!.tokens_per_second} eval_count=${gen1Metrics.telemetry!.eval_count} quantization=${gen1Metrics.telemetry!.quantization} context_limit=${gen1Metrics.telemetry!.context_limit} PASS`
    );
  } else {
    console.log(`AC3: FAIL - deltas=${gen1Metrics.deltas}, firstDeltaMs=${gen1Metrics.firstDeltaMs}, completeMs=${gen1Metrics.completeMs}, telemetry=${gen1Metrics.telemetry}`);
    allPassed = false;
  }

  // AC4: Generation 2 contains "41"
  const ac4Passed = result2.text.includes("41");
  if (ac4Passed) {
    console.log(`AC4: answer2="${result2.text}" sessionId=${sessionId} PASS`);
  } else {
    console.log(`AC4: FAIL - answer2="${result2.text}" does not contain "41"`);
    allPassed = false;
  }

  // AC5: Exactly 4 turns with roles user, assistant, user, assistant
  const ac5Passed =
    snapshot.turns.length === 4 &&
    snapshot.turns[0]?.role === "user" &&
    snapshot.turns[1]?.role === "assistant" &&
    snapshot.turns[2]?.role === "user" &&
    snapshot.turns[3]?.role === "assistant" &&
    snapshot.turns[0]?.content === prompt1 &&
    snapshot.turns[2]?.content === prompt2;

  if (ac5Passed) {
    const roles = snapshot.turns.map((t) => t.role).join(", ");
    console.log(`AC5: turn_count=${snapshot.turns.length} roles=${roles} PASS`);
  } else {
    const roles = snapshot.turns.map((t) => t.role).join(", ");
    console.log(`AC5: FAIL - turn_count=${snapshot.turns.length}, roles=${roles}, expected 4 turns with roles user, assistant, user, assistant`);
    allPassed = false;
  }

  // FR4: No POST requests to /turns
  const turnsRequests = requestLog.filter((r) => r.url.includes("/turns"));
  const fr4Passed = turnsRequests.length === 0;

  if (fr4Passed) {
    console.log(`FR4: total_requests=${requestLog.length} turns_requests=0 PASS`);
  } else {
    console.log(`FR4: FAIL - found ${turnsRequests.length} requests to /turns`);
    allPassed = false;
  }

  // Print full request log for verification
  console.log("\nFull request log:");
  for (const req of requestLog) {
    console.log(`  ${req.method} ${req.url}`);
  }

  // Final result
  if (allPassed) {
    console.log("\nM2 LIVE PROOF: PASS");
    process.exit(0);
  } else {
    console.log("\nM2 LIVE PROOF: FAIL");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
