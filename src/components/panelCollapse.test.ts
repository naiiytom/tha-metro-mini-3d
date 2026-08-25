import { afterEach, describe, expect, it } from "vitest";
import {
  PANEL_COLLAPSE_KEY,
  browserStorage,
  hasStoredPreference,
  loadCollapsed,
  saveCollapsed,
} from "./panelCollapse";

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => Object.fromEntries(map),
  };
}

describe("loadCollapsed", () => {
  it("defaults to collapsed on mobile", () => {
    expect(loadCollapsed(fakeStorage(), true)).toBe(true);
  });

  it("defaults to expanded on desktop", () => {
    expect(loadCollapsed(fakeStorage(), false)).toBe(false);
  });

  it("prefers a stored choice over the default, at either width", () => {
    expect(loadCollapsed(fakeStorage({ [PANEL_COLLAPSE_KEY]: "true" }), false)).toBe(true);
    expect(loadCollapsed(fakeStorage({ [PANEL_COLLAPSE_KEY]: "false" }), true)).toBe(false);
  });

  it("falls back to the default on a corrupt value", () => {
    expect(loadCollapsed(fakeStorage({ [PANEL_COLLAPSE_KEY]: "yes please" }), false)).toBe(false);
  });

  it("survives storage that throws (private mode, blocked cookies)", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadCollapsed(hostile, true)).toBe(true);
    expect(() => saveCollapsed(hostile, true)).not.toThrow();
  });
});

describe("saveCollapsed", () => {
  it("round-trips", () => {
    const s = fakeStorage();
    saveCollapsed(s, true);
    expect(loadCollapsed(s, false)).toBe(true);
  });
});

describe("browserStorage", () => {
  // Every LineSelector.tsx call site used to pass the bare `localStorage`
  // global straight through — throwing here, not inside
  // loadCollapsed/saveCollapsed/hasStoredPreference's own try/catch bodies,
  // would white-screen the whole app (a useState initializer runs during
  // render, with no Error Boundary above it in that tree). This is that
  // exact failure mode: a throwing ACCESSOR, not a throwing method on an
  // otherwise-fine object.
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
    expect(storage.getItem(PANEL_COLLAPSE_KEY)).toBeNull();
    expect(() => storage.setItem(PANEL_COLLAPSE_KEY, "true")).not.toThrow();
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
    storage.setItem(PANEL_COLLAPSE_KEY, "true");
    expect(storage.getItem(PANEL_COLLAPSE_KEY)).toBe("true");
  });
});

describe("hasStoredPreference", () => {
  it("is true once a value is stored", () => {
    expect(hasStoredPreference(fakeStorage({ [PANEL_COLLAPSE_KEY]: "true" }))).toBe(true);
  });

  it("is false with no stored value", () => {
    expect(hasStoredPreference(fakeStorage())).toBe(false);
  });

  it("is false (not a thrown exception) when storage throws", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
    };
    expect(() => hasStoredPreference(hostile)).not.toThrow();
    expect(hasStoredPreference(hostile)).toBe(false);
  });
});
