// Milestone M12 acceptance criterion 3: the built bundle is interactive.
// This test process has no `document` global (asserted), so importing the
// built bundle here proves the browser guard in main.ts is exercised. The
// test drives the built bundle through a full create -> send -> stream ->
// complete flow using the DOM controls, confirming that bootstrap() returns
// a handle, attaches it to the DOM target, and populates the profile selector.
import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { Window } from "happy-dom";
import { build } from "../../../scripts/build.ts";
import type { ApiClient, Profile } from "../../../web/src/api-client";
import type { StoragePort } from "../../../web/src/storage-port";
import type { LocationPort } from "../../../web/src/credential-store";
import type { HarnessEvent } from "../../../web/src/sse-reader";

const distDir = join(import.meta.dir, "..", "..", "..", "web", "dist");

async function importBuiltBundle(): Promise<any> {
  const mainJsPath = join(distDir, "main.js");
  const moduleUrl = `${pathToFileURL(mainJsPath).href}?v=${Date.now()}-${Math.random()}`;
  return await import(moduleUrl);
}

function createMemoryStorage(): StoragePort {
  const storage = new Map<string, string>();
  return {
    get(key: string): string | null {
      return storage.get(key) ?? null;
    },
    set(key: string, value: string): void {
      storage.set(key, value);
    },
    remove(key: string): void {
      storage.delete(key);
    },
  };
}

async function* generateTestEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "model-loading" };
  yield { seq: 3, kind: "content", delta: "Hello" };
  yield { seq: 4, kind: "content", delta: " " };
  yield { seq: 5, kind: "content", delta: "World" };
  yield {
    seq: 6,
    kind: "complete",
    telemetry: {
      profile_id: "test-profile",
      quantization: "q4",
      context_limit: 2048,
      total_duration_ns: 1000000,
      load_duration_ns: 500000,
      prompt_eval_count: 10,
      eval_count: 20,
      tokens_per_second: 50,
    },
  };
}

describe("bundle-interactive", () => {
  let buildResult: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    buildResult = await build();
  });

  it("build() resolves without throwing and includes main.js", () => {
    expect(buildResult.files).toContain("main.js");
  });

  it("writes main.js to web/dist", () => {
    expect(existsSync(join(distDir, "main.js"))).toBe(true);
  });

  it("runs with no document global", () => {
    expect(typeof document).toBe("undefined");
  });

  it("dynamically imports the built main.js and exposes bootstrap()", async () => {
    const mod = await importBuiltBundle();
    expect(typeof mod.bootstrap).toBe("function");
  });

  it("bootstrap returns a MountHandle", async () => {
    const mod = await importBuiltBundle();

    const w = new Window();
    const doc = w.document;
    const root = doc.createElement("div");
    root.id = "app";
    doc.body.appendChild(root);

    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "",
      origin: "https://test.example.com",
      clearHash() {},
    };

    const createApiClient = (_config: any): ApiClient => ({
      listProfiles: async () => [],
      createSession: async () => "session-test",
      getSession: async () => ({
        session_id: "session-test",
        created_at: "2026-09-01T00:00:00Z",
        turns: [],
        generations: [],
      }),
      generate: async () => ({
        generationId: "gen-test",
        events: generateTestEvents(),
      }),
      resumeEvents: async () => ({
        generationId: "gen-test",
        events: generateTestEvents(),
      }),
      cancel: async () => ({ status: "cancelled" }),
      appendTurn: async (sessionId: string, turn) => ({
        index: 0,
        role: turn.role,
        content: turn.content,
        created_at: "2026-09-01T00:00:00Z",
        cancelled: false,
      }),
      getRequestLog: () => [],
      clearRequestLog: () => {},
    });

    let handle: unknown;
    expect(() => {
      handle = mod.bootstrap(root, {
        storage,
        location,
        createApiClient,
      });
    }).not.toThrow();

    expect(handle).toBeDefined();
    expect(typeof (handle as any)?.getState).toBe("function");
    expect(typeof (handle as any)?.render).toBe("function");
    expect(typeof (handle as any)?.setProfiles).toBe("function");
    expect(typeof (handle as any)?.actions?.send).toBe("function");
  });

  it("drives create -> send -> stream -> complete through the DOM controls", async () => {
    const mod = await importBuiltBundle();

    const w = new Window();
    const doc = w.document;
    const root = doc.createElement("div");
    root.id = "app";
    doc.body.appendChild(root);

    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "",
      origin: "https://test.example.com",
      clearHash() {},
    };

    const testProfile: Profile = {
      id: "test-profile",
      label: "Test Model",
      context_limit: 2048,
      latency_class: "low",
      role: "assistant",
      quality: "high",
    };

    const createApiClient = (_config: any): ApiClient => ({
      listProfiles: async () => [testProfile],
      createSession: async () => "session-test-123",
      getSession: async () => ({
        session_id: "session-test-123",
        created_at: "2026-09-01T00:00:00Z",
        turns: [],
        generations: [],
      }),
      generate: async () => ({
        generationId: "gen-test-456",
        events: generateTestEvents(),
      }),
      resumeEvents: async () => ({
        generationId: "gen-test-456",
        events: generateTestEvents(),
      }),
      cancel: async () => ({ status: "cancelled" }),
      appendTurn: async (sessionId: string, turn) => ({
        index: 0,
        role: turn.role,
        content: turn.content,
        created_at: "2026-09-01T00:00:00Z",
        cancelled: false,
      }),
      getRequestLog: () => [],
      clearRequestLog: () => {},
    });

    // Bootstrap and verify handle is returned
    let handle: any;
    expect(() => {
      handle = mod.bootstrap(root, {
        storage,
        location,
        createApiClient,
      });
    }).not.toThrow();

    expect(handle).toBeDefined();
    expect(typeof handle.getState).toBe("function");
    expect(typeof handle.render).toBe("function");
    expect(typeof handle.setProfiles).toBe("function");
    expect(typeof handle.actions?.send).toBe("function");

    // Wait for profiles to be populated via coordinator.listProfiles()
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify profile selector is populated from the DOM
    const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
    expect(profileSelect).not.toBeNull();
    if (profileSelect) {
      expect((profileSelect as any).options.length).toBeGreaterThan(0);
      // Select the first available profile
      if ((profileSelect as any).options.length > 0) {
        (profileSelect as any).value = (profileSelect as any).options[0].value;
      }
    }

    // Click create-conversation button to create a new conversation
    const createBtn = root.querySelector('[data-testid="create-conversation"]') as any;
    expect(createBtn).not.toBeNull();
    expect(() => {
      createBtn.dispatchEvent(new w.Event("click"));
    }).not.toThrow();

    // Wait for the conversation to be created. dom-target.ts's
    // create-conversation button handler awaits actions.createConversation()
    // and, on resolution, calls controller.render() and controller.select()
    // itself -- the DOM must repaint and select the new conversation with no
    // further help from the test.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the open-conversation button for the new conversation (should be the first one)
    const openBtns = root.querySelectorAll('[data-testid="open-conversation"]') as any;
    expect(openBtns.length).toBeGreaterThan(0);

    // The create handler already selected the new conversation (no click on
    // open-conversation needed to prove that). dom-target.ts prefixes the
    // selected conversation's button text with "▸ ", so read that directly
    // out of the rendered DOM rather than trusting internal state.
    expect((openBtns[0] as any).textContent).toContain("▸");
    expect(handle.getState().selectedConversationId).not.toBeNull();

    // Set the prompt input value
    const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
    expect(promptInput).not.toBeNull();
    promptInput.value = "Hello, world!";

    // Click the send button
    const sendBtn = root.querySelector('[data-testid="send"]') as any;
    expect(sendBtn).not.toBeNull();
    expect(() => {
      sendBtn.dispatchEvent(new w.Event("click"));
    }).not.toThrow();

    // Wait for the stream to settle
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert that the transcript in the DOM contains the streamed assistant text
    const transcriptList = root.querySelectorAll("ul")[1] as any; // Second ul is the transcript
    expect(transcriptList).not.toBeNull();
    const transcriptText = transcriptList?.textContent ?? "";
    expect(transcriptText).toContain("Hello");
    expect(transcriptText).toContain("World");

    // Assert that the status region renders the completion telemetry.
    // dom-target.ts appends six sections in order: controls, conversations,
    // transcript, profiles, status, notice (BLOCKER 2 correction, M12-C1T2,
    // added the notice section last). Use data-testid="status" to select the
    // status section explicitly instead of relying on position.
    const statusSection = root.querySelector('[data-testid="status"]');
    const statusText = statusSection?.textContent ?? "";
    expect(statusText).toContain("Complete");
    expect(statusText).toContain("tok/s");
  });
});
