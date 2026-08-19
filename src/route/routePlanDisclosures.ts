import type { RoutePlan } from "../sim/protocol";
import type { LineGeometry } from "../types";

/**
 * Which disclosure notes a planned route has to carry.
 *
 * `src/route/` is a new top-level directory, joining `src/hooks/` and
 * `src/search/` in not being listed in SRS §6's project structure. It exists
 * for the same reason those do: this is a pure function, kept out of the
 * component so it is unit-testable without a DOM.
 *
 * The per-leg rules reuse the existing per-line logic exactly — a
 * `syntheticSchedule` line contributes the APM's note, an `estimatedRunTimes`
 * line contributes Pink's — so a route plan can never make a weaker claim
 * about a line's times than the station board already makes.
 */
export interface PlanDisclosures {
  /** A leg runs on a synthesized timetable (the Suvarnabhumi APM). */
  synthetic: boolean;
  /** A leg's travel times are estimated (MRT Pink and its spur). */
  estimated: boolean;
  /** The plan actually contains a transfer, so the flat-buffer note applies. */
  transfers: boolean;
}

const NONE: PlanDisclosures = { synthetic: false, estimated: false, transfers: false };

export function planDisclosures(
  plan: RoutePlan | null,
  routes: LineGeometry[],
): PlanDisclosures {
  if (!plan || plan.unreachable) return { ...NONE };
  let synthetic = false;
  let estimated = false;
  let hasTransfer = false;
  for (const leg of plan.legs) {
    if (leg.kind === "transfer") {
      hasTransfer = true;
      continue;
    }
    // `!= null`, not `!== null`: network.json is routinely hand-edited in
    // this repo without a re-fetch, so a line that omits the field entirely
    // is `undefined`. Same rule LineSelector/StationBoard already follow.
    const line = routes[leg.routeIdx];
    if (line?.syntheticSchedule != null) synthetic = true;
    if (line?.estimatedRunTimes != null) estimated = true;
  }
  return {
    synthetic,
    estimated,
    // The engine's `transferTimesEstimated` is unconditionally true — it
    // describes the MODEL. Showing the note on a plan with no transfer would
    // be noise, so the UI-facing flag requires both.
    transfers: hasTransfer && plan.transferTimesEstimated,
  };
}
