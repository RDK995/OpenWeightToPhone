export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function createMemoryStorage(): StoragePort {
  const store = new Map<string, string>();

  return {
    get(key: string): string | null {
      const value = store.get(key);
      return value !== undefined ? value : null;
    },
    set(key: string, value: string): void {
      store.set(key, value);
    },
    remove(key: string): void {
      store.delete(key);
    },
  };
}

export function createLocalStorageStorage(storage: Storage): StoragePort {
  return {
    get(key: string): string | null {
      return storage.getItem(key);
    },
    set(key: string, value: string): void {
      storage.setItem(key, value);
    },
    remove(key: string): void {
      storage.removeItem(key);
    },
  };
}
