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
import { buildTrainGeometry, CONSISTS } from "./vehicleModels";
import type { VehicleType } from "../types";

/**
 * Instanced train rendering (ENGINE_CONTRACT.md §6): one InstancedMesh per
 * route (capacity MAX_VEHICLES) — one draw call per route for the whole
 * fleet.
 *
 * Train geometry is built per vehicle type from `vehicleModels.ts`'s
 * ConsistSpecs — a stylized multi-car consist in white-grayish livery, with
 * a route-colored cab cap on the +x end so both the direction of travel and
 * the route stay readable. Car bodies + cab are merged into ONE
 * vertex-colored geometry per route. The long axis is +x at yaw = 0; yaw
 * rotates around +z (up) in the local ENU frame, matching the sim's vehicle
 * records.
 */

export interface VehicleRoute {
  color: string;
  vehicleType: VehicleType;
}

/** Per-instance tint multiplied over the vertex colors (MVP 4 selection). */
const TINT_PLAIN = new THREE.Color(1, 1, 1);
const TINT_SELECTED = new THREE.Color(1.9, 1.55, 0.5);

export class VehicleManager {
  /** One InstancedMesh per route, index == route_idx. Add these to the scene. */
  readonly meshes: THREE.InstancedMesh[];

  private matrix = new THREE.Matrix4();
  /** Selection at the last colour write, to skip redundant attribute uploads. */
  private tintedFor: number | null = null;
  /** Reused per frame — sized to the route count, never reallocated. */
  private counts: number[];

  constructor(routes: VehicleRoute[]) {
    this.counts = new Array(routes.length).fill(0);
    this.meshes = routes.map((route, routeIdx) => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      // vertexColors means material.color stays white — the real livery lives
      // in per-vertex data. Stamp it here so ThreeLayer's night-floor pass can
      // compute the lift from the route's actual colour instead of white
      // (which would glow every train white at night).
      material.userData.liveryHex = new THREE.Color(route.color).getHex();
      const geometry = buildTrainGeometry(
        CONSISTS[route.vehicleType],
        new THREE.Color(route.color).getHex(),
      );
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
  }

  /** Hide one route's fleet without disturbing the others' instance packing. */
  setRouteVisible(routeIdx: number, visible: boolean): void {
    const mesh = this.meshes[routeIdx];
    if (mesh) mesh.visible = visible;
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
      if (writeTints) {
        mesh.setColorAt(
          slot,
          vehicles[o + LANE_RUN_IDX] === selectedRunIdx ? TINT_SELECTED : TINT_PLAIN,
        );
      }
    }
    for (let r = 0; r < this.meshes.length; r++) {
      const mesh = this.meshes[r];
      mesh.count = counts[r];
      mesh.instanceMatrix.needsUpdate = true;
      // Allocated lazily by the first setColorAt; absent if no vehicle drew.
      if (writeTints && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
