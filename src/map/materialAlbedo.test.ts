import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { materialAlbedo } from "./materialAlbedo";
import { VehicleManager } from "./VehicleManager";
import { buildStationMarkers } from "./trackGeometry";
import type { LineGeometry } from "../types";

/**
 * Regression coverage for the actual wiring, not just `nightLift`'s own
 * numeric behaviour (see the note on `nightLift.test.ts`'s "white needs far
 * less lift..." test for why that one alone doesn't guard this). Both
 * builders here are pure geometry/material construction — no WebGL context,
 * no renderer, no DOM — so they run fine under vitest's default node
 * environment (confirmed against the existing `vehicleModels.test.ts` /
 * `skyDome.test.ts` precedent of constructing real THREE objects the same
 * way).
 */

const line = (over: Partial<LineGeometry> = {}): LineGeometry => ({
  key: "t",
  name: "T",
  nameTh: "T",
  color: "#660066",
  structure: "elevated",
  vehicleType: "heavy",
  gtfsRouteId: "1",
  preRevenue: false,
  syntheticSchedule: null,
  estimatedRunTimes: null,
  relationId: 1,
  osmName: "T",
  track: [
    [100.53, 13.74, 15, "elevated"],
    [100.54, 13.74, 15, "elevated"],
  ],
  stations: [
    { id: 1, name: "A", nameTh: "A", code: "A1", position: [100.53, 13.74, 15] },
    { id: 2, name: "B", nameTh: "B", code: "A2", position: [100.54, 13.74, 15] },
  ],
  ...over,
});

describe("materialAlbedo", () => {
  test("falls back to a material's own colour when nothing is stamped", () => {
    const m = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    expect(materialAlbedo(m)).toBe(0xff0000);
  });

  test("prefers a stamped liveryHex over the material's own (white) colour", () => {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.userData.liveryHex = 0x1964b7;
    expect(materialAlbedo(m)).toBe(0x1964b7);
  });

  test("a real VehicleManager route material reports its route's colour, not white", () => {
    // Regression guard for the actual bug class: VehicleManager builds its
    // materials with vertexColors: true, so .color alone would read white.
    // This fails if VehicleManager's userData.liveryHex stamp is ever
    // removed.
    const manager = new VehicleManager([
      { color: "#1964B7", vehicleType: "heavy" },
      { color: "#FBC02D", vehicleType: "monorail" },
    ]);
    const blueMaterial = manager.meshes[0].material as THREE.MeshLambertMaterial;
    const yellowMaterial = manager.meshes[1].material as THREE.MeshLambertMaterial;
    expect(materialAlbedo(blueMaterial)).toBe(0x1964b7);
    expect(materialAlbedo(blueMaterial)).not.toBe(0xffffff);
    expect(materialAlbedo(yellowMaterial)).toBe(0xfbc02d);
  });

  test("a real station-marker disc material reports its line's colour, not white", () => {
    // Regression guard for the sibling bug Task 7's review found:
    // buildMarkerPair's disc material is also white with the real colour
    // applied only via InstancedMesh.setColorAt. Fails if the liveryHex
    // stamp in buildMarkerPair is ever removed.
    const group = buildStationMarkers([line({ color: "#660066" })]);
    // Both stations here are elevated (altitude 15 >= 0), so buildStationMarkers
    // emits exactly one surface disc/pole pair and nothing underground:
    // children[0] is the discs InstancedMesh, children[1] is the poles.
    const discs = group.children[0] as THREE.InstancedMesh;
    const poles = group.children[1] as THREE.InstancedMesh;
    expect(materialAlbedo(discs.material as THREE.MeshLambertMaterial)).toBe(0x660066);
    expect(materialAlbedo(discs.material as THREE.MeshLambertMaterial)).not.toBe(0xffffff);
    // Poles were never claimed to need this — their .color genuinely is
    // their true rendered colour (0x9ca3af, set at construction, never
    // overridden per-instance).
    expect(materialAlbedo(poles.material as THREE.MeshLambertMaterial)).toBe(0x9ca3af);
  });

  test("does not stamp a misleading single colour when a marker pair's items are not uniform", () => {
    // buildStationMarkers is only ever called per-line today
    // (ThreeLayer.ts: buildStationMarkers([line])), so this case does not
    // occur in the real app — but buildMarkerPair's guard is written to be
    // safe if that ever changes, and this pins that safety net directly
    // rather than trusting it by inspection alone.
    const group = buildStationMarkers([
      line({ key: "a", color: "#660066" }),
      line({ key: "b", color: "#1964B7" }),
    ]);
    const discs = group.children[0] as THREE.InstancedMesh;
    // Falls back to white (under-treated) rather than stamping either
    // line's colour onto the shared material.
    expect(materialAlbedo(discs.material as THREE.MeshLambertMaterial)).toBe(0xffffff);
  });
});
