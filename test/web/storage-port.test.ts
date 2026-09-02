import { describe, it, expect } from "bun:test";
import {
  createMemoryStorage,
  createLocalStorageStorage,
} from "../../web/src/storage-port";

describe("StoragePort", () => {
  describe("createMemoryStorage", () => {
    it("creates an independent memory storage", () => {
      const storage1 = createMemoryStorage();
      const storage2 = createMemoryStorage();

      storage1.set("key", "value1");
      storage2.set("key", "value2");

      expect(storage1.get("key")).toBe("value1");
      expect(storage2.get("key")).toBe("value2");
    });

    it("get returns null for non-existent key", () => {
      const storage = createMemoryStorage();
      expect(storage.get("nonexistent")).toBe(null);
    });

    it("set stores a value", () => {
      const storage = createMemoryStorage();
      storage.set("key", "value");
      expect(storage.get("key")).toBe("value");
    });

    it("set overwrites existing value", () => {
      const storage = createMemoryStorage();
      storage.set("key", "value1");
      storage.set("key", "value2");
      expect(storage.get("key")).toBe("value2");
    });

    it("remove deletes a value", () => {
      const storage = createMemoryStorage();
      storage.set("key", "value");
      storage.remove("key");
      expect(storage.get("key")).toBe(null);
    });

    it("remove on non-existent key is a no-op", () => {
      const storage = createMemoryStorage();
      expect(() => {
        storage.remove("nonexistent");
      }).not.toThrow();
      expect(storage.get("nonexistent")).toBe(null);
    });

    it("round-trips empty string", () => {
      const storage = createMemoryStorage();
      storage.set("empty", "");
      expect(storage.get("empty")).toBe("");
    });

    it("round-trips string with special characters", () => {
      const storage = createMemoryStorage();
      const special = '{"key": "value", "null": null, "newline": "\\n"}';
      storage.set("special", special);
      expect(storage.get("special")).toBe(special);
    });

    it("round-trips string with unicode", () => {
      const storage = createMemoryStorage();
      const unicode = "Hello 世界 🌍";
      storage.set("unicode", unicode);
      expect(storage.get("unicode")).toBe(unicode);
    });

    it("returns null after removal", () => {
      const storage = createMemoryStorage();
      storage.set("key", "value");
      storage.remove("key");
      expect(storage.get("key")).toBe(null);
    });
  });

  describe("createLocalStorageStorage", () => {
    it("delegates get to Storage object", () => {
      const mockStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: (key: string) => `value-for-${key}`,
        key: () => null,
        removeItem: () => {},
        setItem: () => {},
      };

      const storage = createLocalStorageStorage(mockStorage);
      expect(storage.get("test")).toBe("value-for-test");
    });

    it("delegates set to Storage object", () => {
      let setCalls: Array<[string, string]> = [];
      const mockStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: () => {},
        setItem: (key: string, value: string) => {
          setCalls.push([key, value]);
        },
      };

      const storage = createLocalStorageStorage(mockStorage);
      storage.set("key", "value");
      expect(setCalls).toEqual([["key", "value"]]);
    });

    it("delegates remove to Storage object", () => {
      let removedKeys: string[] = [];
      const mockStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: (key: string) => {
          removedKeys.push(key);
        },
        setItem: () => {},
      };

      const storage = createLocalStorageStorage(mockStorage);
      storage.remove("key");
      expect(removedKeys).toEqual(["key"]);
    });

    it("get returns null when Storage.getItem returns null", () => {
      const mockStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: () => {},
        setItem: () => {},
      };

      const storage = createLocalStorageStorage(mockStorage);
      expect(storage.get("nonexistent")).toBe(null);
    });

    it("round-trips empty string through Storage", () => {
      let stored: Record<string, string> = {};
      const mockStorage: Storage = {
        length: 0,
        clear: () => {
          stored = {};
        },
        getItem: (key: string) => stored[key] ?? null,
        key: () => null,
        removeItem: (key: string) => {
          delete stored[key];
        },
        setItem: (key: string, value: string) => {
          stored[key] = value;
        },
      };

      const storage = createLocalStorageStorage(mockStorage);
      storage.set("empty", "");
      expect(storage.get("empty")).toBe("");
    });

    it("round-trips string with special characters through Storage", () => {
      let stored: Record<string, string> = {};
      const mockStorage: Storage = {
        length: 0,
        clear: () => {
          stored = {};
        },
        getItem: (key: string) => stored[key] ?? null,
        key: () => null,
        removeItem: (key: string) => {
          delete stored[key];
        },
        setItem: (key: string, value: string) => {
          stored[key] = value;
        },
      };

      const storage = createLocalStorageStorage(mockStorage);
      const special = '{"key": "value", "null": null}';
      storage.set("special", special);
      expect(storage.get("special")).toBe(special);
    });

    it("remove on non-existent key is a no-op", () => {
      let removedKeys: string[] = [];
      const mockStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: (key: string) => {
          removedKeys.push(key);
        },
        setItem: () => {},
      };

      const storage = createLocalStorageStorage(mockStorage);
      storage.remove("nonexistent");
      expect(removedKeys).toEqual(["nonexistent"]);
    });
  });
});
