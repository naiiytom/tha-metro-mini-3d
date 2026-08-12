#!/usr/bin/env node
/**
 * One-shot calibration for src/map/nightLift.ts's shading model.
 *
 * DELIBERATELY UNREGISTERED — there is no npm script for this. The browser
 * acceptance harnesses were removed on 2026-08-09 by explicit decision and
 * this does not reinstate one: it is a manual instrument, run by a human when
 * the renderer, the material type or the Three version changes, to re-derive
 * the constant that the pure Vitest gate then pins.
 *
 * It renders a known albedo under a known palette in the real scene and reads
 * the pixel back, so the pure model is checked against the actual shader
 * rather than against first principles. Getting this wrong is exactly how the
 * previous legibility harness failed: it sampled the unlit `Line2`
 * centerline instead of the lit `MeshLambertMaterial` track deck, so its
 * numbers meant nothing for the entire time it existed.
 *
 * What this script samples: a flat, upward-facing `MeshLambertMaterial` quad
 * that IT adds to the real Three scene (`NetworkLayer`'s `scene`, reached via
 * `map.getLayer("network-3d").implementation`) at a known local ENU position,
 * high above every other object in the network (so nothing else in the scene
 * can occlude it). It is never the Line2 centerline, never a borrowed piece
 * of existing track/station geometry — the mesh is newly constructed and its
 * identity (`mesh.name`, `mesh.uuid`, `material.color`) is logged and can be
 * cross-checked against the printed pixel. As a second, independent check the
 * script also reads the SAME screen pixel with the quad absent (whatever the
 * sky/basemap renders there) immediately before adding it, so the report
 * shows a real before/after colour change consistent with the quad's own
 * albedo — not a coincidental hit on unrelated geometry.
 *
 * The exact screen pixel to read is computed from `layer.projection` (the
 * real per-frame local-ENU -> clip-space matrix `NetworkLayer.render()`
 * builds each frame from MapLibre's own matrix), not guessed from a camera
 * pose — so it is correct regardless of exact zoom/pitch framing.
 *
 * Usage:  npm run dev    (in another terminal)
 *         node tools/calibrate-night-lift.mjs
 */
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";

const EDGE =
  process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/**
 * `npm run dev` silently falls back to 5174/5175/... if 5173 is already held
 * by a stale server from another worktree/session, and a hardcoded URL then
 * silently tests the WRONG build with no error (documented false-negative,
 * CLAUDE.md's MRT Blue weekend-calendar-split notes). Ask the OS what is
 * actually LISTENING on the Vite range instead of assuming 5173.
 */
function findDevServerPort() {
  let out;
  try {
    out = execSync("netstat -ano").toString();
  } catch (err) {
    throw new Error(`could not run netstat to find the dev server port: ${err.message}`);
  }
  const listening = new Set();
  const re = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING/gim;
  let m;
  while ((m = re.exec(out))) listening.add(Number(m[1]));
  for (let port = 5173; port <= 5180; port++) {
    if (listening.has(port)) return port;
  }
  return null;
}

const port = process.argv[2] ? Number(process.argv[2]) : findDevServerPort();
if (!port) {
  console.error(
    "FATAL: no listener found on localhost:5173-5180. Start `npm run dev` in another " +
      "terminal first, or pass the port explicitly: node tools/calibrate-night-lift.mjs <port>.",
  );
  process.exit(1);
}
const URL = `http://localhost:${port}/`;
console.log(`Using dev server at ${URL} (found via netstat, not assumed)`);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--window-size=1600,1000", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on("console", (msg) => {
  if (["error", "warn"].includes(msg.type())) console.log(`[console.${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

  // Give the engine + first network-3d layer add time to settle (mirrors
  // tools/screenshot.mjs's own wait for the same reason: tiles + Three scene
  // both need a beat after networkidle2).
  await page.waitForFunction(() => typeof window.__map !== "undefined", { timeout: 20_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4_000));

  const hasMap = await page.evaluate(() => !!window.__map);
  if (!hasMap) {
    console.error(
      "FATAL: window.__map is not present. This is only exposed in a dev build " +
        "(src/components/MapContainer.tsx) — confirm the URL above is really the dev " +
        "server (not a production preview) and that the app finished mounting.",
    );
    process.exit(1);
  }

  const hasLayer = await page.evaluate(() => {
    const l = window.__map.getLayer("network-3d");
    return !!(l && l.implementation);
  });
  if (!hasLayer) {
    console.error(
      'FATAL: map.getLayer("network-3d").implementation is not present — the Three.js ' +
        "network layer has not been added yet. Increase the settle wait and retry.",
    );
    process.exit(1);
  }

  // Everything from here runs inside the page: it needs live access to the
  // real NetworkLayer instance, its Three.js scene/renderer, and the exact
  // pure functions (sunDirection/skyPalette/predictRendered/nightLift) this
  // model is being checked against — imported live from the dev server so
  // there is no risk of the Node-side script drifting from what's actually
  // in the file under test.
  const result = await page.evaluate(async () => {
    const map = window.__map;
    const layer = map.getLayer("network-3d").implementation;
    const gl = layer.renderer.getContext();

    const { sunDirection, skyPalette } = await import("/src/map/sun.ts");
    const { predictRendered, SHADING_SCALE } = await import("/src/map/nightLift.ts");
    const { ORIGIN_LNG_LAT } = await import("/src/map/coordinates.ts");

    // Same epochs nightLift.test.ts uses (Bangkok local noon / 02:00,
    // UTC+7 fixed), so the calibration is checked at the exact palettes the
    // pinned Vitest gate exercises.
    const NOON = Date.UTC(2026, 7, 15, 5, 0, 0);
    const DEEP_NIGHT = Date.UTC(2026, 7, 14, 19, 0, 0);

    function paletteAt(epochMs) {
      const dir = sunDirection(epochMs);
      return { dir, palette: skyPalette(dir.elevationDeg), ndotl: Math.max(dir.up, 0.05) };
    }

    // Top-down, unrotated view centred on the local-frame origin (Siam) so
    // the calibration quad — placed at local ENU (0,0,alt) — is guaranteed
    // to be in view. The exact pixel is still computed from the real
    // projection matrix below, not assumed to be the canvas centre.
    map.jumpTo({ center: ORIGIN_LNG_LAT, zoom: 13, pitch: 0, bearing: 0 });

    async function renderFrame() {
      // MapLibre fires 'render' synchronously right after it paints, which
      // is the only safe place to read the WebGL drawing buffer back
      // without `preserveDrawingBuffer` — reading from an arbitrary later
      // task risks the browser having already cleared/swapped it.
      await new Promise((resolve) => {
        map.once("render", () => resolve(undefined));
        map.triggerRepaint();
      });
    }

    await renderFrame();
    await renderFrame(); // second frame: let the jumpTo actually settle

    // Borrow real Three constructors from an existing lit mesh already in
    // the scene, rather than importing "three" a second time under a
    // different module identity — guarantees the exact same THREE build
    // NetworkLayer itself uses.
    let sample = null;
    layer.scene.traverse((o) => {
      if (!sample && o.isMesh && o.material && o.material.isMeshLambertMaterial) sample = o;
    });
    if (!sample) throw new Error("no existing MeshLambertMaterial mesh found in the scene to borrow constructors from");
    const MeshCtor = sample.constructor;
    const MaterialCtor = sample.material.constructor;
    const GeometryCtor = sample.geometry.constructor;
    const AttrCtor = sample.geometry.attributes.position.constructor;

    function projectToPixel(x, y, z) {
      const e = layer.projection.elements; // column-major
      const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      return [Math.round((ndcX * 0.5 + 0.5) * width), Math.round((ndcY * 0.5 + 0.5) * height), width, height];
    }

    function readPixel(px, py) {
      const buf = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return [buf[0], buf[1], buf[2], buf[3]];
    }

    const ALT = 400; // meters — well above the highest elevated track (~22m)
    const HALF = 800; // meters — huge on screen at any sane zoom, avoids AA-edge sampling

    const [px, py, width, height] = projectToPixel(0, 0, ALT);

    // Baseline: same pixel, quad not yet added, for the before/after check.
    await renderFrame();
    const before = readPixel(px, py);

    const positions = new Float32Array([
      -HALF, -HALF, ALT,
      HALF, -HALF, ALT,
      HALF, HALF, ALT,
      -HALF, HALF, ALT,
    ]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const geo = new GeometryCtor();
    geo.setAttribute("position", new AttrCtor(positions, 3));
    geo.setAttribute("normal", new AttrCtor(normals, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const mat = new MaterialCtor({ color: 0xffffff, emissive: 0x000000, emissiveIntensity: 0 });
    mat.side = 2; // THREE.DoubleSide — belt-and-suspenders against a winding mistake
    const mesh = new MeshCtor(geo, mat);
    mesh.name = "calibration-quad";
    mesh.frustumCulled = false;
    layer.scene.add(mesh);

    const cases = [
      { label: "white @ noon", albedo: 0xffffff, when: NOON },
      { label: "white @ deep-night", albedo: 0xffffff, when: DEEP_NIGHT },
      { label: "mid-gray @ deep-night", albedo: 0x808080, when: DEEP_NIGHT },
      { label: "MRT Blue #1964B7 @ noon", albedo: 0x1964b7, when: NOON },
      { label: "MRT Blue #1964B7 @ deep-night", albedo: 0x1964b7, when: DEEP_NIGHT },
      { label: "MRT Purple #660066 @ deep-night", albedo: 0x660066, when: DEEP_NIGHT },
    ];

    // Standard sRGB<->linear transfer functions, matching nightLift.ts's own
    // (unexported) toLinear/toSrgb exactly. Reimplemented here only to
    // decompose predictRendered's output back into its pre-toSrgb linear
    // value, so the implied SHADING_SCALE can be solved for directly in the
    // same linear space the constant actually multiplies in — this is fixed,
    // standard colour-space math, not a reimplementation of anything the
    // calibration is meant to check. `predictRendered` itself (imported live
    // above) is still the sole source of the "predicted" column and is used,
    // unmodified, to cross-validate this decomposition below.
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const toSrgb = (v) => {
      const l = Math.max(0, Math.min(1, v));
      return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    };
    const channels = (hex) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];

    const rows = [];
    for (const c of cases) {
      const { dir, palette, ndotl } = paletteAt(c.when);
      layer.setSun(dir, palette);
      mat.color.setHex(c.albedo);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
      mat.needsUpdate = true;
      await renderFrame();
      const measured = readPixel(px, py);

      // NO_LIFT: emissive term deliberately zero so this isolates
      // SHADING_SCALE's own multiplier (SHADING_SCALE only scales the
      // albedo*light diffuse/ambient term in predictRendered, never the
      // emissive term) rather than mixing in nightLift's whitening logic.
      const predictedHex = predictRendered(c.albedo, palette, ndotl, { emissive: 0, intensity: 0 });
      const predicted = [(predictedHex >> 16) & 0xff, (predictedHex >> 8) & 0xff, predictedHex & 0xff];

      // Decompose in linear space: preScaleLinear[i] is albedo_lin * light_lin
      // BEFORE SHADING_SCALE is applied (i.e. what SHADING_SCALE=1 predicts,
      // pre-toSrgb). impliedScale[i] solves measured = toSrgb(S * preScaleLinear)
      // for S, i.e. the SHADING_SCALE this one channel's real pixel implies.
      const albedoLin = channels(c.albedo).map(toLinear);
      const sunLin = channels(palette.sun).map(toLinear);
      const ambientLin = channels(palette.ambient).map(toLinear);
      const lightLin = sunLin.map(
        (s, i) => ambientLin[i] * palette.ambientIntensity + s * palette.sunIntensity * Math.max(ndotl, 0),
      );
      const preScaleLinear = albedoLin.map((a, i) => a * lightLin[i]);
      // Sanity check: toSrgb(SHADING_SCALE_current * preScaleLinear) should
      // reproduce predictRendered's own output exactly (both are the same
      // formula) — a mismatch here would mean this reimplementation drifted
      // from nightLift.ts, not a real calibration finding.
      const reconstructed = preScaleLinear.map((v) => Math.round(toSrgb(SHADING_SCALE * v) * 255));
      const decompositionOk = reconstructed.every((v, i) => Math.abs(v - predicted[i]) <= 1);

      // Exclude a channel that measured 255: a clamped/saturated real pixel
      // can't distinguish "S=1 was already enough" from "S is much larger
      // than 1", so it is not informative for solving the scale, not a zero
      // or a one. Also exclude a channel predicted near-black (<4/255): at
      // that end of 8-bit sRGB, a 1-count rounding difference is a huge
      // relative ratio for a negligible absolute one — exactly the
      // quantization effect CLAUDE.md already documents for MRT Blue's own
      // livery, not a real calibration signal.
      const impliedScale = preScaleLinear.map((v, i) =>
        v > 1e-6 && measured[i] < 255 && predicted[i] >= 4 ? toLinear(measured[i]) / v : null,
      );

      rows.push({
        label: c.label,
        albedo: c.albedo,
        ndotl,
        measured: measured.slice(0, 3),
        predicted,
        decompositionOk,
        impliedScale,
      });
    }

    return {
      pixel: { px, py, width, height },
      before: before.slice(0, 3),
      outputColorSpace: layer.renderer.outputColorSpace,
      currentShadingScale: SHADING_SCALE,
      rows,
    };
  });

  console.log("\n=== Calibration pixel ===");
  console.log(result.pixel);
  console.log(`renderer.outputColorSpace = ${result.outputColorSpace}`);
  console.log(`Pixel BEFORE the quad was added (baseline, whatever was already there): rgb(${result.before.join(", ")})`);
  console.log(`Current SHADING_SCALE in src/map/nightLift.ts (before this run's edits, if any): ${result.currentShadingScale}`);

  console.log("\n=== measured vs predictRendered (SHADING_SCALE=" + result.currentShadingScale + ") ===");
  const scales = [];
  let anyDecompositionMismatch = false;
  for (const r of result.rows) {
    if (!r.decompositionOk) anyDecompositionMismatch = true;
    console.log(
      `${r.label.padEnd(32)} albedo=#${r.albedo.toString(16).padStart(6, "0")} ndotl=${r.ndotl.toFixed(3)}  ` +
        `measured=rgb(${r.measured.join(",")})  predicted=rgb(${r.predicted.join(",")})  ` +
        `impliedScale=[${r.impliedScale.map((x) => (x === null ? "n/a" : x.toFixed(3))).join(", ")}]` +
        `${r.decompositionOk ? "" : "  [DECOMPOSITION MISMATCH]"}`,
    );
    for (const x of r.impliedScale) if (x !== null && Number.isFinite(x)) scales.push(x);
  }
  if (anyDecompositionMismatch) {
    console.log(
      "\nWARNING: this script's local reimplementation of predictRendered's linear decomposition did " +
        "not reproduce predictRendered's own output for at least one channel. Treat impliedScale as " +
        "untrustworthy until that's resolved — it means the math above drifted from nightLift.ts.",
    );
  }

  const mean = scales.reduce((a, b) => a + b, 0) / scales.length;
  const variance = scales.reduce((a, b) => a + (b - mean) ** 2, 0) / scales.length;
  const stdev = Math.sqrt(variance);
  console.log(
    `\nImplied SHADING_SCALE across ${scales.length} channel samples (linear space, the same space the ` +
      `constant actually multiplies in): mean=${mean.toFixed(4)} stdev=${stdev.toFixed(4)}`,
  );
  console.log(
    stdev / mean < 0.1
      ? "-> consistent across channels/samples: this is a real calibration candidate for SHADING_SCALE."
      : "-> NOT consistent across channels/samples (stdev >= 10% of mean): do not pin a single scale " +
          "factor from this data without investigating why it varies.",
  );
} finally {
  await browser.close();
}
