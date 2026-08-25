import * as THREE from "three";
import {
  LANE_ROUTE_IDX,
  LANE_RUN_IDX,
  LANE_X,
  LANE_Y,
  LANE_YAW,
  LANE_Z,
  MAX_VEHICLES,
  VEHICLE_STRIDE,
} from "../sim/protocol";
import { buildStockGeometry, buildWindowGlowGeometry } from "./stockGeometry";
import type { StockSpec } from "./rollingStock";
import { WINDOW_GLOW_COLOR } from "./windowGlow";

/**
 * Instanced train rendering (ENGINE_CONTRACT.md §6): one InstancedMesh per
 * route (capacity MAX_VEHICLES) — one draw call per route for the whole
 * fleet.
 *
 * Train geometry is built per line from `rollingStock.ts`'s resolved
 * `StockSpec` (`stockGeometry.ts`'s `buildStockGeometry`) — a stylized
 * multi-car consist in the line's own declared livery, with a route-colored
 * cab cap on the +x end so both the direction of travel and the route stay
 * readable. Car bodies + cab are merged into ONE vertex-colored geometry per
 * route. The long axis is +x at yaw = 0; yaw rotates around +z (up) in the
 * local ENU frame, matching the sim's vehicle records.
 */

export interface VehicleRoute {
  /** The line's registry colour — the identity hue, stamped as liveryHex. */
  color: string;
  /** This line's own resolved rolling stock (see rollingStock.ts). */
  stock: StockSpec;
}

/** Per-instance tint multiplied over the vertex colors (MVP 4 selection). */
const TINT_PLAIN = new THREE.Color(1, 1, 1);
const TINT_SELECTED = new THREE.Color(1.9, 1.55, 0.5);

/**
 * Per-instance ADDITIVE emissive boost for the selected train, on top of
 * whatever material-level night-floor emissive `ThreeLayer.setSun()` has
 * already set for the whole route (see `materialAlbedo.ts` / `nightLift.ts`).
 *
 * Found in code review 2026-08-15: `TINT_SELECTED` above is a per-instance
 * MULTIPLIER on the vertex-coloured DIFFUSE term only — Three's Lambert
 * fragment shader sets `totalEmissiveRadiance = emissive` (a material-level
 * uniform, shared by every instance of an InstancedMesh) BEFORE the vertex
 * colour multiply ever runs, and composites it additively into the final
 * output. So once the night floor's material-level `emissiveIntensity` is
 * non-trivial (it usually is at night — even white needs ~0.13, and this is
 * exactly what this whole PR raised for dark liveries), that fixed additive
 * floor is identical for the selected and unselected instances alike, and
 * `TINT_SELECTED`'s multiplicative diffuse difference becomes a shrinking
 * fraction of a growing common offset — the selection highlight visually
 * disappears at night for exactly the liveries this PR was built to fix.
 *
 * `InstancedMesh` ships no per-instance emissive channel (only
 * `instanceColor`, which — per the shader trace above — only ever reaches
 * the diffuse term, never emissive). Fixed with a real one: a custom
 * `instanceEmissive` InstancedBufferAttribute + an `onBeforeCompile` patch
 * (below) that threads it through as its own varying and adds it into
 * `totalEmissiveRadiance`, genuinely per-instance, independent of whatever
 * the shared material-level floor currently is.
 *
 * A warm gold, echoing `TINT_SELECTED`'s own warm bias (boosted red/green,
 * dimmed blue) so the two selection cues read as the same visual language.
 * Converted to linear once — the shader's lighting math is entirely in
 * linear space (see `nightLift.ts`'s SHADING_SCALE derivation), and a raw
 * sRGB value added there would be composited in the wrong colour space.
 * Independent of route colour and time of day BY DESIGN: a fixed, always-
 * visible cue is more reliable than one that has to out-compete an unknown
 * current night-floor magnitude.
 */
const SELECTED_EMISSIVE_BOOST_SRGB = new THREE.Color(0xffaa33);
const SELECTED_EMISSIVE_BOOST_LINEAR = SELECTED_EMISSIVE_BOOST_SRGB.clone().convertSRGBToLinear();
const NO_EMISSIVE_BOOST_LINEAR = new THREE.Color(0, 0, 0);

/**
 * Patches a per-route vehicle material to add a real per-instance emissive
 * channel. Exported so its GLSL string-surgery can be unit-tested directly
 * against a minimal fake `shader` object, without a WebGL context — actual
 * shader compilation can't be exercised in this project's jsdom test
 * environment, but the transformation this function performs on the raw
 * (pre-`#include`-resolution) template strings can be, and a Three version
 * bump changing these literal include markers would otherwise break this
 * silently.
 */
export function patchInstancedEmissive(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "attribute vec3 instanceEmissive;\nvarying vec3 vInstanceEmissive;\n#include <common>",
    )
    .replace(
      "#include <color_vertex>",
      "#include <color_vertex>\n\tvInstanceEmissive = instanceEmissive;",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("uniform vec3 emissive;", "uniform vec3 emissive;\nvarying vec3 vInstanceEmissive;")
    .replace(
      "vec3 totalEmissiveRadiance = emissive;",
      "vec3 totalEmissiveRadiance = emissive + vInstanceEmissive;",
    );
}

export class VehicleManager {
  /** One InstancedMesh per route, index == route_idx. Add these to the scene. */
  readonly meshes: THREE.InstancedMesh[];
  /**
   * One additional, uncoloured InstancedMesh per route — a thin overlay
   * tracking each train's window band, proud of the main body's own glazing
   * surface (`stockGeometry.ts`'s `buildWindowGlowGeometry`). Invisible by
   * day (`opacity: 0`); `setNightGlow()` raises its opacity toward night, a
   * fixed warm colour independent of the route's own livery. See
   * `windowGlow.ts`'s doc comment for why this exists as a second mesh
   * rather than folding into the main material's night-lift emissive: that
   * lift is solved per-material against a fixed floor with no cross-
   * material differentiation, so a train's shell and the track deck under
   * it converge toward the same luminance once both need real lift — this
   * overlay sidesteps that by being additive and independent of any
   * material's own albedo. Same instance packing/matrix as `meshes` (see
   * `update()`), so it always tracks the exact train it belongs to; never
   * shadowed, since a translucent glow casting/receiving shadows would look
   * wrong and cost real shadow-map fill for no visual benefit.
   */
  readonly glowMeshes: THREE.InstancedMesh[];

  private matrix = new THREE.Matrix4();
  /** Selection at the last colour write, to skip redundant attribute uploads. */
  private tintedFor: number | null = null;
  /** Reused per frame — sized to the route count, never reallocated. */
  private counts: number[];
  /**
   * Per-route active-slot count as of the last frame tints were actually
   * written — NOT the same as `counts` (this frame's count), and not
   * updated on a skipped (writeTints === false) frame. See the stale-tail
   * clearing pass in `update()` for why this exists.
   */
  private lastTintedCounts: number[];

  constructor(routes: VehicleRoute[]) {
    this.counts = new Array(routes.length).fill(0);
    this.lastTintedCounts = new Array(routes.length).fill(0);
    this.meshes = routes.map((route, routeIdx) => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      // vertexColors means material.color stays white — the real livery lives
      // in per-vertex data. Stamp it here so ThreeLayer's night-floor pass can
      // compute the lift from the route's actual colour instead of white
      // (which would glow every train white at night).
      material.userData.liveryHex = new THREE.Color(route.color).getHex();
      material.onBeforeCompile = patchInstancedEmissive;
      const geometry = buildStockGeometry(route.stock);
      geometry.setAttribute("instanceEmissive", VehicleManager.newInstanceEmissive());
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_VEHICLES);
      mesh.name = `vehicles-route-${routeIdx}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The custom-layer projection matrix defeats Three's frustum test.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
    this.glowMeshes = routes.map((route, routeIdx) => {
      // Unlit on purpose: this overlay represents a light SOURCE (a lit
      // window), not a surface reflecting the scene's own sun/ambient — a
      // MeshLambertMaterial here would dim it right back toward the same
      // night floor this exists to sidestep. `depthWrite: false` avoids
      // depth-fighting the main body mesh it sits proud of by only ~1 cm.
      const material = new THREE.MeshBasicMaterial({
        color: WINDOW_GLOW_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const geometry = buildWindowGlowGeometry(route.stock);
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_VEHICLES);
      mesh.name = `vehicles-route-${routeIdx}-glow`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
  }

  /** Opacity for every route's window-glow overlay, in lockstep (the glow
   *  colour is fixed and not route-dependent — see `windowGlow.ts`). Called
   *  at UI rate alongside `ThreeLayer.setSun()`, never per frame. */
  setNightGlow(opacity: number): void {
    for (const mesh of this.glowMeshes) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  /** Hide one route's fleet without disturbing the others' instance packing. */
  setRouteVisible(routeIdx: number, visible: boolean): void {
    const mesh = this.meshes[routeIdx];
    if (mesh) mesh.visible = visible;
    const glow = this.glowMeshes[routeIdx];
    if (glow) glow.visible = visible;
  }

  /**
   * Allocated eagerly, unlike `instanceColor` (a Three built-in the renderer
   * allocates lazily on the first `setColorAt`): this is a plain custom
   * attribute with no such lazy path, and it must exist before the first
   * render regardless of whether anything is selected yet, so every slot
   * reliably reads "no boost" from frame 1.
   */
  private static newInstanceEmissive(): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VEHICLES * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  }

  /**
   * Swap in a different geometry for one route after construction — the seam
   * a `.glb` override (glbStock.ts) and, later, a real LOD switch both need.
   *
   * Two things must travel with the swap or the route breaks silently: the
   * per-instance `instanceEmissive` attribute (without it the selection
   * highlight's onBeforeCompile patch reads a missing attribute), and the
   * disposal of the geometry being replaced (Three does not free GPU buffers
   * when a mesh simply stops referencing them).
   *
   * The MATERIAL is deliberately untouched — it carries the route's
   * liveryHex stamp and the compiled emissive patch, and rebuilding it would
   * drop the night lift `ThreeLayer.setSun()` has already applied.
   */
  setRouteGeometry(routeIdx: number, geometry: THREE.BufferGeometry): void {
    const mesh = this.meshes[routeIdx];
    if (!mesh || geometry === mesh.geometry) return;
    const previous = mesh.geometry;
    geometry.setAttribute("instanceEmissive", VehicleManager.newInstanceEmissive());
    mesh.geometry = geometry;
    previous.dispose();
    // Slot packing is rewritten every frame from scratch, but the tail-clearing
    // bookkeeping is not — reset it so the first frame after a swap writes a
    // clean attribute rather than clearing slots on a buffer that never held them.
    this.lastTintedCounts[routeIdx] = 0;
    this.tintedFor = null;
  }

  /**
   * Set instance matrices from interpolated stride-8 vehicle records
   * (protocol.ts lanes). Called from the render loop — no allocations.
   *
   * `selectedRunIdx` tints one instance so the picked train is findable in a
   * crowd; instance order changes every frame, so the tint is written per
   * frame rather than tracked.
   */
  update(vehicles: Float32Array, count: number, selectedRunIdx: number | null = null): void {
    // Instance order changes every frame, so tints must be rewritten whenever
    // anything IS selected. With no selection they are all plain and the
    // 1024×3 attribute upload can be skipped entirely.
    const selectionChanged = selectedRunIdx !== this.tintedFor;
    const writeTints = selectedRunIdx !== null || selectionChanged;
    this.tintedFor = selectedRunIdx;

    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      const o = i * VEHICLE_STRIDE;
      const routeIdx = vehicles[o + LANE_ROUTE_IDX] | 0;
      const mesh = this.meshes[routeIdx];
      if (!mesh || counts[routeIdx] >= MAX_VEHICLES) continue;
      this.matrix
        .makeRotationZ(vehicles[o + LANE_YAW])
        .setPosition(vehicles[o + LANE_X], vehicles[o + LANE_Y], vehicles[o + LANE_Z]);
      const slot = counts[routeIdx]++;
      mesh.setMatrixAt(slot, this.matrix);
      this.glowMeshes[routeIdx]?.setMatrixAt(slot, this.matrix);
      if (writeTints) {
        const selected = vehicles[o + LANE_RUN_IDX] === selectedRunIdx;
        mesh.setColorAt(slot, selected ? TINT_SELECTED : TINT_PLAIN);
        // Same per-slot discipline as setColorAt just above, same reason:
        // slot assignment is per-frame packing order, not a stable per-
        // vehicle identity, so this must be rewritten for every active slot
        // whenever anything is (or was) selected — never just for the
        // previously-selected slot, which may not even be this vehicle's
        // slot this frame.
        const boost = selected ? SELECTED_EMISSIVE_BOOST_LINEAR : NO_EMISSIVE_BOOST_LINEAR;
        (mesh.geometry.attributes.instanceEmissive as THREE.InstancedBufferAttribute).setXYZ(
          slot,
          boost.r,
          boost.g,
          boost.b,
        );
      }
    }
    for (let r = 0; r < this.meshes.length; r++) {
      const mesh = this.meshes[r];
      mesh.count = counts[r];
      mesh.instanceMatrix.needsUpdate = true;
      const glow = this.glowMeshes[r];
      if (glow) {
        glow.count = counts[r];
        glow.instanceMatrix.needsUpdate = true;
      }
      if (writeTints) {
        // Stale-tail clearing (found in code review 2026-08-15): slot
        // packing is per-frame order, not a stable per-vehicle identity —
        // the loop above only rewrites slots 0..counts[r]-1, so a slot that
        // held a selection tint/boost from an EARLIER, larger-fleet frame
        // and then fell outside the active range is never explicitly reset.
        // While writeTints keeps firing every frame (something stays
        // selected) that's harmless — a shrunk-then-regrown slot is either
        // still being rewritten (if within the new count) or still outside
        // the rendered range (mesh.count caps what's drawn). The gap is
        // specifically the transition INTO the "nothing selected, skip the
        // whole per-instance write" steady state: the deselect frame is the
        // LAST one to actually touch these attributes for a while, so any
        // slot beyond THIS frame's count but within the LAST TINTED frame's
        // count must be explicitly zeroed here, or a later regrow (with
        // writeTints staying false throughout, since nothing reselects)
        // silently un-hides the stale boost on an arbitrary train.
        // instanceColor and instanceEmissive share the exact same hazard —
        // same per-frame packing, same "only 0..count-1 gets touched" loop.
        const colorAttr = mesh.instanceColor; // allocated lazily by the first setColorAt
        const emissiveAttr = mesh.geometry.attributes
          .instanceEmissive as THREE.InstancedBufferAttribute;
        for (let slot = counts[r]; slot < this.lastTintedCounts[r]; slot++) {
          colorAttr?.setXYZ(slot, TINT_PLAIN.r, TINT_PLAIN.g, TINT_PLAIN.b);
          emissiveAttr.setXYZ(slot, 0, 0, 0);
        }
        this.lastTintedCounts[r] = counts[r];
        if (colorAttr) colorAttr.needsUpdate = true;
        emissiveAttr.needsUpdate = true;
      }
    }
  }
}
