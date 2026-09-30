import * as THREE from "three";
import type { StationModelOverride } from "../types";
import { STATION_MODELS } from "../../tools/lines.config.mjs";

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
    if (override.headingOffsetDeg) {
      scene.rotation.z += (override.headingOffsetDeg * Math.PI) / 180;
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
 * Finds matching station override by station code or hub ID.
 */
export function findStationOverride(
  stationCode: string,
  hubId: string | null | undefined,
  overrides: StationModelOverride[] = STATION_MODELS,
): StationModelOverride | null {
  const stopOverride = overrides.find((o) => o.id === stationCode);
  if (stopOverride) return stopOverride;
  if (hubId) {
    const hubOverride = overrides.find((o) => o.id === hubId);
    if (hubOverride) return hubOverride;
  }
  return null;
}

/**
 * Identifies all station stops that should be suppressed from procedural generation
 * because either their stop code or their parent hub has an active .glb override.
 */
export function collectSuppressedStationIds(
  stations: { id: string | number; code?: string; hubId?: string }[],
  overrides: StationModelOverride[] = STATION_MODELS,
): Set<string | number> {
  const suppressed = new Set<string | number>();
  if (overrides.length === 0) return suppressed;

  const overrideIds = new Set(overrides.map((o) => o.id));

  for (const s of stations) {
    if (overrideIds.has(String(s.id)) || (s.code && overrideIds.has(s.code))) {
      suppressed.add(s.id);
      if (s.code) suppressed.add(s.code);
    } else if (s.hubId && overrideIds.has(s.hubId)) {
      suppressed.add(s.id);
      if (s.code) suppressed.add(s.code);
    }
  }

  return suppressed;
}
