import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createActions } from "../../../web/src/ui/actions";
import type {
  SessionCoordinator,
  GenerationHandlers,
  SendResult,
  ResumeResult,
} from "../../../web/src/session-coordinator";
import type { Conversation, ConversationStore } from "../../../web/src/conversation-store";
import type { Profile } from "../../../web/src/api-client";

// Recording fake coordinator to track calls
interface RecordingCoordinatorState {
  send: { calls: number; lastArgs?: [string, string, GenerationHandlers | undefined] };
  cancel: { calls: number; lastArgs?: [string] };
  createConversation: { calls: number; lastArgs?: [{ profileId: string; title?: string }] };
  resumeIfInterrupted: { calls: number; lastArgs?: [string, GenerationHandlers | undefined] };
  listProfiles: { calls: number };
  setProfile: { calls: number; lastArgs?: [string, string] };
}

function createRecordingCoordinator(): {
  coordinator: SessionCoordinator;
  state: RecordingCoordinatorState;
} {
  const state: RecordingCoordinatorState = {
    send: { calls: 0 },
    cancel: { calls: 0 },
    createConversation: { calls: 0 },
    resumeIfInterrupted: { calls: 0 },
    listProfiles: { calls: 0 },
    setProfile: { calls: 0 },
  };

  const sendResult: SendResult = {
    generationId: "gen-123",
    text: "Hello",
    status: "complete",
    telemetry: null,
    errorCode: null,
    streamError: null,
    sessionRebuilt: false,
    replayedTurns: 0,
  };

  const resumeResult: ResumeResult = {
    resumed: true,
    generationId: "gen-123",
    text: "continued",
    status: "complete",
    telemetry: null,
    errorCode: null,
    streamError: null,
    reconciledFromSession: false,
    seqs: [1, 2, 3],
  };

  const conversation: Conversation = {
    id: "conv-123",
    title: "Test",
    sessionId: "sess-123",
    profileId: "prof-123",
    turns: [],
    pending: null,
    createdAt: "2026-08-30T00:00:00Z",
    updatedAt: "2026-08-30T00:00:00Z",
  };

  const profile: Profile = {
    id: "prof-123",
    role: "assistant",
    quality: "high",
    latency_class: "fast",
    label: "Test Profile",
  };

  const coordinator: SessionCoordinator = {
    async send(conversationId, prompt, handlers) {
      state.send.calls++;
      state.send.lastArgs = [conversationId, prompt, handlers];
      return sendResult;
    },
    async cancel(conversationId) {
      state.cancel.calls++;
      state.cancel.lastArgs = [conversationId];
      return { status: "cancelled" };
    },
    async createConversation(input) {
      state.createConversation.calls++;
      state.createConversation.lastArgs = [input];
      return { ...conversation, profileId: input.profileId, title: input.title || "New Conversation" };
    },
    async resumeIfInterrupted(conversationId, handlers) {
      state.resumeIfInterrupted.calls++;
      state.resumeIfInterrupted.lastArgs = [conversationId, handlers];
      return resumeResult;
    },
    async listProfiles() {
      state.listProfiles.calls++;
      return [profile];
    },
    async setProfile(conversationId, profileId) {
      state.setProfile.calls++;
      state.setProfile.lastArgs = [conversationId, profileId];
      return { ...conversation, profileId };
    },
  };

  return { coordinator, state };
}

function createMockStore(): ConversationStore {
  return {
    loadConversations: () => [],
    getConversation: () => null,
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
}

describe("createActions", () => {
  let coordinator: SessionCoordinator;
  let state: RecordingCoordinatorState;

  beforeEach(() => {
    ({ coordinator, state } = createRecordingCoordinator());
  });

  describe("send", () => {
    it("delegates to coordinator.send with exact arguments", async () => {
      const actions = createActions(coordinator, createMockStore());
      const handlers: GenerationHandlers = {
        onDelta: (delta) => {},
      };

      const result = await actions.send("conv-1", "test prompt", handlers);

      expect(state.send.calls).toBe(1);
      expect(state.send.lastArgs).toEqual(["conv-1", "test prompt", handlers]);
      expect(result).toBe(result);
    });

    it("returns the coordinator's result identically", async () => {
      const actions = createActions(coordinator, createMockStore());
      const result = await actions.send("conv-1", "prompt");

      expect(result).toEqual({
        generationId: "gen-123",
        text: "Hello",
        status: "complete",
        telemetry: null,
        errorCode: null,
        streamError: null,
        sessionRebuilt: false,
        replayedTurns: 0,
      });
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Network error");
      coordinator.send = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.send("conv-1", "prompt");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.send("conv-1", "prompt");

      expect(state.cancel.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });

    it("handles optional handlers parameter", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.send("conv-1", "prompt");

      expect(state.send.lastArgs?.[2]).toBeUndefined();
    });
  });

  describe("cancel", () => {
    it("delegates to coordinator.cancel with exact arguments", async () => {
      const actions = createActions(coordinator, createMockStore());
      const result = await actions.cancel("conv-1");

      expect(state.cancel.calls).toBe(1);
      expect(state.cancel.lastArgs).toEqual(["conv-1"]);
      expect(result).toEqual({ status: "cancelled" });
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Cancel failed");
      coordinator.cancel = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.cancel("conv-1");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.cancel("conv-1");

      expect(state.send.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });
  });

  describe("chooseProfile", () => {
    it("delegates to coordinator.setProfile with exact arguments", async () => {
      const actions = createActions(coordinator, createMockStore());
      const result = await actions.chooseProfile("conv-1", "prof-456");

      expect(state.setProfile.calls).toBe(1);
      expect(state.setProfile.lastArgs).toEqual(["conv-1", "prof-456"]);
      expect(result.profileId).toBe("prof-456");
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Profile not found");
      coordinator.setProfile = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.chooseProfile("conv-1", "prof-456");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.chooseProfile("conv-1", "prof-456");

      expect(state.send.calls).toBe(0);
      expect(state.cancel.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
    });
  });

  describe("resumeIfInterrupted", () => {
    it("delegates to coordinator.resumeIfInterrupted with exact arguments", async () => {
      const actions = createActions(coordinator, createMockStore());
      const handlers: GenerationHandlers = {
        onDelta: (delta) => {},
      };

      const result = await actions.resumeIfInterrupted("conv-1", handlers);

      expect(state.resumeIfInterrupted.calls).toBe(1);
      expect(state.resumeIfInterrupted.lastArgs).toEqual(["conv-1", handlers]);
      expect(result).toEqual({
        resumed: true,
        generationId: "gen-123",
        text: "continued",
        status: "complete",
        telemetry: null,
        errorCode: null,
        streamError: null,
        reconciledFromSession: false,
        seqs: [1, 2, 3],
      });
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Resume failed");
      coordinator.resumeIfInterrupted = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.resumeIfInterrupted("conv-1");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.resumeIfInterrupted("conv-1");

      expect(state.send.calls).toBe(0);
      expect(state.cancel.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });

    it("handles optional handlers parameter", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.resumeIfInterrupted("conv-1");

      expect(state.resumeIfInterrupted.lastArgs?.[1]).toBeUndefined();
    });
  });

  describe("listProfiles", () => {
    it("delegates to coordinator.listProfiles", async () => {
      const actions = createActions(coordinator, createMockStore());
      const result = await actions.listProfiles();

      expect(state.listProfiles.calls).toBe(1);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]?.id).toBe("prof-123");
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Failed to list profiles");
      coordinator.listProfiles = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.listProfiles();
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.listProfiles();

      expect(state.send.calls).toBe(0);
      expect(state.cancel.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });
  });

  describe("createConversation", () => {
    it("delegates to coordinator.createConversation with exact arguments", async () => {
      const actions = createActions(coordinator, createMockStore());
      const input = { profileId: "prof-456", title: "New Chat" };

      const result = await actions.createConversation(input);

      expect(state.createConversation.calls).toBe(1);
      expect(state.createConversation.lastArgs).toEqual([input]);
      expect(result.profileId).toBe("prof-456");
    });

    it("handles optional title parameter", async () => {
      const actions = createActions(coordinator, createMockStore());
      const input = { profileId: "prof-456" };

      const result = await actions.createConversation(input);

      expect(state.createConversation.calls).toBe(1);
      expect(state.createConversation.lastArgs).toEqual([input]);
    });

    it("propagates coordinator rejection", async () => {
      const testError = new Error("Failed to create conversation");
      coordinator.createConversation = async () => {
        throw testError;
      };

      const actions = createActions(coordinator, createMockStore());

      try {
        await actions.createConversation({ profileId: "prof-456" });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBe(testError);
      }
    });

    it("leaves other coordinator methods uncalled", async () => {
      const actions = createActions(coordinator, createMockStore());
      await actions.createConversation({ profileId: "prof-456" });

      expect(state.send.calls).toBe(0);
      expect(state.cancel.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });
  });

  describe("deleteConversation", () => {
    it("delegates to store.deleteConversation", () => {
      const deleteCalls: string[] = [];
      const store: ConversationStore = {
        loadConversations: () => [],
        getConversation: () => null,
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
        deleteConversation: (id) => {
          deleteCalls.push(id);
        },
      };

      const actions = createActions(coordinator, store);
      actions.deleteConversation("conv-123");

      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0]).toBe("conv-123");
    });

    it("leaves other coordinator methods uncalled", () => {
      const deleteCalls: string[] = [];
      const store: ConversationStore = {
        loadConversations: () => [],
        getConversation: () => null,
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
        deleteConversation: (id) => {
          deleteCalls.push(id);
        },
      };

      const actions = createActions(coordinator, store);
      actions.deleteConversation("conv-123");

      expect(state.send.calls).toBe(0);
      expect(state.cancel.calls).toBe(0);
      expect(state.createConversation.calls).toBe(0);
      expect(state.resumeIfInterrupted.calls).toBe(0);
      expect(state.listProfiles.calls).toBe(0);
      expect(state.setProfile.calls).toBe(0);
    });
  });

  describe("no bypass imports", () => {
    it("should not import from api-client, conversation-store, credential-store, storage-port, or sse-reader", () => {
      const actionsTsPath = join(import.meta.dir, "../../../web/src/ui/actions.ts");
      const content = readFileSync(actionsTsPath, "utf-8");

      // Check for runtime imports (plain import, not import type)
      const bypassModules = [
        "./api-client",
        "../api-client",
        "./conversation-store",
        "../conversation-store",
        "./credential-store",
        "../credential-store",
        "./storage-port",
        "../storage-port",
        "./sse-reader",
        "../sse-reader",
      ];

      for (const module of bypassModules) {
        // Match import statements that are not "import type"
        const pattern = new RegExp(
          `^(?!\\s*import\\s+type\\b)\\s*import\\s+.*from\\s+["']${module.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          )}["']`,
          "m"
        );

        if (pattern.test(content)) {
          throw new Error(
            `Found bypass import from "${module}" in actions.ts`
          );
        }
      }
    });

    it("should not contain fetch(", () => {
      const actionsTsPath = join(import.meta.dir, "../../../web/src/ui/actions.ts");
      const content = readFileSync(actionsTsPath, "utf-8");

      if (content.includes("fetch(")) {
        throw new Error("Found fetch( in actions.ts");
      }
    });

    it("should not contain localStorage", () => {
      const actionsTsPath = join(import.meta.dir, "../../../web/src/ui/actions.ts");
      const content = readFileSync(actionsTsPath, "utf-8");

      if (content.includes("localStorage")) {
        throw new Error("Found localStorage in actions.ts");
      }
    });

    it("should not contain document", () => {
      const actionsTsPath = join(import.meta.dir, "../../../web/src/ui/actions.ts");
      const content = readFileSync(actionsTsPath, "utf-8");

      if (content.includes("document")) {
        throw new Error("Found document in actions.ts");
      }
    });
  });
});
