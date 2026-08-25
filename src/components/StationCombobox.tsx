import { useEffect, useId, useMemo, useReducer, useRef, type KeyboardEvent } from "react";
import { countMatches, groupByRoute, stationOptions } from "../search/stationSearch";
import { INITIAL_COMBO, comboReducer, type ComboEvent, type ComboState } from "../search/comboboxState";
import type { StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";

export function StationCombobox({
  label,
  stations,
  routes,
  onPick,
  placeholder = "Search or browse stations…",
  autoFocus = false,
}: {
  label: string;
  stations: StationInfo[];
  routes: LineGeometry[];
  onPick: (s: StationInfo | null) => void;
  placeholder?: string;
  /** Default false: `RoutePlanner`'s two comboboxes (From/To) don't want a
   *  fight over which one grabs focus on open. `StationSearch`'s single
   *  combobox — issue #28's actual entry point — passes true so the panel
   *  opens with a browsable, focused list rather than an unfocused, closed
   *  one the user has to click a second time. React's `autoFocus` fires a
   *  real `focus` event on mount, which reaches this input's own `onFocus`
   *  handler below and opens the list the normal way — no separate open
   *  path to keep in sync. */
  autoFocus?: boolean;
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
  // The render loop below walks `groups` (grouped-by-route order), not
  // `visible` (flat alphabetical order) — those two orders diverge whenever
  // a typed query's alphabetical matches interleave routes. `flatIndex`
  // (assigned during the render walk) and `state.activeIndex` are indices
  // into the GROUPED order, so any lookup that resolves an index back to a
  // `StationInfo` (the Enter handler, below) must index into `flatOptions`,
  // not `visible` — indexing `visible` with a grouped-order index silently
  // picks the wrong station whenever the two orders disagree.
  const flatOptions = useMemo(() => groups.flatMap((g) => g.stations), [groups]);

  // Only the SEARCH (typed-query) path truncates (`filterStations`'s
  // `limit`) — the empty-query browse-all path never does (issue #28), so
  // there's nothing to disclose there. `totalMatches` lets the truncated
  // case say so instead of silently looking complete.
  const totalMatches = useMemo(
    () => (state.query.trim() === "" ? visible.length : countMatches(stations, state.query)),
    [stations, state.query, visible.length],
  );
  const truncated = totalMatches > visible.length;

  // Populated via each option button's ref callback below; keyed by the same
  // flat index the reducer's activeIndex uses, so arrow-key navigation can
  // scroll the highlighted row into view without a DOM query.
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (!state.open) return;
    optionRefs.current.get(state.activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [state.open, state.activeIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rawDispatch({ type: "move", delta: 1 });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rawDispatch({ type: "move", delta: -1 });
    } else if (e.key === "Enter") {
      const chosen = flatOptions[state.activeIndex];
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
          autoFocus={autoFocus}
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
            <li role="presentation" className="px-2 py-2 text-xs text-ink-subtle">
              No matching station.
            </li>
          )}
          {groups.map((group) => (
            // `role="presentation"` on every plain <li>/<ul> in this subtree
            // (here, the header div, and each option's <li> wrapper below)
            // neutralizes their IMPLICIT listitem/list roles — per the
            // WAI-ARIA listbox pattern, nothing between `role="listbox"` and
            // each `role="option"` may introduce an unexpected role, or a
            // screen reader can lose/misreport the listbox/option
            // relationship. Only `listbox` (the outer <ul>), `group` (the
            // per-route <ul> below) and `option` remain in the accessible
            // tree.
            <li key={group.routeIdx} role="presentation">
              <div
                role="presentation"
                className="sticky top-0 bg-surface-sunken px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted"
              >
                {routes[group.routeIdx]?.name ?? `Line ${group.routeIdx}`}
              </div>
              <ul role="group" aria-label={routes[group.routeIdx]?.name ?? `Line ${group.routeIdx}`}>
                {group.stations.map((s) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <li key={`${s.route_idx}-${s.station_idx}`} role="presentation">
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) optionRefs.current.set(index, el);
                          else optionRefs.current.delete(index);
                        }}
                        id={`${listId}-opt-${index}`}
                        role="option"
                        aria-selected={state.activeIndex === index}
                        tabIndex={-1}
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
      {state.open && truncated && (
        <p className="mt-1 px-1 text-[10px] text-ink-subtle">
          Showing {visible.length} of {totalMatches} matches — refine your search to see more.
        </p>
      )}
    </div>
  );
}
