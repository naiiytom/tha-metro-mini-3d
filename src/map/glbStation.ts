import * as THREE from "three";
import type { StationModelOverride } from "../types";

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

function disposeMaterialWithTextures(mat: THREE.Material): void {
  for (const val of Object.values(mat)) {
    if (
      val instanceof THREE.Texture ||
      (val && typeof val === "object" && "isTexture" in val && (val as { isTexture: boolean }).isTexture)
    ) {
      (val as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

/**
 * Disposes all geometries, materials, and attached textures in a landmark station model tree.
 */
export function disposeStationModel(root: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (m && !disposedMaterials.has(m)) {
          disposedMaterials.add(m);
          disposeMaterialWithTextures(m);
        }
      }
    }
  });
}
