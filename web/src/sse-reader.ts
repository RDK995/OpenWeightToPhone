// Type definitions
export interface Telemetry {
  profile_id: string;
  quantization: string;
  context_limit: number;
  total_duration_ns: number;
  load_duration_ns: number;
  prompt_eval_count: number;
  eval_count: number;
  tokens_per_second: number;
  [key: string]: unknown; // Tolerate unknown fields
}

export type HarnessEvent =
  | { seq: number; kind: "model-loading" }
  | { seq: number; kind: "content"; delta: string }
  | { seq: number; kind: "queued"; position: number }
  | { seq: number; kind: "complete"; telemetry: Telemetry }
  | { seq: number; kind: "error"; error: string }
  | { seq: number; kind: "cancelled" };

export const TERMINAL_KINDS = Object.freeze([
  "complete",
  "error",
  "cancelled",
] as const);

export function isTerminal(event: HarnessEvent): boolean {
  return TERMINAL_KINDS.includes(
    event.kind as unknown as (typeof TERMINAL_KINDS)[number]
  );
}

/**
 * Parses a streaming response body into an ordered async sequence of typed harness events.
 * Handles SSE wire format with support for chunk boundary resilience and forward compatibility.
 */
export async function* readEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<HarnessEvent> {
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer += new TextDecoder().decode(value, { stream: true });
      }

      if (done) {
        // Flush any remaining data
        new TextDecoder().decode(new Uint8Array(), { stream: false });
        if (buffer.trim()) {
          // Process any remaining block
          const events = parseSSEBlock(buffer);
          for (const event of events) {
            yield event;
          }
        }
        break;
      }

      // Process complete blocks in buffer
      // A block ends with two consecutive newlines (or CRLF equivalents)
      const blocks = splitIntoBlocks(buffer);

      // Keep the last incomplete block in the buffer
      buffer = blocks.incomplete;

      // Yield all complete blocks
      for (const block of blocks.complete) {
        const events = parseSSEBlock(block);
        for (const event of events) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface BlocksResult {
  complete: string[];
  incomplete: string;
}

function splitIntoBlocks(text: string): BlocksResult {
  // Normalize line endings to \n
  const normalized = text.replace(/\r\n/g, "\n");

  // Split by double newline (block separator in SSE)
  const parts = normalized.split("\n\n");

  // Last part is potentially incomplete
  const incomplete = parts[parts.length - 1]!;
  const complete = parts.slice(0, -1);

  return {
    complete,
    incomplete,
  };
}

function parseSSEBlock(block: string): HarnessEvent[] {
  const lines = block.split("\n");
  let dataLine: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith(":")) {
      continue;
    }

    // Look for data line
    if (trimmed.startsWith("data:")) {
      dataLine = trimmed.substring(5).trim();
      break; // We only care about the data line
    }
  }

  if (!dataLine) {
    return [];
  }

  try {
    const data = JSON.parse(dataLine);

    // Validate that we have seq and kind from the JSON body
    if (typeof data.seq !== "number" || typeof data.kind !== "string") {
      return [];
    }

    // Filter out unknown event kinds (forward compatibility)
    if (
      !["model-loading", "content", "queued", "complete", "error", "cancelled"].includes(
        data.kind
      )
    ) {
      return [];
    }

    // Build the typed event
    const baseEvent = {
      seq: data.seq,
      kind: data.kind,
    };

    switch (data.kind) {
      case "model-loading": {
        return [{ ...baseEvent, kind: "model-loading" as const }];
      }

      case "content": {
        if (typeof data.delta !== "string") {
          return [];
        }
        return [
          {
            ...baseEvent,
            kind: "content" as const,
            delta: data.delta,
          },
        ];
      }

      case "queued": {
        if (typeof data.position !== "number") {
          return [];
        }
        return [
          {
            ...baseEvent,
            kind: "queued" as const,
            position: data.position,
          },
        ];
      }

      case "complete": {
        if (!data.telemetry || typeof data.telemetry !== "object") {
          return [];
        }
        const telemetry: Telemetry = {
          profile_id: String(data.telemetry.profile_id ?? ""),
          quantization: String(data.telemetry.quantization ?? ""),
          context_limit: Number(data.telemetry.context_limit ?? 0),
          total_duration_ns: Number(data.telemetry.total_duration_ns ?? 0),
          load_duration_ns: Number(data.telemetry.load_duration_ns ?? 0),
          prompt_eval_count: Number(data.telemetry.prompt_eval_count ?? 0),
          eval_count: Number(data.telemetry.eval_count ?? 0),
          tokens_per_second: Number(data.telemetry.tokens_per_second ?? 0),
          ...Object.fromEntries(
            Object.entries(data.telemetry).filter(
              ([key]) =>
                ![
                  "profile_id",
                  "quantization",
                  "context_limit",
                  "total_duration_ns",
                  "load_duration_ns",
                  "prompt_eval_count",
                  "eval_count",
                  "tokens_per_second",
                ].includes(key)
            )
          ),
        };
        return [
          {
            ...baseEvent,
            kind: "complete" as const,
            telemetry,
          },
        ];
      }

      case "error": {
        if (typeof data.error !== "string") {
          return [];
        }
        return [
          {
            ...baseEvent,
            kind: "error" as const,
            error: data.error,
          },
        ];
      }

      case "cancelled": {
        return [{ ...baseEvent, kind: "cancelled" as const }];
      }

      default:
        return [];
    }
  } catch {
    // Invalid JSON, skip this block
    return [];
  }
}
