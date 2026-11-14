/**
 * Safe accessor for the `localStorage` global. Merely referencing `localStorage`
 * can throw a `SecurityError` in strict privacy/sandbox configurations, so all
 * persistence modules share this guarded accessor and fall back to a no-op stub.
 */

export type ReadableStorage = Pick<Storage, "getItem">;
export type WritableStorage = Pick<Storage, "setItem">;

export const NOOP_STORAGE: WritableStorage & ReadableStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function browserStorage(): WritableStorage & ReadableStorage {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
    return NOOP_STORAGE;
  } catch {
    return NOOP_STORAGE;
  }
}
