import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentTypeFor, handleRequest, resolveAssetPath } from "../../src/host/pwa-server.ts";

const SENTINEL = "sentinel-value-do-not-leak-8f3a9c";

let bundleRoot: string;
let outsideRoot: string;
let secretPath: string;

beforeAll(() => {
  bundleRoot = mkdtempSync(join(tmpdir(), "bundle-"));
  outsideRoot = mkdtempSync(join(tmpdir(), "outside-"));
  secretPath = join(outsideRoot, "secret.txt");
  writeFileSync(secretPath, SENTINEL);

  writeFileSync(join(bundleRoot, "index.html"), "<html>home</html>");
  writeFileSync(join(bundleRoot, "main.js"), "console.log('main');");
  mkdirSync(join(bundleRoot, "sub"));
  writeFileSync(join(bundleRoot, "sub", "index.html"), "<html>sub</html>");
  mkdirSync(join(bundleRoot, "appliance"));
  writeFileSync(join(bundleRoot, "appliance", "x"), "not-app-prefixed");
  symlinkSync(secretPath, join(bundleRoot, "evil-link"));
});

afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe("contentTypeFor", () => {
  test("maps known extensions", () => {
    expect(contentTypeFor("a.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("a.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("a.mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("a.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("a.webmanifest")).toBe("application/manifest+json");
    expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.ico")).toBe("image/x-icon");
    expect(contentTypeFor("a.txt")).toBe("text/plain; charset=utf-8");
  });

  test("is case-insensitive on extension", () => {
    expect(contentTypeFor("A.HTML")).toBe("text/html; charset=utf-8");
  });

  test("unknown extension falls back to octet-stream", () => {
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
  });
});

describe("resolveAssetPath containment", () => {
  test("rejects a sibling directory that shares a string prefix with the root", () => {
    expect(resolveAssetPath("/root/x", "/../x-evil/index.html")).toBeNull();
  });
});

describe("handleRequest", () => {
  test("serves index.html for /, /index.html, /app/, and /app/index.html with identical bodies", async () => {
    const paths = ["/", "/index.html", "/app/", "/app/index.html"];
    const bodies: string[] = [];
    for (const path of paths) {
      const res = await handleRequest(req(path), bundleRoot);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe("<html>home</html>");
  });

  test("serves main.js with a javascript content type", async () => {
    const res = await handleRequest(req("/main.js"), bundleRoot);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(await res.text()).toBe("console.log('main');");
  });

  test("serves the nested index.html for /sub/", async () => {
    const res = await handleRequest(req("/sub/"), bundleRoot);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>sub</html>");
  });

  test("sets Cache-Control and X-Content-Type-Options on a 200", async () => {
    const res = await handleRequest(req("/index.html"), bundleRoot);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("HEAD returns the same status and headers with an empty body", async () => {
    const res = await handleRequest(req("/index.html", { method: "HEAD" }), bundleRoot);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toBe("");
  });

  test("/appliance/x is a normal miss target, not the /app prefix", async () => {
    const res = await handleRequest(req("/appliance/x"), bundleRoot);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("not-app-prefixed");
  });

  test("POST returns 405 with an Allow header", async () => {
    const res = await handleRequest(req("/", { method: "POST" }), bundleRoot);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  const traversalPaths = [
    "/../secret.txt",
    "/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/app/../../secret.txt",
    "/subdir/../../secret.txt",
    "/%00",
    "/index.html%00.png",
    "/%zz",
  ];

  for (const path of traversalPaths) {
    test(`refuses ${JSON.stringify(path)} with a 404 that does not leak the sentinel`, async () => {
      const res = await handleRequest(req(path), bundleRoot);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(SENTINEL);
    });
  }

  test("refuses a symlink inside the bundle that points outside it", async () => {
    const res = await handleRequest(req("/evil-link"), bundleRoot);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(SENTINEL);
  });

  test("a refusal 404 body is byte-identical to a plain-miss 404 body", async () => {
    const refusal = await handleRequest(req("/../secret.txt"), bundleRoot);
    const plainMiss = await handleRequest(req("/does-not-exist.html"), bundleRoot);
    expect(refusal.status).toBe(404);
    expect(plainMiss.status).toBe(404);
    expect(await refusal.text()).toBe(await plainMiss.text());
  });
});
