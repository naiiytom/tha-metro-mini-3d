import { MapContainer } from "./components/MapContainer";
import { NavigationPanel } from "./components/NavigationPanel";
import { StationBoard } from "./components/StationBoard";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";
import { useAppStore } from "./stores/useAppStore";

export default function App() {
  const uiHidden = useAppStore((s) => s.uiHidden);

  return (
    <div
      data-testid="map-container"
      className="relative h-dvh w-dvw overflow-hidden bg-slate-900"
    >
      <MapContainer />
      <NavigationPanel />
      {/* Below `md:`, TrainInspector/StationBoard join the bottom stack as
       * full-width sheets. `md:contents` makes this wrapper vanish from the
       * box tree at desktop widths, so each child restores its own `md:absolute`
       * corner/bottom-center position. */}
      <div
        data-testid="bottom-sheet-stack"
        className={
          uiHidden
            ? "hidden md:contents md:p-0"
            : "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:contents md:p-0"
        }
      >
        <TrainInspector />
        <StationBoard />
        <div className="contents md:pointer-events-none md:absolute md:inset-x-0 md:bottom-4 md:flex md:flex-col md:items-center md:gap-2">
          <TimeScrubber />
          <TimeControls />
        </div>
      </div>
    </div>
  );
}

