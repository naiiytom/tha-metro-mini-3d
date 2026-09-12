import { useAppStore } from "../stores/useAppStore";
import type { LineGeometry } from "../types";
import { useT } from "../i18n";

export interface LineRowProps {
  line: LineGeometry;
  routeIdx: number;
}

/**
 * One toggleable line row — its own component so it calls the store's
 * `isRouteVisible` selector directly instead of re-deriving with a raw array lookup.
 */
export function LineRow({ line, routeIdx }: LineRowProps) {
  const t = useT();
  const visible = useAppStore((s) => s.isRouteVisible(routeIdx));
  const toggleRoute = useAppStore((s) => s.toggleRoute);
  const primaryLang = useAppStore((s) => s.primaryLang);

  const displayName = primaryLang === "th" && line.nameTh ? line.nameTh : line.name;

  return (
    <li>
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => toggleRoute(routeIdx)}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-sunken md:px-1.5 md:py-1 md:text-xs ${
          visible ? "text-ink" : "text-ink-subtle"
        }`}
      >
        <span
          className="inline-block h-2 w-4 shrink-0 rounded-sm"
          style={{ background: line.color, opacity: visible ? 1 : 0.3 }}
        />
        <span className="truncate">{displayName}</span>
        {line.preRevenue ? (
          <span
            data-testid="pre-revenue-badge"
            className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700"
          >
            {t("lines.badgePreRevenue")}
          </span>
        ) : line.syntheticSchedule !== null ? (
          <span
            className="ml-auto shrink-0 rounded bg-note-bg px-1 text-[9px] uppercase text-note-ink"
            title={t("notes.syntheticSchedule")}
            data-testid="synthetic-schedule-badge"
          >
            {t("lines.badgeEstimated")}
          </span>
        ) : line.estimatedRunTimes != null ? (
          <span
            data-testid="estimated-run-times-badge"
            className="ml-auto shrink-0 rounded bg-note-bg px-1 text-[9px] uppercase text-note-ink"
            title={t("notes.estimatedRunTimes")}
          >
            {t("lines.badgeEstTimes")}
          </span>
        ) : line.gtfsRouteId === null ? (
          <span className="ml-auto shrink-0 text-[9px] uppercase text-ink-muted">
            {t("lines.badgeTrackOnly")}
          </span>
        ) : null}
      </button>
    </li>
  );
}
