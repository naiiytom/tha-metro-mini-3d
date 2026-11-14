/**
 * Bangkok clock arithmetic, kept free of UI imports so the sim worker can use
 * it without pulling the i18n dictionaries into the worker bundle.
 *
 * Asia/Bangkok is a fixed UTC+7 offset with no DST, so this is exact
 * (ENGINE_CONTRACT.md §5).
 */

export const BANGKOK_OFFSET_MS = 7 * 3_600_000;
export const DAY_MS = 86_400_000;
export const DAY_SEC = 86_400;

/** Epoch ms of Bangkok-local midnight for the day containing `epochMs`. */
export function bangkokDayStartMs(epochMs: number): number {
  return Math.floor((epochMs + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}

/** Seconds since Bangkok-local midnight for `epochMs` (0 ≤ s < 86400). */
export function bangkokSecOfDay(epochMs: number): number {
  return (epochMs - bangkokDayStartMs(epochMs)) / 1000;
}

/** Split an epoch-ms instant into the Bangkok service-day fields the engine takes. */
export function bangkokFields(simEpochMs: number): { dateYyyymmdd: number; secOfDay: number } {
  // Shift to Bangkok local, then read the wall-clock fields with UTC getters.
  const local = new Date(simEpochMs + BANGKOK_OFFSET_MS);
  return {
    dateYyyymmdd:
      local.getUTCFullYear() * 10_000 + (local.getUTCMonth() + 1) * 100 + local.getUTCDate(),
    secOfDay: bangkokSecOfDay(simEpochMs),
  };
}
