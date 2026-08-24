import type { Map as MapLibreMap } from "maplibre-gl";
import {
  LANE_RUN_IDX,
  LANE_X,
  LANE_Y,
  LANE_YAW,
  VEHICLE_STRIDE,
} from "../sim/protocol";
import { localToLngLat } from "./coordinates";

/**
 * Third-person follow camera (F3.2).
 *
 * Split into capture/apply on purpose. `capture()` runs inside the layer's
 * render pass, where the interpolated vehicle buffer already exists — it only
 * reads a pose, never touches the map. `apply()` runs in the rAF loop and is
 * the only place that moves the camera, because calling `jumpTo()` from inside
 * `render()` would re-enter MapLibre's render path.
 *
 * Nothing here goes through React or Zustand: the pose changes every frame
 * (§3A.7).
 */

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Vehicle yaw (radians CCW from +x/east) to MapLibre bearing (degrees CW from
 * north). Looking along the direction of travel means the camera bearing
 * equals the heading, so north-up is 90° from east-up.
 *
 * Exported for unit testing — the 90° offset and the direction flip are
 * exactly the kind of convention that breaks silently, and is otherwise only
 * caught by a human noticing the camera faces backwards.
 */
export function yawToBearing(yaw: number): number {
  return 90 - yaw * RAD_TO_DEG;
}

/** Shortest-arc interpolation between two bearings in degrees. Exported for tests. */
export function lerpBearing(from: number, to: number, t: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return from + d * t;
}

/** Wrap a bearing into [0, 360). Exported for tests. */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export class FollowCamera {
  private pose: { x: number; y: number; yaw: number } | null = null;
  /** Smoothed bearing, so heading changes on curves don't snap. */
  private bearing: number | null = null;

  /**
   * User-chosen viewing angle relative to the train's heading, in degrees
   * (issue #31).
   *
   * The camera used to set bearing absolutely from the train's yaw and
   * `jumpTo` every frame, so an orbit gesture was overwritten on the very
   * next frame — the view was effectively locked behind the train. Holding
   * the user's contribution as an OFFSET means the camera keeps tracking
   * the heading while the user picks where to watch from.
   *
   * Survives `resetBearing()` (switching followed train) and is cleared by
   * `reset()` (ending the follow session).
   */
  private offsetDeg = 0;

  get yawOffset(): number {
    return this.offsetDeg;
  }

  addYawOffset(deltaDeg: number): void {
    this.offsetDeg = normalizeBearing(this.offsetDeg + deltaDeg);
  }

  /**
   * Read the selected run's pose out of an interpolated frame. Cheap linear
   * scan — at most MAX_VEHICLES records, and only while following.
   */
  capture(vehicles: Float32Array, count: number, runIdx: number | null): void {
    if (runIdx === null) {
      this.pose = null;
      return;
    }
    for (let i = 0; i < count; i++) {
      const o = i * VEHICLE_STRIDE;
      if (vehicles[o + LANE_RUN_IDX] === runIdx) {
        this.pose = {
          x: vehicles[o + LANE_X],
          y: vehicles[o + LANE_Y],
          yaw: vehicles[o + LANE_YAW],
        };
        return;
      }
    }
    // Selected run left the active set (finished, or clock jumped).
    this.pose = null;
  }

  /** Move the camera onto the captured pose. Call once per rAF, never in render(). */
  apply(map: MapLibreMap): void {
    if (!this.pose) return;
    const target = yawToBearing(this.pose.yaw);
    // Ease toward the heading; a hard set makes curves feel jerky at 60 FPS.
    this.bearing = this.bearing === null ? target : lerpBearing(this.bearing, target, 0.08);
    map.jumpTo({
      center: localToLngLat(this.pose.x, this.pose.y),
      bearing: normalizeBearing(this.bearing + this.offsetDeg),
    });
  }

  /** Drop smoothing state so the next follow starts from the train's heading. */
  reset(): void {
    this.pose = null;
    this.bearing = null;
    this.offsetDeg = 0;
  }

  /**
   * Drop only the smoothed bearing, not the pose. Switching the followed run
   * while still following (train A -> train B) keeps `capture()` overwriting
   * `pose` every frame regardless of whose it is, so the center never stales;
   * but `bearing` only moves via `lerpBearing`, so without this it would ease
   * from A's last heading toward B's — a few hundred ms of wrong-facing
   * camera right after the switch.
   */
  resetBearing(): void {
    this.bearing = null;
  }
}
