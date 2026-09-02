import type { ApiClient, SessionSnapshot, Profile } from "./api-client";
import {
  HarnessApiError,
  HarnessStreamError,
  HarnessOfflineError,
  EmptyPromptError,
} from "./api-client";
import type {
  Conversation,
  ConversationStore,
  PendingGeneration,
  Turn,
} from "./conversation-store";
import type { HarnessEvent, Telemetry } from "./sse-reader";
import { isTerminal } from "./sse-reader";

export interface GenerationHandlers {
  onQueued?: (position: number) => void;
  onModelLoading?: () => void;
  onDelta?: (delta: string) => void;
  onComplete?: (telemetry: Telemetry) => void;
  onError?: (code: string, error: HarnessStreamError) => void;
  onCancelled?: () => void;
}

export interface SendResult {
  generationId: string;
  text: string;
  status: "complete" | "error" | "cancelled";
  telemetry: Telemetry | null;
  errorCode: string | null;
  streamError: HarnessStreamError | null; // the typed SSE error, when status === "error"
  sessionRebuilt: boolean; // true only when the unknown_session recovery ran
  replayedTurns: number; // turns actually appended during the replay
}

export interface ResumeResult {
  resumed: boolean; // false when there was nothing to resume
  generationId: string | null;
  text: string; // partialText + deltas received on this resume
  status: "complete" | "error" | "cancelled" | null;
  telemetry: Telemetry | null;
  errorCode: string | null;
  streamError: HarnessStreamError | null; // the typed SSE error, when status === "error"
  reconciledFromSession: boolean; // true when the seq_not_available fallback ran
  seqs: number[]; // seqs observed on THIS connection, in order
}

export interface SessionCoordinator {
  createConversation(input: {
    profileId: string;
    title?: string;
  }): Promise<Conversation>;
  send(
    conversationId: string,
    prompt: string,
    handlers?: GenerationHandlers
  ): Promise<SendResult>;
  cancel(conversationId: string): Promise<{ status: string }>;
  resumeIfInterrupted(
    conversationId: string,
    handlers?: GenerationHandlers
  ): Promise<ResumeResult>;
  listProfiles(): Promise<Profile[]>;
  setProfile(conversationId: string, profileId: string): Promise<Conversation>;
}

// Marks an error that originated from a handler callback throwing, as opposed
// to a transport/stream failure. This lets callers distinguish the two
// without inspecting error message text: a handler error clears pending (it
// is not evidence the connection dropped), while a transport failure leaves
// pending in place so resumeIfInterrupted can pick it up later.
class HandlerInvocationError extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super("Handler callback threw");
    this.original = original;
    Object.setPrototypeOf(this, HandlerInvocationError.prototype);
  }
}

interface ConsumeOutcome {
  text: string;
  lastSeq: number;
  status: "complete" | "error" | "cancelled";
  telemetry: Telemetry | null;
  errorCode: string | null;
  streamError: HarnessStreamError | null;
  seqs: number[];
}

/**
 * Consumes a harness event stream, dispatching handler callbacks and
 * persisting progress (lastSeq + accumulated text) after each event. Shared
 * by `send` (a fresh generation) and `resumeIfInterrupted` (continuing a
 * previously interrupted one) so both apply identical handler dispatch and
 * terminal-event handling.
 *
 * Throws `HandlerInvocationError` when a handler callback throws (wrapping
 * the original error), and a plain `Error` for stream/transport failures
 * (including the stream ending without a terminal event).
 */
async function consumeEventStream(
  conversationId: string,
  generationId: string,
  events: AsyncIterable<HarnessEvent>,
  startText: string,
  handlers: GenerationHandlers | undefined,
  conversationStore: ConversationStore
): Promise<ConsumeOutcome> {
  let text = startText;
  let lastSeq = -1;
  let status: "complete" | "error" | "cancelled" = "error";
  let telemetry: Telemetry | null = null;
  let errorCode: string | null = null;
  let streamError: HarnessStreamError | null = null;
  let foundTerminal = false;
  const seqs: number[] = [];

  for await (const event of events) {
    lastSeq = event.seq;
    seqs.push(lastSeq);

    try {
      switch (event.kind) {
        case "queued":
          handlers?.onQueued?.(event.position);
          break;

        case "model-loading":
          handlers?.onModelLoading?.();
          break;

        case "content":
          text += event.delta;
          handlers?.onDelta?.(event.delta);
          break;

        case "complete":
          status = "complete";
          telemetry = event.telemetry;
          handlers?.onComplete?.(event.telemetry);
          foundTerminal = true;
          break;

        case "error":
          status = "error";
          errorCode = event.error;
          streamError = new HarnessStreamError(event.error, generationId);
          handlers?.onError?.(event.error, streamError);
          foundTerminal = true;
          break;

        case "cancelled":
          status = "cancelled";
          handlers?.onCancelled?.();
          foundTerminal = true;
          break;
      }
    } catch (handlerErr) {
      throw new HandlerInvocationError(handlerErr);
    }

    // Persist progress (both lastSeq and the text accumulated so far) after
    // each event, so a dropped connection leaves an accurate resume point.
    conversationStore.recordProgress(conversationId, {
      generationId,
      lastSeq,
      status: "in_flight",
      partialText: text,
    });

    if (isTerminal(event)) {
      break;
    }
  }

  if (!foundTerminal) {
    throw new Error("Stream ended without terminal event");
  }

  return { text, lastSeq, status, telemetry, errorCode, streamError, seqs };
}

function mapSnapshotStatus(
  status: string | undefined
): "complete" | "error" | "cancelled" | null {
  switch (status) {
    case "complete":
      return "complete";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "error";
    default:
      // "queued", "in_flight", or a missing entry: nothing terminal yet.
      return null;
  }
}

export function createSessionCoordinator(deps: {
  apiClient: ApiClient;
  conversationStore: ConversationStore;
}): SessionCoordinator {
  const { apiClient, conversationStore } = deps;

  // Replaces the conversation's local turns with the session snapshot's
  // turns, mapped to the local Turn shape. The service appends both the user
  // and assistant turns itself, so GET /v1/sessions/{id} is authoritative;
  // reconciling from it (rather than appending guessed turns) avoids
  // duplication.
  function reconcileTurnsFromSnapshot(
    conversationId: string,
    snapshot: SessionSnapshot
  ): void {
    const conversation = conversationStore.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    const turns: Turn[] = snapshot.turns.map((turn) => ({
      role: turn.role as Turn["role"],
      content: turn.content,
      cancelled: turn.cancelled,
      createdAt: snapshot.created_at,
    }));

    conversationStore.saveConversation({
      ...conversation,
      turns,
    });
  }

  // Creates a conversation and immediately provisions its server session
  // (FR3: "each conversation is backed by exactly one server session"),
  // rather than deferring session creation to the first send(). Calls
  // apiClient.createSession() exactly once and records the resulting id on
  // the conversation via conversationStore.setSessionId(...) before
  // returning it. send()'s own lazy-creation guard (below) still exists as a
  // fallback for conversations created directly through the store.
  async function createConversation(input: {
    profileId: string;
    title?: string;
  }): Promise<Conversation> {
    const conversation = conversationStore.createConversation(input);
    const sessionId = await apiClient.createSession();
    return conversationStore.setSessionId(conversation.id, sessionId);
  }

  async function send(
    conversationId: string,
    prompt: string,
    handlers?: GenerationHandlers
  ): Promise<SendResult> {
    // 1. Validate prompt (reject empty or whitespace-only)
    if (!prompt || !prompt.trim()) {
      throw new EmptyPromptError();
    }

    try {
      // 2. Check if conversation exists
      const conversation = conversationStore.getConversation(conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }

      let sessionId = conversation.sessionId;

      // 3. Create session if needed
      if (!sessionId) {
        sessionId = await apiClient.createSession();
        conversationStore.setSessionId(conversationId, sessionId);
      }

      // 4. Call generate, recovering at most once from a lost server session
      // (FR8: 404 unknown_session). A 401 unauthorized, or any other error,
      // propagates unchanged - it is not a session-loss condition.
      let generationId: string;
      let events: AsyncIterable<HarnessEvent>;
      let sessionRebuilt = false;
      let replayedTurns = 0;

      try {
        const generateResult = await apiClient.generate(sessionId, {
          profileId: conversation.profileId,
          prompt,
        });
        generationId = generateResult.generationId;
        events = generateResult.events;
      } catch (error) {
        if (!(error instanceof HarnessApiError) || error.code !== "unknown_session") {
          throw error;
        }

        // The session is gone server-side: rebuild it and replay the locally
        // stored transcript, oldest first, before retrying the generation
        // exactly once. If the retry also fails with unknown_session, that
        // error propagates below without a second recovery attempt.
        const newSessionId = await apiClient.createSession();
        const rebuiltConversation = conversationStore.setSessionId(
          conversationId,
          newSessionId
        );
        sessionId = newSessionId;

        for (const turn of rebuiltConversation.turns) {
          if (!turn.content.trim()) {
            continue;
          }
          await apiClient.appendTurn(newSessionId, {
            role: turn.role,
            content: turn.content,
          });
          replayedTurns++;
        }

        sessionRebuilt = true;

        const retryResult = await apiClient.generate(newSessionId, {
          profileId: conversation.profileId,
          prompt,
        });
        generationId = retryResult.generationId;
        events = retryResult.events;
      }

      // 5. Record progress before consuming stream
      conversationStore.recordProgress(conversationId, {
        generationId,
        lastSeq: -1,
        status: "in_flight",
        partialText: "",
      });

      let outcome: ConsumeOutcome;
      try {
        // 6. Iterate events and dispatch handlers as they arrive
        outcome = await consumeEventStream(
          conversationId,
          generationId,
          events,
          "",
          handlers,
          conversationStore
        );
      } catch (error) {
        if (error instanceof HandlerInvocationError) {
          // A handler callback threw. This is NOT a transport failure: clear
          // pending (there is nothing to resume) and rethrow the original
          // error so the caller sees exactly what their handler threw.
          try {
            conversationStore.recordProgress(conversationId, null);
          } catch {
            // Ignore errors while clearing pending
          }
          throw error.original;
        }

        // A transport failure (aborted fetch, network error, or the stream
        // ending without a terminal event). Leave pending in place - it
        // already holds the generation id, the last seq actually received,
        // and the partial text actually received, via the recordProgress
        // calls made while consuming the stream - so resumeIfInterrupted can
        // pick it up later.
        throw error;
      }

      const { text, status, telemetry, errorCode, streamError } = outcome;

      // 7. On terminal event, clear pending and mirror turns
      conversationStore.recordProgress(conversationId, null);

      const now = new Date().toISOString();

      // Always append user turn
      conversationStore.appendTurn(conversationId, {
        role: "user",
        content: prompt,
        cancelled: false,
        createdAt: now,
      });

      // Append assistant turn on complete or cancelled
      if (status === "complete") {
        conversationStore.appendTurn(conversationId, {
          role: "assistant",
          content: text,
          cancelled: false,
          createdAt: now,
        });
      } else if (status === "cancelled") {
        conversationStore.appendTurn(conversationId, {
          role: "assistant",
          content: text,
          cancelled: true,
          createdAt: now,
        });
      }

      // 8. Return result
      return {
        generationId,
        text,
        status,
        telemetry,
        errorCode,
        streamError,
        sessionRebuilt,
        replayedTurns,
      };
    } catch (error) {
      if (error instanceof HarnessOfflineError && error.draftPrompt === null) {
        error.draftPrompt = prompt;
      }
      throw error;
    }
  }

  async function cancel(
    conversationId: string
  ): Promise<{ status: string }> {
    // 1. Check if conversation exists
    const conversation = conversationStore.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // 2. Check if there's a generation in flight
    if (!conversation.pending || !conversation.sessionId) {
      throw new Error(
        `No generation in flight for conversation: ${conversationId}`
      );
    }

    // 3. Call apiClient.cancel and return the result unchanged
    return await apiClient.cancel(
      conversation.sessionId,
      conversation.pending.generationId
    );
  }

  async function resumeFromSessionSnapshot(
    conversationId: string,
    sessionId: string,
    pending: PendingGeneration
  ): Promise<ResumeResult> {
    const snapshot = await apiClient.getSession(sessionId);
    const match = snapshot.generations.find(
      (generation) => generation.generation_id === pending.generationId
    );
    const status = mapSnapshotStatus(match?.status);

    if (status === null) {
      // Nothing terminal yet (still queued/in_flight, or the generation is
      // missing from the snapshot). Leave pending in place - there is
      // nothing terminal to record.
      return {
        resumed: true,
        generationId: pending.generationId,
        text: pending.partialText,
        status: null,
        telemetry: null,
        errorCode: null,
        streamError: null,
        reconciledFromSession: true,
        seqs: [],
      };
    }

    conversationStore.recordProgress(conversationId, null);
    reconcileTurnsFromSnapshot(conversationId, snapshot);

    // After reconciliation, read the conversation back and get the reconciled
    // assistant text from the last assistant turn. If there is no such turn,
    // fall back to pending.partialText so the field is never undefined.
    let reconciledText = pending.partialText;
    const conversation = conversationStore.getConversation(conversationId);
    if (conversation && conversation.turns.length > 0) {
      // Find the last assistant turn
      for (let i = conversation.turns.length - 1; i >= 0; i--) {
        const turn = conversation.turns[i];
        if (turn?.role === "assistant") {
          reconciledText = turn.content;
          break;
        }
      }
    }

    return {
      resumed: true,
      generationId: pending.generationId,
      text: reconciledText,
      status,
      telemetry: null,
      errorCode: null,
      streamError: null,
      reconciledFromSession: true,
      seqs: [],
    };
  }

  async function resumeIfInterrupted(
    conversationId: string,
    handlers?: GenerationHandlers
  ): Promise<ResumeResult> {
    const emptyResult: ResumeResult = {
      resumed: false,
      generationId: null,
      text: "",
      status: null,
      telemetry: null,
      errorCode: null,
      streamError: null,
      reconciledFromSession: false,
      seqs: [],
    };

    // Rely on nothing held in memory from a previous send: every input
    // comes from the store.
    const conversation = conversationStore.getConversation(conversationId);
    if (!conversation || !conversation.pending || !conversation.sessionId) {
      return emptyResult;
    }

    const pending = conversation.pending;
    const sessionId = conversation.sessionId;
    const generationId = pending.generationId;

    let events: AsyncIterable<HarnessEvent>;
    try {
      const resumed = await apiClient.resumeEvents(
        sessionId,
        generationId,
        pending.lastSeq
      );
      events = resumed.events;
    } catch (error) {
      if (
        error instanceof HarnessApiError &&
        error.code === "seq_not_available"
      ) {
        // The buffer has discarded the requested seq: fall back to fetching
        // the session and reconciling from its recorded state.
        return await resumeFromSessionSnapshot(
          conversationId,
          sessionId,
          pending
        );
      }
      // Any other API error propagates unchanged.
      throw error;
    }

    let outcome: ConsumeOutcome;
    try {
      outcome = await consumeEventStream(
        conversationId,
        generationId,
        events,
        pending.partialText,
        handlers,
        conversationStore
      );
    } catch (error) {
      if (error instanceof HandlerInvocationError) {
        try {
          conversationStore.recordProgress(conversationId, null);
        } catch {
          // Ignore errors while clearing pending
        }
        throw error.original;
      }

      // Transport failure again: leave pending in place (already updated by
      // consumeEventStream) so a future resume can pick it up.
      throw error;
    }

    conversationStore.recordProgress(conversationId, null);

    const snapshot = await apiClient.getSession(sessionId);
    reconcileTurnsFromSnapshot(conversationId, snapshot);

    return {
      resumed: true,
      generationId,
      text: outcome.text,
      status: outcome.status,
      telemetry: outcome.telemetry,
      errorCode: outcome.errorCode,
      streamError: outcome.streamError,
      reconciledFromSession: false,
      seqs: outcome.seqs,
    };
  }

  async function listProfiles(): Promise<Profile[]> {
    return await apiClient.listProfiles();
  }

  async function setProfile(
    conversationId: string,
    profileId: string
  ): Promise<Conversation> {
    return await conversationStore.setProfileId(conversationId, profileId);
  }

  return {
    createConversation,
    send,
    cancel,
    resumeIfInterrupted,
    listProfiles,
    setProfile,
  };
}
