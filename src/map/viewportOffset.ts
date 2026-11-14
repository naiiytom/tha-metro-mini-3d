import { MOBILE_BREAKPOINT_QUERY } from "../hooks/useIsMobile";

export interface OffsetMapLike {
  getContainer(): { clientHeight: number; clientWidth?: number };
  project(lngLat: [number, number]): { x: number; y: number };
  unproject(point: [number, number]): { lng: number; lat: number };
}

export interface EaseToMapLike extends OffsetMapLike {
  easeTo(options: { center: [number, number]; zoom: number; pitch: number; duration: number }): void;
}

/**
 * Offsets the camera target coordinate southwards so that the selected coordinate
 * appears vertically centered within the visible upper map canvas (accounting for
 * the mobile bottom sheet occupying the bottom `sheetRatio` fraction of the screen).
 */
export function offsetCenterForSheet(
  lngLat: [number, number],
  map: OffsetMapLike,
  sheetRatio = 0.4,
): [number, number] {
  if (sheetRatio <= 0 || sheetRatio >= 1) return [lngLat[0], lngLat[1]];

  const container = map.getContainer();
  const height = container.clientHeight;
  if (!height || height <= 0) return [lngLat[0], lngLat[1]];

  // Target should appear in the center of the visible upper area:
  // Visible area is [0, (1 - sheetRatio) * height], center is at (1 - sheetRatio) * height / 2.
  // Full canvas center is height / 2.
  // The vertical shift needed is height / 2 - (1 - sheetRatio) * height / 2 = (height * sheetRatio) / 2.
  const deltaY = (height * sheetRatio) / 2;

  const pt = map.project(lngLat);
  const offsetPt = map.unproject([pt.x, pt.y + deltaY]);

  return [offsetPt.lng, offsetPt.lat];
}

/**
 * Ease the camera to `lngLat`, shifting the center southward on mobile so the
 * target stays visible above the bottom sheet.
 */
export function easeToLngLat(
  map: EaseToMapLike,
  lngLat: [number, number],
  map3D: boolean,
  isMobile = typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches,
): void {
  const center: [number, number] = isMobile
    ? offsetCenterForSheet(lngLat, map, 0.4)
    : lngLat;
  map.easeTo({ center, zoom: 16, pitch: map3D ? 55 : 0, duration: 800 });
}
