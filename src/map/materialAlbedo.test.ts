import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { materialAlbedo } from "./materialAlbedo";
import { resolveStock } from "./rollingStock";
import { VehicleManager } from "./VehicleManager";

/**
 * Regression coverage for the actual wiring, not just `nightLift`'s own
 * numeric behaviour (see the note on `nightLift.test.ts`'s "white needs far
 * less lift..." test for why that one alone doesn't guard this).
 */

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
      { color: "#1964B7", stock: resolveStock({ color: "#1964B7", vehicleType: "heavy", rollingStock: null }) },
      {
        color: "#FBC02D",
        stock: resolveStock({ color: "#FBC02D", vehicleType: "monorail", rollingStock: null }),
      },
    ]);
    const blueMaterial = manager.meshes[0].material as THREE.MeshLambertMaterial;
    const yellowMaterial = manager.meshes[1].material as THREE.MeshLambertMaterial;
    expect(materialAlbedo(blueMaterial)).toBe(0x1964b7);
    expect(materialAlbedo(blueMaterial)).not.toBe(0xffffff);
    expect(materialAlbedo(yellowMaterial)).toBe(0xfbc02d);
  });

  test("MeshStandardMaterial reports its own color or stamped liveryHex", () => {
    const std = new THREE.MeshStandardMaterial({ color: 0x22c55e });
    expect(materialAlbedo(std)).toBe(0x22c55e);

    const stamped = new THREE.MeshStandardMaterial({ color: 0xffffff });
    stamped.userData.liveryHex = 0xe11d48;
    expect(materialAlbedo(stamped)).toBe(0xe11d48);
  });
});
