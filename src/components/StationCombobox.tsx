import { useId, useMemo, useReducer, type KeyboardEvent } from "react";
import { groupByRoute, stationOptions } from "../search/stationSearch";
import { INITIAL_COMBO, comboReducer, type ComboEvent, type ComboState } from "../search/comboboxState";
import type { StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";

export function StationCombobox({
  label,
  stations,
  routes,
  onPick,
  placeholder = "Search or browse stations…",
}: {
  label: string;
  stations: StationInfo[];
  routes: LineGeometry[];
  onPick: (s: StationInfo | null) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const options = useMemo(() => stationOptions(stations, ""), [stations]);

  const [state, rawDispatch] = useReducer(
    (s: ComboState, e: ComboEvent) => comboReducer(s, e, currentCount(s, e)),
    INITIAL_COMBO,
  );

  function currentCount(s: ComboState, e: ComboEvent): number {
    const query = e.type === "input" ? e.query : s.query;
    return stationOptions(stations, query).length;
  }

  const visible = useMemo(
    () => (state.query.trim() === "" ? options : stationOptions(stations, state.query)),
    [options, stations, state.query],
  );
  const groups = useMemo(() => groupByRoute(visible), [visible]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rawDispatch({ type: "move", delta: 1 });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rawDispatch({ type: "move", delta: -1 });
    } else if (e.key === "Enter") {
      const chosen = visible[state.activeIndex];
      if (chosen) {
        e.preventDefault();
        onPick(chosen);
        rawDispatch({ type: "pick", label: chosen.name_en });
      }
    } else if (e.key === "Escape") {
      rawDispatch({ type: "close" });
    }
  };

  let flatIndex = -1;

  return (
    <div className="px-4 py-2">
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
        <input
          type="text"
          role="combobox"
          aria-expanded={state.open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            state.activeIndex >= 0 ? `${listId}-opt-${state.activeIndex}` : undefined
          }
          aria-label={`${label} station`}
          value={state.query}
          onFocus={() => rawDispatch({ type: "focus" })}
          onBlur={() => window.setTimeout(() => rawDispatch({ type: "close" }), 120)}
          onChange={(e) => {
            rawDispatch({ type: "input", query: e.target.value });
            onPick(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="mt-1 block w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>

      {state.open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} station results`}
          className="mt-1 max-h-60 overflow-y-auto rounded-md border border-edge bg-surface"
        >
          {visible.length === 0 && (
            <li className="px-2 py-2 text-xs text-ink-subtle">No matching station.</li>
          )}
          {groups.map((group) => (
            <li key={group.routeIdx}>
              <div className="sticky top-0 bg-surface-sunken px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                {routes[group.routeIdx]?.name ?? `Line ${group.routeIdx}`}
              </div>
              <ul>
                {group.stations.map((s) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <li key={`${s.route_idx}-${s.station_idx}`}>
                      <button
                        type="button"
                        id={`${listId}-opt-${index}`}
                        role="option"
                        aria-selected={state.activeIndex === index}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onPick(s);
                          rawDispatch({ type: "pick", label: s.name_en });
                        }}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-sunken ${
                          state.activeIndex === index ? "bg-surface-sunken" : ""
                        }`}
                      >
                        <span
                          className="inline-block h-2 w-4 shrink-0 rounded-sm"
                          style={{ background: routes[s.route_idx]?.color ?? "#64748b" }}
                        />
                        {s.code !== "" && (
                          <span className="shrink-0 rounded bg-surface-sunken px-1 text-[10px] text-ink-muted">
                            {s.code}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-ink">{s.name_en}</span>
                          <span className="ml-1 text-ink-subtle">{s.name_th}</span>
                        </span>
                        {s.interchanges.length > 0 && (
                          <span className="shrink-0 text-[10px] text-ink-subtle" title="Interchange">
                            ⇄
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
