import { useAppStore } from "../../stores/useAppStore";
import { useT } from "../../i18n";

export function AboutTab() {
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const t = useT();

  const simulatedLines = routes.filter((r) => r.gtfsRouteId !== null || r.syntheticSchedule !== null);
  const trackOnlyLines = routes.filter((r) => r.gtfsRouteId === null && r.syntheticSchedule === null);

  return (
    <div data-testid="about-tab" className="space-y-4 px-3 py-2 text-xs text-ink-muted">
      <div>
        <h2 className="text-sm font-semibold text-ink">{t("nav.title")}</h2>
        <p className="mt-1 leading-relaxed">
          {t("about.description")}
        </p>
      </div>

      <div className="rounded-lg bg-surface-sunken p-2.5">
        <h3 className="font-medium text-ink">{t("about.networkScope")}</h3>
        <ul className="mt-1.5 space-y-1">
          <li className="flex justify-between">
            <span>{t("about.simulatedLines")}</span>
            <span className="font-semibold text-ink">{simulatedLines.length}</span>
          </li>
          <li className="flex justify-between">
            <span>{t("about.preRevenueLines")}</span>
            <span className="font-semibold text-ink">{trackOnlyLines.length}</span>
          </li>
          <li className="flex justify-between">
            <span>{t("about.stationsIndexed")}</span>
            <span className="font-semibold text-ink">{stations.length > 0 ? stations.length : "198"}</span>
          </li>
          <li className="flex justify-between">
            <span>{t("about.simulationClock")}</span>
            <span className="font-semibold text-ink">{t("about.clockTz")}</span>
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-medium text-ink">{t("about.dataSources")}</h3>
        <ul className="mt-1.5 space-y-1 leading-relaxed">
          <li>
            • <strong>{t("about.trackGeometry")}</strong> ©{" "}
            <a
              href="https://www.openstreetmap.org"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              OpenStreetMap
            </a>{" "}
            {t("about.osmContributors")}
          </li>
          <li>
            • <strong>{t("about.timetablesStations")}</strong> {t("about.namtangAttribution")}
          </li>
          <li>
            • <strong>{t("about.vectorBasemap")}</strong>{" "}
            <a
              href="https://openfreemap.org"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              OpenFreeMap
            </a>{" "}
            (Liberty, Bright, Positron).
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-edge p-2.5">
        <h3 className="font-medium text-ink">{t("about.privacyHeader")}</h3>
        <p className="mt-1 leading-relaxed">
          {t("about.privacyBody")}
        </p>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
        <h3 className="font-semibold text-ink">{t("about.sponsorshipHeader")}</h3>
        <p className="mt-1 leading-relaxed">
          {t("about.sponsorshipBody")}
        </p>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <a
            href="https://github.com/sponsors/naiiytom"
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <span>💖</span> {t("about.sponsorGithub")}
          </a>
        </div>
        <div className="mt-2 rounded-md bg-surface-sunken/80 p-2 text-[11px] leading-relaxed">
          <p className="font-medium text-ink">{t("about.promptPayTitle")}</p>
          <p className="mt-0.5 text-ink-muted">
            {t("about.promptPayBody")}
          </p>
        </div>
      </div>

      <div className="pt-1 text-center text-[10px] text-ink-subtle">
        <p>{t("about.versionLicense")}</p>
        <p className="mt-0.5">
          <a
            href="https://github.com/naiiytom/tha-metro-mini-3d"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            {t("about.githubRepo")}
          </a>
        </p>
      </div>
    </div>
  );
}
