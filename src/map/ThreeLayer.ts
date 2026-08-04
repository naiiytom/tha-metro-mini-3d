import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import type { NetworkData } from "../types";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import { PRE_REVENUE_OPACITY, buildStationMarkers, buildTrackDeck, buildTrackLine } from "./trackGeometry";
import type { VehicleManager } from "./VehicleManager";

/**
 * Custom MapLibre layer hosting the Three.js scene (SRS §3A.4).
 *
 * Three renders into MapLibre's OWN WebGL context (never a second canvas).
 * Each frame MapLibre hands us a float64 mercator→clip matrix; we fold the
 * local-frame origin translation + meter scale into it before it ever
 * touches the GPU, so vertex data stays small (floating origin, §3A.5).
 */
export class NetworkLayer implements CustomLayerInterface {
  id = "network-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private camera = new THREE.Camera();
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  /** local ENU meters -> absolute mercator (float64, applied in JS). */
  private originMatrix = new THREE.Matrix4()
    .makeTranslation(ORIGIN_MERC.x, ORIGIN_MERC.y, 0)
    .scale(new THREE.Vector3(MERC_PER_METER, -MERC_PER_METER, MERC_PER_METER));
  private projection = new THREE.Matrix4();
  private lineMaterials: LineMaterial[] = [];
  /** Per-line groups, index == route_idx — the unit the line selector toggles. */
  private lineGroups: THREE.Group[] = [];
  /** Every material tagged by elevation band, so the underground mode can
   *  re-weight the two sets without walking the scene graph each toggle. */
  private surfaceMaterials: THREE.Material[] = [];
  private subsurfaceMaterials: THREE.Material[] = [];
  private undergroundMode = false;

  /**
   * Per-frame hook, invoked at the start of every render() before drawing —
   * MapContainer uses it to push interpolated vehicle poses into the
   * VehicleManager without touching React/Zustand (SRS §3A.7).
   */
  beforeRender: (() => void) | null = null;

  constructor(
    private data: NetworkData,
    private vehicles?: VehicleManager,
  ) {}

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    // Off by default (§3A.5): a city-wide shadow map is the single most
    // expensive thing in this scene and the 30-FPS mobile target has no room
    // for it. The map is allocated once and enabled/disabled via
    // renderer.shadowMap.enabled so toggling costs no reallocation.
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xffffff, 1.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-3000, -2000, 8000);
    sun.castShadow = true;
    // Tightly-fit orthographic frustum: a 4 km box around the origin covers
    // the visible core at typical zooms. Wider would quantise the shadow map
    // into uselessness; this is the "tightly-fit frustum" §3A.5 asks for.
    const cam = sun.shadow.camera;
    cam.left = -2000;
    cam.right = 2000;
    cam.top = 2000;
    cam.bottom = -2000;
    cam.near = 1;
    cam.far = 30_000;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    this.ambientLight = ambient;
    this.sunLight = sun;

    for (const line of this.data.lines) {
      const group = new THREE.Group();
      group.name = `line-${line.key}`;
      group.add(buildTrackDeck(line));
      const { line: centerline, material } = buildTrackLine(line);
      group.add(centerline);
      this.lineMaterials.push(material);
      group.add(buildStationMarkers([line]));
      scene.add(group);
      this.lineGroups.push(group);
    }
    if (this.vehicles) scene.add(...this.vehicles.meshes);
    this.scene = scene;
    this.indexMaterialsByBand();
    this.applyUndergroundMode();
  }

  /**
   * Point the key light at the sun's real position for the simulated time
   * (SRS §F3.3). Called at UI rate from MapContainer — solar elevation moves
   * ~0.004°/s at 1× warp, so evaluating this per frame would be pure waste.
   * The 10 km radius just needs to clear the scene; a directional light's
   * position only sets its direction.
   */
  setSun(
    dir: { east: number; north: number; up: number },
    palette: {
      sun: number;
      sunIntensity: number;
      ambient: number;
      ambientIntensity: number;
    },
  ): void {
    if (!this.sunLight || !this.ambientLight) return;
    const R = 10_000;
    this.sunLight.position.set(dir.east * R, dir.north * R, Math.max(dir.up, 0.05) * R);
    this.sunLight.color.setHex(palette.sun);
    this.sunLight.intensity = palette.sunIntensity;
    this.ambientLight.color.setHex(palette.ambient);
    this.ambientLight.intensity = palette.ambientIntensity;
  }

  /**
   * Walk the scene once and sort every track/station material into the
   * surface or sub-surface bucket, using the `userData.structure` tag
   * `buildTrackDeck` stamps on each run's mesh and `buildStationMarkers`
   * stamps on its underground-band disc/pole pair. Anything without that tag
   * — an above-ground run/station-band mesh, or the line's Line2 centerline
   * — is surface.
   *
   * The centerline deliberately stays surface-classified always, even for a
   * line that is entirely or mostly underground: it is a constant-pixel-width
   * low-zoom navigational aid drawn once for the whole route, not per
   * structure band, so there is no correct way to dim "half" of it — and
   * dimming all of it would defeat the reason it exists (finding 6a).
   *
   * Previously this classified ANY untagged mesh in a line's group as
   * sub-surface whenever the line had any underground run at all — which
   * caught not just the centerline but BOTH station-marker InstancedMeshes
   * (discs + poles), permanently dimming every station on a mixed line like
   * MRT Blue, including the ones on its elevated half. Station markers are
   * now split per structure band at build time (see `buildStationMarkers`),
   * so they carry their own accurate tag and no longer need — or get —
   * special-cased fallback logic here.
   */
  private indexMaterialsByBand(): void {
    for (const group of this.lineGroups) {
      group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.InstancedMesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const band =
          obj.userData?.structure === "underground" ? this.subsurfaceMaterials : this.surfaceMaterials;
        band.push(...mats);
      });
    }
  }

  /**
   * Re-weight the two bands. Off: sub-surface geometry is translucent and
   * does not write depth, so it reads as "beneath" without needing real
   * depth interop with MapLibre's tiles (§3A.4 — that is the open-ended
   * problem this deliberately sidesteps). On: sub-surface goes fully opaque
   * and the surface network recedes.
   *
   * A pre-revenue material (`sweepDeck` tags it with `userData.preRevenue`)
   * is capped at PRE_REVENUE_OPACITY in both modes rather than driven
   * straight by `on`/`off` — otherwise underground-ON would set it fully
   * opaque (`opacity = 1`), erasing the "this line isn't running trains
   * yet" ghost look the deck was deliberately built with (finding 6b).
   * Exercised for real since 2026-08-04 (MRT Orange, MRT Purple Phase 2 —
   * see CLAUDE.md's "Orange/Purple Phase 2 track-only fetch" notes).
   */
  private applyUndergroundMode(): void {
    const on = this.undergroundMode;
    const cap = (opacity: number, m: THREE.Material) =>
      m.userData?.preRevenue ? Math.min(opacity, PRE_REVENUE_OPACITY) : opacity;
    for (const m of this.subsurfaceMaterials) {
      const opacity = cap(on ? 1 : 0.35, m);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = on;
      m.needsUpdate = true;
    }
    for (const m of this.surfaceMaterials) {
      const opacity = cap(on ? 0.3 : 1, m);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  setUndergroundMode(on: boolean): void {
    if (on === this.undergroundMode) return;
    this.undergroundMode = on;
    this.applyUndergroundMode();
  }

  setShadowsEnabled(on: boolean): void {
    if (!this.renderer) return;
    this.renderer.shadowMap.enabled = on;
    // Three caches compiled programs per material; flipping shadowMap.enabled
    // requires a recompile or existing materials keep their old defines.
    this.renderer.shadowMap.needsUpdate = true;
    this.scene?.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
  }

  /** Show/hide one line's track + stations. Vehicles are hidden separately by
   *  VehicleManager, which owns their instance counts. */
  setLineVisible(index: number, visible: boolean): void {
    const group = this.lineGroups[index];
    if (group) group.visible = visible;
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.renderer || !this.scene) return;
    this.beforeRender?.();
    // maplibre-gl v5+ passes an args object; `defaultProjectionData.mainMatrix`
    // is the mercator(0..1)->clip matrix that v4 handed over as `matrix`.
    const matrix = options.defaultProjectionData.mainMatrix;
    this.projection.fromArray(matrix as unknown as number[]).multiply(this.originMatrix);
    this.camera.projectionMatrix = this.projection;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const m of this.lineMaterials) m.resolution.copy(size);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.scene = null;
    this.lineMaterials = [];
    this.lineGroups = [];
    this.surfaceMaterials = [];
    this.subsurfaceMaterials = [];
    // Cleared along with the material buckets it drives — a re-add starts
    // onAdd()'s applyUndergroundMode() from a clean flag instead of seeding
    // a freshly rebuilt scene from a stale prior value.
    this.undergroundMode = false;
    this.sunLight = null;
    this.ambientLight = null;
    // The GL context belongs to MapLibre — dispose Three's wrapper only.
    this.renderer?.dispose();
    this.renderer = null;
  }
}
