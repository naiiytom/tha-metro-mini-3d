import type { Map as MapLibreMap } from "maplibre-gl";
import { lngLatToLocal, localToLngLat } from "./coordinates";

export interface FlyoverOptions {
  /** Base translation speed in meters per second at z16 (default: 160 m/s) */
  baseSpeedMps?: number;
  /** Turn rate in degrees per second (default: 90 deg/s) */
  turnRateDegPerSec?: number;
  /** Pitch rate in degrees per second (default: 45 deg/s) */
  pitchRateDegPerSec?: number;
  /** Zoom rate in steps per second (default: 1.2 steps/s) */
  zoomRateStepsPerSec?: number;
  /**
   * Half-life for coasting deceleration in seconds (default: 0.5s).
   * Velocity halves every `coastHalfLifeSec` seconds:
   * `v *= Math.pow(0.5, dt / coastHalfLifeSec)`.
   * With default 0.5s and stopThreshold 0.05 m/s, an 160 m/s flight coasts
   * smoothly to a halt over ~4-5s, traversing a generous and cinematic distance.
   */
  coastHalfLifeSec?: number;
  /**
   * Optional custom exponential velocity retention factor per second.
   * If provided, overrides coastHalfLifeSec: `v *= Math.pow(damping, dt)`.
   * Range (0, 1): lower = snappier stop, higher = longer coast.
   */
  damping?: number;
  /**
   * Velocity threshold in m/s below which translational flight halts (default: 0.05 m/s).
   */
  stopThresholdMps?: number;
  /**
   * Time in seconds to accelerate from rest to maximum zoom-scaled velocity (default: 0.25s).
   * Accelerates smoothly toward target velocity: `a = targetSpeed / accelTimeSec`.
   * Set to 0 for instantaneous velocity response.
   */
  accelTimeSec?: number;
  /**
   * Optional absolute acceleration in m/s².
   * If provided, overrides accelTimeSec.
   */
  acceleration?: number;
  /** Velocity multiplier applied while `Shift` is held (default: 2.5) */
  turboMultiplier?: number;
  /** Velocity multiplier applied while `Alt` is held (default: 0.3) */
  crawlMultiplier?: number;
  /**
   * Callback fired when any translational key that disengages follow mode
   * is pressed (`W`, `A`, `S`, `D`, `↑`, `↓`, `←`, `→`).
   */
  onFollowRelease?: () => void;
  /**
   * Callback fired when rotational keys (`Q`, `E`) are active during follow mode.
   * Return `true` if claimed by follow-camera orbit offset, preventing direct map bearing update.
   */
  onYawOffset?: (deltaDeg: number) => boolean | void;
  /** Callback fired when pitch angle changes, allowing 2D/3D UI synchronization */
  onPitchChange?: (pitchDeg: number) => void;
  /** Check if the camera is currently locked in follow mode */
  isFollowing?: () => boolean;
}

export interface FlyoverControls {
  /** Update kinematics per animation frame; called inside MapContainer's rAF loop */
  tick: (dtMs: number) => void;
  /** Immediately halt all flight motion, clearing active keys and velocity */
  stop: () => void;
  /** Clean up event listeners on unmount */
  dispose: () => void;
  /** Check if flyover is actively moving the camera or coasting */
  isFlying: () => boolean;
}

/** Greater Bangkok metropolitan coverage boundary [minLng, minLat, maxLng, maxLat] */
const BBOX = {
  minLng: 100.0,
  minLat: 13.3,
  maxLng: 101.0,
  maxLat: 14.3,
};

const MIN_ZOOM = 10.0;
const MAX_ZOOM = 19.0;
const DEFAULT_BASE_SPEED_MPS = 160;
const DEFAULT_STOP_THRESHOLD = 0.05;
const DEFAULT_COAST_HALF_LIFE_SEC = 0.5;
const DEFAULT_ACCEL_TIME_SEC = 0.25;

type FlightAction =
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "yawLeft"
  | "yawRight"
  | "pitchUp"
  | "pitchDown"
  | "zoomIn"
  | "zoomOut";

function getFlightAction(key: string, code: string): FlightAction | null {
  // Arrow keys (match by key or code)
  if (key === "ArrowUp" || code === "ArrowUp") return "forward";
  if (key === "ArrowDown" || code === "ArrowDown") return "backward";
  if (key === "ArrowLeft" || code === "ArrowLeft") return "left";
  if (key === "ArrowRight" || code === "ArrowRight") return "right";

  // Primary: physical key position (standard WASD/6DOF navigation)
  // Resolves AZERTY/international layout collisions where KeyW is 'z' and KeyZ is 'w'
  switch (code) {
    case "KeyW":
      return "forward";
    case "KeyS":
      return "backward";
    case "KeyA":
      return "left";
    case "KeyD":
      return "right";
    case "KeyQ":
      return "yawLeft";
    case "KeyE":
      return "yawRight";
    case "KeyR":
      return "pitchUp";
    case "KeyF":
      return "pitchDown";
    case "KeyZ":
      return "zoomIn";
    case "KeyC":
      return "zoomOut";
  }

  // Fallback: character value (for test mocks and environments without e.code)
  const k = key.toLowerCase();
  switch (k) {
    case "w":
      return "forward";
    case "s":
      return "backward";
    case "a":
      return "left";
    case "d":
      return "right";
    case "q":
      return "yawLeft";
    case "e":
      return "yawRight";
    case "r":
      return "pitchUp";
    case "f":
      return "pitchDown";
    case "z":
      return "zoomIn";
    case "c":
      return "zoomOut";
  }

  return null;
}

function isTranslationalAction(action: FlightAction): boolean {
  return (
    action === "forward" ||
    action === "backward" ||
    action === "left" ||
    action === "right"
  );
}

/**
 * Check whether a text input element is currently focused.
 * Flight controls must be 100% suppressed when typing.
 */
export function isInputActive(): boolean {
  if (typeof document === "undefined") return false;
  let el: Element | null = document.activeElement;
  if (!el) return false;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  const tag = el.tagName ? el.tagName.toUpperCase() : "";
  const contentEditableAttr = (el as HTMLElement).getAttribute?.("contenteditable");
  const isContentEditable =
    (el as HTMLElement).isContentEditable === true ||
    contentEditableAttr === "true" ||
    contentEditableAttr === "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || isContentEditable;
}

/**
 * Installs continuous 6DOF-inspired keyboard flyover controls.
 * Per-frame kinematics live exclusively inside this closure (SRS §3A.7).
 */
export function installFlyoverControls(
  map: MapLibreMap,
  options: FlyoverOptions = {},
): FlyoverControls {
  const baseSpeedMps = options.baseSpeedMps ?? DEFAULT_BASE_SPEED_MPS;
  const turnRateDegPerSec = options.turnRateDegPerSec ?? 90;
  const pitchRateDegPerSec = options.pitchRateDegPerSec ?? 45;
  const zoomRateStepsPerSec = options.zoomRateStepsPerSec ?? 1.2;
  const turboMultiplier = options.turboMultiplier ?? 2.5;
  const crawlMultiplier = options.crawlMultiplier ?? 0.3;
  const stopThreshold = options.stopThresholdMps ?? DEFAULT_STOP_THRESHOLD;
  const accelTimeSec = options.accelTimeSec ?? DEFAULT_ACCEL_TIME_SEC;
  const coastHalfLifeSec = options.coastHalfLifeSec ?? DEFAULT_COAST_HALF_LIFE_SEC;

  const activeActions = new Set<FlightAction>();
  let shiftDown = false;
  let altDown = false;

  // Local ENU velocity in meters/second
  let vx = 0;
  let vy = 0;

  const flushKeys = () => {
    activeActions.clear();
    shiftDown = false;
    altDown = false;
  };

  const stop = () => {
    flushKeys();
    vx = 0;
    vy = 0;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Suppress flight entirely when typing in form inputs
    if (isInputActive()) return;

    // Completely ignore Ctrl / Meta combinations to protect browser shortcuts (Ctrl+W, Ctrl+R)
    if (e.ctrlKey || e.metaKey) return;

    if (e.key === "Shift" || e.code?.startsWith("Shift")) {
      shiftDown = true;
    }
    if (e.key === "Alt" || e.code?.startsWith("Alt")) {
      altDown = true;
    }
    shiftDown = e.shiftKey || shiftDown;
    altDown = e.altKey || altDown;

    const action = getFlightAction(e.key, e.code ?? "");
    if (!action) return;

    // Prevent default to override MapLibre's built-in stepped arrow-key panning
    e.preventDefault();

    if (isTranslationalAction(action)) {
      if (!activeActions.has(action)) {
        if (options.isFollowing?.()) {
          vx = 0;
          vy = 0;
        }
        options.onFollowRelease?.();
      }
    }

    activeActions.add(action);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift" || e.code?.startsWith("Shift")) {
      shiftDown = false;
    } else {
      shiftDown = e.shiftKey;
    }

    if (e.key === "Alt" || e.code?.startsWith("Alt")) {
      altDown = false;
    } else {
      altDown = e.altKey;
    }

    // Always release active actions even if Ctrl or Meta is held,
    // preventing permanent runaway flight.
    const action = getFlightAction(e.key, e.code ?? "");
    if (!action) return;
    activeActions.delete(action);
  };

  const onFocusIn = () => {
    if (isInputActive()) {
      stop();
    }
  };

  const onBlur = () => {
    stop();
  };

  const canvas = typeof map.getCanvas === "function" ? map.getCanvas() : null;
  const onCanvasPointerDown = () => {
    // Intercept mouse/pointer interaction on canvas: immediately halt in-progress
    // flyover velocity and active keys so mouse dragging (dragPan or orbit) takes
    // immediate and exclusive control without fighting residual coasting.
    stop();
  };

  const onMapDragStart = () => {
    stop();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  document.addEventListener("focusin", onFocusIn);
  if (canvas) {
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
  }
  if (typeof map.on === "function") {
    map.on("dragstart", onMapDragStart);
  }

  const tick = (dtMs: number) => {
    if (dtMs <= 0 || !Number.isFinite(dtMs)) return;

    // Suppress flight entirely and halt velocity when typing in form inputs
    if (isInputActive()) {
      if (vx !== 0 || vy !== 0 || activeActions.size > 0) {
        stop();
      }
      return;
    }

    const dt = dtMs / 1000;

    // Alt precision crawl takes precedence over Shift turbo boost
    let multiplier = 1.0;
    if (altDown) {
      multiplier = crawlMultiplier;
    } else if (shiftDown) {
      multiplier = turboMultiplier;
    }

    // If follow mode is active, translational coasting must not fight the train
    const following = Boolean(options.isFollowing?.());
    if (following) {
      vx = 0;
      vy = 0;
    }

    const jumpOpts: {
      center?: [number, number];
      bearing?: number;
      pitch?: number;
      zoom?: number;
    } = {};

    // 1. Translation (W/A/S/D or Arrow Keys)
    let uf = 0;
    if (activeActions.has("forward")) uf += 1;
    if (activeActions.has("backward")) uf -= 1;

    let us = 0;
    if (activeActions.has("right")) us += 1;
    if (activeActions.has("left")) us -= 1;

    const currentBearing = typeof map.getBearing === "function" ? map.getBearing() : 0;
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : 16;
    const currentPitch = typeof map.getPitch === "function" ? map.getPitch() : 0;

    if (uf !== 0 || us !== 0) {
      const len = Math.hypot(uf, us);
      if (len > 1) {
        uf /= len;
        us /= len;
      }

      // Heading angle in radians: 0 deg = North (+y in ENU), 90 deg = East (+x in ENU)
      const thetaRad = (currentBearing * Math.PI) / 180;
      const sinTheta = Math.sin(thetaRad);
      const cosTheta = Math.cos(thetaRad);

      const dirX = uf * sinTheta + us * cosTheta;
      const dirY = uf * cosTheta - us * sinTheta;

      // Translation speed scales inversely with zoom: v(z) = baseSpeed * 2^(16 - z)
      const speedMps = baseSpeedMps * Math.pow(2, 16 - currentZoom);
      const targetSpeed = speedMps * multiplier;

      const targetVx = dirX * targetSpeed;
      const targetVy = dirY * targetSpeed;

      // Accelerate smoothly toward target velocity
      const diffX = targetVx - vx;
      const diffY = targetVy - vy;
      const diffSpeed = Math.hypot(diffX, diffY);

      let maxAccel: number;
      if (options.acceleration !== undefined) {
        maxAccel = options.acceleration;
      } else if (accelTimeSec > 0) {
        maxAccel = targetSpeed / accelTimeSec;
      } else {
        maxAccel = Number.POSITIVE_INFINITY;
      }

      const maxDeltaV = maxAccel * dt;
      if (diffSpeed === 0 || diffSpeed <= maxDeltaV || !Number.isFinite(maxAccel)) {
        vx = targetVx;
        vy = targetVy;
      } else {
        vx += (diffX / diffSpeed) * maxDeltaV;
        vy += (diffY / diffSpeed) * maxDeltaV;
      }
    } else {
      // Exponential velocity decay when translational keys are released
      const decay =
        options.damping !== undefined
          ? Math.pow(options.damping, dt)
          : Math.pow(0.5, dt / coastHalfLifeSec);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < stopThreshold) {
        vx = 0;
        vy = 0;
      }
    }

    const dx = vx * dt;
    const dy = vy * dt;

    if (dx !== 0 || dy !== 0) {
      const center = typeof map.getCenter === "function" ? map.getCenter() : null;
      if (!center) return;
      const [localX, localY] = lngLatToLocal(center.lng, center.lat);
      const nextPos = localToLngLat(localX + dx, localY + dy);

      let clampedLng = nextPos.lng;
      let clampedLat = nextPos.lat;

      if (clampedLng < BBOX.minLng) {
        clampedLng = BBOX.minLng;
        vx = 0;
      } else if (clampedLng > BBOX.maxLng) {
        clampedLng = BBOX.maxLng;
        vx = 0;
      }

      if (clampedLat < BBOX.minLat) {
        clampedLat = BBOX.minLat;
        vy = 0;
      } else if (clampedLat > BBOX.maxLat) {
        clampedLat = BBOX.maxLat;
        vy = 0;
      }

      if (clampedLng !== center.lng || clampedLat !== center.lat) {
        jumpOpts.center = [clampedLng, clampedLat];
      }
    }

    // 2. Rotation (Q / E)
    let uyaw = 0;
    if (activeActions.has("yawRight")) uyaw += 1;
    if (activeActions.has("yawLeft")) uyaw -= 1;

    if (uyaw !== 0) {
      const deltaBearing = uyaw * turnRateDegPerSec * multiplier * dt;
      let claimed = false;
      if (options.onYawOffset) {
        claimed = Boolean(options.onYawOffset(deltaBearing));
      }
      if (!claimed) {
        jumpOpts.bearing = currentBearing + deltaBearing;
      }
    }

    // 3. Pitch Tilt (R / F)
    let upitch = 0;
    if (activeActions.has("pitchUp")) upitch += 1;
    if (activeActions.has("pitchDown")) upitch -= 1;

    if (upitch !== 0) {
      const deltaPitch = upitch * pitchRateDegPerSec * multiplier * dt;
      const minPitch = typeof map.getMinPitch === "function" ? map.getMinPitch() : 0;
      const maxPitch = typeof map.getMaxPitch === "function" ? map.getMaxPitch() : 60;
      const nextPitch = Math.min(maxPitch, Math.max(minPitch, currentPitch + deltaPitch));

      if (nextPitch !== currentPitch) {
        jumpOpts.pitch = nextPitch;
        options.onPitchChange?.(nextPitch);
      }
    }

    // 4. Altitude / Zoom (Z / C)
    let uzoom = 0;
    if (activeActions.has("zoomIn")) uzoom += 1;
    if (activeActions.has("zoomOut")) uzoom -= 1;

    if (uzoom !== 0) {
      const deltaZoom = uzoom * zoomRateStepsPerSec * multiplier * dt;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom + deltaZoom));

      if (nextZoom !== currentZoom) {
        jumpOpts.zoom = nextZoom;
      }
    }

    // Single unified map.jumpTo per frame
    if (Object.keys(jumpOpts).length > 0) {
      map.jumpTo(jumpOpts);
    }
  };

  const isFlying = (): boolean => {
    return activeActions.size > 0 || Math.hypot(vx, vy) > stopThreshold;
  };

  const dispose = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("focusin", onFocusIn);
    if (canvas) {
      canvas.removeEventListener("pointerdown", onCanvasPointerDown);
    }
    if (typeof map.off === "function") {
      map.off("dragstart", onMapDragStart);
    }
    stop();
  };

  return {
    tick,
    stop,
    dispose,
    isFlying,
  };
}
