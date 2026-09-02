// Bundle fragment adoption test: proves the built bundle actually contains
// and executes the fragment-capture code, not just that the function exists
// in the source. This test directly prevents the regression where tree-shaking
// silently dropped the adoption call on the way to the bundle.
import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { Window } from "happy-dom";
import { build } from "../../scripts/build.ts";
import type { RenderTarget } from "../../web/src/ui/render-target";
import type { ApiClient } from "../../web/src/api-client";
import type { LocationPort } from "../../web/src/credential-store";
import { createMemoryStorage } from "../../web/src/storage-port";
import { CREDENTIAL_STORAGE_KEY } from "../../web/src/credential-store";

const distDir = join(import.meta.dir, "..", "..", "web", "dist");

async function importBuiltBundle(): Promise<any> {
  const mainJsPath = join(distDir, "main.js");
  // Cache-busting query so a rebuilt bundle is never served from Bun's
  // module cache -- without this the test could silently pass against a
  // stale bundle from a previous run.
  const moduleUrl = `${pathToFileURL(mainJsPath).href}?v=${Date.now()}-${Math.random()}`;
  return await import(moduleUrl);
}

describe("bundle-fragment", () => {
  let buildResult: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    buildResult = await build();
  });

  it("runs with no document global, so the browser guard in main.ts is genuinely exercised", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("static assertion — the tree-shaking guard", () => {
    // Read the built bundle as text
    const mainJsPath = join(distDir, "main.js");
    expect(existsSync(mainJsPath)).toBe(true);

    const bundleText = readFileSync(mainJsPath, "utf-8");

    // Should be non-empty
    expect(bundleText.length).toBeGreaterThan(0);
    // Should not contain TypeScript interface declarations (already compiled)
    expect(bundleText).not.toContain("interface ");

    // Assert the bundle contains the entry point function (anchor to real structure)
    expect(bundleText).toContain("function bootstrap(");

    // Assert the bundle contains the fragment-capture code at the call site.
    // This is valid because scripts/build.ts sets minify: false, preserving identifiers
    // and argument names. The function definition uses `store` not `credentialStore`,
    // so matching "adoptCredentialFromFragment(credentialStore" targets the call site
    // inside bootstrap, not the function definition or the export list.
    //
    // NOTE: A bare-identifier check (toContain("adoptCredentialFromFragment")) is
    // insufficient because the symbol is exported from main.ts -- it survives
    // tree-shaking whether or not it is called. The wiring to bootstrap() can be
    // removed and the bundle still contains the name. Any build change that minifies
    // identifiers or removes the export must re-establish that this assertion can still
    // fail, or replace it with the behavioural test below rather than leaving a check
    // that cannot fail.
    expect(bundleText).toMatch(/adoptCredentialFromFragment\s*\(\s*credentialStore/);
    expect(bundleText).toContain("URLSearchParams");
    expect(bundleText).toContain("replaceState");
  });

  it("behavioural assertion — the strong one: bootstrap adopts a #t= fragment", async () => {
    const mod = await importBuiltBundle();

    // Create test dependencies
    const storage = createMemoryStorage();
    let hashValue = "#t=bundle-token-xyz";
    let clearHashCalled = false;
    const fakeRoot = {} as HTMLElement;

    const location: LocationPort = {
      get hash(): string {
        return hashValue;
      },
      origin: "https://bundle.example.test",
      clearHash(): void {
        hashValue = "";
        clearHashCalled = true;
      },
    };

    const paints: any[] = [];
    const createTarget = (_root: HTMLElement): RenderTarget => ({
      paint(view) {
        paints.push(view);
      },
    });

    const recordedApiClients: { baseUrl: string; getToken: () => string | null }[] = [];
    const createApiClient = (config: any) => {
      recordedApiClients.push({ baseUrl: config.baseUrl, getToken: config.getToken });
      return {
        listProfiles: async () => [],
        getToken: () => config.getToken(),
      } as unknown as ApiClient;
    };

    // Call the bundle's bootstrap with injected dependencies
    mod.bootstrap(fakeRoot, { storage, location, createTarget, createApiClient });

    // This assertion fails if the adoption call is removed from bootstrap(),
    // and it fails if the bundler drops the code on the way to web/dist/main.js
    // — the failure mode that shipped and was caught only on a physical device.
    const stored = storage.get(CREDENTIAL_STORAGE_KEY);
    expect(stored).not.toBe(null);
    const credential = JSON.parse(stored!);
    expect(credential.token).toBe("bundle-token-xyz");
    expect(credential.baseUrl).toBe("https://bundle.example.test");

    // Hash should be cleared
    expect(clearHashCalled).toBe(true);
    expect(location.hash).toBe("");

    // API client should have received the adopted baseUrl (the ordering proof)
    expect(recordedApiClients.length).toBeGreaterThan(0);
    expect(recordedApiClients[0]!.baseUrl).toBe("https://bundle.example.test");

    // Verify bootstrap and createWindowLocation are functions
    expect(typeof mod.bootstrap).toBe("function");
    expect(typeof mod.createWindowLocation).toBe("function");
  });

  it("negative control: no fragment, no hash clearing, no credential stored", async () => {
    const mod = await importBuiltBundle();

    // Create test dependencies with NO fragment
    const storage = createMemoryStorage();
    let clearHashCalled = false;
    const fakeRoot = {} as HTMLElement;

    const location: LocationPort = {
      hash: "", // No fragment
      origin: "https://bundle.example.test",
      clearHash(): void {
        clearHashCalled = true;
      },
    } as LocationPort;

    const paints: any[] = [];
    const createTarget = (_root: HTMLElement): RenderTarget => ({
      paint(view) {
        paints.push(view);
      },
    });

    const recordedApiClients: { baseUrl: string; getToken: () => string | null }[] = [];
    const createApiClient = (config: any) => {
      recordedApiClients.push({ baseUrl: config.baseUrl, getToken: config.getToken });
      return {
        listProfiles: async () => [],
        getToken: () => config.getToken(),
      } as unknown as ApiClient;
    };

    // Call the bundle's bootstrap with no fragment
    mod.bootstrap(fakeRoot, { storage, location, createTarget, createApiClient });

    // No credential should be written
    const stored = storage.get(CREDENTIAL_STORAGE_KEY);
    expect(stored).toBe(null);

    // clearHash should not be called
    expect(clearHashCalled).toBe(false);

    // API client should have received empty baseUrl
    expect(recordedApiClients.length).toBeGreaterThan(0);
    expect(recordedApiClients[0]!.baseUrl).toBe("");
  });

  it("startApp renders the pairing view when launched with no credential", async () => {
    const mod = await importBuiltBundle();

    // Assert startApp is exported from the bundle
    expect(typeof mod.startApp).toBe("function");

    // Create a real DOM element using happy-dom
    const win = new Window();
    const root = win.document.createElement("div");

    // Create test dependencies
    const storage = createMemoryStorage();

    const location: LocationPort = {
      hash: "", // No fragment
      get origin(): string {
        return "https://test.example";
      },
      clearHash(): void {
        // No-op for this test
      },
    };

    const createApiClient = (config: any) => {
      return {
        listProfiles: async () => [],
        getToken: () => config.getToken(),
      } as unknown as ApiClient;
    };

    // Call startApp with the test dependencies
    mod.startApp(root, { storage, location, createApiClient });

    // Assert the pairing view was rendered into root
    const pairingInput = root.querySelector('[data-testid="pairing-input"]');
    const pairingSubmit = root.querySelector('[data-testid="pairing-submit"]');

    expect(pairingInput).not.toBe(null);
    expect(pairingSubmit).not.toBe(null);

    // Assert the heading text is present
    expect(root.textContent).toContain("Pair this app with your Mac");
  });
});
