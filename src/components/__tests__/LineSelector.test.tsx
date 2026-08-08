// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineSelector } from "../LineSelector";
import { useAppStore } from "../../stores/useAppStore";

describe("LineSelector search button", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // Mock matchMedia for useIsMobile hook
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    useAppStore.setState({ searchOpen: false, routes: [], mapReady: true, uiHidden: false });
  });

  it("opens the search panel on click", () => {
    render(<LineSelector />);
    fireEvent.click(screen.getByRole("button", { name: /search stations/i }));
    expect(useAppStore.getState().searchOpen).toBe(true);
  });

  it("closes the search panel when clicked again", () => {
    render(<LineSelector />);
    const button = screen.getByRole("button", { name: /search stations/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /close station search/i }));
    expect(useAppStore.getState().searchOpen).toBe(false);
  });

  it("hides the search button while uiHidden is true", () => {
    useAppStore.setState({ uiHidden: true });
    render(<LineSelector />);
    expect(screen.queryByRole("button", { name: /search stations/i })).toBeNull();
  });
});
