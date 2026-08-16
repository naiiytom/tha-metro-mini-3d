import * as THREE from "three";

/**
 * The colour a Lambert material actually renders as, for night-lift purposes
 * (`ThreeLayer.setSun`'s per-material floor).
 *
 * `material.color` is only the material's true rendered colour when nothing
 * overrides it per-vertex/per-instance. Two builders deliberately do
 * override it and both leave `material.color` at its default white:
 * `VehicleManager` (`vertexColors: true`, livery baked into merged geometry
 * vertex data) and `trackGeometry.ts`'s `buildMarkerPair` (station discs,
 * `InstancedMesh.setColorAt` per station). Both stamp the real colour as
 * `userData.liveryHex` at construction for exactly this reason — prefer that
 * when present, and fall back to `material.color` for every other Lambert
 * material in the scene (track decks, poles, anything un-stamped), whose
 * `.color` genuinely is what it renders as.
 */
export function materialAlbedo(material: THREE.MeshLambertMaterial): number {
  const stamped = material.userData?.liveryHex as number | undefined;
  return stamped ?? material.color.getHex();
}
