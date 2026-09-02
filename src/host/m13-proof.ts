// M13 live proof: demonstrates acceptance criterion 2 end to end against the
// live harness -- a transport-layer failure injected on the `generate` call
// (a rejected fetch, not a synthesized HTTP error) produces a distinct
// offline state with the drafted prompt preserved and no turn recorded, and
// a subsequent retry with the injection removed re-sends the exact preserved
// draft and completes against the real harness, with real telemetry
// (tokens_per_second, profile_id) returned on the wire.
//
// Driven through the UI's own send/retry buttons with the real API client,
// real coordinator and a real token against the live harness. Proven at a
// Mac-run entry point under happy-dom -- no browser required.

import { Window } from "happy-dom";
import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createApiClient } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";
import { createDomTarget } from "../../web/src/ui/dom-target.ts";
import { mount } from "../../web/src/ui/mount.ts";
import { readEvents, type Telemetry } from "../../web/src/sse-reader.ts";

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);

  let allPassed = true;
  const failures: string[] = [];

  try {
    // Create happy-dom window
    const w = new Window() as any;
    const root = w.document.body as HTMLElement;

    // Records every request the app actually sent, and lets us inject a
    // transport-layer failure on the generate call only (and remove it
    // again for the retry) without touching any real production file.
    const requests: RecordedRequest[] = [];
    let injectGenerateFailure = false;
    let capturedTelemetry: Telemetry | null = null;

    const wrappingFetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      const body = init?.body || null;
      const isGenerateCall = method === "POST" && url.includes("/generate");

      requests.push({
        method,
        url,
        body: typeof body === "string" ? body : null,
      });

      if (isGenerateCall && injectGenerateFailure) {
        // A rejected fetch -- exactly what a dropped connection/DNS
        // failure looks like at this layer. NOT a synthesized HTTP error
        // response and NOT a `{code: ...}` body.
        throw new TypeError("Failed to fetch");
      }

      const response = await globalThis.fetch(input, init);

      if (isGenerateCall && response.ok && response.body) {
        // Independently tap a clone of the real SSE stream to capture the
        // telemetry actually returned by the harness, without disturbing
        // the response the app itself consumes.
        const tapped = response.clone();
        if (tapped.body) {
          (async () => {
            try {
              for await (const event of readEvents(tapped.body!)) {
                if (event.kind === "complete") {
                  capturedTelemetry = event.telemetry;
                }
              }
            } catch {
              // Best-effort tap; the app's own consumption is authoritative.
            }
          })();
        }
      }

      return response;
    };

    // Build module chain
    const storage = createMemoryStorage();
    const conversationStore = createConversationStore(storage);

    const apiClient = createApiClient({
      baseUrl,
      getToken: () => token,
      fetch: wrappingFetch as any,
    });

    const sessionCoordinator = createSessionCoordinator({
      apiClient,
      conversationStore,
    });

    const target = createDomTarget(root);

    const handle = mount({
      target,
      coordinator: sessionCoordinator,
      store: conversationStore,
    });

    target.attach({
      actions: handle.actions,
      controller: handle,
    });

    // --- Criterion 1: setup is live -------------------------------------
    console.log("\n=== Criterion 1: setup is live ===");
    let profiles;
    try {
      profiles = await apiClient.listProfiles();
    } catch (error) {
      console.log(
        `FAIL - Setup: could not reach the live harness at ${baseUrl}: ${(error as Error).message}`
      );
      process.exit(1);
    }

    if (!profiles || profiles.length === 0) {
      console.log(`FAIL - Setup: harness at ${baseUrl} returned zero profiles`);
      process.exit(1);
    }
    console.log(`PASS - Listed ${profiles.length} real profile(s) from ${baseUrl}`);

    const profile = profiles.find((p) => p.latency_class === "interactive") ?? profiles[0]!;
    console.log(`Using profile: ${profile.id}`);

    handle.setProfiles(profiles);
    handle.render();

    const profileSelect = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
    if (!profileSelect) {
      console.log("FAIL - Setup: profile-select not found in DOM");
      process.exit(1);
    }
    profileSelect.value = profile.id;

    const createBtn = root.querySelector('[data-testid="create-conversation"]') as HTMLButtonElement | null;
    if (!createBtn) {
      console.log("FAIL - Setup: create-conversation button not found in DOM");
      process.exit(1);
    }
    createBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

    const conversationCreated = await waitForCondition(() => {
      return root.querySelector('[data-testid="open-conversation"]') !== null;
    });
    if (!conversationCreated) {
      console.log("FAIL - Setup: could not reach the live harness -- no conversation created (open-conversation button never appeared)");
      process.exit(1);
    }

    const conversations = conversationStore.loadConversations();
    const conversation = conversations[0];
    if (!conversation) {
      console.log("FAIL - Setup: conversation not found after creation");
      process.exit(1);
    }
    console.log(`PASS - Created a real conversation on the live harness: ${conversation.id}`);

    // --- Criterion 2: injected transport failure -------------------------
    console.log("\n=== Criterion 2: injected transport failure ===");
    const prompt = "Reply with the single word: ready";
    const promptInput = root.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
    if (!promptInput) {
      console.log("FAIL - prompt-input not found in DOM");
      process.exit(1);
    }
    promptInput.value = prompt;

    const sendBtn = root.querySelector('[data-testid="send"]') as HTMLButtonElement | null;
    if (!sendBtn) {
      console.log("FAIL - send button not found in DOM");
      process.exit(1);
    }

    injectGenerateFailure = true;
    console.log(`Prompt typed: "${prompt}"`);
    console.log("Clicking send with a transport failure injected on generate...");
    sendBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

    const offlineAppeared = await waitForCondition(() => {
      const el = root.querySelector('[data-testid="offline"]');
      return el !== null && (el.textContent ?? "").length > 0;
    }, 15000, 200);

    if (!offlineAppeared) {
      failures.push("Offline state did not appear in the DOM after the injected transport failure");
      allPassed = false;
    } else {
      console.log("PASS - data-testid=\"offline\" section is present and populated");
    }

    const offlineEl = root.querySelector('[data-testid="offline"]');
    const offlineText = (offlineEl?.textContent ?? "") as string;
    if (offlineText.length === 0) {
      failures.push("Offline section has no text content");
      allPassed = false;
    }

    const statusEl = root.querySelector('[data-testid="status"]');
    const statusText = (statusEl?.textContent ?? "") as string;
    console.log(`Status text: "${statusText}"`);
    if (statusText !== "Offline") {
      failures.push(`Status element should read exactly "Offline" with no harness error code, but read: "${statusText}"`);
      allPassed = false;
    } else {
      console.log('PASS - status element reads "Offline" with no harness error code');
    }

    if (promptInput.value !== prompt) {
      failures.push(`Drafted prompt was not preserved in the prompt input after the offline failure (found: "${promptInput.value}")`);
      allPassed = false;
    } else {
      console.log("PASS - drafted prompt is still present in the prompt input");
    }

    // --- Criterion 3: no turn leaked -------------------------------------
    console.log("\n=== Criterion 3: no turn leaked ===");
    const afterFailureConversation = conversationStore.getConversation(conversation.id);
    const userTurnsAfterFailure = (afterFailureConversation?.turns ?? []).filter((t) => t.role === "user");
    const assistantTurnsAfterFailure = (afterFailureConversation?.turns ?? []).filter((t) => t.role === "assistant");
    console.log(`User turns: ${userTurnsAfterFailure.length}, assistant turns: ${assistantTurnsAfterFailure.length}`);

    if (userTurnsAfterFailure.length !== 0) {
      failures.push(`Expected zero user turns after the failed attempt, found ${userTurnsAfterFailure.length}`);
      allPassed = false;
    }
    if (assistantTurnsAfterFailure.length !== 0) {
      failures.push(`Expected zero assistant turns after the failed attempt, found ${assistantTurnsAfterFailure.length}`);
      allPassed = false;
    }
    if (userTurnsAfterFailure.length === 0 && assistantTurnsAfterFailure.length === 0) {
      console.log("PASS - no turn leaked into the conversation store");
    }

    // --- Criterion 4: live retry succeeds ---------------------------------
    console.log("\n=== Criterion 4: live retry succeeds against the live harness ===");
    injectGenerateFailure = false;

    const retryBtn = root.querySelector('[data-testid="retry"]') as HTMLButtonElement | null;
    if (!retryBtn) {
      console.log("FAIL - retry button not found in DOM while offline state is active");
      process.exit(1);
    }

    console.log("Clicking retry with the injection removed...");
    retryBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

    const completed = await waitForCondition(() => {
      return handle.getState().generation.kind === "complete" || handle.getState().generation.kind === "error";
    }, 90000, 500);

    const finalGeneration = handle.getState().generation;
    console.log(`Final generation kind: ${finalGeneration.kind}`);

    if (!completed) {
      failures.push("Retry did not reach a terminal state within 90 seconds");
      allPassed = false;
    } else if (finalGeneration.kind !== "complete") {
      failures.push(`Retry did not reach "complete" -- reached "${finalGeneration.kind}" instead`);
      allPassed = false;
    } else {
      console.log('PASS - retry reached "complete" against the live harness');
    }

    // Give the independent telemetry tap a moment to finish draining the
    // cloned stream after the app itself has already reached "complete".
    await waitForCondition(() => capturedTelemetry !== null, 5000, 100);

    if (!capturedTelemetry) {
      failures.push("No telemetry was captured off the wire for the retried generation");
      allPassed = false;
    } else {
      const telemetry = capturedTelemetry as Telemetry;
      console.log(`Real telemetry: tokens_per_second=${telemetry.tokens_per_second}, profile_id=${telemetry.profile_id}`);

      if (typeof telemetry.tokens_per_second !== "number" || !(telemetry.tokens_per_second > 0)) {
        failures.push(`Expected tokens_per_second > 0 from real telemetry, got ${telemetry.tokens_per_second}`);
        allPassed = false;
      } else {
        console.log("PASS - real telemetry reports tokens_per_second > 0");
      }

      if (typeof telemetry.profile_id !== "string" || telemetry.profile_id.trim() === "") {
        failures.push(`Expected a non-empty profile_id from real telemetry, got "${telemetry.profile_id}"`);
        allPassed = false;
      } else {
        console.log(`PASS - real telemetry reports a non-empty profile_id (${telemetry.profile_id})`);
      }
    }

    // --- Criterion 5: exactly one user turn and one assistant turn --------
    console.log("\n=== Criterion 5: exactly one user turn and one assistant turn ===");
    const finalConversation = conversationStore.getConversation(conversation.id);
    const userTurnsFinal = (finalConversation?.turns ?? []).filter((t) => t.role === "user");
    const assistantTurnsFinal = (finalConversation?.turns ?? []).filter((t) => t.role === "assistant");
    console.log(`User turns: ${userTurnsFinal.length}, assistant turns: ${assistantTurnsFinal.length}`);

    if (userTurnsFinal.length !== 1) {
      failures.push(`Expected exactly one user turn after the retry, found ${userTurnsFinal.length}`);
      allPassed = false;
    } else {
      console.log("PASS - exactly one user turn exists");
    }

    if (assistantTurnsFinal.length !== 1) {
      failures.push(`Expected exactly one assistant turn after the retry, found ${assistantTurnsFinal.length}`);
      allPassed = false;
    } else {
      const assistantText = assistantTurnsFinal[0]?.content ?? "";
      if (assistantText.trim() === "") {
        failures.push("The assistant turn's text is empty");
        allPassed = false;
      } else {
        console.log(`PASS - exactly one assistant turn exists with non-empty text: "${assistantText}"`);
      }
    }

    // --- Criterion 6: retry sent the preserved draft -----------------------
    console.log("\n=== Criterion 6: retry sent the preserved draft ===");
    const generateRequests = requests.filter(
      (req) => req.method === "POST" && req.url.includes("/v1/sessions/") && req.url.includes("/generate")
    );
    console.log(`Recorded ${generateRequests.length} POST .../generate request(s) (failed + retried)`);

    if (generateRequests.length < 2) {
      failures.push(`Expected at least 2 recorded generate requests (the failed attempt and the retry), found ${generateRequests.length}`);
      allPassed = false;
    } else {
      const retryRequest = generateRequests[generateRequests.length - 1]!;
      if (!retryRequest.body) {
        failures.push("The retried generate request has no recorded body");
        allPassed = false;
      } else {
        try {
          const bodyObj = JSON.parse(retryRequest.body) as any;
          console.log(`Retried generate request body: ${JSON.stringify(bodyObj)}`);
          if (bodyObj.prompt === prompt) {
            console.log("PASS - retry sent the exact preserved draft, not a retyped prompt");
          } else {
            failures.push(`Retried generate request prompt "${bodyObj.prompt}" does not equal the originally-typed text "${prompt}"`);
            allPassed = false;
          }
        } catch (e) {
          failures.push(`Could not parse retried generate request body: ${retryRequest.body}`);
          allPassed = false;
        }
      }
    }

    // Final result
    console.log("\n" + "=".repeat(50));
    if (allPassed) {
      console.log("M13 LIVE PROOF: PASS");
      process.exit(0);
    } else {
      console.log("M13 LIVE PROOF: FAIL");
      console.log("\nFAILED ASSERTIONS:");
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.log(`FAIL - Proof threw: ${(error as Error).message}`);
    console.error(error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
