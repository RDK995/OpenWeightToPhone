import type { StoragePort } from "./storage-port";

export type Turn = {
  role: "user" | "assistant";
  content: string;
  cancelled: boolean;
  createdAt: string;
};

export type PendingGeneration = {
  generationId: string;
  lastSeq: number;
  status: string;
  partialText: string;
};

export type Conversation = {
  id: string;
  title: string;
  sessionId: string | null;
  profileId: string;
  turns: Turn[];
  pending: PendingGeneration | null;
  createdAt: string;
  updatedAt: string;
};

export const CONVERSATIONS_STORAGE_KEY = "phone-to-local-model:v1:conversations";

/**
 * Schema version of the value stored under CONVERSATIONS_STORAGE_KEY. The
 * persisted value is an envelope `{ version, conversations }`, not a bare
 * array, so that a future format change can be detected and rejected
 * instead of being silently misread as "no conversations".
 */
export const CONVERSATIONS_SCHEMA_VERSION = 1;

interface ConversationsEnvelope {
  version: number;
  conversations: unknown[];
}

/**
 * Thrown when the stored conversations payload is not JSON, is not a
 * recognised envelope shape, or carries a schema version this build does
 * not know how to read. Thrown instead of silently treating the payload as
 * empty, so a format the code cannot understand can never be mistaken for
 * "no conversations" and overwritten.
 */
export class UnknownStorageVersionError extends Error {
  readonly foundVersion: number | null;
  readonly expectedVersion: number;

  constructor(foundVersion: number | null, expectedVersion: number) {
    super(
      foundVersion === null
        ? `UnknownStorageVersionError: stored conversations payload is not a recognised envelope (expected version ${expectedVersion})`
        : `UnknownStorageVersionError: stored conversations payload has version ${foundVersion}, expected ${expectedVersion}`
    );
    this.foundVersion = foundVersion;
    this.expectedVersion = expectedVersion;
    Object.setPrototypeOf(this, UnknownStorageVersionError.prototype);
  }
}

function readEnvelopeVersion(parsed: unknown): number | null {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "version" in parsed
  ) {
    const version = (parsed as { version: unknown }).version;
    return typeof version === "number" ? version : null;
  }
  return null;
}

function isRecognisedEnvelope(parsed: unknown): parsed is ConversationsEnvelope {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as { version: unknown }).version === CONVERSATIONS_SCHEMA_VERSION &&
    Array.isArray((parsed as { conversations: unknown }).conversations)
  );
}

export interface ConversationStore {
  loadConversations(): Conversation[];
  getConversation(id: string): Conversation | null;
  createConversation(input: { profileId: string; title?: string }): Conversation;
  saveConversation(conversation: Conversation): void;
  appendTurn(conversationId: string, turn: Turn): Conversation;
  setSessionId(conversationId: string, sessionId: string): Conversation;
  setProfileId(conversationId: string, profileId: string): Conversation;
  recordProgress(
    conversationId: string,
    pending: PendingGeneration | null
  ): Conversation;
  deleteConversation(id: string): void;
}

export function createConversationStore(
  storage: StoragePort
): ConversationStore {
  // In-memory cache of conversations
  let conversations: Conversation[] = [];
  let loaded = false;

  function ensureLoaded(): void {
    if (loaded) return;

    const stored = storage.get(CONVERSATIONS_STORAGE_KEY);
    if (!stored) {
      conversations = [];
      loaded = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new UnknownStorageVersionError(null, CONVERSATIONS_SCHEMA_VERSION);
    }

    if (!isRecognisedEnvelope(parsed)) {
      throw new UnknownStorageVersionError(
        readEnvelopeVersion(parsed),
        CONVERSATIONS_SCHEMA_VERSION
      );
    }

    // Normalize conversations for backward compatibility
    conversations = parsed.conversations.map((conv: any) => ({
      ...conv,
      pending: conv.pending ? normalizePending(conv.pending) : null,
    }));
    loaded = true;
  }

  function persist(): void {
    const envelope: ConversationsEnvelope = {
      version: CONVERSATIONS_SCHEMA_VERSION,
      conversations,
    };
    storage.set(CONVERSATIONS_STORAGE_KEY, JSON.stringify(envelope));
  }

  function getConversationOrUndefined(id: string): Conversation | undefined {
    ensureLoaded();
    return conversations.find((c) => c.id === id);
  }

  function requireConversation(id: string): Conversation {
    ensureLoaded();
    const found = conversations.find((c) => c.id === id);
    if (!found) throw new Error(`Conversation not found: ${id}`);
    return found;
  }

  function deepCopyConversation(conv: Conversation): Conversation {
    return {
      id: conv.id,
      title: conv.title,
      sessionId: conv.sessionId,
      profileId: conv.profileId,
      turns: conv.turns.map((t) => ({ ...t })),
      pending: conv.pending ? { ...conv.pending } : null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  function normalizePending(pending: any): PendingGeneration {
    return {
      generationId: pending.generationId,
      lastSeq: pending.lastSeq,
      status: pending.status,
      partialText: pending.partialText ?? "",
    };
  }

  return {
    loadConversations(): Conversation[] {
      ensureLoaded();
      // Return copy sorted by updatedAt descending (newest first)
      return conversations
        .map((c) => deepCopyConversation(c))
        .sort((a, b) => {
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
    },

    getConversation(id: string): Conversation | null {
      const found = getConversationOrUndefined(id);
      if (!found) return null;
      return deepCopyConversation(found);
    },

    createConversation(input: { profileId: string; title?: string }): Conversation {
      ensureLoaded();

      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title: input.title ?? "",
        sessionId: null,
        profileId: input.profileId,
        turns: [],
        pending: null,
        createdAt: now,
        updatedAt: now,
      };

      conversations.push(conversation);
      persist();

      return deepCopyConversation(conversation);
    },

    saveConversation(conversation: Conversation): void {
      ensureLoaded();

      const found = requireConversation(conversation.id);

      const now = new Date().toISOString();
      const index = conversations.indexOf(found);
      conversations[index] = {
        ...conversation,
        updatedAt: now,
      };

      persist();
    },

    appendTurn(conversationId: string, turn: Turn): Conversation {
      const found = requireConversation(conversationId);

      const now = new Date().toISOString();
      found.turns.push(turn);
      found.updatedAt = now;

      persist();

      return deepCopyConversation(found);
    },

    setSessionId(conversationId: string, sessionId: string): Conversation {
      const found = requireConversation(conversationId);

      found.sessionId = sessionId;

      persist();

      return deepCopyConversation(found);
    },

    setProfileId(conversationId: string, profileId: string): Conversation {
      const found = requireConversation(conversationId);

      found.profileId = profileId;

      const now = new Date().toISOString();
      found.updatedAt = now;

      persist();

      return deepCopyConversation(found);
    },

    recordProgress(
      conversationId: string,
      pending: PendingGeneration | null
    ): Conversation {
      const found = requireConversation(conversationId);

      found.pending = pending;

      persist();

      return deepCopyConversation(found);
    },

    deleteConversation(id: string): void {
      requireConversation(id);

      const index = conversations.findIndex((c) => c.id === id);
      conversations.splice(index, 1);

      persist();
    },
  };
}
