/**
 * Procedural 3D landmark generator for Krung Thep Aphiwat Central Terminal
 * (Bang Sue Grand Station / สถานีกลางกรุงเทพอภิวัฒน์).
 *
 * Generates an accurate, stylized low-poly glTF binary asset (.glb) with:
 * - Triple barrel-vault arched canopy roofs spanning 380 m along track axis.
 * - Longitudinal ridge skylights and transverse steel arch structural ribs.
 * - Elevated track platform decks (Floor 2, z = 0 relative to deck).
 * - Full-height concourse podium (Floor 1, z = -15 m to -1.5 m) with entrance glazing.
 * - Ground piers and viaduct approach portal bents.
 * - East facade grand entrance portico with canopy cantilever.
 * - Central Royal Clock Tower (z = -15 m to +28 m) with circular clock dial and gold bezel.
 *
 * Run: node tools/generate-aphiwat-model.mjs
 * Output: public/models/krung-thep-aphiwat.glb
 */

import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// Polyfill FileReader for Node.js GLTFExporter binary export
if (typeof globalThis.FileReader === "undefined") {
  class FileReader {
    async readAsArrayBuffer(blob) {
      this.result = await blob.arrayBuffer();
      if (this.onloadend) this.onloadend();
    }
  }
  globalThis.FileReader = FileReader;
}

export function buildKrungThepAphiwatScene() {
  const root = new THREE.Group();
  root.name = "KrungThepAphiwatCentralTerminal";

  // --- Materials ---
  const matRoof = new THREE.MeshStandardMaterial({
    color: 0xd7dfe6,
    roughness: 0.35,
    metalness: 0.35,
    name: "mat_roof_shell",
  });

  const matRoofRib = new THREE.MeshStandardMaterial({
    color: 0x3a4250,
    roughness: 0.5,
    metalness: 0.6,
    name: "mat_roof_ribs",
  });

  const matGlass = new THREE.MeshStandardMaterial({
    color: 0x5d8da8,
    roughness: 0.1,
    metalness: 0.3,
    transparent: true,
    opacity: 0.65,
    name: "mat_glass",
  });

  const matConcrete = new THREE.MeshStandardMaterial({
    color: 0xb5bdc5,
    roughness: 0.8,
    metalness: 0.05,
    name: "mat_concrete",
  });

  const matPlinth = new THREE.MeshStandardMaterial({
    color: 0x6c757d,
    roughness: 0.7,
    metalness: 0.1,
    name: "mat_plinth",
  });

  const matPlatform = new THREE.MeshStandardMaterial({
    color: 0x828a92,
    roughness: 0.85,
    metalness: 0.05,
    name: "mat_platform",
  });

  const matYellowStrip = new THREE.MeshStandardMaterial({
    color: 0xf3c012,
    roughness: 0.5,
    metalness: 0.1,
    name: "mat_yellow_strip",
  });

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    roughness: 0.4,
    metalness: 0.7,
    name: "mat_steel",
  });

  const matClockDial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    emissive: 0x334455,
    emissiveIntensity: 0.4,
    name: "mat_clock_dial",
  });

  const matClockGold = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.3,
    metalness: 0.85,
    name: "mat_clock_gold",
  });

  const matClockMark = new THREE.MeshStandardMaterial({
    color: 0x1a202c,
    roughness: 0.6,
    metalness: 0.2,
    name: "mat_clock_mark",
  });

  // --- Helper: Barrel Vault Extrusion ---
  function createBarrelVaultMesh({
    length,
    width,
    peakHeight,
    baseHeight = 0,
    thickness = 0.6,
    centerY = 0,
    segments = 24,
    material,
  }) {
    const shape = new THREE.Shape();
    // Parabolic / smooth arc profile in local (y, z)
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const y = -width / 2 + t * width;
      const z = peakHeight * (1 - (2 * y / width) ** 2);
      if (i === 0) shape.moveTo(y, z);
      else shape.lineTo(y, z);
    }
    for (let i = segments; i >= 0; i--) {
      const t = i / segments;
      const y = -width / 2 + t * width;
      const z = Math.max(0, peakHeight * (1 - (2 * y / width) ** 2) - thickness);
      shape.lineTo(y, z);
    }
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: length,
      bevelEnabled: false,
    });

    // Map extruded coordinates: (x_shape, y_shape, z_extrude) -> (X_len, Y_width, Z_height)
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      pos.setXYZ(i, z - length / 2, x + centerY, y + baseHeight);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // --- Helper: Skylight Ribbon along Arch Crest ---
  function createSkylightMesh({
    length,
    ribbonWidth,
    archWidth,
    peakHeight,
    baseHeight = 0,
    centerY = 0,
    segments = 8,
  }) {
    const shape = new THREE.Shape();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const y = -ribbonWidth / 2 + t * ribbonWidth;
      const z = peakHeight * (1 - (2 * y / archWidth) ** 2) + 0.15;
      if (i === 0) shape.moveTo(y, z);
      else shape.lineTo(y, z);
    }
    for (let i = segments; i >= 0; i--) {
      const t = i / segments;
      const y = -ribbonWidth / 2 + t * ribbonWidth;
      const z = peakHeight * (1 - (2 * y / archWidth) ** 2) + 0.05;
      shape.lineTo(y, z);
    }
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: length * 0.96,
      bevelEnabled: false,
    });
    const pos = geom.attributes.position;
    const len = length * 0.96;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      pos.setXYZ(i, z - len / 2, x + centerY, y + baseHeight);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, matGlass);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // =========================================================================
  // 1. Triple Barrel-Vault Canopy Roofs
  // =========================================================================
  const roofGroup = new THREE.Group();
  roofGroup.name = "RoofCanopies";

  // Center Arch (Grand Central Platform Hall)
  const centerArch = createBarrelVaultMesh({
    length: 380,
    width: 44,
    peakHeight: 20,
    baseHeight: 0,
    thickness: 0.7,
    centerY: 0,
    segments: 24,
    material: matRoof,
  });
  centerArch.name = "CenterRoofArch";
  roofGroup.add(centerArch);

  // Center Skylight
  const centerSkylight = createSkylightMesh({
    length: 380,
    ribbonWidth: 9,
    archWidth: 44,
    peakHeight: 20,
    baseHeight: 0,
    centerY: 0,
    segments: 8,
  });
  centerSkylight.name = "CenterSkylight";
  roofGroup.add(centerSkylight);

  // East Arch (SRT Light Red & Intercity East)
  const eastArch = createBarrelVaultMesh({
    length: 360,
    width: 38,
    peakHeight: 16.5,
    baseHeight: 0,
    thickness: 0.6,
    centerY: -39,
    segments: 20,
    material: matRoof,
  });
  eastArch.name = "EastRoofArch";
  roofGroup.add(eastArch);

  const eastSkylight = createSkylightMesh({
    length: 360,
    ribbonWidth: 6,
    archWidth: 38,
    peakHeight: 16.5,
    baseHeight: 0,
    centerY: -39,
    segments: 6,
  });
  eastSkylight.name = "EastSkylight";
  roofGroup.add(eastSkylight);

  // West Arch (SRT Dark Red & Intercity West)
  const westArch = createBarrelVaultMesh({
    length: 360,
    width: 38,
    peakHeight: 16.5,
    baseHeight: 0,
    thickness: 0.6,
    centerY: 39,
    segments: 20,
    material: matRoof,
  });
  westArch.name = "WestRoofArch";
  roofGroup.add(westArch);

  const westSkylight = createSkylightMesh({
    length: 360,
    ribbonWidth: 6,
    archWidth: 38,
    peakHeight: 16.5,
    baseHeight: 0,
    centerY: 39,
    segments: 6,
  });
  westSkylight.name = "WestSkylight";
  roofGroup.add(westSkylight);

  // Roof Valley Gutters connecting arches
  const eastGutterGeom = new THREE.BoxGeometry(370, 3, 0.8);
  eastGutterGeom.translate(0, -20.5, 0.4);
  roofGroup.add(new THREE.Mesh(eastGutterGeom, matRoofRib));

  const westGutterGeom = new THREE.BoxGeometry(370, 3, 0.8);
  westGutterGeom.translate(0, 20.5, 0.4);
  roofGroup.add(new THREE.Mesh(westGutterGeom, matRoofRib));

  // Cantilever Eaves over side facades
  const eastEaveGeom = new THREE.BoxGeometry(350, 10, 0.5);
  eastEaveGeom.translate(0, -63, 2.0);
  roofGroup.add(new THREE.Mesh(eastEaveGeom, matRoof));

  const westEaveGeom = new THREE.BoxGeometry(350, 8, 0.5);
  westEaveGeom.translate(0, 62, 2.0);
  roofGroup.add(new THREE.Mesh(westEaveGeom, matRoof));

  // Transverse Arch Ribs (structural steel cadence every 25 m)
  const ribXPositions = [-170, -145, -120, -95, -70, -45, -20, 0, 20, 45, 70, 95, 120, 145, 170];
  for (const rx of ribXPositions) {
    // Center arch rib
    const ribGeom = new THREE.BoxGeometry(1.4, 44.4, 0.8);
    ribGeom.translate(rx, 0, 19.8);
    roofGroup.add(new THREE.Mesh(ribGeom, matRoofRib));

    // East arch rib
    const eastRibGeom = new THREE.BoxGeometry(1.4, 38.4, 0.8);
    eastRibGeom.translate(rx, -39, 16.4);
    roofGroup.add(new THREE.Mesh(eastRibGeom, matRoofRib));

    // West arch rib
    const westRibGeom = new THREE.BoxGeometry(1.4, 38.4, 0.8);
    westRibGeom.translate(rx, 39, 16.4);
    roofGroup.add(new THREE.Mesh(westRibGeom, matRoofRib));
  }

  root.add(roofGroup);

  // =========================================================================
  // 2. Platform Decks & Tracks (Floor 2, z = -1.5 m to 0)
  // =========================================================================
  const platformGroup = new THREE.Group();
  platformGroup.name = "PlatformDecks";

  const deckLength = 370;

  // Platform definitions [centerY, width, name]
  const platformDefs = [
    { y: -36, w: 14, name: "Platform_East_SRT_LightRed" },
    { y: -10, w: 12, name: "Platform_Intercity_East" },
    { y: 10, w: 12, name: "Platform_Intercity_West" },
    { y: 36, w: 14, name: "Platform_West_SRT_DarkRed" },
  ];

  for (const p of platformDefs) {
    // Main concrete deck slab
    const slabGeom = new THREE.BoxGeometry(deckLength, p.w, 1.2);
    slabGeom.translate(0, p.y, -0.6);
    const slabMesh = new THREE.Mesh(slabGeom, matPlatform);
    slabMesh.name = p.name;
    platformGroup.add(slabMesh);

    // Yellow safety tactile edge strips (along both platform edges)
    const yEdgeL = p.y - p.w / 2 + 0.3;
    const yEdgeR = p.y + p.w / 2 - 0.3;

    const stripGeomL = new THREE.BoxGeometry(deckLength, 0.4, 0.05);
    stripGeomL.translate(0, yEdgeL, 0.02);
    platformGroup.add(new THREE.Mesh(stripGeomL, matYellowStrip));

    const stripGeomR = new THREE.BoxGeometry(deckLength, 0.4, 0.05);
    stripGeomR.translate(0, yEdgeR, 0.02);
    platformGroup.add(new THREE.Mesh(stripGeomR, matYellowStrip));
  }

  // Ballast / Track slabs between and alongside platforms
  const ballastDefs = [
    { y: -50, w: 12 },
    { y: -23, w: 10 },
    { y: 0, w: 6 },
    { y: 23, w: 10 },
    { y: 50, w: 12 },
  ];
  for (const b of ballastDefs) {
    const ballastGeom = new THREE.BoxGeometry(deckLength, b.w, 0.8);
    ballastGeom.translate(0, b.y, -1.0);
    platformGroup.add(new THREE.Mesh(ballastGeom, matPlinth));
  }

  root.add(platformGroup);

  // =========================================================================
  // 3. Concourse Hall & Base Podium (Floor 1, z = -15 m to -1.5 m)
  // =========================================================================
  const concourseGroup = new THREE.Group();
  concourseGroup.name = "ConcoursePodium";

  // Massive main concourse hall building
  const concourseBody = new THREE.BoxGeometry(350, 108, 13.5);
  concourseBody.translate(0, 0, -8.25);
  concourseGroup.add(new THREE.Mesh(concourseBody, matConcrete));

  // Ground plinth foundation slab (z = -15.5 to -15.0)
  const groundPlinth = new THREE.BoxGeometry(360, 126, 0.6);
  groundPlinth.translate(0, -3, -15.3);
  concourseGroup.add(new THREE.Mesh(groundPlinth, matPlinth));

  // East Facade Ground Glazing Ribbon (z = -14.5 to -3.0, y = -54.2)
  const eastGlazing = new THREE.BoxGeometry(330, 0.6, 10.5);
  eastGlazing.translate(0, -54.2, -8.5);
  concourseGroup.add(new THREE.Mesh(eastGlazing, matGlass));

  // West Facade Ground Glazing Ribbon (z = -14.5 to -3.0, y = 54.2)
  const westGlazing = new THREE.BoxGeometry(330, 0.6, 10.5);
  westGlazing.translate(0, 54.2, -8.5);
  concourseGroup.add(new THREE.Mesh(westGlazing, matGlass));

  // Concrete support piers extending beyond concourse at track approach portals
  const portalX = [-182, -172, 172, 182];
  const portalY = [-48, -24, 0, 24, 48];
  for (const px of portalX) {
    for (const py of portalY) {
      const pierGeom = new THREE.BoxGeometry(4.0, 3.5, 13.5);
      pierGeom.translate(px, py, -8.25);
      concourseGroup.add(new THREE.Mesh(pierGeom, matConcrete));
    }
  }

  root.add(concourseGroup);

  // =========================================================================
  // 4. North & South Gable End Facades (Train Entrance Portals)
  // =========================================================================
  const portalGroup = new THREE.Group();
  portalGroup.name = "GablePortals";

  for (const sign of [-1, 1]) {
    const gx = sign * 185;

    // Center glazed curtain screen with portal cutout
    const centerScreen = new THREE.BoxGeometry(0.8, 44, 18);
    centerScreen.translate(gx, 0, 9);
    portalGroup.add(new THREE.Mesh(centerScreen, matGlass));

    // East screen
    const eastScreen = new THREE.BoxGeometry(0.8, 38, 15);
    eastScreen.translate(gx, -39, 7.5);
    portalGroup.add(new THREE.Mesh(eastScreen, matGlass));

    // West screen
    const westScreen = new THREE.BoxGeometry(0.8, 38, 15);
    westScreen.translate(gx, 39, 7.5);
    portalGroup.add(new THREE.Mesh(westScreen, matGlass));

    // Structural portal arch frames
    const centerPortalArch = new THREE.BoxGeometry(1.6, 44.8, 1.2);
    centerPortalArch.translate(gx, 0, 18.5);
    portalGroup.add(new THREE.Mesh(centerPortalArch, matSteel));

    const eastPortalArch = new THREE.BoxGeometry(1.6, 38.8, 1.2);
    eastPortalArch.translate(gx, -39, 15.2);
    portalGroup.add(new THREE.Mesh(eastPortalArch, matSteel));

    const westPortalArch = new THREE.BoxGeometry(1.6, 38.8, 1.2);
    westPortalArch.translate(gx, 39, 15.2);
    portalGroup.add(new THREE.Mesh(westPortalArch, matSteel));
  }

  root.add(portalGroup);

  // =========================================================================
  // 5. Grand East Facade, Entrance Portico & Clock Tower
  // =========================================================================
  const landmarkGroup = new THREE.Group();
  landmarkGroup.name = "EastFacadeAndClockTower";

  // Grand Entrance Portico (Drop-off canopy extending east from y = -54 to -72)
  const porticoRoof = new THREE.BoxGeometry(130, 18, 0.8);
  porticoRoof.translate(0, -63, -5.0);
  landmarkGroup.add(new THREE.Mesh(porticoRoof, matRoof));

  // Glazed skylights on portico roof
  const porticoGlass = new THREE.BoxGeometry(110, 10, 0.3);
  porticoGlass.translate(0, -63, -4.6);
  landmarkGroup.add(new THREE.Mesh(porticoGlass, matGlass));

  // V-struts supporting portico
  const strutX = [-50, -25, 25, 50];
  for (const sx of strutX) {
    const strutGeom = new THREE.CylinderGeometry(0.4, 0.4, 10, 8);
    strutGeom.translate(sx, -70, -10);
    landmarkGroup.add(new THREE.Mesh(strutGeom, matSteel));
  }

  // --- Central Clock Tower ---
  // Tower body rising from ground z = -15 m to z = 28 m (total height 43 m)
  const towerBody = new THREE.BoxGeometry(16, 8, 43);
  towerBody.translate(0, -60, 6.5);
  landmarkGroup.add(new THREE.Mesh(towerBody, matConcrete));

  // Tower architectural pilasters & crown stepping
  const towerCrown1 = new THREE.BoxGeometry(17.6, 9.6, 1.5);
  towerCrown1.translate(0, -60, 28.5);
  landmarkGroup.add(new THREE.Mesh(towerCrown1, matSteel));

  const towerCrown2 = new THREE.BoxGeometry(14.0, 7.0, 2.0);
  towerCrown2.translate(0, -60, 30.0);
  landmarkGroup.add(new THREE.Mesh(towerCrown2, matConcrete));

  const towerPinnacle = new THREE.CylinderGeometry(0.3, 0.8, 6.0, 8);
  towerPinnacle.translate(0, -60, 34.0);
  landmarkGroup.add(new THREE.Mesh(towerPinnacle, matClockGold));

  // Decorative vertical recess grooves along tower front
  for (const gx of [-5.5, 5.5]) {
    const grooveGeom = new THREE.BoxGeometry(1.2, 0.4, 34);
    grooveGeom.translate(gx, -64.1, 8.0);
    landmarkGroup.add(new THREE.Mesh(grooveGeom, matSteel));
  }

  // Station identity sign backing panel
  const signBacking = new THREE.BoxGeometry(12, 0.4, 2.5);
  signBacking.translate(0, -64.2, 12.0);
  landmarkGroup.add(new THREE.Mesh(signBacking, matSteel));

  // --- Royal Clock Face (Iconic circular dial facing East) ---
  const clockGroup = new THREE.Group();
  clockGroup.name = "RoyalClock";

  const clockRadius = 4.2;
  const clockY = -64.25;
  const clockZ = 21.0;

  // Outer Gold Bezel
  const bezelGeom = new THREE.TorusGeometry(clockRadius, 0.35, 12, 32);
  bezelGeom.rotateX(Math.PI / 2);
  bezelGeom.translate(0, clockY, clockZ);
  clockGroup.add(new THREE.Mesh(bezelGeom, matClockGold));

  // Inner Bezel accent ring
  const innerBezelGeom = new THREE.TorusGeometry(clockRadius * 0.85, 0.12, 8, 32);
  innerBezelGeom.rotateX(Math.PI / 2);
  innerBezelGeom.translate(0, clockY - 0.05, clockZ);
  clockGroup.add(new THREE.Mesh(innerBezelGeom, matClockGold));

  // White Dial Face Disk
  const dialGeom = new THREE.CylinderGeometry(clockRadius, clockRadius, 0.2, 32);
  dialGeom.rotateX(Math.PI / 2);
  dialGeom.translate(0, clockY - 0.02, clockZ);
  clockGroup.add(new THREE.Mesh(dialGeom, matClockDial));

  // 12-Hour Markers
  for (let h = 0; h < 12; h++) {
    const angle = (h / 12) * Math.PI * 2;
    const isMajor = h % 3 === 0;
    const markLength = isMajor ? 0.9 : 0.55;
    const markWidth = isMajor ? 0.22 : 0.12;

    const rDist = clockRadius * 0.76;
    const mx = Math.sin(angle) * rDist;
    const mz = Math.cos(angle) * rDist;

    const markGeom = new THREE.BoxGeometry(markWidth, 0.1, markLength);
    markGeom.rotateY(-angle);
    markGeom.translate(mx, clockY - 0.15, clockZ + mz);
    clockGroup.add(new THREE.Mesh(markGeom, matClockMark));
  }

  // Clock Hands (Set to ~10:10 classic aesthetic time)
  // Hour hand (pointing to ~10 o'clock)
  const hourAngle = (10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI * 2 / 12);
  const hourHandGeom = new THREE.BoxGeometry(0.3, 0.1, 2.2);
  hourHandGeom.translate(0, 0, 1.0);
  hourHandGeom.rotateY(-hourAngle);
  hourHandGeom.translate(0, clockY - 0.18, clockZ);
  clockGroup.add(new THREE.Mesh(hourHandGeom, matClockMark));

  // Minute hand (pointing to ~2 o'clock / 10 minutes)
  const minuteAngle = (10 / 60) * Math.PI * 2;
  const minuteHandGeom = new THREE.BoxGeometry(0.2, 0.1, 3.2);
  minuteHandGeom.translate(0, 0, 1.5);
  minuteHandGeom.rotateY(-minuteAngle);
  minuteHandGeom.translate(0, clockY - 0.22, clockZ);
  clockGroup.add(new THREE.Mesh(minuteHandGeom, matClockMark));

  // Clock center boss / cap
  const centerBossGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16);
  centerBossGeom.rotateX(Math.PI / 2);
  centerBossGeom.translate(0, clockY - 0.24, clockZ);
  clockGroup.add(new THREE.Mesh(centerBossGeom, matClockGold));

  landmarkGroup.add(clockGroup);
  root.add(landmarkGroup);

  return root;
}

export async function exportKrungThepAphiwatGlb(outputPath) {
  const scene = buildKrungThepAphiwatScene();

  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        try {
          const dir = path.dirname(outputPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const buffer = Buffer.from(gltf);
          fs.writeFileSync(outputPath, buffer);
          resolve({ byteLength: buffer.byteLength, scene });
        } catch (err) {
          reject(err);
        }
      },
      (error) => {
        reject(error);
      },
      { binary: true },
    );
  });
}

// Direct execution CLI
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
