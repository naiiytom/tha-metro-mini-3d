// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewControls } from "../ViewControls";

describe("ViewControls fullscreen", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
      writable: true,
    });
  });

  it("requests fullscreen on the map container when off", () => {
    const request = vi.fn(() => Promise.resolve());
    const container = document.createElement("div");
    container.requestFullscreen = request;
    document.body.append(container);
    container.setAttribute("data-testid", "map-container");

    render(<ViewControls />);
    fireEvent.click(screen.getByRole("button", { name: /fullscreen/i }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("exits fullscreen when already in it", () => {
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    (document as unknown as { fullscreenElement: Element | null }).fullscreenElement =
      document.createElement("div");

    render(<ViewControls />);
    fireEvent.click(screen.getByRole("button", { name: /fullscreen/i }));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("re-syncs its pressed state from a fullscreenchange it did not initiate", () => {
    // Esc exits fullscreen without going through our click handler. The DOM
    // is the source of truth; a store boolean would go stale here.
    render(<ViewControls />);
    const button = screen.getByRole("button", { name: /fullscreen/i });
    expect(button).toHaveAttribute("aria-pressed", "false");

    (document as unknown as { fullscreenElement: Element | null }).fullscreenElement =
      document.createElement("div");
    fireEvent(document, new Event("fullscreenchange"));
    expect(button).toHaveAttribute("aria-pressed", "true");

    (document as unknown as { fullscreenElement: Element | null }).fullscreenElement = null;
    fireEvent(document, new Event("fullscreenchange"));
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
