import type {
  SessionCoordinator,
  SendResult,
  ResumeResult,
  GenerationHandlers,
} from "../session-coordinator";
import type { Conversation, ConversationStore } from "../conversation-store";
import type { Profile } from "../api-client";

export interface UiActions {
  send(
    conversationId: string,
    prompt: string,
    handlers?: GenerationHandlers
  ): Promise<SendResult>;
  cancel(conversationId: string): Promise<{ status: string }>;
  chooseProfile(conversationId: string, profileId: string): Promise<Conversation>;
  resumeIfInterrupted(
    conversationId: string,
    handlers?: GenerationHandlers
  ): Promise<ResumeResult>;
  listProfiles(): Promise<Profile[]>;
  createConversation(input: { profileId: string; title?: string }): Promise<Conversation>;
  deleteConversation(conversationId: string): void;
}

export function createActions(
  coordinator: SessionCoordinator,
  store: ConversationStore
): UiActions {
  return {
    async send(conversationId, prompt, handlers) {
      return coordinator.send(conversationId, prompt, handlers);
    },

    async cancel(conversationId) {
      return coordinator.cancel(conversationId);
    },

    async chooseProfile(conversationId, profileId) {
      return coordinator.setProfile(conversationId, profileId);
    },

    async resumeIfInterrupted(conversationId, handlers) {
      return coordinator.resumeIfInterrupted(conversationId, handlers);
    },

    async listProfiles() {
      return coordinator.listProfiles();
    },

    async createConversation(input) {
      return coordinator.createConversation(input);
    },

    deleteConversation(conversationId) {
      store.deleteConversation(conversationId);
    },
  };
}
