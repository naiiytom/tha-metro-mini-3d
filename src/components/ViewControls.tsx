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
  const nightThemeEnabled = useAppStore((s) => s.nightThemeEnabled);
  const setNightThemeEnabled = useAppStore((s) => s.setNightThemeEnabled);

  const row = (label: string, hint: string, on: boolean, set: (v: boolean) => void) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      title={hint}
      className={`flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-200/60 ${
        on ? "text-slate-800" : "text-slate-400"
      }`}
    >
      <span>{label}</span>
      <span
        className={`ml-2 h-3 w-6 shrink-0 rounded-full transition-colors ${
          on ? "bg-emerald-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-3" : ""
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
      {row("Shadows", "Higher fidelity, lower frame rate", shadowsEnabled, setShadowsEnabled)}
      {row(
        "Night theme",
        "Darken the basemap after dusk; turn off if a variant reads poorly on your display",
        nightThemeEnabled,
        setNightThemeEnabled,
      )}
    </div>
  );
}
