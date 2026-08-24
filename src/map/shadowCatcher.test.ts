import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    autoClear = false;
    shadowMap = {
      enabled: false,
      type: 0,
      needsUpdate: false,
    };
    dispose = vi.fn();
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer as unknown as typeof actual.WebGLRenderer,
  };
});

import { NetworkLayer } from "./ThreeLayer";
import type { NetworkData } from "../types";

describe("shadowCatcher ground plane", () => {
  let layer: NetworkLayer;

  const mockData: NetworkData = {
    generated: "2026-08-24",
    source: "test",
    lines: [],
  };

  beforeEach(() => {
    layer = new NetworkLayer(mockData);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);
  });

  it("creates a shadow catcher mesh with PlaneGeometry(8000, 8000) and ShadowMaterial(opacity: 0.35)", () => {
    const shadowCatcher = (layer as unknown as { shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> }).shadowCatcher;
    expect(shadowCatcher).toBeDefined();
    expect(shadowCatcher).toBeInstanceOf(THREE.Mesh);

    // Verify PlaneGeometry
    expect(shadowCatcher.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(shadowCatcher.geometry.parameters.width).toBe(8000);
    expect(shadowCatcher.geometry.parameters.height).toBe(8000);

    // Verify ShadowMaterial
    expect(shadowCatcher.material).toBeInstanceOf(THREE.ShadowMaterial);
    expect(shadowCatcher.material.opacity).toBe(0.35);

    // Verify position, shadow properties and initial visibility
    expect(shadowCatcher.position.x).toBe(0);
    expect(shadowCatcher.position.y).toBe(0);
    expect(shadowCatcher.position.z).toBe(0);
    expect(shadowCatcher.receiveShadow).toBe(true);
    expect(shadowCatcher.visible).toBe(false);
  });

  it("toggles shadowCatcher visibility when setShadowsEnabled is called", () => {
    const shadowCatcher = (layer as unknown as { shadowCatcher: THREE.Mesh }).shadowCatcher;
    const renderer = (layer as unknown as { renderer: { shadowMap: { enabled: boolean } } }).renderer;

    layer.setShadowsEnabled(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(shadowCatcher.visible).toBe(true);

    layer.setShadowsEnabled(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(shadowCatcher.visible).toBe(false);
  });

  it("hides shadowCatcher when underground mode is active and restores it when deactivated", () => {
    const shadowCatcher = (layer as unknown as { shadowCatcher: THREE.Mesh }).shadowCatcher;

    // Enable shadows first
    layer.setShadowsEnabled(true);
    expect(shadowCatcher.visible).toBe(true);

    // Turn underground mode ON -> shadowCatcher hidden
    layer.setUndergroundMode(true);
    expect(shadowCatcher.visible).toBe(false);

    // Turn underground mode OFF -> restores shadowCatcher.visible = shadowMap.enabled (true)
    layer.setUndergroundMode(false);
    expect(shadowCatcher.visible).toBe(true);

    // Disable shadows while underground mode is OFF
    layer.setShadowsEnabled(false);
    expect(shadowCatcher.visible).toBe(false);

    // Turn underground mode ON then OFF -> restores shadowCatcher.visible = shadowMap.enabled (false)
    layer.setUndergroundMode(true);
    expect(shadowCatcher.visible).toBe(false);

    layer.setUndergroundMode(false);
    expect(shadowCatcher.visible).toBe(false);
  });

  it("keeps shadowCatcher hidden if shadows are enabled while underground mode is active", () => {
    const shadowCatcher = (layer as unknown as { shadowCatcher: THREE.Mesh }).shadowCatcher;
    const renderer = (layer as unknown as { renderer: { shadowMap: { enabled: boolean } } }).renderer;

    // Turn underground mode ON first
    layer.setUndergroundMode(true);
    expect(shadowCatcher.visible).toBe(false);

    // Enable shadows while underground mode is ON
    layer.setShadowsEnabled(true);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(shadowCatcher.visible).toBe(false);

    // Turn underground mode OFF -> restores shadowCatcher.visible to true
    layer.setUndergroundMode(false);
    expect(shadowCatcher.visible).toBe(true);
  });
});
