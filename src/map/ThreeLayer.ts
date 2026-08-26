import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import type { NetworkData } from "../types";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import { buildHighlightLine, type RouteHighlightSpan } from "./routeHighlight";
import { buildSkyDome, type SkyDome } from "./skyDome";
import { PRE_REVENUE_OPACITY, buildStationMarkers, buildTrackDeck, buildTrackLine } from "./trackGeometry";
import { nightLift } from "./nightLift";
import { materialAlbedo } from "./materialAlbedo";
import { windowGlowOpacity } from "./windowGlow";
import type { ViewProjection } from "./screenProject";
import type { SkyPalette } from "./sun";
import type { VehicleManager } from "./VehicleManager";

/** `applyUndergroundMode()`'s opacity for a sub-surface material when the
 *  mode is OFF (the app's default) — its worst case across both states,
 *  fed to `nightLift()` so the emissive floor is solved for real. */
const SUBSURFACE_BACKGROUNDED_OPACITY = 0.35;
/** Same, for a surface material when the mode is ON. */
const SURFACE_BACKGROUNDED_OPACITY = 0.3;

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
  /** Every Lambert material the night floor applies to — track decks, station
   *  markers and vehicles. Orthogonal to the two elevation bands above: those
   *  own opacity, this owns emissive, and the two must never write each
   *  other's property (the same split styleBinding.ts enforces for the
   *  basemap). The Line2 centerlines are deliberately absent — LineMaterial is
   *  unlit, so it already renders at full colour and needs no floor. */
  private litMaterials: THREE.MeshLambertMaterial[] = [];
  /**
   * Worst-case opacity each lit material can render at across BOTH
   * underground-mode states — populated in `indexMaterialsByBand()`, fed to
   * `nightLift()` in `setSun()` so the emissive floor is solved against the
   * translucent state too, not just the always-opaque assumption the model
   * had before code review 2026-08-15. A material absent from this map (a
   * vehicle, which `applyUndergroundMode()` never touches) is always fully
   * opaque, hence the `?? 1` at every lookup site rather than a default entry.
   */
  private litMaterialWorstOpacity = new WeakMap<THREE.MeshLambertMaterial, number>();
  private undergroundMode = false;
  private map3D = true;
  private shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial> | null = null;
  private skyDome: SkyDome | null = null;
  /** Planned-route highlight, rebuilt wholesale on every plan change. Kept in
   *  its own group and its own material list so it never enters the
   *  underground-band or night-lift passes — it is an unlit overlay, not
   *  network geometry. */
  private highlightGroup: THREE.Group | null = null;
  private highlightMaterials: LineMaterial[] = [];

  /**
   * The mercator->clip matrix from the most recent render, copied (not
   * aliased — MapLibre may reuse its own array) so click hit-testing can
   * project candidates exactly as they were drawn, altitude included.
   * See src/map/screenProject.ts and issue #25.
   */
  private mainMatrix = new Float64Array(16);
  private hasMainMatrix = false;

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
    // First into the scene and renderOrder -1: the sky composites UNDER the
    // network, and its horizon discard keeps it off the basemap (see
    // skyDome.ts for the §3A.4 reasoning).
    const sky = buildSkyDome();
    scene.add(sky.mesh);
    this.skyDome = sky;
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

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    shadowCatcher.position.set(0, 0, 0);
    shadowCatcher.receiveShadow = true;
    shadowCatcher.visible = false;
    // ShadowMaterial sets `transparent = true` by default but leaves
    // `depthWrite`/`depthTest` at Material's own default (true/true) —
    // neither is a no-op here. The catcher sits at z=0, coplanar with
    // at-grade track and nearer the camera than every underground run
    // (rendered at -12 to -25 m). `applyUndergroundMode()`'s default (OFF)
    // state deliberately renders sub-surface track translucent with
    // depthWrite=false so it "reads as beneath" without real depth interop
    // with MapLibre's tiles (see that method's own doc comment). If the
    // catcher kept depthWrite=true, it would write depth at those pixels
    // and the translucent tunnel track drawn afterward — itself not
    // writing depth — would still depthTest against what the catcher wrote
    // and get incorrectly hidden behind it, defeating the whole point of
    // the see-through underground view. depthWrite: false is the standard
    // fix for a transparent receiver that must not falsely occlude
    // geometry drawn after it. depthTest stays at its default (true)
    // on purpose, unlike skyDome.ts's sky mesh: the catcher's job is to be
    // properly occluded BY opaque foreground Three geometry (e.g. an
    // elevated viaduct deck passing between the camera and the ground
    // plane), not to sit permanently behind everything the way the sky
    // does — so only depthWrite is the bug here, not depthTest too.
    shadowCatcher.material.depthWrite = false;
    scene.add(shadowCatcher);
    this.shadowCatcher = shadowCatcher;

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
    if (this.vehicles) scene.add(...this.vehicles.meshes, ...this.vehicles.glowMeshes);
    for (const mesh of this.vehicles?.meshes ?? []) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshLambertMaterial) this.litMaterials.push(m);
      }
    }
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
  /**
   * `elevationDeg` is the EFFECTIVE elevation that produced `palette`
   * (`effectiveElevationDeg(themeMode, dir.elevationDeg)` in MapContainer),
   * not necessarily `dir`'s own real solar elevation — the two diverge
   * whenever the theme mode is pinned to Light or Dark rather than Auto.
   * `nightLift()`'s day gate needs the elevation that actually decided
   * `palette`'s day/night blend, or a Dark-pinned session at real noon would
   * wrongly suppress every lift (real elevation says day, palette says
   * night). Found in code review 2026-08-15, alongside the day-gate fix
   * itself — see `nightLift.ts`'s `CONTRAST_REFERENCE` comment.
   */
  setSun(
    dir: { east: number; north: number; up: number },
    palette: SkyPalette,
    elevationDeg: number,
  ): void {
    if (!this.sunLight || !this.ambientLight) return;
    const R = 10_000;
    this.sunLight.position.set(dir.east * R, dir.north * R, Math.max(dir.up, 0.05) * R);
    this.sunLight.color.setHex(palette.sun);
    this.sunLight.intensity = palette.sunIntensity;
    this.ambientLight.color.setHex(palette.ambient);
    this.ambientLight.intensity = palette.ambientIntensity;

    // Per-material night floor. Runs at UI rate with setSun, never per frame:
    // it is O(materials), ~50 objects, and the palette only moves as fast as
    // the sun does.
    const ndotl = Math.max(dir.up, 0.05);
    for (const m of this.litMaterials) {
      // Solve against this material's WORST-CASE opacity (its band's
      // backgrounded state, or 1 for a vehicle — see the field's own
      // comment), not the frame's current opacity: `applyUndergroundMode()`
      // and `setSun()` run independently, so the lift must already hold for
      // whichever state the underground toggle is in when it's NEXT flipped,
      // not just the one active right now.
      const opacity = this.litMaterialWorstOpacity.get(m) ?? 1;
      const lift = nightLift(materialAlbedo(m), palette, ndotl, elevationDeg, opacity);
      m.emissive.setHex(lift.emissive);
      m.emissiveIntensity = lift.intensity;
    }
    // Independent of the per-material lift loop above on purpose — see
    // windowGlow.ts's doc comment for why a train's shell converging with
    // the track under it needs a genuinely separate fix, not a bigger floor.
    this.vehicles?.setNightGlow(windowGlowOpacity(elevationDeg));
  }

  /** Sky colours follow the same solar elevation the key light does. Called
   *  at UI rate from MapContainer, never per frame. */
  setSkyElevation(elevationDeg: number): void {
    this.skyDome?.setElevation(elevationDeg);
  }

  /** Keep the dome centred on the viewer — scene coordinates are local ENU
   *  meters around Siam and the network spans ~50 km. */
  setSkyCenter(east: number, north: number): void {
    this.skyDome?.setCenter(east, north);
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
        const underground = obj.userData?.structure === "underground";
        const band = underground ? this.subsurfaceMaterials : this.surfaceMaterials;
        band.push(...mats);
        const worstOpacity = underground ? SUBSURFACE_BACKGROUNDED_OPACITY : SURFACE_BACKGROUNDED_OPACITY;
        for (const m of mats) {
          if (m instanceof THREE.MeshLambertMaterial) {
            this.litMaterials.push(m);
            this.litMaterialWorstOpacity.set(m, worstOpacity);
          }
        }
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
      const opacity = cap(on ? 1 : SUBSURFACE_BACKGROUNDED_OPACITY, m);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = on;
      m.needsUpdate = true;
    }
    for (const m of this.surfaceMaterials) {
      const opacity = cap(on ? SURFACE_BACKGROUNDED_OPACITY : 1, m);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    if (this.shadowCatcher) {
      this.shadowCatcher.visible = on ? false : (this.renderer?.shadowMap.enabled ?? false);
    }
  }

  setUndergroundMode(on: boolean): void {
    if (on === this.undergroundMode) return;
    this.undergroundMode = on;
    this.applyUndergroundMode();
  }

  /** The current view for screen-space hit-testing, or null before the first
   *  frame has rendered. */
  viewProjection(): ViewProjection | null {
    if (!this.hasMainMatrix || !this.renderer) return null;
    const canvas = this.renderer.domElement;
    return {
      matrix: this.mainMatrix,
      widthPx: canvas.clientWidth || canvas.width,
      heightPx: canvas.clientHeight || canvas.height,
    };
  }

  setShadowsEnabled(on: boolean): void {
    if (!this.renderer) return;
    this.renderer.shadowMap.enabled = on;
    if (this.shadowCatcher) {
      this.shadowCatcher.visible = on && !this.undergroundMode && this.map3D;
    }
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

  /** Flatten all 3D geometry (tracks, viaducts, trains, station markers) onto
   *  the ground plane (z=0) in 2D mode, or restore 3D elevation scaling. */
  setMap3D(is3D: boolean): void {
    this.map3D = is3D;
    const zScale = is3D ? MERC_PER_METER : 0;
    this.originMatrix = new THREE.Matrix4()
      .makeTranslation(ORIGIN_MERC.x, ORIGIN_MERC.y, 0)
      .scale(new THREE.Vector3(MERC_PER_METER, -MERC_PER_METER, zScale));
    if (this.shadowCatcher) {
      this.shadowCatcher.visible = is3D && !this.undergroundMode && (this.renderer?.shadowMap.enabled ?? false);
    }
  }

  /** Show/hide one line's track + stations. Vehicles are hidden separately by
   *  VehicleManager, which owns their instance counts. */
  setLineVisible(index: number, visible: boolean): void {
    const group = this.lineGroups[index];
    if (group) group.visible = visible;
  }

  /** Draw one white overlay per planned ride leg. Passing an empty array
   *  clears the highlight — which is what closing the panel does. */
  setRouteHighlight(spans: RouteHighlightSpan[]): void {
    this.clearRouteHighlight();
    if (!this.scene || spans.length === 0) return;
    const group = new THREE.Group();
    group.name = "route-highlight";
    for (const span of spans) {
      const line = this.data.lines[span.routeIdx];
      if (!line) continue;
      const built = buildHighlightLine(line, span.fromArcM, span.toArcM);
      if (!built) continue;
      group.add(built.line);
      this.highlightMaterials.push(built.material);
    }
    if (group.children.length === 0) return;
    this.scene.add(group);
    this.highlightGroup = group;
  }

  private clearRouteHighlight(): void {
    if (this.highlightGroup) {
      this.scene?.remove(this.highlightGroup);
      this.highlightGroup.traverse((obj) => {
        if (obj instanceof Line2) obj.geometry.dispose();
      });
      this.highlightGroup = null;
    }
    for (const m of this.highlightMaterials) m.dispose();
    this.highlightMaterials = [];
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.renderer || !this.scene) return;
    this.beforeRender?.();
    // maplibre-gl v5+ passes an args object; `defaultProjectionData.mainMatrix`
    // is the mercator(0..1)->clip matrix that v4 handed over as `matrix`.
    const matrix = options.defaultProjectionData.mainMatrix;
    this.mainMatrix.set(matrix as unknown as ArrayLike<number>);
    this.hasMainMatrix = true;
    this.projection.fromArray(matrix as unknown as number[]).multiply(this.originMatrix);
    this.camera.projectionMatrix = this.projection;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const m of this.lineMaterials) m.resolution.copy(size);
    for (const m of this.highlightMaterials) m.resolution.copy(size);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.clearRouteHighlight();
    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.skyDome?.dispose();
    this.skyDome = null;
    this.shadowCatcher = null;
    this.scene = null;
    this.lineMaterials = [];
    this.lineGroups = [];
    this.surfaceMaterials = [];
    this.subsurfaceMaterials = [];
    this.litMaterials = [];
    // Cleared along with the material buckets it drives — a re-add starts
    // onAdd()'s applyUndergroundMode() from a clean flag instead of seeding
    // a freshly rebuilt scene from a stale prior value.
    this.undergroundMode = false;
    this.hasMainMatrix = false;
    this.sunLight = null;
    this.ambientLight = null;
    // The GL context belongs to MapLibre — dispose Three's wrapper only.
    this.renderer?.dispose();
    this.renderer = null;
  }
}
