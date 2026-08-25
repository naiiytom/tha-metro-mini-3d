/**
 * Combobox interaction state, as a pure reducer.
 *
 * Extracted from the component for the same reason `filterStations` was:
 * `npm test` is this project's only automated surface, and keyboard
 * navigation is exactly the kind of thing that regresses invisibly. The
 * component owns focus, scrolling and rendering; this owns what is open,
 * what is typed, and which row is active.
 *
 * `activeIndex === -1` means "nothing highlighted" — distinct from row 0, so
 * that opening the list does not pre-commit the user to its first entry.
 */
export interface ComboState {
  open: boolean;
  query: string;
  activeIndex: number;
}

export type ComboEvent =
  | { type: "focus" }
  | { type: "input"; query: string }
  | { type: "move"; delta: number }
  | { type: "close" }
  | { type: "pick"; label: string };

export const INITIAL_COMBO: ComboState = { open: false, query: "", activeIndex: -1 };

export function comboReducer(
  state: ComboState,
  event: ComboEvent,
  optionCount: number,
): ComboState {
  switch (event.type) {
    case "focus":
      return { ...state, open: true, activeIndex: -1 };

    case "input":
      return { open: true, query: event.query, activeIndex: -1 };

    case "move": {
      if (optionCount === 0) return { ...state, open: true, activeIndex: -1 };
      const from = state.activeIndex;
      const next =
        from === -1
          ? event.delta > 0
            ? 0
            : optionCount - 1
          : (from + event.delta + optionCount) % optionCount;
      return { ...state, open: true, activeIndex: next };
    }

    case "close":
      return { ...state, open: false, activeIndex: -1 };

    case "pick":
      return { open: false, query: event.label, activeIndex: -1 };
  }
}
