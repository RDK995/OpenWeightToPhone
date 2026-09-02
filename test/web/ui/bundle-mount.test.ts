// Milestone M9 acceptance criterion 4: the bundle the asset server serves
// actually builds and mounts against injected state. This test process has
// no `document` global at all (asserted below), so importing the built
// artefact here for real is what proves main.ts's `typeof document`
// browser guard is exercised rather than assumed.
//
// src/host/pwa-server.ts's createPwaServer() defaults bundleRoot to
// resolveBundleRoot() (src/host/config.ts), which -- absent
// PHONE_PWA_BUNDLE_ROOT -- resolves to `<repoRoot>/web/dist`. That is
// exactly where scripts/build.ts's build() writes index.html and main.js
// (dist = resolve(root, "web", "dist")). So web/dist is the bundle root
// the asset server serves, confirmed by reading both files rather than
// assumed.
import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { build } from "../../../scripts/build.ts";
import type { RenderTarget } from "../../../web/src/ui/render-target";
import type { SessionCoordinator } from "../../../web/src/session-coordinator";
import type { ConversationStore, Conversation } from "../../../web/src/conversation-store";
import type { ViewModel } from "../../../web/src/ui/view-model";

const distDir = join(import.meta.dir, "..", "..", "..", "web", "dist");

async function importBuiltBundle(): Promise<any> {
  const mainJsPath = join(distDir, "main.js");
  // Cache-busting query so a rebuilt bundle is never served from Bun's
  // module cache -- without this the test could silently pass against a
  // stale bundle from a previous run.
  const moduleUrl = `${pathToFileURL(mainJsPath).href}?v=${Date.now()}-${Math.random()}`;
  return await import(moduleUrl);
}

function createFakeCoordinator(): SessionCoordinator {
  return {
    async createConversation(input) {
      throw new Error("not implemented");
    },
    async send() {
      throw new Error("not implemented");
    },
    async cancel() {
      throw new Error("not implemented");
    },
    async resumeIfInterrupted() {
      throw new Error("not implemented");
    },
    async listProfiles() {
      return [];
    },
    async setProfile() {
      throw new Error("not implemented");
    },
  };
}

function makeFixtureConversations(): Conversation[] {
  return [
    {
      id: "fixture-conv-older",
      title: "Older conversation",
      sessionId: null,
      profileId: "fixture-profile-a",
      turns: [],
      pending: null,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    },
    {
      id: "fixture-conv-newer",
      title: "Newer conversation",
      sessionId: null,
      profileId: "fixture-profile-b",
      turns: [],
      pending: null,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ];
}

describe("bundle-mount", () => {
  let buildResult: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    buildResult = await build();
  });

  it("build() resolves without throwing and its files include index.html and main.js", () => {
    expect(buildResult.files).toContain("index.html");
    expect(buildResult.files).toContain("main.js");
  });

  it("writes index.html and main.js to web/dist, the directory pwa-server.ts serves", () => {
    expect(existsSync(join(distDir, "index.html"))).toBe(true);
    expect(existsSync(join(distDir, "main.js"))).toBe(true);
  });

  it("runs with no document global, so the browser guard in main.ts is genuinely exercised", () => {
    expect(typeof document).toBe("undefined");
  });

  it("dynamically imports the built main.js without throwing and exposes mount()", async () => {
    const mod = await importBuiltBundle();
    expect(typeof mod.mount).toBe("function");
  });

  it("mounts against injected state and paints a real view model reflecting the fixtures", async () => {
    const mod = await importBuiltBundle();

    const paints: ViewModel[] = [];
    const target: RenderTarget = {
      paint(view: ViewModel) {
        paints.push(view);
      },
    };

    const coordinator = createFakeCoordinator();

    const fixtureConversations = makeFixtureConversations();
    const store: ConversationStore = {
      loadConversations: () => fixtureConversations,
      getConversation: () => null,
      createConversation: () => {
        throw new Error("not implemented");
      },
      saveConversation: () => {
        throw new Error("not implemented");
      },
      appendTurn: () => {
        throw new Error("not implemented");
      },
      setSessionId: () => {
        throw new Error("not implemented");
      },
      setProfileId: () => {
        throw new Error("not implemented");
      },
      recordProgress: () => {
        throw new Error("not implemented");
      },
      deleteConversation: () => {
        throw new Error("not implemented");
      },
    };

    let handle: unknown;
    expect(() => {
      handle = mod.mount({ target, coordinator, store });
    }).not.toThrow();
    expect(handle).toBeDefined();

    expect(paints.length).toBeGreaterThanOrEqual(1);
    const painted = paints[0];
    expect(painted).toBeDefined();
    if (!painted) {
      throw new Error("expected at least one paint call");
    }

    expect(Array.isArray(painted.conversations)).toBe(true);
    expect(Array.isArray(painted.transcript)).toBe(true);
    expect(Array.isArray(painted.profiles)).toBe(true);
    expect(painted.generation).toBeDefined();

    // Newest first: fixture-conv-newer has the later updatedAt.
    expect(painted.conversations.map((c) => c.id)).toEqual([
      "fixture-conv-newer",
      "fixture-conv-older",
    ]);
  });
});
