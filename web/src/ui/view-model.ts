import type { Conversation, Turn } from "../conversation-store";
import type { Telemetry } from "../sse-reader";
import type { Profile, ErrorGuidance } from "../api-client";

export interface TelemetryDisplay {
  tokensPerSecond: number;
  evalCount: number;
  quantization: string;
  contextLimit: number;
}

export type GenerationDisplay =
  | { kind: "idle" }
  | { kind: "queued"; position: number }
  | { kind: "model-loading" }
  | { kind: "streaming" }
  | { kind: "complete"; telemetry: TelemetryDisplay }
  | { kind: "cancelled" }
  | { kind: "error"; code: string; message: string }
  | { kind: "offline"; draftPrompt: string | null }
  | { kind: "reconnecting"; attempt: number; draftPrompt: string | null };

export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: string;
  selected: boolean;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  cancelled: boolean;
  createdAt: string | null;
  pending: boolean;
}

export interface UiState {
  conversations: readonly Conversation[];
  selectedConversationId: string | null;
  profiles: readonly Profile[];
  generation: GenerationDisplay;
  streamingText: string;
  notice: string | null;
}

export interface ViewModel {
  conversations: readonly ConversationListItem[];
  transcript: readonly TranscriptEntry[];
  profiles: readonly Profile[];
  selectedProfileId: string | null;
  generation: GenerationDisplay;
  notice: string | null;
}

export function toTelemetryDisplay(telemetry: Telemetry): TelemetryDisplay {
  return {
    tokensPerSecond: telemetry.tokens_per_second,
    evalCount: telemetry.eval_count,
    quantization: telemetry.quantization,
    contextLimit: telemetry.context_limit,
  };
}

export function buildViewModel(state: UiState): ViewModel {
  // Build conversation list
  const conversationItems = state.conversations.map((conv) => ({
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updatedAt,
    selected: conv.id === state.selectedConversationId,
  }));

  // Sort by updatedAt descending (lexicographic order for ISO-8601), ties broken by id ascending
  conversationItems.sort((a, b) => {
    const dateCompare = b.updatedAt.localeCompare(a.updatedAt);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return a.id.localeCompare(b.id);
  });

  // Find selected conversation for transcript and profileId
  const selectedConversation = state.conversations.find(
    (conv) => conv.id === state.selectedConversationId
  );

  // Build transcript from selected conversation's turns
  const transcriptEntries: TranscriptEntry[] = [];

  if (selectedConversation) {
    // Add all stored turns in order
    for (const turn of selectedConversation.turns) {
      transcriptEntries.push({
        role: turn.role,
        content: turn.content,
        cancelled: turn.cancelled,
        createdAt: turn.createdAt,
        pending: false,
      });
    }

    // Add pending entry if there's text in flight
    // This is a display projection only and is never written back to the store
    const pendingText =
      state.streamingText.length > 0
        ? state.streamingText
        : selectedConversation.pending?.partialText &&
            selectedConversation.pending.partialText.length > 0
          ? selectedConversation.pending.partialText
          : null;

    if (pendingText !== null) {
      transcriptEntries.push({
        role: "assistant",
        content: pendingText,
        cancelled: false,
        createdAt: null,
        pending: true,
      });
    }
  }

  // Determine selected profile ID
  const selectedProfileId = selectedConversation?.profileId ?? null;

  return {
    conversations: conversationItems,
    transcript: transcriptEntries,
    profiles: state.profiles,
    selectedProfileId,
    generation: state.generation,
    notice: state.notice,
  };
}

// Narrows an unknown value to ErrorGuidance -- guards against a value that
// merely happens to have a `guidance` property without carrying the shape
// api-client.ts's error classes attach.
function isErrorGuidance(value: unknown): value is ErrorGuidance {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ErrorGuidance).code === "string" &&
    typeof (value as ErrorGuidance).title === "string" &&
    typeof (value as ErrorGuidance).detail === "string"
  );
}

// Turns any rejection reason into a message fit to show a human. Uses the
// guidance surface built in api-client.ts (HarnessApiError, HarnessStreamError,
// HarnessOfflineError and EmptyPromptError all carry a `.guidance`) rather than
// inventing new copy, so the documented error-code guidance (FR9) actually
// reaches the screen instead of being discarded.
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "guidance" in error) {
    const guidance = (error as { guidance: unknown }).guidance;
    if (isErrorGuidance(guidance)) {
      return `${guidance.title} (${guidance.code}): ${guidance.detail}`;
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "An unexpected error occurred. Please try again.";
}
