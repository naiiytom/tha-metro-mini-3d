import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { resolveStock } from "./rollingStock";
import { buildStockGeometry } from "./stockGeometry";
import { loadStockGeometry } from "./glbStock";

const spec = (glbUrl?: string) => ({
  ...resolveStock({ color: "#7CB342", vehicleType: "heavy", rollingStock: null }),
  ...(glbUrl === undefined ? {} : { glbUrl }),
});

function fakeModel(color = 0x112233): THREE.Object3D {
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry(10, 3, 3);
  root.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color })));
  return root;
}

describe("loadStockGeometry", () => {
  it("builds procedurally when no glbUrl is declared, without calling the loader", async () => {
    const load = vi.fn();
    const geo = await loadStockGeometry(spec(), load);
    expect(load).not.toHaveBeenCalled();
    expect(geo.getAttribute("color").count).toBe(
      buildStockGeometry(spec()).getAttribute("color").count,
    );
  });

  it("loads and merges a declared model into one vertex-coloured geometry", async () => {
    const load = vi.fn().mockResolvedValue(fakeModel());
    const geo = await loadStockGeometry(spec("/stock/test.glb"), load);
    expect(load).toHaveBeenCalledWith("/stock/test.glb");
    expect(geo.getAttribute("color").count).toBe(geo.getAttribute("position").count);
  });

  it("paints an unpainted model from its own material colours", async () => {
    const geo = await loadStockGeometry(spec("/stock/test.glb"), () =>
      Promise.resolve(fakeModel(0xff0000)),
    );
    const color = geo.getAttribute("color");
    const red = new THREE.Color(0xff0000);
    expect(color.getX(0)).toBeCloseTo(red.r, 4);
  });

  it("falls back to procedural when the model has no mesh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geo = await loadStockGeometry(spec("/stock/empty.glb"), () =>
      Promise.resolve(new THREE.Group()),
    );
    expect(geo.getAttribute("color").count).toBe(
      buildStockGeometry(spec()).getAttribute("color").count,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to procedural when the loader rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geo = await loadStockGeometry(spec("/stock/404.glb"), () =>
      Promise.reject(new Error("404")),
    );
    expect(geo.getAttribute("color").count).toBe(
      buildStockGeometry(spec()).getAttribute("color").count,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
