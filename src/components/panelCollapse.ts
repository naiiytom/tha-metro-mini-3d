/**
 * Persistence for the line-selector panel's collapsed state (issue #29).
 *
 * The panel had a working collapse gated to mobile only — desktop computed
 * `bodyVisible = !isMobile || ...`, so `expanded` had no effect there and a
 * 14-line list plus the whole view-controls block sat permanently over the
 * map it controls.
 *
 * Storage is passed in rather than reached for, so this is testable without
 * a DOM, and every access is guarded: `localStorage` throws outright in
 * some privacy configurations, and a panel that cannot collapse is a much
 * worse outcome than a preference that does not persist.
 */
export const PANEL_COLLAPSE_KEY = "tmm3d.lineSelector.collapsed";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function loadCollapsed(storage: ReadableStorage, isMobile: boolean): boolean {
  // Mobile still defaults collapsed: the panel competes with the bottom-sheet
  // stack for a phone viewport. Desktop defaults expanded, as it is today.
  const fallback = isMobile;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PANEL_COLLAPSE_KEY);
  } catch {
    return fallback;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function saveCollapsed(storage: WritableStorage, collapsed: boolean): void {
  try {
    storage.setItem(PANEL_COLLAPSE_KEY, collapsed ? "true" : "false");
  } catch {
    // Preference not persisted; the session still works.
  }
}

/**
 * Safe accessor for the `localStorage` global itself.
 *
 * `loadCollapsed`/`saveCollapsed`/`hasStoredPreference` above each guard
 * their OWN body in try/catch, but every call site still has to REFERENCE
 * `localStorage` to produce the argument they pass in — and in some real
 * configurations (blocked site data, a sandboxed iframe, certain
 * private-mode browsers) merely reading `window.localStorage` throws a
 * `SecurityError`. That throw happens evaluating the call site's argument
 * expression, before any of these guarded function bodies ever run — so a
 * bare `loadCollapsed(localStorage, ...)` inside a `useState` initializer
 * (as `LineSelector.tsx` does) can white-screen the whole app: a render-time
 * throw with no Error Boundary above it in that tree.
 *
 * Returns a no-op stub on failure rather than `null`, so every call site can
 * pass the result straight through without an extra null check — the three
 * functions above already accept a `Pick<Storage, ...>`-shaped parameter,
 * and a stub satisfies that shape with the same "does nothing, never throws"
 * behavior their own catch blocks fall back to.
 */
const NOOP_STORAGE: WritableStorage & ReadableStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function browserStorage(): WritableStorage & ReadableStorage {
  try {
    // Referencing the global is the operation that can throw — `localStorage`
    // is a getter on `window`, not a plain binding.
    return localStorage;
  } catch {
    return NOOP_STORAGE;
  }
}

/**
 * Whether a preference has been stored at all, guarded the same way as
 * `loadCollapsed`/`saveCollapsed` above. Exists so callers that need to
 * distinguish "no preference yet" from "preference is false" (the resize
 * effect in `LineSelector.tsx`) never have to reach for a raw
 * `storage.getItem()` call themselves — a throwing storage there would
 * otherwise fire inside a passive effect with no Error Boundary, which in
 * React 18 can unmount the whole app rather than just fail to persist a
 * preference.
 */
export function hasStoredPreference(storage: ReadableStorage): boolean {
  try {
    return storage.getItem(PANEL_COLLAPSE_KEY) !== null;
  } catch {
    return false;
  }
}
