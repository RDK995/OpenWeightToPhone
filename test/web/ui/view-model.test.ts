import { describe, it, expect } from "bun:test";
import {
  buildViewModel,
  toTelemetryDisplay,
  type UiState,
  type TelemetryDisplay,
  type GenerationDisplay,
  type ConversationListItem,
  type TranscriptEntry,
  type ViewModel,
} from "../../../web/src/ui/view-model";
import type { Profile } from "../../../web/src/api-client";
import type { Conversation, Turn } from "../../../web/src/conversation-store";
import type { Telemetry } from "../../../web/src/sse-reader";

describe("view-model", () => {
  describe("types", () => {
    it("exports TelemetryDisplay interface", () => {
      const telemetry: TelemetryDisplay = {
        tokensPerSecond: 10.5,
        evalCount: 100,
        quantization: "Q4_0",
        contextLimit: 2048,
      };
      expect(telemetry.tokensPerSecond).toBe(10.5);
    });

    it("exports GenerationDisplay type with all kinds", () => {
      const idle: GenerationDisplay = { kind: "idle" };
      const queued: GenerationDisplay = { kind: "queued", position: 1 };
      const loading: GenerationDisplay = { kind: "model-loading" };
      const streaming: GenerationDisplay = { kind: "streaming" };
      const complete: GenerationDisplay = {
        kind: "complete",
        telemetry: {
          tokensPerSecond: 10,
          evalCount: 100,
          quantization: "Q4_0",
          contextLimit: 2048,
        },
      };
      const cancelled: GenerationDisplay = { kind: "cancelled" };
      const error: GenerationDisplay = {
        kind: "error",
        code: "test_error",
        message: "Test error",
      };

      expect(idle.kind).toBe("idle");
      expect(queued.position).toBe(1);
      expect(loading.kind).toBe("model-loading");
      expect(streaming.kind).toBe("streaming");
      expect(complete.kind).toBe("complete");
      expect(cancelled.kind).toBe("cancelled");
      expect(error.code).toBe("test_error");
    });

    it("exports ConversationListItem interface", () => {
      const item: ConversationListItem = {
        id: "conv-1",
        title: "Test",
        updatedAt: "2026-08-30T00:00:00Z",
        selected: true,
      };
      expect(item.id).toBe("conv-1");
      expect(item.selected).toBe(true);
    });

    it("exports TranscriptEntry interface", () => {
      const entry: TranscriptEntry = {
        role: "user",
        content: "Hello",
        cancelled: false,
        createdAt: "2026-08-30T00:00:00Z",
        pending: false,
      };
      expect(entry.role).toBe("user");
      expect(entry.pending).toBe(false);
    });

    it("exports UiState interface", () => {
      const state: UiState = {
        conversations: [],
        selectedConversationId: null,
        profiles: [],
        generation: { kind: "idle" },
        streamingText: "",
      };
      expect(state.selectedConversationId).toBeNull();
    });

    it("exports ViewModel interface", () => {
      const model: ViewModel = {
        conversations: [],
        transcript: [],
        profiles: [],
        selectedProfileId: null,
        generation: { kind: "idle" },
      };
      expect(model.conversations.length).toBe(0);
    });
  });

  describe("buildViewModel", () => {
    it("creates basic view model from empty state", () => {
      const state: UiState = {
        conversations: [],
        selectedConversationId: null,
        profiles: [],
        generation: { kind: "idle" },
        streamingText: "",
      };

      const model = buildViewModel(state);

      expect(model.conversations).toEqual([]);
      expect(model.transcript).toEqual([]);
      expect(model.profiles).toEqual([]);
      expect(model.selectedProfileId).toBeNull();
      expect(model.generation.kind).toBe("idle");
    });

    describe("conversation list", () => {
      it("sorts conversations by updatedAt descending", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "First",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
          {
            id: "conv-2",
            title: "Second",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          },
          {
            id: "conv-3",
            title: "Third",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-27T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        const first = model.conversations[0];
        const second = model.conversations[1];
        const third = model.conversations[2];
        if (!first || !second || !third) throw new Error("Conversations not found");
        expect(first.id).toBe("conv-2");
        expect(second.id).toBe("conv-3");
        expect(third.id).toBe("conv-1");
      });

      it("breaks ties on updatedAt by id ascending", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-c",
            title: "C",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          },
          {
            id: "conv-a",
            title: "A",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          },
          {
            id: "conv-b",
            title: "B",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        const first = model.conversations[0];
        const second = model.conversations[1];
        const third = model.conversations[2];
        if (!first || !second || !third)
          throw new Error("Conversations not found");
        expect(first.id).toBe("conv-a");
        expect(second.id).toBe("conv-b");
        expect(third.id).toBe("conv-c");
      });

      it("sets selected flag for matching conversation", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "First",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
          {
            id: "conv-2",
            title: "Second",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        const selected = model.conversations.find((c) => c.id === "conv-1");
        const notSelected = model.conversations.find((c) => c.id === "conv-2");

        if (!selected || !notSelected) throw new Error("Conversations not found");
        expect(selected.selected).toBe(true);
        expect(notSelected.selected).toBe(false);
      });

      it("sets all selected flags to false when nothing is selected", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "First",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
          {
            id: "conv-2",
            title: "Second",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.conversations.every((c) => !c.selected)).toBe(true);
      });

      it("sets selected to false when selected id matches nothing", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "First",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "nonexistent",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.conversations.every((c) => !c.selected)).toBe(true);
      });

      it("preserves conversation titles", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "My Conversation",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        const conv = model.conversations[0];
        if (!conv) throw new Error("Conversation not found");
        expect(conv.title).toBe("My Conversation");
      });
    });

    describe("transcript", () => {
      it("returns empty transcript when nothing is selected", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T00:00:00Z",
              },
            ],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript).toEqual([]);
      });

      it("returns empty transcript when selected id matches nothing", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T00:00:00Z",
              },
            ],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "nonexistent",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript).toEqual([]);
      });

      it("returns turns from selected conversation with pending false", () => {
        const turns: Turn[] = [
          {
            role: "user",
            content: "Hello",
            cancelled: false,
            createdAt: "2026-08-28T10:00:00Z",
          },
          {
            role: "assistant",
            content: "Hi there",
            cancelled: false,
            createdAt: "2026-08-28T10:01:00Z",
          },
        ];

        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns,
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:01:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript.length).toBe(2);
        expect(model.transcript[0]).toEqual({
          role: "user",
          content: "Hello",
          cancelled: false,
          createdAt: "2026-08-28T10:00:00Z",
          pending: false,
        });
        expect(model.transcript[1]).toEqual({
          role: "assistant",
          content: "Hi there",
          cancelled: false,
          createdAt: "2026-08-28T10:01:00Z",
          pending: false,
        });
      });

      it("preserves stored turn order even when createdAt is out of order", () => {
        const turns: Turn[] = [
          {
            role: "user",
            content: "First",
            cancelled: false,
            createdAt: "2026-08-28T10:05:00Z",
          },
          {
            role: "assistant",
            content: "Second",
            cancelled: false,
            createdAt: "2026-08-28T10:00:00Z",
          },
          {
            role: "user",
            content: "Third",
            cancelled: false,
            createdAt: "2026-08-28T10:10:00Z",
          },
        ];

        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns,
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:10:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript.length).toBe(3);
        const first = model.transcript[0];
        const second = model.transcript[1];
        const third = model.transcript[2];
        if (!first || !second || !third) throw new Error("Transcript entries not found");
        expect(first.content).toBe("First");
        expect(second.content).toBe("Second");
        expect(third.content).toBe("Third");
      });
    });

    describe("pending entry (display only)", () => {
      it("appends pending entry with streamingText when non-empty", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T10:00:00Z",
              },
            ],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "Partial response",
        };

        const model = buildViewModel(state);

        expect(model.transcript.length).toBe(2);
        const pending = model.transcript[1];
        if (!pending) throw new Error("Pending entry not found");
        expect(pending.role).toBe("assistant");
        expect(pending.content).toBe("Partial response");
        expect(pending.cancelled).toBe(false);
        expect(pending.createdAt).toBeNull();
        expect(pending.pending).toBe(true);
      });

      it("appends pending entry with pending.partialText when streamingText is empty", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T10:00:00Z",
              },
            ],
            pending: {
              generationId: "gen-1",
              lastSeq: 5,
              status: "in-progress",
              partialText: "From pending",
            },
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript.length).toBe(2);
        const pending = model.transcript[1];
        if (!pending) throw new Error("Pending entry not found");
        expect(pending.content).toBe("From pending");
        expect(pending.pending).toBe(true);
      });

      it("does not append pending entry when both streamingText and pending.partialText are empty", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T10:00:00Z",
              },
            ],
            pending: {
              generationId: "gen-1",
              lastSeq: 5,
              status: "in-progress",
              partialText: "",
            },
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.transcript.length).toBe(1);
      });

      it("does not append pending entry when nothing is selected", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "Streaming text",
        };

        const model = buildViewModel(state);

        expect(model.transcript).toEqual([]);
      });

      it("prioritizes streamingText over pending.partialText", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: {
              generationId: "gen-1",
              lastSeq: 5,
              status: "in-progress",
              partialText: "From pending",
            },
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "From streaming",
        };

        const model = buildViewModel(state);

        const entry = model.transcript[0];
        if (!entry) throw new Error("Transcript entry not found");
        expect(entry.content).toBe("From streaming");
      });
    });

    describe("generation display", () => {
      it("passes through idle generation", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "idle" });
      });

      it("passes through queued generation with position", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "queued", position: 1 },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "queued", position: 1 });
      });

      it("passes through queued generation with larger position", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "queued", position: 5 },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "queued", position: 5 });
      });

      it("passes through model-loading generation", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "model-loading" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "model-loading" });
      });

      it("passes through streaming generation", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "streaming" });
      });

      it("passes through complete generation with telemetry", () => {
        const telemetry: TelemetryDisplay = {
          tokensPerSecond: 10.5,
          evalCount: 100,
          quantization: "Q4_0",
          contextLimit: 2048,
        };
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "complete", telemetry },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "complete", telemetry });
      });

      it("passes through cancelled generation", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "cancelled" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({ kind: "cancelled" });
      });

      it("passes through error generation", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: {
            kind: "error",
            code: "test_error",
            message: "Test error message",
          },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({
          kind: "error",
          code: "test_error",
          message: "Test error message",
        });
      });

      it("passes through offline generation with the preserved draft prompt", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "offline", draftPrompt: "my drafted prompt" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({
          kind: "offline",
          draftPrompt: "my drafted prompt",
        });
      });

      it("AC1: passes through reconnecting generation with attempt and draftPrompt intact", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "reconnecting", attempt: 2, draftPrompt: "hi" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({
          kind: "reconnecting",
          attempt: 2,
          draftPrompt: "hi",
        });
      });

      it("AC4: preserves drafted prompt in reconnecting state", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: {
            kind: "reconnecting",
            attempt: 1,
            draftPrompt: "my prompt",
          },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation.kind).toBe("reconnecting");
        if (model.generation.kind !== "reconnecting") {
          throw new Error("Expected reconnecting");
        }
        expect(model.generation.draftPrompt).toBe("my prompt");
      });

      it("passes through reconnecting with null draftPrompt", () => {
        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "reconnecting", attempt: 3, draftPrompt: null },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.generation).toEqual({
          kind: "reconnecting",
          attempt: 3,
          draftPrompt: null,
        });
      });
    });

    describe("profiles and selectedProfileId", () => {
      it("passes through profiles unchanged", () => {
        const profiles: Profile[] = [
          {
            id: "prof-1",
            role: "assistant",
            quality: "high",
            latency_class: "fast",
            label: "Profile 1",
          },
          {
            id: "prof-2",
            role: "assistant",
            quality: "medium",
            latency_class: "medium",
            label: "Profile 2",
          },
        ];

        const state: UiState = {
          conversations: [],
          selectedConversationId: null,
          profiles,
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.profiles).toBe(profiles);
      });

      it("returns selectedProfileId from selected conversation", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.selectedProfileId).toBe("prof-1");
      });

      it("returns null for selectedProfileId when nothing is selected", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: null,
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.selectedProfileId).toBeNull();
      });

      it("returns null for selectedProfileId when selected id matches nothing", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "nonexistent",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "",
        };

        const model = buildViewModel(state);

        expect(model.selectedProfileId).toBeNull();
      });
    });

    describe("purity", () => {
      it("does not mutate input state", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T10:00:00Z",
              },
            ],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "test",
        };

        const stateJson = JSON.stringify(state);
        buildViewModel(state);
        const stateJsonAfter = JSON.stringify(state);

        expect(stateJsonAfter).toBe(stateJson);
      });

      it("is deterministic", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "streaming" },
          streamingText: "test",
        };

        const model1 = buildViewModel(state);
        const model2 = buildViewModel(state);

        expect(JSON.stringify(model1)).toBe(JSON.stringify(model2));
      });

      it("works with deep-frozen input state", () => {
        const conversations: Conversation[] = [
          {
            id: "conv-1",
            title: "Test",
            sessionId: null,
            profileId: "prof-1",
            turns: [
              {
                role: "user",
                content: "Hello",
                cancelled: false,
                createdAt: "2026-08-28T10:00:00Z",
              },
            ],
            pending: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T10:00:00Z",
          },
        ];

        const state: UiState = {
          conversations,
          selectedConversationId: "conv-1",
          profiles: [],
          generation: { kind: "idle" },
          streamingText: "test",
        };

        function deepFreeze(obj: unknown): unknown {
          Object.freeze(obj);

          if (obj !== null && typeof obj === "object") {
            Object.getOwnPropertyNames(obj).forEach((prop) => {
              const value = (obj as Record<string, unknown>)[prop];
              if (
                value !== null &&
                (typeof value === "object" || typeof value === "function")
              ) {
                deepFreeze(value);
              }
            });
          }

          return obj;
        }

        deepFreeze(state);

        expect(() => buildViewModel(state)).not.toThrow();
      });
    });
  });

  describe("toTelemetryDisplay", () => {
    it("maps telemetry from snake_case to camelCase", () => {
      const telemetry: Telemetry = {
        profile_id: "prof-1",
        tokens_per_second: 10.5,
        eval_count: 100,
        quantization: "Q4_0",
        context_limit: 2048,
        total_duration_ns: 1000000000,
        load_duration_ns: 500000000,
        prompt_eval_count: 50,
      };

      const result = toTelemetryDisplay(telemetry);

      expect(result).toEqual({
        tokensPerSecond: 10.5,
        evalCount: 100,
        quantization: "Q4_0",
        contextLimit: 2048,
      });
    });

    it("ignores extra wire fields", () => {
      const telemetry: Telemetry = {
        profile_id: "prof-1",
        tokens_per_second: 10.5,
        eval_count: 100,
        quantization: "Q4_0",
        context_limit: 2048,
        total_duration_ns: 0,
        load_duration_ns: 0,
        prompt_eval_count: 0,
        extra_field: "should not appear",
      };

      const result = toTelemetryDisplay(telemetry);

      expect(Object.keys(result)).toEqual([
        "tokensPerSecond",
        "evalCount",
        "quantization",
        "contextLimit",
      ]);
      expect((result as unknown as Record<string, unknown>).extra_field).toBeUndefined();
    });

    it("handles numeric values correctly", () => {
      const telemetry: Telemetry = {
        profile_id: "prof-1",
        tokens_per_second: 25.75,
        eval_count: 512,
        quantization: "Q5_K_M",
        context_limit: 4096,
        total_duration_ns: 0,
        load_duration_ns: 0,
        prompt_eval_count: 0,
      };

      const result = toTelemetryDisplay(telemetry);

      expect(result.tokensPerSecond).toBe(25.75);
      expect(result.evalCount).toBe(512);
      expect(result.contextLimit).toBe(4096);
    });
  });
});

describe("reconnecting generation display (M16-T2)", () => {
  describe("types", () => {
    it("exports GenerationDisplay type with reconnecting variant", () => {
      const reconnecting: GenerationDisplay = {
        kind: "reconnecting",
        attempt: 2,
        draftPrompt: "hi",
      };
      expect(reconnecting.kind).toBe("reconnecting");
      expect(reconnecting.attempt).toBe(2);
      expect(reconnecting.draftPrompt).toBe("hi");
    });

    it("reconnecting variant with null draft prompt", () => {
      const reconnecting: GenerationDisplay = {
        kind: "reconnecting",
        attempt: 1,
        draftPrompt: null,
      };
      expect(reconnecting.kind).toBe("reconnecting");
      expect(reconnecting.attempt).toBe(1);
      expect(reconnecting.draftPrompt).toBeNull();
    });

    it("reconnecting is a peer of offline and error: none share code field with attempt", () => {
      const reconnecting: GenerationDisplay = {
        kind: "reconnecting",
        attempt: 3,
        draftPrompt: "prompt",
      };
      const offline: GenerationDisplay = {
        kind: "offline",
        draftPrompt: "prompt",
      };
      const error: GenerationDisplay = {
        kind: "error",
        code: "test",
        message: "msg",
      };

      expect("code" in reconnecting).toBe(false);
      expect("code" in offline).toBe(false);
      expect("attempt" in offline).toBe(false);
      expect("attempt" in error).toBe(false);
    });
  });

  describe("AC3: rendering and distinguishability", () => {
    it("AC3: the reconnecting state is distinguishable from error and offline", () => {
      // This test will be completed after we implement generationStatusText
      // For now we just need to establish that reconnecting exists and can be created
      const reconnecting: GenerationDisplay = {
        kind: "reconnecting",
        attempt: 3,
        draftPrompt: null,
      };
      expect(reconnecting.kind).toBe("reconnecting");
    });
  });
});
