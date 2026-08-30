import { useAppStore } from "../../stores/useAppStore";

export function AboutTab() {
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);

  const simulatedLines = routes.filter((r) => r.gtfsRouteId !== null || r.syntheticSchedule !== null);
  const trackOnlyLines = routes.filter((r) => r.gtfsRouteId === null && r.syntheticSchedule === null);

  return (
    <div data-testid="about-tab" className="space-y-4 px-3 py-2 text-xs text-ink-muted">
      <div>
        <h2 className="text-sm font-semibold text-ink">Greater Bangkok Metro Mini 3D</h2>
        <p className="mt-1 leading-relaxed">
          Interactive, schedule-driven 3D visualization of Bangkok&apos;s urban rail network. Trains
          move along authentic geographic alignments and elevations based on published static GTFS
          timetables.
        </p>
      </div>

      <div className="rounded-lg bg-surface-sunken p-2.5">
        <h3 className="font-medium text-ink">Network Scope</h3>
        <ul className="mt-1.5 space-y-1">
          <li className="flex justify-between">
            <span>Simulated Lines:</span>
            <span className="font-semibold text-ink">{simulatedLines.length}</span>
          </li>
          <li className="flex justify-between">
            <span>Pre-Revenue (Track-Only):</span>
            <span className="font-semibold text-ink">{trackOnlyLines.length}</span>
          </li>
          <li className="flex justify-between">
            <span>Stations Indexed:</span>
            <span className="font-semibold text-ink">{stations.length > 0 ? stations.length : "198"}</span>
          </li>
          <li className="flex justify-between">
            <span>Simulation Clock:</span>
            <span className="font-semibold text-ink">Bangkok (UTC+7)</span>
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-medium text-ink">Data Sources & Attribution</h3>
        <ul className="mt-1.5 space-y-1 leading-relaxed">
          <li>
            • <strong>Track Geometry:</strong> ©{" "}
            <a
              href="https://www.openstreetmap.org"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              OpenStreetMap
            </a>{" "}
            contributors (ODbL).
          </li>
          <li>
            • <strong>Timetables & Stations:</strong> Namtang / OTP Open Data Programme (CC-BY 4.0).
          </li>
          <li>
            • <strong>Vector Basemap:</strong>{" "}
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
        <h3 className="font-medium text-ink">Privacy & Security Guarantee</h3>
        <p className="mt-1 leading-relaxed">
          Fully client-side static application. Zero analytics, zero cookies, zero external trackers,
          and no personal data collection.
        </p>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5">
        <h3 className="font-semibold text-ink">Support & Sponsorship</h3>
        <p className="mt-1 leading-relaxed">
          Greater Bangkok Metro Mini 3D is a community open-source project. If you find this project
          helpful, consider supporting ongoing development and hosting:
        </p>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <a
            href="https://github.com/sponsors/naiiytom"
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <span>💖</span> Sponsor on GitHub
          </a>
        </div>
        <div className="mt-2 rounded-md bg-surface-sunken/80 p-2 text-[11px] leading-relaxed">
          <p className="font-medium text-ink">PromptPay / Thai QR Payment</p>
          <p className="mt-0.5 text-ink-muted">
            Direct community support via PromptPay is welcomed for domestic contributors. Check the GitHub repository for sponsor QR details.
          </p>
        </div>
      </div>


      <div className="pt-1 text-center text-[10px] text-ink-subtle">
        <p>Version 1.0.0 · MIT License</p>
        <p className="mt-0.5">
          <a
            href="https://github.com/naiiytom/tha-metro-mini-3d"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            GitHub Repository
          </a>
        </p>
      </div>
    </div>
  );
}
