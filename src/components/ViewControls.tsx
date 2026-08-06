import { useEffect, useState } from "react";
import { BASEMAP_STYLES } from "../map/basemapStyles";
import { THEME_MODES } from "../map/themeMode";
import { useAppStore } from "../stores/useAppStore";

/**
 * View-mode toggles (SRS §F3.2 underground transparency, §3A.5 shadow
 * quality). Sits under the line selector — both are "what am I looking at"
 * controls, distinct from the time controls at the bottom.
 */
export function ViewControls() {
  const undergroundMode = useAppStore((s) => s.undergroundMode);
  const setUndergroundMode = useAppStore((s) => s.setUndergroundMode);
  const shadowsEnabled = useAppStore((s) => s.shadowsEnabled);
  const setShadowsEnabled = useAppStore((s) => s.setShadowsEnabled);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const basemapStyle = useAppStore((s) => s.basemapStyle);
  const setBasemapStyle = useAppStore((s) => s.setBasemapStyle);
  const ecoMode = useAppStore((s) => s.ecoMode);
  const setEcoMode = useAppStore((s) => s.setEcoMode);

  const [isFullscreen, setIsFullscreen] = useState(false);

  // The DOM owns this state, not the store: Esc exits fullscreen without
  // going through our handler, so a store boolean would go stale.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    // Not documentElement: `[data-testid="map-container"]` is App.tsx's own
    // top-level wrapper div, NOT a child of MapContainer.tsx despite the
    // testid's name — App and MapContainer are siblings. See App.tsx's own
    // comment on this element for why: it's the real common ancestor of
    // MapContainer, LineSelector, and the bottom-sheet stack, so fullscreening
    // it keeps every React-rendered overlay visible in fullscreen.
    const target = document.querySelector<HTMLElement>('[data-testid="map-container"]');
    void target?.requestFullscreen();
  };

  const row = (label: string, hint: string, on: boolean, set: (v: boolean) => void) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      title={hint}
      className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-200/60 md:px-1.5 md:py-1 md:text-xs ${
        on ? "text-slate-800" : "text-slate-400"
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-2 h-5 w-9 shrink-0 rounded-full transition-colors md:h-3 md:w-6 ${
          on ? "bg-emerald-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow transition-transform md:h-3 md:w-3 ${
            on ? "translate-x-4 md:translate-x-3" : ""
          }`}
        />
      </span>
    </button>
  );

  return (
    <div className="mt-2 border-t border-slate-200/70 pt-2">
      {row(
        "Underground view",
        "Fade the basemap and surface lines so tunnelled track is visible",
        undergroundMode,
        setUndergroundMode,
      )}
      {row(
        "Shadows",
        // The shadow frustum is a fixed ~4 km box around Siam (see
        // ThreeLayer.ts) — real, and the cost/benefit is measured there —
        // but it's core-only, not network-wide, and this toggle reads as a
        // global setting. Say so, rather than let a Rangsit/Lak Song user
        // discover it by watching shadows silently vanish (finding 6d).
        "Higher fidelity, lower frame rate — only near central Bangkok; no effect further out",
        shadowsEnabled,
        setShadowsEnabled,
      )}
      {row(
        "Eco mode",
        "Drop to about 1 frame per second to save battery — trains stay on schedule",
        ecoMode,
        setEcoMode,
      )}
      {row(
        "Fullscreen",
        "Fill the screen — press Esc to leave",
        isFullscreen,
        () => toggleFullscreen(),
      )}
      <div className="mt-1 px-3 py-2 md:px-1.5 md:py-1">
        <div className="mb-1 text-sm text-slate-500 md:text-xs">Theme</div>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex gap-1 rounded-md bg-slate-200/60 p-0.5"
        >
          {THEME_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              data-theme-mode={mode}
              onClick={() => setThemeMode(mode)}
              title={
                mode === "auto"
                  ? "Follow the simulated clock — dusk and dawn fade smoothly"
                  : mode === "light"
                    ? "Pinned to full-day lighting, whatever the clock says"
                    : "Always night colours, whatever the clock says"
              }
              className={`flex-1 rounded px-2 py-1.5 text-sm capitalize transition-colors md:py-0.5 md:text-xs ${
                themeMode === mode
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 px-3 py-2 md:px-1.5 md:py-1">
        <div className="mb-1 text-sm text-slate-500 md:text-xs">Basemap</div>
        <div role="radiogroup" aria-label="Basemap" className="flex gap-1 rounded-md bg-slate-200/60 p-0.5">
          {BASEMAP_STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={basemapStyle === s.key}
              data-basemap-style={s.key}
              onClick={() => setBasemapStyle(s.key)}
              className={`flex-1 rounded px-2 py-1.5 text-sm transition-colors md:py-0.5 md:text-xs ${
                basemapStyle === s.key
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
