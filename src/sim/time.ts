import { translate } from "../i18n";
import type { PrimaryLanguage } from "../i18n/persistence";

import { DAY_SEC } from "./bangkok";

/** Bangkok service-time formatting shared by the UI panels. */

export * from "./bangkok";

/**
 * Format seconds-since-service-day-midnight as HH:MM. Values past midnight
 * (a run that spills into the next day) wrap, so 25:10 renders as 01:10.
 */
export function formatServiceSec(sec: number): string {
  const s = ((Math.floor(sec) % DAY_SEC) + DAY_SEC) % DAY_SEC;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Human countdown: "due", "45s", "2m 30s", "1h 05m" (or Thai equivalents). */
export function formatCountdown(seconds: number, lang: PrimaryLanguage = "en"): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return translate(lang, "units.due");
  const total = Math.round(seconds);
  if (total <= 0) return translate(lang, "units.due");
  const sSuffix = translate(lang, "units.secSuffix");
  const mSuffix = translate(lang, "units.minSuffix");
  const hSuffix = translate(lang, "units.hourSuffix");
  if (total < 60) return `${total}${sSuffix}`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0
      ? `${m}${mSuffix}`
      : `${m}${mSuffix} ${String(s).padStart(2, "0")}${sSuffix}`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}${hSuffix} ${String(m).padStart(2, "0")}${mSuffix}`;
}
