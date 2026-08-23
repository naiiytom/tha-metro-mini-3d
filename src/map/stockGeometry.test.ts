import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOCK,
  GLAZING_HEX,
  resolveStock,
  stockLengthM,
  type StockSpec,
} from "./rollingStock";
import { NOSE_SHAPES, buildStockGeometry, taperNose } from "./stockGeometry";

const specFor = (vehicleType: Parameters<typeof resolveStock>[0]["vehicleType"]): StockSpec =>
  resolveStock({ color: "#7CB342", vehicleType, rollingStock: null });

describe("taperNose", () => {
  it("narrows and lowers the tip relative to the rear of the nose", () => {
    const length = 3.2;
    const geo = new THREE.BoxGeometry(length, 3.2, 3.8);
    taperNose(geo, length, "raked");
    const pos = geo.attributes.position;

    let rearMaxY = 0;
    let tipMaxY = 0;
    let rearMaxZ = -Infinity;
    let tipMaxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const atTip = pos.getX(i) > 0;
      const y = Math.abs(pos.getY(i));
      const z = pos.getZ(i);
      if (atTip) {
        tipMaxY = Math.max(tipMaxY, y);
        tipMaxZ = Math.max(tipMaxZ, z);
      } else {
        rearMaxY = Math.max(rearMaxY, y);
        rearMaxZ = Math.max(rearMaxZ, z);
      }
    }
    expect(tipMaxY).toBeLessThan(rearMaxY);
    expect(tipMaxZ).toBeLessThan(rearMaxZ);
  });

  it("leaves a blunt nose almost square", () => {
    expect(NOSE_SHAPES.blunt.tipWidth).toBeGreaterThan(NOSE_SHAPES.raked.tipWidth);
    expect(NOSE_SHAPES.blunt.roofDropM).toBeLessThan(NOSE_SHAPES.raked.roofDropM);
  });

  it("keeps the nose floor flat on the bogies — only the roofline drops", () => {
    // Regression, code review 2026-08-23: the vertical taper used to scale z
    // about the box CENTRE, which lifted the tip's underside by
    // heightM/2 * (1 - tipHeight) = 0.42 m here and wedged the leading car's
    // floor upward toward the nose, contradicting taperNose's own comment.
    const length = 3.2;
    const height = 3.8;
    const geo = new THREE.BoxGeometry(length, 3.2, height);
    taperNose(geo, length, "raked");
    const pos = geo.attributes.position;

    let tipMinZ = Infinity;
    let tipMaxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) <= 0) continue;
      tipMinZ = Math.min(tipMinZ, pos.getZ(i));
      tipMaxZ = Math.max(tipMaxZ, pos.getZ(i));
    }
    expect(tipMinZ).toBeCloseTo(-height / 2, 6);
    // The tip's overall cross-section is unchanged by anchoring at the floor
    // rather than the centre — only which face stays put moves.
    const p = NOSE_SHAPES.raked;
    expect(tipMaxZ - tipMinZ).toBeCloseTo(height * p.tipHeight - p.roofDropM, 6);
  });

  it("does not move the rear face, which butts onto the leading car", () => {
    const length = 3.2;
    const geo = new THREE.BoxGeometry(length, 3.2, 3.8);
    taperNose(geo, length, "rounded");
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) < 0) {
        expect(Math.abs(pos.getY(i))).toBeCloseTo(1.6, 6);
        expect(Math.abs(pos.getZ(i))).toBeCloseTo(1.9, 6);
      }
    }
  });
});

describe("buildStockGeometry", () => {
  it("gives every vertex a colour", () => {
    const geo = buildStockGeometry(specFor("monorail"));
    expect(geo.getAttribute("color").count).toBe(geo.getAttribute("position").count);
  });

  it("keeps the consist inside its declared length — the nose comes out of the leading car", () => {
    const spec = specFor("heavy");
    const geo = buildStockGeometry(spec);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const total = stockLengthM(spec);
    expect(box.max.x).toBeLessThanOrEqual(total / 2 + 1e-6);
    expect(box.min.x).toBeGreaterThanOrEqual(-total / 2 - 1e-6);
  });

  it("sits the whole train at or above its ride height, never through the deck", () => {
    const spec = specFor("commuter");
    const geo = buildStockGeometry(spec);
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.z).toBeGreaterThanOrEqual(spec.rideHeightM - 1e-6);
  });

  it("renders the glazing ribbon, proud of the shell on both sides", () => {
    const spec = specFor("heavy");
    const geo = buildStockGeometry(spec);
    const color = geo.getAttribute("color");
    const glazing = new THREE.Color(GLAZING_HEX);
    let found = 0;
    let widest = 0;
    for (let i = 0; i < color.count; i++) {
      if (
        Math.abs(color.getX(i) - glazing.r) < 1e-4 &&
        Math.abs(color.getY(i) - glazing.g) < 1e-4 &&
        Math.abs(color.getZ(i) - glazing.b) < 1e-4
      ) {
        found++;
        widest = Math.max(widest, Math.abs(geo.getAttribute("position").getY(i)));
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(widest).toBeGreaterThan(spec.widthM / 2);
  });

  it("insets each band's end caps so they never sit coplanar with the shell's", () => {
    // Regression, code review 2026-08-23: bands were built to the shell's own
    // length and share its xCenter, so their +/-X caps were exactly coplanar
    // and co-wound with the shell's and z-fought on every car end face.
    const spec = specFor("heavy");
    const geo = buildStockGeometry(spec);
    const pos = geo.getAttribute("position");
    const color = geo.getAttribute("color");
    const maxXOf = (hex: number) => {
      const c = new THREE.Color(hex);
      let max = -Infinity;
      for (let i = 0; i < color.count; i++) {
        if (
          Math.abs(color.getX(i) - c.r) < 1e-4 &&
          Math.abs(color.getY(i) - c.g) < 1e-4 &&
          Math.abs(color.getZ(i) - c.b) < 1e-4
        ) {
          max = Math.max(max, pos.getX(i));
        }
      }
      return max;
    };
    expect(maxXOf(spec.glazing.hex)).toBeLessThan(maxXOf(spec.shellHex) - 1e-6);
  });

  it("scales vertex count with car count", () => {
    const three = buildStockGeometry({ ...specFor("heavy"), cars: 3 });
    const four = buildStockGeometry({ ...specFor("heavy"), cars: 4 });
    expect(four.getAttribute("position").count).toBeGreaterThan(
      three.getAttribute("position").count,
    );
  });

  it("adds roof kit only for pantograph stock", () => {
    const withKit = buildStockGeometry(specFor("commuter"));
    const withoutKit = buildStockGeometry({ ...specFor("commuter"), roof: "none" });
    expect(withKit.getAttribute("position").count).toBeGreaterThan(
      withoutKit.getAttribute("position").count,
    );
    expect(DEFAULT_STOCK.commuter.roof).toBe("pantograph");
    expect(DEFAULT_STOCK.heavy.roof).toBe("none");
  });
});
