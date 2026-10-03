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
  snapStationToTrack,
  snapStationsToTrack,
  suppressStationInMeshGroup,
} from "./stationGeometry";
import type { LineGeometry } from "../types";
import { lngLatAltToLocal } from "./coordinates";
import network from "../data/network.json";

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

describe("snapStationToTrack", () => {
  it("snaps an off-track station horizontally onto track centerline and computes tangent heading", () => {
    const l = makeLine({
      track: [
        [100.53, 13.74, 15, "elevated"],
        [100.54, 13.74, 15, "elevated"],
      ],
      stations: [
        // Station node is ~60m north of track
        { id: "S1", name: "Off-track", nameTh: "นอกทาง", code: "OT1", position: [100.535, 13.7405, 15] },
      ],
    });

    const snap = snapStationToTrack(l.stations[0], l);
    // Heading should be 0 (running East)
    expect(snap.heading).toBeCloseTo(0);
    expect(snap.structure).toBe("elevated");
    // Snapped y should match track latitude (13.74), not station latitude (13.7405)
    const expectedTrackY = lngLatAltToLocal([100.535, 13.74, 15])[1];
    expect(snap.localPos[1]).toBeCloseTo(expectedTrackY, 1);
    expect(snap.localPos[2]).toBeCloseTo(15, 1);
  });

  it("snaps underground station to negative track altitude and assigns underground structure", () => {
    const l = makeLine({
      track: [
        [100.54, 13.74, -18, "underground"],
        [100.55, 13.74, -18, "underground"],
      ],
      stations: [
        // Stale nominal altitude 15m from OSM
        { id: "UG1", name: "Underground", nameTh: "ใต้ดิน", code: "BL10", position: [100.545, 13.74, 15] },
      ],
    });

    const snap = snapStationToTrack(l.stations[0], l);
    expect(snap.structure).toBe("underground");
    expect(snap.localPos[2]).toBeCloseTo(-18, 1);
  });

  it("resolves atGrade structure for atGrade track segments", () => {
    const l = makeLine({
      track: [
        [100.53, 13.74, 0, "atGrade"],
        [100.54, 13.74, 0, "atGrade"],
      ],
      stations: [
        { id: "AG1", name: "At Grade", nameTh: "ระดับดิน", code: "RN01", position: [100.535, 13.74, 0] },
      ],
    });

    const snap = snapStationToTrack(l.stations[0], l);
    expect(snap.structure).toBe("atGrade");
    expect(snap.localPos[2]).toBeCloseTo(0, 1);
  });
});

describe("snapStationsToTrack", () => {
  it("updates station.position in place to track centerline and altitude", () => {
    const l = makeLine({
      track: [
        [100.54, 13.74, -18, "underground"],
        [100.55, 13.74, -18, "underground"],
      ],
      stations: [
        { id: "UG1", name: "Underground", nameTh: "ใต้ดิน", code: "BL10", position: [100.545, 13.7405, 15] },
      ],
    });

    snapStationsToTrack([l]);
    // Altitude updated from 15 to -18
    expect(l.stations[0].position[2]).toBeCloseTo(-18, 1);
    // Latitude snapped to track (13.74)
    expect(l.stations[0].position[1]).toBeCloseTo(13.74, 4);
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

  it("creates trim rails aligned with arch eaves for elevated and ceiling for underground", () => {
    const elevatedTrim = createTrimGeometry(dims, "elevated");
    elevatedTrim.computeBoundingBox();
    const elevatedBox = elevatedTrim.boundingBox!;
    const canopyWidth = dims.widthM + dims.canopyOverhangM * 2;
    const radius = canopyWidth * 0.75;
    const thetaHalf = Math.asin(Math.min((canopyWidth / 2) / radius, 0.95));
    const expectedElevatedZ = dims.canopyHeightM - radius + radius * Math.cos(thetaHalf);
    // Center of rail is at expectedElevatedZ, rail thickness is 0.6 (-0.3 to +0.3)
    expect(elevatedBox.max.z).toBeCloseTo(expectedElevatedZ + 0.3);

    const undergroundTrim = createTrimGeometry(dims, "underground");
    undergroundTrim.computeBoundingBox();
    const ugBox = undergroundTrim.boundingBox!;
    expect(ugBox.max.z).toBeCloseTo(dims.canopyHeightM);

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

  it("suppresses specified station IDs, hub IDs, and station names from procedural generation", () => {
    const l = makeLine({
      stations: [
        { id: "S1", name: "Siam", nameTh: "สยาม", code: "CEN", position: [100.535, 13.74, 15], hubId: "hub:siam" },
        { id: "S2", name: "Silom", nameTh: "สีลม", code: "BL26", position: [100.545, 13.74, -18] },
      ],
    });

    // Suppress by hubId
    const groupHub = buildStationGeometry(l, new Set(["hub:siam"]));
    expect(groupHub.children).toHaveLength(4);
    expect(groupHub.children.every((c) => c.userData.structure === "underground")).toBe(true);

    // Suppress by station name
    const groupName = buildStationGeometry(l, new Set(["Siam"]));
    expect(groupName.children).toHaveLength(4);
    expect(groupName.children.every((c) => c.userData.structure === "underground")).toBe(true);
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
      track: [
        [100.53, 13.74, 15, "elevated"],
        [100.54, 13.74, 15, "elevated"],
        [100.55, 13.74, 15, "elevated"],
      ],
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

  it("suppresses member stop instances when station name is targeted", () => {
    const l = makeLine({
      stations: [
        { id: 101, name: "Siam", nameTh: "สยาม", code: "", position: [100.535, 13.74, 15] },
      ],
    });
    const group = buildStationGeometry(l);
    const platforms = group.getObjectByName("station-platforms") as THREE.InstancedMesh;

    suppressStationInMeshGroup(group, new Set(["Siam"]));

    const m = new THREE.Matrix4();
    platforms.getMatrixAt(0, m);
    expect(m.getMaxScaleOnAxis()).toBe(0);
  });

  it("suppresses member stop instances when stringified numeric ID is targeted", () => {
    const l = makeLine({
      stations: [
        { id: 12345, name: "Siam", nameTh: "สยาม", code: "", position: [100.535, 13.74, 15] },
      ],
    });
    const group = buildStationGeometry(l);
    const platforms = group.getObjectByName("station-platforms") as THREE.InstancedMesh;

    suppressStationInMeshGroup(group, new Set(["12345"]));

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

describe("snapStationsToTrack on real network data", () => {
  it("resolves all 22 underground stations on MRT Blue and snaps off-track stations to track", () => {
    // Clone blue line so test does not mutate shared import
    const rawBlue = network.lines.find((l) => l.key === "blue")!;
    const blueLine = JSON.parse(JSON.stringify(rawBlue)) as LineGeometry;

    snapStationsToTrack([blueLine]);

    const undergroundStops = blueLine.stations.filter((s) => s.position[2] < 0);
    expect(undergroundStops).toHaveLength(22);

    // Underground landmarks correctly sit at -18m
    const huaLamphong = blueLine.stations.find((s) => s.name === "Hua Lamphong");
    expect(huaLamphong).toBeDefined();
    expect(huaLamphong!.position[2]).toBeCloseTo(-18, 1);

    const sukhumvit = blueLine.stations.find((s) => s.name === "Sukhumvit");
    expect(sukhumvit).toBeDefined();
    expect(sukhumvit!.position[2]).toBeCloseTo(-18, 1);

    // Elevated stops stay at +15m
    const thaPhra = blueLine.stations.find((s) => s.name === "Tha Phra");
    expect(thaPhra).toBeDefined();
    expect(thaPhra!.position[2]).toBeCloseTo(15, 1);

    // Kamphaeng Phet was ~72.6m off track; now snapped directly onto the track (< 1m)
    const kpp = blueLine.stations.find((s) => s.name === "Kamphaeng Phet");
    expect(kpp).toBeDefined();
    const kppLocal = lngLatAltToLocal(kpp!.position);
    let minPolyDistSq = Infinity;
    for (let i = 0; i < blueLine.track.length - 1; i++) {
      const a = lngLatAltToLocal([blueLine.track[i][0], blueLine.track[i][1], blueLine.track[i][2]]);
      const b = lngLatAltToLocal([blueLine.track[i + 1][0], blueLine.track[i + 1][1], blueLine.track[i + 1][2]]);
      const abX = b[0] - a[0];
      const abY = b[1] - a[1];
      const lenSq = abX * abX + abY * abY;
      if (lenSq < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((kppLocal[0] - a[0]) * abX + (kppLocal[1] - a[1]) * abY) / lenSq));
      const px = a[0] + t * abX;
      const py = a[1] + t * abY;
      const dSq = (kppLocal[0] - px) ** 2 + (kppLocal[1] - py) ** 2;
      if (dSq < minPolyDistSq) minPolyDistSq = dSq;
    }
    expect(Math.sqrt(minPolyDistSq)).toBeLessThan(0.01);
  });

  it("aligns Makkasan station canopy exactly with the simulation train stop position", () => {
    const rawArl = network.lines.find((l) => l.key === "arl")!;
    const arlLine = JSON.parse(JSON.stringify(rawArl)) as LineGeometry;

    const makkasan = arlLine.stations.find((s) => s.name === "Makkasan")!;
    expect(makkasan).toBeDefined();

    const snap = snapStationToTrack(makkasan, arlLine);

    // Simulation engine train stop position for ARL Makkasan from network.tmb
    const engineTrainStop = [3031.2874, 598.36, 15];
    const distToTrainStopM = Math.hypot(
      snap.localPos[0] - engineTrainStop[0],
      snap.localPos[1] - engineTrainStop[1],
    );

    // Station canopy center and train dwell position must align within 0.1 meter
    expect(distToTrainStopM).toBeLessThan(0.1);
    expect(snap.structure).toBe("elevated");
  });
});

