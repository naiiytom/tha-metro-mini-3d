/**
 * Procedural 3D landmark generator for Bangkok metro network stations:
 * 1. Siam (BTS Interchange Hub — dual stacked levels, concourse & skywalks)
 * 2. Suvarnabhumi (Airport Rail Link Terminal & Helmut Jahn Concourse Hall)
 * 3. Makkasan (ARL City Air Terminal, massive podium, skybridge & aerodynamic roof)
 * 4. Hua Lamphong (MRT Blue cavern & historic Neo-Renaissance terminal)
 * 5. Mo Chit (BTS Elevated Hub, side platforms, spine piers & MRT pavilions)
 *
 * Generates accurate, stylized low-poly glTF binary assets (.glb) in public/models/
 *
 * Run: node tools/generate-landmark-models.mjs
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

// =========================================================================
// Common Materials Factory
// =========================================================================

function createSharedMaterials() {
  return {
    matConcrete: new THREE.MeshStandardMaterial({
      color: 0xb5bdc5,
      roughness: 0.8,
      metalness: 0.05,
      name: "mat_concrete",
    }),
    matPlinth: new THREE.MeshStandardMaterial({
      color: 0x6c757d,
      roughness: 0.7,
      metalness: 0.1,
      name: "mat_plinth",
    }),
    matPlatform: new THREE.MeshStandardMaterial({
      color: 0x828a92,
      roughness: 0.85,
      metalness: 0.05,
      name: "mat_platform",
    }),
    matYellowStrip: new THREE.MeshStandardMaterial({
      color: 0xf3c012,
      roughness: 0.5,
      metalness: 0.1,
      name: "mat_yellow_strip",
    }),
    matGlass: new THREE.MeshStandardMaterial({
      color: 0x5d8da8,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.65,
      name: "mat_glass",
    }),
    matSteel: new THREE.MeshStandardMaterial({
      color: 0x2d3748,
      roughness: 0.4,
      metalness: 0.7,
      name: "mat_steel",
    }),
    matRoof: new THREE.MeshStandardMaterial({
      color: 0xd7dfe6,
      roughness: 0.35,
      metalness: 0.35,
      name: "mat_roof",
    }),
    matRoofRib: new THREE.MeshStandardMaterial({
      color: 0x3a4250,
      roughness: 0.5,
      metalness: 0.6,
      name: "mat_roof_rib",
    }),
    matBallast: new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.9,
      metalness: 0.05,
      name: "mat_ballast",
    }),
    matBtsGreen: new THREE.MeshStandardMaterial({
      color: 0x7cb342,
      roughness: 0.4,
      metalness: 0.2,
      name: "mat_bts_green",
    }),
    matBtsTeal: new THREE.MeshStandardMaterial({
      color: 0x008080,
      roughness: 0.4,
      metalness: 0.2,
      name: "mat_bts_teal",
    }),
    matArlCrimson: new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      roughness: 0.4,
      metalness: 0.2,
      name: "mat_arl_crimson",
    }),
    matArlNavy: new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.4,
      metalness: 0.2,
      name: "mat_arl_navy",
    }),
    matMrtBlue: new THREE.MeshStandardMaterial({
      color: 0x1964b7,
      roughness: 0.4,
      metalness: 0.2,
      name: "mat_mrt_blue",
    }),
    matTerracotta: new THREE.MeshStandardMaterial({
      color: 0xb85d43,
      roughness: 0.85,
      metalness: 0.05,
      name: "mat_terracotta",
    }),
    matCream: new THREE.MeshStandardMaterial({
      color: 0xeae0d5,
      roughness: 0.75,
      metalness: 0.05,
      name: "mat_cream",
    }),
    matHistoricRoof: new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.5,
      metalness: 0.4,
      name: "mat_historic_roof",
    }),
    matPtfeMembrane: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.5,
      metalness: 0.1,
      name: "mat_ptfe_membrane",
    }),
    matClockDial: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      emissive: 0x334455,
      emissiveIntensity: 0.4,
      name: "mat_clock_dial",
    }),
    matClockGold: new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.3,
      metalness: 0.85,
      name: "mat_clock_gold",
    }),
    matClockMark: new THREE.MeshStandardMaterial({
      color: 0x1a202c,
      roughness: 0.6,
      metalness: 0.2,
      name: "mat_clock_mark",
    }),
  };
}

// =========================================================================
// Geometry Helper Functions
// =========================================================================

function createMesh(geometry, material, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  return mesh;
}

function createBoxBounds({ xMin, xMax, yMin, yMax, zMin, zMax, material, name }) {
  const len = xMax - xMin;
  const wid = yMax - yMin;
  const hgt = zMax - zMin;
  const geom = new THREE.BoxGeometry(len, wid, hgt);
  geom.translate((xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2);
  return createMesh(geom, material, name);
}

function createBarrelVaultMesh({
  length,
  width,
  peakHeight,
  baseHeight = 0,
  thickness = 0.6,
  centerY = 0,
  segments = 24,
  material,
  name,
}) {
  const shape = new THREE.Shape();
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

  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, z - length / 2, x + centerY, y + baseHeight);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  return createMesh(geom, material, name);
}

function createSemiCircularVaultMesh({
  length,
  width,
  peakHeight,
  baseHeight = 0,
  thickness = 0.6,
  centerY = 0,
  segments = 32,
  material,
  name,
}) {
  const shape = new THREE.Shape();
  const radiusY = width / 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = Math.PI * (1 - t);
    const y = Math.cos(angle) * radiusY;
    const z = Math.sin(angle) * peakHeight;
    if (i === 0) shape.moveTo(y, z);
    else shape.lineTo(y, z);
  }
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const angle = Math.PI * (1 - t);
    const y = Math.cos(angle) * Math.max(0.1, radiusY - thickness);
    const z = Math.max(0, Math.sin(angle) * Math.max(0.1, peakHeight - thickness));
    shape.lineTo(y, z);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
  });

  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, z - length / 2, x + centerY, y + baseHeight);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  return createMesh(geom, material, name);
}

function createCurvedSkylightMesh({
  length,
  ribbonWidth,
  archWidth,
  peakHeight,
  baseHeight = 0,
  centerY = 0,
  segments = 10,
  material,
  name,
}) {
  const shape = new THREE.Shape();
  const halfRibbon = ribbonWidth / 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = -halfRibbon + t * ribbonWidth;
    const z = peakHeight * (1 - (2 * y / archWidth) ** 2) + 0.15;
    if (i === 0) shape.moveTo(y, z);
    else shape.lineTo(y, z);
  }
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const y = -halfRibbon + t * ribbonWidth;
    const z = peakHeight * (1 - (2 * y / archWidth) ** 2) + 0.05;
    shape.lineTo(y, z);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
  });

  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, z - length / 2, x + centerY, y + baseHeight);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  return createMesh(geom, material, name);
}

// =========================================================================
// 1. Siam Station (BTS Interchange Hub)
// =========================================================================

export function buildSiamScene() {
  const root = new THREE.Group();
  root.name = "SiamStation";
  const mats = createSharedMaterials();

  // 1.1 Lower Platform Deck (160 m × 22 m, z = -1.2 to 0)
  const lowerPlatformGroup = new THREE.Group();
  lowerPlatformGroup.name = "LowerPlatformLevel";

  const lowerDeck = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: -11,
    yMax: 11,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "LowerPlatformDeck",
  });
  lowerPlatformGroup.add(lowerDeck);

  // Yellow tactile strips along both platform edges
  const lowerTactileLeft = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: -10.8,
    yMax: -10.4,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "LowerTactile_South",
  });
  const lowerTactileRight = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: 10.4,
    yMax: 10.8,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "LowerTactile_North",
  });
  lowerPlatformGroup.add(lowerTactileLeft, lowerTactileRight);

  // Glazed platform edge half-height screen doors
  const lowerPsdSouth = createBoxBounds({
    xMin: -78,
    xMax: 78,
    yMin: -11.0,
    yMax: -10.85,
    zMin: 0,
    zMax: 1.35,
    material: mats.matGlass,
    name: "LowerScreenDoors_South",
  });
  const lowerPsdNorth = createBoxBounds({
    xMin: -78,
    xMax: 78,
    yMin: 10.85,
    yMax: 11.0,
    zMin: 0,
    zMax: 1.35,
    material: mats.matGlass,
    name: "LowerScreenDoors_North",
  });
  lowerPlatformGroup.add(lowerPsdSouth, lowerPsdNorth);

  // Vertical escalator/stair cores rising to upper platform
  for (const cx of [-45, 0, 45]) {
    const stairCore = createBoxBounds({
      xMin: cx - 4,
      xMax: cx + 4,
      yMin: -2.5,
      yMax: 2.5,
      zMin: 0,
      zMax: 5.3,
      material: mats.matConcrete,
      name: `InterLevelCore_${cx}`,
    });
    lowerPlatformGroup.add(stairCore);
  }

  // Intermediate columns supporting upper platform
  for (const cx of [-65, -25, 25, 65]) {
    for (const cy of [-7.5, 7.5]) {
      const col = createBoxBounds({
        xMin: cx - 0.8,
        xMax: cx + 0.8,
        yMin: cy - 0.8,
        yMax: cy + 0.8,
        zMin: 0,
        zMax: 5.3,
        material: mats.matConcrete,
      });
      lowerPlatformGroup.add(col);
    }
  }

  root.add(lowerPlatformGroup);

  // 1.2 Upper Platform Deck (160 m × 22 m, z = 5.3 to 6.5)
  const upperPlatformGroup = new THREE.Group();
  upperPlatformGroup.name = "UpperPlatformLevel";

  const upperDeck = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: -11,
    yMax: 11,
    zMin: 5.3,
    zMax: 6.5,
    material: mats.matPlatform,
    name: "UpperPlatformDeck",
  });
  upperPlatformGroup.add(upperDeck);

  // Yellow tactile strips along upper deck edges
  const upperTactileLeft = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: -10.8,
    yMax: -10.4,
    zMin: 6.5,
    zMax: 6.54,
    material: mats.matYellowStrip,
    name: "UpperTactile_South",
  });
  const upperTactileRight = createBoxBounds({
    xMin: -80,
    xMax: 80,
    yMin: 10.4,
    yMax: 10.8,
    zMin: 6.5,
    zMax: 6.54,
    material: mats.matYellowStrip,
    name: "UpperTactile_North",
  });
  upperPlatformGroup.add(upperTactileLeft, upperTactileRight);

  // Upper platform glazed edge screens
  const upperPsdSouth = createBoxBounds({
    xMin: -78,
    xMax: 78,
    yMin: -11.0,
    yMax: -10.85,
    zMin: 6.5,
    zMax: 7.85,
    material: mats.matGlass,
    name: "UpperScreenDoors_South",
  });
  const upperPsdNorth = createBoxBounds({
    xMin: -78,
    xMax: 78,
    yMin: 10.85,
    yMax: 11.0,
    zMin: 6.5,
    zMax: 7.85,
    material: mats.matGlass,
    name: "UpperScreenDoors_North",
  });
  upperPlatformGroup.add(upperPsdSouth, upperPsdNorth);

  root.add(upperPlatformGroup);

  // 1.3 Concourse Slab (150 m × 26 m, z = -6.5 to -5.0) & Glazed Skywalk Bridges
  const concourseGroup = new THREE.Group();
  concourseGroup.name = "ConcourseAndSkywalks";

  const concourseSlab = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: -13,
    yMax: 13,
    zMin: -6.5,
    zMax: -5.0,
    material: mats.matConcrete,
    name: "ConcourseSlab",
  });
  concourseGroup.add(concourseSlab);

  // Concourse glass perimeter walls
  const concourseGlassSouth = createBoxBounds({
    xMin: -74,
    xMax: 74,
    yMin: -12.9,
    yMax: -12.6,
    zMin: -5.0,
    zMax: -1.8,
    material: mats.matGlass,
    name: "ConcourseGlazing_South",
  });
  const concourseGlassNorth = createBoxBounds({
    xMin: -74,
    xMax: 74,
    yMin: 12.6,
    yMax: 12.9,
    zMin: -5.0,
    zMax: -1.8,
    material: mats.matGlass,
    name: "ConcourseGlazing_North",
  });
  concourseGroup.add(concourseGlassSouth, concourseGlassNorth);

  // Transverse glazed pedestrian skywalk bridges (y = -32 to +32, z = -5.0 to -2.0)
  for (const sx of [-20, 30]) {
    // Skywalk floor slab
    const bridgeFloor = createBoxBounds({
      xMin: sx - 5,
      xMax: sx + 5,
      yMin: -32,
      yMax: 32,
      zMin: -5.0,
      zMax: -4.5,
      material: mats.matConcrete,
      name: `SkywalkFloor_${sx}`,
    });
    // Glass sidewalls
    const bridgeGlassWest = createBoxBounds({
      xMin: sx - 4.9,
      xMax: sx - 4.7,
      yMin: -32,
      yMax: 32,
      zMin: -4.5,
      zMax: -2.3,
      material: mats.matGlass,
    });
    const bridgeGlassEast = createBoxBounds({
      xMin: sx + 4.7,
      xMax: sx + 4.9,
      yMin: -32,
      yMax: 32,
      zMin: -4.5,
      zMax: -2.3,
      material: mats.matGlass,
    });
    // Skywalk roof canopy
    const bridgeRoof = createBoxBounds({
      xMin: sx - 5.2,
      xMax: sx + 5.2,
      yMin: -32,
      yMax: 32,
      zMin: -2.3,
      zMax: -2.0,
      material: mats.matRoof,
      name: `SkywalkCanopy_${sx}`,
    });
    // Structural support piers extending down to ground (z = -15)
    for (const py of [-25, 25]) {
      const pier = createBoxBounds({
        xMin: sx - 1.2,
        xMax: sx + 1.2,
        yMin: py - 1.2,
        yMax: py + 1.2,
        zMin: -15,
        zMax: -5.0,
        material: mats.matConcrete,
      });
      concourseGroup.add(pier);
    }
    concourseGroup.add(bridgeFloor, bridgeGlassWest, bridgeGlassEast, bridgeRoof);
  }

  root.add(concourseGroup);

  // 1.4 Curved Barrel-Vault Roof Canopy (168 m × 28 m, apex at z = 13.5)
  const roofGroup = new THREE.Group();
  roofGroup.name = "RoofCanopy";

  const roofShell = createBarrelVaultMesh({
    length: 168,
    width: 28,
    peakHeight: 6.8,
    baseHeight: 6.7, // 6.7 + 6.8 = 13.5 apex
    thickness: 0.6,
    material: mats.matRoof,
    name: "BarrelVaultRoof",
  });
  roofGroup.add(roofShell);

  // Central glass skylight ribbon (opacity 0.65, transparent)
  const skylight = createCurvedSkylightMesh({
    length: 164,
    ribbonWidth: 6,
    archWidth: 28,
    peakHeight: 6.8,
    baseHeight: 6.7,
    material: mats.matGlass,
    name: "CentralSkylightRibbon",
  });
  roofGroup.add(skylight);

  // Structural transverse arch ribs
  for (const rx of [-75, -50, -25, 0, 25, 50, 75]) {
    const rib = createBoxBounds({
      xMin: rx - 0.7,
      xMax: rx + 0.7,
      yMin: -14.2,
      yMax: 14.2,
      zMin: 13.2,
      zMax: 13.9,
      material: mats.matRoofRib,
    });
    roofGroup.add(rib);
  }

  // BTS light-green (0x7cb342) & dark-teal (0x008080) side fascia trim rails
  // Light green trim (Sukhumvit Line)
  const trimGreenSouth = createBoxBounds({
    xMin: -84,
    xMax: 84,
    yMin: -14.4,
    yMax: -13.8,
    zMin: 7.2,
    zMax: 7.8,
    material: mats.matBtsGreen,
    name: "Fascia_BtsGreen_South",
  });
  const trimGreenNorth = createBoxBounds({
    xMin: -84,
    xMax: 84,
    yMin: 13.8,
    yMax: 14.4,
    zMin: 7.2,
    zMax: 7.8,
    material: mats.matBtsGreen,
    name: "Fascia_BtsGreen_North",
  });
  // Dark teal trim (Silom Line)
  const trimTealSouth = createBoxBounds({
    xMin: -84,
    xMax: 84,
    yMin: -14.4,
    yMax: -13.8,
    zMin: 6.5,
    zMax: 7.1,
    material: mats.matBtsTeal,
    name: "Fascia_BtsTeal_South",
  });
  const trimTealNorth = createBoxBounds({
    xMin: -84,
    xMax: 84,
    yMin: 13.8,
    yMax: 14.4,
    zMin: 6.5,
    zMax: 7.1,
    material: mats.matBtsTeal,
    name: "Fascia_BtsTeal_North",
  });
  roofGroup.add(trimGreenSouth, trimGreenNorth, trimTealSouth, trimTealNorth);

  root.add(roofGroup);

  // 1.5 Paired Heavy Concrete Portal Columns & Crosshead Bents (z = -15 to 0)
  const substructureGroup = new THREE.Group();
  substructureGroup.name = "PortalColumnsAndBents";

  const pierX = [-65, -45, -25, -5, 15, 35, 55, 70];
  for (const px of pierX) {
    // Paired columns from ground (z = -15) to concourse (z = -6.5)
    for (const py of [-8, 8]) {
      const column = createBoxBounds({
        xMin: px - 1.3,
        xMax: px + 1.3,
        yMin: py - 1.3,
        yMax: py + 1.3,
        zMin: -15,
        zMax: -6.5,
        material: mats.matConcrete,
        name: `GroundColumn_${px}_${py}`,
      });
      // Concrete footings at ground
      const footing = createBoxBounds({
        xMin: px - 2.0,
        xMax: px + 2.0,
        yMin: py - 2.0,
        yMax: py + 2.0,
        zMin: -15.4,
        zMax: -14.5,
        material: mats.matPlinth,
      });
      substructureGroup.add(column, footing);
    }
    // Heavy crosshead bent supporting concourse slab
    const crossheadBent = createBoxBounds({
      xMin: px - 1.6,
      xMax: px + 1.6,
      yMin: -12.5,
      yMax: 12.5,
      zMin: -7.8,
      zMax: -6.5,
      material: mats.matConcrete,
      name: `CrossheadBent_${px}`,
    });
    substructureGroup.add(crossheadBent);

    // Columns continuing up to lower deck (z = -1.2)
    for (const py of [-8, 8]) {
      const upperColumn = createBoxBounds({
        xMin: px - 1.0,
        xMax: px + 1.0,
        yMin: py - 1.0,
        yMax: py + 1.0,
        zMin: -5.0,
        zMax: -1.2,
        material: mats.matConcrete,
      });
      substructureGroup.add(upperColumn);
    }
  }

  root.add(substructureGroup);
  return root;
}

// =========================================================================
// 2. Suvarnabhumi Station (Airport Rail Link Terminal & Concourse Hall)
// =========================================================================

export function buildSuvarnabhumiScene() {
  const root = new THREE.Group();
  root.name = "SuvarnabhumiAirportTerminal";
  const mats = createSharedMaterials();

  // 2.1 Underground Concrete Station Box & Island Platform (200 m × 22 m, z = -1.2 to 0)
  const undergroundGroup = new THREE.Group();
  undergroundGroup.name = "UndergroundStationBox";

  // Station box foundation slab
  const baseSlab = createBoxBounds({
    xMin: -105,
    xMax: 105,
    yMin: -17,
    yMax: 17,
    zMin: -3.5,
    zMax: -1.2,
    material: mats.matPlinth,
    name: "StationBoxFoundation",
  });
  // Perimeter retaining walls
  const retainSouth = createBoxBounds({
    xMin: -105,
    xMax: 105,
    yMin: -17,
    yMax: -15.5,
    zMin: -3.5,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const retainNorth = createBoxBounds({
    xMin: -105,
    xMax: 105,
    yMin: 15.5,
    yMax: 17,
    zMin: -3.5,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const retainWest = createBoxBounds({
    xMin: -105,
    xMax: -103.5,
    yMin: -17,
    yMax: 17,
    zMin: -3.5,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const retainEast = createBoxBounds({
    xMin: 103.5,
    xMax: 105,
    yMin: -17,
    yMax: 17,
    zMin: -3.5,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  undergroundGroup.add(baseSlab, retainSouth, retainNorth, retainWest, retainEast);

  // Island platform (200 m × 22 m, z = -1.2 to 0)
  const islandPlatform = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -11,
    yMax: 11,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "IslandPlatformDeck",
  });
  undergroundGroup.add(islandPlatform);

  // Yellow tactile strips along both platform edges
  const tactileSouth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -10.8,
    yMax: -10.4,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "TactileStrip_South",
  });
  const tactileNorth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: 10.4,
    yMax: 10.8,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "TactileStrip_North",
  });
  undergroundGroup.add(tactileSouth, tactileNorth);

  // Glazed platform screen doors (z = 0 to 3.0, opacity 0.65, transparent)
  const psdSouth = createBoxBounds({
    xMin: -98,
    xMax: 98,
    yMin: -11.0,
    yMax: -10.85,
    zMin: 0,
    zMax: 3.0,
    material: mats.matGlass,
    name: "PlatformScreenDoors_South",
  });
  const psdNorth = createBoxBounds({
    xMin: -98,
    xMax: 98,
    yMin: 10.85,
    yMax: 11.0,
    zMin: 0,
    zMax: 3.0,
    material: mats.matGlass,
    name: "PlatformScreenDoors_North",
  });
  // Top header transoms for PSDs
  const psdHeaderSouth = createBoxBounds({
    xMin: -98,
    xMax: 98,
    yMin: -11.05,
    yMax: -10.8,
    zMin: 2.85,
    zMax: 3.05,
    material: mats.matSteel,
  });
  const psdHeaderNorth = createBoxBounds({
    xMin: -98,
    xMax: 98,
    yMin: 10.8,
    yMax: 11.05,
    zMin: 2.85,
    zMax: 3.05,
    material: mats.matSteel,
  });
  undergroundGroup.add(psdSouth, psdNorth, psdHeaderSouth, psdHeaderNorth);

  // Track troughs alongside platform
  const trackSouth = createBoxBounds({
    xMin: -102,
    xMax: 102,
    yMin: -15.5,
    yMax: -11.0,
    zMin: -2.0,
    zMax: -1.2,
    material: mats.matBallast,
  });
  const trackNorth = createBoxBounds({
    xMin: -102,
    xMax: 102,
    yMin: 11.0,
    yMax: 15.5,
    zMin: -2.0,
    zMax: -1.2,
    material: mats.matBallast,
  });
  undergroundGroup.add(trackSouth, trackNorth);

  root.add(undergroundGroup);

  // 2.2 Escalator Atrium Lightwell (60 m × 18 m, z = 0 to 4.5)
  const atriumGroup = new THREE.Group();
  atriumGroup.name = "EscalatorAtrium";

  // Ground level concourse floor around atrium (z = 4.0)
  const floorWest = createBoxBounds({
    xMin: -110,
    xMax: -30,
    yMin: -32,
    yMax: 32,
    zMin: 3.6,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const floorEast = createBoxBounds({
    xMin: 30,
    xMax: 110,
    yMin: -32,
    yMax: 32,
    zMin: 3.6,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const floorNorth = createBoxBounds({
    xMin: -30,
    xMax: 30,
    yMin: 9,
    yMax: 32,
    zMin: 3.6,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  const floorSouth = createBoxBounds({
    xMin: -30,
    xMax: 30,
    yMin: -32,
    yMax: -9,
    zMin: 3.6,
    zMax: 4.0,
    material: mats.matConcrete,
  });
  atriumGroup.add(floorWest, floorEast, floorNorth, floorSouth);

  // Glass safety balustrades around lightwell opening (z = 4.0 to 5.1)
  const balustradeSouth = createBoxBounds({
    xMin: -30,
    xMax: 30,
    yMin: -9.1,
    yMax: -8.9,
    zMin: 4.0,
    zMax: 5.1,
    material: mats.matGlass,
  });
  const balustradeNorth = createBoxBounds({
    xMin: -30,
    xMax: 30,
    yMin: 8.9,
    yMax: 9.1,
    zMin: 4.0,
    zMax: 5.1,
    material: mats.matGlass,
  });
  const balustradeWest = createBoxBounds({
    xMin: -30.1,
    xMax: -29.9,
    yMin: -9,
    yMax: 9,
    zMin: 4.0,
    zMax: 5.1,
    material: mats.matGlass,
  });
  const balustradeEast = createBoxBounds({
    xMin: 29.9,
    xMax: 30.1,
    yMin: -9,
    yMax: 9,
    zMin: 4.0,
    zMax: 5.1,
    material: mats.matGlass,
  });
  atriumGroup.add(balustradeSouth, balustradeNorth, balustradeWest, balustradeEast);

  // Angled escalator trusses rising from platform (z = 0) to ground (z = 4.5)
  for (const ex of [-15, 15]) {
    for (const ey of [-4, 4]) {
      const escGeometry = new THREE.BoxGeometry(4.0, 2.0, 5.8);
      escGeometry.rotateY(Math.PI / 6);
      escGeometry.translate(ex, ey, 2.2);
      atriumGroup.add(createMesh(escGeometry, mats.matSteel));
    }
  }

  root.add(atriumGroup);

  // 2.3 Above-Ground Helmut Jahn-Inspired Suvarnabhumi Concourse Hall (220 m × 64 m, z = 4.0 to 24.0)
  const hallGroup = new THREE.Group();
  hallGroup.name = "HelmutJahnConcourseHall";

  // Alternating translucent PTFE membrane barrel-vault bays (0xe2e8f0) and blue-tinted glass bays (0x5d8da8)
  const bayIntervals = [
    { xMin: -110, xMax: -90, mat: mats.matGlass, name: "Bay_Glazed_0" },
    { xMin: -90, xMax: -60, mat: mats.matPtfeMembrane, name: "Bay_PTFE_1" },
    { xMin: -60, xMax: -30, mat: mats.matGlass, name: "Bay_Glazed_2" },
    { xMin: -30, xMax: 0, mat: mats.matPtfeMembrane, name: "Bay_PTFE_3" },
    { xMin: 0, xMax: 30, mat: mats.matGlass, name: "Bay_Glazed_4" },
    { xMin: 30, xMax: 60, mat: mats.matPtfeMembrane, name: "Bay_PTFE_5" },
    { xMin: 60, xMax: 90, mat: mats.matGlass, name: "Bay_Glazed_6" },
    { xMin: 90, xMax: 110, mat: mats.matGlass, name: "Bay_Glazed_7" },
  ];

  for (const bay of bayIntervals) {
    const bayLen = bay.xMax - bay.xMin;
    const bayMesh = createBarrelVaultMesh({
      length: bayLen,
      width: 64,
      peakHeight: 20.0,
      baseHeight: 4.0,
      thickness: 0.5,
      material: bay.mat,
      name: bay.name,
    });
    bayMesh.position.x = (bay.xMin + bay.xMax) / 2;
    hallGroup.add(bayMesh);
  }

  // 7 Exposed External Steel Super-Truss Arch Ribs (0x3a4250, peak z = 26.0)
  const ribXPositions = [-90, -60, -30, 0, 30, 60, 90];
  for (let i = 0; i < ribXPositions.length; i++) {
    const rx = ribXPositions[i];
    // Outer super-truss arch
    const outerRib = createBarrelVaultMesh({
      length: 2.2,
      width: 66,
      peakHeight: 22.0,
      baseHeight: 4.0,
      thickness: 0.9,
      material: mats.matRoofRib,
      name: `SuperTrussArch_${i}_${rx}`,
    });
    outerRib.position.x = rx;

    // Structural base footing pylons at y = +/- 33
    const footingSouth = createBoxBounds({
      xMin: rx - 2.5,
      xMax: rx + 2.5,
      yMin: -34.5,
      yMax: -31.5,
      zMin: 3.5,
      zMax: 7.0,
      material: mats.matConcrete,
    });
    const footingNorth = createBoxBounds({
      xMin: rx - 2.5,
      xMax: rx + 2.5,
      yMin: 31.5,
      yMax: 34.5,
      zMin: 3.5,
      zMax: 7.0,
      material: mats.matConcrete,
    });

    hallGroup.add(outerRib, footingSouth, footingNorth);
  }

  // Gable end glazed curtain walls (x = -110 and x = 110)
  for (const gx of [-110, 110]) {
    const gableGlass = createBoxBounds({
      xMin: gx - 0.5,
      xMax: gx + 0.5,
      yMin: -31,
      yMax: 31,
      zMin: 4.0,
      zMax: 22.5,
      material: mats.matGlass,
      name: `GableGlazing_${gx}`,
    });
    const gableFrame = createBoxBounds({
      xMin: gx - 1.0,
      xMax: gx + 1.0,
      yMin: -32,
      yMax: 32,
      zMin: 22.0,
      zMax: 24.2,
      material: mats.matRoofRib,
    });
    hallGroup.add(gableGlass, gableFrame);
  }

  // Longitudinal lower facade glazing ribbons (z = 4.0 to 11.0)
  const sideGlassSouth = createBoxBounds({
    xMin: -108,
    xMax: 108,
    yMin: -32.2,
    yMax: -31.8,
    zMin: 4.0,
    zMax: 11.0,
    material: mats.matGlass,
  });
  const sideGlassNorth = createBoxBounds({
    xMin: -108,
    xMax: 108,
    yMin: 31.8,
    yMax: 32.2,
    zMin: 4.0,
    zMax: 11.0,
    material: mats.matGlass,
  });
  hallGroup.add(sideGlassSouth, sideGlassNorth);

  root.add(hallGroup);
  return root;
}

// =========================================================================
// 3. Makkasan Station (ARL City Air Terminal)
// =========================================================================

export function buildMakkasanScene() {
  const root = new THREE.Group();
  root.name = "MakkasanCityAirTerminal";
  const mats = createSharedMaterials();

  // 3.1 Massive Multi-Story Terminal Podium (190 m × 48 m, z = -15.0 to -1.5)
  const podiumGroup = new THREE.Group();
  podiumGroup.name = "TerminalPodium";

  // Foundation ground plinth (z = -15.5 to -14.5)
  const plinth = createBoxBounds({
    xMin: -98,
    xMax: 98,
    yMin: -26,
    yMax: 26,
    zMin: -15.5,
    zMax: -14.5,
    material: mats.matPlinth,
    name: "GroundPlinth",
  });
  podiumGroup.add(plinth);

  // Main concrete podium block
  const podiumBody = createBoxBounds({
    xMin: -95,
    xMax: 95,
    yMin: -24,
    yMax: 24,
    zMin: -14.5,
    zMax: -1.5,
    material: mats.matConcrete,
    name: "PodiumBody",
  });
  podiumGroup.add(podiumBody);

  // Glazed curtain-wall facades (0x5d8da8, opacity 0.65, transparent)
  const curtainSouth = createBoxBounds({
    xMin: -93,
    xMax: 93,
    yMin: -24.4,
    yMax: -23.8,
    zMin: -14.0,
    zMax: -2.0,
    material: mats.matGlass,
    name: "GlazedCurtain_South",
  });
  const curtainNorth = createBoxBounds({
    xMin: -93,
    xMax: 93,
    yMin: 23.8,
    yMax: 24.4,
    zMin: -14.0,
    zMax: -2.0,
    material: mats.matGlass,
    name: "GlazedCurtain_North",
  });
  podiumGroup.add(curtainSouth, curtainNorth);

  // Horizontal architectural facade louvers/mullions
  for (const lz of [-11.0, -8.0, -5.0]) {
    const louverSouth = createBoxBounds({
      xMin: -94,
      xMax: 94,
      yMin: -24.6,
      yMax: -24.2,
      zMin: lz,
      zMax: lz + 0.4,
      material: mats.matSteel,
    });
    const louverNorth = createBoxBounds({
      xMin: -94,
      xMax: 94,
      yMin: 24.2,
      yMax: 24.6,
      zMin: lz,
      zMax: lz + 0.4,
      material: mats.matSteel,
    });
    podiumGroup.add(louverSouth, louverNorth);
  }

  // Elevated Skybridge Walkway (y = 24 to 55, z = -5.5)
  const skybridgeGroup = new THREE.Group();
  skybridgeGroup.name = "ElevatedSkybridge";

  // Skybridge floor slab
  const skybridgeDeck = createBoxBounds({
    xMin: -4.5,
    xMax: 4.5,
    yMin: 24,
    yMax: 55,
    zMin: -6.2,
    zMax: -5.5,
    material: mats.matConcrete,
    name: "SkybridgeDeck",
  });
  // Glazed sidewalls
  const skybridgeGlassWest = createBoxBounds({
    xMin: -4.4,
    xMax: -4.1,
    yMin: 24,
    yMax: 55,
    zMin: -5.5,
    zMax: -3.0,
    material: mats.matGlass,
  });
  const skybridgeGlassEast = createBoxBounds({
    xMin: 4.1,
    xMax: 4.4,
    yMin: 24,
    yMax: 55,
    zMin: -5.5,
    zMax: -3.0,
    material: mats.matGlass,
  });
  // Canopy roof
  const skybridgeRoof = createBoxBounds({
    xMin: -4.8,
    xMax: 4.8,
    yMin: 24,
    yMax: 55,
    zMin: -3.0,
    zMax: -2.5,
    material: mats.matRoof,
    name: "SkybridgeCanopy",
  });
  // Support piers down to ground (z = -15)
  for (const py of [35, 48]) {
    const skybridgePier = createBoxBounds({
      xMin: -1.2,
      xMax: 1.2,
      yMin: py - 1.2,
      yMax: py + 1.2,
      zMin: -15,
      zMax: -6.2,
      material: mats.matConcrete,
    });
    skybridgeGroup.add(skybridgePier);
  }
  skybridgeGroup.add(skybridgeDeck, skybridgeGlassWest, skybridgeGlassEast, skybridgeRoof);
  podiumGroup.add(skybridgeGroup);

  root.add(podiumGroup);

  // 3.2 Elevated Island & Side Platforms (200 m × 28 m, z = -1.2 to 0)
  const platformGroup = new THREE.Group();
  platformGroup.name = "PlatformLevel";

  // Central express island platform (y = -5 to 5)
  const centralPlatform = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -5.0,
    yMax: 5.0,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "CentralExpressPlatform",
  });
  // Outer side platforms (y = -14 to -9.5 and 9.5 to 14)
  const southSidePlatform = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -14.0,
    yMax: -9.5,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "SouthSidePlatform",
  });
  const northSidePlatform = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: 9.5,
    yMax: 14.0,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "NorthSidePlatform",
  });
  platformGroup.add(centralPlatform, southSidePlatform, northSidePlatform);

  // Yellow tactile strips on platforms
  const tactileCentralSouth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -4.8,
    yMax: -4.4,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  const tactileCentralNorth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: 4.4,
    yMax: 4.8,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  const tactileSideSouth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -9.9,
    yMax: -9.5,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  const tactileSideNorth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: 9.5,
    yMax: 9.9,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  platformGroup.add(tactileCentralSouth, tactileCentralNorth, tactileSideSouth, tactileSideNorth);

  // Ballast / track beds
  const trackBedSouth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: -9.5,
    yMax: -5.0,
    zMin: -1.8,
    zMax: -1.0,
    material: mats.matPlinth,
  });
  const trackBedNorth = createBoxBounds({
    xMin: -100,
    xMax: 100,
    yMin: 5.0,
    yMax: 9.5,
    zMin: -1.8,
    zMax: -1.0,
    material: mats.matPlinth,
  });
  platformGroup.add(trackBedSouth, trackBedNorth);

  root.add(platformGroup);

  // 3.3 Sweeping Cantilevered Aerodynamic Barrel-Vault Roof (210 m × 54 m, peak z = 16.0)
  const roofGroup = new THREE.Group();
  roofGroup.name = "CantileverRoof";

  const roofShell = createBarrelVaultMesh({
    length: 210,
    width: 54,
    peakHeight: 16.0,
    baseHeight: 0,
    thickness: 0.7,
    material: mats.matRoof,
    name: "AerodynamicRoofVault",
  });
  roofGroup.add(roofShell);

  // Longitudinal glass skylight ribbon along apex
  const skylight = createCurvedSkylightMesh({
    length: 204,
    ribbonWidth: 9,
    archWidth: 54,
    peakHeight: 16.0,
    baseHeight: 0,
    material: mats.matGlass,
    name: "LongitudinalSkylight",
  });
  roofGroup.add(skylight);

  // Structural transverse steel ribs
  for (const rx of [-90, -60, -30, 0, 30, 60, 90]) {
    const rib = createBoxBounds({
      xMin: rx - 0.8,
      xMax: rx + 0.8,
      yMin: -27.2,
      yMax: 27.2,
      zMin: 15.6,
      zMax: 16.5,
      material: mats.matRoofRib,
    });
    roofGroup.add(rib);
  }

  // ARL crimson (0xb91c1c) & navy (0x1e3a8a) fascia bands along cantilever eaves
  // Crimson band (Express Line identity)
  const crimsonSouth = createBoxBounds({
    xMin: -105.5,
    xMax: 105.5,
    yMin: -27.4,
    yMax: -26.8,
    zMin: 1.2,
    zMax: 2.1,
    material: mats.matArlCrimson,
    name: "Fascia_ArlCrimson_South",
  });
  const crimsonNorth = createBoxBounds({
    xMin: -105.5,
    xMax: 105.5,
    yMin: 26.8,
    yMax: 27.4,
    zMin: 1.2,
    zMax: 2.1,
    material: mats.matArlCrimson,
    name: "Fascia_ArlCrimson_North",
  });
  // Navy band (City Line identity)
  const navySouth = createBoxBounds({
    xMin: -105.5,
    xMax: 105.5,
    yMin: -27.4,
    yMax: -26.8,
    zMin: 0.2,
    zMax: 1.1,
    material: mats.matArlNavy,
    name: "Fascia_ArlNavy_South",
  });
  const navyNorth = createBoxBounds({
    xMin: -105.5,
    xMax: 105.5,
    yMin: 26.8,
    yMax: 27.4,
    zMin: 0.2,
    zMax: 1.1,
    material: mats.matArlNavy,
    name: "Fascia_ArlNavy_North",
  });
  roofGroup.add(crimsonSouth, crimsonNorth, navySouth, navyNorth);

  root.add(roofGroup);
  return root;
}

// =========================================================================
// 4. Hua Lamphong Station (MRT Blue Cavern & Historic Terminal)
// =========================================================================

export function buildHuaLamphongScene() {
  const root = new THREE.Group();
  root.name = "HuaLamphongStation";
  const mats = createSharedMaterials();

  // 4.1 Underground MRT Cavern Platform (140 m × 18 m, z = -1.2 to 0, ceiling z = 6.0)
  const undergroundGroup = new THREE.Group();
  undergroundGroup.name = "UndergroundMRTStation";

  // Platform deck
  const platform = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: -9,
    yMax: 9,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "MrtPlatformDeck",
  });
  // Yellow tactile strips along both edges
  const tactileSouth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: -8.8,
    yMax: -8.4,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  const tactileNorth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: 8.4,
    yMax: 8.8,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
  });
  undergroundGroup.add(platform, tactileSouth, tactileNorth);

  // Cavern retaining side walls
  const wallSouth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: -10.5,
    yMax: -9.0,
    zMin: -1.2,
    zMax: 6.0,
    material: mats.matConcrete,
  });
  const wallNorth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: 9.0,
    yMax: 10.5,
    zMin: -1.2,
    zMax: 6.0,
    material: mats.matConcrete,
  });
  // Cavern ceiling slab (z = 6.0)
  const ceilingSlab = createBoxBounds({
    xMin: -72,
    xMax: 72,
    yMin: -10.5,
    yMax: 10.5,
    zMin: 5.6,
    zMax: 6.4,
    material: mats.matConcrete,
    name: "CavernCeilingSlab",
  });
  undergroundGroup.add(wallSouth, wallNorth, ceilingSlab);

  // MRT Blue (0x1964b7) fascia trim running along cavern walls
  const blueTrimSouth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: -9.1,
    yMax: -8.8,
    zMin: 2.2,
    zMax: 2.9,
    material: mats.matMrtBlue,
    name: "MrtFasciaTrim_South",
  });
  const blueTrimNorth = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: 8.8,
    yMax: 9.1,
    zMin: 2.2,
    zMax: 2.9,
    material: mats.matMrtBlue,
    name: "MrtFasciaTrim_North",
  });
  undergroundGroup.add(blueTrimSouth, blueTrimNorth);

  // 2 Vertical entrance shafts rising from z = 0 to z = +18
  for (const sx of [-45, 45]) {
    const shaft = createBoxBounds({
      xMin: sx - 5.5,
      xMax: sx + 5.5,
      yMin: -4.5,
      yMax: 4.5,
      zMin: 0,
      zMax: 18.0,
      material: mats.matConcrete,
      name: `EntranceShaft_${sx}`,
    });
    // Glass elevator / light conduit in core
    const shaftGlass = createBoxBounds({
      xMin: sx - 2.5,
      xMax: sx + 2.5,
      yMin: -4.6,
      yMax: -4.3,
      zMin: 0,
      zMax: 18.0,
      material: mats.matGlass,
    });
    undergroundGroup.add(shaft, shaftGlass);
  }

  root.add(undergroundGroup);

  // 4.2 Historic Bangkok Railway Terminal at Surface (150 m × 42 m, z = 18.0 to 36.0)
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = "HistoricSurfaceTerminal";

  // Ground level plaza slab (z = 18.0)
  const groundPlaza = createBoxBounds({
    xMin: -78,
    xMax: 78,
    yMin: -24,
    yMax: 24,
    zMin: 17.5,
    zMax: 18.0,
    material: mats.matPlinth,
    name: "PlazaSlab",
  });
  surfaceGroup.add(groundPlaza);

  // Grand Semi-Circular Barrel-Vault Train Shed Roof (z = 24.0 to 36.0, apex at 36.0)
  const trainShedVault = createSemiCircularVaultMesh({
    length: 125,
    width: 32,
    peakHeight: 12.0, // base 24 + 12 = 36 apex
    baseHeight: 24.0,
    thickness: 0.8,
    material: mats.matHistoricRoof,
    name: "TrainShedSemiCircularVault",
  });
  trainShedVault.position.x = 8; // extends back along platform tracks
  surfaceGroup.add(trainShedVault);

  // Central train shed glass skylight along apex
  const shedSkylight = createCurvedSkylightMesh({
    length: 120,
    ribbonWidth: 6,
    archWidth: 32,
    peakHeight: 12.0,
    baseHeight: 24.0,
    material: mats.matGlass,
    name: "TrainShedSkylight",
  });
  shedSkylight.position.x = 8;
  surfaceGroup.add(shedSkylight);

  // Structural transverse iron arched trusses
  for (const tx of [-45, -25, -5, 15, 35, 55]) {
    const trussRib = createBoxBounds({
      xMin: tx - 0.7,
      xMax: tx + 0.7,
      yMin: -16.2,
      yMax: 16.2,
      zMin: 35.6,
      zMax: 36.3,
      material: mats.matSteel,
    });
    surfaceGroup.add(trussRib);
  }

  // Terracotta-brick (0xb85d43) & cream (0xeae0d5) classical side wings
  // South wing
  const wingSouth = createBoxBounds({
    xMin: -75,
    xMax: 65,
    yMin: -21,
    yMax: -16,
    zMin: 18.0,
    zMax: 24.5,
    material: mats.matTerracotta,
    name: "ClassicalWing_South",
  });
  // Cream stone moldings, plinth & cornices
  const corniceSouth = createBoxBounds({
    xMin: -75.5,
    xMax: 65.5,
    yMin: -21.4,
    yMax: -15.8,
    zMin: 24.5,
    zMax: 25.5,
    material: mats.matCream,
  });
  const plinthSouth = createBoxBounds({
    xMin: -75.5,
    xMax: 65.5,
    yMin: -21.4,
    yMax: -15.8,
    zMin: 18.0,
    zMax: 19.2,
    material: mats.matCream,
  });
  surfaceGroup.add(wingSouth, corniceSouth, plinthSouth);

  // North wing
  const wingNorth = createBoxBounds({
    xMin: -75,
    xMax: 65,
    yMin: 16,
    yMax: 21,
    zMin: 18.0,
    zMax: 24.5,
    material: mats.matTerracotta,
    name: "ClassicalWing_North",
  });
  const corniceNorth = createBoxBounds({
    xMin: -75.5,
    xMax: 65.5,
    yMin: 15.8,
    yMax: 21.4,
    zMin: 24.5,
    zMax: 25.5,
    material: mats.matCream,
  });
  const plinthNorth = createBoxBounds({
    xMin: -75.5,
    xMax: 65.5,
    yMin: 15.8,
    yMax: 21.4,
    zMin: 18.0,
    zMax: 19.2,
    material: mats.matCream,
  });
  surfaceGroup.add(wingNorth, corniceNorth, plinthNorth);

  // Arched Front Facade with Stained-Glass Lunette (x = -75)
  const facadeGroup = new THREE.Group();
  facadeGroup.name = "FrontNeoRenaissanceFacade";

  // Monumental cream stone arch surround
  const frontArch = createSemiCircularVaultMesh({
    length: 2.5,
    width: 32,
    peakHeight: 12.0,
    baseHeight: 24.0,
    thickness: 2.2,
    material: mats.matCream,
    name: "FrontArchSurround",
  });
  frontArch.position.x = -74.5;
  facadeGroup.add(frontArch);

  // Stained-glass semi-circular lunette window (0x5d8da8, opacity 0.65, transparent)
  const lunetteGlass = createSemiCircularVaultMesh({
    length: 0.6,
    width: 27.6,
    peakHeight: 10.8,
    baseHeight: 24.0,
    thickness: 10.8, // filled fan window
    material: mats.matGlass,
    name: "StainedGlassLunette",
  });
  lunetteGlass.position.x = -74.2;
  facadeGroup.add(lunetteGlass);

  // Lower entrance portico colonnade at ground
  const porticoCanopy = createBoxBounds({
    xMin: -77.5,
    xMax: -73.5,
    yMin: -16,
    yMax: 16,
    zMin: 23.0,
    zMax: 24.2,
    material: mats.matCream,
    name: "PorticoCanopy",
  });
  facadeGroup.add(porticoCanopy);

  for (const py of [-14, -9.5, -5, 0, 5, 9.5, 14]) {
    const colGeom = new THREE.CylinderGeometry(0.55, 0.65, 5.0, 12);
    colGeom.translate(-76.5, py, 20.5);
    facadeGroup.add(createMesh(colGeom, mats.matCream));
  }

  // Historic Terminal Clock Face (0xd4af37 bezel, 0xffffff dial)
  const clockGroup = new THREE.Group();
  clockGroup.name = "TerminalClock";

  const clockX = -75.8;
  const clockY = 0;
  const clockZ = 34.0;
  const clockRadius = 1.8;

  // Gold bezel
  const bezelGeom = new THREE.TorusGeometry(clockRadius, 0.22, 12, 32);
  bezelGeom.rotateY(Math.PI / 2);
  bezelGeom.translate(clockX, clockY, clockZ);
  clockGroup.add(createMesh(bezelGeom, mats.matClockGold, "ClockGoldBezel"));

  // White dial face
  const dialGeom = new THREE.CylinderGeometry(clockRadius, clockRadius, 0.15, 32);
  dialGeom.rotateZ(Math.PI / 2);
  dialGeom.translate(clockX + 0.05, clockY, clockZ);
  clockGroup.add(createMesh(dialGeom, mats.matClockDial, "ClockDialFace"));

  // Hour & minute hands
  const hourHand = createBoxBounds({
    xMin: clockX - 0.12,
    xMax: clockX - 0.02,
    yMin: -0.1,
    yMax: 0.1,
    zMin: clockZ,
    zMax: clockZ + 0.9,
    material: mats.matClockMark,
  });
  const minuteHand = createBoxBounds({
    xMin: clockX - 0.16,
    xMax: clockX - 0.04,
    yMin: 0,
    yMax: 1.25,
    zMin: clockZ - 0.08,
    zMax: clockZ + 0.08,
    material: mats.matClockMark,
  });
  clockGroup.add(hourHand, minuteHand);

  facadeGroup.add(clockGroup);
  surfaceGroup.add(facadeGroup);

  root.add(surfaceGroup);
  return root;
}

// =========================================================================
// 5. Mo Chit Station (BTS Elevated Hub & MRT Chatuchak Connection)
// =========================================================================

export function buildMoChitScene() {
  const root = new THREE.Group();
  root.name = "MoChitStation";
  const mats = createSharedMaterials();

  // 5.1 Dual Side Platforms (150 m × 22 m, z = -1.2 to 0) with Central Track Trough
  const platformGroup = new THREE.Group();
  platformGroup.name = "PlatformLevel";

  // South side platform (y = -11.0 to -5.5)
  const southPlatform = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: -11.0,
    yMax: -5.5,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "SouthSidePlatform",
  });
  // North side platform (y = 5.5 to 11.0)
  const northPlatform = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: 5.5,
    yMax: 11.0,
    zMin: -1.2,
    zMax: 0,
    material: mats.matPlatform,
    name: "NorthSidePlatform",
  });
  platformGroup.add(southPlatform, northPlatform);

  // Central track trough (y = -5.5 to 5.5, z = -2.0 to -0.6)
  const trackTrough = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: -5.5,
    yMax: 5.5,
    zMin: -2.0,
    zMax: -0.6,
    material: mats.matBallast,
    name: "CentralTrackTrough",
  });
  // Concrete track plinth beams
  const trackBeamSouth = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: -3.2,
    yMax: -1.8,
    zMin: -0.6,
    zMax: -0.2,
    material: mats.matSteel,
  });
  const trackBeamNorth = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: 1.8,
    yMax: 3.2,
    zMin: -0.6,
    zMax: -0.2,
    material: mats.matSteel,
  });
  platformGroup.add(trackTrough, trackBeamSouth, trackBeamNorth);

  // Yellow tactile strips along inner platform edges
  const tactileSouth = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: -5.8,
    yMax: -5.4,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "TactileStrip_South",
  });
  const tactileNorth = createBoxBounds({
    xMin: -75,
    xMax: 75,
    yMin: 5.4,
    yMax: 5.8,
    zMin: 0,
    zMax: 0.04,
    material: mats.matYellowStrip,
    name: "TactileStrip_North",
  });
  platformGroup.add(tactileSouth, tactileNorth);

  // Outer safety glazed balustrades
  const balustradeSouth = createBoxBounds({
    xMin: -74,
    xMax: 74,
    yMin: -11.0,
    yMax: -10.85,
    zMin: 0,
    zMax: 1.35,
    material: mats.matGlass,
  });
  const balustradeNorth = createBoxBounds({
    xMin: -74,
    xMax: 74,
    yMin: 10.85,
    yMax: 11.0,
    zMin: 0,
    zMax: 1.35,
    material: mats.matGlass,
  });
  platformGroup.add(balustradeSouth, balustradeNorth);

  root.add(platformGroup);

  // 5.2 Lower Concourse Deck (140 m × 22 m, z = -6.0 to -4.8)
  const concourseGroup = new THREE.Group();
  concourseGroup.name = "ConcourseLevel";

  const concourseSlab = createBoxBounds({
    xMin: -70,
    xMax: 70,
    yMin: -11,
    yMax: 11,
    zMin: -6.0,
    zMax: -4.8,
    material: mats.matConcrete,
    name: "ConcourseSlab",
  });
  concourseGroup.add(concourseSlab);

  // Glazed concourse sidewalls
  const concourseGlassSouth = createBoxBounds({
    xMin: -68,
    xMax: 68,
    yMin: -10.9,
    yMax: -10.6,
    zMin: -4.8,
    zMax: -1.6,
    material: mats.matGlass,
  });
  const concourseGlassNorth = createBoxBounds({
    xMin: -68,
    xMax: 68,
    yMin: 10.6,
    yMax: 10.9,
    zMin: -4.8,
    zMax: -1.6,
    material: mats.matGlass,
  });
  concourseGroup.add(concourseGlassSouth, concourseGlassNorth);

  // Vertical stair & escalator cores to platforms
  for (const cx of [-35, 35]) {
    const stairSouth = createBoxBounds({
      xMin: cx - 4,
      xMax: cx + 4,
      yMin: -9.5,
      yMax: -7.0,
      zMin: -4.8,
      zMax: 0,
      material: mats.matConcrete,
    });
    const stairNorth = createBoxBounds({
      xMin: cx - 4,
      xMax: cx + 4,
      yMin: 7.0,
      yMax: 9.5,
      zMin: -4.8,
      zMax: 0,
      material: mats.matConcrete,
    });
    concourseGroup.add(stairSouth, stairNorth);
  }

  root.add(concourseGroup);

  // 5.3 Arched Canopy Roof (156 m × 25 m, peak z = 7.5) with BTS Green Fascia Trim
  const roofGroup = new THREE.Group();
  roofGroup.name = "ArchedCanopyRoof";

  const roofShell = createBarrelVaultMesh({
    length: 156,
    width: 25,
    peakHeight: 5.5,
    baseHeight: 2.0, // 2.0 + 5.5 = 7.5 apex
    thickness: 0.5,
    material: mats.matRoof,
    name: "CanopyRoofVault",
  });
  roofGroup.add(roofShell);

  // Central longitudinal glass skylight ribbon
  const skylight = createCurvedSkylightMesh({
    length: 152,
    ribbonWidth: 5,
    archWidth: 25,
    peakHeight: 5.5,
    baseHeight: 2.0,
    material: mats.matGlass,
    name: "CanopySkylight",
  });
  roofGroup.add(skylight);

  // BTS green (0x7cb342) fascia trim along roof eaves
  const trimGreenSouth = createBoxBounds({
    xMin: -78.2,
    xMax: 78.2,
    yMin: -12.9,
    yMax: -12.3,
    zMin: 1.8,
    zMax: 2.8,
    material: mats.matBtsGreen,
    name: "Fascia_BtsGreen_South",
  });
  const trimGreenNorth = createBoxBounds({
    xMin: -78.2,
    xMax: 78.2,
    yMin: 12.3,
    yMax: 12.9,
    zMin: 1.8,
    zMax: 2.8,
    material: mats.matBtsGreen,
    name: "Fascia_BtsGreen_North",
  });
  roofGroup.add(trimGreenSouth, trimGreenNorth);

  // Structural transverse ribs
  for (const rx of [-60, -35, -10, 15, 40, 65]) {
    const rib = createBoxBounds({
      xMin: rx - 0.6,
      xMax: rx + 0.6,
      yMin: -12.7,
      yMax: 12.7,
      zMin: 7.2,
      zMax: 7.8,
      material: mats.matRoofRib,
    });
    roofGroup.add(rib);
  }

  root.add(roofGroup);

  // 5.4 Central Spine Piers (z = -15 to 0)
  const pierGroup = new THREE.Group();
  pierGroup.name = "CentralSpinePiers";

  const pierXPositions = [-60, -40, -20, 0, 20, 40, 60];
  for (const px of pierXPositions) {
    // Ground foundation footing
    const footing = createBoxBounds({
      xMin: px - 2.5,
      xMax: px + 2.5,
      yMin: -2.5,
      yMax: 2.5,
      zMin: -15.5,
      zMax: -14.5,
      material: mats.matPlinth,
    });
    // Heavy single central spine pier
    const spineColumn = createBoxBounds({
      xMin: px - 1.4,
      xMax: px + 1.4,
      yMin: -1.4,
      yMax: 1.4,
      zMin: -15.0,
      zMax: -6.0,
      material: mats.matConcrete,
      name: `SpinePier_${px}`,
    });
    // Cantilever hammerhead crosshead supporting concourse slab
    const hammerhead = createBoxBounds({
      xMin: px - 1.8,
      xMax: px + 1.8,
      yMin: -9.5,
      yMax: 9.5,
      zMin: -7.5,
      zMax: -6.0,
      material: mats.matConcrete,
      name: `HammerheadBent_${px}`,
    });
    // Upper spine section continuing to track trough
    const upperSpine = createBoxBounds({
      xMin: px - 1.2,
      xMax: px + 1.2,
      yMin: -1.2,
      yMax: 1.2,
      zMin: -4.8,
      zMax: -2.0,
      material: mats.matConcrete,
    });
    pierGroup.add(footing, spineColumn, hammerhead, upperSpine);
  }

  root.add(pierGroup);

  // 5.5 Pedestrian Skywalk Bridges with Ground-Level MRT Entrance Pavilions (z = -15 to -11.5)
  const skywalkMrtGroup = new THREE.Group();
  skywalkMrtGroup.name = "SkywalksAndMrtPavilions";

  // East Skywalk (Chatuchak Park side)
  const skywalkEastDeck = createBoxBounds({
    xMin: 16,
    xMax: 24,
    yMin: 11,
    yMax: 32,
    zMin: -5.5,
    zMax: -5.0,
    material: mats.matConcrete,
  });
  const skywalkEastGlass = createBoxBounds({
    xMin: 15.9,
    xMax: 24.1,
    yMin: 11,
    yMax: 32,
    zMin: -5.0,
    zMax: -3.4,
    material: mats.matGlass,
  });
  const skywalkEastRoof = createBoxBounds({
    xMin: 15.7,
    xMax: 24.3,
    yMin: 11,
    yMax: 32,
    zMin: -3.4,
    zMax: -3.0,
    material: mats.matRoof,
  });
  // Stair tower descending to ground (z = -15)
  const stairTowerEast = createBoxBounds({
    xMin: 17,
    xMax: 23,
    yMin: 28,
    yMax: 32,
    zMin: -15.0,
    zMax: -5.0,
    material: mats.matConcrete,
  });
  skywalkMrtGroup.add(skywalkEastDeck, skywalkEastGlass, skywalkEastRoof, stairTowerEast);

  // West Skywalk (Phahonyothin road side)
  const skywalkWestDeck = createBoxBounds({
    xMin: -24,
    xMax: -16,
    yMin: -32,
    yMax: -11,
    zMin: -5.5,
    zMax: -5.0,
    material: mats.matConcrete,
  });
  const skywalkWestGlass = createBoxBounds({
    xMin: -24.1,
    xMax: -15.9,
    yMin: -32,
    yMax: -11,
    zMin: -5.0,
    zMax: -3.4,
    material: mats.matGlass,
  });
  const skywalkWestRoof = createBoxBounds({
    xMin: -24.3,
    xMax: -15.7,
    yMin: -32,
    yMax: -11,
    zMin: -3.4,
    zMax: -3.0,
    material: mats.matRoof,
  });
  const stairTowerWest = createBoxBounds({
    xMin: -23,
    xMax: -17,
    yMin: -32,
    yMax: -28,
    zMin: -15.0,
    zMax: -5.0,
    material: mats.matConcrete,
  });
  skywalkMrtGroup.add(skywalkWestDeck, skywalkWestGlass, skywalkWestRoof, stairTowerWest);

  // Ground-level MRT Entrance Pavilions (z = -15 to -11.5)
  // East Pavilion (MRT Chatuchak Park Exit 1)
  const mrtEastBase = createBoxBounds({
    xMin: 15,
    xMax: 25,
    yMin: 32,
    yMax: 44,
    zMin: -15.4,
    zMax: -14.6,
    material: mats.matPlinth,
  });
  const mrtEastGlass = createBoxBounds({
    xMin: 15.2,
    xMax: 24.8,
    yMin: 32.2,
    yMax: 43.8,
    zMin: -14.6,
    zMax: -12.0,
    material: mats.matGlass,
  });
  // Slanted curved glass entrance canopy with MRT blue trim
  const mrtEastCanopy = createBoxBounds({
    xMin: 14.8,
    xMax: 25.2,
    yMin: 31.8,
    yMax: 44.2,
    zMin: -12.0,
    zMax: -11.5,
    material: mats.matMrtBlue,
    name: "MrtPavilionCanopy_East",
  });
  skywalkMrtGroup.add(mrtEastBase, mrtEastGlass, mrtEastCanopy);

  // West Pavilion (MRT Chatuchak Park Exit 2)
  const mrtWestBase = createBoxBounds({
    xMin: -25,
    xMax: -15,
    yMin: -44,
    yMax: -32,
    zMin: -15.4,
    zMax: -14.6,
    material: mats.matPlinth,
  });
  const mrtWestGlass = createBoxBounds({
    xMin: -24.8,
    xMax: -15.2,
    yMin: -43.8,
    yMax: -32.2,
    zMin: -14.6,
    zMax: -12.0,
    material: mats.matGlass,
  });
  const mrtWestCanopy = createBoxBounds({
    xMin: -25.2,
    xMax: -14.8,
    yMin: -44.2,
    yMax: -31.8,
    zMin: -12.0,
    zMax: -11.5,
    material: mats.matMrtBlue,
    name: "MrtPavilionCanopy_West",
  });
  skywalkMrtGroup.add(mrtWestBase, mrtWestGlass, mrtWestCanopy);

  root.add(skywalkMrtGroup);
  return root;
}

// =========================================================================
// GLTF Exporter & Batch Runner
// =========================================================================

export async function exportGlb(scene, outputPath) {
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

export async function exportAllLandmarkModels(outputDir = path.resolve("public/models")) {
  const targets = [
    { name: "siam", file: "siam.glb", builder: buildSiamScene },
    { name: "suvarnabhumi", file: "suvarnabhumi.glb", builder: buildSuvarnabhumiScene },
    { name: "makkasan", file: "makkasan.glb", builder: buildMakkasanScene },
    { name: "hua-lamphong", file: "hua-lamphong.glb", builder: buildHuaLamphongScene },
    { name: "mo-chit", file: "mo-chit.glb", builder: buildMoChitScene },
  ];

  const results = [];
  for (const t of targets) {
    const scene = t.builder();
    const dest = path.join(outputDir, t.file);
    const { byteLength } = await exportGlb(scene, dest);
    results.push({ name: t.name, file: t.file, path: dest, byteLength });
  }
  return results;
}

// Direct execution CLI
if (process.argv[1] && process.argv[1].endsWith("generate-landmark-models.mjs")) {
  console.log("Generating 5 stylized 3D landmark station models in public/models/...");
  exportAllLandmarkModels()
    .then((results) => {
      console.log(`\nSuccessfully generated ${results.length} landmark GLB models:`);
      for (const r of results) {
        console.log(`  ✓ ${r.file} -> ${(r.byteLength / 1024).toFixed(1)} KB (${r.byteLength} bytes)`);
      }
    })
    .catch((err) => {
      console.error("Failed to generate models:", err);
      process.exit(1);
    });
}
