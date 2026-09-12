/**
 * Bangkok service-time helpers shared by the MVP 4 UI panels.
 *
 * Asia/Bangkok is a fixed UTC+7 offset with no DST, so the arithmetic here is
 * exact — the same assumption the worker makes when it splits sim time into
 * `date_yyyymmdd` + `sec_of_day` (ENGINE_CONTRACT.md §5).
 */

export const BANGKOK_OFFSET_MS = 7 * 3_600_000;
export const DAY_MS = 86_400_000;
export const DAY_SEC = 86_400;

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
export function formatCountdown(seconds: number, lang: "en" | "th" = "en"): string {
  if (seconds <= 0) return lang === "th" ? "ถึงแล้ว" : "due";
  const sSuffix = lang === "th" ? " วิ" : "s";
  const mSuffix = lang === "th" ? " นาที" : "m";
  const hSuffix = lang === "th" ? " ชม." : "h";
  if (seconds < 60) return `${Math.round(seconds)}${sSuffix}`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s === 0
      ? `${m}${mSuffix}`
      : `${m}${mSuffix} ${String(s).padStart(2, "0")}${sSuffix}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}${hSuffix} ${String(m).padStart(2, "0")}${mSuffix}`;
}

/** Epoch ms of Bangkok-local midnight for the day containing `epochMs`. */
export function bangkokDayStartMs(epochMs: number): number {
  return Math.floor((epochMs + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}

/** Seconds since Bangkok-local midnight for `epochMs` (0 ≤ s < 86400). */
export function bangkokSecOfDay(epochMs: number): number {
  return (epochMs - bangkokDayStartMs(epochMs)) / 1000;
}
