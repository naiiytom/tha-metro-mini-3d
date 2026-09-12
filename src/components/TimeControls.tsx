import { useEffect, useState } from "react";
import { activeSimClient } from "../sim/SimClient";
import { useAppStore, type Warp } from "../stores/useAppStore";
import { useT } from "../i18n";

/**
 * Bottom-center overlay: Bangkok sim clock, warp controls, vehicle count and
 * the validation summary line (the visible MVP 2 DoD artifact). Reads only
 * slow-changing UI state from Zustand; the clock text ticks on a local
 * interval so nothing re-renders per animation frame (ENGINE_CONTRACT.md §6).
 */

const WARPS: Warp[] = [1, 5, 10, 60];

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function TimeControls() {
  const engineStatus = useAppStore((s) => s.engineStatus);
  const engineError = useAppStore((s) => s.engineError);
  const validation = useAppStore((s) => s.validation);
  const warp = useAppStore((s) => s.warp);
  const vehicleCount = useAppStore((s) => s.vehicleCount);
  const t = useT();
  const [clockText, setClockText] = useState("--:--:--");

  useEffect(() => {
    if (engineStatus !== "ready") return;
    const tick = () => {
      const { clockEpochMs, clockSetAt, warp: w } = useAppStore.getState();
      // React bails out when the formatted string is unchanged.
      setClockText(clockFormat.format(clockEpochMs + (performance.now() - clockSetAt) * w));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [engineStatus]);

  if (engineStatus === "off") return null;

  return (
    <div
      data-testid="time-controls"
      className="panel-glass pointer-events-auto w-full rounded-xl border px-4 py-3 shadow-xl shadow-ink/10 backdrop-blur-md md:w-auto"
    >
      {engineStatus === "error" ? (
        <p className="max-w-xs text-xs text-danger-ink">
          {t("time.engineError", { error: engineError ?? "unknown" })}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-lg font-semibold tabular-nums text-ink">
              {engineStatus === "ready" ? clockText : "--:--:--"}
            </span>
            <span className="text-xs text-ink-muted">
              {t("time.bangkok")}{engineStatus === "loading" ? t("time.startingEngine") : ""}
            </span>
            {engineStatus === "ready" && (
              <span className="text-xs text-ink-muted">
                {vehicleCount === 1
                  ? t("time.trainsOne", { count: 1 })
                  : t("time.trainsOther", { count: vehicleCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {WARPS.map((w) => (
              <button
                key={w}
                type="button"
                disabled={engineStatus !== "ready"}
                onClick={() => activeSimClient.current?.setWarp(w)}
                className={`rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 md:px-2 md:py-1 md:text-xs ${
                  w === warp
                    ? "bg-ink text-surface"
                    : "bg-surface-sunken text-ink-muted hover:bg-edge hover:text-ink"
                }`}
              >
                {w}×
              </button>
            ))}
            <button
              type="button"
              disabled={engineStatus !== "ready"}
              onClick={() => activeSimClient.current?.resetToNow()}
              className="ml-2 rounded-md bg-surface-sunken px-3.5 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-edge hover:text-ink disabled:opacity-40 md:px-2 md:py-1 md:text-xs"
            >
              {t("time.now")}
            </button>
          </div>
          {validation && (
            <p className="text-[10px] text-ink-muted">
              {t("time.validationFeed", {
                feedVersion: validation.feedVersion,
                routes: validation.routes,
                stations: validation.stations,
                patterns: validation.patterns,
                runs: validation.runs,
                services: validation.services,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
