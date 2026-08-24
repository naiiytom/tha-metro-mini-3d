// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOBILE_BREAKPOINT_QUERY, useIsMobile } from "./useIsMobile";

describe("MOBILE_BREAKPOINT_QUERY", () => {
  it("matches Tailwind's default md: breakpoint (768px)", () => {
    expect(MOBILE_BREAKPOINT_QUERY).toBe("(max-width: 767px)");
  });
});

describe("useIsMobile hook", () => {
  let listeners: Array<() => void> = [];
  let currentMatches = false;
  const addEventListenerMock = vi.fn((event: string, callback: () => void) => {
    if (event === "change") {
      listeners.push(callback);
    }
  });
  const removeEventListenerMock = vi.fn((event: string, callback: () => void) => {
    if (event === "change") {
      listeners = listeners.filter((cb) => cb !== callback);
    }
  });

  const createMatchMediaMock = (matches: boolean) => {
    currentMatches = matches;
    return vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      dispatchEvent: vi.fn(),
    }));
  };

  beforeEach(() => {
    listeners = [];
    addEventListenerMock.mockClear();
    removeEventListenerMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when viewport matches mobile query", () => {
    window.matchMedia = createMatchMediaMock(true);

    const { result } = renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalledWith(MOBILE_BREAKPOINT_QUERY);
    expect(result.current).toBe(true);
  });

  it("returns false when viewport does not match mobile query", () => {
    window.matchMedia = createMatchMediaMock(false);

    const { result } = renderHook(() => useIsMobile());
    expect(window.matchMedia).toHaveBeenCalledWith(MOBILE_BREAKPOINT_QUERY);
    expect(result.current).toBe(false);
  });

  it("updates value dynamically when change event triggers", () => {
    window.matchMedia = createMatchMediaMock(true);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    currentMatches = false;
    act(() => {
      listeners.forEach((listener) => listener());
    });

    expect(result.current).toBe(false);
  });

  it("removes event listener when unmounted", () => {
    window.matchMedia = createMatchMediaMock(false);

    const { unmount } = renderHook(() => useIsMobile());
    expect(addEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));

    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
