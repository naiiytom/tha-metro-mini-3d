import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LineGeometry, Station, Structure, VehicleType } from "../types";
import { lngLatAltToLocal, localToLngLat, STATION_MARKER_HEIGHT_M } from "./coordinates";
import { poleTransform } from "./trackGeometry";

/**
 * Procedural 3D station geometry generator.
 *
 * Replaces simple cylinder disc markers with track-aligned procedural platform
 * decks, support pillars/access shafts, and vaulted canopy roofs.
 *
 * Implements 4 structural expressions:
 * - elevated: viaduct platform deck, support columns down to z = 0, arched canopy roof.
 * - underground: platform deck at negative elevation, cavern shell, vertical access shafts rising to z = 0.
 * - atGrade: ground-level platform slab with shelter roofs.
 * - monorail/apm: compact 60 m footprint matching narrow straddle beam/guideway profiles.
 *
 * Draw calls stay O(lines) via InstancedMeshes per line and structure band (SRS §3A.5).
 */

export interface StationDimensions {
  lengthM: number;
  widthM: number;
  platformThicknessM: number;
  canopyHeightM: number;
  canopyOverhangM: number;
}

export const STATION_DIMENSIONS: Record<VehicleType, StationDimensions> = {
  heavy: {
    lengthM: 120,
    widthM: 14,
    platformThicknessM: 1.5,
    canopyHeightM: 6.5,
    canopyOverhangM: 1.5,
  },
  commuter: {
    lengthM: 120,
    widthM: 14,
    platformThicknessM: 1.5,
    canopyHeightM: 6.5,
    canopyOverhangM: 1.5,
  },
  monorail: {
    lengthM: 60,
    widthM: 8,
    platformThicknessM: 1.2,
    canopyHeightM: 5.0,
    canopyOverhangM: 1.0,
  },
  apm: {
    lengthM: 60,
    widthM: 8,
    platformThicknessM: 1.2,
    canopyHeightM: 5.0,
    canopyOverhangM: 1.0,
  },
};

export interface SnappedStationInfo {
  localPos: [number, number, number];
  heading: number;
  structure: Structure;
}

/**
 * Snaps a station onto the track polyline of its line, returning its
 * track-centerline ENU position, track tangent heading, and resolved structure.
 */
export function snapStationToTrack(
  station: Station,
  line: LineGeometry,
): SnappedStationInfo {
  const stationLocal = lngLatAltToLocal(station.position);

  if (!line.track || line.track.length < 2) {
    const isUg = station.position[2] < 0;
    return {
      localPos: stationLocal,
      heading: 0,
      structure: isUg ? "underground" : (line.structure ?? "elevated"),
    };
  }

  const trackLocal = line.track.map((p) => ({
    pos: lngLatAltToLocal([p[0], p[1], p[2]]),
    structure: p[3],
  }));

  let bestDistSq = Infinity;
  let bestProj: [number, number, number] = stationLocal;
  let bestHeading = 0;
  let bestStructure: Structure = line.structure ?? "elevated";

  for (let i = 0; i < trackLocal.length - 1; i++) {
    const a = trackLocal[i].pos;
    const b = trackLocal[i + 1].pos;
    const abX = b[0] - a[0];
    const abY = b[1] - a[1];
    const lenSq = abX * abX + abY * abY;
    if (lenSq < 1e-6) continue;

    const t = Math.max(
      0,
      Math.min(
        1,
        ((stationLocal[0] - a[0]) * abX + (stationLocal[1] - a[1]) * abY) / lenSq,
      ),
    );
    const projX = a[0] + t * abX;
    const projY = a[1] + t * abY;
    const projZ = a[2] + t * (b[2] - a[2]);
    const dSq = (stationLocal[0] - projX) ** 2 + (stationLocal[1] - projY) ** 2;

    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestProj = [projX, projY, projZ];
      bestHeading = Math.atan2(abY, abX);

      const isUg =
        projZ < 0 ||
        trackLocal[i].structure === "underground" ||
        trackLocal[i + 1].structure === "underground";
      if (isUg) {
        bestStructure = "underground";
      } else if (
        trackLocal[i].structure === "atGrade" ||
        trackLocal[i + 1].structure === "atGrade" ||
        line.structure === "atGrade"
      ) {
        bestStructure = "atGrade";
      } else {
        bestStructure = "elevated";
      }
    }
  }

  return {
    localPos: bestProj,
    heading: bestHeading,
    structure: bestStructure,
  };
}

/**
 * Snaps all stations in the given lines to their track polylines, updating
 * each station's geographic position [lng, lat, alt] to sit on the track
 * centerline at the true track altitude.
 */
export function snapStationsToTrack(lines: LineGeometry[]): void {
  for (const line of lines) {
    if (!line.track || line.track.length < 2) continue;
    for (const station of line.stations) {
      const snap = snapStationToTrack(station, line);
      const geo = localToLngLat(snap.localPos[0], snap.localPos[1]);
      station.position = [geo.lng, geo.lat, snap.localPos[2]];
    }
  }
}

/**
 * Computes the forward track tangent heading (yaw in radians) at a station's position
 * along the track polyline.
 */
export function computeStationTangentHeading(
  stationPosLocal: [number, number, number],
  trackPointsLocal: readonly { x: number; y: number }[],
): number {
  if (trackPointsLocal.length < 2) return 0;
  let bestDistSq = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < trackPointsLocal.length - 1; i++) {
    const a = trackPointsLocal[i];
    const b = trackPointsLocal[i + 1];
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lenSq = abX * abX + abY * abY;
    if (lenSq < 1e-6) continue;

    const t = Math.max(
      0,
      Math.min(
        1,
        ((stationPosLocal[0] - a.x) * abX + (stationPosLocal[1] - a.y) * abY) / lenSq,
      ),
    );
    const projX = a.x + t * abX;
    const projY = a.y + t * abY;
    const dSq = (stationPosLocal[0] - projX) ** 2 + (stationPosLocal[1] - projY) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  const p1 = trackPointsLocal[bestIdx];
  const p2 = trackPointsLocal[bestIdx + 1];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.atan2(dy, dx);
}

/** Create platform deck slab geometry, top face centered at z = 0. */
export function createPlatformGeometry(dims: StationDimensions): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(dims.lengthM, dims.widthM, dims.platformThicknessM);
  geo.translate(0, 0, -dims.platformThicknessM / 2);
  return geo;
}

/**
 * Create canopy roof geometry.
 * Sits over the platform at z = canopyHeightM.
 */
export function createCanopyGeometry(
  dims: StationDimensions,
  structure: Structure,
): THREE.BufferGeometry {
  if (structure === "underground") {
    // Underground cavern ceiling slab
    const geo = new THREE.BoxGeometry(dims.lengthM, dims.widthM + dims.canopyOverhangM * 2, 0.8);
    geo.translate(0, 0, dims.canopyHeightM);
    return geo;
  }

  // Elevated / At-grade arched vault canopy
  const canopyWidth = dims.widthM + dims.canopyOverhangM * 2;
  const radius = canopyWidth * 0.75;
  const thetaHalf = Math.asin(Math.min((canopyWidth / 2) / radius, 0.95));
  const thetaStart = -thetaHalf;
  const thetaLength = 2 * thetaHalf;

  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    dims.lengthM,
    16,
    1,
    true,
    thetaStart,
    thetaLength,
  );
  // Cylinder default axis is Y. Rotate so length runs along X, curvature in Y-Z plane
  geo.rotateZ(Math.PI / 2);
  // Apex at theta = 0 has z' = radius. Translate so apex sits at z = dims.canopyHeightM
  geo.translate(0, 0, dims.canopyHeightM - radius);
  return geo;
}

/** Create route-tinted trim/fascia running along both sides of the canopy roof. */
export function createTrimGeometry(
  dims: StationDimensions,
  structure: Structure = "elevated",
): THREE.BufferGeometry {
  const halfW = dims.widthM / 2 + dims.canopyOverhangM;
  let trimZ = dims.canopyHeightM - 0.3;
  if (structure !== "underground") {
    const canopyWidth = dims.widthM + dims.canopyOverhangM * 2;
    const radius = canopyWidth * 0.75;
    const thetaHalf = Math.asin(Math.min((canopyWidth / 2) / radius, 0.95));
    // Eaves sit at the arch edge height: apex - radius + radius * cos(thetaHalf)
    trimZ = dims.canopyHeightM - radius + radius * Math.cos(thetaHalf);
  }

  const railL = new THREE.BoxGeometry(dims.lengthM, 0.4, 0.6);
  railL.translate(0, -halfW, trimZ);

  const railR = new THREE.BoxGeometry(dims.lengthM, 0.4, 0.6);
  railR.translate(0, halfW, trimZ);

  const merged = mergeGeometries([railL, railR]);
  railL.dispose();
  railR.dispose();
  return merged ?? new THREE.BoxGeometry(dims.lengthM, 0.4, 0.6);
}

/** Create unit vertical column / access shaft geometry, oriented along Z. */
export function createColumnGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(1.2, 1.2, 1.0, 12);
  geo.rotateX(Math.PI / 2); // cylinder axis Y -> Z (our up)
  return geo;
}

export interface StationInstanceData {
  station: Station;
  localPos: [number, number, number];
  heading: number;
  structure: Structure;
}

interface StationMeshGroup {
  platforms: THREE.InstancedMesh;
  canopies: THREE.InstancedMesh;
  trims: THREE.InstancedMesh;
  pillars: THREE.InstancedMesh;
}

function buildStationInstancedGroup(
  items: StationInstanceData[],
  dims: StationDimensions,
  structure: Structure,
  lineColor: THREE.Color,
): StationMeshGroup {
  const count = items.length;

  const platformGeo = createPlatformGeometry(dims);
  const canopyGeo = createCanopyGeometry(dims, structure);
  const trimGeo = createTrimGeometry(dims, structure);
  const pillarGeo = createColumnGeometry();

  const platformMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
  const canopyMat = new THREE.MeshLambertMaterial({
    color: structure === "underground" ? 0x475569 : 0xe2e8f0,
    side: THREE.DoubleSide,
  });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  trimMat.userData.liveryHex = lineColor.getHex();
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x64748b });

  const platforms = new THREE.InstancedMesh(platformGeo, platformMat, count);
  platforms.name = "station-platforms";
  platforms.userData.items = items;
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
  canopies.name = "station-canopies";
  canopies.userData.isCanopy = true;
  canopies.userData.items = items;
  const trims = new THREE.InstancedMesh(trimGeo, trimMat, count);
  trims.name = "station-trims";
  trims.userData.isCanopy = true;
  trims.userData.isTrim = true;
  trims.userData.items = items;
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, count);
  pillars.name = "station-pillars";
  pillars.userData.isPillar = true;
  pillars.userData.items = items;

  const m = new THREE.Matrix4();
  const rotM = new THREE.Matrix4();
  const posM = new THREE.Matrix4();

  for (let i = 0; i < count; i++) {
    const { localPos, heading } = items[i];
    const [x, y, z] = localPos;
    const platformZ = z + STATION_MARKER_HEIGHT_M;

    // Platform, canopy, and trims share the same orientation & horizontal anchor
    rotM.makeRotationZ(heading);
    posM.makeTranslation(x, y, platformZ);
    m.multiplyMatrices(posM, rotM);

    platforms.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    trims.setMatrixAt(i, m);
    trims.setColorAt(i, lineColor);

    // Support pillars reach from ground (z = 0) to platform
    const { scaleZ, centerZ } = poleTransform(z);
    m.makeScale(1, 1, scaleZ).setPosition(x, y, centerZ);
    pillars.setMatrixAt(i, m);
  }

  platforms.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  trims.instanceMatrix.needsUpdate = true;
  if (trims.instanceColor) trims.instanceColor.needsUpdate = true;
  pillars.instanceMatrix.needsUpdate = true;

  platforms.castShadow = true;
  platforms.receiveShadow = true;
  canopies.castShadow = true;
  canopies.receiveShadow = true;
  trims.castShadow = true;
  trims.receiveShadow = true;
  pillars.castShadow = true;
  pillars.receiveShadow = true;

  return { platforms, canopies, trims, pillars };
}

/**
 * Suppresses procedural station instances (platforms, canopies, trims, pillars)
 * matching the given station IDs, stop codes, or hub IDs by setting their
 * instance transform matrix to zero scale.
 *
 * Returns the number of instanced meshes updated.
 */
export function suppressStationInMeshGroup(
  root: THREE.Object3D,
  targetIds: ReadonlySet<string | number>,
): number {
  let count = 0;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.InstancedMesh)) return;
    const items = obj.userData.items as StationInstanceData[] | undefined;
    if (!items) return;
    let updated = false;
    for (let i = 0; i < items.length; i++) {
      const s = items[i].station;
      const isTarget =
        targetIds.has(s.id) ||
        targetIds.has(String(s.id)) ||
        (Boolean(s.code) && targetIds.has(s.code)) ||
        (Boolean(s.hubId) && targetIds.has(s.hubId!)) ||
        (Boolean(s.name) && targetIds.has(s.name));
      if (isTarget) {
        obj.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        updated = true;
      }
    }
    if (updated) {
      obj.instanceMatrix.needsUpdate = true;
      count++;
    }
  });
  return count;
}

/**
 * Builds procedural 3D station models for a transit line, split by structure band
 * (surface vs. underground) to maintain compatibility with ThreeLayer's underground mode.
 *
 * @param line The line geometry containing stations and track polyline.
 * @param suppressedStopIds Optional set of station IDs or codes overridden by landmark .glb models.
 */
export function buildStationGeometry(
  line: LineGeometry,
  suppressedStopIds?: ReadonlySet<string | number>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `stations-${line.key}`;
  group.userData.lineKey = line.key;

  if (line.stations.length === 0) return group;

  const dims = STATION_DIMENSIONS[line.vehicleType] ?? STATION_DIMENSIONS.heavy;
  const lineColor = new THREE.Color(line.color);

  const surfaceItems: StationInstanceData[] = [];
  const undergroundItems: StationInstanceData[] = [];

  for (const station of line.stations) {
    if (
      suppressedStopIds?.has(station.id) ||
      suppressedStopIds?.has(String(station.id)) ||
      (station.code && suppressedStopIds?.has(station.code)) ||
      (station.hubId && suppressedStopIds?.has(station.hubId)) ||
      (station.name && suppressedStopIds?.has(station.name))
    ) {
      continue;
    }
    const snap = snapStationToTrack(station, line);

    const data: StationInstanceData = {
      station,
      localPos: snap.localPos,
      heading: snap.heading,
      structure: snap.structure,
    };

    if (snap.structure === "underground") {
      undergroundItems.push(data);
    } else {
      surfaceItems.push(data);
    }
  }

  if (surfaceItems.length > 0) {
    const surfaceGroup = buildStationInstancedGroup(surfaceItems, dims, "elevated", lineColor);
    group.add(
      surfaceGroup.platforms,
      surfaceGroup.canopies,
      surfaceGroup.trims,
      surfaceGroup.pillars,
    );
  }

  if (undergroundItems.length > 0) {
    const ugGroup = buildStationInstancedGroup(undergroundItems, dims, "underground", lineColor);
    ugGroup.platforms.userData.structure = "underground";
    ugGroup.canopies.userData.structure = "underground";
    ugGroup.trims.userData.structure = "underground";
    ugGroup.pillars.userData.structure = "underground";
    group.add(ugGroup.platforms, ugGroup.canopies, ugGroup.trims, ugGroup.pillars);
  }

  return group;
}

/**
 * Builds selection highlight beacon frames hovering above station canopies.
 * Produces track-oriented glowing yellow rectangular outlines hovering above the canopy roof.
 */
export function buildStationHighlightFrame(
  stops: { x: number; y: number; z: number; heading?: number; vehicleType?: VehicleType }[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = "station-selection-highlight";
  if (stops.length === 0) return group;

  const mat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  for (const stop of stops) {
    const dims = STATION_DIMENSIONS[stop.vehicleType ?? "heavy"] ?? STATION_DIMENSIONS.heavy;
    const length = dims.lengthM + 6;
    const width = dims.widthM + dims.canopyOverhangM * 2 + 4;
    const hoverZ = stop.z + dims.canopyHeightM + 2.5;

    // Create a hollow rectangular ring outline
    const frameGeo = new THREE.RingGeometry(width / 2, width / 2 + 2, 4);
    // Rotate ring into horizontal XY plane
    frameGeo.rotateZ(Math.PI / 4); // align diamond to square
    frameGeo.scale(length / width, 1, 1);

    const mesh = new THREE.Mesh(frameGeo, mat);
    mesh.position.set(stop.x, stop.y, hoverZ);
    if (stop.heading !== undefined) {
      mesh.rotation.z = stop.heading;
    }
    group.add(mesh);
  }

  return group;
}
