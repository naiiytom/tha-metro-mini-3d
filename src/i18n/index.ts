import { en, type TranslationKey } from "./locales/en";
import { th } from "./locales/th";
import { interpolate, type Dictionary } from "./types";
import { useAppStore, type PrimaryLanguage } from "../stores/useAppStore";

const DICTIONARIES: Record<PrimaryLanguage, Dictionary> = {
  en,
  th,
};

/**
 * Pure translation lookup with slot interpolation.
 * English is the source of truth; if a key is missing in a secondary dictionary,
 * it falls back to English.
 */
export function translate(
  lang: PrimaryLanguage,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = DICTIONARIES[lang] ?? en;
  const template = dict[key] ?? en[key] ?? key;
  return interpolate(template, params);
}

/**
 * React hook returning a bound translation function for the active primary language.
 */
export function useT() {
  const primaryLang = useAppStore((s) => s.primaryLang);
  return (key: TranslationKey, params?: Record<string, string | number>): string => {
    return translate(primaryLang, key, params);
  };
}

export { en, th, interpolate };
export type { TranslationKey, Dictionary };
