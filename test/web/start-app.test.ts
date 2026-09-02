// Milestone M12a-ii: the installed home-screen app has its own storage
// container and launches at /app/ with an empty fragment, so it can never see
// a QR-scanned token and has no address bar in which to type one. startApp()
// is the unpaired -> paired -> unauthorized -> unpaired state machine that
// puts an in-app pairing screen in front of the conversation UI.
//
// These tests drive the real DOM (happy-dom, test-only) so the assertions are
// about what a phone would actually show, not about internal calls.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { startApp } from "../../web/src/main";
import { createMemoryStorage } from "../../web/src/storage-port";
import type { StoragePort } from "../../web/src/storage-port";
import {
  createCredentialStore,
  type LocationPort,
} from "../../web/src/credential-store";
import { HarnessApiError } from "../../web/src/api-client";
import type { ApiClient, Profile } from "../../web/src/api-client";

const MAIN_SOURCE_PATH = new URL("../../web/src/main.ts", import.meta.url);
const ORIGIN = "https://mac.example.test";

function createTestWindow() {
  const win = new Window();
  const doc = win.document;
  const root = doc.createElement("div");
  return { win, doc, root };
}

function createLocation(hash = ""): LocationPort {
  let current = hash;
  return {
    get hash(): string {
      return current;
    },
    get origin(): string {
      return ORIGIN;
    },
    clearHash(): void {
      current = "";
    },
  };
}

// A createApiClient whose listProfiles outcome can be flipped between calls,
// so a test can start unauthorized and then recover.
function switchableApiClient(initialError: unknown = null) {
  const state: { error: unknown } = { error: initialError };
  const factory = (_config: unknown): ApiClient =>
    ({
      async listProfiles(): Promise<Profile[]> {
        if (state.error !== null) {
          throw state.error;
        }
        return [];
      },
    }) as unknown as ApiClient;
  return { factory, state };
}

function q(root: any, testid: string): any {
  return root.querySelector(`[data-testid="${testid}"]`);
}

function count(root: any, testid: string): number {
  return root.querySelectorAll(`[data-testid="${testid}"]`).length;
}

function click(win: any, el: any): void {
  el.dispatchEvent(new win.Event("click"));
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Records the data-testid of every node ever handed to root.replaceChildren,
// so a test can assert the pairing view was never painted at all -- not merely
// that it is absent from the final DOM (both views replace root's children, so
// the final DOM alone cannot tell those two cases apart).
function recordPaintedTestIds(root: any): string[] {
  const seen: string[] = [];
  const original = root.replaceChildren.bind(root);
  root.replaceChildren = (...nodes: any[]) => {
    for (const node of nodes) {
      const id =
        node && typeof node.getAttribute === "function"
          ? node.getAttribute("data-testid")
          : null;
      seen.push(id ?? "(none)");
    }
    return original(...nodes);
  };
  return seen;
}

function seedCredential(storage: StoragePort, token: string): void {
  createCredentialStore(storage).setCredential({ baseUrl: ORIGIN, token });
}

describe("startApp", () => {
  it("AC1: no stored credential and no fragment renders the pairing view and nothing else", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    expect(q(root, "pairing-input")).not.toBeNull();
    expect(q(root, "pairing-submit")).not.toBeNull();
    expect(q(root, "prompt-input")).toBeNull();
    expect(q(root, "create-conversation")).toBeNull();
    expect(handle.paired).toBe(false);
    expect(handle.mount).toBeNull();
  });

  it("AC2: a stored credential mounts the conversation UI directly", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-stored");
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
  });

  it("AC3: a #t= fragment is adopted and the pairing view never appears (Safari path not regressed)", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();
    const painted = recordPaintedTestIds(root);

    const handle = startApp(root as any, {
      storage,
      location: createLocation("#t=tok-abc"),
      createApiClient: api.factory,
    });

    expect(painted).not.toContain("pairing");
    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(createCredentialStore(storage).getToken()).toBe("tok-abc");
  });

  it("AC4: submitPairing() pairs from the unpaired state with no reload and no second startApp call", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });
    expect(handle.paired).toBe(false);

    const result = handle.submitPairing(`${ORIGIN}/app/#t=tok-abc`);

    expect(result).toEqual({ ok: true });
    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(createCredentialStore(storage).getCredential()).toEqual({
      baseUrl: ORIGIN,
      token: "tok-abc",
    });
  });

  it("AC4: a real click on [data-testid=pairing-submit] pairs through the DOM", () => {
    const { win, root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    const input = q(root, "pairing-input");
    input.value = `${ORIGIN}/app/#t=tok-xyz`;
    click(win, q(root, "pairing-submit"));

    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(createCredentialStore(storage).getToken()).toBe("tok-xyz");
  });

  it("AC4: a bad paste leaves the app unpaired and shows the run-pair guidance", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    const result = handle.submitPairing("   ");

    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain(
      "bun run pair --show-url"
    );
    expect(handle.paired).toBe(false);
    expect(handle.mount).toBeNull();
    expect(q(root, "pairing")).not.toBeNull();
    expect(createCredentialStore(storage).getCredential()).toBeNull();
  });

  it("AC4: a bare token is paired against the app's own origin, not the token's host", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });
    expect(handle.paired).toBe(false);

    const result = handle.submitPairing("tok-bare-1234");

    expect(result).toEqual({ ok: true });
    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(createCredentialStore(storage).getCredential()).toEqual({
      baseUrl: ORIGIN,
      token: "tok-bare-1234",
    });
  });

  it("AC5: pairing survives a relaunch -- a fresh root over the same storage comes up paired", () => {
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    const first = createTestWindow();
    const firstHandle = startApp(first.root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });
    const input = q(first.root, "pairing-input");
    input.value = `${ORIGIN}/app/#t=tok-abc`;
    click(first.win, q(first.root, "pairing-submit"));
    expect(firstHandle.paired).toBe(true);

    // Relaunch: brand new document and root, same StoragePort instance.
    const second = createTestWindow();
    const painted = recordPaintedTestIds(second.root);
    const secondHandle = startApp(second.root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    expect(secondHandle.paired).toBe(true);
    expect(secondHandle.mount).not.toBeNull();
    expect(painted).not.toContain("pairing");
    expect(q(second.root, "prompt-input")).not.toBeNull();
    expect(q(second.root, "pairing")).toBeNull();
  });

  it("AC6: an unauthorized rejection clears the credential, returns to the pairing view with guidance, and is not a dead end", async () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-stale");
    const api = switchableApiClient(new HarnessApiError("unauthorized", 401, null));

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });
    expect(handle.paired).toBe(true);

    await tick();

    expect(q(root, "pairing")).not.toBeNull();
    expect(handle.paired).toBe(false);
    expect(handle.mount).toBeNull();
    expect(createCredentialStore(storage).getCredential()).toBeNull();

    const message = q(root, "pairing-message").textContent as string;
    expect(message).toContain("Pairing needed");
    expect(message).toContain("unauthorized");

    // Not a dead end: a good token from here pairs again.
    api.state.error = null;
    const result = handle.submitPairing(`${ORIGIN}/app/#t=tok-fresh`);

    expect(result).toEqual({ ok: true });
    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(q(root, "prompt-input")).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();

    await tick();
    expect(handle.paired).toBe(true);
    expect(q(root, "pairing")).toBeNull();
  });

  it("AC7: two full pair -> unauthorized -> pair cycles leave exactly one conversation UI and no orphaned pairing view", async () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-stale");
    const api = switchableApiClient(new HarnessApiError("unauthorized", 401, null));

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    // Cycle 1: unauthorized, then re-pair into another unauthorized.
    await tick();
    expect(handle.paired).toBe(false);
    expect(handle.submitPairing(`${ORIGIN}/app/#t=tok-1`)).toEqual({ ok: true });
    expect(handle.paired).toBe(true);

    // Cycle 2: unauthorized again, then re-pair into a healthy harness.
    await tick();
    expect(handle.paired).toBe(false);
    expect(count(root, "pairing")).toBe(1);
    api.state.error = null;
    expect(handle.submitPairing(`${ORIGIN}/app/#t=tok-2`)).toEqual({ ok: true });
    await tick();

    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(count(root, "pairing")).toBe(0);
    expect(count(root, "pairing-input")).toBe(0);
    expect(count(root, "prompt-input")).toBe(1);
    expect(count(root, "create-conversation")).toBe(1);
    expect(count(root, "notice")).toBe(1);
  });

  it("AC8: a non-unauthorized rejection keeps the app paired and goes to the notice region", async () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-good");
    const api = switchableApiClient(new HarnessApiError("invalid_request", 400, null));

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    await tick();

    expect(handle.paired).toBe(true);
    expect(handle.mount).not.toBeNull();
    expect(q(root, "pairing")).toBeNull();
    expect(q(root, "prompt-input")).not.toBeNull();

    const notice = handle.mount!.getState().notice;
    expect(notice).not.toBeNull();
    expect(notice as string).toContain("invalid_request");

    // The credential must not have been cleared.
    expect(createCredentialStore(storage).getToken()).toBe("tok-good");
  });

  it("AC10: a token paired through the DOM never lands in the rendered markup", () => {
    const { win, root } = createTestWindow();
    const storage = createMemoryStorage();
    const api = switchableApiClient();

    startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
    });

    const input = q(root, "pairing-input");
    input.value = `${ORIGIN}/app/#t=tok-secret-value`;
    click(win, q(root, "pairing-submit"));

    expect(q(root, "prompt-input")).not.toBeNull();
    expect(root.innerHTML).not.toContain("tok-secret-value");
  });

  it("AC10: main.ts never writes the token into the title bar or the URL", () => {
    const source = readFileSync(MAIN_SOURCE_PATH, "utf-8");

    expect(source).not.toMatch(/document\.title\s*=/);
    expect(source).not.toMatch(/location\.hash\s*=/);
    expect(source).not.toMatch(/location\.href\s*=/);
  });

  it("C3 AC1/AC2/AC3/AC6: a synchronous bootstrap() throw during submitPairing falls back to the pairing view, clears the credential, and a relaunch does not retry the throw", () => {
    const storage = createMemoryStorage();
    const api = switchableApiClient();
    const throwingDeps = {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
      createTarget: () => {
        throw new Error("boom");
      },
    };

    const { root } = createTestWindow();
    const handle = startApp(root as any, throwingDeps);
    expect(handle.paired).toBe(false);

    const result = handle.submitPairing(`${ORIGIN}/app/#t=tok-boom`);

    // AC1 + AC6: the throw did not escape submitPairing, and onSubmit reports
    // failure rather than success.
    expect(result.ok).toBe(false);
    const message = (result as { ok: false; message: string }).message;
    expect(message.length).toBeGreaterThan(0);
    expect(handle.paired).toBe(false);
    expect(q(root, "pairing")).not.toBeNull();
    expect(q(root, "pairing-message").textContent).toBe(message);

    // AC2: the credential is cleared, read back through a fresh store over
    // the same storage rather than through a captured object.
    expect(createCredentialStore(storage).getCredential()).toBeNull();

    // AC3: relaunch over the same storage -- even with the same throwing dep
    // still wired up -- comes up unpaired, showing the pairing view, and
    // does not throw. The throwing dep is never reached because there is no
    // longer a credential to pair with.
    const second = createTestWindow();
    const secondHandle = startApp(second.root as any, throwingDeps);
    expect(secondHandle.paired).toBe(false);
    expect(q(second.root, "pairing")).not.toBeNull();
  });

  it("C3 AC4: a pre-seeded credential with a throwing dep still returns normally from startApp, unpaired, showing the pairing view", () => {
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-preexisting");
    const api = switchableApiClient();

    const handle = startApp(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
      createTarget: () => {
        throw new Error("boom");
      },
    });

    expect(handle.paired).toBe(false);
    expect(handle.mount).toBeNull();
    expect(q(root, "pairing")).not.toBeNull();
    expect((q(root, "pairing-message").textContent as string).length).toBeGreaterThan(0);
    expect(createCredentialStore(storage).getCredential()).toBeNull();
  });
});

describe("bootstrap onUnauthorized hook", () => {
  it("calls deps.onUnauthorized instead of setNotice when the rejection carries guidance.code 'unauthorized'", async () => {
    const { bootstrap } = await import("../../web/src/main");
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-stale");
    const api = switchableApiClient(new HarnessApiError("unauthorized", 401, null));

    const seen: unknown[] = [];
    const handle = bootstrap(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
      onUnauthorized(error) {
        seen.push(error);
      },
    });

    await tick();

    expect(seen.length).toBe(1);
    expect(seen[0]).toBeInstanceOf(HarnessApiError);
    expect(handle.getState().notice).toBeNull();
  });

  it("leaves setNotice in charge for a non-unauthorized rejection even when onUnauthorized is supplied", async () => {
    const { bootstrap } = await import("../../web/src/main");
    const { root } = createTestWindow();
    const storage = createMemoryStorage();
    seedCredential(storage, "tok-good");
    const api = switchableApiClient(new HarnessApiError("invalid_request", 400, null));

    const seen: unknown[] = [];
    const handle = bootstrap(root as any, {
      storage,
      location: createLocation(""),
      createApiClient: api.factory,
      onUnauthorized(error) {
        seen.push(error);
      },
    });

    await tick();

    expect(seen.length).toBe(0);
    expect(handle.getState().notice).not.toBeNull();
    expect(handle.getState().notice as string).toContain("invalid_request");
  });
});
