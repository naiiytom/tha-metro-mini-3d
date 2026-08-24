import { describe, expect, it } from "vitest";
import { INITIAL_COMBO, comboReducer, type ComboState } from "./comboboxState";

const at = (over: Partial<ComboState> = {}): ComboState => ({ ...INITIAL_COMBO, ...over });

describe("comboReducer", () => {
  it("opens on focus without changing the query", () => {
    expect(comboReducer(at({ query: "sia" }), { type: "focus" }, 3)).toEqual(
      at({ open: true, query: "sia", activeIndex: -1 }),
    );
  });

  it("opens on input and resets the active row", () => {
    const next = comboReducer(at({ open: false, activeIndex: 4 }), { type: "input", query: "as" }, 2);
    expect(next).toEqual(at({ open: true, query: "as", activeIndex: -1 }));
  });

  it("moves down from nothing-selected to the first row", () => {
    expect(comboReducer(at({ open: true }), { type: "move", delta: 1 }, 3).activeIndex).toBe(0);
  });

  it("wraps past the end", () => {
    expect(comboReducer(at({ open: true, activeIndex: 2 }), { type: "move", delta: 1 }, 3).activeIndex).toBe(0);
  });

  it("wraps backwards from the first row to the last", () => {
    expect(comboReducer(at({ open: true, activeIndex: 0 }), { type: "move", delta: -1 }, 3).activeIndex).toBe(2);
  });

  it("opens on a move while closed instead of silently moving a hidden list", () => {
    const next = comboReducer(at({ open: false }), { type: "move", delta: 1 }, 3);
    expect(next.open).toBe(true);
    expect(next.activeIndex).toBe(0);
  });

  it("does nothing on a move with no options", () => {
    expect(comboReducer(at({ open: true }), { type: "move", delta: 1 }, 0).activeIndex).toBe(-1);
  });

  it("closes and clears the active row on close", () => {
    expect(comboReducer(at({ open: true, activeIndex: 2, query: "sia" }), { type: "close" }, 3)).toEqual(
      at({ open: false, activeIndex: -1, query: "sia" }),
    );
  });

  it("adopts the picked label and closes", () => {
    expect(comboReducer(at({ open: true, activeIndex: 1 }), { type: "pick", label: "Siam" }, 3)).toEqual(
      at({ open: false, query: "Siam", activeIndex: -1 }),
    );
  });
});
