import type { Map as MapLibreMap } from "maplibre-gl";

export interface CameraControlOptions {
  /**
   * Called when an orbit gesture is performed (middle-drag, right-drag, or ctrl+left-drag).
   * Return `true` if the callback claimed/handled the bearing delta (e.g. routing it into
   * a follow camera offset), preventing MapLibre's bearing from being updated directly.
   */
  onOrbit?: (bearingDeltaDeg: number, pitchDeltaDeg: number) => boolean;
}

export interface CameraControls {
  dispose: () => void;
  isOrbiting: () => boolean;
}

/**
 * Camera input policy for the aerial view.
 *
 * | gesture                                                   | effect       |
 * |-----------------------------------------------------------|--------------|
 * | left-drag                                                 | pan (MapLibre's dragPan, untouched here — though `MapContainer.tsx` widens the map's click tolerance to 6px, which also raises dragPan's own click-vs-drag threshold) |
 * | wheel scroll                                              | zoom (MapLibre's scrollZoom, untouched) |
 * | middle-drag (press the wheel), right-drag, ctrl+left-drag | orbit — vertical pitches, horizontal turns, applied together |
 *
 * MapLibre's built-in drag-rotate is replaced wholesale, for two reasons it
 * cannot do itself: it has no middle-button binding, and its rotation is
 * anchored to the press point, which makes the bearing response depend on
 * where you clicked. This applies MapLibre's own directions and per-pixel
 * rates (pitch `-0.5 * dy`, bearing `+0.8 * dx`) uniformly across all three
 * buttons, with both axes in one motion so a diagonal drag tilts and turns.
 *
 * @returns a handle containing `dispose()` and `isOrbiting()`.
 */
export function installCameraControls(
  map: MapLibreMap,
  options: CameraControlOptions = {},
): CameraControls {
  const canvas = map.getCanvas();
  /** Degrees per pixel of travel — MapLibre's own rates. */
  const PITCH_DEG_PER_PX = 0.5;
  const BEARING_DEG_PER_PX = 0.8;

  // Owned entirely below; leaving it on would apply its own anchored rotation
  // on the same gesture, on top of this one.
  map.dragRotate.disable();

  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  /** Middle button, right button, or ctrl/⌘ + left — all orbit. */
  const isOrbitDrag = (e: PointerEvent) =>
    e.button === 1 || e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey));

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null || !isOrbitDrag(e)) return;
    // Middle-click otherwise triggers Windows/Linux autoscroll over the canvas.
    e.preventDefault();
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx === 0 && dy === 0) return;

    // Same signs as MapLibre's drag-rotate — drag up tilts toward the horizon,
    // drag right turns right. One jumpTo so a diagonal drag is a single camera
    // update, not two.
    const pitchDelta = -PITCH_DEG_PER_PX * dy;
    const bearingDelta = BEARING_DEG_PER_PX * dx;
    const claimed = options.onOrbit?.(bearingDelta, pitchDelta) ?? false;

    const pitch = map.getPitch() + pitchDelta;
    map.jumpTo({
      pitch: Math.min(map.getMaxPitch(), Math.max(map.getMinPitch(), pitch)),
      ...(claimed ? {} : { bearing: map.getBearing() + bearingDelta }),
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
  };

  // Without this the OS menu opens mid-drag and swallows the pointerup.
  const onContextMenu = (e: Event) => e.preventDefault();
  // Suppresses the middle-click autoscroll cursor on browsers that ignore
  // preventDefault on pointerdown alone.
  const onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("auxclick", onAuxClick);

  return {
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("auxclick", onAuxClick);
    },
    isOrbiting: () => pointerId !== null,
  };
}
