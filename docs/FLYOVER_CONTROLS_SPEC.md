# Specification: 3D Map Flyover & WASD / QE Keyboard Navigation Controls

**Status:** Draft / Requirements Specification  
**Branch:** `chore/map-flyover-keyboard-controls`  
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
| **`W`** / **`↑`** | **Fly Forward** | Along camera horizontal bearing vector: `[+sin θ, +cos θ]` | Seamlessly exits follow mode (`setFollowing(false)`) |
| **`S`** / **`↓`** | **Fly Backward** | Opposite camera horizontal bearing: `[-sin θ, -cos θ]` | Seamlessly exits follow mode (`setFollowing(false)`) |
| **`A`** / **`←`** | **Strafe Left** | Perpendicular to bearing (left): `[-cos θ, +sin θ]` | Seamlessly exits follow mode (`setFollowing(false)`) |
| **`D`** / **`→`** | **Strafe Right** | Perpendicular to bearing (right): `[+cos θ, -sin θ]` | Seamlessly exits follow mode (`setFollowing(false)`) |
| **`Q`** | **Yaw Turn Left** | Rotates camera bearing counter-clockwise (`bearing - Δθ`) | Rotates viewpoint around train (`followCamera.addYawOffset`) |
| **`E`** | **Yaw Turn Right** | Rotates camera bearing clockwise (`bearing + Δθ`) | Rotates viewpoint around train (`followCamera.addYawOffset`) |
| **`R`** | **Pitch Up** | Tilts camera toward the horizon (`pitch + Δφ`) up to `maxPitch` | Adjusts follow pitch angle |
| **`F`** | **Pitch Down** | Tilts camera toward nadir ground (`pitch - Δφ`) down to `minPitch` | Adjusts follow pitch angle |
| **`Space`** | **Elevate / Zoom Out**| Decreases zoom level (higher altitude overview) | Disengages follow mode |
| **`C`** | **Descend / Zoom In** | Increases zoom level (closer track-level view) | Disengages follow mode |
| **`Shift`** | **Turbo Boost** | `2.5×` velocity multiplier for high-speed cross-city transit | Accelerates yaw/pitch rate |
| **`Alt`** / **`Ctrl`**| **Precision Crawl** | `0.3×` velocity multiplier for fine cinematic adjustments | Slows yaw/pitch rate |

---

## 3. Core Requirements & Architecture

### 3.1 Smooth Kinematic Engine (Zero-Stutter Principle)
- **Problem**: Relying on native OS `keydown` auto-repeat creates a noticeable 300–500ms stutter before repeat, followed by jagged, fixed-rate discrete jumps.
- **Requirement**:
  1. Maintain an active key press set (`Set<string>`) via global `keydown` and `keyup` listeners on `window`.
  2. Perform per-frame kinematic integration inside the render loop (`requestAnimationFrame`) using delta time (`Δt`).
  3. Support acceleration (`a`), maximum velocity clamped by current zoom level ($v_{\text{max}} = f(\text{zoom})$), and exponential velocity damping ($v_{t+\Delta t} = v_t \cdot \text{damping}^{\Delta t}$) so releasing a key results in smooth, cinematic deceleration.
  4. At low zoom ($z = 11$, citywide overview), camera translation speeds scale up to traverse kilometers per second; at high zoom ($z = 18$, track deck level), translation scales down for meter-level precision.

### 3.2 Form Input & Accessibility Isolation (Conflict-Free Typing)
- **Problem**: Users frequently type search queries into `StationSearch`, `StationCombobox`, or `RoutePlanner` (e.g. typing station names containing `w`, `a`, `s`, `d`, `q`, `e` such as *"Wongwian Yai"*, *"Siam"*, *"Asok"*, *"Queen Sirikit"*).
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
  1. **Translational Keys (`W`, `A`, `S`, `D`, `Space`, `C`)**:
     When the user presses any translational key while locked onto a moving train (`useAppStore.getState().following === true`), the flight engine calls `setFollowing(false)`. This mirrors the established UX contract where manual mouse panning relinquishes train tracking.
  2. **Rotational Keys (`Q`, `E`)**:
     When `following === true`, pressing `Q` or `E` must **NOT** disengage follow mode. Instead, it routes bearing deltas into `followCamera.addYawOffset(deltaBearing)`, allowing the user to smoothly orbit around the running train from the keyboard without breaking the follow lock.
  3. **Pitch Keys (`R`, `F`)**:
     Modifies pitch smoothly within `[minPitch, maxPitch]` without interrupting train tracking.

### 3.4 Boundary & Safety Limits
- **Requirement**:
  1. **Pitch Bounds**: Strictly clamp pitch to `[map.getMinPitch(), map.getMaxPitch()]` (typically `[0°, 60°]` or `[0°, 85°]`).
  2. **Zoom Bounds**: Strictly clamp zoom to `[10.0, 19.0]`.
  3. **Spatial Bounds**: Clamp camera target center to the Greater Bangkok metropolitan bounding box `[100.0, 13.3, 101.0, 14.3]` to prevent flying out of satellite/vector tile coverage into empty space.

### 3.5 UI Discovery & Keyboard Shortcuts HUD
- **Requirement**:
  1. Provide visual affordance / keyboard shortcut cheat sheet accessible via `ViewControls` or `AboutTab`.
  2. Include an optional setting toggle to enable/disable keyboard flyover mode for users who prefer standard MapLibre arrow key defaults.

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
  /** Damping factor per second (default: 0.05) */
  damping?: number;
  /** Callback fired when translational motion disengages follow mode */
  onManualPan?: () => void;
  /** Callback fired when rotational motion updates yaw during follow mode */
  onYawOffset?: (deltaDeg: number) => void;
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
   - Verify key strokes are completely ignored when `document.activeElement` is `HTMLInputElement` or `HTMLTextAreaElement`.
   - Verify `W`, `A`, `S`, `D` movements apply correct directional translations according to bearing angle $\theta$.
   - Verify `Q`, `E` apply correct rotational delta and invoke `onYawOffset` when following.
   - Verify `Shift` multiplier scales velocity by `2.5×`.
   - Verify deceleration damping smoothly reduces velocity to zero when keys are released.
2. **Integration Verification**:
   - Mount in `MapContainer.tsx`, test interaction in both idle and follow camera modes.
   - Verify zero dropped frames during continuous high-speed flyover across dense Bangkok 3D building extrusions.
