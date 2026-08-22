import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildStockGeometry } from "./stockGeometry";
import type { StockSpec } from "./rollingStock";

/**
 * The `.glb` override seam for rolling stock.
 *
 * **No registry line declares `glbUrl` today, and that is the expected steady
 * state** — see the design doc's decision 1. No correctly-licensed model of
 * this network's real stock could be sourced, so the procedural build is the
 * permanent fallback, not a stopgap. This module exists so that adding one
 * later is a registry edit rather than a renderer rewrite.
 *
 * Every failure path falls back to procedural and warns. A missing or broken
 * model must degrade to a train that is merely generic, never to a route with
 * no trains at all.
 *
 * LOD is deliberately absent: a distance-keyed switch needs two levels that
 * differ in cost, and with no `.glb` in the tree there is exactly one. The
 * seam LOD would need — `VehicleManager.setRouteGeometry` — already exists.
 */

export type StockLoader = (url: string) => Promise<THREE.Object3D>;

/**
 * Default loader: dynamically imports GLTFLoader so it is never in the main
 * chunk. Unreachable today, since nothing declares a glbUrl.
 */
const defaultLoader: StockLoader = async (url) => {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
};

/** Bake a mesh's material colour into per-vertex colours, if it has none. */
function paintFromMaterial(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  if (geometry.getAttribute("color")) return geometry;

  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const source = (material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([source.r, source.g, source.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * One merged, vertex-coloured geometry for a line's stock — from its declared
 * `.glb` if it has one, otherwise procedural.
 *
 * Merged into ONE geometry on purpose: `VehicleManager` renders each route as
 * a single `InstancedMesh`, so a multi-mesh model would otherwise mean either
 * multiple draw calls per route or dropping instancing entirely, both of which
 * break ENGINE_CONTRACT §6.
 */
export async function loadStockGeometry(
  spec: StockSpec,
  load: StockLoader = defaultLoader,
): Promise<THREE.BufferGeometry> {
  if (spec.glbUrl === undefined) return buildStockGeometry(spec);

  try {
    const root = await load(spec.glbUrl);
    root.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) parts.push(paintFromMaterial(node as THREE.Mesh));
    });
    if (parts.length === 0) throw new Error("model contains no mesh");
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) throw new Error("model meshes could not be merged into one geometry");
    return merged;
  } catch (error) {
    console.warn(
      `[rolling stock] falling back to procedural geometry for ${spec.glbUrl}:`,
      error,
    );
    return buildStockGeometry(spec);
  }
}
