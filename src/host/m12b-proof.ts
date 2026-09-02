// M12b live proof: demonstrates that when a profile is changed through the UI's DOM,
// the subsequent generation uses the newly selected profile.
//
// Driven through the UI's own send path with the real API client, real coordinator
// and a real token against the live harness, a conversation is created on profile A,
// the profile is changed to profile B via a DOM change event (without manual render()),
// and the subsequent generation request and telemetry both report profile B.
// Proven at a Mac-run entry point under happy-dom -- no browser required.

import { Window } from "happy-dom";
import { resolveBaseUrl, readToken } from "./config.ts";
import { createMemoryStorage } from "../../web/src/storage-port.ts";
import { createApiClient } from "../../web/src/api-client.ts";
import { createConversationStore } from "../../web/src/conversation-store.ts";
import { createSessionCoordinator } from "../../web/src/session-coordinator.ts";
import { createDomTarget } from "../../web/src/ui/dom-target.ts";
import { mount } from "../../web/src/ui/mount.ts";
import type { Telemetry } from "../../web/src/sse-reader.ts";

interface RecordedRequest {
  method: string;
  url: string;
  body: string | null;
}

interface WrapperState {
  requests: RecordedRequest[];
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

  let allPassed = true;
  const failures: string[] = [];

  try {
    // Create happy-dom window
    const w = new Window() as any;
    const root = w.document.body as HTMLElement;

    // Create a wrapper state to record requests
    const wrapperState: WrapperState = {
      requests: [],
    };

    // Create a wrapping fetch that records request bodies
    const wrappingFetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      const body = init?.body || null;

      // Record the request
      wrapperState.requests.push({
        method,
        url,
        body: typeof body === "string" ? body : null,
      });

      // Call the real fetch
      return await globalThis.fetch(input, init);
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

    // List profiles and pick two distinct ones
    console.log("\nListing profiles...");
    const profiles = await apiClient.listProfiles();
    console.log(`Found ${profiles.length} profiles`);
    for (const p of profiles) {
      console.log(`  - ${p.id} (${p.latency_class})`);
    }

    if (profiles.length < 2) {
      console.log("FAIL - Need at least 2 profiles, found " + profiles.length);
      process.exit(1);
    }

    // Pick profile B as the interactive profile (generation target)
    let profileB = profiles.find((p) => p.latency_class === "interactive") ?? profiles[0];
    if (!profileB) {
      console.log("FAIL - No profiles available");
      process.exit(1);
    }

    // Pick profile A as any other distinct profile
    let profileA = profiles.find((p) => p.id !== profileB.id);
    if (!profileA) {
      console.log("FAIL - Could not find two distinct profiles");
      process.exit(1);
    }

    if (profileA.id === profileB.id) {
      console.log("FAIL - Selected profiles have the same id");
      process.exit(1);
    }

    console.log(`Profile A (initial): ${profileA.id}`);
    console.log(`Profile B (target): ${profileB.id}`);

    // Set profiles in the state via the mount handle
    handle.setProfiles(profiles);

    // Force a render to update the DOM
    handle.render();

    // Create a conversation on profile A
    console.log("\nCreating conversation on profile A...");
    const profileSelect = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
    if (!profileSelect) {
      console.log("FAIL - profile-select not found in DOM");
      process.exit(1);
    }

    console.log(`Setting profile select to: ${profileA.id}`);
    profileSelect.value = profileA.id;
    // Note: We don't dispatch change here; the create button handler will use the current select value

    // Click create-conversation button via DOM
    const createBtn = root.querySelector('[data-testid="create-conversation"]') as HTMLButtonElement | null;
    if (!createBtn) {
      console.log("FAIL - create-conversation button not found in DOM");
      process.exit(1);
    }

    console.log("Clicking create-conversation button...");
    createBtn.dispatchEvent(new w.Event("click", { bubbles: true }));

    // Wait for the conversation to be created
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

    // Verify profile A is selected in DOM
    console.log("\nVerifying profile A is selected...");
    const selectForVerifyA = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
    if (!selectForVerifyA) {
      failures.push("profile-select not found when verifying initial profile");
      allPassed = false;
    } else {
      // Use the correct assertion style from Test A: check the selected option
      const selectedOption = Array.from(selectForVerifyA.querySelectorAll("option"))
        .find((opt: any) => opt.selected);

      console.log(`  select.value = "${selectForVerifyA.value}"`);
      console.log(`  selected option value = "${(selectedOption as any)?.value ?? 'undefined'}"`);

      if (!selectedOption) {
        failures.push("No option is marked as selected in the select element");
        allPassed = false;
      } else if ((selectedOption as any).value !== profileA.id) {
        failures.push(`Expected profile A (${profileA.id}) but selected option has value ${(selectedOption as any).value}`);
        allPassed = false;
      } else {
        console.log(`PASS - Profile A (${profileA.id}) is selected`);
      }
    }

    // Verify "(selected)" marker is against profile A in the profiles list
    // The profiles list is the 3rd <ul> in the DOM (0=conversations, 1=transcript, 2=profiles)
    const profilesList = root.querySelectorAll("ul")[2] as HTMLElement | null;
    if (profilesList) {
      const profileListItems = Array.from(profilesList.querySelectorAll("li"));
      console.log(`  Profiles list items: ${profileListItems.map((li: any) => li.textContent).join(" | ")}`);

      // Match by label, not id (paint renders label)
      const profileALabel = profileListItems.find((li) => (li.textContent || "").includes(profileA.label));
      if (!profileALabel) {
        failures.push(`Profile A label "${profileA.label}" not found in profiles list`);
        allPassed = false;
      } else if ((profileALabel.textContent || "").includes("(selected)")) {
        console.log(`PASS - "(selected)" marker is against profile A`);
      } else {
        failures.push(`"(selected)" marker is not against profile A (found: "${profileALabel.textContent}")`);
        allPassed = false;
      }
    } else {
      failures.push("Profiles list not found in DOM (no 3rd ul)");
      allPassed = false;
    }

    // Allow DOM to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change profile to B via DOM (no manual render() call)
    console.log("\nChanging profile to B via DOM...");
    const profileSelectForChange = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
    if (!profileSelectForChange) {
      console.log("FAIL - profile-select not found when changing profile");
      process.exit(1);
    }

    console.log(`Setting profile select to: ${profileB.id}`);
    profileSelectForChange.value = profileB.id;
    profileSelectForChange.dispatchEvent(new w.Event("change", { bubbles: true }));

    // Allow the change handler and its async render() to run
    // The dom-target's change handler calls chooseProfile().then(() => render())
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Wait for DOM to show profile B is selected (use selected option, not select.value)
    console.log("Waiting for DOM to reflect profile B selection...");
    const domUpdated = await waitForCondition(() => {
      const select = root.querySelector('[data-testid="profile-select"]') as HTMLSelectElement | null;
      if (!select) return false;
      const selectedOption = Array.from(select.querySelectorAll("option"))
        .find((opt: any) => opt.selected);
      return (selectedOption as any)?.value === profileB.id;
    }, 5000, 500);

    if (!domUpdated) {
      failures.push(`DOM did not update to show profile B (${profileB.id}) selected`);
      allPassed = false;
      console.log("FAIL - DOM did not update to show profile B selected");
    } else {
      console.log(`PASS - DOM shows profile B (${profileB.id}) is selected`);
    }

    // Verify "(selected)" marker is now against profile B
    // The profiles list is the 3rd <ul> in the DOM (0=conversations, 1=transcript, 2=profiles)
    const profilesListAfterChange = root.querySelectorAll("ul")[2] as HTMLElement | null;
    if (profilesListAfterChange) {
      const profileListItems = Array.from(profilesListAfterChange.querySelectorAll("li"));
      console.log(`  Profiles list items after change: ${profileListItems.map((li: any) => li.textContent).join(" | ")}`);

      // Match by label, not id (paint renders label)
      const profileBLabel = profileListItems.find((li) => (li.textContent || "").includes(profileB.label));
      const profileALabel = profileListItems.find((li) => (li.textContent || "").includes(profileA.label));

      if (!profileBLabel) {
        failures.push(`Profile B label "${profileB.label}" not found in profiles list`);
        allPassed = false;
      } else if ((profileBLabel.textContent || "").includes("(selected)")) {
        console.log(`PASS - "(selected)" marker is now against profile B`);
      } else {
        failures.push(`"(selected)" marker is not against profile B after change (found: "${profileBLabel.textContent}")`);
        allPassed = false;
      }

      if (!profileALabel) {
        failures.push(`Profile A label "${profileA.label}" not found in profiles list`);
        allPassed = false;
      } else if ((profileALabel.textContent || "").includes("(selected)")) {
        failures.push(`"(selected)" marker is still against profile A after change (found: "${profileALabel.textContent}")`);
        allPassed = false;
      } else {
        console.log(`PASS - "(selected)" marker is no longer against profile A`);
      }
    } else {
      failures.push("Profiles list not found in DOM when verifying after change (no 3rd ul)");
      allPassed = false;
    }

    // Allow DOM to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get prompt input and send a message
    console.log("\nSending message with profile B...");
    const promptInput = root.querySelector('[data-testid="prompt-input"]') as HTMLTextAreaElement | null;
    if (!promptInput) {
      console.log("FAIL - prompt-input not found in DOM");
      process.exit(1);
    }

    const prompt = "Reply with one short sentence.";
    console.log(`Prompt: ${prompt}`);
    promptInput.value = prompt;

    // Capture telemetry via onComplete handler
    let capturedTelemetry: Telemetry | null = null;
    let sendErrorCode: string | null = null;

    console.log("Sending prompt via the app's real send path...");

    // Call handle.actions.send directly to capture telemetry
    const sendPromise = handle.actions.send(conversation.id, prompt, {
      onComplete: (telemetry: Telemetry) => {
        capturedTelemetry = telemetry;
        console.log(`Received telemetry: profile_id=${telemetry.profile_id}`);
      },
      onError: (code: string) => {
        sendErrorCode = code;
        console.log(`Generation error: ${code}`);
      },
    });

    // Add catch handler to capture any promise errors without throwing
    sendPromise.catch((error) => {
      console.log(`Send error: ${(error as Error).message}`);
    });

    // Wait for telemetry or error with generous timeout (at least 120s)
    const telemetryWait = await waitForCondition(() => {
      return capturedTelemetry !== null || sendErrorCode !== null;
    }, 120000, 500);

    if (!telemetryWait) {
      failures.push("Generation did not complete within 120 seconds (no telemetry or error received)");
      allPassed = false;
    }

    // Assert: Check the request body has profile B's id
    console.log("\nAnalyzing captured requests...");
    const generateRequests = wrapperState.requests.filter(
      (req) => req.method === "POST" && req.url.includes("/v1/sessions/") && req.url.includes("/generate")
    );

    console.log(`Found ${generateRequests.length} generate request(s)`);

    if (generateRequests.length === 0) {
      failures.push("No POST /v1/sessions/.../generate request found");
      allPassed = false;
    } else {
      const generateReq = generateRequests[generateRequests.length - 1]; // Use the last one
      console.log(`Generate request URL: ${generateReq?.url}`);

      if (generateReq && generateReq.body) {
        try {
          const bodyObj = JSON.parse(generateReq.body) as any;
          console.log(`Generate request body: ${JSON.stringify(bodyObj)}`);

          if (bodyObj.profile_id === profileB.id) {
            console.log(`PASS - Request body has profile B's id (${profileB.id})`);
          } else {
            failures.push(`Request body has profile_id=${bodyObj.profile_id}, expected ${profileB.id}`);
            allPassed = false;
          }

          if (bodyObj.profile_id === profileA.id) {
            failures.push(`Request body still has profile A's id (${profileA.id})`);
            allPassed = false;
          }
        } catch (e) {
          failures.push(`Could not parse generate request body: ${generateReq.body}`);
          allPassed = false;
        }
      } else {
        failures.push("Generate request has no body");
        allPassed = false;
      }
    }

    // Assert: Check telemetry has profile B's id
    console.log("\nAnalyzing captured telemetry...");
    if (!capturedTelemetry) {
      failures.push("No telemetry captured from onComplete handler");
      allPassed = false;
    } else {
      const telemetry = capturedTelemetry as Telemetry;
      console.log(`Telemetry profile_id: ${telemetry.profile_id}`);

      if (telemetry.profile_id === profileB.id) {
        console.log(`PASS - Telemetry has profile B's id (${profileB.id})`);
      } else {
        failures.push(`Telemetry has profile_id=${telemetry.profile_id}, expected ${profileB.id}`);
        allPassed = false;
      }

      if (telemetry.profile_id === profileA.id) {
        failures.push(`Telemetry still has profile A's id (${profileA.id})`);
        allPassed = false;
      }
    }

    // Final result
    console.log("\n" + "=".repeat(50));
    if (allPassed) {
      console.log("M12B LIVE PROOF: PASS");
      process.exit(0);
    } else {
      console.log("M12B LIVE PROOF: FAIL");
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
