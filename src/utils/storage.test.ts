import { afterEach, describe, expect, it } from "vitest";
import { browserStorage } from "./storage";

describe("browserStorage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("returns a working no-op stub, and does not throw, when merely referencing localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });

    expect(() => browserStorage()).not.toThrow();
    const storage = browserStorage();
    expect(storage.getItem("any-key")).toBeNull();
    expect(() => storage.setItem("any-key", "true")).not.toThrow();
  });

  it("returns the real localStorage when it is reachable", () => {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
      },
    });

    const storage = browserStorage();
    storage.setItem("any-key", "true");
    expect(storage.getItem("any-key")).toBe("true");
  });
});
