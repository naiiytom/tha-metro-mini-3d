import type { LiveryBand, RollingStock, VehicleType } from "../types";

/**
 * Per-line rolling stock: what a train IS, with no Three.js and no geometry.
 * `stockGeometry.ts` turns the `StockSpec` this file produces into a mesh.
 *
 * Kept pure on purpose. The WCAG night-contrast gate
 * (`rollingStockContrast.test.ts`) has to enumerate every colour a line's
 * train renders, and the shading model it checks against (`nightLift.ts`) is
 * itself pure — so the whole chain stays assertable inside `npm test`, which
 * is this project's only remaining automated surface.
 */

/** Sentinel `tint` meaning "this line's own registry colour". */
export const ROUTE_TINT = "route";

/** Glazing ribbon — one value network-wide (design doc, palette table). */
export const GLAZING_HEX = 0x2b3138;
/**
 * Underframe skirt. `#6E757C`, not a lighter grey: the obvious `#8E959C`
 * lands at 2.47:1 against the `#E8EBEE` shell, under the same MIN_CONTRAST
 * floor everything else here has to clear. This value clears it at 3.90:1.
 */
export const SKIRT_HEX = 0x6e757c;
/** Default light shell. */
export const SHELL_HEX = 0xe8ebee;
/** Silver shell — the MRT / ARL sets. */
export const SHELL_SILVER_HEX = 0xd7dbdf;
/**
 * BTS Gold's pale champagne shell. Deliberately NOT the saturated `#C9A227`
 * a photo suggests: that value drops the skirt to 2.65:1 and leaves the route
 * band with nothing to contrast against (gold on gold). Pale keeps the "gold
 * train" read while the line's own colour carries identity as the band.
 */
export const SHELL_GOLD_HEX = 0xd9c273;

/** A livery band with its tint already resolved to a concrete colour. */
export interface StockBand {
  zM: number;
  heightM: number;
  hex: number;
}

/** Runtime rolling stock: `RollingStock` with every colour resolved. */
export interface StockSpec {
  cars: number;
  carLengthM: number;
  gapM: number;
  widthM: number;
  heightM: number;
  rideHeightM: number;
  cabLengthM: number;
  nose: RollingStock["nose"];
  roof: RollingStock["roof"];
  shellHex: number;
  glazing: StockBand;
  /** bands[0] is the identity band — the nose takes its colour. */
  bands: StockBand[];
  glbUrl?: string;
}

/**
 * Fallback stock per vehicle type, for a line that declares none (the two
 * pre-revenue lines today, and any line appended later before someone writes
 * it a block). Dimensions are carried over unchanged from the pre-2026-08-22
 * `CONSISTS` table so nothing about an undeclared line's silhouette moves.
 */
export const DEFAULT_STOCK: Record<VehicleType, RollingStock> = {
  heavy: {
    cars: 4,
    carLengthM: 15.8,
    gapM: 0.6,
    widthM: 3.2,
    heightM: 3.8,
    rideHeightM: 0.4,
    cabLengthM: 3.2,
    nose: "raked",
    roof: "none",
    shell: "#E8EBEE",
    glazing: { zM: 2.45, heightM: 1.05, tint: "#2B3138" },
    bands: [
      { zM: 1.6, heightM: 0.5, tint: ROUTE_TINT },
      { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
    ],
  },
  monorail: {
    cars: 4,
    carLengthM: 11.8,
    gapM: 0.5,
    widthM: 3.0,
    heightM: 3.6,
    rideHeightM: 0.2,
    cabLengthM: 2.6,
    nose: "blunt",
    roof: "none",
    shell: "#E8EBEE",
    glazing: { zM: 2.35, heightM: 1.0, tint: "#2B3138" },
    // A wide wrap, not a pinstripe — the Alstom monorails wear far more
    // colour than the heavy sets do. No skirt: it straddles a beam.
    bands: [{ zM: 1.0, heightM: 1.6, tint: ROUTE_TINT }],
  },
  apm: {
    cars: 3,
    carLengthM: 12.6,
    gapM: 0.5,
    widthM: 2.8,
    heightM: 3.4,
    rideHeightM: 0.2,
    cabLengthM: 2.4,
    nose: "rounded",
    roof: "none",
    shell: "#E8EBEE",
    glazing: { zM: 2.2, heightM: 0.95, tint: "#2B3138" },
    bands: [{ zM: 1.35, heightM: 0.45, tint: ROUTE_TINT }],
  },
  commuter: {
    cars: 4,
    carLengthM: 20,
    gapM: 0.8,
    widthM: 3.1,
    heightM: 4.0,
    rideHeightM: 0.5,
    cabLengthM: 3.6,
    nose: "raked",
    roof: "pantograph",
    shell: "#E8EBEE",
    glazing: { zM: 2.6, heightM: 1.1, tint: "#2B3138" },
    bands: [
      { zM: 1.7, heightM: 0.5, tint: ROUTE_TINT },
      { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
    ],
  },
};

function hexOf(tint: string, routeColor: string): number {
  return parseInt((tint === ROUTE_TINT ? routeColor : tint).slice(1), 16);
}

function resolveBand(band: LiveryBand, routeColor: string): StockBand {
  return { zM: band.zM, heightM: band.heightM, hex: hexOf(band.tint, routeColor) };
}

/** The rendered length of a consist. Gaps sit BETWEEN cars, so there are n-1. */
export function stockLengthM(spec: { cars: number; carLengthM: number; gapM: number }): number {
  return spec.cars * spec.carLengthM + (spec.cars - 1) * spec.gapM;
}

export function resolveStock(line: {
  color: string;
  vehicleType: VehicleType;
  rollingStock?: RollingStock | null;
}): StockSpec {
  const wire = line.rollingStock ?? DEFAULT_STOCK[line.vehicleType];
  return {
    cars: wire.cars,
    carLengthM: wire.carLengthM,
    gapM: wire.gapM,
    widthM: wire.widthM,
    heightM: wire.heightM,
    rideHeightM: wire.rideHeightM,
    cabLengthM: wire.cabLengthM,
    nose: wire.nose,
    roof: wire.roof,
    shellHex: hexOf(wire.shell, line.color),
    glazing: resolveBand(wire.glazing, line.color),
    bands: wire.bands.map((b) => resolveBand(b, line.color)),
    ...(wire.glbUrl === undefined ? {} : { glbUrl: wire.glbUrl }),
  };
}

/**
 * LARGE-AREA colours — the shell and every identity band. These are what a
 * viewer sees of a train against the map, so these are the ones the WCAG gate
 * measures against `CONTRAST_REFERENCE` (design doc, decision 3, question 1).
 *
 * The skirt is excluded here despite living in `bands`: it is a narrow
 * underframe detail, measured against the shell instead. It is identified
 * positionally — `bands[0]` is the identity band by contract, everything
 * after it is detail — rather than by comparing against SKIRT_HEX, so a
 * future second detail band needs no change here.
 */
export function liveryColors(spec: StockSpec): number[] {
  return [spec.shellHex, ...spec.bands.slice(0, 1).map((b) => b.hex)];
}

/**
 * DETAIL colours — the glazing ribbon and any band after the identity band.
 * Measured against the SHELL, not the basemap: a dark ribbon exists to be
 * dark, and requiring it to clear the night basemap would demand it be light,
 * destroying the thing it is for (design doc, decision 3, question 2).
 */
export function detailColors(spec: StockSpec): number[] {
  return [spec.glazing.hex, ...spec.bands.slice(1).map((b) => b.hex)];
}
