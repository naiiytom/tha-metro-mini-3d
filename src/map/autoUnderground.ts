/**
 * Auto-engage the underground view while the camera is following a train that
 * goes below ground (roadmap item 5 — the last unbuilt piece of underground
 * mode).
 *
 * Pure decision function: no store, no map, no DOM. The caller feeds it the
 * current sample and applies whatever it returns.
 *
 * Decides on ALTITUDE, not the track's structure tag. A point tagged
 * `underground` can legitimately sit near the surface mid-ramp (see
 * tools/trackProfile.mjs's limitTrackGradient), and for "should the view
 * switch" where the train physically is beats what its segment is labelled.
 * Altitude is already in the vehicle buffer (LANE_Z), so this needs no track
 * lookup on the frame path.
 */

/** Engage below this depth. */
const ENGAGE_BELOW_M = -5;
/** Release above this depth. The gap between the two is the hysteresis band:
 *  a single threshold flickers the entire basemap at every portal straddle. */
const RELEASE_ABOVE_M = -1;

export interface AutoUndergroundState {
  /** Underground mode is ON because this module turned it on. */
  auto: boolean;
  /** The user toggled it by hand during this follow session. Stand down
   *  until follow ends — auto must never fight the user. */
  overridden: boolean;
  /** What this module currently believes `undergroundMode` is — the value
   *  it last observed or itself wrote. `null` only before the first
   *  observation of a follow session (no belief yet, so nothing to diff
   *  against). Any observed value that disagrees with this belief, in
   *  either direction, is a manual toggle: turning it OFF is the case the
   *  override guard exists for, but turning it ON is just as much a
   *  deliberate user action and must latch the same stand-down — otherwise
   *  a manual ON followed by a manual OFF (with auto never having engaged
   *  in between, so `prev.auto` was never true to key the old guard off of)
   *  re-engages auto on the very next tick, undoing the user's OFF within
   *  one frame. */
  known: boolean | null;
}

export const initialAutoState = (): AutoUndergroundState => ({
  auto: false,
  overridden: false,
  known: null,
});

export function decideAutoUnderground(
  prev: AutoUndergroundState,
  input: { following: boolean; altitudeM: number | null; undergroundMode: boolean },
): { next: AutoUndergroundState; setUndergroundTo: boolean | null } {
  // Follow ended: hand back whatever we borrowed, and forget the override so
  // the next follow session starts from a clean slate.
  if (!input.following) {
    if (prev.auto && input.undergroundMode) {
      return { next: initialAutoState(), setUndergroundTo: false };
    }
    return { next: initialAutoState(), setUndergroundTo: null };
  }

  // No belief yet this session: adopt whatever's already there as the
  // baseline. Not itself a diff, so it can't be mistaken for a user action.
  const known = prev.known ?? input.undergroundMode;

  // The observed value disagrees with our belief — the user changed it,
  // whichever direction. That is the end of auto for this session.
  if (input.undergroundMode !== known) {
    return { next: { auto: false, overridden: true, known: input.undergroundMode }, setUndergroundTo: null };
  }
  if (prev.overridden) return { next: { ...prev, known }, setUndergroundTo: null };

  if (input.altitudeM === null) return { next: { ...prev, known }, setUndergroundTo: null };

  if (!prev.auto && input.altitudeM < ENGAGE_BELOW_M && !input.undergroundMode) {
    return { next: { auto: true, overridden: false, known: true }, setUndergroundTo: true };
  }
  if (prev.auto && input.altitudeM > RELEASE_ABOVE_M) {
    return { next: { auto: false, overridden: false, known: false }, setUndergroundTo: false };
  }
  return { next: { ...prev, known }, setUndergroundTo: null };
}
