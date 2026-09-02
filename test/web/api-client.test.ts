import { describe, it, expect, beforeEach } from "bun:test";
import {
  createApiClient,
  HarnessApiError,
  type ApiClient,
  type Profile,
  type SessionSnapshot,
  type SessionTurn,
  type HttpErrorCode,
  type StreamErrorCode,
  type ErrorGuidance,
  HTTP_ERROR_CODES,
  STREAM_ERROR_CODES,
  HTTP_ERROR_GUIDANCE,
  STREAM_ERROR_GUIDANCE,
  httpErrorGuidance,
  streamErrorGuidance,
  HarnessStreamError,
  HarnessOfflineError,
  EmptyPromptError,
} from "../../web/src/api-client";
import { type HarnessEvent } from "../../web/src/sse-reader";

function createReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < encoded.length) {
        controller.enqueue(encoded.slice(index, index + 1));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

async function collectEvents(
  stream: AsyncIterable<HarnessEvent>
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("api-client", () => {
  describe("HarnessApiError", () => {
    it("is an Error subclass with code, status, and body", () => {
      const error = new HarnessApiError("test_code", 400, { foo: "bar" });
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("test_code");
      expect(error.status).toBe(400);
      expect(error.body).toEqual({ foo: "bar" });
      expect(error.message).toBe("HarnessApiError: test_code");
    });
  });

  describe("createApiClient", () => {
    let client: ApiClient;
    let mockFetch: ReturnType<typeof createMockFetch>;
    const baseUrl = "http://localhost:8080";

    beforeEach(() => {
      mockFetch = createMockFetch();
      client = createApiClient({
        baseUrl,
        getToken: () => "test-token-123",
        fetch: mockFetch.fetch as typeof fetch,
      });
    });

    function createMockFetch() {
      const requests: Array<{
        method: string;
        url: string;
        headers: Record<string, string>;
        body?: string;
      }> = [];

      const fetch = async (
        input: string | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init?.method || "GET").toUpperCase();
        const headers = {
          ...(typeof input === "string" ? {} : Object.fromEntries(input.headers)),
          ...(init?.headers
            ? new Headers(init.headers as any) instanceof Headers
              ? Object.fromEntries(new Headers(init.headers as any))
              : (init.headers as any)
            : {}),
        };
        const body = init?.body as string | undefined;

        requests.push({
          method,
          url,
          headers: headers as Record<string, string>,
          body,
        });

        // Find matching response
        const responseSpec = responses.find(
          (spec) =>
            spec.method === method &&
            spec.urlPattern.test(url)
        );

        if (!responseSpec) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }

        return responseSpec.response();
      };

      const responses: Array<{
        method: string;
        urlPattern: RegExp;
        response: () => Response;
      }> = [];

      return {
        fetch,
        requests,
        setResponse: (
          method: string,
          urlPattern: RegExp,
          response: () => Response
        ) => {
          responses.push({ method, urlPattern, response });
        },
      };
    }

    describe("listProfiles", () => {
      it("returns profiles array from GET /v1/profiles", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [
                {
                  id: "profile-1",
                  role: "assistant",
                  quality: "high",
                  latency_class: "fast",
                  label: "Test Profile",
                },
                {
                  id: "profile-2",
                  role: "assistant",
                  quality: "medium",
                  latency_class: "medium",
                  label: "Another Profile",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const profiles = await client.listProfiles();
        expect(profiles).toHaveLength(2);
        expect(profiles[0]?.id).toBe("profile-1");
        expect(profiles[1]?.id).toBe("profile-2");
      });

      it("sends Authorization header", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await client.listProfiles();
        expect(mockFetch.requests[0]?.headers["authorization"]).toBe(
          "Bearer test-token-123"
        );
      });

      it("tolerates extra fields in profiles", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [
                {
                  id: "profile-1",
                  role: "assistant",
                  quality: "high",
                  latency_class: "fast",
                  label: "Test",
                  extra_field: "should be ignored",
                  nested: { data: "also ignored" },
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const profiles = await client.listProfiles();
        expect(profiles).toHaveLength(1);
        expect(profiles[0]?.id).toBe("profile-1");
      });

      it("throws HarnessApiError on 401 unauthorized", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "unauthorized",
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unauthorized");
          expect(error.status).toBe(401);
        }
      });
    });

    describe("createSession", () => {
      it("returns session_id from POST /v1/sessions with 201 status", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const sessionId = await client.createSession();
        expect(sessionId).toBe("sess-123");
      });

      it("sends empty JSON body and Content-Type header", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await client.createSession();
        expect(mockFetch.requests[0]?.body).toBe("{}");
        expect(mockFetch.requests[0]?.headers["content-type"]).toBe(
          "application/json"
        );
      });

      it("also accepts 200 status", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-456",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const sessionId = await client.createSession();
        expect(sessionId).toBe("sess-456");
      });

      it("throws on 400 invalid_request", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "invalid_request",
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.createSession();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("invalid_request");
          expect(error.status).toBe(400);
        }
      });
    });

    describe("getSession", () => {
      it("returns SessionSnapshot from GET /v1/sessions/{sessionId}", async () => {
        mockFetch.setResponse("GET", /\/v1\/sessions\/sess-123$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [
                {
                  index: 0,
                  role: "user",
                  content: "Hello",
                  created_at: "2024-01-01T00:00:01Z",
                  cancelled: false,
                },
              ],
              generations: [
                {
                  generation_id: "gen-1",
                  status: "complete",
                  last_seq: 5,
                  created_at: "2024-01-01T00:00:02Z",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const session = await client.getSession("sess-123");
        expect(session.session_id).toBe("sess-123");
        expect(session.turns).toHaveLength(1);
        expect(session.turns[0]?.role).toBe("user");
        expect(session.generations).toHaveLength(1);
        expect(session.generations[0]?.status).toBe("complete");
      });

      it("tolerates extra fields in session data", async () => {
        mockFetch.setResponse("GET", /\/v1\/sessions\/sess-123$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
              generations: [],
              extra_field: "ignored",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const session = await client.getSession("sess-123");
        expect(session.session_id).toBe("sess-123");
      });

      it("throws on 404 unknown_session", async () => {
        mockFetch.setResponse("GET", /\/v1\/sessions\/invalid$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "unknown_session",
            }),
            {
              status: 404,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.getSession("invalid");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_session");
          expect(error.status).toBe(404);
        }
      });
    });

    describe("generate", () => {
      it("returns generationId and events stream", async () => {
        const eventStream =
          'data: {"seq":0,"kind":"model-loading"}\n\n' +
          'data: {"seq":1,"kind":"content","delta":"Hello"}\n\n' +
          'data: {"seq":2,"kind":"complete","telemetry":{"profile_id":"test","quantization":"q4","context_limit":2048,"total_duration_ns":1000,"load_duration_ns":500,"prompt_eval_count":10,"eval_count":20,"tokens_per_second":100}}\n\n';

        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(createReadableStream(eventStream), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        const result = await client.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Say hello",
        });

        expect(result.generationId).toBe("gen-456");

        const events = await collectEvents(result.events);
        expect(events).toHaveLength(3);
        expect(events[0]?.kind).toBe("model-loading");
        expect(events[1]?.kind).toBe("content");
        expect(events[2]?.kind).toBe("complete");
      });

      it("sends correct request body and headers", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        await client.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Test prompt",
        });

        const request = mockFetch.requests[0]!;
        expect(request.method).toBe("POST");
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.headers["accept"]).toBe("text/event-stream");

        const body = JSON.parse(request.body || "{}");
        expect(body.profile_id).toBe("profile-1");
        expect(body.prompt).toBe("Test prompt");
      });

      it("throws EmptyPromptError before request for empty prompt", async () => {
        const result = await (async () => {
          try {
            await client.generate("sess-123", {
              profileId: "profile-1",
              prompt: "",
            });
          } catch (e) {
            return e;
          }
        })();

        expect(result).toBeInstanceOf(EmptyPromptError);
        // Verify no request was made
        expect(mockFetch.requests).toHaveLength(0);
      });

      it("throws EmptyPromptError before request for whitespace-only prompt", async () => {
        const result = await (async () => {
          try {
            await client.generate("sess-123", {
              profileId: "profile-1",
              prompt: "   \t\n  ",
            });
          } catch (e) {
            return e;
          }
        })();

        expect(result).toBeInstanceOf(EmptyPromptError);
        // Verify no request was made
        expect(mockFetch.requests).toHaveLength(0);
      });

      it("throws if response is not OK", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "generation_in_flight",
              }),
              {
                status: 409,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("generation_in_flight");
          expect(error.status).toBe(409);
        }
      });

      it("throws if x-generation-id header is missing", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            })
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("invalid_response");
        }
      });

      it("throws if response.body is null", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(null, {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("invalid_response");
        }
      });

      it("throws HarnessApiError with code 'unknown_profile' on 400", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "unknown_profile",
              }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-placeholder",
            prompt: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_profile");
          expect(error.status).toBe(400);
          // Assert specifically that the code is NOT the generic http_400 fallback
          expect(error.code).not.toBe("http_400");
        }
      });
    });

    describe("authorization", () => {
      it("uses getToken at call time, not construction time", async () => {
        let token = "token-1";
        const getToken = () => token;
        const testClient = createApiClient({
          baseUrl,
          getToken,
          fetch: mockFetch.fetch as typeof fetch,
        });

        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await testClient.listProfiles();
        expect(mockFetch.requests[0]?.headers["authorization"]).toBe(
          "Bearer token-1"
        );

        // Change token and make another request
        token = "token-2";
        mockFetch.requests.length = 0;

        await testClient.listProfiles();
        expect(mockFetch.requests[0]?.headers["authorization"]).toBe(
          "Bearer token-2"
        );
      });

      it("throws HarnessApiError with code 'unauthorized' if getToken returns null", async () => {
        const testClient = createApiClient({
          baseUrl,
          getToken: () => null,
          fetch: mockFetch.fetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unauthorized");
        }
        // Verify no request was made
        expect(mockFetch.requests).toHaveLength(0);
      });
    });

    describe("request logging", () => {
      it("logs every request with method, url, and timestamp", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const before = new Date();
        await client.listProfiles();
        const after = new Date();

        const log = client.getRequestLog();
        expect(log).toHaveLength(1);
        expect(log[0]?.method).toBe("GET");
        expect(log[0]?.url).toBe(baseUrl + "/v1/profiles");

        const logTime = new Date(log[0]?.at || "");
        expect(logTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(logTime.getTime()).toBeLessThanOrEqual(after.getTime());
      });

      it("logs requests in order", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await client.listProfiles();
        await client.createSession();

        const log = client.getRequestLog();
        expect(log).toHaveLength(2);
        expect(log[0]?.method).toBe("GET");
        expect(log[1]?.method).toBe("POST");
      });

      it("logs failed requests too", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "unauthorized",
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            }
          )
        );

        try {
          await client.listProfiles();
        } catch {
          // Expected
        }

        const log = client.getRequestLog();
        expect(log).toHaveLength(1);
        expect(log[0]?.method).toBe("GET");
      });

      it("clearRequestLog() clears the log", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              profiles: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await client.listProfiles();
        expect(client.getRequestLog()).toHaveLength(1);

        client.clearRequestLog();
        expect(client.getRequestLog()).toHaveLength(0);
      });

      it("contains no /turns entries after createSession + generate + getSession", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            }
          )
        );

        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        mockFetch.setResponse("GET", /\/v1\/sessions\/sess-123$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              session_id: "sess-123",
              created_at: "2024-01-01T00:00:00Z",
              turns: [],
              generations: [],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        await client.createSession();
        await client.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Test",
        });
        await client.getSession("sess-123");

        const log = client.getRequestLog();
        const hasTurns = log.some((req) => req.url.includes("/turns"));
        expect(hasTurns).toBe(false);
      });
    });

    describe("error handling", () => {
      it("falls back to http_<status> code when body is not JSON", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response("Plain text error", {
            status: 500,
            headers: { "content-type": "text/plain" },
          })
        );

        let error: unknown;
        try {
          await client.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("http_500");
          expect(error.status).toBe(500);
        }
      });

      it("falls back to http_<status> code when body has no error field", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(JSON.stringify({ some: "data" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        );

        let error: unknown;
        try {
          await client.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("http_500");
          expect(error.status).toBe(500);
        }
      });

      it("includes response body in error", async () => {
        const errorBody = {
          api_version: "v1",
          error: "queue_full",
          details: "The queue is at capacity",
        };

        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(JSON.stringify(errorBody), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        );

        let error: unknown;
        try {
          await client.createSession();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.body).toEqual(errorBody);
        }
      });
    });

    describe("cancel", () => {
      it("returns status from POST /v1/sessions/{sessionId}/generations/{generationId}/cancel", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                generation_id: "gen-456",
                status: "cancelled",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
        );

        const result = await client.cancel("sess-123", "gen-456");
        expect(result.status).toBe("cancelled");
      });

      it("sends correct request method and URL path", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                generation_id: "gen-456",
                status: "cancelled",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
        );

        await client.cancel("sess-123", "gen-456");

        const request = mockFetch.requests[0]!;
        expect(request.method).toBe("POST");
        expect(request.url).toBe(
          "http://localhost:8080/v1/sessions/sess-123/generations/gen-456/cancel"
        );
      });

      it("sends Authorization header", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                generation_id: "gen-456",
                status: "cancelled",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
        );

        await client.cancel("sess-123", "gen-456");
        expect(mockFetch.requests[0]?.headers["authorization"]).toBe(
          "Bearer test-token-123"
        );
      });

      it("throws HarnessApiError with code 'unknown_generation' on 404", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "unknown_generation",
              }),
              {
                status: 404,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.cancel("sess-123", "gen-456");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_generation");
          expect(error.status).toBe(404);
        }
      });

      it("throws HarnessApiError with code 'unknown_session' on 404", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "unknown_session",
              }),
              {
                status: 404,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.cancel("sess-123", "gen-456");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_session");
          expect(error.status).toBe(404);
        }
      });

      it("call appears in getRequestLog()", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/cancel$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                generation_id: "gen-456",
                status: "cancelled",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
        );

        await client.cancel("sess-123", "gen-456");

        const log = client.getRequestLog();
        expect(log).toHaveLength(1);
        expect(log[0]?.method).toBe("POST");
        expect(log[0]?.url).toContain("/v1/sessions/sess-123/generations/gen-456/cancel");
      });
    });

    describe("appendTurn", () => {
      it("returns SessionTurn from POST /v1/sessions/{sessionId}/turns with 201 status", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                session_id: "sess-123",
                turn: {
                  index: 2,
                  role: "user",
                  content: "Hello assistant",
                  created_at: "2024-01-01T00:00:02Z",
                  cancelled: false,
                },
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              }
            )
        );

        const turn = await client.appendTurn("sess-123", {
          role: "user",
          content: "Hello assistant",
        });

        expect(turn.index).toBe(2);
        expect(turn.role).toBe("user");
        expect(turn.content).toBe("Hello assistant");
        expect(turn.created_at).toBe("2024-01-01T00:00:02Z");
        expect(turn.cancelled).toBe(false);
      });

      it("sends POST request with correct URL, headers, and body", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                session_id: "sess-123",
                turn: {
                  index: 2,
                  role: "assistant",
                  content: "Test response",
                  created_at: "2024-01-01T00:00:02Z",
                  cancelled: false,
                },
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              }
            )
        );

        await client.appendTurn("sess-123", {
          role: "assistant",
          content: "Test response",
        });

        const request = mockFetch.requests[0]!;
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:8080/v1/sessions/sess-123/turns");
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.headers["authorization"]).toBe("Bearer test-token-123");

        const body = JSON.parse(request.body || "{}");
        expect(body.role).toBe("assistant");
        expect(body.content).toBe("Test response");
        expect(Object.keys(body)).toHaveLength(2);
      });

      it("throws HarnessApiError with code 'unknown_session' on 404", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/invalid\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "unknown_session",
              }),
              {
                status: 404,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.appendTurn("invalid", {
            role: "user",
            content: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_session");
          expect(error.status).toBe(404);
        }
      });

      it("throws HarnessApiError with code 'unauthorized' on 401", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "unauthorized",
              }),
              {
                status: 401,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.appendTurn("sess-123", {
            role: "user",
            content: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unauthorized");
          expect(error.status).toBe(401);
        }
      });

      it("throws HarnessApiError with code 'invalid_request' on 400", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "invalid_request",
              }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.appendTurn("sess-123", {
            role: "user",
            content: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("invalid_request");
          expect(error.status).toBe(400);
        }
      });

      it("throws HarnessApiError with code 'invalid_response' when response body lacks turn object", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                session_id: "sess-123",
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.appendTurn("sess-123", {
            role: "user",
            content: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("invalid_response");
        }
      });

      it("logs request to getRequestLog()", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                session_id: "sess-123",
                turn: {
                  index: 2,
                  role: "user",
                  content: "Hello",
                  created_at: "2024-01-01T00:00:02Z",
                  cancelled: false,
                },
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              }
            )
        );

        await client.appendTurn("sess-123", {
          role: "user",
          content: "Hello",
        });

        const log = client.getRequestLog();
        expect(log).toHaveLength(1);
        expect(log[0]?.method).toBe("POST");
        expect(log[0]?.url).toBe("http://localhost:8080/v1/sessions/sess-123/turns");
      });

      it("tolerates extra fields in turn object", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/turns$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                session_id: "sess-123",
                turn: {
                  index: 2,
                  role: "user",
                  content: "Hello",
                  created_at: "2024-01-01T00:00:02Z",
                  cancelled: false,
                  extra_field: "should be ignored",
                  nested: { data: "also ignored" },
                },
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              }
            )
        );

        const turn = await client.appendTurn("sess-123", {
          role: "user",
          content: "Hello",
        });

        expect(turn.index).toBe(2);
        expect(turn.role).toBe("user");
      });
    });

    describe("resumeEvents", () => {
      it("returns generationId and events stream from GET /v1/sessions/{sessionId}/generations/{generationId}/events", async () => {
        const eventStream =
          'data: {"seq":5,"kind":"content","delta":"Hello"}\n\n' +
          'data: {"seq":6,"kind":"complete","telemetry":{"profile_id":"test","quantization":"q4","context_limit":2048,"total_duration_ns":1000,"load_duration_ns":500,"prompt_eval_count":10,"eval_count":20,"tokens_per_second":100}}\n\n';

        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(eventStream), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        const result = await client.resumeEvents("sess-123", "gen-456", 4);

        expect(result.generationId).toBe("gen-456");

        const events = await collectEvents(result.events);
        expect(events).toHaveLength(2);
        expect(events[0]?.seq).toBe(5);
        expect(events[0]?.kind).toBe("content");
        expect(events[1]?.seq).toBe(6);
        expect(events[1]?.kind).toBe("complete");
      });

      it("sends Last-Event-ID header with lastSeq value", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        await client.resumeEvents("sess-123", "gen-456", 42);

        const request = mockFetch.requests[0]!;
        expect(request.method).toBe("GET");
        expect(request.headers["last-event-id"]).toBe("42");
      });

      it("sends Last-Event-ID header as -1 when lastSeq is -1", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        await client.resumeEvents("sess-123", "gen-456", -1);

        const request = mockFetch.requests[0]!;
        expect(request.method).toBe("GET");
        expect(request.headers["last-event-id"]).toBe("-1");
      });

      it("falls back to generationId argument if x-generation-id header is missing", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            })
        );

        const result = await client.resumeEvents("sess-123", "gen-456", 10);
        expect(result.generationId).toBe("gen-456");
      });

      it("throws HarnessApiError on 409 seq_not_available", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(
              JSON.stringify({
                api_version: "v1",
                error: "seq_not_available",
                last_seq: 42,
              }),
              {
                status: 409,
                headers: { "content-type": "application/json" },
              }
            )
        );

        let error: unknown;
        try {
          await client.resumeEvents("sess-123", "gen-456", 100);
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("seq_not_available");
          expect(error.status).toBe(409);
          expect(error.body).toEqual({
            api_version: "v1",
            error: "seq_not_available",
            last_seq: 42,
          });
        }
      });

      it("sends Authorization header", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        await client.resumeEvents("sess-123", "gen-456", 5);
        expect(mockFetch.requests[0]?.headers["authorization"]).toBe(
          "Bearer test-token-123"
        );
      });
    });

    describe("signal support", () => {
      it("generate accepts optional signal in options", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        const controller = new AbortController();
        const result = await client.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Test",
          signal: controller.signal,
        });

        expect(result.generationId).toBe("gen-456");
      });

      it("resumeEvents accepts optional signal in options", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/sessions\/sess-123\/generations\/gen-456\/events$/,
          () =>
            new Response(createReadableStream(""), {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "gen-456",
              },
            })
        );

        const controller = new AbortController();
        const result = await client.resumeEvents("sess-123", "gen-456", 5, {
          signal: controller.signal,
        });

        expect(result.generationId).toBe("gen-456");
      });

      it("generate passes signal to fetch", async () => {
        let capturedSignal: AbortSignal | undefined;

        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          capturedSignal = init?.signal ?? undefined;
          return new Response(createReadableStream(""), {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "x-generation-id": "gen-456",
            },
          });
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        const controller = new AbortController();
        await testClient.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Test",
          signal: controller.signal,
        });

        expect(capturedSignal).toBe(controller.signal);
      });

      it("resumeEvents passes signal to fetch", async () => {
        let capturedSignal: AbortSignal | undefined;

        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          capturedSignal = init?.signal ?? undefined;
          return new Response(createReadableStream(""), {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "x-generation-id": "gen-456",
            },
          });
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        const controller = new AbortController();
        await testClient.resumeEvents("sess-123", "gen-456", 5, {
          signal: controller.signal,
        });

        expect(capturedSignal).toBe(controller.signal);
      });

      it("aborting signal causes fetch to reject with AbortError", async () => {
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          return new Promise((resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }
            // Never resolve unless aborted
          });
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        const controller = new AbortController();
        const promise = testClient.generate("sess-123", {
          profileId: "profile-1",
          prompt: "Test",
          signal: controller.signal,
        });

        controller.abort();

        let error: unknown;
        try {
          await promise;
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(DOMException);
        if (error instanceof DOMException) {
          expect(error.name).toBe("AbortError");
        }
      });
    });

    describe("default fetch", () => {
      it("uses global fetch when not provided", () => {
        const clientWithoutFetch = createApiClient({
          baseUrl,
          getToken: () => "test-token",
        });
        // This is just a type/compilation check - verify it's created
        expect(clientWithoutFetch).toBeDefined();
      });
    });
  });

  describe("Error taxonomy", () => {
    describe("AC2 - HTTP and Stream error codes and guidance tables", () => {
      it("HTTP_ERROR_CODES is an array with all ten documented codes", () => {
        expect(Array.isArray(HTTP_ERROR_CODES)).toBe(true);
        expect(HTTP_ERROR_CODES).toHaveLength(10);
        expect(HTTP_ERROR_CODES).toContain("unauthorized");
        expect(HTTP_ERROR_CODES).toContain("invalid_request");
        expect(HTTP_ERROR_CODES).toContain("unknown_session");
        expect(HTTP_ERROR_CODES).toContain("unknown_profile");
        expect(HTTP_ERROR_CODES).toContain("generation_in_flight");
        expect(HTTP_ERROR_CODES).toContain("queue_full");
        expect(HTTP_ERROR_CODES).toContain("unknown_generation");
        expect(HTTP_ERROR_CODES).toContain("seq_not_available");
        expect(HTTP_ERROR_CODES).toContain("not_found");
        expect(HTTP_ERROR_CODES).toContain("internal_error");
      });

      it("STREAM_ERROR_CODES is an array with all six documented codes", () => {
        expect(Array.isArray(STREAM_ERROR_CODES)).toBe(true);
        expect(STREAM_ERROR_CODES).toHaveLength(6);
        expect(STREAM_ERROR_CODES).toContain("profile_resolution_failed");
        expect(STREAM_ERROR_CODES).toContain("inference_failed");
        expect(STREAM_ERROR_CODES).toContain("incomplete_stream");
        expect(STREAM_ERROR_CODES).toContain("session_unavailable");
        expect(STREAM_ERROR_CODES).toContain("generation_timed_out");
        expect(STREAM_ERROR_CODES).toContain("stream_write_failed");
      });

      it("HTTP_ERROR_GUIDANCE has exactly ten entries, one per HttpErrorCode", () => {
        expect(Object.keys(HTTP_ERROR_GUIDANCE)).toHaveLength(10);
        for (const code of HTTP_ERROR_CODES) {
          expect(HTTP_ERROR_GUIDANCE[code]).toBeDefined();
          expect(HTTP_ERROR_GUIDANCE[code].documented).toBe(true);
          expect(HTTP_ERROR_GUIDANCE[code].code).toBe(code);
        }
      });

      it("STREAM_ERROR_GUIDANCE has exactly six entries, one per StreamErrorCode", () => {
        expect(Object.keys(STREAM_ERROR_GUIDANCE)).toHaveLength(6);
        for (const code of STREAM_ERROR_CODES) {
          expect(STREAM_ERROR_GUIDANCE[code]).toBeDefined();
          expect(STREAM_ERROR_GUIDANCE[code].documented).toBe(true);
          expect(STREAM_ERROR_GUIDANCE[code].code).toBe(code);
        }
      });
    });

    describe("AC3 - Distinctness of titles and details", () => {
      it("all guidance titles are pairwise distinct", () => {
        const allGuidance: ErrorGuidance[] = [];
        for (const code of HTTP_ERROR_CODES) {
          allGuidance.push(HTTP_ERROR_GUIDANCE[code]);
        }
        for (const code of STREAM_ERROR_CODES) {
          allGuidance.push(STREAM_ERROR_GUIDANCE[code]);
        }
        allGuidance.push(new HarnessOfflineError("http://test", new Error()).guidance);
        allGuidance.push(new EmptyPromptError().guidance);

        const titles = allGuidance.map((g) => g.title);
        const uniqueTitles = new Set(titles);
        expect(uniqueTitles.size).toBe(titles.length);
      });

      it("all guidance details are pairwise distinct", () => {
        const allGuidance: ErrorGuidance[] = [];
        for (const code of HTTP_ERROR_CODES) {
          allGuidance.push(HTTP_ERROR_GUIDANCE[code]);
        }
        for (const code of STREAM_ERROR_CODES) {
          allGuidance.push(STREAM_ERROR_GUIDANCE[code]);
        }
        allGuidance.push(new HarnessOfflineError("http://test", new Error()).guidance);
        allGuidance.push(new EmptyPromptError().guidance);

        const details = allGuidance.map((g) => g.detail);
        const uniqueDetails = new Set(details);
        expect(uniqueDetails.size).toBe(details.length);
      });
    });

    describe("AC4 - specific guidance assertions", () => {
      it("unauthorized has action re_pair", () => {
        expect(HTTP_ERROR_GUIDANCE.unauthorized.action).toBe("re_pair");
      });

      it("queue_full has action retry_later with retryable true", () => {
        expect(HTTP_ERROR_GUIDANCE.queue_full.action).toBe("retry_later");
        expect(HTTP_ERROR_GUIDANCE.queue_full.retryable).toBe(true);
      });
    });

    describe("AC5 - unknown error codes", () => {
      it("httpErrorGuidance returns documented false for unknown codes", () => {
        const guidance = httpErrorGuidance("no_such_code");
        expect(guidance.documented).toBe(false);
        expect(guidance.action).toBe("report");
        expect(guidance.detail).toContain("no_such_code");
      });

      it("streamErrorGuidance returns documented false for unknown codes", () => {
        const guidance = streamErrorGuidance("no_such_code");
        expect(guidance.documented).toBe(false);
        expect(guidance.action).toBe("report");
        expect(guidance.detail).toContain("no_such_code");
      });

      it("different unknown codes produce different details", () => {
        const guidance1 = httpErrorGuidance("no_such_code");
        const guidance2 = httpErrorGuidance("other_unknown");
        expect(guidance1.detail).not.toBe(guidance2.detail);
      });

      it("unknown stream codes also produce different details", () => {
        const guidance1 = streamErrorGuidance("unknown_one");
        const guidance2 = streamErrorGuidance("unknown_two");
        expect(guidance1.detail).not.toBe(guidance2.detail);
      });
    });

    describe("AC6 - HTTP error codes mapped to HarnessApiError", () => {
      let client: ApiClient;
      let mockFetch: ReturnType<typeof createMockFetch>;
      const baseUrl = "http://localhost:8080";

      beforeEach(() => {
        mockFetch = createMockFetch();
        client = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: mockFetch.fetch as typeof fetch,
        });
      });

      function createMockFetch() {
        const requests: Array<{
          method: string;
          url: string;
          headers: Record<string, string>;
          body?: string;
        }> = [];

        const fetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          const url = typeof input === "string" ? input : input.url;
          const method = (init?.method || "GET").toUpperCase();
          const headers = {
            ...(typeof input === "string" ? {} : Object.fromEntries(input.headers)),
            ...(init?.headers
              ? new Headers(init.headers as any) instanceof Headers
                ? Object.fromEntries(new Headers(init.headers as any))
                : (init.headers as any)
              : {}),
          };
          const body = init?.body as string | undefined;

          requests.push({
            method,
            url,
            headers: headers as Record<string, string>,
            body,
          });

          const responseSpec = responses.find(
            (spec) =>
              spec.method === method &&
              spec.urlPattern.test(url)
          );

          if (!responseSpec) {
            return new Response(JSON.stringify({ error: "not_found" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }

          return responseSpec.response();
        };

        const responses: Array<{
          method: string;
          urlPattern: RegExp;
          response: () => Response;
        }> = [];

        return {
          fetch,
          requests,
          setResponse: (
            method: string,
            urlPattern: RegExp,
            response: () => Response
          ) => {
            responses.push({ method, urlPattern, response });
          },
        };
      }

      it("unauthorized (401) error maps correctly", async () => {
        mockFetch.setResponse("GET", /\/v1\/profiles$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "unauthorized",
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unauthorized");
          expect(error.status).toBe(401);
          expect(error.guidance).toBeDefined();
          expect(error.guidance.title).toBe("Pairing needed");
          expect(error.guidance.action).toBe("re_pair");
        }
      });

      it("queue_full (503) error maps correctly", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "queue_full",
            }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.createSession();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("queue_full");
          expect(error.status).toBe(503);
          expect(error.guidance).toBeDefined();
          expect(error.guidance.title).toBe("The harness is busy");
          expect(error.guidance.action).toBe("retry_later");
        }
      });

      it("unknown_session (404) error maps correctly", async () => {
        mockFetch.setResponse("GET", /\/v1\/sessions\/invalid$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "unknown_session",
            }),
            {
              status: 404,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.getSession("invalid");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("unknown_session");
          expect(error.status).toBe(404);
          expect(error.guidance).toBeDefined();
          expect(error.guidance.title).toBe("Conversation session was lost");
        }
      });
    });

    describe("AC7 - undocumented internal codes", () => {
      it("invalid_response lands on fallback with documented false", () => {
        const error = new HarnessApiError("invalid_response", 200, null);
        expect(error.guidance.documented).toBe(false);
        expect(error.guidance.action).toBe("report");
      });
    });

    describe("AC8 - EmptyPromptError", () => {
      let client: ApiClient;
      let mockFetch: ReturnType<typeof createMockFetch>;
      const baseUrl = "http://localhost:8080";

      beforeEach(() => {
        mockFetch = createMockFetch();
        client = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: mockFetch.fetch as typeof fetch,
        });
      });

      function createMockFetch() {
        const requests: Array<{
          method: string;
          url: string;
          headers: Record<string, string>;
          body?: string;
        }> = [];

        const fetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          const url = typeof input === "string" ? input : input.url;
          const method = (init?.method || "GET").toUpperCase();
          const headers = {
            ...(typeof input === "string" ? {} : Object.fromEntries(input.headers)),
            ...(init?.headers
              ? new Headers(init.headers as any) instanceof Headers
                ? Object.fromEntries(new Headers(init.headers as any))
                : (init.headers as any)
              : {}),
          };
          const body = init?.body as string | undefined;

          requests.push({
            method,
            url,
            headers: headers as Record<string, string>,
            body,
          });

          const responseSpec = responses.find(
            (spec) =>
              spec.method === method &&
              spec.urlPattern.test(url)
          );

          if (!responseSpec) {
            return new Response(JSON.stringify({ error: "not_found" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }

          return responseSpec.response();
        };

        const responses: Array<{
          method: string;
          urlPattern: RegExp;
          response: () => Response;
        }> = [];

        return {
          fetch,
          requests,
          setResponse: (
            method: string,
            urlPattern: RegExp,
            response: () => Response
          ) => {
            responses.push({ method, urlPattern, response });
          },
        };
      }

      it("empty string prompt throws EmptyPromptError", async () => {
        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(EmptyPromptError);
        expect(mockFetch.requests).toHaveLength(0);
        expect(client.getRequestLog()).toHaveLength(0);
      });

      it("whitespace-only prompt throws EmptyPromptError", async () => {
        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "   \t\n  ",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(EmptyPromptError);
        expect(mockFetch.requests).toHaveLength(0);
        expect(client.getRequestLog()).toHaveLength(0);
      });

      it("EmptyPromptError has correct guidance", () => {
        const error = new EmptyPromptError();
        expect(error.guidance).toBeDefined();
        expect(error.guidance.code).toBe("empty_prompt");
        expect(error.guidance.title).toBe("Nothing to send");
        expect(error.guidance.action).toBe("edit_prompt");
        expect(error.guidance.retryable).toBe(false);
        expect(error.guidance.documented).toBe(true);
      });
    });

    describe("AC9 - HarnessStreamError and HarnessOfflineError", () => {
      it("HarnessStreamError with generation ID", () => {
        const error = new HarnessStreamError("inference_failed", "gen-1");
        expect(error.code).toBe("inference_failed");
        expect(error.generationId).toBe("gen-1");
        expect(error.guidance).toBeDefined();
        expect(error.guidance.code).toBe("inference_failed");
      });

      it("HarnessStreamError without generation ID defaults to null", () => {
        const error = new HarnessStreamError("incomplete_stream");
        expect(error.code).toBe("incomplete_stream");
        expect(error.generationId).toBeNull();
      });

      it("HarnessOfflineError has correct properties", () => {
        const cause = new Error("Connection failed");
        const error = new HarnessOfflineError("http://test:8080", cause);
        expect(error.url).toBe("http://test:8080");
        expect(error.cause).toBe(cause);
        expect(error.guidance).toBeDefined();
        expect(error.guidance.code).toBe("offline");
        expect(error.guidance.title).toBe("Cannot reach the harness");
        expect(error.guidance.action).toBe("retry");
        expect(error.guidance.retryable).toBe(true);
        expect(error.guidance.documented).toBe(true);
      });

      it("HarnessOfflineError.draftPrompt is mutable and starts null", () => {
        const error = new HarnessOfflineError("http://test", new Error());
        expect(error.draftPrompt).toBeNull();
        error.draftPrompt = "test prompt";
        expect(error.draftPrompt).toBe("test prompt");
      });
    });
  });

  describe("offline error detection", () => {
    let client: ApiClient;
    let mockFetch: ReturnType<typeof createMockFetch>;
    const baseUrl = "http://localhost:8080";

    beforeEach(() => {
      mockFetch = createMockFetch();
      client = createApiClient({
        baseUrl,
        getToken: () => "test-token-123",
        fetch: mockFetch.fetch as typeof fetch,
      });
    });

    function createMockFetch() {
      const requests: Array<{
        method: string;
        url: string;
        headers: Record<string, string>;
        body?: string;
      }> = [];

      const fetch = async (
        input: string | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init?.method || "GET").toUpperCase();
        const headers = {
          ...(typeof input === "string" ? {} : Object.fromEntries(input.headers)),
          ...(init?.headers
            ? new Headers(init.headers as any) instanceof Headers
              ? Object.fromEntries(new Headers(init.headers as any))
              : (init.headers as any)
            : {}),
        };
        const body = init?.body as string | undefined;

        requests.push({
          method,
          url,
          headers: headers as Record<string, string>,
          body,
        });

        const responseSpec = responses.find(
          (spec) =>
            spec.method === method &&
            spec.urlPattern.test(url)
        );

        if (!responseSpec) {
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }

        return responseSpec.response();
      };

      const responses: Array<{
        method: string;
        urlPattern: RegExp;
        response: () => Response | Promise<Response>;
      }> = [];

      return {
        fetch,
        requests,
        setResponse: (
          method: string,
          urlPattern: RegExp,
          response: () => Response | Promise<Response>
        ) => {
          responses.push({ method, urlPattern, response });
        },
      };
    }

    describe("AC1 - offline error when fetch rejects", () => {
      it("listProfiles throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("createSession throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.createSession();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("getSession throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.getSession("sess-123");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("generate throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("resumeEvents throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.resumeEvents("sess-123", "gen-456", 5);
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("cancel throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.cancel("sess-123", "gen-456");
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("appendTurn throws HarnessOfflineError on fetch rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.appendTurn("sess-123", {
            role: "user",
            content: "Test",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });
    });

    describe("AC2 - HarnessOfflineError properties", () => {
      it("has url equal to full request URL", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.url).toBe(baseUrl + "/v1/profiles");
        }
      });

      it("has cause equal to original rejection", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.cause).toBe(testError);
        }
      });

      it("has draftPrompt equal to null", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.draftPrompt).toBeNull();
        }
      });
    });

    describe("AC3 - HarnessOfflineError guidance", () => {
      it("has guidance with action retry", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.guidance.action).toBe("retry");
        }
      });

      it("has guidance with retryable true", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.guidance.retryable).toBe(true);
        }
      });

      it("has guidance with code offline", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessOfflineError) {
          expect(error.guidance.code).toBe("offline");
        }
      });
    });

    describe("AC4 - AbortError propagates unchanged", () => {
      it("AbortError name propagates unchanged", async () => {
        const abortError = new DOMException("Aborted", "AbortError");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw abortError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBe(abortError);
        expect(error).not.toBeInstanceOf(HarnessOfflineError);
      });
    });

    describe("AC5 - already-aborted signal propagates unchanged", () => {
      it("pre-aborted signal propagates unchanged", async () => {
        const typeError = new TypeError("Failed to fetch");
        const controller = new AbortController();
        controller.abort();

        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw typeError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test",
            signal: controller.signal,
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBe(typeError);
        expect(error).not.toBeInstanceOf(HarnessOfflineError);
      });
    });

    describe("AC6 - TimeoutError propagates unchanged", () => {
      it("TimeoutError name propagates unchanged", async () => {
        const timeoutError = new DOMException("Timeout", "TimeoutError");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw timeoutError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBe(timeoutError);
        expect(error).not.toBeInstanceOf(HarnessOfflineError);
      });
    });

    describe("AC7 - isAbortError robustness", () => {
      it("null error becomes HarnessOfflineError", async () => {
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw null;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("undefined error becomes HarnessOfflineError", async () => {
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw undefined;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("string error becomes HarnessOfflineError", async () => {
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw "error message";
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });

      it("number error becomes HarnessOfflineError", async () => {
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw 42;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessOfflineError);
      });
    });

    describe("AC8 - HTTP errors still throw HarnessApiError", () => {
      it("503 queue_full still throws HarnessApiError not HarnessOfflineError", async () => {
        mockFetch.setResponse("POST", /\/v1\/sessions$/, () =>
          new Response(
            JSON.stringify({
              api_version: "v1",
              error: "queue_full",
            }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            }
          )
        );

        let error: unknown;
        try {
          await client.createSession();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        expect(error).not.toBeInstanceOf(HarnessOfflineError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("queue_full");
        }
      });
    });

    describe("AC9 - offline attempts logged", () => {
      it("offline attempt appears in getRequestLog", async () => {
        const testError = new TypeError("Failed to fetch");
        const customFetch = async (
          input: string | Request,
          init?: RequestInit
        ): Promise<Response> => {
          throw testError;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as typeof fetch,
        });

        try {
          await testClient.listProfiles();
        } catch {
          // Expected
        }

        const log = testClient.getRequestLog();
        expect(log).toHaveLength(1);
        expect(log[0]?.method).toBe("GET");
        expect(log[0]?.url).toBe(baseUrl + "/v1/profiles");
      });
    });

    describe("HarnessApiError carries x-generation-id (M16-T1)", () => {
      it("AC1: A non-ok response with x-generation-id header produces HarnessApiError with .generationId set", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(null, {
              status: 502,
              headers: {
                "content-type": "application/json",
                "x-generation-id": "gen-abc",
              },
            })
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test prompt",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.generationId).toBe("gen-abc");
        }
      });

      it("AC2: A non-ok response with no x-generation-id header produces HarnessApiError with .generationId === null", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(null, {
              status: 502,
              headers: {
                "content-type": "application/json",
              },
            })
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test prompt",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.generationId).toBe(null);
        }
      });

      it("AC3: new HarnessApiError(code, status, body) 3-argument form works and yields .generationId === null", () => {
        const error = new HarnessApiError("http_500", 500, null);
        expect(error.generationId).toBe(null);
      });

      it("AC4: Response double with undefined headers still produces HarnessApiError with generationId === null", async () => {
        const customFetch = async (): Promise<Response> => {
          const response = new Response(null, { status: 502 });
          // Remove the headers property to test defensive handling
          Object.defineProperty(response, "headers", { value: undefined });
          return response;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as unknown as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test prompt",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.generationId).toBe(null);
          expect(error.code).toBe("http_502");
        }
      });

      it("AC4b: Response double with headers.get that throws still produces HarnessApiError with generationId === null", async () => {
        const customFetch = async (): Promise<Response> => {
          const response = new Response(null, { status: 502 });
          // Override headers.get to throw
          const originalGet = response.headers.get.bind(response.headers);
          response.headers.get = () => {
            throw new Error("Simulated headers.get failure");
          };
          return response;
        };

        const testClient = createApiClient({
          baseUrl,
          getToken: () => "test-token-123",
          fetch: customFetch as unknown as typeof fetch,
        });

        let error: unknown;
        try {
          await testClient.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test prompt",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.generationId).toBe(null);
          expect(error.code).toBe("http_502");
        }
      });

      it("AC5: The error code is unchanged - 502 yields http_502", async () => {
        mockFetch.setResponse(
          "POST",
          /\/v1\/sessions\/sess-123\/generate$/,
          () =>
            new Response(null, {
              status: 502,
              headers: {
                "content-type": "application/json",
                "x-generation-id": "gen-abc",
              },
            })
        );

        let error: unknown;
        try {
          await client.generate("sess-123", {
            profileId: "profile-1",
            prompt: "Test prompt",
          });
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("http_502");
        }
      });

      it("AC5b: The error code is unchanged - 500 with no usable error body yields http_500", async () => {
        mockFetch.setResponse(
          "GET",
          /\/v1\/profiles$/,
          () =>
            new Response("Plain text error", {
              status: 500,
              headers: {
                "content-type": "text/plain",
                "x-generation-id": "gen-xyz",
              },
            })
        );

        let error: unknown;
        try {
          await client.listProfiles();
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(HarnessApiError);
        if (error instanceof HarnessApiError) {
          expect(error.code).toBe("http_500");
          // This confirms generation id is carried even on non-generate endpoints
          expect(error.generationId).toBe("gen-xyz");
        }
      });
    });
  });
});
