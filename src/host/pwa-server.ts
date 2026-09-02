// C4 — PWA Asset Server.
// Serves the built PWA bundle over loopback for Tailscale Serve to publish at
// APP_MOUNT_PATH. Containment (resolveAssetPath) is the security boundary: the
// filesystem is the disclosure surface, and tailnet membership is the only
// authentication in front of this server, so a containment bug here discloses
// arbitrary files from the host to every device on the tailnet.

import { realpathSync, statSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import { extname, join as pathJoin, resolve as pathResolve, sep } from "node:path";
import { APP_MOUNT_PATH, resolveBundleRoot, resolvePwaPort } from "./config.ts";

const NOT_FOUND_BODY = "Not Found";
const METHOD_NOT_ALLOWED_BODY = "Method Not Allowed";

/** Strips a leading APP_MOUNT_PATH segment. Only matches a whole path segment. */
function stripMountPrefix(decodedPath: string): string {
  if (decodedPath === APP_MOUNT_PATH) return "";
  if (decodedPath.startsWith(APP_MOUNT_PATH + "/")) {
    return decodedPath.slice(APP_MOUNT_PATH.length);
  }
  return decodedPath;
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

/**
 * Pure, synchronous containment check. Returns an absolute path that is
 * provably inside `bundleRoot`, or `null` to mean "refuse". This is the
 * security boundary for the whole server: no other function may serve a file
 * without first passing through this one.
 */
export function resolveAssetPath(bundleRoot: string, requestPath: string): string | null {
  // NUL check before decoding.
  if (requestPath.includes("\0")) return null;

  // 1. Strip a query string or fragment if present.
  const withoutQuery = requestPath.split(/[?#]/, 1)[0] ?? "";

  // 2. Decode, then re-check for NUL on the decoded value. Containment must
  // be evaluated after decoding — decoding is what turns %2e%2e%2f into ../.
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  // 3. Strip the /app mount prefix, as a whole path segment only.
  let relativePath = stripMountPrefix(decoded);

  // 4. Trailing slash (or empty after stripping) maps to index.html.
  if (relativePath === "" || relativePath.endsWith("/")) {
    relativePath = relativePath + "index.html";
  }

  const resolvedRoot = pathResolve(bundleRoot);
  let target = pathResolve(pathJoin(resolvedRoot, relativePath));

  // Non-real-path containment check: resolved target must be the root itself
  // or a descendant of it. A prefix-string comparison alone is not enough —
  // require the boundary to fall on a path separator.
  if (!isContained(resolvedRoot, target)) return null;

  // 5. If the resolved target is an existing directory, map to its
  // index.html. This stat is only reached once containment already holds.
  try {
    const targetStat = statSync(target);
    if (targetStat.isDirectory()) {
      target = pathResolve(pathJoin(target, "index.html"));
    }
  } catch {
    // Does not exist as-is; leave target unchanged and let the caller 404.
  }

  // Symlink-escape check: realpath both the root and the target and compare.
  let realRoot: string;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    // Bundle root itself does not resolve; cannot prove containment, so
    // refuse rather than serve.
    return null;
  }

  try {
    const realTarget = realpathSync(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return null;
    }
  } catch {
    // Target does not exist: a plain miss. The non-real containment check
    // above already passed, so hand the resolved path back for the caller
    // to 404 on the missing file.
    return target;
  }

  return target;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Extension → content type. Extension matching is case-insensitive. */
export function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function notFoundResponse(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleRequest(request: Request, bundleRoot: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(METHOD_NOT_ALLOWED_BODY, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const resolved = resolveAssetPath(bundleRoot, url.pathname);
  if (resolved === null) {
    return notFoundResponse();
  }

  let fileStat: Awaited<ReturnType<typeof statAsync>>;
  try {
    fileStat = await statAsync(resolved);
  } catch {
    return notFoundResponse();
  }
  if (!fileStat.isFile()) {
    return notFoundResponse();
  }

  const headers = new Headers({
    "Content-Type": contentTypeFor(resolved),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(Bun.file(resolved), { status: 200, headers });
}

export function createPwaServer(options?: { port?: number; bundleRoot?: string }): Bun.Server<never> {
  const port = options?.port ?? resolvePwaPort();
  const bundleRoot = options?.bundleRoot ?? resolveBundleRoot();
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => handleRequest(request, bundleRoot),
  });
}

if (import.meta.main) {
  const server = createPwaServer();
  const bundleRoot = resolveBundleRoot();
  console.log(`PWA server listening on ${server.url}`);
  console.log(`Serving bundle root: ${bundleRoot}`);
}
