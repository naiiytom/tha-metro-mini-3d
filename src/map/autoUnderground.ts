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
}

export const initialAutoState = (): AutoUndergroundState => ({
  auto: false,
  overridden: false,
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

  // The user changed it out from under us — that is the end of auto for this
  // session, whichever direction they moved it.
  if (prev.auto && !input.undergroundMode) {
    return { next: { auto: false, overridden: true }, setUndergroundTo: null };
  }
  if (prev.overridden) return { next: prev, setUndergroundTo: null };

  if (input.altitudeM === null) return { next: prev, setUndergroundTo: null };

  if (!prev.auto && input.altitudeM < ENGAGE_BELOW_M && !input.undergroundMode) {
    return { next: { ...prev, auto: true }, setUndergroundTo: true };
  }
  if (prev.auto && input.altitudeM > RELEASE_ABOVE_M) {
    return { next: { ...prev, auto: false }, setUndergroundTo: false };
  }
  return { next: prev, setUndergroundTo: null };
}
