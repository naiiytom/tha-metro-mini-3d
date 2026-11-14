/**
 * Reader primary language persistence and detection (Issue #65, Seam C).
 *
 * Persists user explicit language choice under `tmm3d.lang` in localStorage.
 * Guarded against localStorage unavailability (e.g. private browsing, sandbox).
 * Resolution order:
 *   1. Stored choice if valid ("en" | "th")
 *   2. Browser auto-detection: Thai-browser ("th*") -> "th", else "en"
 */

import {
  browserStorage,
  type ReadableStorage,
  type WritableStorage,
} from "../utils/storage";

export type PrimaryLanguage = "en" | "th";

export const PRIMARY_LANG_KEY = "tmm3d.lang";

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

