import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { mount } from "../../../web/src/ui/mount";
import type { RenderTarget } from "../../../web/src/ui/render-target";
import type { SessionCoordinator } from "../../../web/src/session-coordinator";
import type { ConversationStore, Conversation } from "../../../web/src/conversation-store";
import type { Profile } from "../../../web/src/api-client";
import type { ViewModel, GenerationDisplay } from "../../../web/src/ui/view-model";

function createFakeTarget(): { target: RenderTarget; paints: ViewModel[] } {
  const paints: ViewModel[] = [];
  return {
    target: {
      paint(view: ViewModel) {
        paints.push(view);
      },
    },
    paints,
  };
}

function createFakeCoordinator(): {
  coordinator: SessionCoordinator;
  state: { sendCalls: number };
} {
  const state = { sendCalls: 0 };
  const coordinator: SessionCoordinator = {
    async createConversation() {
      throw new Error("not implemented");
    },
    async send(conversationId, prompt, handlers) {
      state.sendCalls++;
      return {
        generationId: "gen-1",
        text: "ok",
        status: "complete",
        telemetry: null,
        errorCode: null,
        streamError: null,
        sessionRebuilt: false,
        replayedTurns: 0,
      };
    },
    async cancel() {
      throw new Error("not implemented");
    },
    async resumeIfInterrupted() {
      throw new Error("not implemented");
    },
    async listProfiles() {
      return [];
    },
    async setProfile() {
      throw new Error("not implemented");
    },
  };
  return { coordinator, state };
}

function createFakeStore(initial: Conversation[] = []): {
  store: ConversationStore;
  addConversation: (conv: Conversation) => void;
} {
  const conversations: Conversation[] = [...initial];
  const store: ConversationStore = {
    loadConversations: () => [...conversations],
    getConversation: (id) => conversations.find((c) => c.id === id) ?? null,
    createConversation: () => {
      throw new Error("not implemented");
    },
    saveConversation: () => {
      throw new Error("not implemented");
    },
    appendTurn: () => {
      throw new Error("not implemented");
    },
    setSessionId: () => {
      throw new Error("not implemented");
    },
    setProfileId: () => {
      throw new Error("not implemented");
    },
    recordProgress: () => {
      throw new Error("not implemented");
    },
    deleteConversation: () => {
      throw new Error("not implemented");
    },
  };
  return {
    store,
    addConversation(conv: Conversation) {
      conversations.push(conv);
    },
  };
}

function makeConversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    title: "Untitled",
    sessionId: null,
    profileId: "fixture-profile-a",
    turns: [],
    pending: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("mount", () => {
  it("builds default state from the store and initialState defaults, painting once", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();

    const handle = mount({ target, coordinator, store });

    expect(paints.length).toBe(1);
    const state = handle.getState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.profiles).toEqual([]);
    expect(state.generation).toEqual({ kind: "idle" });
    expect(state.streamingText).toBe("");
    expect(state.conversations).toEqual([]);
  });

  it("applies initialState overrides", () => {
    const { target } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const conv = makeConversation({ id: "conv-1" });
    const { store } = createFakeStore([conv]);
    const profile: Profile = {
      id: "fixture-profile-a",
      role: "assistant",
      quality: "high",
      latency_class: "fast",
      label: "Fixture Profile",
    };
    const generation: GenerationDisplay = { kind: "streaming" };

    const handle = mount({
      target,
      coordinator,
      store,
      initialState: {
        selectedConversationId: "conv-1",
        profiles: [profile],
        generation,
        streamingText: "partial",
      },
    });

    const state = handle.getState();
    expect(state.selectedConversationId).toBe("conv-1");
    expect(state.profiles).toEqual([profile]);
    expect(state.generation).toEqual(generation);
    expect(state.streamingText).toBe("partial");
  });

  it("paints exactly once during mount(), via target.paint(buildViewModel(state))", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const conv = makeConversation({ id: "conv-1", title: "Hello" });
    const { store } = createFakeStore([conv]);

    mount({ target, coordinator, store });

    expect(paints.length).toBe(1);
    expect(paints[0]?.conversations).toHaveLength(1);
    expect(paints[0]?.conversations[0]?.id).toBe("conv-1");
  });

  it("render() re-reads the store so a newly added conversation appears in the second paint but not the first", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store, addConversation } = createFakeStore();

    const handle = mount({ target, coordinator, store });
    expect(paints.length).toBe(1);
    expect(paints[0]?.conversations).toEqual([]);

    addConversation(makeConversation({ id: "conv-new", title: "New" }));
    handle.render();

    expect(paints.length).toBe(2);
    expect(paints[1]?.conversations.map((c) => c.id)).toEqual(["conv-new"]);
  });

  it("select() updates selectedConversationId and paints exactly once more", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const conv = makeConversation({ id: "conv-1" });
    const { store } = createFakeStore([conv]);
    const handle = mount({ target, coordinator, store });

    handle.select("conv-1");

    expect(paints.length).toBe(2);
    expect(handle.getState().selectedConversationId).toBe("conv-1");
    expect(paints[1]?.conversations[0]?.selected).toBe(true);
  });

  it("setGeneration() updates generation and paints exactly once more", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();
    const handle = mount({ target, coordinator, store });

    const generation: GenerationDisplay = { kind: "queued", position: 2 };
    handle.setGeneration(generation);

    expect(paints.length).toBe(2);
    expect(handle.getState().generation).toEqual(generation);
    expect(paints[1]?.generation).toEqual(generation);
  });

  it("setStreamingText() updates streamingText and paints exactly once more", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const conv = makeConversation({ id: "conv-1" });
    const { store } = createFakeStore([conv]);
    const handle = mount({
      target,
      coordinator,
      store,
      initialState: { selectedConversationId: "conv-1" },
    });

    handle.setStreamingText("hello there");

    expect(paints.length).toBe(2);
    expect(handle.getState().streamingText).toBe("hello there");
    expect(
      paints[1]?.transcript.some((t) => t.pending && t.content === "hello there")
    ).toBe(true);
  });

  it("setProfiles() updates profiles and paints exactly once more", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();
    const handle = mount({ target, coordinator, store });

    const profile: Profile = {
      id: "fixture-profile-a",
      role: "assistant",
      quality: "high",
      latency_class: "fast",
      label: "Fixture",
    };
    handle.setProfiles([profile]);

    expect(paints.length).toBe(2);
    expect(handle.getState().profiles).toEqual([profile]);
    expect(paints[1]?.profiles).toEqual([profile]);
  });

  it("setNotice() updates notice and paints exactly once more", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();
    const handle = mount({ target, coordinator, store });

    handle.setNotice("This device is not paired. Scan the QR code to re-pair.");

    expect(paints.length).toBe(2);
    expect(handle.getState().notice).toBe(
      "This device is not paired. Scan the QR code to re-pair."
    );
    expect(paints[1]?.notice).toBe(
      "This device is not paired. Scan the QR code to re-pair."
    );

    handle.setNotice(null);

    expect(paints.length).toBe(3);
    expect(handle.getState().notice).toBeNull();
    expect(paints[2]?.notice).toBeNull();
  });

  it("applies initialState.notice, defaulting to null when omitted", () => {
    const { target } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();

    const defaulted = mount({ target, coordinator, store });
    expect(defaulted.getState().notice).toBeNull();

    const withNotice = mount({
      target,
      coordinator,
      store,
      initialState: { notice: "carried over" },
    });
    expect(withNotice.getState().notice).toBe("carried over");
  });

  it("getState() returns a copy that cannot mutate the mount's internal state", () => {
    const { target, paints } = createFakeTarget();
    const { coordinator } = createFakeCoordinator();
    const { store } = createFakeStore();
    const handle = mount({ target, coordinator, store });

    const stateCopy = handle.getState();
    stateCopy.selectedConversationId = "tampered";
    stateCopy.streamingText = "tampered";

    handle.render();

    expect(handle.getState().selectedConversationId).toBeNull();
    expect(handle.getState().streamingText).toBe("");
    expect(paints[paints.length - 1]?.generation).toEqual({ kind: "idle" });
  });

  it("actions is createActions(deps.coordinator): delegates send() to the coordinator", async () => {
    const { target } = createFakeTarget();
    const { coordinator, state } = createFakeCoordinator();
    const { store } = createFakeStore();
    const handle = mount({ target, coordinator, store });

    await handle.actions.send("conv-1", "hi");

    expect(state.sendCalls).toBe(1);
  });

  describe("no bypass access", () => {
    const mountTsPath = join(import.meta.dir, "../../../web/src/ui/mount.ts");

    it("should not contain document", () => {
      const content = readFileSync(mountTsPath, "utf-8");
      if (content.includes("document")) {
        throw new Error("Found document in mount.ts");
      }
    });

    it("should not contain window", () => {
      const content = readFileSync(mountTsPath, "utf-8");
      if (content.includes("window")) {
        throw new Error("Found window in mount.ts");
      }
    });

    it("should not contain localStorage", () => {
      const content = readFileSync(mountTsPath, "utf-8");
      if (content.includes("localStorage")) {
        throw new Error("Found localStorage in mount.ts");
      }
    });

    it("should not contain fetch(", () => {
      const content = readFileSync(mountTsPath, "utf-8");
      if (content.includes("fetch(")) {
        throw new Error("Found fetch( in mount.ts");
      }
    });

    it("should not have a runtime import of ./dom-target (import type is allowed)", () => {
      const content = readFileSync(mountTsPath, "utf-8");
      const pattern = /^(?!\s*import\s+type\b)\s*import\s+.*from\s+["']\.\/dom-target["']/m;
      if (pattern.test(content)) {
        throw new Error("Found a runtime import of ./dom-target in mount.ts");
      }
    });
  });
});
