import type { StoragePort } from "./storage-port";

export type Credential = {
  baseUrl: string;
  token: string;
};

export interface CredentialStore {
  getCredential(): Credential | null;
  getToken(): string | null;
  setCredential(credential: Credential): void;
  clear(): void;
}

export interface LocationPort {
  readonly hash: string;
  readonly origin: string;
  clearHash(): void;
}

export const CREDENTIAL_STORAGE_KEY = "phone-to-local-model:v1:credential";

export function createCredentialStore(storage: StoragePort): CredentialStore {
  return {
    getCredential(): Credential | null {
      const stored = storage.get(CREDENTIAL_STORAGE_KEY);
      if (stored === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(stored);

        // Validate that parsed is an object with string baseUrl and token
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          typeof parsed.baseUrl !== "string" ||
          typeof parsed.token !== "string"
        ) {
          return null;
        }

        return {
          baseUrl: parsed.baseUrl,
          token: parsed.token,
        };
      } catch {
        // Invalid JSON
        return null;
      }
    },

    getToken(): string | null {
      const credential = this.getCredential();
      return credential?.token ?? null;
    },

    setCredential(credential: Credential): void {
      // Normalize baseUrl by stripping trailing slashes
      const normalizedBaseUrl = credential.baseUrl.replace(/\/+$/, "");

      // Validate that baseUrl and token are not empty
      if (!normalizedBaseUrl || normalizedBaseUrl.trim() === "") {
        throw new Error("baseUrl cannot be empty");
      }
      if (!credential.token || credential.token.trim() === "") {
        throw new Error("token cannot be empty");
      }

      const toStore: Credential = {
        baseUrl: normalizedBaseUrl,
        token: credential.token,
      };

      storage.set(CREDENTIAL_STORAGE_KEY, JSON.stringify(toStore));
    },

    clear(): void {
      storage.remove(CREDENTIAL_STORAGE_KEY);
    },
  };
}

export function adoptCredentialFromFragment(
  store: CredentialStore,
  location: LocationPort
): Credential | null {
  // Parse the fragment (without the leading #) as URL-encoded parameters
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);

  // Extract the token from the 't' parameter
  const token = params.get("t");

  // If no 't' parameter is present, return null without touching storage or hash
  if (token === null) {
    return null;
  }

  // If 't' is present but empty or whitespace-only, clear the hash and return null
  if (token === "" || token.trim() === "") {
    location.clearHash();
    return null;
  }

  // 't' is present and non-empty, so attempt to store it
  try {
    store.setCredential({
      baseUrl: location.origin,
      token: token,
    });
    location.clearHash();
    return store.getCredential();
  } catch {
    // If setCredential throws, still clear the hash and return null
    location.clearHash();
    return null;
  }
}

export function adoptCredentialFromPastedText(
  store: CredentialStore,
  pastedText: string,
  currentOrigin: string
): Credential | null {
  // Step 1: Trim and check for emptiness
  const trimmed = pastedText.trim();
  if (trimmed === "") {
    return null;
  }

  // Step 2: Try to parse as a full URL
  try {
    const url = new URL(trimmed);

    // Build synthetic LocationPort from the URL
    const syntheticLocation: LocationPort = {
      hash: url.hash,
      origin: url.origin,
      clearHash(): void {
        // No-op for pasted text
      },
    };

    // Delegate to adoptCredentialFromFragment
    return adoptCredentialFromFragment(store, syntheticLocation);
  } catch {
    // Not a valid URL, fall through to bare token handling
  }

  // Step 3: Treat as bare token
  const encodedToken = encodeURIComponent(trimmed);
  const syntheticLocation: LocationPort = {
    hash: "#t=" + encodedToken,
    origin: currentOrigin,
    clearHash(): void {
      // No-op for pasted text
    },
  };

  return adoptCredentialFromFragment(store, syntheticLocation);
}
