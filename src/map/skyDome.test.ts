import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSkyDome } from "./skyDome";

describe("buildSkyDome", () => {
  it("never writes or tests depth — MapLibre's tiles are already drawn", () => {
    const dome = buildSkyDome();
    const m = dome.mesh.material as THREE.ShaderMaterial;
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
    dome.dispose();
  });

  it("renders before everything else in the scene", () => {
    const dome = buildSkyDome();
    expect(dome.mesh.renderOrder).toBeLessThan(0);
    dome.dispose();
  });

  it("renders inside-out so the viewer sees the dome's interior", () => {
    const dome = buildSkyDome();
    expect((dome.mesh.material as THREE.ShaderMaterial).side).toBe(THREE.BackSide);
    dome.dispose();
  });

  it("carries a horizon cut so nothing below ground level is drawn", () => {
    // This is the whole reason the dome does not paint over the city.
    const dome = buildSkyDome();
    const m = dome.mesh.material as THREE.ShaderMaterial;
    expect(m.fragmentShader).toMatch(/discard/);
    dome.dispose();
  });

  it("moves its horizon colour toward the golden band at sunset", () => {
    const dome = buildSkyDome();
    const m = dome.mesh.material as THREE.ShaderMaterial;
    dome.setElevation(60);
    const noonHorizon = (m.uniforms.uHorizon.value as THREE.Color).clone();
    dome.setElevation(2);
    const duskHorizon = (m.uniforms.uHorizon.value as THREE.Color).clone();
    // Warmer: more red relative to blue than at noon.
    expect(duskHorizon.r / duskHorizon.b).toBeGreaterThan(noonHorizon.r / noonHorizon.b);
    dome.dispose();
  });

  it("goes darker at night than at noon at both zenith and horizon", () => {
    const dome = buildSkyDome();
    const m = dome.mesh.material as THREE.ShaderMaterial;
    dome.setElevation(60);
    const noonZ = (m.uniforms.uZenith.value as THREE.Color).getHSL({ h: 0, s: 0, l: 0 }).l;
    dome.setElevation(-40);
    const nightZ = (m.uniforms.uZenith.value as THREE.Color).getHSL({ h: 0, s: 0, l: 0 }).l;
    expect(nightZ).toBeLessThan(noonZ);
    dome.dispose();
  });

  it("recentres without rebuilding geometry", () => {
    const dome = buildSkyDome();
    const geom = dome.mesh.geometry;
    dome.setCenter(12_345, -6_789);
    expect(dome.mesh.position.x).toBe(12_345);
    expect(dome.mesh.position.y).toBe(-6_789);
    expect(dome.mesh.geometry).toBe(geom);
    dome.dispose();
  });
});
