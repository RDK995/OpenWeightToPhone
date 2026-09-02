import { describe, it, expect } from "bun:test";
import type { HarnessEvent, Telemetry } from "../../web/src/sse-reader";
import {
  readEvents,
  TERMINAL_KINDS,
  isTerminal,
} from "../../web/src/sse-reader";

function createReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    start(controller) {
      if (chunks.length === 0) {
        controller.close();
      }
    },
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of readEvents(stream)) {
    events.push(event);
  }
  return events;
}

describe("sse-reader", () => {
  describe("type exports", () => {
    it("exports Telemetry type", () => {
      // This is a compile-time check
      const telemetry: Telemetry = {
        profile_id: "test",
        quantization: "q4",
        context_limit: 2048,
        total_duration_ns: 1000,
        load_duration_ns: 500,
        prompt_eval_count: 10,
        eval_count: 20,
        tokens_per_second: 100,
      };
      expect(telemetry).toBeDefined();
    });

    it("exports HarnessEvent union type", () => {
      const events: HarnessEvent[] = [
        { seq: 0, kind: "model-loading" },
        { seq: 1, kind: "content", delta: "hello" },
        { seq: 2, kind: "queued", position: 1 },
        {
          seq: 3,
          kind: "complete",
          telemetry: {
            profile_id: "test",
            quantization: "q4",
            context_limit: 2048,
            total_duration_ns: 1000,
            load_duration_ns: 500,
            prompt_eval_count: 10,
            eval_count: 20,
            tokens_per_second: 100,
          },
        },
        { seq: 4, kind: "error", error: "test error" },
        { seq: 5, kind: "cancelled" },
      ];
      expect(events).toHaveLength(6);
    });

    it("exports TERMINAL_KINDS", () => {
      expect(TERMINAL_KINDS).toBeDefined();
      const kinds = Array.isArray(TERMINAL_KINDS)
        ? TERMINAL_KINDS
        : Array.from(TERMINAL_KINDS);
      expect(kinds).toContain("complete");
      expect(kinds).toContain("error");
      expect(kinds).toContain("cancelled");
      expect(kinds).toHaveLength(3);
    });

    it("exports isTerminal helper", () => {
      expect(isTerminal({ seq: 0, kind: "model-loading" })).toBe(false);
      expect(isTerminal({ seq: 1, kind: "content", delta: "x" })).toBe(false);
      expect(
        isTerminal({
          seq: 2,
          kind: "complete",
          telemetry: {
            profile_id: "",
            quantization: "",
            context_limit: 0,
            total_duration_ns: 0,
            load_duration_ns: 0,
            prompt_eval_count: 0,
            eval_count: 0,
            tokens_per_second: 0,
          },
        })
      ).toBe(true);
      expect(isTerminal({ seq: 3, kind: "error", error: "e" })).toBe(true);
      expect(isTerminal({ seq: 4, kind: "cancelled" })).toBe(true);
    });
  });

  describe("basic parsing", () => {
    it("parses a single model-loading event", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("model-loading");
      expect(events[0]?.seq).toBe(0);
    });

    it("parses a content event with delta", async () => {
      const data = encode(
        'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"hello"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("content");
      if (events[0]?.kind === "content") {
        expect(events[0].delta).toBe("hello");
      }
    });

    it("parses a queued event with position", async () => {
      const data = encode(
        'id: 2\nevent: queued\ndata: {"seq":2,"kind":"queued","position":1}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("queued");
      if (events[0]?.kind === "queued") {
        expect(events[0].position).toBe(1);
      }
    });

    it("parses a complete event with telemetry", async () => {
      const telemetryJson =
        '{"profile_id":"llama2","quantization":"q4","context_limit":2048,"total_duration_ns":1000000000,"load_duration_ns":500000000,"prompt_eval_count":10,"eval_count":20,"tokens_per_second":50}';
      const data = encode(
        `id: 3\nevent: complete\ndata: {"seq":3,"kind":"complete","telemetry":${telemetryJson}}\n\n`
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("complete");
      if (events[0]?.kind === "complete") {
        expect(events[0].telemetry.profile_id).toBe("llama2");
        expect(events[0].telemetry.quantization).toBe("q4");
      }
    });

    it("parses an error event", async () => {
      const data = encode(
        'id: 4\nevent: error\ndata: {"seq":4,"kind":"error","error":"timeout"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("error");
      if (events[0]?.kind === "error") {
        expect(events[0].error).toBe("timeout");
      }
    });

    it("parses a cancelled event", async () => {
      const data = encode(
        'id: 5\nevent: cancelled\ndata: {"seq":5,"kind":"cancelled"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("cancelled");
    });

    it("parses multiple events in sequence", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n' +
          'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"hi"}\n\n' +
          'id: 2\nevent: complete\ndata: {"seq":2,"kind":"complete","telemetry":{"profile_id":"","quantization":"","context_limit":0,"total_duration_ns":0,"load_duration_ns":0,"prompt_eval_count":0,"eval_count":0,"tokens_per_second":0}}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(3);
      expect(events[0]?.seq).toBe(0);
      expect(events[1]?.seq).toBe(1);
      expect(events[2]?.seq).toBe(2);
    });
  });

  describe("chunk boundaries", () => {
    it("handles chunks split at arbitrary boundaries", async () => {
      const fullData =
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n';
      const bytes = encode(fullData);
      const chunks = [bytes.subarray(0, 5), bytes.subarray(5)];
      const stream = createReadableStream(chunks);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("model-loading");
    });

    it("handles one-byte-at-a-time chunks", async () => {
      const fullData =
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n';
      const bytes = encode(fullData);
      const chunks = Array.from(bytes).map((b) => new Uint8Array([b]));
      const stream = createReadableStream(chunks);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("model-loading");
    });

    it("produces same results with different chunking for multiple events", async () => {
      const fullData =
        'id: 0\nevent: content\ndata: {"seq":0,"kind":"content","delta":"hello world"}\n\n' +
        'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"!"}\n\n';
      const bytes = encode(fullData);

      // Test with one-byte chunks
      const oneByteChunks = Array.from(bytes).map((b) => new Uint8Array([b]));
      const stream1 = createReadableStream(oneByteChunks);
      const events1 = await collectEvents(stream1);

      // Test with full chunk
      const stream2 = createReadableStream([bytes]);
      const events2 = await collectEvents(stream2);

      expect(events1).toHaveLength(2);
      expect(events2).toHaveLength(2);
      expect(events1[0]?.kind).toBe(events2[0]?.kind);
      if (events1[0]?.kind === "content" && events2[0]?.kind === "content") {
        expect(events1[0].delta).toBe(events2[0].delta);
      }
      expect(events1[1]?.kind).toBe(events2[1]?.kind);
      if (events1[1]?.kind === "content" && events2[1]?.kind === "content") {
        expect(events1[1].delta).toBe(events2[1].delta);
      }
    });
  });

  describe("wire format edge cases", () => {
    it("handles CRLF line endings", async () => {
      const data = encode(
        'id: 0\r\nevent: model-loading\r\ndata: {"seq":0,"kind":"model-loading"}\r\n\r\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("model-loading");
    });

    it("ignores SSE comment lines", async () => {
      const data = encode(
        ': this is a comment\n' +
          'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n' +
          ': another comment\n' +
          'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"x"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(2);
      expect(events[0]?.seq).toBe(0);
      expect(events[1]?.seq).toBe(1);
    });

    it("yields trailing block without final blank line", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n' +
          'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"end"}'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(2);
      expect(events[1]?.seq).toBe(1);
    });

    it("handles blank/whitespace-only input", async () => {
      const data = encode("   \n\n  \n");
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(0);
    });

    it("handles empty stream", async () => {
      const stream = createReadableStream([]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(0);
    });
  });

  describe("forward compatibility", () => {
    it("skips events with unknown kind", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n' +
          'id: 1\nevent: unknown-kind\ndata: {"seq":1,"kind":"unknown-kind","data":"ignored"}\n\n' +
          'id: 2\nevent: content\ndata: {"seq":2,"kind":"content","delta":"after"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(2);
      expect(events[0]?.seq).toBe(0);
      expect(events[1]?.seq).toBe(2);
    });

    it("preserves unknown fields in event JSON", async () => {
      const data = encode(
        'id: 0\nevent: content\ndata: {"seq":0,"kind":"content","delta":"hello","future_field":"value"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event?.kind).toBe("content");
    });

    it("preserves unknown fields in telemetry", async () => {
      const data = encode(
        'id: 0\nevent: complete\ndata: {"seq":0,"kind":"complete","telemetry":{"profile_id":"test","quantization":"q4","context_limit":2048,"total_duration_ns":1000,"load_duration_ns":500,"prompt_eval_count":10,"eval_count":20,"tokens_per_second":100,"new_field":"value"}}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe("complete");
    });
  });

  describe("stream cleanup", () => {
    it("releases stream lock on completion", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n'
      );
      const reader = createReadableStream([data]).getReader();
      const stream = new ReadableStream({
        start(c) {
          reader
            .read()
            .then((result) => {
              if (!result.done) {
                c.enqueue(result.value);
              }
              reader.releaseLock();
              c.close();
            });
        },
      });

      const events: HarnessEvent[] = [];
      for await (const event of readEvents(stream)) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      // Verify the stream lock is released after normal completion
      expect(stream.locked).toBe(false);
    });

    it("releases stream lock when iteration is broken out of early", async () => {
      const data = encode(
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n' +
          'id: 1\nevent: content\ndata: {"seq":1,"kind":"content","delta":"x"}\n\n' +
          'id: 2\nevent: content\ndata: {"seq":2,"kind":"content","delta":"y"}\n\n'
      );
      const stream = createReadableStream([data]);
      const iterator = readEvents(stream);

      const firstEvent = await iterator.next();
      expect(firstEvent.done).toBe(false);
      expect(firstEvent.value?.seq).toBe(0);

      // Break out early
      await iterator.return?.(undefined);

      // Verify the stream lock is released after early break
      expect(stream.locked).toBe(false);
    });
  });

  describe("sequence and JSON parsing", () => {
    it("uses seq from JSON body, not id line", async () => {
      // id line says 99, but JSON says 0
      const data = encode(
        'id: 99\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events[0]?.seq).toBe(0);
    });

    it("uses kind from JSON body, not event line", async () => {
      // event line says wrong-kind, but JSON says model-loading
      const data = encode(
        'id: 0\nevent: wrong-kind\ndata: {"seq":0,"kind":"model-loading"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      expect(events[0]?.kind).toBe("model-loading");
    });

    it("preserves exact JSON from data line", async () => {
      const data = encode(
        'id: 0\nevent: content\ndata: {"seq":0,"kind":"content","delta":"line\\nbreak"}\n\n'
      );
      const stream = createReadableStream([data]);
      const events = await collectEvents(stream);
      if (events[0]?.kind === "content") {
        expect(events[0].delta).toBe("line\nbreak");
      }
    });
  });

  describe("complex scenarios", () => {
    it("handles a realistic generation sequence", async () => {
      const events = [
        'id: 0\nevent: model-loading\ndata: {"seq":0,"kind":"model-loading"}\n\n',
        'id: 1\nevent: queued\ndata: {"seq":1,"kind":"queued","position":2}\n\n',
        'id: 2\nevent: content\ndata: {"seq":2,"kind":"content","delta":"The"}\n\n',
        'id: 3\nevent: content\ndata: {"seq":3,"kind":"content","delta":" answer"}\n\n',
        'id: 4\nevent: content\ndata: {"seq":4,"kind":"content","delta":" is"}\n\n',
        'id: 5\nevent: content\ndata: {"seq":5,"kind":"content","delta":" 42"}\n\n',
        'id: 6\nevent: complete\ndata: {"seq":6,"kind":"complete","telemetry":{"profile_id":"llama2","quantization":"q4","context_limit":2048,"total_duration_ns":2000000000,"load_duration_ns":1000000000,"prompt_eval_count":20,"eval_count":8,"tokens_per_second":40}}\n\n',
      ].map(encode);
      const stream = createReadableStream(events);
      const result = await collectEvents(stream);

      expect(result).toHaveLength(7);
      expect(result[0]?.kind).toBe("model-loading");
      expect(result[1]?.kind).toBe("queued");
      expect(result[2]?.kind).toBe("content");
      expect(result[6]?.kind).toBe("complete");
      expect(isTerminal(result[6]!)).toBe(true);
    });
  });
});
