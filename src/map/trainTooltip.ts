import type { Map as MapLibreMap } from "maplibre-gl";
import { LANE_RUN_IDX, LANE_X, LANE_Y, VEHICLE_STRIDE } from "../sim/protocol";
import { localToLngLat } from "./coordinates";

/**
 * Scan an interpolated vehicle buffer for `runIdx`'s current position.
 * Extracted from `capture()` so the scan itself is unit-testable without a
 * DOM or a MapLibre map instance — same rationale as `followCamera.ts`'s
 * `yawToBearing`/`lerpBearing` exports.
 */
export function findVehiclePosition(
  vehicles: Float32Array,
  count: number,
  runIdx: number,
): { x: number; y: number } | null {
  for (let i = 0; i < count; i++) {
    const o = i * VEHICLE_STRIDE;
    if (vehicles[o + LANE_RUN_IDX] === runIdx) {
      return { x: vehicles[o + LANE_X], y: vehicles[o + LANE_Y] };
    }
  }
  return null;
}

/**
 * Whether a projected screen point is far enough outside the canvas that the
 * tooltip should hide rather than clamp/scroll into view. Exported for tests.
 */
export function isOffScreen(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
): boolean {
  return x < -margin || y < -margin || x > canvasWidth + margin || y > canvasHeight + margin;
}

/** How far off-canvas (px) the projected point can drift before the label hides. */
const TOOLTIP_OFFSCREEN_MARGIN_PX = 80;

/**
 * On-map label that tracks the selected train's live screen position — shown
 * whenever a train is selected, independent of the "follow" camera lock
 * (contrast `FollowCamera.capture`, which is gated on `following`).
 *
 * Split into capture/apply for the same reason as `FollowCamera`
 * (`followCamera.ts`): `capture()` runs inside the layer's render pass, where
 * the interpolated vehicle buffer already exists — it only reads a position,
 * never touches the DOM. `apply()` runs in the rAF loop, after the camera has
 * moved for this frame, and is the only place that writes to the DOM.
 *
 * Deliberately not a React component: its position updates every frame, and
 * per-frame data must never go through React/Zustand (SRS §3A.7). Content
 * (headsign/next-stop text) is UI-rate and is set via plain DOM mutation from
 * a 1 Hz poll driven by MapContainer.tsx — see `setContent()`.
 */
export class TrainTooltip {
  private readonly el: HTMLDivElement;
  private readonly dot: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private capturedX: number | null = null;
  private capturedY: number | null = null;
  private selected = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.dataset.testid = "train-tooltip";
    // No z-index: the codebase has none anywhere, and natural DOM order
    // already stacks this beneath LineSelector/TrainInspector/etc. (they
    // mount later in App.tsx's JSX than MapContainer). No Tailwind translate
    // utilities either — apply() sets the full `transform` imperatively, and
    // a class-based transform would just be clobbered by that inline style.
    // Deliberately no `flex`/`items-center` here: the only `display` utility
    // this element ever carries is `hidden`, toggled on/off in apply() — a
    // second display utility (e.g. `flex`) for the visible state would leave
    // the outcome dependent on Tailwind's internal class ordering rather than
    // anything explicit. The route-color dot is a nested inline-block span.
    this.el.className =
      "pointer-events-none absolute left-0 top-0 hidden max-w-[70vw] overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-white/40 bg-white/85 px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-lg shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5";

    this.dot = document.createElement("span");
    this.dot.className = "mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle";
    this.el.appendChild(this.dot);

    // Built via createElement/textContent, not innerHTML, so run headsigns
    // and station names (GTFS feed text, not user input, but no reason to
    // trust it as markup) can never be interpreted as HTML.
    this.text = document.createElement("span");
    this.text.className = "align-middle";
    this.el.appendChild(this.text);

    container.appendChild(this.el);
  }

  /** Per-frame: called from layer.beforeRender with the same interpolated
   *  buffer used for click hit-testing and the follow camera. Pass
   *  `selectedRunIdx` unconditionally (not gated on `following`) — that's
   *  what makes the tooltip track whenever a train is selected, not only
   *  while the camera is locked onto it. */
  capture(vehicles: Float32Array, count: number, selectedRunIdx: number | null): void {
    this.selected = selectedRunIdx !== null;
    // findVehiclePosition returns null both when nothing is selected and
    // when the selected run isn't currently active (finished, or not yet
    // started) — either way there's nowhere to draw the label this frame.
    const pos = selectedRunIdx === null ? null : findVehiclePosition(vehicles, count, selectedRunIdx);
    this.capturedX = pos?.x ?? null;
    this.capturedY = pos?.y ?? null;
  }

  /** Move the label onto the captured position. Call once per rAF, after the
   *  camera itself has been moved for this frame. `uiHidden` mirrors the
   *  store's mobile "hide UI" toggle — without it, this DOM-owned element
   *  (unlike every React-rendered overlay) stayed up under "hide UI", since
   *  nothing else ever told it to hide. */
  apply(map: MapLibreMap, uiHidden = false): void {
    if (uiHidden || !this.selected || this.capturedX === null || this.capturedY === null) {
      this.el.classList.add("hidden");
      return;
    }
    const p = map.project(localToLngLat(this.capturedX, this.capturedY));
    const canvas = map.getCanvas();
    if (isOffScreen(p.x, p.y, canvas.clientWidth, canvas.clientHeight, TOOLTIP_OFFSCREEN_MARGIN_PX)) {
      this.el.classList.add("hidden");
      return;
    }
    this.el.classList.remove("hidden");
    // Anchors the bubble's bottom-center ~10px above the train in one
    // imperative transform (see the className comment above for why this
    // can't be a Tailwind translate utility).
    this.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, calc(-100% - 10px))`;
  }

  /** UI-rate content update (headsign/next-stop text) — not per-frame. */
  setContent(color: string, label: string): void {
    this.dot.style.background = color;
    this.text.textContent = label;
  }

  dispose(): void {
    this.el.remove();
  }
}
