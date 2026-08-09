import { describe, expect, it } from "vitest";
import { DECK_PROFILE, buildTrackDeck, buildTrackLine, poleTransform, splitByStructure } from "./trackGeometry";
import type { LineGeometry, TrackPoint } from "../types";

describe("deck profile by structure", () => {
  it("gives an at-grade line a shallow slab, not a viaduct box", () => {
    // A 2 m deep box at +0.5 m altitude would bury 1.5 m of deck under the
    // ground plane and z-fight with the basemap.
    expect(DECK_PROFILE.atGrade.depthM).toBeLessThan(1);
  });

  it("keeps the elevated viaduct at the MVP 1 dimensions", () => {
    expect(DECK_PROFILE.elevated.widthM).toBe(9);
    expect(DECK_PROFILE.elevated.depthM).toBe(2);
  });

  it("gives monorail-carrying structures a narrower beam than heavy rail", () => {
    expect(DECK_PROFILE.monorail.widthM).toBeLessThan(DECK_PROFILE.elevated.widthM);
  });
});

const p = (lng: number, s: TrackPoint[3]): TrackPoint => [lng, 13.7, 0, s];

const line = (track: TrackPoint[]): LineGeometry => ({
  key: "test",
  name: "Test Line",
  nameTh: "สายทดสอบ",
  color: "#ff0000",
  structure: "elevated",
  vehicleType: "heavy",
  gtfsRouteId: null,
  preRevenue: false,
  syntheticSchedule: null,
  relationId: 0,
  osmName: "test",
  track,
  stations: [],
});

describe("splitByStructure", () => {
  it("returns one run for a uniform line", () => {
    const runs = splitByStructure([p(0, "elevated"), p(1, "elevated"), p(2, "elevated")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it("splits where the structure changes, sharing the boundary vertex (finding 4a)", () => {
    // Both sides have 2+ points of their own — the "ordinary transition"
    // case finding 4a identified as completely unstitched: run 0 must
    // still end where run 1 begins, or the deck has a real, un-rendered
    // gap between the last elevated sample and the first underground one.
    // (Was: a clean partition with no shared vertex — that was the bug,
    // not a spec to preserve; this test is explicitly authorised to change.)
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "underground"),
      p(3, "underground"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[0].at(-1)?.[3]).toBe("underground"); // the shared vertex is native to run 1
    expect(runs[1][0][3]).toBe("underground");
  });

  it("covers a 2-point elevated->underground track with one clean run, not a self-duplicate", () => {
    // The smallest possible portal: exactly one point per side, so there is
    // no genuinely spare point anywhere (finding 4b's "irreducible" shape).
    // The old algorithm padded this into TWO runs, one of which was a
    // zero-length self-duplicate ([e,e]) — a wasted mesh. The fix drops
    // the degenerate run instead of emitting it: one clean 2-point run
    // covers the whole span with no gap.
    const runs = splitByStructure([p(0, "elevated"), p(1, "underground")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([p(0, "elevated"), p(1, "underground")]);
    expect(runs[0][0]).not.toEqual(runs[0][1]);
  });

  it("drops a one-point run rather than emitting a degenerate curve", () => {
    // CatmullRomCurve3 throws on fewer than 2 points.
    const runs = splitByStructure([p(0, "elevated")]);
    expect(runs).toHaveLength(0);
  });
});

// Regression coverage for a review round-1 finding: a run that changes
// structure at the very first or very last vertex of the track. Both
// findings below were only visible with a run that had a genuine,
// non-degenerate neighbour to borrow from (unlike the 2-point case above,
// where every solution is forced to self-duplicate somewhere).
describe("splitByStructure — boundary vertex at the very start/end (regression)", () => {
  it("shares a genuine boundary vertex for a trailing single-point run", () => {
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "elevated"),
      p(3, "underground"),
    ]);
    expect(runs).toHaveLength(2);
    // The shared vertex must be the true predecessor's own last point (e2,
    // lng 2) — not some other point that happened to be lying around.
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[1][0][0]).toBe(2);
  });

  it("shares a genuine boundary vertex for a leading single-point run", () => {
    const runs = splitByStructure([
      p(0, "underground"),
      p(1, "elevated"),
      p(2, "elevated"),
      p(3, "elevated"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[0].at(-1)?.[0]).toBe(1);
  });

  // The former regression test here ("does not read a sibling run's
  // already-borrowed point") pinned the OLD algorithm's behaviour for the
  // pathological 2-point case: two runs, one a self-duplicate [u1, u1],
  // the other clean [e0, u1]. Finding 4b changed that behaviour on
  // purpose — the degenerate run is now dropped rather than emitted, so
  // there is only one (clean) run left, not two to compare against each
  // other. See "covers a 2-point elevated->underground track with one
  // clean run, not a self-duplicate" above, which now owns this coverage.
});

describe("buildTrackDeck structure labelling (regression)", () => {
  it("labels a trailing single-point run with its OWN structure, not its predecessor's borrowed point", () => {
    const group = buildTrackDeck(
      line([p(0, "elevated"), p(1, "elevated"), p(2, "elevated"), p(3, "underground")]),
    );
    expect(group.children).toHaveLength(2);
    expect(group.children[0].userData.structure).toBe("elevated");
    expect(group.children[1].userData.structure).toBe("underground");
  });

  it("labels a leading single-point run with its OWN structure", () => {
    const group = buildTrackDeck(
      line([p(0, "underground"), p(1, "elevated"), p(2, "elevated"), p(3, "elevated")]),
    );
    expect(group.children).toHaveLength(2);
    expect(group.children[0].userData.structure).toBe("underground");
    expect(group.children[1].userData.structure).toBe("elevated");
  });
});

// Regression coverage for review round 2: a long (2+ point) run followed by
// a CHAIN of 2+ consecutive single-point runs reaching the track's tail (or
// start). Round 1's fix only special-cased "the last run borrows from its
// immediate predecessor" — correct for a single trailing singleton, but for
// a *chain* of them it can't see that a run two-or-more hops away (not its
// immediate predecessor) still has a genuinely spare point, so it re-reads
// an already-borrowed point instead and self-duplicates a run that didn't
// need to be.
describe("splitByStructure — a long run followed by a chain of singletons (regression)", () => {
  it("threads the loan through a 2-singleton chain without duplicating any run", () => {
    // e,e,e (long) | u (singleton) | a (singleton, trailing). The middle
    // run must borrow from the long run's spare point, not from the
    // trailing run — and the trailing run must then borrow from the
    // middle run's own point, not re-read the long run past it.
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "elevated"),
      p(3, "underground"),
      p(4, "atGrade"),
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toEqual([p(0, "elevated"), p(1, "elevated"), p(2, "elevated")]);
    expect(runs[1]).toEqual([p(2, "elevated"), p(3, "underground")]);
    expect(runs[2]).toEqual([p(3, "underground"), p(4, "atGrade")]);
    // Neither singleton-derived run is a self-duplicate.
    expect(runs[1][0]).not.toEqual(runs[1][1]);
    expect(runs[2][0]).not.toEqual(runs[2][1]);
  });

  it("threads the loan through a longer chain bounded by long runs on both sides", () => {
    // e,e (long) | u (singleton) | a (singleton) | e,e (long, reusing the
    // "elevated" label as a separate, non-adjacent run).
    const runs = splitByStructure([
      p(0, "elevated"),
      p(1, "elevated"),
      p(2, "underground"),
      p(3, "atGrade"),
      p(4, "elevated"),
      p(5, "elevated"),
    ]);
    expect(runs).toHaveLength(4);
    expect(runs[0]).toEqual([p(0, "elevated"), p(1, "elevated")]);
    expect(runs[1]).toEqual([p(1, "elevated"), p(2, "underground")]);
    // Finding 4a: run 2 (the last singleton in the chain) now ALSO picks
    // up run 3's own first point, because run 3 has 2+ points of its own
    // and never pads leftward on its own — without this, run 2 -> run 3
    // was exactly the "ordinary transition" gap the finding described.
    expect(runs[2]).toEqual([p(2, "underground"), p(3, "atGrade"), p(4, "elevated")]);
    expect(runs[3]).toEqual([p(4, "elevated"), p(5, "elevated")]);
    expect(runs[1][0]).not.toEqual(runs[1][1]);
    expect(runs[2][0]).not.toEqual(runs[2][1]);
    // The chain borrows in from the long run on its LEFT (index 0 wins
    // when a gap has a long neighbour on both sides — an arbitrary but
    // consistent choice): run 0 -> run 1 -> run 2 -> run 3 all connect
    // edge to edge now. (Was: run 2 -> run 3 deliberately did NOT share a
    // vertex, reasoned as "both sides already had enough points of their
    // own" — but having enough points for CatmullRomCurve3 is a different
    // question from deck continuity, and that gap was exactly finding 4a's
    // bug. This assertion is explicitly authorised to flip.)
    expect(runs[0].at(-1)).toEqual(runs[1][0]);
    expect(runs[1].at(-1)).toEqual(runs[2][0]);
    expect(runs[2].at(-1)).toEqual(runs[3][0]);
  });

  it("labels every run in a threaded chain with its own true structure", () => {
    const group = buildTrackDeck(
      line([
        p(0, "elevated"),
        p(1, "elevated"),
        p(2, "elevated"),
        p(3, "underground"),
        p(4, "atGrade"),
      ]),
    );
    expect(group.children).toHaveLength(3);
    expect(group.children[0].userData.structure).toBe("elevated");
    expect(group.children[1].userData.structure).toBe("underground");
    expect(group.children[2].userData.structure).toBe("atGrade");
  });

  it("drops the genuinely-irreducible all-singleton case's middle run instead of self-duplicating it (finding 4b)", () => {
    // e | u | a — every run a single point, no long run anywhere to borrow
    // a spare point from. Proven irreducible (see computeStructureRuns'
    // doc comment): something must give. The old algorithm duplicated the
    // middle ("underground") run into a zero-length, zero-area mesh
    // ([u1, u1]) rather than actually losing anything — a wasted draw call
    // that rasterizes nothing. Finding 4b: drop that run instead of
    // emitting it. Unreachable in real OSM data (a structure tag changing
    // at literally every point, start to finish), so low severity — but
    // pinned so a future refactor that changes which run gets dropped
    // doesn't slip by unnoticed. The outer two runs (which legitimately
    // connect the track's own first and last points to the middle) must
    // stay clean, and together they still cover the whole track with no
    // gap — the middle point is already their shared boundary vertex.
    const runs = splitByStructure([p(0, "elevated"), p(1, "underground"), p(2, "atGrade")]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([p(0, "elevated"), p(1, "underground")]);
    expect(runs[1]).toEqual([p(1, "underground"), p(2, "atGrade")]);
    expect(runs[0][0]).not.toEqual(runs[0][1]);
    expect(runs[1][0]).not.toEqual(runs[1][1]);
    expect(runs[0].at(-1)).toEqual(runs[1][0]); // still no gap between the two survivors

    const group = buildTrackDeck(line([p(0, "elevated"), p(1, "underground"), p(2, "atGrade")]));
    expect(group.children).toHaveLength(2);
    expect(group.children[0].userData.structure).toBe("elevated");
    expect(group.children[1].userData.structure).toBe("atGrade");
  });
});

// Local factory named differently from the file's existing `line` helper
// above (which takes a bare TrackPoint[] and hardcodes every other
// LineGeometry field) — this one takes a Partial<LineGeometry> override so
// `preRevenue` can be flipped per test.
const preRevenueLine = (over: Partial<LineGeometry> = {}): LineGeometry => ({
  key: "t", name: "T", nameTh: "T", color: "#888888",
  structure: "elevated", vehicleType: "heavy", gtfsRouteId: "1",
  preRevenue: false, syntheticSchedule: null, relationId: 1, osmName: "T",
  track: [[100.53, 13.74, 15, "elevated"], [100.54, 13.74, 15, "elevated"]],
  stations: [],
  ...over,
});

describe("pre-revenue treatment", () => {
  it("dashes the centerline of an unopened line", () => {
    const { material } = buildTrackLine(preRevenueLine({ preRevenue: true }));
    expect(material.dashed).toBe(true);
  });

  it("leaves an operational line's centerline solid", () => {
    const { material } = buildTrackLine(preRevenueLine());
    expect(material.dashed).toBe(false);
  });
});

describe("station support poles", () => {
  it("runs from the ground down to an underground platform", () => {
    // A raw makeScale(1,1,z) with z = -18 gives a negative scale: inverted
    // face winding, so the pole renders inside-out and lights black.
    const { scaleZ, centerZ } = poleTransform(-18);
    expect(scaleZ).toBeGreaterThan(0);
    expect(centerZ).toBeCloseTo(-9);
  });

  it("runs from the ground up to an elevated deck", () => {
    const { scaleZ, centerZ } = poleTransform(15);
    expect(scaleZ).toBeCloseTo(15);
    expect(centerZ).toBeCloseTo(7.5);
  });

  it("gives an at-grade platform a stub, not a zero-height pole", () => {
    // scale 0 collapses the geometry and produces NaN normals.
    const { scaleZ } = poleTransform(0.5);
    expect(scaleZ).toBeGreaterThan(0);
  });
});
