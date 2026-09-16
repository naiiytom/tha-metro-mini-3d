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

  it("toggles 3D perspective view mode", () => {
    render(<ViewControls />);
    const button = screen.getByRole("button", { name: /3d perspective/i });
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("renders train scale options and changes train scale in the store", () => {
    render(<ViewControls />);
    const btn1x = screen.getByTestId("train-scale-1");
    const btn15x = screen.getByTestId("train-scale-1.5");
    const btn3x = screen.getByTestId("train-scale-3");
    const btn5x = screen.getByTestId("train-scale-5");

    expect(btn1x).toHaveAttribute("aria-checked", "true");
    expect(btn15x).toHaveAttribute("aria-checked", "false");
    expect(btn3x).toHaveAttribute("aria-checked", "false");
    expect(btn5x).toHaveAttribute("aria-checked", "false");

    fireEvent.click(btn15x);
    expect(btn15x).toHaveAttribute("aria-checked", "true");
    expect(btn1x).toHaveAttribute("aria-checked", "false");

    fireEvent.click(btn3x);
    expect(btn3x).toHaveAttribute("aria-checked", "true");

    fireEvent.click(btn5x);
    expect(btn5x).toHaveAttribute("aria-checked", "true");
  });

  it("toggles the keyboard shortcuts HUD card, and closes on Escape or click outside", () => {
    render(<ViewControls />);
    const toggleBtn = screen.getByTestId("toggle-flyover-hud");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("flyover-hud-card")).toBeNull();

    // Open HUD
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    const hudCard = screen.getByTestId("flyover-hud-card");
    expect(hudCard).toBeTruthy();
    expect(screen.getByText(/Flyover Navigation/i)).toBeTruthy();
    expect(screen.getByText(/Fly \/ Strafe/i)).toBeTruthy();

    // Press Escape to close
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("flyover-hud-card")).toBeNull();

    // Reopen HUD and close with close button
    fireEvent.click(toggleBtn);
    const closeBtn = screen.getByRole("button", { name: /Close keyboard shortcuts/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("flyover-hud-card")).toBeNull();

    // Reopen and close via click outside
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("flyover-hud-card")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("flyover-hud-card")).toBeNull();
  });
});

