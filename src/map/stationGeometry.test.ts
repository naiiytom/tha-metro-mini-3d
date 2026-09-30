import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  STATION_DIMENSIONS,
  buildStationGeometry,
  buildStationHighlightFrame,
  computeStationTangentHeading,
  createCanopyGeometry,
  createColumnGeometry,
  createPlatformGeometry,
  createTrimGeometry,
  suppressStationInMeshGroup,
} from "./stationGeometry";
import type { LineGeometry } from "../types";

const makeLine = (over: Partial<LineGeometry> = {}): LineGeometry => ({
  key: "test-line",
  name: "Test Line",
  nameTh: "สายทดสอบ",
  color: "#1964B7",
  structure: "elevated",
  vehicleType: "heavy",
  gtfsRouteId: "1",
  preRevenue: false,
  syntheticSchedule: null,
  estimatedRunTimes: null,
  rollingStock: null,
  relationId: 1,
  osmName: "Test Line",
  track: [
    [100.53, 13.74, 15, "elevated"],
    [100.54, 13.74, 15, "elevated"],
    [100.55, 13.74, -18, "underground"],
  ],
  stations: [
    { id: "S1", name: "Station 1", nameTh: "สถานี 1", code: "S1", position: [100.535, 13.74, 15] },
    { id: "S2", name: "Station 2", nameTh: "สถานี 2", code: "S2", position: [100.545, 13.74, -18] },
  ],
  ...over,
});

describe("computeStationTangentHeading", () => {
  it("computes 0 rad (East) for an East-running track segment", () => {
    const track = [new THREE.Vector3(0, 0, 15), new THREE.Vector3(100, 0, 15)];
    const heading = computeStationTangentHeading([50, 0, 15], track);
    expect(heading).toBeCloseTo(0);
  });

  it("computes PI/2 rad (North) for a North-running track segment", () => {
    const track = [new THREE.Vector3(0, 0, 15), new THREE.Vector3(0, 100, 15)];
    const heading = computeStationTangentHeading([0, 50, 15], track);
    expect(heading).toBeCloseTo(Math.PI / 2);
  });

  it("handles empty or single-point track cleanly", () => {
    expect(computeStationTangentHeading([0, 0, 0], [])).toBe(0);
    expect(computeStationTangentHeading([0, 0, 0], [new THREE.Vector3(0, 0, 0)])).toBe(0);
  });
});

describe("procedural geometry generators", () => {
  const dims = STATION_DIMENSIONS.heavy;

  it("creates platform geometry with bounds matching dimensions", () => {
    const geo = createPlatformGeometry(dims);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(dims.lengthM);
    expect(box.max.y - box.min.y).toBeCloseTo(dims.widthM);
    // Platform top face sits at z = 0
    expect(box.max.z).toBeCloseTo(0);
  });

  it("creates elevated arched canopy with apex at canopyHeightM", () => {
    const geo = createCanopyGeometry(dims, "elevated");
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(dims.lengthM);
    expect(box.max.z).toBeCloseTo(dims.canopyHeightM, 0);
  });

  it("creates underground canopy roof slab at canopyHeightM", () => {
    const geo = createCanopyGeometry(dims, "underground");
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(dims.lengthM);
    expect(box.max.z).toBeCloseTo(dims.canopyHeightM + 0.4);
  });

  it("creates trim rails and column geometry", () => {
    const trim = createTrimGeometry(dims);
    expect(trim).toBeDefined();
    const col = createColumnGeometry();
    expect(col).toBeDefined();
  });
});

describe("buildStationGeometry", () => {
  it("builds separate surface and underground instanced groups for mixed lines", () => {
    const l = makeLine();
    const group = buildStationGeometry(l);

    expect(group.name).toBe("stations-test-line");
    expect(group.userData.lineKey).toBe("test-line");

    // S1 is elevated (surface), S2 is underground (-18m)
    // 4 meshes for surface (platform, canopy, trim, pillar) + 4 meshes for underground
    expect(group.children).toHaveLength(8);

    const surfaceMeshes = group.children.filter((c) => c.userData.structure !== "underground");
    const ugMeshes = group.children.filter((c) => c.userData.structure === "underground");

    expect(surfaceMeshes).toHaveLength(4);
    expect(ugMeshes).toHaveLength(4);

    // Canopies and trims are tagged with isCanopy = true for 2D mode toggling
    const canopyMeshes = group.children.filter((c) => c.userData.isCanopy === true);
    expect(canopyMeshes).toHaveLength(4); // 2 surface (canopy, trim) + 2 underground (canopy, trim)
  });

  it("stamps trim material with route liveryHex for night contrast lift", () => {
    const l = makeLine({ color: "#7CB342" });
    const group = buildStationGeometry(l);

    const trims = group.children.find(
      (c) => c.userData.isTrim && (c as THREE.InstancedMesh).count > 0,
    ) as THREE.InstancedMesh;
    expect(trims).toBeDefined();

    const mat = trims.material as THREE.MeshLambertMaterial;
    expect(mat.userData.liveryHex).toBe(new THREE.Color("#7CB342").getHex());
  });

  it("suppresses specified station IDs from procedural generation", () => {
    const l = makeLine();
    const suppressed = new Set(["S1"]);
    const group = buildStationGeometry(l, suppressed);

    // Only S2 (underground) should be generated
    expect(group.children).toHaveLength(4);
    expect(group.children.every((c) => c.userData.structure === "underground")).toBe(true);
  });

  it("returns empty group for line with no stations", () => {
    const l = makeLine({ stations: [] });
    const group = buildStationGeometry(l);
    expect(group.children).toHaveLength(0);
  });
});

describe("buildStationHighlightFrame", () => {
  it("builds hovering frames for selected stops", () => {
    const stops = [
      { x: 100, y: 200, z: 15, heading: 0, vehicleType: "heavy" as const },
      { x: 300, y: 400, z: 15, heading: Math.PI / 4, vehicleType: "monorail" as const },
    ];
    const group = buildStationHighlightFrame(stops);
    expect(group.children).toHaveLength(2);

    const first = group.children[0] as THREE.Mesh;
    expect(first.position.x).toBe(100);
    expect(first.position.y).toBe(200);
    // Hovering above canopy (15 + 6.5 + 2.5 = 24)
    expect(first.position.z).toBeCloseTo(24);
    expect(first.rotation.z).toBe(0);

    const second = group.children[1] as THREE.Mesh;
    expect(second.position.x).toBe(300);
    expect(second.position.y).toBe(400);
    // Monorail canopy is lower (15 + 5.0 + 2.5 = 22.5)
    expect(second.position.z).toBeCloseTo(22.5);
    expect(second.rotation.z).toBeCloseTo(Math.PI / 4);
  });

  it("returns empty group for empty stops array", () => {
    const group = buildStationHighlightFrame([]);
    expect(group.children).toHaveLength(0);
  });
});

describe("suppressStationInMeshGroup", () => {
  it("dynamically zeroes transform matrix for matching stop IDs and codes while preserving others", () => {
    const l = makeLine({
      stations: [
        { id: "S1", name: "Station 1", nameTh: "สถานี 1", code: "CEN", position: [100.535, 13.74, 15], hubId: "hub:siam" },
        { id: "S2", name: "Station 2", nameTh: "สถานี 2", code: "E1", position: [100.545, 13.74, 15] },
      ],
    });
    const group = buildStationGeometry(l);

    const platforms = group.getObjectByName("station-platforms") as THREE.InstancedMesh;
    expect(platforms).toBeDefined();

    // Verify both instances have non-zero scale initially
    const m0 = new THREE.Matrix4();
    const m1 = new THREE.Matrix4();
    platforms.getMatrixAt(0, m0);
    platforms.getMatrixAt(1, m1);

    const scale0 = new THREE.Vector3();
    const scale1 = new THREE.Vector3();
    m0.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale0);
    m1.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale1);

    expect(m0.getMaxScaleOnAxis()).toBeGreaterThan(0.1);
    expect(m1.getMaxScaleOnAxis()).toBeGreaterThan(0.1);

    // Suppress by stop code "CEN"
    const updated = suppressStationInMeshGroup(group, new Set(["CEN"]));
    expect(updated).toBe(4); // platforms, canopies, trims, pillars

    platforms.getMatrixAt(0, m0);
    platforms.getMatrixAt(1, m1);

    // S1 (index 0) has collapsed to zero scale
    expect(m0.getMaxScaleOnAxis()).toBe(0);

    // S2 (index 1) remains unaffected
    expect(m1.getMaxScaleOnAxis()).toBeGreaterThan(0.1);
  });

  it("suppresses member stop instances when parent hubId is targeted", () => {
    const l = makeLine({
      stations: [
        { id: "S1", name: "Station 1", nameTh: "สถานี 1", code: "CEN", position: [100.535, 13.74, 15], hubId: "hub:siam" },
      ],
    });
    const group = buildStationGeometry(l);
    const platforms = group.getObjectByName("station-platforms") as THREE.InstancedMesh;

    suppressStationInMeshGroup(group, new Set(["hub:siam"]));

    const m = new THREE.Matrix4();
    platforms.getMatrixAt(0, m);
    expect(m.getMaxScaleOnAxis()).toBe(0);
  });
});

describe("computeStationTangentHeading edge cases", () => {
  it("computes cardinal headings correctly", () => {
    // Eastward (heading 0)
    const eastTrack = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(computeStationTangentHeading([50, 0, 0], eastTrack)).toBeCloseTo(0);

    // Northward (heading PI/2)
    const northTrack = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
    expect(computeStationTangentHeading([0, 50, 0], northTrack)).toBeCloseTo(Math.PI / 2);

    // Westward (heading PI)
    const westTrack = [{ x: 100, y: 0 }, { x: 0, y: 0 }];
    expect(Math.abs(computeStationTangentHeading([50, 0, 0], westTrack))).toBeCloseTo(Math.PI);

    // Southward (heading -PI/2)
    const southTrack = [{ x: 0, y: 100 }, { x: 0, y: 0 }];
    expect(computeStationTangentHeading([0, 50, 0], southTrack)).toBeCloseTo(-Math.PI / 2);
  });

  it("handles degenerate or single-point tracks safely", () => {
    expect(computeStationTangentHeading([0, 0, 0], [])).toBe(0);
    expect(computeStationTangentHeading([0, 0, 0], [{ x: 10, y: 10 }])).toBe(0);
    // Coincident points
    expect(computeStationTangentHeading([0, 0, 0], [{ x: 10, y: 10 }, { x: 10, y: 10 }])).toBe(0);
  });
});
