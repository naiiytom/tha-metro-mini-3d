import { describe, expect, it } from "vitest";
import {
  bangkokDayStartMs,
  bangkokSecOfDay,
  DAY_MS,
  formatCountdown,
  formatServiceSec,
} from "./time";

/** 2026-07-30 12:34:56 Bangkok = 05:34:56 UTC. */
const NOON_ISH = Date.UTC(2026, 6, 30, 5, 34, 56);

describe("formatServiceSec", () => {
  it("formats seconds since service-day midnight as HH:MM", () => {
    expect(formatServiceSec(0)).toBe("00:00");
    expect(formatServiceSec(3600)).toBe("01:00");
    expect(formatServiceSec(12 * 3600 + 34 * 60)).toBe("12:34");
    expect(formatServiceSec(86_399)).toBe("23:59");
  });

  it("wraps times that spill past midnight", () => {
    // A run scheduled at 25:10 on its own service day is 01:10 on the clock.
    expect(formatServiceSec(25 * 3600 + 10 * 60)).toBe("01:10");
    expect(formatServiceSec(86_400)).toBe("00:00");
  });

  it("does not produce negative components", () => {
    expect(formatServiceSec(-60)).toBe("23:59");
  });
});

describe("formatCountdown", () => {
  it("reports anything due or past as due", () => {
    expect(formatCountdown(0)).toBe("due");
    expect(formatCountdown(-30)).toBe("due");
  });

  it("uses seconds under a minute", () => {
    expect(formatCountdown(45)).toBe("45s");
    expect(formatCountdown(59)).toBe("59s");
  });

  it("uses minutes and seconds under an hour", () => {
    expect(formatCountdown(60)).toBe("1m");
    expect(formatCountdown(150)).toBe("2m 30s");
    expect(formatCountdown(3599)).toBe("59m 59s");
  });

  it("uses hours and zero-padded minutes past an hour", () => {
    expect(formatCountdown(3600)).toBe("1h 00m");
    expect(formatCountdown(3600 + 5 * 60)).toBe("1h 05m");
  });

  it("formats countdowns in Thai when requested", () => {
    expect(formatCountdown(0, "th")).toBe("ถึงแล้ว");
    expect(formatCountdown(-10, "th")).toBe("ถึงแล้ว");
    expect(formatCountdown(45, "th")).toBe("45 วิ");
    expect(formatCountdown(60, "th")).toBe("1 นาที");
    expect(formatCountdown(150, "th")).toBe("2 นาที 30 วิ");
    expect(formatCountdown(3600, "th")).toBe("1 ชม. 00 นาที");
    expect(formatCountdown(3600 + 5 * 60, "th")).toBe("1 ชม. 05 นาที");
  });
});

describe("bangkok day arithmetic", () => {
  it("finds Bangkok-local midnight for an instant", () => {
    const start = bangkokDayStartMs(NOON_ISH);
    // 2026-07-30 00:00 Bangkok = 2026-07-29 17:00 UTC.
    expect(new Date(start).toISOString()).toBe("2026-07-29T17:00:00.000Z");
  });

  it("returns seconds since that midnight, always within the day", () => {
    expect(bangkokSecOfDay(NOON_ISH)).toBe(12 * 3600 + 34 * 60 + 56);
    expect(bangkokSecOfDay(bangkokDayStartMs(NOON_ISH))).toBe(0);
  });

  it("is stable across a whole day of samples", () => {
    const start = bangkokDayStartMs(NOON_ISH);
    for (let h = 0; h < 24; h++) {
      const t = start + h * 3_600_000;
      expect(bangkokDayStartMs(t)).toBe(start);
      expect(bangkokSecOfDay(t)).toBe(h * 3600);
    }
    // One millisecond into the next day rolls over.
    expect(bangkokDayStartMs(start + DAY_MS)).toBe(start + DAY_MS);
  });
});
