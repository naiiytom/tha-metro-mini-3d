import { describe, expect, it } from "vitest";
import { mergeFetchedLines } from "./mergeNetwork.mjs";

const existing = {
  lines: [{ key: "a", v: 1 }, { key: "b", v: 1 }, { key: "c", v: 1 }],
  handPatches: [{ line: "a" }, { line: "b" }],
};

describe("mergeFetchedLines", () => {
  it("replaces only the fetched line and keeps the rest byte-identical, in registry order", () => {
    const out = mergeFetchedLines(["a", "b", "c"], [{ key: "b", v: 2 }], existing);
    expect(out.lines).toEqual([existing.lines[0], { key: "b", v: 2 }, existing.lines[2]]);
    expect(out.handPatches).toEqual([{ line: "a" }]);
  });

  it("throws rather than dropping a registry line it has no data for", () => {
    expect(() => mergeFetchedLines(["a", "b", "c", "d"], [{ key: "b" }], existing)).toThrow(/d/);
  });
});
