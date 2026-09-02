import { readEvents, type HarnessEvent } from "./sse-reader";

// Error code type unions
export type HttpErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "unknown_session"
  | "unknown_profile"
  | "generation_in_flight"
  | "queue_full"
  | "unknown_generation"
  | "seq_not_available"
  | "not_found"
  | "internal_error";

export type StreamErrorCode =
  | "profile_resolution_failed"
  | "inference_failed"
  | "incomplete_stream"
  | "session_unavailable"
  | "generation_timed_out"
  | "stream_write_failed";

// Error code constants
export const HTTP_ERROR_CODES: readonly HttpErrorCode[] = [
  "unauthorized",
  "invalid_request",
  "unknown_session",
  "unknown_profile",
  "generation_in_flight",
  "queue_full",
  "unknown_generation",
  "seq_not_available",
  "not_found",
  "internal_error",
];

export const STREAM_ERROR_CODES: readonly StreamErrorCode[] = [
  "profile_resolution_failed",
  "inference_failed",
  "incomplete_stream",
  "session_unavailable",
  "generation_timed_out",
  "stream_write_failed",
];

// Guidance types
export type GuidanceAction =
  | "re_pair"
  | "retry"
  | "retry_later"
  | "wait_for_current"
  | "choose_profile"
  | "edit_prompt"
  | "report"
  | "none";

export interface ErrorGuidance {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly action: GuidanceAction;
  readonly retryable: boolean;
  readonly documented: boolean;
}

// HTTP error guidance table
export const HTTP_ERROR_GUIDANCE: Readonly<Record<HttpErrorCode, ErrorGuidance>> = {
  unauthorized: {
    code: "unauthorized",
    title: "Pairing needed",
    detail:
      "This device is no longer authorised to reach the harness. Scan the pairing QR code on your Mac again to re-pair.",
    action: "re_pair",
    retryable: false,
    documented: true,
  },
  invalid_request: {
    code: "invalid_request",
    title: "That request was rejected",
    detail: "The harness rejected the request as malformed. Edit the prompt and send it again.",
    action: "edit_prompt",
    retryable: true,
    documented: true,
  },
  unknown_session: {
    code: "unknown_session",
    title: "Conversation session was lost",
    detail:
      "The harness no longer holds this conversation's session. It will be rebuilt and your transcript replayed automatically.",
    action: "none",
    retryable: true,
    documented: true,
  },
  unknown_profile: {
    code: "unknown_profile",
    title: "That model profile is unavailable",
    detail: "The harness does not recognise the selected model profile. Choose a different profile.",
    action: "choose_profile",
    retryable: false,
    documented: true,
  },
  generation_in_flight: {
    code: "generation_in_flight",
    title: "A reply is already in progress",
    detail:
      "This conversation already has a reply being generated. Wait for it to finish, or cancel it, before sending another prompt.",
    action: "wait_for_current",
    retryable: true,
    documented: true,
  },
  queue_full: {
    code: "queue_full",
    title: "The harness is busy",
    detail: "The harness queue is at capacity right now. Wait a few moments and send the prompt again.",
    action: "retry_later",
    retryable: true,
    documented: true,
  },
  unknown_generation: {
    code: "unknown_generation",
    title: "That generation is no longer known",
    detail: "The harness has no record of the generation being resumed or cancelled. Send the prompt again.",
    action: "retry",
    retryable: true,
    documented: true,
  },
  seq_not_available: {
    code: "seq_not_available",
    title: "Cannot resume from that point",
    detail:
      "The harness cannot replay the reply from where this device left off. The conversation will be reconciled from the harness's own record instead.",
    action: "none",
    retryable: false,
    documented: true,
  },
  not_found: {
    code: "not_found",
    title: "That address was not found",
    detail: "The harness did not recognise the address this app requested. The app and the harness may be out of step.",
    action: "report",
    retryable: false,
    documented: true,
  },
  internal_error: {
    code: "internal_error",
    title: "The harness hit an internal error",
    detail:
      "Something failed inside the harness. Send the prompt again; if it keeps happening, check the harness logs on your Mac.",
    action: "retry",
    retryable: true,
    documented: true,
  },
};

// Stream error guidance table
export const STREAM_ERROR_GUIDANCE: Readonly<Record<StreamErrorCode, ErrorGuidance>> = {
  profile_resolution_failed: {
    code: "profile_resolution_failed",
    title: "The model profile could not be loaded",
    detail:
      "The harness could not resolve the selected profile into a running model. Choose a different profile and try again.",
    action: "choose_profile",
    retryable: false,
    documented: true,
  },
  inference_failed: {
    code: "inference_failed",
    title: "The model failed while replying",
    detail: "Generation stopped because the model itself failed. Send the prompt again.",
    action: "retry",
    retryable: true,
    documented: true,
  },
  incomplete_stream: {
    code: "incomplete_stream",
    title: "The reply was cut short",
    detail:
      "The harness stopped sending before the reply was complete. The partial text is kept; send the prompt again for a full answer.",
    action: "retry",
    retryable: true,
    documented: true,
  },
  session_unavailable: {
    code: "session_unavailable",
    title: "The conversation session became unavailable",
    detail: "The harness lost this conversation's session while replying. Send the prompt again to rebuild it.",
    action: "retry",
    retryable: true,
    documented: true,
  },
  generation_timed_out: {
    code: "generation_timed_out",
    title: "The reply took too long",
    detail:
      "The reply passed the harness's 300 second budget and was stopped. Try a shorter prompt or a faster profile.",
    action: "edit_prompt",
    retryable: true,
    documented: true,
  },
  stream_write_failed: {
    code: "stream_write_failed",
    title: "The connection dropped while streaming",
    detail: "The harness could not keep writing the reply to this device. Check the connection and send the prompt again.",
    action: "retry",
    retryable: true,
    documented: true,
  },
};

// Lookup functions for guidance
export function httpErrorGuidance(code: string): ErrorGuidance {
  if (code in HTTP_ERROR_GUIDANCE) {
    return HTTP_ERROR_GUIDANCE[code as HttpErrorCode];
  }
  return {
    code,
    title: "Unexpected harness error",
    detail: `The harness reported an error this app does not recognise: ${code}. Send the prompt again; if it keeps happening, check the harness logs on your Mac.`,
    action: "report",
    retryable: false,
    documented: false,
  };
}

export function streamErrorGuidance(code: string): ErrorGuidance {
  if (code in STREAM_ERROR_GUIDANCE) {
    return STREAM_ERROR_GUIDANCE[code as StreamErrorCode];
  }
  return {
    code,
    title: "Unexpected harness error",
    detail: `The harness reported an error this app does not recognise: ${code}. Send the prompt again; if it keeps happening, check the harness logs on your Mac.`,
    action: "report",
    retryable: false,
    documented: false,
  };
}

export class HarnessApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: unknown;
  readonly guidance: ErrorGuidance;
  readonly generationId: string | null;

  constructor(code: string, status: number, body: unknown, generationId?: string | null) {
    super(`HarnessApiError: ${code}`);
    this.code = code;
    this.status = status;
    this.body = body;
    this.generationId = generationId ?? null;
    this.guidance = httpErrorGuidance(code);
    Object.setPrototypeOf(this, HarnessApiError.prototype);
  }
}

export class HarnessStreamError extends Error {
  readonly code: string;
  readonly generationId: string | null;
  readonly guidance: ErrorGuidance;

  constructor(code: string, generationId?: string | null) {
    super(`HarnessStreamError: ${code}`);
    this.code = code;
    this.generationId = generationId ?? null;
    this.guidance = streamErrorGuidance(code);
    Object.setPrototypeOf(this, HarnessStreamError.prototype);
  }
}

export class HarnessOfflineError extends Error {
  readonly url: string;
  readonly cause: unknown;
  readonly guidance: ErrorGuidance;
  draftPrompt: string | null;

  constructor(url: string, cause: unknown) {
    super("HarnessOfflineError: harness unreachable");
    this.url = url;
    this.cause = cause;
    this.draftPrompt = null;
    this.guidance = {
      code: "offline",
      title: "Cannot reach the harness",
      detail:
        "Your Mac's harness did not answer. Check that it is running and that this device is on the tailnet, then retry — your prompt has been kept.",
      action: "retry",
      retryable: true,
      documented: true,
    };
    Object.setPrototypeOf(this, HarnessOfflineError.prototype);
  }
}

export class EmptyPromptError extends Error {
  readonly guidance: ErrorGuidance;

  constructor() {
    super("EmptyPromptError: prompt is empty");
    this.guidance = {
      code: "empty_prompt",
      title: "Nothing to send",
      detail: "Type a prompt before sending.",
      action: "edit_prompt",
      retryable: false,
      documented: true,
    };
    Object.setPrototypeOf(this, EmptyPromptError.prototype);
  }
}

export interface Profile {
  id: string;
  role: string;
  quality: string;
  latency_class: string;
  label: string;
  [key: string]: unknown;
}

export interface SessionTurn {
  index: number;
  role: string;
  content: string;
  created_at: string;
  cancelled: boolean;
  [key: string]: unknown;
}

export interface SessionGeneration {
  generation_id: string;
  status: string;
  last_seq: number;
  created_at: string;
  [key: string]: unknown;
}

export interface SessionSnapshot {
  session_id: string;
  created_at: string;
  turns: SessionTurn[];
  generations: SessionGeneration[];
  [key: string]: unknown;
}

export interface LoggedRequest {
  method: string;
  url: string;
  at: string;
}

export interface ApiClient {
  listProfiles(): Promise<Profile[]>;
  createSession(): Promise<string>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  generate(
    sessionId: string,
    options: { profileId: string; prompt: string; signal?: AbortSignal }
  ): Promise<{ generationId: string; events: AsyncIterable<HarnessEvent> }>;
  resumeEvents(
    sessionId: string,
    generationId: string,
    lastSeq: number,
    options?: { signal?: AbortSignal }
  ): Promise<{ generationId: string; events: AsyncIterable<HarnessEvent> }>;
  cancel(sessionId: string, generationId: string): Promise<{ status: string }>;
  appendTurn(
    sessionId: string,
    turn: { role: "user" | "assistant"; content: string }
  ): Promise<SessionTurn>;
  getRequestLog(): readonly LoggedRequest[];
  clearRequestLog(): void;
}

interface CreateApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: typeof fetch;
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const { baseUrl, getToken, fetch: customFetch } = options;
  const fetchFn = customFetch || globalThis.fetch;
  const requestLog: LoggedRequest[] = [];

  function logRequest(method: string, url: string): void {
    requestLog.push({
      method,
      url,
      at: new Date().toISOString(),
    });
  }

  function isAbortError(error: unknown, signal?: AbortSignal): boolean {
    // Rule 1: Check if signal is already aborted
    if (signal?.aborted === true) {
      return true;
    }

    // Rules 2 and 3: Check if error has name property equal to "AbortError" or "TimeoutError"
    if (error && typeof error === "object" && "name" in error) {
      const name = (error as Record<string, unknown>).name;
      if (name === "AbortError" || name === "TimeoutError") {
        return true;
      }
    }

    return false;
  }

  async function makeRequest(
    method: string,
    path: string,
    options?: {
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    }
  ): Promise<Response> {
    const token = getToken();
    if (!token) {
      throw new HarnessApiError("unauthorized", 401, null);
    }

    const url = baseUrl + path;
    logRequest(method, url);

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    };

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: options?.body,
        signal: options?.signal,
      });
    } catch (error) {
      if (isAbortError(error, options?.signal)) {
        throw error;
      }
      throw new HarnessOfflineError(url, error);
    }

    return response;
  }

  async function handleResponse(response: Response): Promise<unknown> {
    if (response.ok) {
      return response;
    }

    // Read x-generation-id header defensively before throwing
    let generationId: string | null = null;
    try {
      if (response.headers && typeof response.headers.get === "function") {
        const headerValue = response.headers.get("x-generation-id");
        if (headerValue && headerValue.trim()) {
          generationId = headerValue;
        }
      }
    } catch {
      // If reading the header throws, ignore it and use null
      generationId = null;
    }

    // Try to parse error body
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    // Extract error code
    let code: string;
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      code = body.error;
    } else {
      code = `http_${response.status}`;
    }

    throw new HarnessApiError(code, response.status, body, generationId);
  }

  const client: ApiClient = {
    async listProfiles(): Promise<Profile[]> {
      const response = await makeRequest("GET", "/v1/profiles");
      await handleResponse(response);

      const data = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "profiles" in data &&
        Array.isArray(data.profiles)
      ) {
        return data.profiles as Profile[];
      }

      return [];
    },

    async createSession(): Promise<string> {
      const response = await makeRequest("POST", "/v1/sessions", {
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      await handleResponse(response);

      const data = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "session_id" in data &&
        typeof data.session_id === "string"
      ) {
        return data.session_id;
      }

      throw new HarnessApiError("invalid_response", 200, data);
    },

    async getSession(sessionId: string): Promise<SessionSnapshot> {
      const response = await makeRequest("GET", `/v1/sessions/${sessionId}`);
      await handleResponse(response);

      const data = await response.json();

      if (!data || typeof data !== "object") {
        throw new HarnessApiError("invalid_response", 200, data);
      }

      return data as SessionSnapshot;
    },

    async generate(
      sessionId: string,
      options: { profileId: string; prompt: string; signal?: AbortSignal }
    ): Promise<{ generationId: string; events: AsyncIterable<HarnessEvent> }> {
      // Validate prompt before making request
      if (!options.prompt || !options.prompt.trim()) {
        throw new EmptyPromptError();
      }

      const response = await makeRequest(
        "POST",
        `/v1/sessions/${sessionId}/generate`,
        {
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            profile_id: options.profileId,
            prompt: options.prompt,
          }),
          signal: options.signal,
        }
      );

      await handleResponse(response);

      // Extract generation ID from header
      const generationId = response.headers.get("x-generation-id");
      if (!generationId) {
        throw new HarnessApiError("invalid_response", 200, null);
      }

      // Get response body
      if (!response.body) {
        throw new HarnessApiError("invalid_response", 200, null);
      }

      // Return immediately with events stream
      return {
        generationId,
        events: readEvents(response.body),
      };
    },

    async resumeEvents(
      sessionId: string,
      generationId: string,
      lastSeq: number,
      options?: { signal?: AbortSignal }
    ): Promise<{ generationId: string; events: AsyncIterable<HarnessEvent> }> {
      const response = await makeRequest(
        "GET",
        `/v1/sessions/${sessionId}/generations/${generationId}/events`,
        {
          headers: {
            "last-event-id": String(lastSeq),
          },
          signal: options?.signal,
        }
      );

      await handleResponse(response);

      // Extract generation ID from header, fall back to argument if missing
      const responseGenerationId =
        response.headers.get("x-generation-id") || generationId;

      // Get response body
      if (!response.body) {
        throw new HarnessApiError("invalid_response", 200, null);
      }

      // Return immediately with events stream
      return {
        generationId: responseGenerationId,
        events: readEvents(response.body),
      };
    },

    async cancel(
      sessionId: string,
      generationId: string
    ): Promise<{ status: string }> {
      const response = await makeRequest(
        "POST",
        `/v1/sessions/${sessionId}/generations/${generationId}/cancel`
      );

      await handleResponse(response);

      const data = await response.json();

      if (
        data &&
        typeof data === "object" &&
        "status" in data &&
        typeof data.status === "string"
      ) {
        return { status: data.status };
      }

      throw new HarnessApiError("invalid_response", 200, data);
    },

    async appendTurn(
      sessionId: string,
      turn: { role: "user" | "assistant"; content: string }
    ): Promise<SessionTurn> {
      const response = await makeRequest(
        "POST",
        `/v1/sessions/${sessionId}/turns`,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: turn.role, content: turn.content }),
        }
      );

      await handleResponse(response);

      const data = await response.json();

      if (
        data &&
        typeof data === "object" &&
        "turn" in data &&
        typeof data.turn === "object" &&
        data.turn !== null
      ) {
        return data.turn as SessionTurn;
      }

      throw new HarnessApiError("invalid_response", 201, data);
    },

    getRequestLog(): readonly LoggedRequest[] {
      return [...requestLog];
    },

    clearRequestLog(): void {
      requestLog.length = 0;
    },
  };

  return client;
}
