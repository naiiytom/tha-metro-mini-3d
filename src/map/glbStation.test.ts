import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  collectSuppressedStationIds,
  findStationOverride,
  loadStationModel,
} from "./glbStation";
import type { StationModelOverride } from "../types";

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

describe("findStationOverride", () => {
  const overrides: StationModelOverride[] = [
    { id: "CEN", glbUrl: "/cen.glb" },
    { id: "hub:asok-sukhumvit", glbUrl: "/asok.glb" },
  ];

  it("finds override by stop code", () => {
    const match = findStationOverride("CEN", "hub:siam", overrides);
    expect(match?.id).toBe("CEN");
  });

  it("finds override by hub id when stop code has no direct override", () => {
    const match = findStationOverride("BL22", "hub:asok-sukhumvit", overrides);
    expect(match?.id).toBe("hub:asok-sukhumvit");
  });

  it("returns null when neither matches", () => {
    expect(findStationOverride("E4", "hub:asok", overrides)).toBeNull();
  });
});

describe("collectSuppressedStationIds", () => {
  it("suppresses member stop IDs when parent hub has a landmark override", () => {
    const stations = [
      { id: "stop-1", code: "CEN", hubId: "hub:siam" },
      { id: "stop-2", code: "E1", hubId: "hub:chitlom" },
      { id: "stop-3", code: "BL22", hubId: "hub:asok-sukhumvit" },
    ];
    const overrides: StationModelOverride[] = [
      { id: "hub:siam", glbUrl: "/siam.glb" },
    ];

    const suppressed = collectSuppressedStationIds(stations, overrides);
    expect(suppressed.has("stop-1")).toBe(true);
    expect(suppressed.has("CEN")).toBe(true);
    expect(suppressed.has("stop-2")).toBe(false);
    expect(suppressed.has("stop-3")).toBe(false);
  });

  it("suppresses stop when stop code itself is overridden", () => {
    const stations = [
      { id: "stop-1", code: "RN01", hubId: "hub:bangsue" },
    ];
    const overrides: StationModelOverride[] = [
      { id: "RN01", glbUrl: "/bangsue.glb" },
    ];

    const suppressed = collectSuppressedStationIds(stations, overrides);
    expect(suppressed.has("stop-1")).toBe(true);
    expect(suppressed.has("RN01")).toBe(true);
  });

  it("returns empty set when no overrides declared", () => {
    const stations = [{ id: "stop-1", code: "CEN" }];
    const suppressed = collectSuppressedStationIds(stations, []);
    expect(suppressed.size).toBe(0);
  });
});
