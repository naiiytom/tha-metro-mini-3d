import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LineGeometry, Structure } from "../types";
import type { StationDimensions } from "./stationGeometry";

/**
 * Architectural station archetypes modeled after real Bangkok transit systems.
 *
 * Each archetype builds 4 merged, vertex-colored BufferGeometries matching the
 * 4 InstancedMesh slots in `stationGeometry.ts` (platform/concourse, canopy,
 * route-colored trim, and piers/access shafts), keeping draw calls O(lines)
 * while giving every operator's stations distinct, recognizable 3D form.
 */
export type StationArchetype =
  | "bts-skytrain"
  | "mrt-elevated"
  | "mrt-underground"
  | "monorail"
  | "arl-commuter"
  | "srt-elevated"
  | "srt-at-grade"
  | "apm-elevated"
  | "apm-underground";

export interface ArchetypeGeometrySet {
  platform: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  pillar: THREE.BufferGeometry;
}

interface ColoredPart {
  geo: THREE.BufferGeometry;
  color: number;
}

const PALETTE = {
  concreteDeck: 0xaab3bd,
  platformSlab: 0x94a3b8,
  darkTrackBed: 0x3b4454,
  yellowStrip: 0xf3c012,
  concourseWall: 0x85909d,
  undergroundWall: 0x5c6778,
  glass: 0x457390,
  steelRib: 0x334155,
  canopyBright: 0xe2e8f0,
  canopyMrt: 0xd4dde7,
  canopyCavern: 0x475569,
  skylight: 0x88b4cc,
  pierConcrete: 0x768190,
  lightStrip: 0xcbd5e1,
} as const;

/**
 * Resolves the real Bangkok architectural archetype for a line + structure band.
 */
export function resolveStationArchetype(
  line: Pick<LineGeometry, "key" | "vehicleType">,
  structure: Structure,
): StationArchetype {
  if (structure === "underground") {
    return line.vehicleType === "apm" || line.key === "apm"
      ? "apm-underground"
      : "mrt-underground";
  }

  switch (line.key) {
    case "sukhumvit":
    case "silom":
      return "bts-skytrain";
    case "blue":
    case "purple":
    case "purple-ext":
    case "orange":
      return "mrt-elevated";
    case "pink":
    case "pink-spur":
    case "yellow":
      return "monorail";
    case "arl":
      return "arl-commuter";
    case "red-dark":
    case "red-light":
      return structure === "atGrade" ? "srt-at-grade" : "srt-elevated";
    case "gold":
    case "apm":
      return "apm-elevated";
    default:
      if (line.vehicleType === "monorail") return "monorail";
      if (line.vehicleType === "apm") return "apm-elevated";
      if (line.vehicleType === "commuter") {
        return structure === "atGrade" ? "srt-at-grade" : "srt-elevated";
      }
      return "bts-skytrain";
  }
}

function boxPart(
  lx: number,
  wy: number,
  hz: number,
  cx: number,
  cy: number,
  cz: number,
  color: number,
): ColoredPart {
  const geo = new THREE.BoxGeometry(lx, wy, hz);
  geo.translate(cx, cy, cz);
  return { geo, color };
}

function cylPart(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  cx: number,
  cy: number,
  cz: number,
  color: number,
  radialSegments = 10,
): ColoredPart {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  geo.rotateX(Math.PI / 2);
  geo.translate(cx, cy, cz);
  return { geo, color };
}

/**
 * Extrudes a 2D cross-section defined in `(y, z)` along the station X axis
 * centered at `x = 0` over `[-length/2, +length/2]`.
 */
function extrudeProfileAlongX(
  profilePoints: readonly [number, number][],
  length: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  profilePoints.forEach(([y, z], idx) => {
    if (idx === 0) shape.moveTo(y, z);
    else shape.lineTo(y, z);
  });
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
  });

  // ExtrudeGeometry builds shape in XY and extrudes along +Z.
  // Remap (shapeX=y, shapeY=z, extrudeZ) -> (extrudeZ - length/2, y, z).
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getX(i);
    const pz = pos.getY(i);
    const px = pos.getZ(i);
    pos.setXYZ(i, px - length / 2, py, pz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Stamps uniform RGB vertex colors onto each part, normalizes attributes
 * (stripping UVs so mixed Box/Cylinder/Extrude geometries always merge), and
 * disposes every intermediate BufferGeometry.
 */
function mergeColoredParts(parts: ColoredPart[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];
  const tmpColor = new THREE.Color();

  for (const { geo, color } of parts) {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    if (nonIndexed !== geo) geo.dispose();

    if (nonIndexed.attributes.uv) {
      nonIndexed.deleteAttribute("uv");
    }
    if (!nonIndexed.attributes.normal) {
      nonIndexed.computeVertexNormals();
    }

    const count = nonIndexed.attributes.position.count;
    const colors = new Float32Array(count * 3);
    tmpColor.setHex(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    nonIndexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    prepared.push(nonIndexed);
  }

  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

function buildArchedCanopyShell(
  length: number,
  width: number,
  peakZ: number,
  eavesZ: number,
  thickness: number,
  segments = 16,
): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const halfW = width / 2;
  const rise = peakZ - eavesZ;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = -halfW + t * width;
    const norm = y / halfW;
    const z = eavesZ + rise * (1 - norm * norm);
    pts.push([y, z]);
  }
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const y = -halfW + t * width;
    const norm = y / halfW;
    const z = eavesZ + rise * (1 - norm * norm) - thickness;
    pts.push([y, z]);
  }
  return extrudeProfileAlongX(pts, length);
}

function buildGullWingCanopyShell(
  length: number,
  width: number,
  wingZ: number,
  valleyZ: number,
  thickness: number,
): THREE.BufferGeometry {
  const halfW = width / 2;
  const pts: [number, number][] = [
    [-halfW, wingZ],
    [-halfW * 0.45, valleyZ + (wingZ - valleyZ) * 0.35],
    [0, valleyZ],
    [halfW * 0.45, valleyZ + (wingZ - valleyZ) * 0.35],
    [halfW, wingZ],
    [halfW, wingZ - thickness],
    [halfW * 0.45, valleyZ + (wingZ - valleyZ) * 0.35 - thickness],
    [0, valleyZ - thickness],
    [-halfW * 0.45, valleyZ + (wingZ - valleyZ) * 0.35 - thickness],
    [-halfW, wingZ - thickness],
  ];
  return extrudeProfileAlongX(pts, length);
}

function buildPitchedCanopyShell(
  length: number,
  width: number,
  peakZ: number,
  eavesZ: number,
  thickness: number,
): THREE.BufferGeometry {
  const halfW = width / 2;
  const pts: [number, number][] = [
    [-halfW, eavesZ],
    [-halfW * 0.25, peakZ - 0.15],
    [0, peakZ],
    [halfW * 0.25, peakZ - 0.15],
    [halfW, eavesZ],
    [halfW, eavesZ - thickness],
    [halfW * 0.25, peakZ - 0.15 - thickness],
    [0, peakZ - thickness],
    [-halfW * 0.25, peakZ - 0.15 - thickness],
    [-halfW, eavesZ - thickness],
  ];
  return extrudeProfileAlongX(pts, length);
}

function addPlatformSafetyStrips(
  parts: ColoredPart[],
  length: number,
  width: number,
  edgeOffset = 0.55,
): void {
  const stripLen = length - 2;
  const yPos = width / 2 - edgeOffset;
  parts.push(boxPart(stripLen, 0.42, 0.08, 0, -yPos, 0.04, PALETTE.yellowStrip));
  parts.push(boxPart(stripLen, 0.42, 0.08, 0, yPos, 0.04, PALETTE.yellowStrip));
}

function addRoofRibs(
  parts: ColoredPart[],
  length: number,
  width: number,
  ribZ: number,
  ribHeight: number,
  count: number,
): void {
  const span = length * 0.88;
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : -span / 2 + (i / (count - 1)) * span;
    parts.push(boxPart(0.9, width + 0.4, ribHeight, x, 0, ribZ, PALETTE.steelRib));
  }
}

function addPortalPiers(
  parts: ColoredPart[],
  xOffsets: readonly number[],
  yOffset: number,
  colW: number,
  colD: number,
  circular = false,
): void {
  for (const x of xOffsets) {
    if (circular) {
      parts.push(cylPart(colW * 0.55, colW * 0.65, 1.0, x, -yOffset, 0, PALETTE.pierConcrete));
      parts.push(cylPart(colW * 0.55, colW * 0.65, 1.0, x, yOffset, 0, PALETTE.pierConcrete));
    } else {
      parts.push(boxPart(colW, colD, 1.0, x, -yOffset, 0, PALETTE.pierConcrete));
      parts.push(boxPart(colW, colD, 1.0, x, yOffset, 0, PALETTE.pierConcrete));
    }
    // Cross-head beam near the top (z = 0.45 in normalized [-0.5, 0.5] frame)
    parts.push(boxPart(colW * 1.15, yOffset * 2 + colD, 0.1, x, 0, 0.45, PALETTE.concreteDeck));
  }
}

function addTwinTrimRails(
  parts: ColoredPart[],
  length: number,
  halfW: number,
  trimZ: number,
  height = 0.6,
): void {
  parts.push(boxPart(length, 0.45, height, 0, -halfW, trimZ, 0xffffff));
  parts.push(boxPart(length, 0.45, height, 0, halfW, trimZ, 0xffffff));
}

function buildBtsSkytrain(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM;
  const W = dims.widthM;
  const canopyW = W + dims.canopyOverhangM * 2;
  const eavesZ = dims.canopyHeightM - 1.5;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.concreteDeck),
    boxPart(L - 4, 1.8, 0.25, 0, 0, 0.125, PALETTE.darkTrackBed),
    // Elevated concourse hall suspended underneath platform
    boxPart(L * 0.68, W * 0.86, 2.7, 0, 0, -2.85, PALETTE.concourseWall),
    boxPart(L * 0.62, W * 0.89, 1.25, 0, 0, -2.75, PALETTE.glass),
    // Side ticket/stair vestibules
    boxPart(10, W + 2.4, 2.2, -L * 0.24, 0, -2.6, PALETTE.concourseWall),
    boxPart(10, W + 2.4, 2.2, L * 0.24, 0, -2.6, PALETTE.concourseWall),
  ];
  addPlatformSafetyStrips(platformParts, L, W);

  const canopyParts: ColoredPart[] = [
    { geo: buildArchedCanopyShell(L, canopyW, dims.canopyHeightM, eavesZ, 0.42), color: PALETTE.canopyBright },
    // Translucent central skylight spine
    boxPart(L * 0.9, 2.8, 0.45, 0, 0, dims.canopyHeightM + 0.18, PALETTE.skylight),
  ];
  addRoofRibs(canopyParts, L, canopyW - 0.6, eavesZ + 0.55, 0.5, 7);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, eavesZ, 0.65);

  const pillarParts: ColoredPart[] = [];
  addPortalPiers(pillarParts, [-L * 0.34, -L * 0.11, L * 0.11, L * 0.34], W * 0.38, 1.9, 1.9, true);
  // Street-side stair/escalator cores reaching ground
  pillarParts.push(boxPart(7.5, 2.8, 1.0, -L * 0.24, -W * 0.56, 0, PALETTE.concourseWall));
  pillarParts.push(boxPart(7.5, 2.8, 1.0, L * 0.24, W * 0.56, 0, PALETTE.concourseWall));

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildMrtElevated(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM;
  const W = dims.widthM + 0.8;
  const canopyW = W + dims.canopyOverhangM * 2 + 0.6;
  const peakZ = dims.canopyHeightM + 0.2;
  const eavesZ = dims.canopyHeightM - 1.3;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.platformSlab),
    boxPart(L - 4, 2.0, 0.25, 0, 0, 0.125, PALETTE.darkTrackBed),
    // Enclosed MRT viaduct concourse belly
    boxPart(L * 0.8, W * 0.92, 3.1, 0, 0, -3.05, PALETTE.concourseWall),
    boxPart(L * 0.74, W * 0.95, 1.15, 0, 0, -2.85, PALETTE.glass),
    boxPart(L * 0.82, W * 0.94, 0.45, 0, 0, -4.4, PALETTE.concreteDeck),
  ];
  addPlatformSafetyStrips(platformParts, L, W);

  const canopyParts: ColoredPart[] = [
    { geo: buildPitchedCanopyShell(L, canopyW, peakZ, eavesZ, 0.45), color: PALETTE.canopyMrt },
    // Raised central ventilation ridge
    boxPart(L * 0.84, 3.2, 0.65, 0, 0, peakZ + 0.15, PALETTE.steelRib),
  ];
  addRoofRibs(canopyParts, L, canopyW - 0.5, eavesZ + 0.45, 0.45, 7);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, eavesZ - 0.05, 0.75);

  const pillarParts: ColoredPart[] = [];
  addPortalPiers(pillarParts, [-L * 0.35, -L * 0.12, L * 0.12, L * 0.35], W * 0.38, 2.4, 2.0, false);
  // Twin lift & escalator street access towers
  pillarParts.push(boxPart(6.5, 3.0, 1.0, -L * 0.28, -W * 0.58, 0, PALETTE.concourseWall));
  pillarParts.push(boxPart(6.5, 3.0, 1.0, L * 0.28, W * 0.58, 0, PALETTE.concourseWall));

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildMrtUnderground(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM;
  const W = dims.widthM;
  const canopyW = W + dims.canopyOverhangM * 2;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.undergroundWall),
    // Raised central island platform + recessed track troughs
    boxPart(L - 4, W * 0.52, 0.35, 0, 0, 0.175, PALETTE.platformSlab),
    boxPart(L - 4, 2.2, 0.15, 0, -(W * 0.36), 0.075, PALETTE.darkTrackBed),
    boxPart(L - 4, 2.2, 0.15, 0, W * 0.36, 0.075, PALETTE.darkTrackBed),
  ];
  addPlatformSafetyStrips(platformParts, L, W * 0.54, 0.35);

  const canopyParts: ColoredPart[] = [
    boxPart(L, canopyW, 0.8, 0, 0, dims.canopyHeightM, PALETTE.canopyCavern),
    // Central recessed ceiling light soffit
    boxPart(L * 0.9, 3.2, 0.25, 0, 0, dims.canopyHeightM - 0.38, PALETTE.lightStrip),
  ];
  addRoofRibs(canopyParts, L, canopyW, dims.canopyHeightM - 0.35, 0.5, 6);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, dims.canopyHeightM - 0.3, 0.6);

  // Underground shafts stay strictly within z in [-0.5, 0.5] so poleTransform(z)
  // maps the lower face cleanly to the platform and the top flush with street z = 0.
  const shaftOffsetX = L * 0.3;
  const shaftOffsetY = W / 2 + 1.8;
  const pillarParts: ColoredPart[] = [
    // Wide intermediate ticket mezzanine slab
    boxPart(L * 0.54, W * 0.92, 0.16, 0, 0, 0.04, PALETTE.undergroundWall),
    // Escalator shafts rising to street level
    boxPart(5.5, 3.4, 1.0, -shaftOffsetX, -shaftOffsetY, 0, PALETTE.steelRib),
    boxPart(5.5, 3.4, 1.0, shaftOffsetX, shaftOffsetY, 0, PALETTE.steelRib),
    // Street-level MRT glass entrance hoods flush at top z = 0.5
    boxPart(8.0, 4.4, 0.08, -shaftOffsetX, -shaftOffsetY, 0.46, PALETTE.glass),
    boxPart(8.0, 4.4, 0.08, shaftOffsetX, shaftOffsetY, 0.46, PALETTE.glass),
    boxPart(8.4, 4.8, 0.03, -shaftOffsetX, -shaftOffsetY, 0.485, PALETTE.canopyBright),
    boxPart(8.4, 4.8, 0.03, shaftOffsetX, shaftOffsetY, 0.485, PALETTE.canopyBright),
  ];

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildMonorail(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM + 4;
  const W = dims.widthM + 1.0;
  const canopyW = W + dims.canopyOverhangM * 2 + 0.8;
  const wingZ = dims.canopyHeightM + 0.25;
  const valleyZ = dims.canopyHeightM - 0.85;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.concreteDeck),
    boxPart(L - 2, 1.4, 0.2, 0, 0, 0.1, PALETTE.darkTrackBed),
    // Compact suspended monorail concourse pod
    boxPart(L * 0.72, W * 0.88, 2.3, 0, 0, -2.35, PALETTE.concourseWall),
    boxPart(L * 0.66, W * 0.92, 1.05, 0, 0, -2.25, PALETTE.glass),
  ];
  addPlatformSafetyStrips(platformParts, L, W, 0.4);

  const canopyParts: ColoredPart[] = [
    { geo: buildGullWingCanopyShell(L, canopyW, wingZ, valleyZ, 0.32), color: PALETTE.canopyBright },
  ];
  addRoofRibs(canopyParts, L, canopyW - 0.4, (wingZ + valleyZ) / 2, 0.35, 5);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, wingZ - 0.15, 0.5);

  // Authentic single-median T-hammerhead piers along the street center
  const pillarParts: ColoredPart[] = [];
  for (const x of [-L * 0.32, 0, L * 0.32]) {
    pillarParts.push(boxPart(2.2, 2.2, 1.0, x, 0, 0, PALETTE.pierConcrete));
    pillarParts.push(boxPart(2.4, W * 0.72, 0.11, x, 0, 0.445, PALETTE.concreteDeck));
  }

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildArlCommuter(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM + 4;
  const W = dims.widthM + 0.8;
  const canopyW = W + dims.canopyOverhangM * 2 + 0.6;
  const peakZ = dims.canopyHeightM + 0.45;
  const eavesZ = dims.canopyHeightM - 1.6;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.concreteDeck),
    boxPart(L - 4, 2.2, 0.25, 0, 0, 0.125, PALETTE.darkTrackBed),
    // Aerodynamic glazed ARL concourse box
    boxPart(L * 0.72, W * 0.88, 2.8, 0, 0, -2.9, PALETTE.concourseWall),
    boxPart(L * 0.68, W * 0.92, 1.4, 0, 0, -2.8, PALETTE.glass),
  ];
  addPlatformSafetyStrips(platformParts, L, W);

  const canopyParts: ColoredPart[] = [
    { geo: buildArchedCanopyShell(L, canopyW, peakZ, eavesZ, 0.4, 20), color: PALETTE.canopyBright },
    boxPart(L * 0.85, 2.4, 0.4, 0, 0, peakZ + 0.1, PALETTE.skylight),
  ];
  // Prominent external elliptical truss ribs
  addRoofRibs(canopyParts, L, canopyW + 0.3, eavesZ + 0.9, 0.65, 8);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, eavesZ, 0.65);

  const pillarParts: ColoredPart[] = [];
  addPortalPiers(pillarParts, [-L * 0.35, -L * 0.12, L * 0.12, L * 0.35], W * 0.39, 2.0, 2.0, true);
  pillarParts.push(boxPart(7.0, 2.8, 1.0, -L * 0.25, -W * 0.56, 0, PALETTE.concourseWall));
  pillarParts.push(boxPart(7.0, 2.8, 1.0, L * 0.25, W * 0.56, 0, PALETTE.concourseWall));

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildSrtCommuter(dims: StationDimensions, atGrade: boolean): ArchetypeGeometrySet {
  const L = dims.lengthM + 12;
  const W = dims.widthM + 2.0;
  const canopyW = W + dims.canopyOverhangM * 2 + 0.8;
  const wingZ = dims.canopyHeightM + 0.2;
  const valleyZ = dims.canopyHeightM - 0.9;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.platformSlab),
    boxPart(L - 4, 2.8, 0.25, 0, 0, 0.125, PALETTE.darkTrackBed),
  ];
  if (atGrade) {
    // At-grade stations keep concourse above ground as a station overbridge/headhouse
    platformParts.push(boxPart(22, W + 3.2, 3.0, 0, 0, dims.canopyHeightM - 1.2, PALETTE.concourseWall));
    platformParts.push(boxPart(20, W + 3.5, 1.4, 0, 0, dims.canopyHeightM - 1.1, PALETTE.glass));
    platformParts.push(boxPart(6.0, 3.2, 5.2, 0, -(W / 2 + 1.4), 2.6, PALETTE.concourseWall));
    platformParts.push(boxPart(6.0, 3.2, 5.2, 0, W / 2 + 1.4, 2.6, PALETTE.concourseWall));
  } else {
    platformParts.push(boxPart(L * 0.78, W * 0.9, 3.2, 0, 0, -3.1, PALETTE.concourseWall));
    platformParts.push(boxPart(L * 0.72, W * 0.93, 1.4, 0, 0, -2.95, PALETTE.glass));
  }
  addPlatformSafetyStrips(platformParts, L, W);

  const canopyParts: ColoredPart[] = [
    { geo: buildGullWingCanopyShell(L, canopyW, wingZ, valleyZ, 0.42), color: PALETTE.canopyMrt },
    // Tall central clerestory skylight monitor
    boxPart(L * 0.92, 3.6, 0.9, 0, 0, valleyZ + 0.65, PALETTE.skylight),
  ];
  addRoofRibs(canopyParts, L, canopyW, valleyZ + 0.4, 0.55, 8);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, wingZ - 0.15, 0.7);

  const pillarParts: ColoredPart[] = [];
  if (atGrade) {
    // Low ballast plinth under the slab so poleTransform(0.5) stays flush at ground
    pillarParts.push(boxPart(L * 0.96, W * 0.9, 1.0, 0, 0, 0, PALETTE.pierConcrete));
  } else {
    addPortalPiers(pillarParts, [-L * 0.36, -L * 0.18, 0, L * 0.18, L * 0.36], W * 0.4, 2.2, 2.2, false);
  }

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildApmElevated(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM;
  const W = dims.widthM;
  const canopyW = W + dims.canopyOverhangM * 2 + 0.6;
  const wingZ = dims.canopyHeightM + 0.2;
  const valleyZ = dims.canopyHeightM - 0.65;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.concreteDeck),
    boxPart(L - 2, 1.2, 0.2, 0, 0, 0.1, PALETTE.darkTrackBed),
    boxPart(L * 0.68, W * 0.88, 2.2, 0, 0, -2.3, PALETTE.concourseWall),
    boxPart(L * 0.62, W * 0.92, 1.0, 0, 0, -2.2, PALETTE.glass),
  ];
  addPlatformSafetyStrips(platformParts, L, W, 0.4);

  const canopyParts: ColoredPart[] = [
    { geo: buildGullWingCanopyShell(L, canopyW, wingZ, valleyZ, 0.3), color: PALETTE.canopyBright },
  ];
  addRoofRibs(canopyParts, L, canopyW - 0.3, (wingZ + valleyZ) / 2, 0.35, 5);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, wingZ - 0.12, 0.5);

  const pillarParts: ColoredPart[] = [];
  addPortalPiers(pillarParts, [-L * 0.3, 0, L * 0.3], W * 0.34, 1.6, 1.6, true);

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

function buildApmUnderground(dims: StationDimensions): ArchetypeGeometrySet {
  const L = dims.lengthM;
  const W = dims.widthM;
  const canopyW = W + dims.canopyOverhangM * 2;

  const platformParts: ColoredPart[] = [
    boxPart(L, W, dims.platformThicknessM, 0, 0, -dims.platformThicknessM / 2, PALETTE.undergroundWall),
    boxPart(L - 2, W * 0.52, 0.3, 0, 0, 0.15, PALETTE.platformSlab),
  ];
  addPlatformSafetyStrips(platformParts, L, W * 0.56, 0.3);

  const canopyParts: ColoredPart[] = [
    boxPart(L, canopyW, 0.7, 0, 0, dims.canopyHeightM, PALETTE.canopyCavern),
    boxPart(L * 0.85, 2.0, 0.2, 0, 0, dims.canopyHeightM - 0.32, PALETTE.lightStrip),
  ];
  addRoofRibs(canopyParts, L, canopyW, dims.canopyHeightM - 0.3, 0.4, 4);

  const trimParts: ColoredPart[] = [];
  addTwinTrimRails(trimParts, L, canopyW / 2, dims.canopyHeightM - 0.25, 0.5);

  const shaftOffsetX = L * 0.28;
  const shaftOffsetY = W / 2 + 1.4;
  const pillarParts: ColoredPart[] = [
    boxPart(L * 0.48, W * 0.85, 0.16, 0, 0, 0.04, PALETTE.undergroundWall),
    boxPart(4.2, 2.8, 1.0, -shaftOffsetX, -shaftOffsetY, 0, PALETTE.steelRib),
    boxPart(4.2, 2.8, 1.0, shaftOffsetX, shaftOffsetY, 0, PALETTE.steelRib),
  ];

  return {
    platform: mergeColoredParts(platformParts),
    canopy: mergeColoredParts(canopyParts),
    trim: mergeColoredParts(trimParts),
    pillar: mergeColoredParts(pillarParts),
  };
}

/**
 * Builds the 4 merged, vertex-colored geometries for a given Bangkok station archetype.
 */
export function buildArchetypeGeometries(
  archetype: StationArchetype,
  dims: StationDimensions,
): ArchetypeGeometrySet {
  switch (archetype) {
    case "bts-skytrain":
      return buildBtsSkytrain(dims);
    case "mrt-elevated":
      return buildMrtElevated(dims);
    case "mrt-underground":
      return buildMrtUnderground(dims);
    case "monorail":
      return buildMonorail(dims);
    case "arl-commuter":
      return buildArlCommuter(dims);
    case "srt-elevated":
      return buildSrtCommuter(dims, false);
    case "srt-at-grade":
      return buildSrtCommuter(dims, true);
    case "apm-elevated":
      return buildApmElevated(dims);
    case "apm-underground":
      return buildApmUnderground(dims);
  }
}
