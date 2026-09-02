import { describe, it, expect, beforeEach } from "bun:test";
import {
  createSessionCoordinator,
  type GenerationHandlers,
  type SessionCoordinator,
} from "../../web/src/session-coordinator";
import { createConversationStore } from "../../web/src/conversation-store";
import { createMemoryStorage } from "../../web/src/storage-port";
import type { ApiClient, SessionSnapshot } from "../../web/src/api-client";
import {
  HarnessApiError,
  HarnessStreamError,
  HarnessOfflineError,
  EmptyPromptError,
} from "../../web/src/api-client";
import type { HarnessEvent, Telemetry } from "../../web/src/sse-reader";

describe("SessionCoordinator", () => {
  describe("types", () => {
    it("exports GenerationHandlers type", () => {
      const handlers: GenerationHandlers = {
        onQueued: (position: number) => {},
        onModelLoading: () => {},
        onDelta: (delta: string) => {},
        onComplete: (telemetry: Telemetry) => {},
        onError: (code: string) => {},
        onCancelled: () => {},
      };
      expect(handlers).toBeDefined();
    });
  });

  describe("createSessionCoordinator", () => {
    let coordinator: SessionCoordinator;
    let conversationStore: ReturnType<typeof createConversationStore>;
    let fakeApiClient: ApiClient;

    beforeEach(() => {
      conversationStore = createConversationStore(createMemoryStorage());

      // Create a fake API client
      fakeApiClient = {
        listProfiles: async () => [],
        createSession: async () => "session-123",
        getSession: async (): Promise<SessionSnapshot> => ({
          session_id: "session-123",
          created_at: "2026-08-28T00:00:00Z",
          turns: [],
          generations: [],
        }),
        generate: async (sessionId, options) => {
          // Return a controlled async generator
          return {
            generationId: "gen-456",
            events: generateTestEvents(),
          };
        },
        resumeEvents: async (sessionId, generationId) => {
          // Default stub: most tests never call this. Tests that exercise
          // resumeIfInterrupted override it explicitly.
          return {
            generationId,
            events: generateTestEvents(),
          };
        },
        cancel: async () => ({ status: "cancelled" }),
        appendTurn: async () => ({
          index: 0,
          role: "user",
          content: "test",
          created_at: "2026-08-28T00:00:00Z",
          cancelled: false,
        }),
        getRequestLog: () => [],
        clearRequestLog: () => {},
      };

      coordinator = createSessionCoordinator({
        apiClient: fakeApiClient,
        conversationStore,
      });
    });

    it("exports createSessionCoordinator function", () => {
      expect(coordinator).toBeDefined();
      expect(coordinator.send).toBeDefined();
    });

    describe("createConversation", () => {
      it("creates the conversation in the store and provisions its session id", async () => {
        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return "session-provisioned";
        };

        const conversation = await coordinator.createConversation({
          profileId: "prof-123",
          title: "Test Conversation",
        });

        expect(createSessionCalls).toBe(1);
        expect(conversation.sessionId).toBe("session-provisioned");
        expect(conversation.profileId).toBe("prof-123");
        expect(conversation.title).toBe("Test Conversation");

        // The store itself must hold the same session id afterwards.
        const stored = conversationStore.getConversation(conversation.id);
        expect(stored?.sessionId).toBe("session-provisioned");
      });

      it("calls apiClient.createSession exactly once per conversation creation", async () => {
        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return `session-${createSessionCalls}`;
        };

        await coordinator.createConversation({ profileId: "prof-123" });

        expect(createSessionCalls).toBe(1);
      });

      it("does not create another session when send() is subsequently called", async () => {
        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return "session-once";
        };

        const conversation = await coordinator.createConversation({
          profileId: "prof-123",
        });
        expect(createSessionCalls).toBe(1);

        await coordinator.send(conversation.id, "Hello");

        expect(createSessionCalls).toBe(1);
      });

      it("creates a sessionless conversation when createSession rejects, then provisions it lazily on send(), resulting in exactly one successful call overall", async () => {
        let createSessionCalls = 0;
        let createSessionAttempts = 0;
        const sessionCreationRejectionError = new Error("Session creation failed");

        fakeApiClient.createSession = async () => {
          createSessionAttempts++;
          if (createSessionAttempts === 1) {
            throw sessionCreationRejectionError;
          }
          // Subsequent calls succeed
          createSessionCalls++;
          return `session-provisioned-on-retry-${createSessionCalls}`;
        };

        // Step 1: createConversation rejects, but conversation is still persisted with sessionId: null
        let createConversationError: unknown;
        let conversationIdFromError: string | null = null;
        try {
          await coordinator.createConversation({ profileId: "prof-123" });
          expect.unreachable("createConversation should have rejected");
        } catch (e) {
          createConversationError = e;
        }

        expect(createConversationError).toBe(sessionCreationRejectionError);

        // Step 2: Verify the conversation exists in the store with sessionId: null
        // We need to get the conversation id somehow. Since createConversation failed,
        // we can get it from loadConversations
        const conversations = conversationStore.loadConversations();
        expect(conversations).toHaveLength(1);

        const sessionlessConversation = conversations[0];
        expect(sessionlessConversation).toBeDefined();
        expect(sessionlessConversation?.sessionId).toBeNull();
        expect(sessionlessConversation?.profileId).toBe("prof-123");

        // Step 3: Verify we can retrieve it via getConversation too
        const retrieved = conversationStore.getConversation(sessionlessConversation!.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.sessionId).toBeNull();

        // Step 4: Call send() on that conversation - it should succeed by provisioning the session
        const result = await coordinator.send(
          sessionlessConversation!.id,
          "Hello world"
        );
        expect(result).toBeDefined();
        expect(result.status).toBe("complete");

        // Step 5: Verify that we have exactly 1 successful createSession() call overall
        // (the one during send() - the first one during createConversation failed)
        expect(createSessionCalls).toBe(1);
        expect(createSessionAttempts).toBe(2); // First failed, second succeeded

        // Step 6: Verify the conversation now has a sessionId
        const updatedConversation = conversationStore.getConversation(
          sessionlessConversation!.id
        );
        expect(updatedConversation?.sessionId).toBe("session-provisioned-on-retry-1");
      });
    });

    it("sends a prompt and receives a result", async () => {
      // Create a conversation first
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
        title: "Test Conversation",
      });

      const result = await coordinator.send(conv.id, "Hello");

      expect(result).toBeDefined();
      expect(result.generationId).toBe("gen-456");
      expect(result.text).toContain("Hello");
      expect(result.status).toBe("complete");
    });

    it("throws for empty prompt", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("throws for whitespace-only prompt", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "   ");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("throws for unknown conversation", async () => {
      try {
        await coordinator.send("unknown-id", "Hello");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it("creates a session if conversation has none", async () => {
      let createSessionCalled = false;
      fakeApiClient.createSession = async () => {
        createSessionCalled = true;
        return "session-789";
      };

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      expect(conv.sessionId).toBeNull();

      await coordinator.send(conv.id, "Hello");

      expect(createSessionCalled).toBe(true);
      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.sessionId).toBe("session-789");
    });

    it("reuses existing sessionId", async () => {
      let createSessionCalled = false;
      fakeApiClient.createSession = async () => {
        createSessionCalled = true;
        return "session-new";
      };

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });
      conversationStore.setSessionId(conv.id, "session-existing");

      await coordinator.send(conv.id, "Hello");

      expect(createSessionCalled).toBe(false);
    });

    it("calls handlers as events arrive", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const calls: string[] = [];
      const handlers: GenerationHandlers = {
        onQueued: (position: number) => {
          calls.push(`queued:${position}`);
        },
        onModelLoading: () => {
          calls.push("modelLoading");
        },
        onDelta: (delta: string) => {
          calls.push(`delta:${delta}`);
        },
        onComplete: (telemetry: Telemetry) => {
          calls.push("complete");
        },
      };

      await coordinator.send(conv.id, "Hello", handlers);

      expect(calls.length).toBeGreaterThan(0);
      expect(calls).toContain("queued:1");
      expect(calls).toContain("modelLoading");
      expect(calls.some((c) => c.startsWith("delta:"))).toBe(true);
      expect(calls).toContain("complete");
    });

    it("records progress before and clears after generation", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      let progressRecorded = false;
      const originalRecordProgress = conversationStore.recordProgress;
      conversationStore.recordProgress = (conversationId, pending) => {
        if (pending && pending.status === "in_flight") {
          progressRecorded = true;
        }
        return originalRecordProgress.call(conversationStore, conversationId, pending);
      };

      await coordinator.send(conv.id, "Hello");

      expect(progressRecorded).toBe(true);

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.pending).toBeNull();
    });

    it("appends user turn and assistant turn on complete", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const prompt = "Test prompt";
      await coordinator.send(conv.id, prompt);

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.turns.length).toBe(2);

      const userTurn = updated?.turns[0];
      expect(userTurn?.role).toBe("user");
      expect(userTurn?.content).toBe(prompt);
      expect(userTurn?.cancelled).toBe(false);

      const assistantTurn = updated?.turns[1];
      expect(assistantTurn?.role).toBe("assistant");
      expect(assistantTurn?.cancelled).toBe(false);
    });

    it("appends only user turn on error", async () => {
      fakeApiClient.generate = async () => ({
        generationId: "gen-error",
        events: generateErrorEvents(),
      });

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const prompt = "Test prompt";
      const result = await coordinator.send(conv.id, prompt);

      expect(result.status).toBe("error");
      expect(result.errorCode).toBeDefined();

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.turns.length).toBe(1);
      expect(updated?.turns[0]?.role).toBe("user");
    });

    it("appends user turn and assistant turn with cancelled=true on cancelled", async () => {
      fakeApiClient.generate = async () => ({
        generationId: "gen-cancelled",
        events: generateCancelledEvents(),
      });

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const prompt = "Test prompt";
      const result = await coordinator.send(conv.id, prompt);

      expect(result.status).toBe("cancelled");
      expect(result.text).toBe("I can provide you");

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.turns.length).toBe(2);

      const userTurn = updated?.turns[0];
      expect(userTurn?.role).toBe("user");
      expect(userTurn?.content).toBe(prompt);
      expect(userTurn?.cancelled).toBe(false);

      const assistantTurn = updated?.turns[1];
      expect(assistantTurn?.role).toBe("assistant");
      expect(assistantTurn?.content).toBe("I can provide you");
      expect(assistantTurn?.cancelled).toBe(true);
    });

    it("appends assistant turn with cancelled=true even with empty content", async () => {
      fakeApiClient.generate = async () => ({
        generationId: "gen-cancelled-empty",
        events: generateCancelledEmptyEvents(),
      });

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const prompt = "Test prompt";
      const result = await coordinator.send(conv.id, prompt);

      expect(result.status).toBe("cancelled");
      expect(result.text).toBe("");

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.turns.length).toBe(2);

      const userTurn = updated?.turns[0];
      expect(userTurn?.role).toBe("user");
      expect(userTurn?.cancelled).toBe(false);

      const assistantTurn = updated?.turns[1];
      expect(assistantTurn?.role).toBe("assistant");
      expect(assistantTurn?.content).toBe("");
      expect(assistantTurn?.cancelled).toBe(true);
    });

    it("proves incrementality: onDelta fires while stream is open", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      let deltaFiredCount = 0;
      let deltaFiredBeforeSecond = false;

      // Create a promise that only resolves when the handler is called
      // This ensures the stream cannot continue without the handler being invoked
      let resolveStreamControl: (() => void) | null = null;
      const streamControlPromise = new Promise<void>((resolve) => {
        resolveStreamControl = resolve;
      });

      const handlers: GenerationHandlers = {
        onDelta: (delta: string) => {
          deltaFiredCount++;
          if (deltaFiredCount === 1) {
            // First delta was called - mark that we got here before second delta
            deltaFiredBeforeSecond = true;
            // NOW resolve the promise to let the stream continue
            resolveStreamControl?.();
          }
        },
      };

      // Use the controlled stream that waits on our promise
      // The stream will yield first delta, then wait on the promise
      // The promise only resolves when onDelta is called
      // This PROVES that onDelta was called before the stream could continue
      fakeApiClient.generate = async () => ({
        generationId: "gen-incremental",
        events: generateIncrementalTestEvents(streamControlPromise),
      });

      const result = await coordinator.send(conv.id, "Test", handlers);

      // Verify that:
      // 1. onDelta was called (at least once)
      // 2. It was called before the complete event
      // 3. The stream was allowed to continue only after onDelta was called
      expect(deltaFiredCount).toBeGreaterThanOrEqual(1);
      expect(deltaFiredBeforeSecond).toBe(true);
      expect(result.text).toBeTruthy();
      expect(result.status).toBe("complete");
    });

    it("handles optional handlers", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      // Send with no handlers - should not throw
      const result = await coordinator.send(conv.id, "Hello");

      expect(result).toBeDefined();
      expect(result.status).toBe("complete");
    });

    it("clears pending on error even if handler throws", async () => {
      fakeApiClient.generate = async () => ({
        generationId: "gen-error",
        events: generateErrorEvents(),
      });

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const handlers: GenerationHandlers = {
        onError: () => {
          throw new Error("Handler error");
        },
      };

      try {
        await coordinator.send(conv.id, "Hello", handlers);
      } catch {
        // Expected to throw
      }

      const updated = conversationStore.getConversation(conv.id);
      // Pending should be cleared even though handler threw
      expect(updated?.pending).toBeNull();
    });

    it("rejects if stream ends without terminal event, and leaves pending set (transport failure, FR7)", async () => {
      // A stream ending without a terminal event is one of the transport
      // failure conditions FR7 covers: the generation must be resumable, so
      // pending must be left in place (not cleared) with the last seq and
      // partial text actually received.
      fakeApiClient.generate = async () => ({
        generationId: "gen-incomplete",
        events: generateIncompleteEvents(),
      });

      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "Hello");
        expect.unreachable("Should have rejected");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }

      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.pending).not.toBeNull();
      expect(updated?.pending?.generationId).toBe("gen-incomplete");
      expect(updated?.pending?.lastSeq).toBe(3);
      expect(updated?.pending?.partialText).toBe("Hello");
      expect(updated?.pending?.status).toBe("in_flight");
    });

    it("advances lastSeq with each event (captures all recordProgress calls)", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      // Capture ALL recordProgress calls in order
      const recordProgressCalls: Array<{
        conversationId: string;
        pending: { generationId: string; lastSeq: number; status: string } | null;
      }> = [];

      const originalRecordProgress = conversationStore.recordProgress;
      conversationStore.recordProgress = (conversationId, pending) => {
        recordProgressCalls.push({ conversationId, pending });
        return originalRecordProgress.call(conversationStore, conversationId, pending);
      };

      await coordinator.send(conv.id, "Hello");

      // Should have multiple recordProgress calls:
      // 1. Initial with lastSeq: -1, status: "in_flight"
      // 2. Updates for each event with advancing lastSeq
      // 3. Final call with null to clear
      expect(recordProgressCalls.length).toBeGreaterThan(2);

      // First call should be initial state with lastSeq: -1
      const firstCall = recordProgressCalls[0];
      expect(firstCall?.pending?.status).toBe("in_flight");
      expect(firstCall?.pending?.lastSeq).toBe(-1);
      expect(firstCall?.pending?.generationId).toBe("gen-456");

      // Last call should be null (clear pending)
      const lastCall = recordProgressCalls[recordProgressCalls.length - 1];
      expect(lastCall?.pending).toBeNull();

      // All middle calls should have advancing lastSeq values
      // Extract just the lastSeq values from middle calls (between first and last)
      const lastSeqValues: number[] = [];
      for (let i = 1; i < recordProgressCalls.length - 1; i++) {
        const pending = recordProgressCalls[i]?.pending;
        if (pending) {
          lastSeqValues.push(pending.lastSeq);
        }
      }

      // Verify that lastSeq values are strictly increasing
      if (lastSeqValues.length > 0) {
        const first = lastSeqValues[0];
        if (first !== undefined) {
          expect(first).toBeGreaterThan(-1);
        }
        for (let i = 0; i < lastSeqValues.length - 1; i++) {
          const curr = lastSeqValues[i];
          const next = lastSeqValues[i + 1];
          if (curr !== undefined && next !== undefined) {
            expect(next).toBeGreaterThan(curr);
          }
        }
      }

      // For the generateTestEvents() stream which has:
      // seq 1 (queued), 2 (model-loading), 3, 4, 5 (content), 6 (complete)
      // We expect lastSeq to advance through: -1 → 1 → 2 → 3 → 4 → 5 → 6
      // That means at least 6 calls before the final null
      expect(recordProgressCalls.length).toBeGreaterThanOrEqual(7);
    });

    it("propagates unknown_profile error from apiClient.generate and clears pending", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-placeholder",
      });

      const unknownProfileError = new HarnessApiError(
        "unknown_profile",
        400,
        { api_version: "v1", error: "unknown_profile" }
      );

      fakeApiClient.generate = async () => {
        throw unknownProfileError;
      };

      let caughtError: unknown;
      try {
        await coordinator.send(conv.id, "Hello");
      } catch (e) {
        caughtError = e;
      }

      // Assert that the SAME error object was thrown
      expect(caughtError).toBe(unknownProfileError);
      if (caughtError instanceof HarnessApiError) {
        expect(caughtError.code).toBe("unknown_profile");
        expect(caughtError.status).toBe(400);
      }

      // Assert the store's pending generation is not left set
      const updated = conversationStore.getConversation(conv.id);
      expect(updated?.pending).toBeNull();
    });

    it("reads conversation's profileId at send time, so profile changes take effect", async () => {
      const conv = conversationStore.createConversation({
        profileId: "profile-placeholder-1",
      });

      // Track what profileId values are passed to generate
      const generateCalls: Array<{
        sessionId: string;
        profileId: string;
        prompt: string;
      }> = [];

      fakeApiClient.generate = async (sessionId, options) => {
        generateCalls.push({
          sessionId,
          profileId: options.profileId,
          prompt: options.prompt,
        });
        return {
          generationId: "gen-456",
          events: generateTestEvents(),
        };
      };

      // First send with profile-placeholder-1
      await coordinator.send(conv.id, "First prompt");
      expect(generateCalls).toHaveLength(1);
      expect(generateCalls[0]?.profileId).toBe("profile-placeholder-1");

      // Change the conversation's profile
      conversationStore.setProfileId(conv.id, "profile-placeholder-2");

      // Send again - should use the NEW profile id
      await coordinator.send(conv.id, "Second prompt");
      expect(generateCalls).toHaveLength(2);
      expect(generateCalls[1]?.profileId).toBe("profile-placeholder-2");
    });

    describe("cancel", () => {
      it("throws for unknown conversation", async () => {
        try {
          await (coordinator as any).cancel("unknown-id");
          expect.unreachable("Should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).message).toBe("Conversation not found: unknown-id");
        }
      });

      it("throws when no generation in flight (pending is null)", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");

        try {
          await (coordinator as any).cancel(conv.id);
          expect.unreachable("Should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).message).toBe(
            `No generation in flight for conversation: ${conv.id}`
          );
        }
      });

      it("throws when sessionId is null", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });

        // Set pending without sessionId
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-123",
          lastSeq: 0,
          status: "in_flight",
          partialText: "",
        });

        try {
          await (coordinator as any).cancel(conv.id);
          expect.unreachable("Should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).message).toBe(
            `No generation in flight for conversation: ${conv.id}`
          );
        }
      });

      it("calls apiClient.cancel with correct parameters", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-456",
          lastSeq: 0,
          status: "in_flight",
          partialText: "",
        });

        let cancelCalled = false;
        let cancelArgs: [string, string] | null = null;
        fakeApiClient.cancel = async (sessionId, generationId) => {
          cancelCalled = true;
          cancelArgs = [sessionId, generationId];
          return { status: "cancelled" };
        };

        await (coordinator as any).cancel(conv.id);

        expect(cancelCalled).toBe(true);
        expect(cancelArgs!).toEqual(["session-123", "gen-456"]);
      });

      it("returns the status from apiClient.cancel unchanged", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-456",
          lastSeq: 0,
          status: "in_flight",
          partialText: "",
        });

        fakeApiClient.cancel = async () => ({
          status: "terminal_complete",
        });

        const result = await (coordinator as any).cancel(conv.id);

        expect(result).toEqual({ status: "terminal_complete" });
      });

      it("does not mutate the conversation store", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-456",
          lastSeq: 0,
          status: "in_flight",
          partialText: "",
        });

        let recordProgressCalled = false;
        const originalRecordProgress = conversationStore.recordProgress;
        conversationStore.recordProgress = (conversationId, pending) => {
          recordProgressCalled = true;
          return originalRecordProgress.call(conversationStore, conversationId, pending);
        };

        fakeApiClient.cancel = async () => ({ status: "cancelled" });

        await (coordinator as any).cancel(conv.id);

        // cancel should NOT call recordProgress
        expect(recordProgressCalled).toBe(false);

        // Verify pending is still set
        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).not.toBeNull();
      });

      it("propagates errors from apiClient.cancel", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-456",
          lastSeq: 0,
          status: "in_flight",
          partialText: "",
        });

        const cancelError = new HarnessApiError("cancel_failed", 500, {
          error: "cancel_failed",
        });

        fakeApiClient.cancel = async () => {
          throw cancelError;
        };

        try {
          await (coordinator as any).cancel(conv.id);
          expect.unreachable("Should have thrown");
        } catch (e) {
          expect(e).toBe(cancelError);
        }
      });
    });

    describe("send - progress persistence and transport failures (FR7)", () => {
      it("persists the concatenation of content deltas and the last seq, readable through a freshly constructed store, after a mid-stream transport failure", async () => {
        const storagePort = createMemoryStorage();
        const store = createConversationStore(storagePort);
        const localCoordinator = createSessionCoordinator({
          apiClient: fakeApiClient,
          conversationStore: store,
        });

        fakeApiClient.generate = async () => ({
          generationId: "gen-progress",
          events: generateMultiDeltaThenDropEvents(),
        });

        const conv = store.createConversation({ profileId: "prof-123" });

        let caught: unknown;
        try {
          await localCoordinator.send(conv.id, "Hello");
          expect.unreachable("Should have rejected");
        } catch (e) {
          caught = e;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe("simulated network drop");

        // A freshly constructed ConversationStore over the same StoragePort
        // must report the same persisted progress (criterion 2).
        const freshStore = createConversationStore(storagePort);
        const pending = freshStore.getConversation(conv.id)?.pending;

        expect(pending).not.toBeNull();
        expect(pending?.generationId).toBe("gen-progress");
        expect(pending?.status).toBe("in_flight");
        expect(pending?.lastSeq).toBe(3);
        expect(pending?.partialText).toBe("Hello World");
      });

      it("clears pending and rethrows the original error, unchanged, when a handler throws during a content event (not a transport failure)", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });

        const handlerError = new Error("boom from onDelta");
        const handlers: GenerationHandlers = {
          onDelta: () => {
            throw handlerError;
          },
        };

        let caught: unknown;
        try {
          await coordinator.send(conv.id, "Hello", handlers);
          expect.unreachable("Should have thrown");
        } catch (e) {
          caught = e;
        }

        // The original handler error propagates unchanged.
        expect(caught).toBe(handlerError);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
      });
    });

    describe("send - session-loss recovery (FR8)", () => {
      it("recovers from unknown_session: creates a session, replays stored turns in order, retries generate once, and reports sessionRebuilt/replayedTurns", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-old");
        conversationStore.appendTurn(conv.id, {
          role: "user",
          content: "Earlier question",
          cancelled: false,
          createdAt: "2026-08-29T00:00:00Z",
        });
        conversationStore.appendTurn(conv.id, {
          role: "assistant",
          content: "Earlier answer",
          cancelled: false,
          createdAt: "2026-08-29T00:00:01Z",
        });

        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return "session-new";
        };

        const appendTurnCalls: Array<{
          sessionId: string;
          role: string;
          content: string;
        }> = [];
        fakeApiClient.appendTurn = async (sessionId, turn) => {
          appendTurnCalls.push({
            sessionId,
            role: turn.role,
            content: turn.content,
          });
          return {
            index: appendTurnCalls.length - 1,
            role: turn.role,
            content: turn.content,
            created_at: "2026-08-29T00:00:02Z",
            cancelled: false,
          };
        };

        let generateCallCount = 0;
        const generateArgs: Array<{ sessionId: string }> = [];
        fakeApiClient.generate = async (sessionId) => {
          generateCallCount++;
          generateArgs.push({ sessionId });
          if (generateCallCount === 1) {
            throw new HarnessApiError("unknown_session", 404, {
              error: "unknown_session",
            });
          }
          return {
            generationId: "gen-recovered",
            events: generateTestEvents(),
          };
        };

        const result = await coordinator.send(conv.id, "New prompt");

        expect(createSessionCalls).toBe(1);
        expect(generateCallCount).toBe(2);
        expect(generateArgs[0]?.sessionId).toBe("session-old");
        expect(generateArgs[1]?.sessionId).toBe("session-new");

        // appendTurn called once per stored turn, in stored order, against
        // the new session id, with each turn's exact role and content.
        expect(appendTurnCalls).toEqual([
          { sessionId: "session-new", role: "user", content: "Earlier question" },
          {
            sessionId: "session-new",
            role: "assistant",
            content: "Earlier answer",
          },
        ]);

        expect(result.sessionRebuilt).toBe(true);
        expect(result.replayedTurns).toBe(2);
        expect(result.status).toBe("complete");
        expect(result.generationId).toBe("gen-recovered");

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.sessionId).toBe("session-new");
      });

      it("skips a stored turn whose content is empty or whitespace-only during replay, and does not count it in replayedTurns", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-old");
        conversationStore.appendTurn(conv.id, {
          role: "user",
          content: "Real question",
          cancelled: false,
          createdAt: "2026-08-29T00:00:00Z",
        });
        conversationStore.appendTurn(conv.id, {
          role: "assistant",
          content: "   ",
          cancelled: true,
          createdAt: "2026-08-29T00:00:01Z",
        });

        fakeApiClient.createSession = async () => "session-new";

        const appendTurnCalls: Array<{
          sessionId: string;
          role: string;
          content: string;
        }> = [];
        fakeApiClient.appendTurn = async (sessionId, turn) => {
          appendTurnCalls.push({
            sessionId,
            role: turn.role,
            content: turn.content,
          });
          return {
            index: appendTurnCalls.length - 1,
            role: turn.role,
            content: turn.content,
            created_at: "2026-08-29T00:00:02Z",
            cancelled: false,
          };
        };

        let generateCallCount = 0;
        fakeApiClient.generate = async () => {
          generateCallCount++;
          if (generateCallCount === 1) {
            throw new HarnessApiError("unknown_session", 404, {
              error: "unknown_session",
            });
          }
          return { generationId: "gen-skip", events: generateTestEvents() };
        };

        const result = await coordinator.send(conv.id, "New prompt");

        expect(appendTurnCalls).toEqual([
          { sessionId: "session-new", role: "user", content: "Real question" },
        ]);
        expect(result.replayedTurns).toBe(1);
        expect(result.sessionRebuilt).toBe(true);
      });

      it("does not attempt recovery for a 401 unauthorized error: no createSession, no appendTurn, no retry, sessionId unchanged", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-old");

        const unauthorizedError = new HarnessApiError("unauthorized", 401, null);

        let createSessionCalled = false;
        fakeApiClient.createSession = async () => {
          createSessionCalled = true;
          return "session-new";
        };

        let appendTurnCalled = false;
        fakeApiClient.appendTurn = async (sessionId, turn) => {
          appendTurnCalled = true;
          return {
            index: 0,
            role: turn.role,
            content: turn.content,
            created_at: "2026-08-29T00:00:00Z",
            cancelled: false,
          };
        };

        let generateCallCount = 0;
        fakeApiClient.generate = async () => {
          generateCallCount++;
          throw unauthorizedError;
        };

        let caught: unknown;
        try {
          await coordinator.send(conv.id, "Hello");
          expect.unreachable("Should have rejected");
        } catch (e) {
          caught = e;
        }

        expect(caught).toBe(unauthorizedError);
        expect(createSessionCalled).toBe(false);
        expect(appendTurnCalled).toBe(false);
        expect(generateCallCount).toBe(1);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.sessionId).toBe("session-old");
      });

      it("does not recover a second time when the retried generate also rejects with unknown_session", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-old");

        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return "session-new";
        };

        const secondUnknownSessionError = new HarnessApiError(
          "unknown_session",
          404,
          { error: "unknown_session" }
        );

        let generateCallCount = 0;
        fakeApiClient.generate = async () => {
          generateCallCount++;
          if (generateCallCount === 1) {
            throw new HarnessApiError("unknown_session", 404, {
              error: "unknown_session",
            });
          }
          throw secondUnknownSessionError;
        };

        let caught: unknown;
        try {
          await coordinator.send(conv.id, "Hello");
          expect.unreachable("Should have rejected");
        } catch (e) {
          caught = e;
        }

        expect(caught).toBe(secondUnknownSessionError);
        expect(createSessionCalls).toBe(1);
        expect(generateCallCount).toBe(2);
      });

      it("returns sessionRebuilt:false and replayedTurns:0 on the normal (non-error) path, and never calls appendTurn", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });

        let appendTurnCalled = false;
        fakeApiClient.appendTurn = async (sessionId, turn) => {
          appendTurnCalled = true;
          return {
            index: 0,
            role: turn.role,
            content: turn.content,
            created_at: "2026-08-29T00:00:00Z",
            cancelled: false,
          };
        };

        const result = await coordinator.send(conv.id, "Hello");

        expect(result.sessionRebuilt).toBe(false);
        expect(result.replayedTurns).toBe(0);
        expect(appendTurnCalled).toBe(false);
      });

      it("with no stored sessionId, still creates the session up front exactly as before, and makes no appendTurn calls", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        expect(conv.sessionId).toBeNull();

        let createSessionCalls = 0;
        fakeApiClient.createSession = async () => {
          createSessionCalls++;
          return "session-fresh";
        };

        let appendTurnCalled = false;
        fakeApiClient.appendTurn = async (sessionId, turn) => {
          appendTurnCalled = true;
          return {
            index: 0,
            role: turn.role,
            content: turn.content,
            created_at: "2026-08-29T00:00:00Z",
            cancelled: false,
          };
        };

        const result = await coordinator.send(conv.id, "Hello");

        expect(createSessionCalls).toBe(1);
        expect(appendTurnCalled).toBe(false);
        expect(result.sessionRebuilt).toBe(false);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.sessionId).toBe("session-fresh");
      });
    });

    describe("resumeIfInterrupted", () => {
      it("returns resumed:false and makes no HTTP request when the conversation does not exist", async () => {
        let httpCalled = false;
        fakeApiClient.getSession = async () => {
          httpCalled = true;
          throw new Error("should not be called");
        };
        fakeApiClient.resumeEvents = async () => {
          httpCalled = true;
          throw new Error("should not be called");
        };

        const result = await coordinator.resumeIfInterrupted("unknown-id");

        expect(result).toEqual({
          resumed: false,
          generationId: null,
          text: "",
          status: null,
          telemetry: null,
          errorCode: null,
          streamError: null,
          reconciledFromSession: false,
          seqs: [],
        });
        expect(httpCalled).toBe(false);
      });

      it("returns resumed:false and makes no HTTP request when there is no pending generation", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-123");

        let httpCalled = false;
        fakeApiClient.getSession = async () => {
          httpCalled = true;
          throw new Error("should not be called");
        };
        fakeApiClient.resumeEvents = async () => {
          httpCalled = true;
          throw new Error("should not be called");
        };

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(result.resumed).toBe(false);
        expect(result.text).toBe("");
        expect(result.status).toBeNull();
        expect(result.seqs).toEqual([]);
        expect(httpCalled).toBe(false);
      });

      it("returns resumed:false and makes no HTTP request when there is a pending generation but no sessionId", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-orphan",
          lastSeq: 2,
          status: "in_flight",
          partialText: "Hi",
        });

        let httpCalled = false;
        fakeApiClient.resumeEvents = async () => {
          httpCalled = true;
          throw new Error("should not be called");
        };

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(result.resumed).toBe(false);
        expect(httpCalled).toBe(false);
      });

      it("resumes via a freshly constructed coordinator + store, producing the concatenated full text and a terminal event, reconciles turns, and is idempotent on a second call", async () => {
        const storagePort = createMemoryStorage();
        const store1 = createConversationStore(storagePort);
        const coordinator1 = createSessionCoordinator({
          apiClient: fakeApiClient,
          conversationStore: store1,
        });

        const conv = store1.createConversation({ profileId: "prof-123" });

        fakeApiClient.generate = async () => ({
          generationId: "gen-abc",
          events: generateInterruptedThenDropEvents(),
        });

        try {
          await coordinator1.send(conv.id, "Hi");
          expect.unreachable("Should have rejected");
        } catch {
          // Expected: a transport failure leaves pending set.
        }

        const afterInterruption = store1.getConversation(conv.id);
        expect(afterInterruption?.pending?.generationId).toBe("gen-abc");
        expect(afterInterruption?.pending?.lastSeq).toBe(4);
        expect(afterInterruption?.pending?.partialText).toBe("Hello World");
        expect(afterInterruption?.sessionId).toBe("session-123");

        // Fresh coordinator + store over the same storage port: no
        // carry-over from coordinator1/store1's in-memory state.
        const store2 = createConversationStore(storagePort);
        const coordinator2 = createSessionCoordinator({
          apiClient: fakeApiClient,
          conversationStore: store2,
        });

        let resumeArgs: [string, string, number] | null = null;
        fakeApiClient.resumeEvents = async (sessionId, generationId, lastSeq) => {
          resumeArgs = [sessionId, generationId, lastSeq];
          return {
            generationId,
            events: generateResumeContinuationEvents(),
          };
        };

        const snapshotCreatedAt = "2026-08-29T00:00:00Z";
        fakeApiClient.getSession = async () => ({
          session_id: "session-123",
          created_at: snapshotCreatedAt,
          turns: [
            {
              index: 0,
              role: "user",
              content: "Hi",
              created_at: "2026-08-28T23:59:00Z",
              cancelled: false,
            },
            {
              index: 1,
              role: "assistant",
              content: "Hello World!",
              created_at: "2026-08-28T23:59:01Z",
              cancelled: false,
            },
          ],
          generations: [
            {
              generation_id: "gen-abc",
              status: "complete",
              last_seq: 6,
              created_at: "2026-08-28T23:58:00Z",
            },
          ],
        });

        const result = await coordinator2.resumeIfInterrupted(conv.id);

        expect(resumeArgs!).toEqual(["session-123", "gen-abc", 4]);
        expect(result.resumed).toBe(true);
        expect(result.generationId).toBe("gen-abc");
        expect(result.text).toBe("Hello World!");
        expect(result.status).toBe("complete");
        expect(result.telemetry).not.toBeNull();
        expect(result.reconciledFromSession).toBe(false);
        expect(result.seqs).toEqual([5, 6]);

        // The union of seqs across the interrupted connection (1-4) and the
        // resumed connection is contiguous with no duplicates.
        const allSeqs = [1, 2, 3, 4, ...result.seqs];
        expect(allSeqs).toEqual([1, 2, 3, 4, 5, 6]);
        expect(new Set(allSeqs).size).toBe(allSeqs.length);

        const updated = store2.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
        expect(updated?.turns).toEqual([
          {
            role: "user",
            content: "Hi",
            cancelled: false,
            createdAt: snapshotCreatedAt,
          },
          {
            role: "assistant",
            content: "Hello World!",
            cancelled: false,
            createdAt: snapshotCreatedAt,
          },
        ]);

        // Idempotence: running resumeIfInterrupted again (pending is now
        // null) must not change the transcript or duplicate any turn.
        let secondResumeEventsCalled = false;
        fakeApiClient.resumeEvents = async () => {
          secondResumeEventsCalled = true;
          throw new Error("should not be called: nothing pending");
        };

        const secondResult = await coordinator2.resumeIfInterrupted(conv.id);

        expect(secondResult.resumed).toBe(false);
        expect(secondResumeEventsCalled).toBe(false);

        const updatedAgain = store2.getConversation(conv.id);
        expect(updatedAgain?.turns).toEqual(updated?.turns);
        expect(updatedAgain?.turns.length).toBe(2);
      });

      it("falls back to getSession when resumeEvents throws seq_not_available, reconciling turns from a terminal snapshot", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-fallback");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-fallback",
          lastSeq: 10,
          status: "in_flight",
          partialText: "Partial answer",
        });

        const seqNotAvailableError = new HarnessApiError(
          "seq_not_available",
          409,
          { error: "seq_not_available", last_seq: 25 }
        );

        let getSessionCalled = false;
        fakeApiClient.resumeEvents = async () => {
          throw seqNotAvailableError;
        };
        fakeApiClient.getSession = async () => {
          getSessionCalled = true;
          return {
            session_id: "session-fallback",
            created_at: "2026-08-29T01:00:00Z",
            turns: [
              {
                index: 0,
                role: "user",
                content: "Prompt",
                created_at: "2026-08-29T00:55:00Z",
                cancelled: false,
              },
              {
                index: 1,
                role: "assistant",
                content: "Full answer",
                created_at: "2026-08-29T00:55:05Z",
                cancelled: false,
              },
            ],
            generations: [
              {
                generation_id: "gen-fallback",
                status: "complete",
                last_seq: 30,
                created_at: "2026-08-29T00:54:00Z",
              },
            ],
          };
        };

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(getSessionCalled).toBe(true);
        expect(result.resumed).toBe(true);
        expect(result.reconciledFromSession).toBe(true);
        expect(result.status).toBe("complete");
        expect(result.generationId).toBe("gen-fallback");
        expect(result.text).toBe("Full answer");
        expect(result.seqs).toEqual([]);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
        expect(updated?.turns).toEqual([
          {
            role: "user",
            content: "Prompt",
            cancelled: false,
            createdAt: "2026-08-29T01:00:00Z",
          },
          {
            role: "assistant",
            content: "Full answer",
            cancelled: false,
            createdAt: "2026-08-29T01:00:00Z",
          },
        ]);
      });

      it("maps the snapshot's failed status to error in the seq_not_available fallback", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-fallback-2");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-fallback-2",
          lastSeq: 5,
          status: "in_flight",
          partialText: "",
        });

        fakeApiClient.resumeEvents = async () => {
          throw new HarnessApiError("seq_not_available", 409, {
            error: "seq_not_available",
            last_seq: 8,
          });
        };
        fakeApiClient.getSession = async () => ({
          session_id: "session-fallback-2",
          created_at: "2026-08-29T01:00:00Z",
          turns: [
            {
              index: 0,
              role: "user",
              content: "Prompt",
              created_at: "2026-08-29T00:55:00Z",
              cancelled: false,
            },
          ],
          generations: [
            {
              generation_id: "gen-fallback-2",
              status: "failed",
              last_seq: 8,
              created_at: "2026-08-29T00:54:00Z",
            },
          ],
        });

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(result.reconciledFromSession).toBe(true);
        expect(result.status).toBe("error");

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
      });

      it("leaves pending in place with status:null when the fallback snapshot has nothing terminal yet", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-fallback-3");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-fallback-3",
          lastSeq: 5,
          status: "in_flight",
          partialText: "still going",
        });

        fakeApiClient.resumeEvents = async () => {
          throw new HarnessApiError("seq_not_available", 409, {
            error: "seq_not_available",
            last_seq: 8,
          });
        };
        fakeApiClient.getSession = async () => ({
          session_id: "session-fallback-3",
          created_at: "2026-08-29T01:00:00Z",
          turns: [],
          generations: [
            {
              generation_id: "gen-fallback-3",
              status: "in_flight",
              last_seq: 8,
              created_at: "2026-08-29T00:54:00Z",
            },
          ],
        });

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(result.resumed).toBe(true);
        expect(result.reconciledFromSession).toBe(true);
        expect(result.status).toBeNull();
        expect(result.text).toBe("still going");

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).not.toBeNull();
        expect(updated?.pending?.generationId).toBe("gen-fallback-3");
        expect(updated?.turns).toEqual([]);
      });

      it("propagates a non-seq_not_available HarnessApiError from resumeEvents unchanged, without calling getSession", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-x");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-x",
          lastSeq: 2,
          status: "in_flight",
          partialText: "Hi",
        });

        const otherError = new HarnessApiError("unauthorized", 401, null);

        let getSessionCalled = false;
        fakeApiClient.resumeEvents = async () => {
          throw otherError;
        };
        fakeApiClient.getSession = async () => {
          getSessionCalled = true;
          throw new Error("unexpected");
        };

        let caught: unknown;
        try {
          await coordinator.resumeIfInterrupted(conv.id);
          expect.unreachable("Should have thrown");
        } catch (e) {
          caught = e;
        }

        expect(caught).toBe(otherError);
        expect(getSessionCalled).toBe(false);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).not.toBeNull();
      });

      it("clears pending and rethrows the original error, unchanged, when a handler throws while consuming the resumed stream", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-y");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-y",
          lastSeq: 1,
          status: "in_flight",
          partialText: "Partial",
        });

        fakeApiClient.resumeEvents = async () => ({
          generationId: "gen-y",
          events: generateResumeContinuationEvents(),
        });

        const handlerError = new Error("boom during resume");
        const handlers: GenerationHandlers = {
          onDelta: () => {
            throw handlerError;
          },
        };

        let caught: unknown;
        try {
          await coordinator.resumeIfInterrupted(conv.id, handlers);
          expect.unreachable("Should have thrown");
        } catch (e) {
          caught = e;
        }

        expect(caught).toBe(handlerError);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
      });

      it("returns the reconciled assistant text from the snapshot when falling back to seq_not_available, not the partial text", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-reconcile-text");
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-reconcile-text",
          lastSeq: 0,
          status: "in_flight",
          partialText: "The ans",  // Partial text BEFORE reconciliation
        });

        const seqNotAvailableError = new HarnessApiError(
          "seq_not_available",
          409,
          { error: "seq_not_available", last_seq: 5 }
        );

        fakeApiClient.resumeEvents = async () => {
          throw seqNotAvailableError;
        };
        fakeApiClient.getSession = async () => ({
          session_id: "session-reconcile-text",
          created_at: "2026-08-29T01:00:00Z",
          turns: [
            {
              index: 0,
              role: "user",
              content: "What is the answer?",
              created_at: "2026-08-29T00:55:00Z",
              cancelled: false,
            },
            {
              index: 1,
              role: "assistant",
              content: "The answer is 42.",  // Full reconciled text, differs from partial
              created_at: "2026-08-29T00:55:05Z",
              cancelled: false,
            },
          ],
          generations: [
            {
              generation_id: "gen-reconcile-text",
              status: "complete",
              last_seq: 10,
              created_at: "2026-08-29T00:54:00Z",
            },
          ],
        });

        const result = await coordinator.resumeIfInterrupted(conv.id);

        expect(result.resumed).toBe(true);
        expect(result.reconciledFromSession).toBe(true);
        expect(result.status).toBe("complete");
        expect(result.generationId).toBe("gen-reconcile-text");
        // The key assertion: should return the reconciled assistant text, not the partial
        expect(result.text).toBe("The answer is 42.");

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
        // Verify the turns were reconciled
        expect(updated?.turns[1]?.content).toBe("The answer is 42.");
      });

      it("resumes with lastSeq === -1 (no events received before drop), sends it to resumeEvents, and replays from seq 0 with no gaps", async () => {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });
        conversationStore.setSessionId(conv.id, "session-lastseq-neg1");
        // Set pending with lastSeq: -1 (no events received before drop)
        conversationStore.recordProgress(conv.id, {
          generationId: "gen-lastseq-neg1",
          lastSeq: -1,
          status: "in_flight",
          partialText: "",
        });

        let resumeEventsCalled = false;
        let resumeLastSeqArg: number | null = null;
        fakeApiClient.resumeEvents = async (sessionId, generationId, lastSeq) => {
          resumeEventsCalled = true;
          resumeLastSeqArg = lastSeq;
          return {
            generationId,
            events: generateResumeFromSeqZeroEvents(),
          };
        };

        fakeApiClient.getSession = async () => ({
          session_id: "session-lastseq-neg1",
          created_at: "2026-08-29T01:00:00Z",
          turns: [
            {
              index: 0,
              role: "user",
              content: "Prompt",
              created_at: "2026-08-29T00:55:00Z",
              cancelled: false,
            },
            {
              index: 1,
              role: "assistant",
              content: "Response",
              created_at: "2026-08-29T00:55:05Z",
              cancelled: false,
            },
          ],
          generations: [
            {
              generation_id: "gen-lastseq-neg1",
              status: "complete",
              last_seq: 2,
              created_at: "2026-08-29T00:54:00Z",
            },
          ],
        });

        const result = await coordinator.resumeIfInterrupted(conv.id);

        // Verify that resumeEvents was called with lastSeq: -1
        expect(resumeEventsCalled).toBe(true);
        expect(resumeLastSeqArg!).toBe(-1);

        // Verify the resume succeeded
        expect(result.resumed).toBe(true);
        expect(result.generationId).toBe("gen-lastseq-neg1");

        // Verify the seqs are contiguous from 0 with no gaps
        // generateResumeFromSeqZeroEvents yields seqs [0, 1, 2], all contiguous
        expect(result.seqs.length).toBeGreaterThan(0);
        // Check that seqs are strictly contiguous (each is one more than the previous)
        for (let i = 1; i < result.seqs.length; i++) {
          expect(result.seqs[i]).toBe(result.seqs[i - 1]! + 1);
        }
        // Verify the replay starts at seq 0
        expect(result.seqs[0]).toBe(0);
        // Verify the full expected sequence
        expect(result.seqs).toEqual([0, 1, 2]);

        const updated = conversationStore.getConversation(conv.id);
        expect(updated?.pending).toBeNull();
      });
    });
  });
});

describe("M7-T3: Typed errors and draft prompt attachment", () => {
  let coordinator: SessionCoordinator;
  let conversationStore: ReturnType<typeof createConversationStore>;
  let fakeApiClient: ApiClient;

  beforeEach(() => {
    conversationStore = createConversationStore(createMemoryStorage());

    fakeApiClient = {
      listProfiles: async () => [],
      createSession: async () => "session-123",
      getSession: async (): Promise<SessionSnapshot> => ({
        session_id: "session-123",
        created_at: "2026-08-28T00:00:00Z",
        turns: [],
        generations: [],
      }),
      generate: async (sessionId, options) => {
        return {
          generationId: "gen-456",
          events: generateTestEvents(),
        };
      },
      resumeEvents: async (sessionId, generationId) => {
        return {
          generationId,
          events: generateTestEvents(),
        };
      },
      cancel: async () => ({ status: "cancelled" }),
      appendTurn: async () => ({
        index: 0,
        role: "user",
        content: "test",
        created_at: "2026-08-28T00:00:00Z",
        cancelled: false,
      }),
      getRequestLog: () => [],
      clearRequestLog: () => {},
    };

    coordinator = createSessionCoordinator({
      apiClient: fakeApiClient,
      conversationStore,
    });
  });

  describe("AC1: Empty prompt throws EmptyPromptError", () => {
    it("throws EmptyPromptError for empty string", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EmptyPromptError);
        if (e instanceof EmptyPromptError) {
          expect(e.guidance.action).toBe("edit_prompt");
        }
      }

      // Verify no API calls were made
      expect(fakeApiClient.getRequestLog().length).toBe(0);
    });

    it("throws EmptyPromptError for whitespace-only prompt", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "   ");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EmptyPromptError);
        if (e instanceof EmptyPromptError) {
          expect(e.guidance.action).toBe("edit_prompt");
        }
      }

      expect(fakeApiClient.getRequestLog().length).toBe(0);
    });

    it("throws EmptyPromptError for newline-only prompt", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      try {
        await coordinator.send(conv.id, "\n\t");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EmptyPromptError);
        if (e instanceof EmptyPromptError) {
          expect(e.guidance.action).toBe("edit_prompt");
        }
      }

      expect(fakeApiClient.getRequestLog().length).toBe(0);
    });
  });

  describe("AC2-AC4: SSE error events become typed HarnessStreamError", () => {
    it("converts documented SSE error to HarnessStreamError with correct guidance", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      fakeApiClient.generate = async () => ({
        generationId: "gen-error",
        events: generateErrorEventForCode("inference_failed"),
      });

      const result = await coordinator.send(conv.id, "Hello");

      expect(result.status).toBe("error");
      expect(result.errorCode).toBe("inference_failed");
      expect(result.streamError).toBeDefined();
      if (result.streamError) {
        expect(result.streamError).toBeInstanceOf(HarnessStreamError);
        expect(result.streamError.code).toBe("inference_failed");
        expect(result.streamError.generationId).toBe("gen-error");
        expect(result.streamError.guidance.documented).toBe(true);
        expect(result.streamError.guidance.title).toBe("The model failed while replying");
      }
    });

    it("tests all six documented SSE error codes with distinct titles", async () => {
      const codes = [
        "profile_resolution_failed",
        "inference_failed",
        "incomplete_stream",
        "session_unavailable",
        "generation_timed_out",
        "stream_write_failed",
      ] as const;

      const titles: string[] = [];

      for (const code of codes) {
        const conv = conversationStore.createConversation({
          profileId: "prof-123",
        });

        fakeApiClient.generate = async () => ({
          generationId: "gen-error",
          events: generateErrorEventForCode(code),
        });

        const result = await coordinator.send(conv.id, "Hello");

        expect(result.status).toBe("error");
        expect(result.errorCode).toBe(code);
        expect(result.streamError).toBeDefined();
        if (result.streamError) {
          expect(result.streamError).toBeInstanceOf(HarnessStreamError);
          expect(result.streamError.code).toBe(code);
          expect(result.streamError.guidance.documented).toBe(true);
          titles.push(result.streamError.guidance.title);
        }
      }

      // Verify titles are pairwise distinct
      expect(new Set(titles).size).toBe(titles.length);
    });

    it("converts undocumented SSE error to HarnessStreamError with documented=false", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      fakeApiClient.generate = async () => ({
        generationId: "gen-weird",
        events: generateErrorEventForCode("weird_new_code"),
      });

      const result = await coordinator.send(conv.id, "Hello");

      expect(result.status).toBe("error");
      expect(result.errorCode).toBe("weird_new_code");
      expect(result.streamError).toBeDefined();
      if (result.streamError) {
        expect(result.streamError).toBeInstanceOf(HarnessStreamError);
        expect(result.streamError.code).toBe("weird_new_code");
        expect(result.streamError.guidance.documented).toBe(false);
        expect(result.streamError.guidance.action).toBe("report");
        expect(result.streamError.guidance.detail).toContain("weird_new_code");
      }
    });
  });

  describe("AC3: onError handler receives typed HarnessStreamError", () => {
    it("calls onError with (code, streamError) where streamError matches result", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      fakeApiClient.generate = async () => ({
        generationId: "gen-error",
        events: generateErrorEventForCode("inference_failed"),
      });

      let handlerCode: string | null = null;
      let handlerStreamError: any = null;

      const handlers: GenerationHandlers = {
        onError: (code: string, streamError: HarnessStreamError) => {
          handlerCode = code;
          handlerStreamError = streamError;
        },
      };

      const result = await coordinator.send(conv.id, "Hello", handlers);

      expect((handlerCode as unknown)).toBe("inference_failed");
      expect((handlerStreamError as unknown)).toBeDefined();
      expect((handlerStreamError as unknown)).toBeInstanceOf(HarnessStreamError);
      // Strict equality check - should be the same instance
      expect((handlerStreamError as any)).toBe(result.streamError);
    });
  });

  describe("AC5-AC8: HarnessOfflineError gets draftPrompt attached", () => {
    it("attaches draftPrompt to HarnessOfflineError from generate", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const offlineError = new HarnessOfflineError("https://host/v1/generate", new TypeError("Failed to fetch"));

      fakeApiClient.generate = async () => {
        throw offlineError;
      };

      const draftPrompt = "my drafted prompt";

      try {
        await coordinator.send(conv.id, draftPrompt);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBe(offlineError);
        if (e instanceof HarnessOfflineError) {
          expect(e.draftPrompt).toBe(draftPrompt);
          expect(e.guidance.action).toBe("retry");
        }
      }
    });

    it("leaves conversation unchanged and retryable after offline error", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });
      conversationStore.setSessionId(conv.id, "session-123");

      const offlineError = new HarnessOfflineError("https://host/v1/generate", new TypeError("Failed to fetch"));

      fakeApiClient.generate = async () => {
        throw offlineError;
      };

      const beforeConv = conversationStore.getConversation(conv.id);
      const beforeTurns = beforeConv?.turns.length ?? 0;

      try {
        await coordinator.send(conv.id, "my prompt");
      } catch {
        // Expected
      }

      const afterConv = conversationStore.getConversation(conv.id);
      const afterTurns = afterConv?.turns.length ?? 0;

      // Conversation should be unchanged
      expect(afterTurns).toBe(beforeTurns);

      // A subsequent send against a working stub should succeed
      fakeApiClient.generate = async () => ({
        generationId: "gen-456",
        events: generateTestEvents(),
      });

      const result = await coordinator.send(conv.id, "my prompt");
      expect(result.status).toBe("complete");
    });

    it("attaches draftPrompt to HarnessOfflineError from createSession", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const offlineError = new HarnessOfflineError("https://host/v1/sessions", new TypeError("Failed to fetch"));

      fakeApiClient.createSession = async () => {
        throw offlineError;
      };

      const draftPrompt = "my drafted prompt";

      try {
        await coordinator.send(conv.id, draftPrompt);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBe(offlineError);
        if (e instanceof HarnessOfflineError) {
          expect(e.draftPrompt).toBe(draftPrompt);
        }
      }
    });

    it("does not overwrite existing non-null draftPrompt", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const existingPrompt = "existing draft";
      const offlineError = new HarnessOfflineError("https://host/v1/generate", new TypeError("Failed to fetch"));
      offlineError.draftPrompt = existingPrompt;

      fakeApiClient.generate = async () => {
        throw offlineError;
      };

      try {
        await coordinator.send(conv.id, "new prompt");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBe(offlineError);
        if (e instanceof HarnessOfflineError) {
          expect(e.draftPrompt).toBe(existingPrompt);
        }
      }
    });
  });

  describe("AC9: Authorization error propagates unchanged", () => {
    it("propagates unauthorized error unchanged with guidance action re_pair", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });

      const unauthorizedError = new HarnessApiError("unauthorized", 401, null);

      fakeApiClient.generate = async () => {
        throw unauthorizedError;
      };

      let caughtError: unknown;
      try {
        await coordinator.send(conv.id, "Hello");
        expect.unreachable("Should have thrown");
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBe(unauthorizedError);
      if (caughtError instanceof HarnessApiError) {
        expect(caughtError.code).toBe("unauthorized");
        expect(caughtError.guidance.action).toBe("re_pair");
      }

      // Verify conversation is not affected
      const updatedConv = conversationStore.getConversation(conv.id);
      expect(updatedConv?.turns.length).toBe(0);
      expect(updatedConv?.pending).toBeNull();
    });
  });

  describe("AC11: resumeIfInterrupted returns streamError", () => {
    it("returns streamError populated when stream ends in error event", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });
      conversationStore.setSessionId(conv.id, "session-123");
      conversationStore.recordProgress(conv.id, {
        generationId: "gen-resume",
        lastSeq: 2,
        status: "in_flight",
        partialText: "Partial",
      });

      fakeApiClient.resumeEvents = async () => ({
        generationId: "gen-resume",
        events: generateErrorEventForCode("inference_failed"),
      });

      fakeApiClient.getSession = async (): Promise<SessionSnapshot> => ({
        session_id: "session-123",
        created_at: "2026-08-28T00:00:00Z",
        turns: [],
        generations: [],
      });

      const result = await coordinator.resumeIfInterrupted(conv.id);

      expect(result.status).toBe("error");
      expect(result.streamError).toBeDefined();
      if (result.streamError) {
        expect(result.streamError).toBeInstanceOf(HarnessStreamError);
        expect(result.streamError.code).toBe("inference_failed");
      }
    });

    it("returns streamError: null from emptyResult", async () => {
      const result = await coordinator.resumeIfInterrupted("nonexistent-conv");

      expect(result.resumed).toBe(false);
      expect(result.streamError).toBeNull();
    });

    it("returns streamError: null from seq_not_available fallback path", async () => {
      const conv = conversationStore.createConversation({
        profileId: "prof-123",
      });
      conversationStore.setSessionId(conv.id, "session-123");
      conversationStore.recordProgress(conv.id, {
        generationId: "gen-fallback",
        lastSeq: 5,
        status: "in_flight",
        partialText: "Partial",
      });

      fakeApiClient.resumeEvents = async () => {
        throw new HarnessApiError("seq_not_available", 409, {});
      };

      fakeApiClient.getSession = async (): Promise<SessionSnapshot> => ({
        session_id: "session-123",
        created_at: "2026-08-28T00:00:00Z",
        turns: [],
        generations: [
          {
            generation_id: "gen-fallback",
            status: "complete",
            last_seq: 10,
            created_at: "2026-08-28T00:00:00Z",
          },
        ],
      });

      const result = await coordinator.resumeIfInterrupted(conv.id);

      expect(result.reconciledFromSession).toBe(true);
      expect(result.streamError).toBeNull();
    });
  });

  describe("listProfiles", () => {
    it("calls apiClient.listProfiles exactly once with no arguments", async () => {
      let listProfilesCalls = 0;
      fakeApiClient.listProfiles = async () => {
        listProfilesCalls++;
        return [];
      };

      await coordinator.listProfiles();

      expect(listProfilesCalls).toBe(1);
    });

    it("returns the resolved value from apiClient.listProfiles unchanged", async () => {
      const profilesData = [
        {
          id: "profile-1",
          role: "assistant",
          quality: "high",
          latency_class: "fast",
          label: "Profile 1",
        },
        {
          id: "profile-2",
          role: "assistant",
          quality: "medium",
          latency_class: "medium",
          label: "Profile 2",
        },
      ];

      fakeApiClient.listProfiles = async () => profilesData;

      const result = await coordinator.listProfiles();

      expect(result).toBe(profilesData);
      expect(result).toEqual(profilesData);
      expect(result.length).toBe(2);
      expect(result[0]?.id).toBe("profile-1");
      expect(result[1]?.id).toBe("profile-2");
    });

    it("returns an empty array when apiClient.listProfiles returns empty", async () => {
      fakeApiClient.listProfiles = async () => [];

      const result = await coordinator.listProfiles();

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("propagates errors from apiClient.listProfiles unchanged", async () => {
      const listProfilesError = new HarnessApiError("service_unavailable", 503, {
        error: "service_unavailable",
      });

      fakeApiClient.listProfiles = async () => {
        throw listProfilesError;
      };

      let caught: unknown;
      try {
        await coordinator.listProfiles();
        expect.unreachable("Should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(listProfilesError);
      if (caught instanceof HarnessApiError) {
        expect(caught.code).toBe("service_unavailable");
        expect(caught.status).toBe(503);
      }
    });
  });

  describe("setProfile", () => {
    it("calls conversationStore.setProfileId exactly once with the exact arguments", async () => {
      const conv = conversationStore.createConversation({
        profileId: "original-profile",
      });

      let setProfileIdCalls: Array<[string, string]> = [];
      const originalSetProfileId = conversationStore.setProfileId;
      conversationStore.setProfileId = (conversationId: string, profileId: string) => {
        setProfileIdCalls.push([conversationId, profileId]);
        return originalSetProfileId.call(conversationStore, conversationId, profileId);
      };

      await coordinator.setProfile(conv.id, "new-profile-id");

      expect(setProfileIdCalls.length).toBe(1);
      expect(setProfileIdCalls[0]).toEqual([conv.id, "new-profile-id"]);
    });

    it("returns the resulting Conversation from conversationStore.setProfileId unchanged", async () => {
      const conv = conversationStore.createConversation({
        profileId: "original-profile",
      });

      const result = await coordinator.setProfile(conv.id, "new-profile-id");

      expect(result).toBeDefined();
      expect(result.id).toBe(conv.id);
      expect(result.profileId).toBe("new-profile-id");

      // Verify the store itself was updated
      const stored = conversationStore.getConversation(conv.id);
      expect(stored?.profileId).toBe("new-profile-id");
    });

    it("does not call the apiClient", async () => {
      const conv = conversationStore.createConversation({
        profileId: "original-profile",
      });

      let apiClientCalled = false;
      const originalGenerate = fakeApiClient.generate;
      fakeApiClient.generate = async () => {
        apiClientCalled = true;
        return originalGenerate.call(fakeApiClient, "", { profileId: "", prompt: "" });
      };

      await coordinator.setProfile(conv.id, "new-profile-id");

      expect(apiClientCalled).toBe(false);
    });

    it("propagates errors from conversationStore.setProfileId unchanged", async () => {
      const setProfileIdError = new Error("Conversation not found");

      const originalSetProfileId = conversationStore.setProfileId;
      conversationStore.setProfileId = () => {
        throw setProfileIdError;
      };

      let caught: unknown;
      try {
        await coordinator.setProfile("nonexistent-id", "new-profile-id");
        expect.unreachable("Should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(setProfileIdError);

      // Restore the original method
      conversationStore.setProfileId = originalSetProfileId;
    });

    it("multiple setProfile calls update the conversation sequentially", async () => {
      const conv = conversationStore.createConversation({
        profileId: "profile-1",
      });

      const result1 = await coordinator.setProfile(conv.id, "profile-2");
      expect(result1.profileId).toBe("profile-2");

      const result2 = await coordinator.setProfile(conv.id, "profile-3");
      expect(result2.profileId).toBe("profile-3");

      const result3 = await coordinator.setProfile(conv.id, "profile-4");
      expect(result3.profileId).toBe("profile-4");

      const stored = conversationStore.getConversation(conv.id);
      expect(stored?.profileId).toBe("profile-4");
    });
  });
});

// Helper function to generate test events
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
      profile_id: "prof-123",
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

// Helper for incremental test with controlled promise
async function* generateIncrementalTestEvents(
  controlPromise: Promise<void>
): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "content", delta: "First" };
  // Wait for the test to signal it's ready to continue
  await controlPromise;
  yield { seq: 3, kind: "content", delta: " " };
  yield { seq: 4, kind: "content", delta: "Part" };
  yield {
    seq: 5,
    kind: "complete",
    telemetry: {
      profile_id: "prof-123",
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

// Helper for error events
async function* generateErrorEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "error", error: "model_error" };
}

// Helper for incomplete events (no terminal event)
async function* generateIncompleteEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "model-loading" };
  yield { seq: 3, kind: "content", delta: "Hello" };
  // Stream ends without a terminal event
}

// Helper for cancelled events with partial content
async function* generateCancelledEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "model-loading" };
  yield { seq: 3, kind: "content", delta: "I" };
  yield { seq: 4, kind: "content", delta: " can" };
  yield { seq: 5, kind: "content", delta: " provide" };
  yield { seq: 6, kind: "content", delta: " you" };
  yield { seq: 7, kind: "cancelled" };
}

// Helper for cancelled events with empty content
async function* generateCancelledEmptyEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "cancelled" };
}

// Helper for a transport failure after several content deltas (simulates a
// network error / dropped fetch, distinct from "stream ended without
// terminal event").
async function* generateMultiDeltaThenDropEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "content", delta: "Hello" };
  yield { seq: 2, kind: "content", delta: " " };
  yield { seq: 3, kind: "content", delta: "World" };
  throw new Error("simulated network drop");
}

// Helper for an interrupted generation: some progress, then a transport
// failure (used to seed a realistic pending state for resume tests).
async function* generateInterruptedThenDropEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "model-loading" };
  yield { seq: 3, kind: "content", delta: "Hello" };
  yield { seq: 4, kind: "content", delta: " World" };
  throw new Error("simulated network drop");
}

// Helper for the continuation of a resumed stream: further content, then a
// terminal complete event.
async function* generateResumeContinuationEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 5, kind: "content", delta: "!" };
  yield {
    seq: 6,
    kind: "complete",
    telemetry: {
      profile_id: "prof-123",
      quantization: "q4",
      context_limit: 2048,
      total_duration_ns: 2000000,
      load_duration_ns: 800000,
      prompt_eval_count: 12,
      eval_count: 24,
      tokens_per_second: 60,
    },
  };
}

// Helper for a resumed stream that starts from seq 0 (when lastSeq was -1):
// seqs start at 0 with no gap, contiguous until terminal event.
async function* generateResumeFromSeqZeroEvents(): AsyncIterable<HarnessEvent> {
  yield { seq: 0, kind: "content", delta: "Res" };
  yield { seq: 1, kind: "content", delta: "pon" };
  yield {
    seq: 2,
    kind: "complete",
    telemetry: {
      profile_id: "prof-123",
      quantization: "q4",
      context_limit: 2048,
      total_duration_ns: 1000000,
      load_duration_ns: 400000,
      prompt_eval_count: 8,
      eval_count: 10,
      tokens_per_second: 40,
    },
  };
}

// Helper to generate an error event for a specific code
async function* generateErrorEventForCode(code: string): AsyncIterable<HarnessEvent> {
  yield { seq: 1, kind: "queued", position: 1 };
  yield { seq: 2, kind: "error", error: code };
}
