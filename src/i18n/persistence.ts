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
  lang: PrimaryLanguage,
  storage: WritableStorage = browserStorage(),
): void {
  try {
    storage.setItem(PRIMARY_LANG_KEY, lang);
  } catch {
    // Guard against quota/private-browsing exceptions
  }
}

export function detectBrowserLanguage(
  nav?: Partial<Pick<Navigator, "language" | "languages">>,
): PrimaryLanguage {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!n) return "en";

  if (Array.isArray(n.languages)) {
    for (const lang of n.languages) {
      if (typeof lang === "string" && lang.toLowerCase().startsWith("th")) {
        return "th";
      }
    }
  }

  if (typeof n.language === "string" && n.language.toLowerCase().startsWith("th")) {
    return "th";
  }
  return "en";
}

export function resolveInitialLanguage(
  storage: ReadableStorage = browserStorage(),
  nav?: Partial<Pick<Navigator, "language" | "languages">>,
): PrimaryLanguage {
  const persisted = loadPrimaryLang(storage);
  if (persisted) return persisted;
  return detectBrowserLanguage(nav);
}

