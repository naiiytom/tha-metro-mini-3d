import { describe, expect, it } from "vitest";
import {
  loadTrainScale,
  parseTrainScale,
  saveTrainScale,
  TRAIN_SCALE_KEY,
  TRAIN_SCALES,
} from "./trainScale";

describe("trainScale definitions", () => {
  it("defines 1x, 1.5x, 3x, and 5x scale options", () => {
    expect(TRAIN_SCALES.map((s) => s.scale)).toEqual([1, 1.5, 3, 5]);
    expect(TRAIN_SCALES.map((s) => s.label)).toEqual(["1x", "1.5x", "3x", "5x"]);
  });
});

describe("parseTrainScale", () => {
  it("defaults to 1 for null or empty string", () => {
    expect(parseTrainScale(null)).toBe(1);
    expect(parseTrainScale("")).toBe(1);
    expect(parseTrainScale("invalid")).toBe(1);
  });

  it("parses valid scale string values", () => {
    expect(parseTrainScale("1")).toBe(1);
    expect(parseTrainScale("1.5")).toBe(1.5);
    expect(parseTrainScale("3")).toBe(3);
    expect(parseTrainScale("5")).toBe(5);
  });

  it("migrates legacy 2x scale to 3x", () => {
    expect(parseTrainScale("2")).toBe(3);
  });
});

describe("loadTrainScale & saveTrainScale", () => {
  it("loads default scale when storage is empty", () => {
    const storage = { getItem: () => null };
    expect(loadTrainScale(storage)).toBe(1);
  });

  it("loads stored scale value", () => {
    const storage = { getItem: (key: string) => (key === TRAIN_SCALE_KEY ? "3" : null) };
    expect(loadTrainScale(storage)).toBe(3);
  });

  it("tolerates throwing storage gracefully on load", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
    };
    expect(loadTrainScale(storage)).toBe(1);
  });

  it("saves scale value as string", () => {
    let savedKey = "";
    let savedVal = "";
    const storage = {
      setItem: (key: string, val: string) => {
        savedKey = key;
        savedVal = val;
      },
    };
    saveTrainScale(5, storage);
    expect(savedKey).toBe(TRAIN_SCALE_KEY);
    expect(savedVal).toBe("5");
  });

  it("tolerates throwing storage gracefully on save", () => {
    const storage = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveTrainScale(1.5, storage)).not.toThrow();
  });
});
