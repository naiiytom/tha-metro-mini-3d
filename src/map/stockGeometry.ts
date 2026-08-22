import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { NoseProfile } from "../types";
import { SKIRT_HEX, stockLengthM, type StockBand, type StockSpec } from "./rollingStock";

/**
 * Procedural rolling stock. One merged, vertex-coloured geometry per line —
 * `VehicleManager` renders it as a single InstancedMesh per route, so this is
 * built ONCE per route at construction and never touched on the frame path.
 *
 * Local frame matches the sim's vehicle records: the consist's long axis is
 * +x, the leading (nose) end is +x, +z is up, and the origin sits on the deck
 * so `rideHeightM` lifts the shell clear of it.
 */

/** How far a band stands proud of the shell, per side, so it never z-fights. */
const PROUD_M = 0.03;

/**
 * Nose shaping, as fractions of the shell's cross-section at the tip plus an
 * absolute roofline drop. `raked` is the EMU windscreen rake (BTS, MRT, ARL,
 * SRT Red); `blunt` is the flat-fronted Alstom monorail; `rounded` is the
 * short, softened people-mover cab.
 */
export const NOSE_SHAPES: Record<
  NoseProfile,
  { tipWidth: number; tipHeight: number; roofDropM: number }
> = {
  raked: { tipWidth: 0.92, tipHeight: 0.78, roofDropM: 0.25 },
  blunt: { tipWidth: 0.98, tipHeight: 0.96, roofDropM: 0.05 },
  rounded: { tipWidth: 0.85, tipHeight: 0.85, roofDropM: 0.1 },
};

/**
 * Taper a nose box in place, keyed on each vertex's OWN x.
 *
 * Keying on x rather than picking faces is what makes this work on a plain
 * BoxGeometry: Three duplicates a box's corner vertices once per face, and
 * every duplicate at a given x gets the identical treatment here, so the
 * seams stay closed with no face-index bookkeeping.
 *
 * The geometry must be centred on the origin (as BoxGeometry is) and its
 * length must run -lengthM/2 (rear, butting onto the leading car) to
 * +lengthM/2 (tip).
 */
export function taperNose(
  geometry: THREE.BufferGeometry,
  lengthM: number,
  profile: NoseProfile,
): void {
  const p = NOSE_SHAPES[profile];
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getX(i) + lengthM / 2) / lengthM));
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) * (1 + (p.tipWidth - 1) * t));
    // The drop applies to the roofline only — the floor stays flat on the bogies.
    pos.setZ(i, z * (1 + (p.tipHeight - 1) * t) - (z > 0 ? p.roofDropM * t : 0));
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Paint every vertex of a geometry one colour. */
function paint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One band wrapping a car body, standing PROUD_M proud on each side. */
function bandPart(
  band: StockBand,
  lengthM: number,
  widthM: number,
  xCenter: number,
  rideHeightM: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(lengthM, widthM + PROUD_M * 2, band.heightM);
  g.translate(xCenter, 0, rideHeightM + band.zM);
  return paint(g, band.hex);
}

export function buildStockGeometry(spec: StockSpec): THREE.BufferGeometry {
  const total = stockLengthM(spec);
  const zCenter = spec.rideHeightM + spec.heightM / 2;
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < spec.cars; i++) {
    const carCenter = -total / 2 + spec.carLengthM / 2 + i * (spec.carLengthM + spec.gapM);
    const isLead = i === spec.cars - 1;
    // The nose is the FRONT OF the leading car, not an extra piece bolted on
    // — so the lead car's shell is shortened by exactly cabLengthM and the
    // consist's rendered extent stays equal to stockLengthM(spec).
    const bodyLength = isLead ? spec.carLengthM - spec.cabLengthM : spec.carLengthM;
    const bodyCenter = isLead ? carCenter - spec.cabLengthM / 2 : carCenter;

    const shell = new THREE.BoxGeometry(bodyLength, spec.widthM, spec.heightM);
    shell.translate(bodyCenter, 0, zCenter);
    parts.push(paint(shell, spec.shellHex));

    parts.push(bandPart(spec.glazing, bodyLength, spec.widthM, bodyCenter, spec.rideHeightM));
    for (const band of spec.bands) {
      parts.push(bandPart(band, bodyLength, spec.widthM, bodyCenter, spec.rideHeightM));
    }

    // Pantograph on the trailing cars only — the lead car carries the cab.
    if (spec.roof === "pantograph" && !isLead) {
      const arm = new THREE.BoxGeometry(spec.carLengthM * 0.3, 0.12, 0.5);
      arm.translate(bodyCenter, 0, spec.rideHeightM + spec.heightM + 0.25);
      parts.push(paint(arm, SKIRT_HEX));
      const bar = new THREE.BoxGeometry(0.15, spec.widthM * 0.7, 0.12);
      bar.translate(bodyCenter, 0, spec.rideHeightM + spec.heightM + 0.5);
      parts.push(paint(bar, SKIRT_HEX));
    }
  }

  // Tapered nose at the +x end, in the leading car's own colour band. This is
  // the route-coloured cab cap MVP 3 introduced so direction of travel and
  // route stay readable at a glance — bands[0] is the identity band.
  const nose = new THREE.BoxGeometry(spec.cabLengthM, spec.widthM, spec.heightM);
  taperNose(nose, spec.cabLengthM, spec.nose);
  nose.translate(total / 2 - spec.cabLengthM / 2, 0, zCenter);
  parts.push(paint(nose, spec.bands[0]?.hex ?? spec.shellHex));

  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}
