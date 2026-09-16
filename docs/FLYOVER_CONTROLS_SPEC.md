# Specification: 3D Map Flyover & WASD / QE Keyboard Navigation Controls

**Status:** Consensus Reached / Final Specification  
**Branch:** `main`  
**Related Roadmaps:** Roadmap item 28 (Interaction, Camera & Navigation Controls)  
**Parent Subsystems:** [`src/map/cameraControls.ts`](file:///D:/work/tha-metro-mini-3d/src/map/cameraControls.ts), [`src/map/followCamera.ts`](file:///D:/work/tha-metro-mini-3d/src/map/followCamera.ts), [`src/components/MapContainer.tsx`](file:///D:/work/tha-metro-mini-3d/src/components/MapContainer.tsx)

---

## 1. Executive Summary & Vision

Currently, camera manipulation in `tha-metro-mini-3d` is exclusively pointer-driven:
- Left-drag pans the MapLibre viewport (ground plane translation).
- Middle-drag, right-drag, or `Ctrl` + left-drag orbit the camera (yaw bearing and pitch tilt).
- Scroll-wheel zooms the camera.

While intuitive for desktop point-and-click interactions, transit enthusiasts, 3D visualization explorers, and gamers frequently request **first-person / flyover camera navigation** using standard **W, A, S, D, Q, E** keys. 

This feature introduces a 6DOF-inspired, smooth kinematic flyover engine enabling users to glide over Bangkok's elevated viaducts, dive into tunnel portals, orbit moving trains, and traverse the transit network smoothly using keyboard controls.

---

## 2. Key Mappings & Control Matrix

| Key | Action | Vector / Direction | Follow Mode Behavior |
| :--- | :--- | :--- | :--- |
| **`W`** / **`↑`** | **Fly Forward** | Along camera horizontal bearing vector: `[+sin θ, +cos θ]` | Triggers **follow breakout** (`setFollowing(false)`) |
| **`S`** / **`↓`** | **Fly Backward** | Opposite camera horizontal bearing: `[-sin θ, -cos θ]` | Triggers **follow breakout** (`setFollowing(false)`) |
| **`A`** / **`←`** | **Strafe Left** | Perpendicular to bearing (left): `[-cos θ, +sin θ]` | Triggers **follow breakout** (`setFollowing(false)`) |
| **`D`** / **`→`** | **Strafe Right** | Perpendicular to bearing (right): `[+cos θ, -sin θ]` | Triggers **follow breakout** (`setFollowing(false)`) |
| **`Q`** | **Yaw Turn Left** | Rotates camera bearing counter-clockwise (`bearing - Δθ`) | Rotates viewpoint around train (**orbit offset**: `followCamera.addYawOffset`) |
| **`E`** | **Yaw Turn Right** | Rotates camera bearing clockwise (`bearing + Δθ`) | Rotates viewpoint around train (**orbit offset**: `followCamera.addYawOffset`) |
| **`R`** | **Pitch Up** | Tilts camera toward the horizon (`pitch + Δφ`) up to `maxPitch` | Adjusts camera pitch angle (preserves follow lock) |
| **`F`** | **Pitch Down** | Tilts camera toward nadir ground (`pitch - Δφ`) down to `minPitch` | Adjusts camera pitch angle (preserves follow lock) |
| **`Z`** | **Zoom In / Descend** | Increases zoom level (closer track-level view) | Adjusts camera zoom level (preserves follow lock) |
| **`C`** | **Zoom Out / Elevate**| Decreases zoom level (higher altitude overview) | Adjusts camera zoom level (preserves follow lock) |
| **`Shift`** | **Turbo Boost** | `2.5×` velocity multiplier across all 4 axes (pan, turn, tilt, zoom) | Accelerates yaw/pitch/zoom rate |
| **`Alt`** | **Precision Crawl** | `0.3×` velocity multiplier across all 4 axes (`Ctrl` dropped to prevent browser tab loss) | Slows yaw/pitch/zoom rate |
| *(Retired)* | **`Space`** / **`Ctrl`** | `Space` retired to prevent page-down scroll & false accessibility triggers; `Ctrl` excluded to protect browser shortcuts | N/A |

---

## 3. Core Requirements & Architecture

### 3.1 Smooth Kinematic Engine (Zero-Stutter Principle)
- **Problem**: Relying on native OS `keydown` auto-repeat creates a noticeable 300–500ms stutter before repeat, followed by jagged, fixed-rate discrete jumps.
- **Requirement**:
  1. Maintain an active key press set (`Set<string>`) via global `keydown` and `keyup` listeners on `window`.
  2. Perform per-frame kinematic integration inside the render loop (`requestAnimationFrame`) using delta time (`Δt`).
  3. Support acceleration (`a`), maximum velocity clamped by current zoom level ($v_{\text{max}} = f(\text{zoom})$), and exponential velocity damping ($v_{t+\Delta t} = v_t \cdot \text{damping}^{\Delta t}$, where damping ∈ (0, 1) and default 0.92) so releasing a key results in smooth, cinematic deceleration.
  4. At low zoom ($z = 11$, citywide overview), camera translation speeds scale up to traverse kilometers per second; at high zoom ($z = 18$, track deck level), translation scales down for meter-level precision: $v(z) = v_{\text{base}} \cdot 2^{16 - z}$.
  5. All per-frame kinematic state (velocity vector, active key set `Set<string>`, delta-time accumulator) lives **exclusively inside the `FlyoverControls` module closure** — it MUST NOT be written to React state or Zustand. This is non-negotiable (CONTRIBUTING.md line 76). The module communicates back to the application only through its `onFollowRelease`, `onYawOffset`, and `onPitchChange` callbacks.
  6. Detect modifier keys (`Shift`, `Alt`) from the active `keydown` event's `shiftKey` and `altKey` boolean properties. Apply `turboMultiplier` (default 2.5) when Shift is held; apply `crawlMultiplier` (default 0.3) when Alt is held across all 4 axes (pan, turn, tilt, zoom). `Ctrl` is ignored to prevent interfering with browser shortcuts like `Ctrl+W` / `Ctrl+R`. If both Shift and Alt are held simultaneously, `crawlMultiplier` takes precedence (safety fallback).

### 3.2 Form Input & Accessibility Isolation (Conflict-Free Typing)
- **Problem**: Users frequently type search queries into `StationSearch`, `StationCombobox`, or `RoutePlanner` (e.g. typing station names containing `w`, `a`, `s`, `d`, `q`, `e`, `z`, `c` such as *"Wongwian Yai"*, *"Siam"*, *"Asok"*, *"Queen Sirikit"*, *"Chit Lom"*).
- **Requirement**:
  1. Flight controls **MUST BE 100% SUPPRESSED** when typing into any input element:
     ```ts
     function isInputActive(): boolean {
       const el = document.activeElement;
       if (!el) return false;
       const tag = el.tagName;
       return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
     }
     ```
  2. If an input field receives focus while keys are held down, the active keys set must be flushed to prevent runaway phantom movement.
  3. When an input field blurs, keyboard flight controls become available immediately.

### 3.3 Coordination with Follow-Camera State Machine
- **Requirement**:
  1. **Keys That Trigger Follow Breakout (`W`, `A`, `S`, `D`, `↑`, `↓`, `←`, `→`)**:
     When the user presses any translational key while locked onto a moving train (`useAppStore.getState().following === true`), the flight engine calls `onFollowRelease()` (which calls `setFollowing(false)` and `follow.resetBearing()`) and initiates flyover translation starting from $0\text{ m/s}$ velocity at the train's current position. This mirrors the established UX contract where manual mouse panning relinquishes train tracking.
  2. **Rotational Keys (`Q`, `E`)**:
     When `following === true`, pressing `Q` or `E` must **NOT** disengage follow mode. Instead, it routes bearing deltas into `followCamera.addYawOffset(deltaBearing)` (**orbit offset**), allowing the user to smoothly orbit around the running train from the keyboard without breaking the follow lock.
  3. **Pitch Keys (`R`, `F`)**:
     Preserves follow lock. Tilts the camera pitch directly via `map.setPitch()` without interrupting train tracking.
  4. **Zoom Keys (`Z`, `C`)**:
     Preserves follow lock. Adjusts camera altitude/zoom directly via `map.setZoom()`, mirroring mouse scroll-wheel zoom while tracking.

### 3.4 Boundary & Safety Limits
- **Requirement**:
  1. **Pitch Bounds**: Strictly clamp pitch to `[map.getMinPitch(), map.getMaxPitch()]` (typically `[0°, 60°]` or `[0°, 85°]`).
  2. **Zoom Bounds**: Strictly clamp zoom to `[10.0, 19.0]`.
  3. **Spatial Bounds**: Clamp camera target center to the Greater Bangkok metropolitan bounding box `[100.0, 13.3, 101.0, 14.3]` to prevent flying out of satellite/vector tile coverage into empty space.

### 3.5 UI Discovery & Keyboard Shortcuts HUD
- **Requirement**:
  1. Provide a responsive desktop-only (`hidden md:flex`) keyboard icon button (`⌨`) in `ViewControls` that toggles a floating HUD cheat sheet overlay.
  2. Document all keyboard controls under an expandable section in `AboutTab`.
  3. Provide complete bilingual English and Thai localization for all new HUD labels and tooltips.

### 3.6 2D/3D Mode Synchronization
- **Requirement**:
  1. When pitch crosses the $10^\circ$ threshold via `R` or `F`, synchronize `useAppStore.getState().setMap3D(pitch >= 10)` so the UI state stays accurate.

---

## 4. Proposed Interface & Module Design

A self-contained module `src/map/flyoverControls.ts` implementing the following contract:

```ts
export interface FlyoverOptions {
  /** Base translation speed in meters per second at z16 (default: 80 m/s) */
  baseSpeedMps?: number;
  /** Turn rate in degrees per second (default: 90 deg/s) */
  turnRateDegPerSec?: number;
  /** Pitch rate in degrees per second (default: 45 deg/s) */
  pitchRateDegPerSec?: number;
  /** Zoom rate in steps per second (default: 1.2 steps/s) */
  zoomRateStepsPerSec?: number;
  /**
   * Exponential velocity retention factor per second (default: 0.92).
   * Applied as `v *= damping^(dtMs/1000)` each frame. At 0.92 the camera
   * coasts to a near-stop over ~2.5 s. Range (0, 1): lower = snappier stop,
   * higher = longer coast.
   */
  damping?: number;
  /** Velocity multiplier applied while `Shift` is held (default: 2.5) */
  turboMultiplier?: number;
  /** Velocity multiplier applied while `Alt` is held (default: 0.3) */
  crawlMultiplier?: number;
  /**
   * Callback fired when any key that disengages follow mode is pressed
   * (`W`, `A`, `S`, `D`, `↑`, `↓`, `←`, `→`).
   */
  onFollowRelease?: () => void;
  /** Callback fired when rotational motion updates yaw during follow mode */
  onYawOffset?: (deltaDeg: number) => void;
  /** Callback fired when pitch changes, allowing map3D sync */
  onPitchChange?: (pitchDeg: number) => void;
}

export interface FlyoverControls {
  /** Update kinematics per animation frame; called inside MapContainer's rAF loop */
  tick: (dtMs: number) => void;
  /** Clean up event listeners on unmount */
  dispose: () => void;
  /** Check if flyover is actively moving the camera */
  isFlying: () => boolean;
}
```

---

## 5. Verification Plan

1. **Unit Tests (`src/map/flyoverControls.test.ts`)**:
   - Verify `keydown` and `keyup` register and clear active keys in the internal state.
   - Verify key strokes are completely ignored when `document.activeElement` is `HTMLInputElement`, `HTMLTextAreaElement`, or a `contenteditable` element (`isContentEditable === true`).
   - Verify `W`, `A`, `S`, `D` movements apply correct directional translations according to bearing angle $\theta$.
   - Verify `Q`, `E` apply correct rotational delta and invoke `onYawOffset` when following.
   - Verify `Shift` multiplier scales velocity by `2.5×`.
   - Verify zoom keys (`Z`, `C`) and pitch keys (`R`, `F`) preserve follow lock, while translational keys (`W`, `A`, `S`, `D`, arrow keys) trigger `onFollowRelease()`.
   - Verify deceleration damping smoothly reduces velocity to zero when keys are released.
2. **Integration Verification**:
   - Mount in `MapContainer.tsx`, test interaction in both idle and follow camera modes.
   - Verify zero dropped frames during continuous high-speed flyover across dense Bangkok 3D building extrusions.
