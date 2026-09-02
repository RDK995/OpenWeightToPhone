import { describe, it, expect } from "bun:test";
import {
  CACHE_VERSION,
  CACHE_NAME,
  SHELL_SCOPE,
  shouldHandle,
  handleShellRequest,
  staleCacheNames,
} from "../../web/src/sw";

// Helper to create a Response from a string, working around TypeScript's strict Response types
// @ts-ignore - Bun's Response constructor accepts string bodies at runtime
function createResponse(body: string, options?: ResponseInit): Response {
  return new Response(body, options);
}

describe("Service Worker", () => {
  describe("CACHE_NAME", () => {
    it("contains CACHE_VERSION", () => {
      expect(CACHE_NAME).toContain(CACHE_VERSION);
    });

    it("has expected format", () => {
      expect(CACHE_NAME).toBe(`phone-reasoning-shell-${CACHE_VERSION}`);
    });
  });

  describe("SHELL_SCOPE", () => {
    it("is /app/", () => {
      expect(SHELL_SCOPE).toBe("/app/");
    });
  });

  describe("shouldHandle", () => {
    const scopeOrigin = "https://example.com";

    it("returns true for GET /app/ on same origin", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://example.com/app/",
        },
        scopeOrigin
      );
      expect(result).toBe(true);
    });

    it("returns true for GET /app/index.html on same origin", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://example.com/app/index.html",
        },
        scopeOrigin
      );
      expect(result).toBe(true);
    });

    it("returns false for POST /app/x", () => {
      const result = shouldHandle(
        {
          method: "POST",
          url: "https://example.com/app/x",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for PUT request to /app/", () => {
      const result = shouldHandle(
        {
          method: "PUT",
          url: "https://example.com/app/",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for GET /v1/sessions on same origin", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://example.com/v1/sessions",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for GET /v1/chat on same origin", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://example.com/v1/chat",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for cross-origin GET /app/", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://attacker.com/app/",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for cross-origin GET /v1/ on different domain", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "https://other.com/v1/sessions",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });

    it("returns false for invalid URL", () => {
      const result = shouldHandle(
        {
          method: "GET",
          url: "not a valid url",
        },
        scopeOrigin
      );
      expect(result).toBe(false);
    });
  });

  describe("handleShellRequest", () => {
    it("returns NEW BUILD and caches it when network succeeds, even when the cache holds a stale build", async () => {
      let cacheStoredRequest: Request | null = null;
      let cacheStoredBody: string | null = null;
      // Seed the fake cache with a stale build. A cache-first strategy would
      // return this instead of hitting the network; network-first must not.
      let cachedBody: string | null = "OLD BUILD";

      const request = new Request("https://example.com/app/index.html");
      const deps = {
        fetch: async () => {
          return createResponse("NEW BUILD", { status: 200, statusText: "OK" });
        },
        cacheMatch: async () =>
          cachedBody !== null ? createResponse(cachedBody, { status: 200 }) : undefined,
        cachePut: async (req: Request, res: Response) => {
          cacheStoredRequest = req;
          cacheStoredBody = await res.text();
          cachedBody = cacheStoredBody;
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("NEW BUILD");
      expect(response.ok).toBe(true);
      expect(cacheStoredBody !== null).toBe(true);
      if (cacheStoredBody !== null) {
        expect(cacheStoredBody === "NEW BUILD").toBe(true);
      }
      expect(cacheStoredRequest !== null).toBe(true);
      // The seeded stale entry must have been replaced by the fresh network
      // response, not left in place behind a cache-first read.
      expect(cachedBody).toBe("NEW BUILD");
    });

    it("returns cached response when offline", async () => {
      const request = new Request("https://example.com/app/index.html");
      const cachedResponse = createResponse("OLD BUILD", { status: 200 });

      const deps = {
        fetch: async () => {
          throw new Error("Network error");
        },
        cacheMatch: async () => cachedResponse,
        cachePut: async () => {
          throw new Error("Should not cache when offline");
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("OLD BUILD");
    });

    it("rejects when offline and cache is empty", async () => {
      const request = new Request("https://example.com/app/index.html");
      const networkError = new Error("Network unreachable");

      const deps = {
        fetch: async () => {
          throw networkError;
        },
        cacheMatch: async () => undefined,
        cachePut: async () => {
          throw new Error("Should not cache when offline");
        },
      };

      let thrownError: Error | null = null;
      try {
        await handleShellRequest(request, deps);
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).toBe(networkError);
    });

    it("returns non-ok network response when cache is empty", async () => {
      const request = new Request("https://example.com/app/index.html");
      const errorResponse = createResponse("Server Error", { status: 500 });

      const deps = {
        fetch: async () => errorResponse,
        cacheMatch: async () => undefined,
        cachePut: async () => {
          throw new Error("Should not cache non-ok responses");
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("Server Error");
      expect(response.status).toBe(500);
    });

    it("returns cached response when network returns non-ok and cache has value", async () => {
      const request = new Request("https://example.com/app/index.html");
      const errorResponse = createResponse("Server Error", { status: 500 });
      const cachedResponse = createResponse("OLD BUILD", { status: 200 });

      const deps = {
        fetch: async () => errorResponse,
        cacheMatch: async () => cachedResponse,
        cachePut: async () => {
          throw new Error("Should not cache non-ok responses");
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("OLD BUILD");
    });

    it("returns NEW BUILD even when cachePut rejects with a warm cache", async () => {
      let cachedBody: string | null = "OLD BUILD";

      const request = new Request("https://example.com/app/index.html");
      const deps = {
        fetch: async () => {
          return createResponse("NEW BUILD", { status: 200, statusText: "OK" });
        },
        cacheMatch: async () =>
          cachedBody !== null ? createResponse(cachedBody, { status: 200 }) : undefined,
        cachePut: async (req: Request, res: Response) => {
          // Simulate cache write failure (e.g., QuotaExceededError)
          throw new Error("QuotaExceededError");
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("NEW BUILD");
      expect(response.ok).toBe(true);
    });

    it("resolves with NEW BUILD when cachePut rejects and cache is empty", async () => {
      const request = new Request("https://example.com/app/index.html");
      const deps = {
        fetch: async () => {
          return createResponse("NEW BUILD", { status: 200, statusText: "OK" });
        },
        cacheMatch: async () => undefined,
        cachePut: async (req: Request, res: Response) => {
          // Simulate cache write failure
          throw new Error("QuotaExceededError");
        },
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("NEW BUILD");
      expect(response.ok).toBe(true);
    });

    it("returns NEW BUILD even when cachePut throws synchronously with a warm cache", async () => {
      let cachedBody: string | null = "OLD BUILD";

      const request = new Request("https://example.com/app/index.html");

      // Define a function that throws synchronously
      function throwingCachePut(req: Request, res: Response): any {
        throw new Error("SyncError");
      }

      const deps = {
        fetch: async () => {
          return createResponse("NEW BUILD", { status: 200, statusText: "OK" });
        },
        cacheMatch: async () =>
          cachedBody !== null ? createResponse(cachedBody, { status: 200 }) : undefined,
        cachePut: throwingCachePut as any,
      };

      const response = await handleShellRequest(request, deps);
      const body = await response.text();

      expect(body).toBe("NEW BUILD");
      expect(response.ok).toBe(true);
    });
  });

  describe("staleCacheNames", () => {
    it("excludes CACHE_NAME and includes others", () => {
      const existing = [
        "phone-reasoning-shell-v0",
        CACHE_NAME,
        "other-cache",
      ];
      const result = staleCacheNames(existing);

      expect(result).toEqual([
        "phone-reasoning-shell-v0",
        "other-cache",
      ]);
      expect(result).not.toContain(CACHE_NAME);
    });

    it("returns empty array when only current cache exists", () => {
      const existing = [CACHE_NAME];
      const result = staleCacheNames(existing);

      expect(result).toEqual([]);
    });

    it("handles empty input", () => {
      const result = staleCacheNames([]);
      expect(result).toEqual([]);
    });
  });

  describe("Module guards", () => {
    it("can import sw.ts without throwing in non-browser process", () => {
      // This test simply verifies that the import at the top of this file
      // succeeded without throwing, confirming that environment guards work
      expect(CACHE_NAME).toBeDefined();
      expect(shouldHandle).toBeDefined();
      expect(handleShellRequest).toBeDefined();
      expect(staleCacheNames).toBeDefined();
    });
  });
});
