/**
 * Reader primary language persistence and detection (Issue #65, Seam C).
 *
 * Persists user explicit language choice under `tmm3d.lang` in localStorage.
 * Guarded against localStorage unavailability (e.g. private browsing, sandbox).
 * Resolution order:
 *   1. Stored choice if valid ("en" | "th")
 *   2. Browser auto-detection: Thai-browser ("th*") -> "th", else "en"
 */

export type PrimaryLanguage = "en" | "th";

export const PRIMARY_LANG_KEY = "tmm3d.lang";

export type ReadableStorage = Pick<Storage, "getItem">;
export type WritableStorage = Pick<Storage, "setItem">;

export const NOOP_STORAGE: WritableStorage & ReadableStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function browserStorage(): WritableStorage & ReadableStorage {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
    return NOOP_STORAGE;
  } catch {
    return NOOP_STORAGE;
  }
}

export function parsePrimaryLang(raw: string | null): PrimaryLanguage | null {
  if (raw === "en" || raw === "th") return raw;
  return null;
}

export function loadPrimaryLang(storage: ReadableStorage = browserStorage()): PrimaryLanguage | null {
  try {
    return parsePrimaryLang(storage.getItem(PRIMARY_LANG_KEY));
  } catch {
    return null;
  }
}

export function savePrimaryLang(
  arg1: PrimaryLanguage | WritableStorage,
  arg2?: PrimaryLanguage | WritableStorage
): void {
  let lang: PrimaryLanguage;
  let storage: WritableStorage;

  if (typeof arg1 === "string") {
    lang = arg1;
    storage = (arg2 as WritableStorage) ?? browserStorage();
  } else {
    storage = arg1;
    lang = arg2 as PrimaryLanguage;
  }

  try {
    storage.setItem(PRIMARY_LANG_KEY, lang);
  } catch {
    // Guard against quota/private-browsing exceptions
  }
}

export function detectBrowserLanguage(nav?: Pick<Navigator, "language">): PrimaryLanguage {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (n && typeof n.language === "string" && n.language.toLowerCase().startsWith("th")) {
    return "th";
  }
  return "en";
}

export function resolveInitialLanguage(
  storage: ReadableStorage = browserStorage(),
  nav?: Pick<Navigator, "language">
): PrimaryLanguage {
  const persisted = loadPrimaryLang(storage);
  if (persisted) return persisted;
  return detectBrowserLanguage(nav);
}
