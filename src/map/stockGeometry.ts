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

/**
 * How far a band stands proud of the shell on each SIDE — and, negated, how
 * far short of the shell it stops at each END. See `bandPart` for why the end
 * inset is not optional.
 */
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
  // The vertical taper is anchored at the FLOOR, not at the box's centre.
  // Scaling z about the centre shrinks the underside too, lifting it by
  // heightM/2 * (1 - tipHeight) — 0.42 m on raked heavy stock (h=3.8,
  // tipHeight=0.78) — which wedges the leading car's floor visibly upward
  // toward the nose and contradicts the comment below. Found in code review
  // 2026-08-23. The tip's overall cross-section height is identical either
  // way (heightM * tipHeight, less roofDropM); only which face stays put
  // changes, and on a train it is the floor that must.
  geometry.computeBoundingBox();
  const floorZ = geometry.boundingBox!.min.z;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getX(i) + lengthM / 2) / lengthM));
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) * (1 + (p.tipWidth - 1) * t));
    // The drop applies to the roofline only — the floor stays flat on the bogies.
    pos.setZ(
      i,
      floorZ + (z - floorZ) * (1 + (p.tipHeight - 1) * t) - (z > floorZ ? p.roofDropM * t : 0),
    );
  }
  pos.needsUpdate = true;
  // The cached box above described the UNTAPERED geometry; drop it so any
  // later computeBoundingBox() reader cannot pick up the stale extent.
  geometry.boundingBox = null;
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

/**
 * One band wrapping a car body: PROUD_M proud of the shell on each SIDE, and
 * PROUD_M short of it at each END.
 *
 * The end inset is load-bearing, not tidiness. A band built to the shell's own
 * `lengthM` and sharing its `xCenter` puts its ±X caps EXACTLY coplanar and
 * co-wound with the shell's — the sides were always separated by PROUD_M, the
 * ends never were — which z-fights on every car end face, visible through the
 * 0.5-0.8 m inter-car gaps and on the rear face of the trailing car. Found in
 * code review 2026-08-23.
 */
function bandPart(
  band: StockBand,
  lengthM: number,
  widthM: number,
  xCenter: number,
  rideHeightM: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(lengthM - PROUD_M * 2, widthM + PROUD_M * 2, band.heightM);
  g.translate(xCenter, 0, rideHeightM + band.zM);
  return paint(g, band.hex);
}

/**
 * A small additional nudge OUTSIDE the glazing band's own `PROUD_M` offset
 * from the shell, so the separate night-glow overlay (`buildWindowGlowGeometry`
 * below) never z-fights the glazing surface `buildStockGeometry` already
 * bakes into the main body — they would otherwise be two exactly-coincident
 * box faces, an unstable render order at best.
 */
const GLOW_PROUD_M = PROUD_M + 0.01;

/**
 * One thin box per car, positioned and sized identically to that car's
 * glazing band (see `buildStockGeometry`'s own `bandPart(spec.glazing, ...)`
 * call) but nudged `GLOW_PROUD_M` proud of it and carrying NO vertex colour
 * — this is meant for a separate, uncoloured `MeshBasicMaterial` overlay
 * whose OWN opacity (`windowGlow.ts`) drives whether it reads as lit windows,
 * not for anything nightLift.ts touches. See `windowGlow.ts`'s doc comment
 * for why this exists as its own mesh rather than a tweak to the glazing
 * band already in the main geometry.
 *
 * Deliberately excludes the nose — a raked/blunt/rounded cab tip has no flat
 * window band to speak of, and forcing one into that geometry would just
 * clip through the taper.
 */
export function buildWindowGlowGeometry(spec: StockSpec): THREE.BufferGeometry {
  const total = stockLengthM(spec);
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < spec.cars; i++) {
    const carCenter = -total / 2 + spec.carLengthM / 2 + i * (spec.carLengthM + spec.gapM);
    const isLead = i === spec.cars - 1;
    const bodyLength = isLead ? spec.carLengthM - spec.cabLengthM : spec.carLengthM;
    const bodyCenter = isLead ? carCenter - spec.cabLengthM / 2 : carCenter;

    const g = new THREE.BoxGeometry(
      bodyLength - PROUD_M * 2,
      spec.widthM + GLOW_PROUD_M * 2,
      spec.glazing.heightM,
    );
    g.translate(bodyCenter, 0, spec.rideHeightM + spec.glazing.zM);
    parts.push(g);
  }

  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!merged) {
    // Unreachable today (every part here is a plain BoxGeometry with no
    // colour attribute, so every part's attribute set is identical) — see
    // buildStockGeometry's own comment on this same guard for the failure
    // mode it exists to name if that ever stops being true.
    throw new Error(
      "window-glow overlay parts could not be merged into one geometry — every " +
        "part must carry the identical attribute set (position, normal)",
    );
  }
  return merged;
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
  if (!merged) {
    // mergeGeometries returns null (console.error only, no throw) when its
    // inputs' attribute sets differ, and @types/three declares the return
    // non-null so TS cannot catch it. Unreachable while every part is a
    // BoxGeometry plus `color`; it stops being unreachable the moment one
    // part carries `uv` or comes from a different primitive. Without this
    // guard that surfaces as `Cannot read properties of null` inside
    // VehicleManager's constructor at style.load — a dead map with no clue
    // what caused it. Same guard glbStock.ts already applies to its own call.
    throw new Error(
      "rolling stock parts could not be merged into one geometry — every part " +
        "must carry the identical attribute set (position, normal, color)",
    );
  }
  return merged;
}
