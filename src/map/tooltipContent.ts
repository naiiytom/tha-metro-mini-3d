import { translate } from "../i18n";
import { activeSimClient } from "../sim/SimClient";
import { formatCountdown } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import type { TrainTooltip } from "./trainTooltip";

const PLACEHOLDER_COLOR = "#94a3b8";

/**
 * Keeps the on-map train tooltip's TEXT (headsign / next stop) current: a
 * 1 Hz poll plus an immediate refresh on selection or language change. UI-rate
 * only — the tooltip's per-frame position is `TrainTooltip.apply()`'s job.
 * Returns a dispose function.
 *
 * The placeholder ("Train {idx}") is written only on a selection change, not
 * on every poll, mirroring TrainInspector.tsx: writing it every tick flashed
 * the resolved label back to the placeholder once a second while the query
 * was in flight.
 */
export function installTooltipContent(tooltip: TrainTooltip): () => void {
  const refresh = async (showPlaceholder: boolean) => {
    const { selectedRunIdx, primaryLang } = useAppStore.getState();
    const client = activeSimClient.current;
    if (selectedRunIdx === null || !client) return;
    if (showPlaceholder) {
      tooltip.setContent(
        PLACEHOLDER_COLOR,
        translate(primaryLang, "tooltip.trainFallback", { runIdx: selectedRunIdx }),
      );
    }
    try {
      const detail = await client.getRunDetail(selectedRunIdx, client.getSimNow());
      // Bail on a stale response after the user re-selected mid-flight.
      if (useAppStore.getState().selectedRunIdx !== selectedRunIdx) return;
      if (!detail) {
        tooltip.setContent(PLACEHOLDER_COLOR, translate(primaryLang, "tooltip.tripEnded"));
        return;
      }
      const color = `#${detail.color_rgb.toString(16).padStart(6, "0")}`;
      const headsign =
        primaryLang === "th" && detail.headsign_th ? detail.headsign_th : detail.headsign;
      const next =
        detail.next_station !== null && detail.next_arrival_in_s !== null
          ? translate(primaryLang, "tooltip.nextArrival", {
              station: detail.next_station,
              time: formatCountdown(detail.next_arrival_in_s, primaryLang),
            })
          : "";
      tooltip.setContent(color, `${headsign}${next}`);
    } catch {
      // Worker torn down mid-flight; the next poll or selection re-queries.
    }
  };

  const timer = setInterval(() => void refresh(false), 1000);
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.selectedRunIdx !== prev.selectedRunIdx || state.primaryLang !== prev.primaryLang) {
      void refresh(state.selectedRunIdx !== prev.selectedRunIdx);
    }
  });
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
