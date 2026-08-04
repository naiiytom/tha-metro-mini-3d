import * as THREE from "three";
import { skyPalette } from "./sun";

/**
 * Atmospheric sky behind the network (roadmap item 6, "sunset glow").
 *
 * THE DEPTH PROBLEM, AND WHY THIS SHAPE:
 * MapLibre draws its own tiles BEFORE running the custom layer (SRS §3A.4),
 * so anything this scene draws lands on top of the city. A naive sky sphere
 * would paint straight over Bangkok.
 *
 * The fix is not depth interop (that is the open-ended problem §3A.4 exists
 * to avoid) — it is a geometric constraint: draw first, never touch the depth
 * buffer, and DISCARD every fragment below the local ENU horizon plane. Sky
 * renders above the horizon; below it the basemap is untouched. Same class of
 * deliberate sidestep as the opacity-based underground mode.
 *
 * Colours come from `skyPalette`, the same function that lights the scene, so
 * the horizon warms at exactly the elevations the key light warms at — they
 * cannot drift apart.
 */

/** Big enough to sit outside anything the user can see from a city-scale
 *  camera, small enough to stay inside MapLibre's clip range. */
const RADIUS_M = 120_000;

const NIGHT_ZENITH = new THREE.Color(0x070d18);
const DAY_ZENITH = new THREE.Color(0x4a86c8);
const NIGHT_HORIZON = new THREE.Color(0x121a2b);
const DAY_HORIZON = new THREE.Color(0xbcd8f0);

export interface SkyDome {
  readonly mesh: THREE.Mesh;
  setElevation(elevationDeg: number): void;
  /** Keep the dome around the viewer: scene coordinates are local ENU meters
   *  around Siam, and the network spans ~50 km, so a dome pinned to the
   *  origin leaves the frame once the user pans out to Rangsit or Lak Song. */
  setCenter(east: number, north: number): void;
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
varying vec3 vLocal;
void main() {
  // Local ENU: +z is up. Everything at or below the horizon plane is the
  // city's business, not the sky's — discard rather than blend, so the
  // basemap below the horizon is bit-for-bit untouched.
  if (vLocal.z <= 0.0) discard;
  float t = clamp(vLocal.z / length(vLocal), 0.0, 1.0);
  // Bias the gradient toward the horizon: the interesting colour is in the
  // bottom of the sky, not spread evenly to the zenith.
  gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.55)), 1.0);
}
`;

export function buildSkyDome(): SkyDome {
  const geometry = new THREE.SphereGeometry(RADIUS_M, 32, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: DAY_ZENITH.clone() },
      uHorizon: { value: DAY_HORIZON.clone() },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Drawn before the network so track/trains composite over it normally.
  mesh.renderOrder = -1;
  // A sphere centred on the camera is never "out of view" in the frustum
  // sense, so culling it by its origin-relative bounds is always wrong.
  mesh.frustumCulled = false;

  const scratch = new THREE.Color();

  return {
    mesh,
    setElevation(elevationDeg: number) {
      const palette = skyPalette(elevationDeg);
      // `day` here mirrors skyPalette's own ramp so the sky and the key light
      // cross their day/night transition together.
      const day = Math.max(0, Math.min(1, (elevationDeg + 6) / 18));
      (material.uniforms.uZenith.value as THREE.Color)
        .copy(NIGHT_ZENITH)
        .lerp(DAY_ZENITH, day);
      // Tint the horizon by the sun's own colour, which skyPalette has
      // already pushed toward gold through the golden band around ±4°.
      scratch.setHex(palette.sun);
      (material.uniforms.uHorizon.value as THREE.Color)
        .copy(NIGHT_HORIZON)
        .lerp(DAY_HORIZON, day)
        .lerp(scratch, 0.35);
    },
    setCenter(east: number, north: number) {
      mesh.position.set(east, north, 0);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
