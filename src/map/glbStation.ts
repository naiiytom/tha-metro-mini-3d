import * as THREE from "three";
import type { StationModelOverride } from "../types";
import { STATION_MODELS } from "../../tools/lines.config.mjs";
import { normalizedName } from "../stations/stationHubs";

/**
 * Landmark 3D station model loader seam.
 *
 * Like rolling stock in glbStock.ts, procedural station generation is the
 * permanent baseline. This loader provides an async hook to attach high-fidelity
 * .glb landmark models for major transit hubs (e.g. Krung Thep Aphiwat Central
 * Terminal, Siam Hub, Suvarnabhumi APM).
 *
 * GLTFLoader is dynamically imported so that it is never bundled in the main chunk
 * when no .glb overrides are active (respecting SRS NF2 <= 5 MB gzip budget).
 */

export type StationLoader = (url: string) => Promise<THREE.Object3D>;

/**
 * Default loader: dynamically imports GLTFLoader on demand.
 */
export const defaultStationLoader: StationLoader = async (url) => {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
};

/**
 * Asynchronously loads a landmark .glb station model override, applying scale,
 * rotation offset, and altitude offset.
 *
 * Returns null on error, gracefully falling back to procedural generation.
 */
export async function loadStationModel(
  override: StationModelOverride,
  loader: StationLoader = defaultStationLoader,
): Promise<THREE.Object3D | null> {
  try {
    const scene = await loader(override.glbUrl);
    const root = new THREE.Group();
    root.name = `landmark-station-${override.id}`;
    root.userData.isStationModel = true;
    root.userData.overrideId = override.id;

    if (override.scale) {
      scene.scale.set(override.scale[0], override.scale[1], override.scale[2]);
    }
    const headingOffset = override.headingOffsetDeg ?? override.headingDeg;
    if (headingOffset) {
      scene.rotation.z += (headingOffset * Math.PI) / 180;
    }
    if (override.altitudeOffsetM) {
      scene.position.z += override.altitudeOffsetM;
    }

    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    root.add(scene);
    return root;
  } catch (error) {
    console.warn(
      `[station model] failed to load model for ${override.id} at ${override.glbUrl}:`,
      error,
    );
    return null;
  }
}

/**
 * Disposes all geometries and materials attached to a landmark station model tree.
 */
export function disposeStationModel(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => m?.dispose());
    }
  });
}

/**
 * Finds matching station override by station code, hub ID, or station name.
 */
export function findStationOverride(
  stationCode: string,
  hubId: string | null | undefined,
  overrides: StationModelOverride[] = STATION_MODELS,
  stationName?: string,
): StationModelOverride | null {
  const stopOverride = overrides.find((o) => o.id === stationCode);
  if (stopOverride) return stopOverride;
  if (hubId) {
    const hubOverride = overrides.find((o) => o.id === hubId);
    if (hubOverride) return hubOverride;
  }
  if (stationName) {
    const norm = normalizedName(stationName);
    const nameOverride = overrides.find((o) => {
      const target = normalizedName(o.id.replace(/^hub:/, ""));
      return target === norm || target.split(/[-\s]+/).includes(norm);
    });
    if (nameOverride) return nameOverride;
  }
  return null;
}

/**
 * Identifies all station stops that should be suppressed from procedural generation
 * because either their stop code, station name, or parent hub has an active .glb override.
 */
export function collectSuppressedStationIds(
  stations: { id: string | number; code?: string; hubId?: string; name?: string }[],
  overrides: StationModelOverride[] = STATION_MODELS,
): Set<string | number> {
  const suppressed = new Set<string | number>();
  if (overrides.length === 0) return suppressed;

  const overrideIds = new Set(overrides.map((o) => o.id));
  const normOverrideNames = overrides.map((o) =>
    normalizedName(o.id.replace(/^hub:/, "")),
  );

  for (const s of stations) {
    const normName = s.name ? normalizedName(s.name) : "";
    const isOverridden =
      overrideIds.has(String(s.id)) ||
      (Boolean(s.code) && overrideIds.has(s.code!)) ||
      (Boolean(s.hubId) && overrideIds.has(s.hubId!)) ||
      (Boolean(normName) &&
        normOverrideNames.some(
          (target) => target === normName || target.split(/[-\s]+/).includes(normName),
        ));

    if (isOverridden) {
      suppressed.add(s.id);
      if (s.code) suppressed.add(s.code);
      if (s.hubId) suppressed.add(s.hubId);
      if (s.name) suppressed.add(s.name);
    }
  }

  return suppressed;
}
