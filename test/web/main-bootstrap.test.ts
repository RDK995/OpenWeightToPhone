import { describe, it, expect } from "bun:test";
import { bootstrap } from "../../web/src/main";
import { createMemoryStorage } from "../../web/src/storage-port";
import type { LocationPort } from "../../web/src/credential-store";
import type { RenderTarget } from "../../web/src/ui/render-target";
import { HarnessApiError } from "../../web/src/api-client";
import type { ApiClient } from "../../web/src/api-client";
import type { ConversationStore } from "../../web/src/conversation-store";

describe("bootstrap with dependency injection", () => {
  it("runs with no window or document global", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");

    const storage = createMemoryStorage();
    const clearHashCalls: number[] = [];
    const location: LocationPort = {
      hash: "",
      origin: "https://example.test",
      clearHash() {
        clearHashCalls.push(1);
      },
    };

    const paints: any[] = [];
    const target: RenderTarget = {
      paint(view) {
        paints.push(view);
      },
    };

    const createApiClientCalls: any[] = [];
    const createApiClient = (config: any) => {
      createApiClientCalls.push(config);
      return {} as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    expect(() => {
      bootstrap({} as HTMLElement, {
        storage,
        location,
        createTarget,
        createApiClient,
      });
    }).not.toThrow();
  });

  it("adoption happens before API client construction", () => {
    // This is the assertion that fails if the call is removed from bootstrap()
    const storage = createMemoryStorage();
    let hashCleared = false;
    const location: LocationPort = {
      hash: "#t=tok-abc",
      origin: "https://example.test",
      clearHash() {
        hashCleared = true;
      },
    };

    const paints: any[] = [];
    const target: RenderTarget = {
      paint(view) {
        paints.push(view);
      },
    };

    const createApiClientCalls: { baseUrl: string }[] = [];
    const createApiClient = (config: any) => {
      createApiClientCalls.push({ baseUrl: config.baseUrl });
      return { getToken: () => config.getToken() } as unknown as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    // Storage should have the adopted credential
    const stored = storage.get("phone-to-local-model:v1:credential");
    expect(stored).not.toBe(null);
    const credential = JSON.parse(stored!);
    expect(credential.token).toBe("tok-abc");
    expect(credential.baseUrl).toBe("https://example.test");

    // Hash should be cleared
    expect(hashCleared).toBe(true);

    // API client should have received the adopted baseUrl, not empty string
    expect(createApiClientCalls.length).toBeGreaterThan(0);
    expect(createApiClientCalls[0]!.baseUrl).toBe("https://example.test");
  });

  it("hash is cleared after adoption", () => {
    const storage = createMemoryStorage();
    let clearHashCalled = false;
    const location: LocationPort = {
      hash: "#t=tok-abc",
      origin: "https://example.test",
      clearHash() {
        clearHashCalled = true;
      },
    };

    const target: RenderTarget = {
      paint() {},
    };

    const createApiClient = () => ({} as ApiClient);
    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(clearHashCalled).toBe(true);
  });

  it("API client baseUrl comes from adopted credential, not empty", () => {
    // This assertion fails if adoption is moved after the client is constructed
    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "#t=tok-abc",
      origin: "https://example.test",
      clearHash() {},
    };

    const target: RenderTarget = {
      paint() {},
    };

    let receivedBaseUrl = "";
    const createApiClient = (config: any) => {
      receivedBaseUrl = config.baseUrl;
      return { getToken: () => config.getToken() } as unknown as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(receivedBaseUrl).toBe("https://example.test");
  });

  it("API client getToken returns the adopted token", () => {
    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "#t=tok-abc",
      origin: "https://example.test",
      clearHash() {},
    };

    const target: RenderTarget = {
      paint() {},
    };

    let receivedGetToken: (() => string | null) | null = null;
    const createApiClient = (config: any) => {
      receivedGetToken = config.getToken;
      return {} as unknown as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(receivedGetToken).not.toBe(null);
    expect(receivedGetToken!()).toBe("tok-abc");
  });

  it("fragment with multiple parameters like a=1&t=tok parses correctly", () => {
    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "#a=1&t=tok-multi",
      origin: "https://example.test",
      clearHash() {},
    };

    const target: RenderTarget = {
      paint() {},
    };

    const calls: { token: string | null }[] = [];
    const createApiClient = (config: any) => {
      const token = config.getToken();
      calls.push({ token });
      return {} as unknown as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.token).toBe("tok-multi");
  });

  it("no fragment, no stored credential: does not throw, paints, has empty baseUrl", () => {
    const storage = createMemoryStorage();
    let clearHashCalled = false;
    const location: LocationPort = {
      hash: "",
      origin: "https://example.test",
      clearHash() {
        clearHashCalled = true;
      },
    };

    const paints: any[] = [];
    const target: RenderTarget = {
      paint(view) {
        paints.push(view);
      },
    };

    let apiClientBaseUrl = "NOTSET";
    const createApiClient = (config: any) => {
      apiClientBaseUrl = config.baseUrl;
      return {} as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    expect(() => {
      bootstrap({} as HTMLElement, {
        storage,
        location,
        createTarget,
        createApiClient,
      });
    }).not.toThrow();

    expect(paints.length).toBeGreaterThanOrEqual(1);
    expect(apiClientBaseUrl).toBe("");
    expect(clearHashCalled).toBe(false);
    expect(storage.get("phone-to-local-model:v1:credential")).toBe(null);
  });

  it("no fragment, credential already stored: stored credential survives", () => {
    const storage = createMemoryStorage();
    storage.set(
      "phone-to-local-model:v1:credential",
      JSON.stringify({
        baseUrl: "https://stored.example.com",
        token: "stored-token",
      })
    );

    const location: LocationPort = {
      hash: "",
      origin: "https://example.test",
      clearHash() {},
    };

    const target: RenderTarget = {
      paint() {},
    };

    let apiClientBaseUrl = "";
    const createApiClient = (config: any) => {
      apiClientBaseUrl = config.baseUrl;
      return {} as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(apiClientBaseUrl).toBe("https://stored.example.com");
  });

  it("fragment overrides stored credential and hash is cleared", () => {
    const storage = createMemoryStorage();
    storage.set(
      "phone-to-local-model:v1:credential",
      JSON.stringify({
        baseUrl: "https://old.example.com",
        token: "old-token",
      })
    );

    let hashCleared = false;
    const location: LocationPort = {
      hash: "#t=new-token",
      origin: "https://new.example.com",
      clearHash() {
        hashCleared = true;
      },
    };

    const target: RenderTarget = {
      paint() {},
    };

    let apiClientBaseUrl = "";
    const createApiClient = (config: any) => {
      apiClientBaseUrl = config.baseUrl;
      return {} as ApiClient;
    };

    const createTarget = (_root: HTMLElement) => target;

    bootstrap({} as HTMLElement, {
      storage,
      location,
      createTarget,
      createApiClient,
    });

    expect(apiClientBaseUrl).toBe("https://new.example.com");
    expect(hashCleared).toBe(true);
  });

  it("a listProfiles() rejection during bootstrap puts a message in the notice region, mounts and returns a handle, and does not throw; unauthorized explicitly prompts re-pairing (BLOCKER 2, M12-C1T2)", async () => {
    const storage = createMemoryStorage();
    const location: LocationPort = {
      hash: "",
      origin: "https://example.test",
      clearHash() {},
    };

    const paints: any[] = [];
    const target: RenderTarget = {
      paint(view) {
        paints.push(view);
      },
    };

    const createApiClient = (_config: any) =>
      ({
        listProfiles: async () => {
          throw new HarnessApiError("unauthorized", 401, null);
        },
      }) as unknown as ApiClient;

    const createTarget = (_root: HTMLElement) => target;

    let handle: ReturnType<typeof bootstrap> | undefined;
    expect(() => {
      handle = bootstrap({} as HTMLElement, {
        storage,
        location,
        createTarget,
        createApiClient,
      });
    }).not.toThrow();

    expect(handle).toBeDefined();
    expect(typeof handle!.getState).toBe("function");

    // The listProfiles() rejection is caught asynchronously; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const notice = handle!.getState().notice;
    expect(notice).not.toBeNull();
    expect(notice as string).toContain("unauthorized");
    expect((notice as string).toLowerCase()).toContain("pair");
    expect((notice as string).toLowerCase()).toContain("scan");
  });
});
