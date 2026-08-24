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
