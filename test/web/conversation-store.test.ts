import { describe, it, expect, beforeEach } from "bun:test";
import {
  createConversationStore,
  type Conversation,
  type Turn,
  type PendingGeneration,
  CONVERSATIONS_STORAGE_KEY,
  CONVERSATIONS_SCHEMA_VERSION,
  UnknownStorageVersionError,
} from "../../web/src/conversation-store";
import { createMemoryStorage } from "../../web/src/storage-port";

describe("ConversationStore", () => {
  describe("types", () => {
    it("exports Turn type", () => {
      // This test just verifies the type is exported and can be used
      const turn: Turn = {
        role: "user",
        content: "Hello",
        cancelled: false,
        createdAt: "2026-08-28T00:00:00Z",
      };
      expect(turn.role).toBe("user");
    });

    it("exports PendingGeneration type", () => {
      const pending: PendingGeneration = {
        generationId: "gen-123",
        lastSeq: 5,
        status: "in-progress",
        partialText: "",
      };
      expect(pending.generationId).toBe("gen-123");
    });

    it("exports Conversation type", () => {
      const conversation: Conversation = {
        id: "conv-123",
        title: "Test",
        sessionId: null,
        profileId: "prof-123",
        turns: [],
        pending: null,
        createdAt: "2026-08-28T00:00:00Z",
        updatedAt: "2026-08-28T00:00:00Z",
      };
      expect(conversation.id).toBe("conv-123");
    });

    it("exports CONVERSATIONS_STORAGE_KEY with correct value", () => {
      expect(CONVERSATIONS_STORAGE_KEY).toBe("phone-to-local-model:v1:conversations");
    });

    it("exports CONVERSATIONS_SCHEMA_VERSION with correct value", () => {
      expect(CONVERSATIONS_SCHEMA_VERSION).toBe(1);
    });
  });

  describe("createConversationStore", () => {
    let store: ReturnType<typeof createConversationStore>;

    beforeEach(() => {
      const storage = createMemoryStorage();
      store = createConversationStore(storage);
    });

    describe("loadConversations", () => {
      it("returns empty array when nothing is stored", () => {
        const conversations = store.loadConversations();
        expect(conversations).toEqual([]);
      });

      it("throws UnknownStorageVersionError when stored value is corrupt (not JSON)", () => {
        const storage = createMemoryStorage();
        storage.set(CONVERSATIONS_STORAGE_KEY, "not-json{");
        const store2 = createConversationStore(storage);
        expect(() => store2.loadConversations()).toThrow(UnknownStorageVersionError);
      });

      it("throws UnknownStorageVersionError when stored value is not a recognised envelope", () => {
        const storage = createMemoryStorage();
        storage.set(CONVERSATIONS_STORAGE_KEY, '{"invalid": true}');
        const store2 = createConversationStore(storage);
        expect(() => store2.loadConversations()).toThrow(UnknownStorageVersionError);
      });

      it("throws UnknownStorageVersionError when stored value is a bare array (pre-envelope format)", () => {
        const storage = createMemoryStorage();
        storage.set(CONVERSATIONS_STORAGE_KEY, "[]");
        const store2 = createConversationStore(storage);
        expect(() => store2.loadConversations()).toThrow(UnknownStorageVersionError);
      });

      it("throws UnknownStorageVersionError carrying found and expected version when the envelope version is unrecognised", () => {
        const storage = createMemoryStorage();
        storage.set(
          CONVERSATIONS_STORAGE_KEY,
          JSON.stringify({ version: 99, conversations: [] })
        );
        const store2 = createConversationStore(storage);

        let caught: unknown;
        try {
          store2.loadConversations();
          expect.unreachable();
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(UnknownStorageVersionError);
        const error = caught as UnknownStorageVersionError;
        expect(error.foundVersion).toBe(99);
        expect(error.expectedVersion).toBe(CONVERSATIONS_SCHEMA_VERSION);
      });

      it("does not overwrite the stored payload when the version is unrecognised", () => {
        const storage = createMemoryStorage();
        const rawPayload = JSON.stringify({ version: 99, conversations: [] });
        storage.set(CONVERSATIONS_STORAGE_KEY, rawPayload);
        const store2 = createConversationStore(storage);

        expect(() => store2.loadConversations()).toThrow(UnknownStorageVersionError);
        // A subsequent read call must not have triggered a rewrite of the payload.
        expect(() => store2.getConversation("some-id")).toThrow(UnknownStorageVersionError);

        expect(storage.get(CONVERSATIONS_STORAGE_KEY)).toBe(rawPayload);
      });

      it("does not overwrite the stored payload when it is structurally invalid", () => {
        const storage = createMemoryStorage();
        const rawPayload = "not-json{";
        storage.set(CONVERSATIONS_STORAGE_KEY, rawPayload);
        const store2 = createConversationStore(storage);

        expect(() => store2.loadConversations()).toThrow(UnknownStorageVersionError);

        expect(storage.get(CONVERSATIONS_STORAGE_KEY)).toBe(rawPayload);
      });

      it("returns conversations ordered by updatedAt descending", () => {
        const conv1 = store.createConversation({
          profileId: "prof-1",
          title: "First",
        });

        // Ensure distinct timestamps
        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < 5) {
          // Wait 5ms
        }

        const conv2 = store.createConversation({
          profileId: "prof-1",
          title: "Second",
        });

        const startTime2 = new Date().getTime();
        while (new Date().getTime() - startTime2 < 5) {
          // Wait 5ms
        }

        const conv3 = store.createConversation({
          profileId: "prof-1",
          title: "Third",
        });

        // Save conv1 to bump its updatedAt to now (after conv3)
        const updated = store.getConversation(conv1.id);
        expect(updated).not.toBe(null);
        if (updated) {
          store.saveConversation(updated);
        }

        const conversations = store.loadConversations();
        expect(conversations.length).toBe(3);
        // Should be ordered: updated conv1 (latest), conv3, conv2 (oldest)
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[0].id).toBe(conv1.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[1].id).toBe(conv3.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[2].id).toBe(conv2.id);
      });
    });

    describe("getConversation", () => {
      it("returns null for unknown id", () => {
        const conversation = store.getConversation("unknown-id");
        expect(conversation).toBe(null);
      });

      it("returns conversation by id", () => {
        const created = store.createConversation({
          profileId: "prof-1",
          title: "Test",
        });
        const retrieved = store.getConversation(created.id);
        expect(retrieved).not.toBe(null);
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.title).toBe("Test");
      });
    });

    describe("createConversation", () => {
      it("creates conversation with defaults", () => {
        const conversation = store.createConversation({
          profileId: "prof-123",
        });

        expect(conversation.id).toBeTruthy();
        expect(conversation.profileId).toBe("prof-123");
        expect(conversation.title).toBe("");
        expect(conversation.sessionId).toBe(null);
        expect(conversation.turns).toEqual([]);
        expect(conversation.pending).toBe(null);
        expect(conversation.createdAt).toBeTruthy();
        expect(conversation.updatedAt).toBe(conversation.createdAt);
      });

      it("creates conversation with title", () => {
        const conversation = store.createConversation({
          profileId: "prof-123",
          title: "My Conversation",
        });

        expect(conversation.title).toBe("My Conversation");
      });

      it("generates UUID for id", () => {
        const conv1 = store.createConversation({ profileId: "prof-1" });
        const conv2 = store.createConversation({ profileId: "prof-1" });

        expect(conv1.id).not.toBe(conv2.id);
        // UUID format check (rough)
        expect(conv1.id).toMatch(/^[0-9a-f-]+$/i);
      });

      it("uses ISO-8601 UTC format for timestamps", () => {
        const conversation = store.createConversation({
          profileId: "prof-123",
        });

        // ISO-8601 UTC format check
        expect(conversation.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(conversation.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("persists the conversation", () => {
        const conversation = store.createConversation({
          profileId: "prof-123",
          title: "Test",
        });

        const loaded = store.getConversation(conversation.id);
        expect(loaded).not.toBe(null);
        expect(loaded?.title).toBe("Test");
      });
    });

    describe("saveConversation", () => {
      it("updates existing conversation", () => {
        const created = store.createConversation({
          profileId: "prof-1",
          title: "Original",
        });

        const updated = {
          ...created,
          title: "Updated",
        };
        store.saveConversation(updated);

        const retrieved = store.getConversation(created.id);
        expect(retrieved?.title).toBe("Updated");
      });

      it("bumps updatedAt to now", () => {
        const created = store.createConversation({
          profileId: "prof-1",
        });
        const originalUpdatedAt = created.updatedAt;

        // Wait a bit to ensure time passes
        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < 10) {
          // Busy wait for at least 10ms
        }

        const updated = { ...created, title: "Changed" };
        store.saveConversation(updated);

        const retrieved = store.getConversation(created.id);
        expect(retrieved?.updatedAt).not.toBe(originalUpdatedAt);
      });

      it("throws for unknown conversation id", () => {
        const conversation: Conversation = {
          id: "unknown-id",
          title: "Test",
          sessionId: null,
          profileId: "prof-1",
          turns: [],
          pending: null,
          createdAt: "2026-08-28T00:00:00Z",
          updatedAt: "2026-08-28T00:00:00Z",
        };

        expect(() => {
          store.saveConversation(conversation);
        }).toThrow();
      });

      it("throws error with conversation id in message", () => {
        const conversation: Conversation = {
          id: "unknown-id-123",
          title: "Test",
          sessionId: null,
          profileId: "prof-1",
          turns: [],
          pending: null,
          createdAt: "2026-08-28T00:00:00Z",
          updatedAt: "2026-08-28T00:00:00Z",
        };

        try {
          store.saveConversation(conversation);
          expect.unreachable();
        } catch (error) {
          expect((error as Error).message).toContain("unknown-id-123");
        }
      });
    });

    describe("appendTurn", () => {
      it("appends turn to conversation", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        const updated = store.appendTurn(conversation.id, turn);

        expect(updated.turns.length).toBe(1);
        expect(updated.turns[0]).toEqual(turn);
      });

      it("bumps updatedAt when appending turn", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });
        const originalUpdatedAt = conversation.updatedAt;

        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < 10) {
          // Busy wait
        }

        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        const updated = store.appendTurn(conversation.id, turn);
        expect(updated.updatedAt).not.toBe(originalUpdatedAt);
      });

      it("persists the turn", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        store.appendTurn(conversation.id, turn);

        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.turns.length).toBe(1);
        expect(retrieved?.turns?.[0]?.content).toBe("Hello");
      });

      it("throws for unknown conversation id", () => {
        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        expect(() => {
          store.appendTurn("unknown-id", turn);
        }).toThrow();
      });
    });

    describe("setSessionId", () => {
      it("sets session id", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const updated = store.setSessionId(conversation.id, "sess-123");

        expect(updated.sessionId).toBe("sess-123");
      });

      it("persists session id", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        store.setSessionId(conversation.id, "sess-123");

        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.sessionId).toBe("sess-123");
      });

      it("throws for unknown conversation id", () => {
        expect(() => {
          store.setSessionId("unknown-id", "sess-123");
        }).toThrow();
      });
    });

    describe("setProfileId", () => {
      it("sets profile id", () => {
        const conversation = store.createConversation({
          profileId: "profile-a",
        });

        const updated = store.setProfileId(conversation.id, "profile-b");

        expect(updated.profileId).toBe("profile-b");
      });

      it("persists profile id", () => {
        const conversation = store.createConversation({
          profileId: "profile-a",
        });

        store.setProfileId(conversation.id, "profile-b");

        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.profileId).toBe("profile-b");
      });

      it("bumps updatedAt when setting profile id", () => {
        const conversation = store.createConversation({
          profileId: "profile-a",
        });
        const originalUpdatedAt = conversation.updatedAt;

        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < 10) {
          // Busy wait
        }

        const updated = store.setProfileId(conversation.id, "profile-b");
        expect(updated.updatedAt).not.toBe(originalUpdatedAt);
      });

      it("throws for unknown conversation id", () => {
        expect(() => {
          store.setProfileId("unknown-id", "profile-b");
        }).toThrow();
      });

      it("does not alias returned conversation with internal state", () => {
        const conversation = store.createConversation({
          profileId: "profile-a",
        });

        const updated = store.setProfileId(conversation.id, "profile-b");

        // Mutate the returned object
        updated.profileId = "profile-c";

        // The persisted one should not change
        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.profileId).toBe("profile-b");
      });

      it("survives reload from storage", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "profile-a",
          title: "Test",
        });

        store1.setProfileId(conversation.id, "profile-b");

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);

        expect(retrieved?.profileId).toBe("profile-b");
      });
    });

    describe("recordProgress", () => {
      it("sets pending generation", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "",
        };

        const updated = store.recordProgress(conversation.id, pending);

        expect(updated.pending).toEqual(pending);
      });

      it("clears pending when passed null", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "",
        };

        store.recordProgress(conversation.id, pending);
        const updated = store.recordProgress(conversation.id, null);

        expect(updated.pending).toBe(null);
      });

      it("persists pending generation", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "",
        };

        store.recordProgress(conversation.id, pending);

        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.pending).toEqual(pending);
      });

      it("throws for unknown conversation id", () => {
        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "",
        };

        expect(() => {
          store.recordProgress("unknown-id", pending);
        }).toThrow();
      });

      it("persists partialText across store instances", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
        });

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "Hello, this is a partial response",
        };

        store1.recordProgress(conversation.id, pending);

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);

        expect(retrieved?.pending?.partialText).toBe("Hello, this is a partial response");
      });

      it("loads conversations with missing partialText field as empty string", () => {
        const storage = createMemoryStorage();

        // Manually seed raw JSON without partialText field (backward compatibility)
        const rawConversations = [
          {
            id: "conv-123",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: {
              generationId: "gen-456",
              lastSeq: 3,
              status: "in-progress",
            },
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];
        storage.set(
          CONVERSATIONS_STORAGE_KEY,
          JSON.stringify({
            version: CONVERSATIONS_SCHEMA_VERSION,
            conversations: rawConversations,
          })
        );

        const store = createConversationStore(storage);
        const retrieved = store.getConversation("conv-123");

        expect(retrieved?.pending?.partialText).toBe("");
      });
    });

    describe("persistence", () => {
      it("writes the persisted value as a versioned envelope", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        store1.createConversation({ profileId: "prof-1", title: "Test" });

        const raw = storage.get(CONVERSATIONS_STORAGE_KEY);
        expect(raw).not.toBe(null);
        const parsed = JSON.parse(raw as string);
        expect(parsed.version).toBe(CONVERSATIONS_SCHEMA_VERSION);
        expect(Array.isArray(parsed.conversations)).toBe(true);
        expect(parsed.conversations.length).toBe(1);
      });

      it("reloads conversations from storage", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
          title: "Test",
        });

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const conversations = store2.loadConversations();

        expect(conversations.length).toBe(1);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[0].id).toBe(conversation.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[0].title).toBe("Test");
      });

      it("multiple mutations are persisted across store instances", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
        });

        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        store1.appendTurn(conversation.id, turn);
        store1.setSessionId(conversation.id, "sess-123");

        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);

        expect(retrieved?.turns.length).toBe(1);
        expect(retrieved?.sessionId).toBe("sess-123");
      });
    });

    describe("immutability", () => {
      it("does not alias returned conversation with internal state", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
          title: "Original",
        });

        // Mutate the returned object
        conversation.title = "Mutated";

        // The persisted one should not change
        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.title).toBe("Original");
      });

      it("does not alias turns array", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const turn: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T00:00:00Z",
        };

        const updated = store.appendTurn(conversation.id, turn);

        // Mutate the returned turns array
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array is known to exist
        updated.turns[0].content = "Modified";

        // The persisted one should not change
        const retrieved = store.getConversation(conversation.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array access is known to exist
        expect(retrieved?.turns[0].content).toBe("Hello");
      });

      it("does not alias pending generation object", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
        });

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "",
        };

        const updated = store.recordProgress(conversation.id, pending);

        // Mutate the returned pending object
        if (updated.pending) {
          updated.pending.status = "complete";
        }

        // The persisted one should not change
        const retrieved = store.getConversation(conversation.id);
        expect(retrieved?.pending?.status).toBe("in-progress");
      });
    });

    describe("deleteConversation", () => {
      it("deletes a conversation by id", () => {
        const conversation = store.createConversation({
          profileId: "prof-1",
          title: "To Delete",
        });

        store.deleteConversation(conversation.id);

        const retrieved = store.getConversation(conversation.id);
        expect(retrieved).toBe(null);
      });

      it("throws when deleting a non-existent conversation", () => {
        expect(() => {
          store.deleteConversation("non-existent-id");
        }).toThrow();
      });

      it("throws error with conversation id in message", () => {
        try {
          store.deleteConversation("non-existent-id-123");
          expect.unreachable();
        } catch (error) {
          expect((error as Error).message).toContain("non-existent-id-123");
        }
      });

      it("persists deletion immediately", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
          title: "To Delete",
        });

        store1.deleteConversation(conversation.id);

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);
        expect(retrieved).toBe(null);
      });

      it("deleted conversation is absent from loadConversations after rebuild", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
          title: "To Delete",
        });

        store1.deleteConversation(conversation.id);

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const conversations = store2.loadConversations();
        expect(conversations).toEqual([]);
      });

      it("full transcript recovery with special turns survives rebuild", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
          title: "Transcript Test",
        });

        // Add several turns with special content
        const turn1: Turn = {
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T10:00:00Z",
        };

        const turn2: Turn = {
          role: "assistant",
          content: "Multi-line response:\nLine 1\nLine 2",
          cancelled: false,
          createdAt: "2026-08-28T10:01:00Z",
        };

        const turn3: Turn = {
          role: "user",
          content: "Unicode test: 你好 مرحبا 🚀",
          cancelled: true,
          createdAt: "2026-08-28T10:02:00Z",
        };

        store1.appendTurn(conversation.id, turn1);
        store1.appendTurn(conversation.id, turn2);
        store1.appendTurn(conversation.id, turn3);

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);

        expect(retrieved).not.toBe(null);
        expect(retrieved?.turns.length).toBe(3);
        expect(retrieved?.turns[0]).toEqual(turn1);
        expect(retrieved?.turns[1]).toEqual(turn2);
        expect(retrieved?.turns[2]).toEqual(turn3);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array access is verified
        expect(retrieved?.turns[2].cancelled).toBe(true);
      });

      it("newest-first ordering survives rebuild with distinct timestamps", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        // Create three conversations with intentionally OUT OF ORDER timestamps
        const conv1 = store1.createConversation({
          profileId: "prof-1",
          title: "First",
        });

        // Wait to ensure distinct timestamps
        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < 5) {
          // Wait 5ms
        }

        const conv2 = store1.createConversation({
          profileId: "prof-1",
          title: "Second",
        });

        const startTime2 = new Date().getTime();
        while (new Date().getTime() - startTime2 < 5) {
          // Wait 5ms
        }

        const conv3 = store1.createConversation({
          profileId: "prof-1",
          title: "Third",
        });

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const conversations = store2.loadConversations();

        expect(conversations.length).toBe(3);
        // Should be ordered newest-first by updatedAt
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[0].id).toBe(conv3.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[1].id).toBe(conv2.id);
        // @ts-expect-error noUncheckedIndexedAccess requires narrowing, but test array length is verified
        expect(conversations[2].id).toBe(conv1.id);
      });

      it("session id, profile id, title, createdAt and pending survive rebuild", () => {
        const storage = createMemoryStorage();
        const store1 = createConversationStore(storage);

        const conversation = store1.createConversation({
          profileId: "prof-1",
          title: "Full Metadata Test",
        });

        // Set various metadata
        const originalCreatedAt = conversation.createdAt;
        store1.setSessionId(conversation.id, "sess-123");
        store1.setProfileId(conversation.id, "prof-2");

        const pending: PendingGeneration = {
          generationId: "gen-123",
          lastSeq: 5,
          status: "in-progress",
          partialText: "partial text content",
        };
        store1.recordProgress(conversation.id, pending);

        // Create a new store over the same storage
        const store2 = createConversationStore(storage);
        const retrieved = store2.getConversation(conversation.id);

        expect(retrieved).not.toBe(null);
        expect(retrieved?.sessionId).toBe("sess-123");
        expect(retrieved?.profileId).toBe("prof-2");
        expect(retrieved?.title).toBe("Full Metadata Test");
        expect(retrieved?.createdAt).toBe(originalCreatedAt);
        expect(retrieved?.pending).toEqual(pending);
      });
    });
  });
});
