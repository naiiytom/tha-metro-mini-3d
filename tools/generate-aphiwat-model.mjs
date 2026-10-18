/**
 * Procedural 3D landmark generator for Krung Thep Aphiwat Central Terminal
 * (Bang Sue Grand Station / สถานีกลางกรุงเทพอภิวัฒน์).
 *
 * Generates a stylized low-poly glTF binary asset (.glb) with:
 * - Sweeping unified gull-wing / wave-curved cantilevered roof spanning 540 m × 196 m.
 * - Longitudinal skylight ribbons and transverse steel arch structural ribs.
 * - 6 island platform decks on Floor 2 (z = 0) flanking the SRT Dark Red (y = +31.5 m)
 *   and SRT Light Red (y = -31.5 m) track alignments without collision.
 * - Full-height concourse podium (Floor 1, z = -15 m to -1.5 m) with glazed curtain walls
 *   and inclined V-strut colonnades along the East and South drop-off plazas.
 * - Iconic circular Royal Clock (with the Thai numeral ๙ at 9 o'clock) suspended
 *   beneath the grand entrance arch canopy.
 *
 * Run: node tools/generate-aphiwat-model.mjs
 * Output: public/models/krung-thep-aphiwat.glb
 */

import path from "node:path";
import * as THREE from "three";
import { createSharedMaterials, exportGlb } from "./generate-landmark-models.mjs";

function gullWingRoofZ(y) {
  const absY = Math.abs(y);
  // Central vaulted hall (|y| <= 28): rises to z = 21.0 m at center
  if (absY <= 28) {
    return 21.0 - 4.2 * (absY / 28) ** 2;
  }
  // Side platform wings (28 < |y| <= 68): secondary wave arch peaking at z = 17.6 m around |y| = 42
  if (absY <= 68) {
    const t = (absY - 28) / 40;
    return 16.8 + Math.sin(t * Math.PI) * 1.4 - t * 6.8;
  }
  // Cantilevered drop-off eaves (68 < |y| <= 98): gentle upward gull-wing flare at tip
  const t = (absY - 68) / 30;
  return 10.0 - t * 3.8 + t * t * 1.6;
}

export function buildKrungThepAphiwatScene() {
  const root = new THREE.Group();
  root.name = "KrungThepAphiwatCentralTerminal";

  const {
    matRoof,
    matRoofRib,
    matGlass,
    matConcrete,
    matPlinth,
    matPlatform,
    matYellowStrip,
    matSteel,
    matSrtRed,
    matClockDial,
    matClockGold,
    matClockMark,
  } = createSharedMaterials();

  function extrudeProfileAlongX(shape, length, material) {
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
    });
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const yShape = pos.getX(i);
      const zShape = pos.getY(i);
      const xExtrude = pos.getZ(i);
      pos.setXYZ(i, xExtrude - length / 2, yShape, zShape);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // =========================================================================
  // 1. Unified Sweeping Gull-Wing Roof (540 m × 196 m, max z = 21.8 m)
  // =========================================================================
  const roofGroup = new THREE.Group();
  roofGroup.name = "RoofCanopies";

  const roofLength = 540;
  const roofHalfW = 98;
  const roofSegments = 48;
  const roofThickness = 0.75;

  const roofShape = new THREE.Shape();
  for (let i = 0; i <= roofSegments; i++) {
    const y = -roofHalfW + (i / roofSegments) * (roofHalfW * 2);
    const z = gullWingRoofZ(y);
    if (i === 0) roofShape.moveTo(y, z);
    else roofShape.lineTo(y, z);
  }
  for (let i = roofSegments; i >= 0; i--) {
    const y = -roofHalfW + (i / roofSegments) * (roofHalfW * 2);
    const z = gullWingRoofZ(y) - roofThickness;
    roofShape.lineTo(y, z);
  }
  roofShape.closePath();

  const mainRoofMesh = extrudeProfileAlongX(roofShape, roofLength, matRoof);
  mainRoofMesh.name = "MainGullWingRoof";
  roofGroup.add(mainRoofMesh);

  // Longitudinal skylight ribbons along the central crown and side vaults
  for (const [skyCenterY, skyHalfW, skyName] of [
    [0, 6, "CenterSkylight"],
    [-31.5, 4.5, "EastSkylight"],
    [31.5, 4.5, "WestSkylight"],
  ]) {
    const skyShape = new THREE.Shape();
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const y = skyCenterY - skyHalfW + (i / segs) * (skyHalfW * 2);
      const z = gullWingRoofZ(y) + 0.18;
      if (i === 0) skyShape.moveTo(y, z);
      else skyShape.lineTo(y, z);
    }
    for (let i = segs; i >= 0; i--) {
      const y = skyCenterY - skyHalfW + (i / segs) * (skyHalfW * 2);
      const z = gullWingRoofZ(y) + 0.04;
      skyShape.lineTo(y, z);
    }
    skyShape.closePath();
    const skyMesh = extrudeProfileAlongX(skyShape, roofLength * 0.94, matGlass);
    skyMesh.name = skyName;
    roofGroup.add(skyMesh);
  }

  // SRT crimson-red fascia accent bands along the gull-wing eave edges (y = ±98)
  for (const sign of [-1, 1]) {
    const fasciaGeom = new THREE.BoxGeometry(roofLength, 0.8, 0.9);
    fasciaGeom.translate(0, sign * roofHalfW, gullWingRoofZ(roofHalfW) - 0.2);
    roofGroup.add(new THREE.Mesh(fasciaGeom, matSrtRed));
  }

  // Transverse structural steel arch ribs every 30 m
  for (let rx = -240; rx <= 240; rx += 30) {
    const ribShape = new THREE.Shape();
    for (let i = 0; i <= 24; i++) {
      const y = -roofHalfW + (i / 24) * (roofHalfW * 2);
      const z = gullWingRoofZ(y) + 0.35;
      if (i === 0) ribShape.moveTo(y, z);
      else ribShape.lineTo(y, z);
    }
    for (let i = 24; i >= 0; i--) {
      const y = -roofHalfW + (i / 24) * (roofHalfW * 2);
      const z = gullWingRoofZ(y) - 0.25;
      ribShape.lineTo(y, z);
    }
    ribShape.closePath();
    const ribMesh = extrudeProfileAlongX(ribShape, 1.4, matRoofRib);
    ribMesh.position.x = rx;
    roofGroup.add(ribMesh);
  }

  root.add(roofGroup);

  // =========================================================================
  // 2. Platform Decks (Floor 2, z = -1.2 to 0) with clear y = ±31.5 m track ways
  // =========================================================================
  const platformGroup = new THREE.Group();
  platformGroup.name = "PlatformDecks";

  const deckLength = 500;
  // SRT Light Red runs at y = -31.5 m; SRT Dark Red runs at y = +31.5 m.
  // Platforms flank both tracks cleanly without overlapping y = ±31.5 m.
  const platformDefs = [
    { y: -44, w: 12, name: "Platform_East_Outer_SRT_LightRed" },
    { y: -19, w: 12, name: "Platform_East_Inner_SRT_LightRed" },
    { y: -5.5, w: 8, name: "Platform_Intercity_East" },
    { y: 5.5, w: 8, name: "Platform_Intercity_West" },
    { y: 19, w: 12, name: "Platform_West_Inner_SRT_DarkRed" },
    { y: 44, w: 12, name: "Platform_West_Outer_SRT_DarkRed" },
  ];

  for (const p of platformDefs) {
    const slabGeom = new THREE.BoxGeometry(deckLength, p.w, 1.2);
    slabGeom.translate(0, p.y, -0.6);
    const slabMesh = new THREE.Mesh(slabGeom, matPlatform);
    slabMesh.name = p.name;
    platformGroup.add(slabMesh);

    for (const edgeSign of [-1, 1]) {
      const edgeY = p.y + edgeSign * (p.w / 2 - 0.35);
      const stripGeom = new THREE.BoxGeometry(deckLength, 0.4, 0.05);
      stripGeom.translate(0, edgeY, 0.02);
      platformGroup.add(new THREE.Mesh(stripGeom, matYellowStrip));
    }
  }

  // Sub-track viaduct deck slabs beneath track channels (z = -1.6 to -0.8)
  for (const [trackY, trackW] of [
    [-31.5, 13],
    [0, 3],
    [31.5, 13],
  ]) {
    const bedGeom = new THREE.BoxGeometry(deckLength, trackW, 0.8);
    bedGeom.translate(0, trackY, -1.2);
    platformGroup.add(new THREE.Mesh(bedGeom, matPlinth));
  }

  root.add(platformGroup);

  // =========================================================================
  // 3. Concourse Hall & Base Podium (Floor 1, z = -15 m to -1.5 m)
  // =========================================================================
  const concourseGroup = new THREE.Group();
  concourseGroup.name = "ConcoursePodium";

  const concourseBody = new THREE.BoxGeometry(470, 132, 13.5);
  concourseBody.translate(0, 0, -8.25);
  concourseGroup.add(new THREE.Mesh(concourseBody, matConcrete));

  const groundPlinth = new THREE.BoxGeometry(500, 168, 0.6);
  groundPlinth.translate(0, 0, -15.3);
  concourseGroup.add(new THREE.Mesh(groundPlinth, matPlinth));

  // East & West glazed concourse curtain walls (y = ±66.3)
  for (const sign of [-1, 1]) {
    const glazing = new THREE.BoxGeometry(450, 0.6, 11.0);
    glazing.translate(0, sign * 66.3, -8.2);
    concourseGroup.add(new THREE.Mesh(glazing, matGlass));
  }

  // Inclined V-strut steel tree columns supporting the East & West gull-wing eaves
  for (let cx = -210; cx <= 210; cx += 35) {
    for (const side of [-1, 1]) {
      const baseY = side * 78;
      for (const splay of [-1, 1]) {
        const strut = new THREE.CylinderGeometry(0.45, 0.55, 24.5, 8);
        strut.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(strut, matSteel);
        mesh.position.set(cx + splay * 3.5, baseY + side * 4, -3.5);
        mesh.rotation.x = side * 0.32;
        mesh.rotation.y = splay * 0.18;
        concourseGroup.add(mesh);
      }
    }
  }

  // Viaduct portal piers at North & South track approaches
  for (const px of [-258, -242, 242, 258]) {
    for (const py of [-44, -19, 0, 19, 44]) {
      const pierGeom = new THREE.BoxGeometry(4.0, 3.5, 13.5);
      pierGeom.translate(px, py, -8.25);
      concourseGroup.add(new THREE.Mesh(pierGeom, matConcrete));
    }
  }

  root.add(concourseGroup);

  // =========================================================================
  // 4. North & South Gable End Portals (with open track bays at y = ±31.5 m)
  // =========================================================================
  const portalGroup = new THREE.Group();
  portalGroup.name = "GablePortals";

  for (const sign of [-1, 1]) {
    const gx = sign * 260;
    // Upper glazed arch curtain above train clearance (z = 8.5 m to 19.5 m)
    const upperCurtain = new THREE.BoxGeometry(0.8, 128, 11.0);
    upperCurtain.translate(gx, 0, 14.0);
    portalGroup.add(new THREE.Mesh(upperCurtain, matGlass));

    // Vertical glazed screens over platform islands (leaving y = ±31.5 m open for trains)
    for (const [py, pw] of [
      [-52, 20],
      [-12, 18],
      [12, 18],
      [52, 20],
    ]) {
      const pillarScreen = new THREE.BoxGeometry(0.8, pw, 8.5);
      pillarScreen.translate(gx, py, 4.25);
      portalGroup.add(new THREE.Mesh(pillarScreen, matGlass));
    }

    // Steel portal arch header beam spanning across the gable facade
    const portalHeader = new THREE.BoxGeometry(1.8, 136, 1.2);
    portalHeader.translate(gx, 0, 8.5);
    portalGroup.add(new THREE.Mesh(portalHeader, matSteel));
  }

  root.add(portalGroup);

  // =========================================================================
  // 5. Grand Entrance Portico & Suspended Royal Clock (with Thai numeral ๙)
  // =========================================================================
  const landmarkGroup = new THREE.Group();
  landmarkGroup.name = "EastFacadeAndRoyalClock";

  // Station name fascia backing board beneath the East central arch
  const signBacking = new THREE.BoxGeometry(64, 0.8, 2.8);
  signBacking.translate(0, -82.0, 7.2);
  landmarkGroup.add(new THREE.Mesh(signBacking, matSteel));

  const signCrimsonTrim = new THREE.BoxGeometry(66, 0.9, 0.45);
  signCrimsonTrim.translate(0, -82.1, 5.7);
  landmarkGroup.add(new THREE.Mesh(signCrimsonTrim, matSrtRed));

  // --- Royal Clock (Suspended under the grand roof arch at y = -82.5 m, z = 12.2 m) ---
  const clockGroup = new THREE.Group();
  clockGroup.name = "RoyalClock";

  const clockRadius = 3.8;
  const clockY = -82.5;
  const clockZ = 12.2;

  // Twin steel suspension struts connecting clock housing to the gull-wing roof arch
  for (const sx of [-1.4, 1.4]) {
    const hanger = new THREE.CylinderGeometry(0.22, 0.22, 4.2, 8);
    hanger.rotateX(Math.PI / 2);
    hanger.translate(sx, clockY + 0.3, clockZ + clockRadius + 1.4);
    clockGroup.add(new THREE.Mesh(hanger, matSteel));
  }

  const bezelGeom = new THREE.TorusGeometry(clockRadius, 0.35, 12, 32);
  bezelGeom.rotateX(Math.PI / 2);
  bezelGeom.translate(0, clockY, clockZ);
  clockGroup.add(new THREE.Mesh(bezelGeom, matClockGold));

  const innerBezelGeom = new THREE.TorusGeometry(clockRadius * 0.86, 0.12, 8, 32);
  innerBezelGeom.rotateX(Math.PI / 2);
  innerBezelGeom.translate(0, clockY - 0.05, clockZ);
  clockGroup.add(new THREE.Mesh(innerBezelGeom, matClockGold));

  const dialGeom = new THREE.CylinderGeometry(clockRadius, clockRadius, 0.25, 32);
  dialGeom.rotateX(Math.PI / 2);
  dialGeom.translate(0, clockY - 0.02, clockZ);
  clockGroup.add(new THREE.Mesh(dialGeom, matClockDial));

  for (let h = 0; h < 12; h++) {
    // Position 9 (9 o'clock, angle = 3*PI/2) carries the distinctive gold Thai numeral ๙
    if (h === 9) {
      const numeral9 = new THREE.Group();
      numeral9.name = "ThaiNumeral9";
      const rDist = clockRadius * 0.72;
      const nx = -rDist;
      const nz = clockZ;
      const loopGeom = new THREE.TorusGeometry(0.42, 0.1, 8, 16);
      loopGeom.rotateX(Math.PI / 2);
      loopGeom.translate(nx, clockY - 0.16, nz);
      numeral9.add(new THREE.Mesh(loopGeom, matClockGold));
      const tailGeom = new THREE.BoxGeometry(0.75, 0.12, 0.16);
      tailGeom.rotateY(0.45);
      tailGeom.translate(nx + 0.15, clockY - 0.16, nz + 0.38);
      numeral9.add(new THREE.Mesh(tailGeom, matClockGold));
      clockGroup.add(numeral9);
      continue;
    }

    const angle = (h / 12) * Math.PI * 2;
    const isMajor = h % 3 === 0;
    const markLength = isMajor ? 0.85 : 0.5;
    const markWidth = isMajor ? 0.2 : 0.12;
    const rDist = clockRadius * 0.75;
    const mx = Math.sin(angle) * rDist;
    const mz = Math.cos(angle) * rDist;

    const markGeom = new THREE.BoxGeometry(markWidth, 0.1, markLength);
    markGeom.rotateY(-angle);
    markGeom.translate(mx, clockY - 0.15, clockZ + mz);
    clockGroup.add(new THREE.Mesh(markGeom, matClockMark));
  }

  const hourAngle = (10 / 12) * Math.PI * 2 + (10 / 60) * ((Math.PI * 2) / 12);
  const hourHandGeom = new THREE.BoxGeometry(0.28, 0.1, 2.0);
  hourHandGeom.translate(0, 0, 0.9);
  hourHandGeom.rotateY(-hourAngle);
  hourHandGeom.translate(0, clockY - 0.18, clockZ);
  clockGroup.add(new THREE.Mesh(hourHandGeom, matClockMark));

  const minuteAngle = (10 / 60) * Math.PI * 2;
  const minuteHandGeom = new THREE.BoxGeometry(0.18, 0.1, 2.9);
  minuteHandGeom.translate(0, 0, 1.35);
  minuteHandGeom.rotateY(-minuteAngle);
  minuteHandGeom.translate(0, clockY - 0.22, clockZ);
  clockGroup.add(new THREE.Mesh(minuteHandGeom, matClockMark));

  const centerBossGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.25, 16);
  centerBossGeom.rotateX(Math.PI / 2);
  centerBossGeom.translate(0, clockY - 0.24, clockZ);
  clockGroup.add(new THREE.Mesh(centerBossGeom, matClockGold));

  landmarkGroup.add(clockGroup);
  root.add(landmarkGroup);

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return root;
}

export async function exportKrungThepAphiwatGlb(outputPath) {
  return exportGlb(buildKrungThepAphiwatScene(), outputPath);
}

if (process.argv[1] && process.argv[1].endsWith("generate-aphiwat-model.mjs")) {
  const targetPath = path.resolve("public/models/krung-thep-aphiwat.glb");
  console.log(`Generating Krung Thep Aphiwat 3D landmark model -> ${targetPath}...`);
  exportKrungThepAphiwatGlb(targetPath)
    .then(({ byteLength }) => {
      console.log(`Successfully generated Krung Thep Aphiwat GLB!`);
      console.log(`File size: ${(byteLength / 1024).toFixed(1)} KB (${byteLength} bytes)`);
    })
    .catch((err) => {
      console.error("Failed to generate model:", err);
      process.exit(1);
    });
}
