import { describe, expect, it } from "vitest";
import * as THREE from "three";
import networkData from "../data/network.json";
import type { NetworkData } from "../types";
import { materialAlbedo } from "./materialAlbedo";
import {
  buildArchetypeGeometries,
  resolveStationArchetype,
  type StationArchetype,
} from "./stationArchetypes";
import { buildStationGeometry, STATION_DIMENSIONS } from "./stationGeometry";

const ALL_ARCHETYPES: StationArchetype[] = [
  "bts-skytrain",
  "mrt-elevated",
  "mrt-underground",
  "monorail",
  "arl-commuter",
  "srt-elevated",
  "srt-at-grade",
  "apm-elevated",
  "apm-underground",
];

describe("resolveStationArchetype", () => {
  it("maps every Bangkok transit line to its authentic architectural archetype", () => {
    expect(resolveStationArchetype({ key: "sukhumvit", vehicleType: "heavy" }, "elevated")).toBe("bts-skytrain");
    expect(resolveStationArchetype({ key: "silom", vehicleType: "heavy" }, "elevated")).toBe("bts-skytrain");
    expect(resolveStationArchetype({ key: "blue", vehicleType: "heavy" }, "elevated")).toBe("mrt-elevated");
    expect(resolveStationArchetype({ key: "blue", vehicleType: "heavy" }, "underground")).toBe("mrt-underground");
    expect(resolveStationArchetype({ key: "purple", vehicleType: "heavy" }, "elevated")).toBe("mrt-elevated");
    expect(resolveStationArchetype({ key: "pink", vehicleType: "monorail" }, "elevated")).toBe("monorail");
    expect(resolveStationArchetype({ key: "pink-spur", vehicleType: "monorail" }, "elevated")).toBe("monorail");
    expect(resolveStationArchetype({ key: "yellow", vehicleType: "monorail" }, "elevated")).toBe("monorail");
    expect(resolveStationArchetype({ key: "arl", vehicleType: "commuter" }, "elevated")).toBe("arl-commuter");
    expect(resolveStationArchetype({ key: "arl", vehicleType: "commuter" }, "underground")).toBe("mrt-underground");
    expect(resolveStationArchetype({ key: "red-dark", vehicleType: "commuter" }, "elevated")).toBe("srt-elevated");
    expect(resolveStationArchetype({ key: "red-dark", vehicleType: "commuter" }, "atGrade")).toBe("srt-at-grade");
    expect(resolveStationArchetype({ key: "red-light", vehicleType: "commuter" }, "atGrade")).toBe("srt-at-grade");
    expect(resolveStationArchetype({ key: "gold", vehicleType: "apm" }, "elevated")).toBe("apm-elevated");
    expect(resolveStationArchetype({ key: "apm", vehicleType: "apm" }, "underground")).toBe("apm-underground");
  });
});

describe("buildArchetypeGeometries", () => {
  it.each(ALL_ARCHETYPES)("builds finite, vertex-colored parts for %s", (archetype) => {
    const dims =
      archetype === "monorail"
        ? STATION_DIMENSIONS.monorail
        : archetype.startsWith("apm")
          ? STATION_DIMENSIONS.apm
          : STATION_DIMENSIONS.heavy;

    const { platform, canopy, trim, pillar } = buildArchetypeGeometries(archetype, dims);

    for (const geo of [platform, canopy, trim, pillar]) {
      const pos = geo.getAttribute("position");
      const norm = geo.getAttribute("normal");
      const col = geo.getAttribute("color");
      expect(pos.count).toBeGreaterThan(12);
      expect(norm.count).toBe(pos.count);
      expect(col.count).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) {
        expect(Number.isFinite(pos.array[i])).toBe(true);
      }
    }

    // Normalized pillar geometry must remain within z in [-0.5, 0.5] so poleTransform(z)
    // maps cleanly between ground (z = 0) and platform elevation.
    pillar.computeBoundingBox();
    expect(pillar.boundingBox!.min.z).toBeGreaterThanOrEqual(-0.501);
    expect(pillar.boundingBox!.max.z).toBeLessThanOrEqual(0.501);

    platform.dispose();
    canopy.dispose();
    trim.dispose();
    pillar.dispose();
  });

  it("gives distinct silhouettes to BTS, MRT elevated, Monorail, and SRT stations", () => {
    const bts = buildArchetypeGeometries("bts-skytrain", STATION_DIMENSIONS.heavy);
    const mrt = buildArchetypeGeometries("mrt-elevated", STATION_DIMENSIONS.heavy);
    const mono = buildArchetypeGeometries("monorail", STATION_DIMENSIONS.monorail);
    const srt = buildArchetypeGeometries("srt-elevated", STATION_DIMENSIONS.commuter);

    expect(bts.canopy.getAttribute("position").count).not.toBe(mrt.canopy.getAttribute("position").count);
    expect(mono.pillar.getAttribute("position").count).not.toBe(bts.pillar.getAttribute("position").count);
    srt.platform.computeBoundingBox();
    bts.platform.computeBoundingBox();
    expect(srt.platform.boundingBox!.max.x - srt.platform.boundingBox!.min.x).toBeGreaterThan(
      bts.platform.boundingBox!.max.x - bts.platform.boundingBox!.min.x,
    );

    for (const set of [bts, mrt, mono, srt]) {
      set.platform.dispose();
      set.canopy.dispose();
      set.trim.dispose();
      set.pillar.dispose();
    }
  });
});

describe("network.json archetype station integration", () => {
  it("builds instanced archetype geometry with albedo stamps for every station-bearing line", () => {
    const net = networkData as unknown as NetworkData;
    for (const line of net.lines) {
      const group = buildStationGeometry(line.stations, line);
      if (line.stations.length === 0) {
        expect(group.children).toHaveLength(0);
        continue;
      }
      expect(group.children.length).toBeGreaterThanOrEqual(4);
      const lineHex = new THREE.Color(line.color).getHex();
      for (const child of group.children) {
        const mesh = child as THREE.InstancedMesh;
        expect(mesh.count).toBeGreaterThan(0);
        const mat = mesh.material as THREE.MeshLambertMaterial;
        expect(mat.userData.liveryHex).toBeTypeOf("number");
        if (mesh.userData.isTrim) {
          expect(materialAlbedo(mat)).toBe(lineHex);
        }
      }
    }
  });
});
