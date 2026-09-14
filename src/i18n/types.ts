import type { TranslationKey } from "./locales/en";

export type { TranslationKey };
export type Dictionary = Record<TranslationKey, string>;

/**
 * Interpolates slot tokens like `{slotName}` in `template` with values from `params`.
 */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return key in params ? String(params[key]) : match;
  });
}
