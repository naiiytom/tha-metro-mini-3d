import { describe, expect, it } from "vitest";
import { decideAutoUnderground, initialAutoState } from "./autoUnderground";

const follow = (altitudeM: number | null, undergroundMode = false) => ({
  following: true,
  altitudeM,
  undergroundMode,
});

describe("decideAutoUnderground", () => {
  it("engages when the followed train is well below ground", () => {
    const r = decideAutoUnderground(initialAutoState(), follow(-18));
    expect(r.setUndergroundTo).toBe(true);
    expect(r.next.auto).toBe(true);
  });

  it("does nothing while the train is above ground", () => {
    const r = decideAutoUnderground(initialAutoState(), follow(12));
    expect(r.setUndergroundTo).toBe(null);
    expect(r.next.auto).toBe(false);
  });

  it("disengages once the train is back at the surface", () => {
    const engaged = decideAutoUnderground(initialAutoState(), follow(-18)).next;
    const r = decideAutoUnderground(engaged, follow(0.5, true));
    expect(r.setUndergroundTo).toBe(false);
    expect(r.next.auto).toBe(false);
  });

  it("holds through the hysteresis band instead of flickering at a portal", () => {
    // Engage at -5, disengage at -1: everything between holds its state.
    let s = decideAutoUnderground(initialAutoState(), follow(-18)).next;
    for (const alt of [-4, -3, -2, -3, -4]) {
      const r = decideAutoUnderground(s, follow(alt, true));
      expect(r.setUndergroundTo).toBe(null);
      expect(r.next.auto).toBe(true);
      s = r.next;
    }
  });

  it("stands down permanently once the user toggles during the same follow", () => {
    // Auto turned it ON, then the user turned it OFF by hand. Auto must not
    // fight back on the next tick, even though the train is still deep.
    const engaged = decideAutoUnderground(initialAutoState(), follow(-18)).next;
    const overridden = decideAutoUnderground(engaged, follow(-18, false));
    expect(overridden.next.overridden).toBe(true);
    expect(overridden.setUndergroundTo).toBe(null);

    const still = decideAutoUnderground(overridden.next, follow(-20, false));
    expect(still.setUndergroundTo).toBe(null);
  });

  it("releases underground mode and resets when follow ends", () => {
    const engaged = decideAutoUnderground(initialAutoState(), follow(-18)).next;
    const r = decideAutoUnderground(engaged, {
      following: false,
      altitudeM: -18,
      undergroundMode: true,
    });
    expect(r.setUndergroundTo).toBe(false);
    expect(r.next.auto).toBe(false);
    expect(r.next.overridden).toBe(false);
  });

  it("clears an override when follow ends, so the next follow starts clean", () => {
    let s = decideAutoUnderground(initialAutoState(), follow(-18)).next;
    s = decideAutoUnderground(s, follow(-18, false)).next;
    expect(s.overridden).toBe(true);
    s = decideAutoUnderground(s, { following: false, altitudeM: null, undergroundMode: false }).next;
    expect(s.overridden).toBe(false);
    expect(decideAutoUnderground(s, follow(-18)).setUndergroundTo).toBe(true);
  });

  it("never touches a mode the user turned on themselves before following", () => {
    // Underground already ON, auto never engaged it: ending follow must not
    // turn off something auto did not turn on.
    const r = decideAutoUnderground(initialAutoState(), {
      following: false,
      altitudeM: null,
      undergroundMode: true,
    });
    expect(r.setUndergroundTo).toBe(null);
  });

  it("does nothing with no altitude sample", () => {
    expect(decideAutoUnderground(initialAutoState(), follow(null)).setUndergroundTo).toBe(null);
  });

  it("does not revert a manual OFF when auto never got the chance to engage", () => {
    // Regression for: user turns underground ON by hand while surfaced (auto
    // never engages, so `auto` stays false throughout), the train then goes
    // deep with no engage needed (already on), then the user turns it OFF by
    // hand. Auto must not spring back on next tick just because altitude is
    // still below the engage threshold and `auto` was never `true`.
    let s = initialAutoState();
    s = decideAutoUnderground(s, follow(10, true)).next; // 1: manual ON, surfaced
    expect(s.auto).toBe(false);

    const step2 = decideAutoUnderground(s, follow(-18, true)); // 2: now deep, still on
    expect(step2.setUndergroundTo).toBe(null);
    expect(step2.next.auto).toBe(false);
    s = step2.next;

    const step3 = decideAutoUnderground(s, follow(-18, false)); // 3: manual OFF, still deep
    expect(step3.setUndergroundTo).toBe(null); // must NOT re-engage
    expect(step3.next.auto).toBe(false);

    const step4 = decideAutoUnderground(step3.next, follow(-20, false));
    expect(step4.setUndergroundTo).toBe(null);
  });
});
