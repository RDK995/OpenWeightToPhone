// M12 live proof: demonstrates that a real prompt sent through the UI's own DOM
// send path against the live harness streams incrementally and completes with
// rendered telemetry.
//
// Driven through the UI's own send path with the real API client, real coordinator
// and a real token against the live harness, a prompt streams incrementally and
// ends in a `complete` whose telemetry the view renders.
// Proven at a Mac-run entry point under happy-dom -- no browser required.

import { Window } from "happy-dom";
import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createApiClient } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";
import { createDomTarget } from "../../web/src/ui/dom-target.ts";
import { mount } from "../../web/src/ui/mount.ts";

interface StreamObservation {
  transcript: string;
  statusText: string;
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
  // Read config
  const baseUrl = resolveBaseUrl();
  const token = readToken();

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token: ${token.substring(0, 20)}...`);

  let allPassed = true;
  const failures: string[] = [];

  try {
    // Create happy-dom window
    const w = new Window() as any;
    const root = w.document.body as HTMLElement;

    // Build module chain
    const storage = createMemoryStorage();
    const conversationStore = createConversationStore(storage);

    const apiClient = createApiClient({
      baseUrl,
      getToken: () => token,
      fetch: globalThis.fetch,
    });

    const sessionCoordinator = createSessionCoordinator({
      apiClient,
      conversationStore,
    });

    // Create DOM target
    const target = createDomTarget(root);

    // Mount the UI
    const handle = mount({
      target,
      coordinator: sessionCoordinator,
      store: conversationStore,
    });

    // Attach the DOM target
    target.attach({
      actions: handle.actions,
      controller: handle,
    });

    // List profiles and pick interactive one
    console.log("\nListing profiles...");
    const profiles = await apiClient.listProfiles();
    console.log(`Found ${profiles.length} profiles`);
    for (const p of profiles) {
      console.log(`  - ${p.id} (${p.latency_class})`);
    }

    let selectedProfile = profiles.find((p) => p.latency_class === "interactive");
    if (!selectedProfile) {
      selectedProfile = profiles[0];
    }
    if (!selectedProfile) {
      console.log("FAIL - No profiles available");
      process.exit(1);
    }

    console.log(`Selected profile: ${selectedProfile.id}`);

    // Set profiles in the state via the mount handle
    handle.setProfiles(profiles);

    // Force a render to update the DOM
    handle.render();

    // Populate profile selector via DOM
    console.log("\nSetting up conversation...");
    const profileSelect = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
    if (!profileSelect) {
      console.log("FAIL - profile-select not found in DOM");
      process.exit(1);
    }

    console.log(`Setting profile select to: ${selectedProfile.id}`);
    // Set the profile select value to the selected profile id
    profileSelect.value = selectedProfile.id;
    console.log(`Profile select value after set: ${profileSelect.value}`);
    profileSelect.dispatchEvent(new w.Event("change", { bubbles: true }));

    // Click create-conversation button via DOM
    const createBtn = root.querySelector('[data-testid="create-conversation"]') as HTMLButtonElement | null;
    if (!createBtn) {
      console.log("FAIL - create-conversation button not found in DOM");
      console.log("Available buttons:", root.innerHTML);
      process.exit(1);
    }

    console.log("Clicking create-conversation button...");
    createBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    console.log("Button clicked");

    // Wait for the conversation to be created AND the DOM to reflect it.
    // dom-target.ts's create handler awaits actions.createConversation() and,
    // on resolution, calls controller.render() and controller.select() itself
    // -- so the open-conversation button appearing in the DOM is the proof
    // that the app repainted without any manual render() from this proof.
    const conversationCreated = await waitForCondition(() => {
      return root.querySelector('[data-testid="open-conversation"]') !== null;
    });

    if (!conversationCreated) {
      console.log("FAIL - No conversation created (open-conversation button never appeared) after timeout");
      process.exit(1);
    }

    const conversations = conversationStore.loadConversations();
    const conversation = conversations[0];
    if (!conversation) {
      console.log("FAIL - Conversation not found after creation");
      process.exit(1);
    }
    console.log(`Created conversation: ${conversation.id}`);

    // The create handler already selected the new conversation (no click on
    // open-conversation needed to prove that) -- confirm it directly out of
    // the rendered DOM before proceeding.
    const openBtn = root.querySelector('[data-testid="open-conversation"]') as HTMLButtonElement | null;
    if (!openBtn) {
      console.log("FAIL - open-conversation button not found in DOM");
      process.exit(1);
    }
    if (!(openBtn.textContent || "").includes("▸")) {
      console.log("FAIL - new conversation was not auto-selected after create");
      process.exit(1);
    }
    console.log(`Conversation ${conversation.id} is selected without any manual select() call`);

    // Allow DOM to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify conversation is selected
    const state = handle.getState();
    console.log(`Selected conversation: ${state.selectedConversationId}`);

    // Set prompt and send via DOM
    const promptInput = root.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
    if (!promptInput) {
      console.log("FAIL - prompt-input not found in DOM");
      process.exit(1);
    }

    const prompt = "My favourite number is 42. Acknowledge this in one short sentence.";
    console.log(`\nPrompt: ${prompt}`);

    promptInput.value = prompt;

    // Record observations during the send
    const observations: StreamObservation[] = [];

    // We need to intercept the paint calls to record observations
    // Store the original paint method
    const originalPaint = target.paint.bind(target);
    target.paint = function (view: any) {
      // Call original paint first
      originalPaint(view);

      // Read transcript from DOM - look for the pending assistant entry
      // The transcript is in the second section (index 1)
      const sections = root.querySelectorAll("section");
      const transcriptSection = sections[2]; // 0=controls, 1=conversations, 2=transcript
      const transcriptItems = transcriptSection?.querySelectorAll("li") || [];

      let transcriptText = "";
      for (const item of Array.from(transcriptItems)) {
        const text = item.textContent || "";
        // Look for assistant entries that might have (pending) marker
        if (text.includes("assistant:")) {
          const content = text.substring("assistant:".length).trim();
          // Remove the (pending) marker if present
          const cleanContent = content.replace(/\s*\(pending\)\s*$/, "");
          if (cleanContent) {
            transcriptText = cleanContent;
          }
        }
      }

      // Read status from DOM - it should have data-testid="status"
      const statusSection = root.querySelector('[data-testid="status"]') as HTMLElement | null;
      const statusText = statusSection?.textContent || "";

      observations.push({
        transcript: transcriptText,
        statusText,
      });
    };

    // Now send the prompt by clicking the send button
    const sendBtn = root.querySelector('[data-testid="send"]') as HTMLButtonElement | null;
    if (!sendBtn) {
      console.log("FAIL - send button not found in DOM");
      process.exit(1);
    }

    console.log("\nSending prompt...");
    sendBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

    // Wait for the generation to complete (not just streaming)
    // The status should change from "Streaming..." or "Loading model..." to "Complete" or "Error"
    const generationComplete = await waitForCondition(() => {
      const statusSection = root.querySelector('[data-testid="status"]') as HTMLElement | null;
      const statusText = statusSection?.textContent || "";
      // Check if the generation is complete (not in Idle, Queued, or Streaming state)
      return (
        statusText.includes("Complete") ||
        statusText.includes("Error") ||
        statusText.includes("Cancelled")
      );
    }, 60000, 500);

    if (!generationComplete) {
      console.log("FAIL - Generation did not complete within 60 seconds");
      process.exit(1);
    }

    // Debug: log what we see in the DOM after sending
    const sections = root.querySelectorAll("section");
    const transcriptSection = sections[2];
    const transcriptItems = transcriptSection?.querySelectorAll("li") || [];
    console.log(`Transcript items: ${transcriptItems.length}`);
    for (const item of Array.from(transcriptItems)) {
      console.log(`  Transcript: ${item.textContent}`);
    }

    // Debug: log API requests made
    const requestLog = apiClient.getRequestLog();
    console.log(`\nAPI requests made: ${requestLog.length}`);
    for (const req of requestLog) {
      console.log(`  ${req.method} ${req.url}`);
    }

    // Analyze observations
    console.log("\n=== INCREMENTALITY ANALYSIS ===");
    console.log(`Observations recorded: ${observations.length}`);

    // Find distinct transcript lengths over time
    const distinctTranscripts = new Set<string>();
    let lastTranscript = "";

    for (const obs of observations) {
      if (obs.transcript !== lastTranscript && obs.transcript !== "") {
        distinctTranscripts.add(obs.transcript);
        lastTranscript = obs.transcript;
      }
    }

    const distinctGrowthSteps = distinctTranscripts.size;
    console.log(`Distinct growth steps: ${distinctGrowthSteps}`);

    // Get the final status text for later use
    const lastObsStatus = observations[observations.length - 1]?.statusText || "";

    // Print first few prefixes to show streaming happened
    let count = 0;
    for (const obs of observations) {
      if (count < 5 && obs.transcript !== "") {
        const preview = obs.transcript.substring(0, 60);
        console.log(`  Prefix ${count}: "${preview}${obs.transcript.length > 60 ? "..." : ""}"`);
        count++;
      }
    }

    // Check incrementality - must be more than 1 distinct growth step
    if (distinctGrowthSteps < 2) {
      failures.push(`No incremental growth detected: expected at least 2 distinct growth steps, observed ${distinctGrowthSteps}`);
      allPassed = false;
      console.log("FAIL - No incremental growth detected (single jump or no content)");
    } else {
      console.log(`PASS - Incremental streaming detected (${distinctGrowthSteps} distinct growth steps)`);
    }

    // Get the final status text
    console.log("\n=== FINAL STATUS ===");
    const statusSectionFinal = root.querySelector('[data-testid="status"]') as HTMLElement | null;
    const finalStatusText = statusSectionFinal?.textContent || "";
    console.log(`Status: ${finalStatusText}`);

    // Verify completion telemetry
    if (
      finalStatusText.includes("Complete") &&
      finalStatusText.includes("tok/s") &&
      finalStatusText.includes("tokens evaluated") &&
      finalStatusText.includes("quantization") &&
      finalStatusText.includes("context limit")
    ) {
      console.log("PASS - Completion telemetry found in status");
    } else {
      const missingFields: string[] = [];
      if (!finalStatusText.includes("Complete")) missingFields.push("Complete");
      if (!finalStatusText.includes("tok/s")) missingFields.push("tok/s");
      if (!finalStatusText.includes("tokens evaluated")) missingFields.push("tokens evaluated");
      if (!finalStatusText.includes("quantization")) missingFields.push("quantization");
      if (!finalStatusText.includes("context limit")) missingFields.push("context limit");
      failures.push(`Missing completion telemetry in final status: missing [${missingFields.join(", ")}]`);
      allPassed = false;
      console.log("FAIL - Missing completion telemetry in status");
      console.log(`Expected status to contain: "Complete", "tok/s", "tokens evaluated", "quantization", "context limit"`);
      console.log(`Actual status: "${finalStatusText}"`);
    }

    // Print conversation id and profile used
    console.log("\n=== PROOF SUMMARY ===");
    console.log(`Profile ID: ${selectedProfile.id}`);
    console.log(`Prompt sent: ${prompt}`);
    if (conversation) {
      console.log(`Conversation ID: ${conversation.id}`);
    }

    // Final result
    if (allPassed) {
      console.log("\nM12 LIVE PROOF: PASS");
      process.exit(0);
    } else {
      console.log("\nM12 LIVE PROOF: FAIL");
      console.log("\nFAILED ASSERTIONS:");
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }

      // Print observed facts
      console.log("\nOBSERVED:");
      console.log(`- API requests made: ${requestLog.length}`);
      for (const req of requestLog) {
        console.log(`  ${req.method} ${req.url}`);
      }
      console.log(`- Observations recorded: ${observations.length}`);
      console.log(`- Distinct growth steps: ${distinctGrowthSteps}`);
      console.log(`- Final status: ${finalStatusText}`);
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
