import { useEffect, useState } from "react";
import { BASEMAP_STYLES } from "../map/basemapStyles";
import { THEME_MODES } from "../map/themeMode";
import { TRAIN_SCALES } from "../map/trainScale";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";

/**
 * View-mode toggles (SRS §F3.2 underground transparency, §3A.5 shadow
 * quality). Sits under the line selector — both are "what am I looking at"
 * controls, distinct from the time controls at the bottom.
 */
export function ViewControls() {
  const undergroundMode = useAppStore((s) => s.undergroundMode);
  const setUndergroundMode = useAppStore((s) => s.setUndergroundMode);
  const map3D = useAppStore((s) => s.map3D);
  const setMap3D = useAppStore((s) => s.setMap3D);
  const shadowsEnabled = useAppStore((s) => s.shadowsEnabled);
  const setShadowsEnabled = useAppStore((s) => s.setShadowsEnabled);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const basemapStyle = useAppStore((s) => s.basemapStyle);
  const setBasemapStyle = useAppStore((s) => s.setBasemapStyle);
  const ecoMode = useAppStore((s) => s.ecoMode);
  const setEcoMode = useAppStore((s) => s.setEcoMode);
  const trainScale = useAppStore((s) => s.trainScale);
  const setTrainScale = useAppStore((s) => s.setTrainScale);
  const t = useT();

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

  const row = (
    label: string,
    hint: string,
    on: boolean,
    set: (v: boolean) => void,
    testId?: string,
  ) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={() => set(!on)}
      title={hint}
      className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-sunken md:px-1.5 md:py-1 md:text-xs ${
        on ? "text-ink" : "text-ink-subtle"
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-2 h-5 w-9 shrink-0 rounded-full transition-colors md:h-3 md:w-6 ${
          on ? "bg-accent" : "bg-edge"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-surface shadow transition-transform md:h-3 md:w-3 ${
            on ? "translate-x-4 md:translate-x-3" : ""
          }`}
        />
      </span>
    </button>
  );

  const themeLabel: Record<string, string> = {
    auto: t("view.themeAuto"),
    light: t("view.themeLight"),
    dark: t("view.themeDark"),
  };
  const themeHint: Record<string, string> = {
    auto: t("view.themeAutoHint"),
    light: t("view.themeLightHint"),
    dark: t("view.themeDarkHint"),
  };
  const basemapLabel: Record<string, string> = {
    liberty: t("view.basemapLiberty"),
    positron: t("view.basemapPositron"),
    "dark-matter": t("view.basemapDarkMatter"),
  };
  const trainScaleHint: Record<number, string> = {
    1: t("view.trainScale1xHint"),
    1.5: t("view.trainScale15xHint"),
    3: t("view.trainScale3xHint"),
    5: t("view.trainScale5xHint"),
  };

  return (
    <div className="mt-2 border-t border-edge pt-2">
      {row(
        t("view.perspective3d"),
        t("view.perspective3dHint"),
        map3D,
        setMap3D,
        "toggle-3d-perspective",
      )}
      {row(
        t("view.undergroundView"),
        t("view.undergroundViewHint"),
        undergroundMode,
        setUndergroundMode,
        "toggle-underground-view",
      )}
      {row(
        t("view.shadows"),
        t("view.shadowsHint"),
        shadowsEnabled,
        setShadowsEnabled,
        "toggle-shadows",
      )}
      {row(
        t("view.ecoMode"),
        t("view.ecoModeHint"),
        ecoMode,
        setEcoMode,
        "toggle-eco-mode",
      )}
      {row(
        t("view.fullscreen"),
        t("view.fullscreenHint"),
        isFullscreen,
        () => toggleFullscreen(),
        "toggle-fullscreen",
      )}
      <div className="mt-1 px-3 py-2 md:px-1.5 md:py-1">
        <div className="mb-1 text-sm text-ink-muted md:text-xs">{t("view.theme")}</div>
        <div
          role="radiogroup"
          aria-label={t("view.theme")}
          className="flex gap-1 rounded-md bg-surface-sunken p-0.5"
        >
          {THEME_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              data-theme-mode={mode}
              onClick={() => setThemeMode(mode)}
              title={themeHint[mode] ?? mode}
              className={`flex-1 rounded px-2 py-1.5 text-sm capitalize transition-colors md:py-0.5 md:text-xs ${
                themeMode === mode
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {themeLabel[mode] ?? mode}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 px-3 py-2 md:px-1.5 md:py-1">
        <div className="mb-1 text-sm text-ink-muted md:text-xs">{t("view.basemap")}</div>
        <div role="radiogroup" aria-label={t("view.basemap")} className="flex gap-1 rounded-md bg-surface-sunken p-0.5">
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
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {basemapLabel[s.key] ?? s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 px-3 py-2 md:px-1.5 md:py-1">
        <div className="mb-1 text-sm text-ink-muted md:text-xs">{t("view.trainSize")}</div>
        <div role="radiogroup" aria-label={t("view.trainSize")} className="flex gap-1 rounded-md bg-surface-sunken p-0.5">
          {TRAIN_SCALES.map((s) => (
            <button
              key={s.scale}
              type="button"
              role="radio"
              aria-checked={trainScale === s.scale}
              data-train-scale={s.scale}
              data-testid={`train-scale-${s.scale}`}
              onClick={() => setTrainScale(s.scale)}
              title={trainScaleHint[s.scale] ?? s.hint}
              className={`flex-1 rounded px-2 py-1.5 text-sm transition-colors md:py-0.5 md:text-xs ${
                trainScale === s.scale
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
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
