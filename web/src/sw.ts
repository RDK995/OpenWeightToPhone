// The PWA service worker: network-first shell strategy with versioned cache.
//
// This module must be importable in a non-browser process without throwing.
// All statements that touch self, caches, clients, or addEventListener must sit
// behind environment guards, in the same spirit as the `typeof document !== "undefined"`
// guard in main.ts.

export const CACHE_VERSION = "v1";
export const CACHE_NAME = `phone-reasoning-shell-${CACHE_VERSION}`;
export const SHELL_SCOPE = "/app/";

export function shouldHandle(
  request: { method: string; url: string },
  scopeOrigin: string
): boolean {
  // Only handle GET requests
  if (request.method !== "GET") {
    return false;
  }

  try {
    const url = new URL(request.url);
    const scopeUrl = new URL(scopeOrigin);

    // Only handle same-origin requests
    if (url.origin !== scopeUrl.origin) {
      return false;
    }

    // Only handle URLs under the shell scope
    return url.pathname.startsWith(SHELL_SCOPE);
  } catch {
    // Invalid URL
    return false;
  }
}

export async function handleShellRequest(
  request: Request,
  deps: {
    fetch: (request: Request) => Promise<Response>;
    cacheMatch: (request: Request) => Promise<Response | undefined>;
    cachePut: (request: Request, response: Response) => Promise<void>;
  }
): Promise<Response> {
  try {
    // Network-first: try to fetch from network
    const networkResponse = await deps.fetch(request);

    if (networkResponse.ok) {
      // A cache write is an optimisation and must never be able to fail a
      // request that already succeeded on the network.
      try {
        await deps.cachePut(request, networkResponse.clone());
      } catch {
        // Cache write failed (e.g. QuotaExceededError). Ignore it and return
        // the fresh response regardless.
      }
      return networkResponse;
    }

    // Network returned a non-ok response, try the cache
    const cachedResponse = await deps.cacheMatch(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // No cache and network response was non-ok, return the network response
    return networkResponse;
  } catch (error) {
    // Network failed (offline), try the cache
    const cachedResponse = await deps.cacheMatch(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // No cache and network failed, re-throw the error
    throw error;
  }
}

export function staleCacheNames(existing: readonly string[]): string[] {
  return existing.filter((name) => name !== CACHE_NAME);
}

// Environment guard: only run service worker code in a browser context
if (typeof self !== "undefined" && "caches" in self && "clients" in self) {
  // Type declarations for the service worker global scope
  // We cast self to any to avoid needing the WebWorker lib
  const swSelf = self as any;

  // Install: skip waiting to take over immediately
  swSelf.addEventListener("install", (event: any) => {
    event.waitUntil(swSelf.skipWaiting());
  });

  // Activate: delete stale caches and claim clients
  swSelf.addEventListener("activate", (event: any) => {
    event.waitUntil(
      (async () => {
        const cacheNames = await swSelf.caches.keys();
        const stale = staleCacheNames(cacheNames);
        await Promise.all(stale.map((name: string) => swSelf.caches.delete(name)));
        await swSelf.clients.claim();
      })()
    );
  });

  // Fetch: intercept shell requests with network-first strategy
  swSelf.addEventListener("fetch", (event: any) => {
    if (shouldHandle(event.request, swSelf.location.origin)) {
      event.respondWith(
        (async () => {
          const cache = await swSelf.caches.open(CACHE_NAME);
          return handleShellRequest(event.request, {
            fetch: (req: Request) => fetch(req),
            cacheMatch: (req: Request) => cache.match(req),
            cachePut: (req: Request, res: Response) => cache.put(req, res),
          });
        })()
      );
    }
  });
}
