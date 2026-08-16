import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { patchInstancedEmissive, VehicleManager } from "./VehicleManager";
import {
  LANE_ROUTE_IDX,
  LANE_RUN_IDX,
  LANE_X,
  LANE_Y,
  LANE_YAW,
  LANE_Z,
  VEHICLE_STRIDE,
} from "../sim/protocol";

/**
 * Coverage for the per-instance emissive boost (code review 2026-08-15, the
 * selected-train highlight washed out by the night emissive floor). Split in
 * two, matching the two things that can't both be tested the same way:
 *
 *   - `patchInstancedEmissive`'s GLSL string surgery is pure and tested
 *     directly against a minimal fake shader object — real shader
 *     compilation needs a WebGL context this project's jsdom test
 *     environment doesn't have, but the string transformation itself does
 *     not, and a Three version bump moving these literal include markers
 *     would otherwise break the patch silently.
 *   - The per-instance attribute WRITES (which slot gets boosted, which
 *     doesn't) are tested against a real `VehicleManager`, reading the raw
 *     `instanceEmissive` geometry attribute back out after `update()` —
 *     this is real object construction and real typed-array writes, not a
 *     rendered pixel, so it needs no WebGL context either.
 */

function vehicleRow(routeIdx: number, runIdx: number): number[] {
  const row = new Array(VEHICLE_STRIDE).fill(0);
  row[LANE_X] = 0;
  row[LANE_Y] = 0;
  row[LANE_Z] = 0;
  row[LANE_YAW] = 0;
  row[LANE_RUN_IDX] = runIdx;
  row[LANE_ROUTE_IDX] = routeIdx;
  return row;
}

describe("patchInstancedEmissive", () => {
  test("declares the attribute and varying, and threads the varying through both stages", () => {
    const shader = {
      vertexShader: [
        "#define LAMBERT",
        "varying vec3 vViewPosition;",
        "#include <common>",
        "void main() {",
        "\t#include <uv_vertex>",
        "\t#include <color_vertex>",
        "}",
      ].join("\n"),
      fragmentShader: [
        "#define LAMBERT",
        "uniform vec3 diffuse;",
        "uniform vec3 emissive;",
        "uniform float opacity;",
        "void main() {",
        "\tvec3 totalEmissiveRadiance = emissive;",
        "}",
      ].join("\n"),
    };
    patchInstancedEmissive(shader);

    expect(shader.vertexShader).toContain("attribute vec3 instanceEmissive;");
    expect(shader.vertexShader).toContain("varying vec3 vInstanceEmissive;");
    expect(shader.vertexShader).toContain("vInstanceEmissive = instanceEmissive;");
    // The assignment must land inside main(), after color_vertex — verified
    // by position, not just presence, so a future edit that puts it outside
    // main() (a compile error) would still fail this test.
    const assignIdx = shader.vertexShader.indexOf("vInstanceEmissive = instanceEmissive;");
    const mainIdx = shader.vertexShader.indexOf("void main()");
    const colorVertexIdx = shader.vertexShader.indexOf("#include <color_vertex>");
    expect(assignIdx).toBeGreaterThan(mainIdx);
    expect(assignIdx).toBeGreaterThan(colorVertexIdx);

    expect(shader.fragmentShader).toContain("varying vec3 vInstanceEmissive;");
    expect(shader.fragmentShader).toContain(
      "vec3 totalEmissiveRadiance = emissive + vInstanceEmissive;",
    );
    // The old assignment must be GONE, not just superseded — two conflicting
    // `totalEmissiveRadiance` declarations in the same scope is a compile
    // error, so a naive .replace() that duplicated rather than substituted
    // would fail this.
    expect(shader.fragmentShader).not.toContain("vec3 totalEmissiveRadiance = emissive;\n");
  });

  test("is a no-op on a shader missing the expected literal markers, rather than throwing", () => {
    // String.replace() on a non-matching pattern is a silent no-op, not an
    // error — documented here as the known failure mode if Three ever moves
    // these markers, since patchInstancedEmissive itself has no way to
    // detect that its patch didn't take.
    const shader = { vertexShader: "// nothing here", fragmentShader: "// nothing here" };
    expect(() => patchInstancedEmissive(shader)).not.toThrow();
    expect(shader.vertexShader).toBe("// nothing here");
  });
});

describe("VehicleManager per-instance emissive boost", () => {
  function manager() {
    return new VehicleManager([{ color: "#1964B7", vehicleType: "heavy" }]);
  }

  function instanceEmissiveAt(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
    const attr = mesh.geometry.attributes.instanceEmissive as THREE.InstancedBufferAttribute;
    return [attr.getX(slot), attr.getY(slot), attr.getZ(slot)];
  }

  test("is allocated at construction, sized to capacity, and starts at zero", () => {
    const m = manager();
    const attr = m.meshes[0].geometry.attributes.instanceEmissive as THREE.InstancedBufferAttribute;
    expect(attr).toBeDefined();
    expect(attr.count).toBe(m.meshes[0].instanceMatrix.count); // == MAX_VEHICLES
    expect(instanceEmissiveAt(m.meshes[0], 0)).toEqual([0, 0, 0]);
  });

  test("boosts only the selected slot, leaves every other active slot at zero", () => {
    const m = manager();
    const vehicles = new Float32Array([
      ...vehicleRow(0, 10),
      ...vehicleRow(0, 11),
      ...vehicleRow(0, 12),
    ]);
    m.update(vehicles, 3, /* selectedRunIdx */ 11);

    const mesh = m.meshes[0];
    const boosted = instanceEmissiveAt(mesh, 1); // run 11 packs into slot 1
    const plain0 = instanceEmissiveAt(mesh, 0);
    const plain2 = instanceEmissiveAt(mesh, 2);

    expect(boosted.some((c) => c > 0)).toBe(true);
    // Warm gold: red channel strictly the largest, blue strictly the
    // smallest — the actual magnitude is a design choice, not asserted
    // exactly, but the hue is part of the stated intent (echoing
    // TINT_SELECTED's own warm bias) and worth pinning.
    expect(boosted[0]).toBeGreaterThan(boosted[1]);
    expect(boosted[1]).toBeGreaterThan(boosted[2]);
    expect(plain0).toEqual([0, 0, 0]);
    expect(plain2).toEqual([0, 0, 0]);
  });

  test("clears a previously-boosted slot once nothing is selected", () => {
    const m = manager();
    const vehicles = new Float32Array([...vehicleRow(0, 10)]);
    m.update(vehicles, 1, 10);
    expect(instanceEmissiveAt(m.meshes[0], 0).some((c) => c > 0)).toBe(true);

    m.update(vehicles, 1, null);
    expect(instanceEmissiveAt(m.meshes[0], 0)).toEqual([0, 0, 0]);
  });

  test("marks the attribute dirty exactly when tints are written, mirroring instanceColor", () => {
    // `needsUpdate` is a setter-only property on BufferAttribute (no getter
    // — reading it back is always `undefined`); `.version`, which the
    // setter increments, is the real observable signal that it fired.
    const m = manager();
    const vehicles = new Float32Array([...vehicleRow(0, 10)]);
    const attr = m.meshes[0].geometry.attributes.instanceEmissive as THREE.InstancedBufferAttribute;

    const before = attr.version;
    m.update(vehicles, 1, 10); // a selection exists -> writeTints is true
    expect(attr.version).toBeGreaterThan(before);
  });
});

describe("VehicleManager stale-tail clearing (code review 2026-08-15)", () => {
  function manager() {
    return new VehicleManager([{ color: "#1964B7", vehicleType: "heavy" }]);
  }

  function instanceEmissiveAt(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
    const attr = mesh.geometry.attributes.instanceEmissive as THREE.InstancedBufferAttribute;
    return [attr.getX(slot), attr.getY(slot), attr.getZ(slot)];
  }

  function instanceColorAt(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
    const attr = mesh.instanceColor!;
    return [attr.getX(slot), attr.getY(slot), attr.getZ(slot)];
  }

  test("a slot that held the boost is cleared once the fleet shrinks below it and the selection is dropped, in one frame", () => {
    const m = manager();
    const mesh = m.meshes[0];
    const tenActive = new Float32Array(
      Array.from({ length: 10 }, (_, i) => vehicleRow(0, i)).flat(),
    );
    m.update(tenActive, 10, /* selectedRunIdx */ 7); // run 7 packs into slot 7
    expect(instanceEmissiveAt(mesh, 7).some((c) => c > 0)).toBe(true);

    const sixActive = new Float32Array(
      Array.from({ length: 6 }, (_, i) => vehicleRow(0, i)).flat(),
    );
    m.update(sixActive, 6, null); // shrink AND deselect together
    expect(instanceEmissiveAt(mesh, 7)).toEqual([0, 0, 0]);
    expect(instanceColorAt(mesh, 7)).toEqual([1, 1, 1]);
  });

  test("the reported multi-frame sequence: shrink while still selected, deselect, then regrow with nothing selected", () => {
    // The exact scenario from the review: (1) 10 active, run 7 selected,
    // packs into slot 7; (2) fleet shrinks to 6 — run 7 drops off the
    // active list too, but selectedRunIdx is unchanged, so writeTints stays
    // true and slots 0-5 get rewritten, slot 7 untouched by the per-vehicle
    // loop (nothing packs there this frame); (3) user deselects — one more
    // writeTints=true frame, still only 6 active, slot 7 still not reached
    // by the per-vehicle loop; (4) fleet grows back to 10 with NOTHING
    // selected throughout — writeTints is false the whole time, so if slot
    // 7 were still stale from step 1, it would silently reappear here.
    const m = manager();
    const mesh = m.meshes[0];
    const withRun7AtSlot7 = new Float32Array(
      Array.from({ length: 10 }, (_, i) => vehicleRow(0, i === 7 ? 7 : 100 + i)).flat(),
    );
    m.update(withRun7AtSlot7, 10, 7);
    expect(instanceEmissiveAt(mesh, 7).some((c) => c > 0)).toBe(true);

    const sixOthersNoRun7 = new Float32Array(
      Array.from({ length: 6 }, (_, i) => vehicleRow(0, 200 + i)).flat(),
    );
    m.update(sixOthersNoRun7, 6, 7); // shrink; run 7 still "selected" but absent
    m.update(sixOthersNoRun7, 6, null); // deselect

    const tenOthersNoneSelected = new Float32Array(
      Array.from({ length: 10 }, (_, i) => vehicleRow(0, 300 + i)).flat(),
    );
    m.update(tenOthersNoneSelected, 10, null); // regrow past slot 7, nothing selected

    expect(instanceEmissiveAt(mesh, 7)).toEqual([0, 0, 0]);
    expect(instanceColorAt(mesh, 7)).toEqual([1, 1, 1]);
  });
});
