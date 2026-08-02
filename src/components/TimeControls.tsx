import { useEffect, useState } from "react";
import { activeSimClient } from "../sim/SimClient";
import { useAppStore, type Warp } from "../stores/useAppStore";

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
    <div className="pointer-events-auto rounded-xl border border-white/40 bg-white/70 px-4 py-3 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5">
      {engineStatus === "error" ? (
        <p className="max-w-xs text-xs text-red-600">
          Engine error: {engineError ?? "unknown"}
        </p>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">
              {engineStatus === "ready" ? clockText : "--:--:--"}
            </span>
            <span className="text-xs text-slate-600">
              Bangkok{engineStatus === "loading" ? " · starting engine…" : ""}
            </span>
            {engineStatus === "ready" && (
              <span className="text-xs text-slate-700">
                {vehicleCount} train{vehicleCount === 1 ? "" : "s"}
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
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  w === warp
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200/70 text-slate-700 hover:bg-slate-300"
                }`}
              >
                {w}×
              </button>
            ))}
            <button
              type="button"
              disabled={engineStatus !== "ready"}
              onClick={() => activeSimClient.current?.resetToNow()}
              className="ml-2 rounded-md bg-slate-200/70 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-40"
            >
              Now
            </button>
          </div>
          {validation && (
            <p className="text-[10px] text-slate-600">
              feed {validation.feedVersion} · {validation.routes} routes ·{" "}
              {validation.stations} stations · {validation.patterns} patterns ·{" "}
              {validation.runs} runs · {validation.services} services
            </p>
          )}
        </div>
      )}
    </div>
  );
}
