import { describe, expect, it, vi } from "vitest";
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
    render = vi.fn();
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer as unknown as typeof actual.WebGLRenderer,
  };
});

import {
  disposeStationModel,
  loadStationModel,
} from "./glbStation";
import { NetworkLayer } from "./ThreeLayer";
import type { NetworkData, StationModelOverride } from "../types";

describe("loadStationModel", () => {
  it("loads, scales, rotates, and sets shadow properties on a landmark model", async () => {
    const mockScene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial());
    mockScene.add(mesh);

    const mockLoader = vi.fn().mockResolvedValue(mockScene);
    const override: StationModelOverride = {
      id: "hub:siam",
      glbUrl: "/models/siam.glb",
      scale: [2, 2, 2],
      headingOffsetDeg: 90,
      altitudeOffsetM: 5,
    };

    const root = await loadStationModel(override, mockLoader);
    expect(root).not.toBeNull();
    expect(root!.name).toBe("landmark-station-hub:siam");
    expect(root!.userData.isStationModel).toBe(true);

    expect(mockScene.scale.x).toBe(2);
    expect(mockScene.scale.y).toBe(2);
    expect(mockScene.scale.z).toBe(2);
    expect(mockScene.rotation.z).toBeCloseTo(Math.PI / 2);
    expect(mockScene.position.z).toBe(5);

    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it("supports headingDeg alias for headingOffsetDeg", async () => {
    const mockScene = new THREE.Group();
    const mockLoader = vi.fn().mockResolvedValue(mockScene);
    const override: StationModelOverride = {
      id: "hub:siam",
      glbUrl: "/models/siam.glb",
      headingDeg: 180,
    };

    await loadStationModel(override, mockLoader);
    expect(mockScene.rotation.z).toBeCloseTo(Math.PI);
  });

  it("handles loader failures gracefully by logging a warning and returning null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingLoader = vi.fn().mockRejectedValue(new Error("Network 404"));

    const override: StationModelOverride = {
      id: "CEN",
      glbUrl: "/missing.glb",
    };

    const result = await loadStationModel(override, failingLoader);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[station model] failed to load model for CEN"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("disposeStationModel", () => {
  it("disposes geometry, materials, and textures attached to materials", () => {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const geoDisposeSpy = vi.spyOn(geo, "dispose");
    const matDisposeSpy = vi.spyOn(mat, "dispose");
    const texDisposeSpy = vi.spyOn(texture, "dispose");

    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    disposeStationModel(group);

    expect(geoDisposeSpy).toHaveBeenCalledOnce();
    expect(matDisposeSpy).toHaveBeenCalledOnce();
    expect(texDisposeSpy).toHaveBeenCalledOnce();
  });
});

describe("ThreeLayer landmark station integration", () => {
  const createMockNetwork = (): NetworkData => ({
    generated: "2026-09-30",
    source: "test",
    lines: [
      {
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
        ],
        stations: [
          {
            id: "S1",
            name: "Siam",
            nameTh: "สยาม",
            code: "CEN",
            position: [100.535, 13.74, 15],
            hubId: "hub:siam",
          },
        ],
      },
      {
        key: "underground-line",
        name: "MRT Underground",
        nameTh: "สายใต้ดิน",
        color: "#00008b",
        structure: "underground",
        vehicleType: "heavy",
        gtfsRouteId: "2",
        preRevenue: false,
        syntheticSchedule: null,
        estimatedRunTimes: null,
        rollingStock: null,
        relationId: 2,
        osmName: "MRT Underground",
        track: [
          [100.53, 13.75, -20, "underground"],
          [100.54, 13.75, -20, "underground"],
        ],
        stations: [
          {
            id: "UG1",
            name: "Silom",
            nameTh: "สีลม",
            code: "BL26",
            position: [100.535, 13.75, -20],
          },
        ],
      },
    ],
  });

  it("keeps configured landmark platforms visible when loading fails", async () => {
    const net = createMockNetwork();
    net.lines[0].stations[0].name = "Krung Thep Aphiwat";
    delete net.lines[0].stations[0].hubId;
    const layer = new NetworkLayer(net);
    layer.onAdd({ getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map, {} as WebGL2RenderingContext);
    const scene = (layer as unknown as { scene: THREE.Scene }).scene;
    const platforms = scene.getObjectByName("line-test-line")!.getObjectByName("station-platforms") as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const model = await loadStationModel(
        { id: "hub:krung-thep-aphiwat", glbUrl: "/missing.glb" },
        async () => { throw new Error("404"); },
      );
      expect(model).toBeNull();
      expect(platforms).toBeDefined();
      expect(platforms.count).toBe(1);
      platforms.getMatrixAt(0, matrix);
      expect(matrix.getMaxScaleOnAxis()).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
      layer.onRemove();
    }
  });

  it("keeps a shared landmark visible only while a member route is visible", () => {
    const net = createMockNetwork();
    net.lines[1].stations[0].code = "CEN";
    const layer = new NetworkLayer(net);
    layer.onAdd({ getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map, {} as WebGL2RenderingContext);
    layer.setLineVisible(0, false);
    layer.setLineVisible(1, false);
    const model = new THREE.Group();
    layer.addLandmarkModel(model, { id: "CEN", glbUrl: "/shared.glb" });
    expect(model.visible).toBe(false);
    layer.setLineVisible(1, true);
    expect(model.visible).toBe(true);
    layer.setLineVisible(0, true);
    layer.setLineVisible(1, false);
    expect(model.visible).toBe(true);
    layer.setLineVisible(0, false);
    expect(model.visible).toBe(false);
    layer.onRemove();
  });

  it.each(["CEN", "BL26"])("preserves shared glass alpha across mode changes for %s", (id) => {
    const layer = new NetworkLayer(createMockNetwork());
    layer.onAdd({ getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map, {} as WebGL2RenderingContext);
    const glass = new THREE.MeshStandardMaterial({ opacity: 0.65, transparent: true, depthWrite: false });
    const alphaTexture = new THREE.MeshStandardMaterial({ transparent: true });
    const solid = new THREE.MeshStandardMaterial();
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), [glass, alphaTexture, solid]));
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), glass));
    layer.setUndergroundMode(true);
    layer.addLandmarkModel(model, { id, glbUrl: "/glass.glb" });
    for (const on of [true, false, true, false]) {
      layer.setUndergroundMode(on);
      const factor = id === "BL26" ? (on ? 1 : 0.35) : (on ? 0.3 : 1);
      expect(glass.opacity).toBeCloseTo(0.65 * factor);
      expect(glass.transparent).toBe(true);
      expect(glass.depthWrite).toBe(false);
      expect(alphaTexture.transparent).toBe(true);
      expect(solid.opacity).toBeCloseTo(factor);
      expect(solid.transparent).toBe(factor < 1);
      expect(solid.depthWrite).toBe(factor === 1);
    }
    layer.onRemove();
  });

  it("positions landmark model at station coordinates and track tangent heading", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const modelGroup = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    modelGroup.add(mesh);
    modelGroup.userData.overrideId = "hub:siam";

    layer.addLandmarkModel(modelGroup);

    // Verify model position is placed at local ENU coords for [100.535, 13.74, 15] + marker height 1.5
    expect(modelGroup.position.x).not.toBe(0);
    expect(modelGroup.position.z).toBeCloseTo(16.5);
    // Track runs purely eastward from 100.53 to 100.54 at lat 13.74, heading ~ 0
    expect(modelGroup.rotation.z).toBeCloseTo(0, 1);
  });

  it("replaces procedural station instances when landmark model is added", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    // Access scene's procedural station platforms
    const scene = (layer as unknown as { scene: THREE.Scene }).scene;
    const platforms = scene.getObjectByName("station-platforms") as THREE.InstancedMesh;
    expect(platforms).toBeDefined();

    const m = new THREE.Matrix4();
    platforms.getMatrixAt(0, m);
    const scale = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(m.getMaxScaleOnAxis()).toBeGreaterThan(0.1);

    // Add landmark model for CEN
    const modelGroup = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshStandardMaterial());
    modelGroup.add(mesh);
    modelGroup.userData.overrideId = "CEN";

    layer.addLandmarkModel(modelGroup);

    // Verify procedural platform has been suppressed (matrix scale collapsed to 0)
    platforms.getMatrixAt(0, m);
    expect(m.getMaxScaleOnAxis()).toBe(0);
  });

  it("supports underground mode opacity transitions without z-fighting", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const modelGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), mat);
    modelGroup.add(mesh);
    modelGroup.userData.overrideId = "BL26"; // underground station

    layer.addLandmarkModel(modelGroup);

    // Underground mode initially OFF: subsurface materials should be translucent with depthWrite: false
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.35);
    expect(mat.depthWrite).toBe(false);

    // Toggle underground mode ON: subsurface materials become fully opaque with depthWrite: true
    layer.setUndergroundMode(true);
    expect(mat.transparent).toBe(false);
    expect(mat.opacity).toBe(1);
    expect(mat.depthWrite).toBe(true);

    // Toggle underground mode back OFF
    layer.setUndergroundMode(false);
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.35);
    expect(mat.depthWrite).toBe(false);
  });

  it("applies night lift floor to landmark model MeshStandardMaterial", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const modelGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1964B7 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), mat);
    modelGroup.add(mesh);
    modelGroup.userData.overrideId = "CEN";

    layer.addLandmarkModel(modelGroup);

    // Simulate night sun update
    const darkPalette = {
      sun: 0x3d5a8a,
      sunIntensity: 0.9,
      ambient: 0x2c3a55,
      ambientIntensity: 1.35,
    };
    layer.setSun({ east: 0, north: 0, up: 0.1 }, darkPalette as any, -20);

    // Emissive should be lifted above 0 to satisfy contrast floor
    expect(mat.emissive.getHex()).toBeGreaterThan(0);
    expect(mat.emissiveIntensity).toBeGreaterThan(0);
  });

  it("respects 2D mode by hiding canopies and support pillars", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const scene = (layer as unknown as { scene: THREE.Scene }).scene;
    const canopies = scene.getObjectByName("station-canopies") as THREE.InstancedMesh;
    const pillars = scene.getObjectByName("station-pillars") as THREE.InstancedMesh;

    expect(canopies.visible).toBe(true);
    expect(pillars.visible).toBe(true);

    // Switch to 2D mode
    layer.setMap3D(false);
    expect(canopies.visible).toBe(false);
    expect(pillars.visible).toBe(false);

    // Switch back to 3D mode
    layer.setMap3D(true);
    expect(canopies.visible).toBe(true);
    expect(pillars.visible).toBe(true);
  });

  it("assigns hubId dynamically and matches hub:siam when stations have no pre-set hubId", () => {
    // Mimic real network.json where hubId is undefined and code is empty for Siam
    const net = createMockNetwork();
    delete net.lines[0].stations[0].hubId;
    net.lines[0].stations[0].code = "";

    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const modelGroup = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshStandardMaterial());
    modelGroup.add(mesh);

    layer.addLandmarkModel(modelGroup, { id: "hub:siam", glbUrl: "/siam.glb" });

    // Model was successfully placed at Siam rather than staying at (0, 0, 0)
    expect(modelGroup.position.x).not.toBe(0);
    expect(modelGroup.position.z).toBeCloseTo(16.5);
  });

  it("warns when override id matches no station in network", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const modelGroup = new THREE.Group();
    layer.addLandmarkModel(modelGroup, { id: "non-existent-stop", glbUrl: "/none.glb" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[station model] no station found matching override id 'non-existent-stop'"),
    );
    warnSpy.mockRestore();
  });

  it("deduplicates shared materials across multiple meshes in landmark model", () => {
    const net = createMockNetwork();
    const layer = new NetworkLayer(net);
    const mockMap = { getCanvas: () => ({}) } as unknown as import("maplibre-gl").Map;
    const mockGl = {} as unknown as WebGL2RenderingContext;
    layer.onAdd(mockMap, mockGl);

    const sharedMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
    const modelGroup = new THREE.Group();
    modelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat));
    modelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), sharedMat));
    modelGroup.userData.overrideId = "CEN";

    layer.addLandmarkModel(modelGroup);

    const litMaterials = (layer as unknown as { litMaterials: THREE.Material[] }).litMaterials;
    const occurrences = litMaterials.filter((m) => m === sharedMat).length;
    expect(occurrences).toBe(1);
  });
});

