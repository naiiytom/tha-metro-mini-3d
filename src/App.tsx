import { LineSelector } from "./components/LineSelector";
import { MapContainer } from "./components/MapContainer";
import { RoutePlanner } from "./components/RoutePlanner";
import { StationBoard } from "./components/StationBoard";
import { StationSearch } from "./components/StationSearch";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";
import { useAppStore } from "./stores/useAppStore";

export default function App() {
  const uiHidden = useAppStore((s) => s.uiHidden);

  return (
    // data-testid="map-container" names the fullscreen TARGET (see
    // ViewControls.tsx's toggleFullscreen), not literally the map: this is
    // App's own top-level wrapper, because it's the real common ancestor of
    // MapContainer, LineSelector, and the bottom-sheet stack.
    // MapContainer.tsx's own div only ever receives MapLibre's injected DOM
    // plus the imperatively-appended TrainTooltip — never these
    // React-rendered overlays — so fullscreening that div instead would
    // hide every overlay the moment fullscreen engages.
    <div
      data-testid="map-container"
      className="relative h-dvh w-dvw overflow-hidden bg-slate-900"
    >
      <MapContainer />
      <LineSelector />
      {/* Below `md:`, TrainInspector/StationBoard join the bottom stack as
       * full-width sheets (avoids the top-right overlap with LineSelector /
       * MapLibre's NavigationControl at phone widths). `md:contents` makes
       * this wrapper vanish from the box tree at desktop widths, so each
       * child restores its own `md:absolute` corner/bottom-center position —
       * see each component's own responsive classes. */}
      <div
        data-testid="bottom-sheet-stack"
        // Two full, mutually exclusive class strings rather than always
        // applying the base list and conditionally appending "hidden" to
        // it: `hidden` must lose to `md:contents` at desktop widths, which
        // Tailwind v4 does resolve correctly today (responsive variants
        // emit after base utilities in the generated CSS, regardless of
        // where the class name sits in this attribute) — but that's an
        // implicit ordering dependency, the same one trainTooltip.ts's own
        // className comment argues against relying on. With only "hidden"
        // and "md:contents" present in the uiHidden branch, there's nothing
        // else in play for the cascade to have to get right.
        className={
          uiHidden
            ? "hidden md:contents md:p-0"
            : "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:contents md:p-0"
        }
      >
        <RoutePlanner />
        <StationSearch />
        <TrainInspector />
        <StationBoard />
        {/* At `md:` this inner wrapper becomes the real positioned box (the
         * outer one just vanished via `md:contents`), reproducing today's
         * exact bottom-center stack byte-for-byte. Below `md:` it vanishes
         * instead, so TimeScrubber/TimeControls join the outer flex column
         * as plain full-width sheet rows, right after the selection panels. */}
        <div className="contents md:pointer-events-none md:absolute md:inset-x-0 md:bottom-4 md:flex md:flex-col md:items-center md:gap-2">
          <TimeScrubber />
          <TimeControls />
        </div>
      </div>
    </div>
  );
}
