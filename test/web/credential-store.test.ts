import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createMemoryStorage } from "../../web/src/storage-port";
import {
  createCredentialStore,
  adoptCredentialFromFragment,
  adoptCredentialFromPastedText,
  CREDENTIAL_STORAGE_KEY,
  type Credential,
  type LocationPort,
} from "../../web/src/credential-store";

describe("CredentialStore", () => {
  describe("createCredentialStore", () => {
    it("returns a CredentialStore with required methods", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(store).toHaveProperty("getCredential");
      expect(store).toHaveProperty("getToken");
      expect(store).toHaveProperty("setCredential");
      expect(store).toHaveProperty("clear");
    });

    it("getCredential returns null initially", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(store.getCredential()).toBe(null);
    });

    it("setCredential and getCredential round-trip credential", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "test-token",
      };

      store.setCredential(credential);
      const retrieved = store.getCredential();

      expect(retrieved).toEqual(credential);
    });

    it("round-trips through storage port - two stores over same storage see same value", () => {
      const storage = createMemoryStorage();
      const store1 = createCredentialStore(storage);
      const store2 = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "my-token",
      };

      store1.setCredential(credential);
      const retrieved = store2.getCredential();

      expect(retrieved).toEqual(credential);
    });

    it("stores credential under versioned key", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "test-token",
      };

      store.setCredential(credential);

      // Check that the storage has the key
      const stored = storage.get(CREDENTIAL_STORAGE_KEY);
      expect(stored).not.toBe(null);
      expect(stored).toBeDefined();
    });

    it("uses the correct versioned storage key constant", () => {
      expect(CREDENTIAL_STORAGE_KEY).toBe("phone-to-local-model:v1:credential");
    });

    it("getToken returns the token from credential", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "my-token",
      };

      store.setCredential(credential);
      expect(store.getToken()).toBe("my-token");
    });

    it("getToken returns null when no credential is stored", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(store.getToken()).toBe(null);
    });

    it("clear removes the credential", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "test-token",
      };

      store.setCredential(credential);
      expect(store.getCredential()).not.toBe(null);

      store.clear();
      expect(store.getCredential()).toBe(null);
    });

    it("clear removes the key from storage", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const credential: Credential = {
        baseUrl: "https://example.com",
        token: "test-token",
      };

      store.setCredential(credential);
      expect(storage.get(CREDENTIAL_STORAGE_KEY)).not.toBe(null);

      store.clear();
      expect(storage.get(CREDENTIAL_STORAGE_KEY)).toBe(null);
    });

    it("normalizes baseUrl by stripping trailing slashes", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      store.setCredential({
        baseUrl: "https://example.com/",
        token: "test-token",
      });

      const retrieved = store.getCredential();
      expect(retrieved?.baseUrl).toBe("https://example.com");
    });

    it("normalizes baseUrl with multiple trailing slashes", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      store.setCredential({
        baseUrl: "https://example.com///",
        token: "test-token",
      });

      const retrieved = store.getCredential();
      expect(retrieved?.baseUrl).toBe("https://example.com");
    });

    it("throws when baseUrl is empty", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(() => {
        store.setCredential({
          baseUrl: "",
          token: "test-token",
        });
      }).toThrow();
    });

    it("throws when baseUrl is only whitespace", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(() => {
        store.setCredential({
          baseUrl: "   ",
          token: "test-token",
        });
      }).toThrow();
    });

    it("throws when token is empty", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(() => {
        store.setCredential({
          baseUrl: "https://example.com",
          token: "",
        });
      }).toThrow();
    });

    it("throws when token is only whitespace", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      expect(() => {
        store.setCredential({
          baseUrl: "https://example.com",
          token: "   ",
        });
      }).toThrow();
    });

    it("getCredential returns null for invalid JSON", () => {
      const storage = createMemoryStorage();
      storage.set(CREDENTIAL_STORAGE_KEY, "not valid json");

      const store = createCredentialStore(storage);
      expect(store.getCredential()).toBe(null);
    });

    it("getCredential returns null when stored value lacks baseUrl", () => {
      const storage = createMemoryStorage();
      storage.set(CREDENTIAL_STORAGE_KEY, JSON.stringify({ token: "test" }));

      const store = createCredentialStore(storage);
      expect(store.getCredential()).toBe(null);
    });

    it("getCredential returns null when stored value lacks token", () => {
      const storage = createMemoryStorage();
      storage.set(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({ baseUrl: "https://example.com" })
      );

      const store = createCredentialStore(storage);
      expect(store.getCredential()).toBe(null);
    });

    it("getCredential returns null when baseUrl is not a string", () => {
      const storage = createMemoryStorage();
      storage.set(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({ baseUrl: 123, token: "test" })
      );

      const store = createCredentialStore(storage);
      expect(store.getCredential()).toBe(null);
    });

    it("getCredential returns null when token is not a string", () => {
      const storage = createMemoryStorage();
      storage.set(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({ baseUrl: "https://example.com", token: 123 })
      );

      const store = createCredentialStore(storage);
      expect(store.getCredential()).toBe(null);
    });

    it("getCredential returns null when stored value has extra fields", () => {
      const storage = createMemoryStorage();
      storage.set(
        CREDENTIAL_STORAGE_KEY,
        JSON.stringify({
          baseUrl: "https://example.com",
          token: "test",
          extra: "field",
        })
      );

      const store = createCredentialStore(storage);
      const credential = store.getCredential();
      // Extra fields are fine, as long as required fields are present and valid
      expect(credential).toEqual({
        baseUrl: "https://example.com",
        token: "test",
      });
    });
  });

  describe("adoptCredentialFromFragment", () => {
    it("extracts token from fragment and stores it", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#t=abc123",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).not.toBe(null);
      expect(result?.token).toBe("abc123");
      expect(result?.baseUrl).toBe("https://example.com");
      expect(hashCleared).toBe(true);
      expect(store.getCredential()).toEqual(result);
    });

    it("extracts token from fragment with multiple parameters", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#a=1&t=abc123&b=2",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).not.toBe(null);
      expect(result?.token).toBe("abc123");
      expect(hashCleared).toBe(true);
    });

    it("decodes percent-encoded token values", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      const encodedToken = encodeURIComponent("token+with/special=chars");

      const location: LocationPort = {
        hash: `#t=${encodedToken}`,
        origin: "https://example.com",
        clearHash(): void {},
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result?.token).toBe("token+with/special=chars");
    });

    it("returns null and does not clear hash when no t parameter", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#a=1&b=2",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(false);
    });

    it("returns null and does not clear hash when hash is empty", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(false);
    });

    it("returns null and does not clear hash when hash is just #", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(false);
    });

    it("clears hash and returns null when t parameter is empty string", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#t=",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(true);
    });

    it("clears hash and returns null when t parameter is whitespace-only", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#t=   ",
        origin: "https://example.com",
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(true);
    });

    it("clears hash and returns null when setCredential throws", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      let hashCleared = false;

      const location: LocationPort = {
        hash: "#t=abc123",
        origin: "", // Empty origin will cause setCredential to throw
        clearHash(): void {
          hashCleared = true;
        },
      };

      const result = adoptCredentialFromFragment(store, location);

      expect(result).toBe(null);
      expect(hashCleared).toBe(true);
    });

    it("does not overwrite existing credential when fragment has no token", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      // Set an initial credential
      store.setCredential({
        baseUrl: "https://initial.com",
        token: "initial-token",
      });

      const location: LocationPort = {
        hash: "#a=1&b=2",
        origin: "https://example.com",
        clearHash(): void {},
      };

      adoptCredentialFromFragment(store, location);

      const credential = store.getCredential();
      expect(credential?.baseUrl).toBe("https://initial.com");
      expect(credential?.token).toBe("initial-token");
    });

    it("replaces existing credential when fragment carries a valid token", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      // Set an initial credential
      store.setCredential({
        baseUrl: "https://initial.com",
        token: "initial-token",
      });

      const location: LocationPort = {
        hash: "#t=new-token",
        origin: "https://new.com",
        clearHash(): void {},
      };

      adoptCredentialFromFragment(store, location);

      const credential = store.getCredential();
      expect(credential?.baseUrl).toBe("https://new.com");
      expect(credential?.token).toBe("new-token");
    });
  });

  describe("adoptCredentialFromPastedText", () => {
    it("AC1: full pairing URL stores credential with pasted URL's origin, not currentOrigin", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "https://mac.example.test/app/#t=tok-abc",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
      expect(result?.baseUrl).toBe("https://mac.example.test");
      expect(result?.baseUrl).not.toBe("https://phone.example.test");
      expect(store.getCredential()).toEqual(result);
    });

    it("AC2: bare token stores credential with currentOrigin as baseUrl", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "tok-abc",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
      expect(result?.baseUrl).toBe("https://phone.example.test");
      expect(store.getCredential()).toEqual(result);
    });

    it("AC3: trims leading whitespace on full URL", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "  https://mac.example.test/app/#t=tok-abc",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
      expect(result?.baseUrl).toBe("https://mac.example.test");
    });

    it("AC3: trims trailing whitespace on full URL", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "https://mac.example.test/app/#t=tok-abc\n",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
      expect(result?.baseUrl).toBe("https://mac.example.test");
    });

    it("AC3: trims whitespace on bare token", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "  tok-abc\n",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
    });

    it("AC4: empty string returns null", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "",
        "https://phone.example.test"
      );

      expect(result).toBe(null);
      expect(store.getCredential()).toBe(null);
    });

    it("AC4: whitespace-only string returns null", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "   ",
        "https://phone.example.test"
      );

      expect(result).toBe(null);
      expect(store.getCredential()).toBe(null);
    });

    it("AC4: newline-only string returns null", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "\n",
        "https://phone.example.test"
      );

      expect(result).toBe(null);
      expect(store.getCredential()).toBe(null);
    });

    it("AC4: empty text does not modify existing credential", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      // Set initial credential
      store.setCredential({
        baseUrl: "https://initial.com",
        token: "initial-token",
      });

      adoptCredentialFromPastedText(
        store,
        "",
        "https://phone.example.test"
      );

      expect(store.getCredential()).toEqual({
        baseUrl: "https://initial.com",
        token: "initial-token",
      });
    });

    it("AC5: bare token with URL-significant characters survives round trip", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      const token = "tok+with/slash&amp=and space";

      adoptCredentialFromPastedText(
        store,
        token,
        "https://phone.example.test"
      );

      expect(store.getCredential()?.token).toBe(token);
    });

    it("AC5: full-URL form with percent-encoded token in fragment survives round trip", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);
      const token = "tok+with/slash&amp=and space";
      const encodedToken = encodeURIComponent(token);
      const url = `https://mac.example.test/app/#t=${encodedToken}`;

      adoptCredentialFromPastedText(
        store,
        url,
        "https://phone.example.test"
      );

      expect(store.getCredential()?.token).toBe(token);
    });

    it("AC6: absolute URL with no #t= fragment returns null", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "https://mac.example.test/app/",
        "https://phone.example.test"
      );

      expect(result).toBe(null);
      expect(store.getCredential()).toBe(null);
    });

    it("AC7: absolute URL with empty token (#t=) returns null", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "https://mac.example.test/app/#t=",
        "https://phone.example.test"
      );

      expect(result).toBe(null);
      expect(store.getCredential()).toBe(null);
    });

    it("AC8: fragment with several parameters yields correct token", () => {
      const storage = createMemoryStorage();
      const store = createCredentialStore(storage);

      const result = adoptCredentialFromPastedText(
        store,
        "https://mac.example.test/app/#a=1&t=tok-abc&b=2",
        "https://phone.example.test"
      );

      expect(result).not.toBe(null);
      expect(result?.token).toBe("tok-abc");
    });

    it("AC9: reuse - calls adoptCredentialFromFragment and not store.setCredential", () => {
      const credentialStorePath = join(
        import.meta.dir,
        "../../web/src/credential-store.ts"
      );
      const content = readFileSync(credentialStorePath, "utf-8");

      // Find the adoptCredentialFromPastedText function
      const functionStart = content.indexOf(
        "export function adoptCredentialFromPastedText"
      );
      // adoptCredentialFromPastedText function not found
      expect(functionStart).toBeGreaterThan(-1);

      const functionBody = content.slice(functionStart);

      // Check that it calls adoptCredentialFromFragment
      // adoptCredentialFromPastedText must call adoptCredentialFromFragment
      expect(functionBody).toContain("adoptCredentialFromFragment");

      // Check that it does NOT call store.setCredential
      // adoptCredentialFromPastedText must not call store.setCredential directly
      expect(functionBody).not.toContain("store.setCredential");

      // Check that it does NOT construct URLSearchParams
      // adoptCredentialFromPastedText must not construct URLSearchParams
      expect(functionBody).not.toContain("URLSearchParams");
    });
  });

  describe("credential-store.ts source code", () => {
    it("should not contain localStorage", () => {
      const credentialStorePath = join(
        import.meta.dir,
        "../../web/src/credential-store.ts"
      );
      const content = readFileSync(credentialStorePath, "utf-8");

      if (content.includes("localStorage")) {
        throw new Error("Found localStorage in credential-store.ts");
      }
    });

    it("should not contain document", () => {
      const credentialStorePath = join(
        import.meta.dir,
        "../../web/src/credential-store.ts"
      );
      const content = readFileSync(credentialStorePath, "utf-8");

      if (content.includes("document")) {
        throw new Error("Found document in credential-store.ts");
      }
    });

    it("should not contain window", () => {
      const credentialStorePath = join(
        import.meta.dir,
        "../../web/src/credential-store.ts"
      );
      const content = readFileSync(credentialStorePath, "utf-8");

      if (content.includes("window")) {
        throw new Error("Found window in credential-store.ts");
      }
    });
  });
});
