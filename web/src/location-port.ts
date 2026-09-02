import type { LocationPort } from "./credential-store";

export function createWindowLocation(win: Window): LocationPort {
  return {
    get hash(): string {
      return win.location.hash;
    },

    get origin(): string {
      return win.location.origin;
    },

    clearHash(): void {
      try {
        if (win.history && typeof win.history.replaceState === "function") {
          // Use replaceState to remove fragment without adding history entry
          const pathname = win.location.pathname;
          const search = win.location.search;
          const newUrl = pathname + search;
          win.history.replaceState(null, "", newUrl);
        } else if (
          win.location &&
          typeof win.location.replace === "function"
        ) {
          // Fallback to location.replace
          const pathname = win.location.pathname;
          const search = win.location.search;
          const origin = win.location.origin;
          const newUrl = origin + pathname + search;
          win.location.replace(newUrl);
        }
      } catch {
        // Silently ignore errors - better to leave token in URL than abort bootstrap
      }
    },
  };
}
