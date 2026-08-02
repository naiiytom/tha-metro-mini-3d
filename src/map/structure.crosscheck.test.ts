import { describe, expect, it } from "vitest";
import { structureOfWay as tsStructureOfWay } from "./structure";
import { structureOfWay as mjsStructureOfWay } from "../../tools/lines.config.mjs";
import type { Structure } from "../types";

/**
 * structureOfWay is duplicated on purpose (src/map/structure.ts for the TS
 * frontend, tools/lines.config.mjs for the plain-node fetcher — node can't
 * import a .ts module). structure.test.ts and lines.config.test.mjs each
 * assert fixed expected outputs against their OWN copy, which does not catch
 * the realistic drift scenario: someone edits one copy's precedence logic
 * (and updates that copy's own test in the same change) while leaving the
 * other copy and its test untouched. Both per-copy test files would keep
 * passing while the fetcher stamps one structure and the renderer expects
 * another, silently, in committed data — exactly the failure the mirroring
 * exists to prevent.
 *
 * This test runs BOTH copies over one shared input table and asserts they
 * agree, so that scenario fails loudly here instead of shipping quietly.
 */

interface Case {
  readonly description: string;
  readonly tags: { tunnel?: string; bridge?: string; layer?: string };
  readonly fallback?: Structure;
}

const CASES: readonly Case[] = [
  { description: "plain tunnel=yes", tags: { tunnel: "yes" } },
  {
    // The exception both copies must agree on: building_passage falls
    // through to the bridge/layer/fallback checks instead of forcing
    // underground (see the long comment on both copies, commit 9ab9a06).
    description: "tunnel=building_passage falls through, not underground",
    tags: { tunnel: "building_passage" },
  },
  {
    description: "tunnel=building_passage with a positive layer -> elevated",
    tags: { tunnel: "building_passage", layer: "1" },
  },
  {
    // tunnel=no must beat a negative layer, not the other way around.
    description: "tunnel=no overrides a negative layer",
    tags: { tunnel: "no", layer: "-1" },
  },
  { description: "bridge=yes", tags: { bridge: "yes" } },
  { description: "bridge=no falls through to elevated, not layer", tags: { bridge: "no", layer: "-1" } },
  { description: "positive layer", tags: { layer: "2" } },
  { description: "negative layer", tags: { layer: "-2" } },
  { description: "no relevant tags, default fallback (omitted)", tags: {} },
  { description: "no relevant tags, explicit atGrade fallback", tags: {}, fallback: "atGrade" },
  { description: "no relevant tags, explicit underground fallback", tags: {}, fallback: "underground" },
];

describe("structureOfWay: TS copy and .mjs copy agree", () => {
  for (const { description, tags, fallback } of CASES) {
    it(description, () => {
      const tsResult = tsStructureOfWay(tags, fallback);
      const mjsResult = mjsStructureOfWay(tags, fallback);
      expect(
        mjsResult,
        `tools/lines.config.mjs's structureOfWay(${JSON.stringify(tags)}, ${JSON.stringify(fallback)}) ` +
          `returned "${mjsResult}" but src/map/structure.ts's copy returned "${tsResult}" — the two ` +
          `copies have drifted; the fetcher and the renderer will disagree on this way's structure.`,
      ).toBe(tsResult);
    });
  }
});
