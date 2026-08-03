import { LineSelector } from "./components/LineSelector";
import { MapContainer } from "./components/MapContainer";
import { StationBoard } from "./components/StationBoard";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";
import { useAppStore } from "./stores/useAppStore";

export default function App() {
  const uiHidden = useAppStore((s) => s.uiHidden);

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-slate-900">
      <MapContainer />
      <LineSelector />
      {/* Below `md:`, TrainInspector/StationBoard join the bottom stack as
       * full-width sheets (avoids the top-right overlap with LineSelector /
       * MapLibre's NavigationControl at phone widths). `md:contents` makes
       * this wrapper vanish from the box tree at desktop widths, so each
       * child restores its own `md:absolute` corner/bottom-center position —
       * see each component's own responsive classes. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:contents md:p-0 ${
          uiHidden ? "hidden" : ""
        }`}
      >
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
