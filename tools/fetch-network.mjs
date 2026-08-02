#!/usr/bin/env node
/**
 * Fetch every registry line's track geometry + stations from OpenStreetMap via
 * the Overpass API into src/data/network.json.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 — attribution is rendered in the
 * app's map attribution control.
 *
 * Usage: node tools/fetch-network.mjs [lineKey ...]   (default: all lines)
 *
 * A line with `osm.relationId: null` is DISCOVERED by `osm.match` against
 * relation names in the Bangkok bbox; the resolved id is printed so it can be
 * pinned back into tools/lines.config.mjs. Discovery is for bootstrapping a new
 * line only — committed data must come from a pinned id, or the geometry
 * silently changes when OSM does.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRegistryValid,
  INTERCHANGE_OVERRIDES,
  LINES,
  STRUCTURE_ALTITUDE_M,
  structureOfWay,
} from "./lines.config.mjs";
import { limitTrackGradient, nearestTrackAltitude } from "./trackProfile.mjs";

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/network.json");

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let lastError;
  // Two full passes over the mirror list: transient 429/504 overload on every
  // mirror at once (observed in practice — all four mirrors are apparently
  // sharing load today) usually clears within a minute, so a bare single
  // pass gives up too early. A short backoff between passes, not between
  // individual mirrors, keeps the common case (first mirror healthy) fast.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      console.warn(`  all mirrors failed once, waiting 30s before retrying...`);
      await sleep(30_000);
    }
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "User-Agent": "tha-metro-mini-3d/0.1 (data preprocessing)" },
          // The query itself carries a server-side [timeout:60], but that
          // only bounds Overpass's own execution — a mirror that accepts the
          // TCP connection and then never sends a response (rather than an
          // HTTP error) can otherwise hang the client forever. Bound it
          // client-side too so a stalled mirror fails over instead of
          // wedging the whole run.
          signal: AbortSignal.timeout(75_000),
        });
        const text = await res.text();
        if (!res.ok || text.trimStart().startsWith("<")) {
          throw new Error(`${url}: HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        console.warn(`Overpass mirror failed, trying next: ${err.message}`);
      }
    }
  }
  throw lastError;
}

/** Greedily stitch unordered way segments into one continuous polyline.
 *  Each point carries the structure classification of the way it came from. */
function stitchWays(ways, tagsByWay, defaultStructure) {
  const segments = ways.map((w) => {
    const structure = structureOfWay(tagsByWay.get(String(w.ref)) ?? {}, defaultStructure);
    return w.geometry.map((p) => [p.lon, p.lat, structure]);
  });
  if (segments.length === 0) return [];
  const path = segments.shift();
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4; // ~10 m

  while (segments.length > 0) {
    const head = path[0];
    const tail = path[path.length - 1];
    let bestIdx = -1;
    let bestMode = null;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (near(tail, s[0])) { bestIdx = i; bestMode = "append"; break; }
      if (near(tail, s[s.length - 1])) { bestIdx = i; bestMode = "appendRev"; break; }
      if (near(head, s[s.length - 1])) { bestIdx = i; bestMode = "prepend"; break; }
      if (near(head, s[0])) { bestIdx = i; bestMode = "prependRev"; break; }
    }
    if (bestIdx === -1) {
      // No touching segment (parallel track of the opposite direction,
      // depot spur, etc.) — drop the remainder rather than jumping gaps.
      break;
    }
    const seg = segments.splice(bestIdx, 1)[0];
    if (bestMode === "append") path.push(...seg.slice(1));
    else if (bestMode === "appendRev") path.push(...seg.reverse().slice(1));
    else if (bestMode === "prepend") path.unshift(...seg.slice(0, -1));
    else path.unshift(...seg.reverse().slice(0, -1));
  }
  return path;
}

/** Drop consecutive duplicate points. */
function dedupe(coords) {
  return coords.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - coords[i - 1][0], p[1] - coords[i - 1][1]) > 1e-7,
  );
}

async function fetchBranch(relationId, branchKey, defaultStructure) {
  const data = await overpass(`[out:json][timeout:90];relation(${relationId});out geom;`);
  const rel = data.elements.find((e) => e.type === "relation");
  if (!rel) throw new Error(`Relation ${relationId} not found`);

  const trackWays = rel.members.filter(
    (m) => m.type === "way" && m.role === "" && m.geometry,
  );

  // Way tags are NOT included in an `out geom` member list (same gotcha as
  // the node tags below) — fetch them for every track way in one follow-up
  // query so each segment can be classified underground/elevated/at-grade.
  const wayIds = trackWays.map((w) => String(w.ref)).join(",");
  let tagsByWay = new Map();
  if (wayIds.length > 0) {
    const wayData = await overpass(`[out:json][timeout:90];way(id:${wayIds});out tags;`);
    // String() both sides: Overpass returns numeric ids, and a number-vs-string
    // key mismatch makes every lookup miss silently (this exact bug blanked
    // all 155 station names in MVP 5 before it was caught).
    tagsByWay = new Map(wayData.elements.map((e) => [String(e.id), e.tags ?? {}]));
  }
  // stitchWays falls back to `defaultStructure` via `?? {}` for any way this
  // follow-up query didn't return tags for — silently, since a way with
  // genuinely no bridge/tunnel/layer/embankment/covered tags looks the same
  // as one Overpass just dropped. A size mismatch here means the response
  // was truncated or partial, which would otherwise misclassify structure
  // for real track without any signal (review finding, PR #8).
  if (tagsByWay.size !== trackWays.length) {
    console.warn(
      `  warning: ${branchKey}: got tags for ${tagsByWay.size}/${trackWays.length} track ways — ` +
        `Overpass may have returned a truncated response; missing ways fall back to '${defaultStructure}'`,
    );
  }

  const path = dedupe(stitchWays(trackWays, tagsByWay, defaultStructure));

  // Candidate stop/platform node members: PTv2 route relations mark these
  // either with an explicit role starting "stop"/"platform", OR with an
  // empty role and a public_transport=stop_position/station/platform tag
  // instead (confirmed live: relation 2067854 "Silom" has 14 node members,
  // only 3 with role=stop — the other 11 are role="" but are real, named
  // railway=station nodes; filtering on role alone silently dropped them).
  // Tags aren't present on member nodes in this `out geom` response
  // (verified live), so cast a wide net here on role + lat/lon, and let the
  // tag-based check below (after the second query) do the real filtering.
  const candidates = rel.members
    .filter((m) => m.type === "node" && m.lat != null)
    // Stringify: Overpass returns node refs as JSON numbers, but the Rust
    // preprocessor's NetworkStation.id is a String (it's compared against
    // GTFS stop_id strings for the code/name lookup) — a bare number here
    // fails deserialization with "invalid type: integer, expected a string".
    .map((m) => ({ id: String(m.ref), role: m.role, lon: m.lon, lat: m.lat }));

  // stop_position/station nodes carry no tags via `out geom` members —
  // fetch tags for every candidate in one follow-up query, then filter.
  const ids = candidates.map((s) => s.id).join(",");
  let byId = new Map();
  if (ids.length > 0) {
    const nodeData = await overpass(`[out:json][timeout:60];node(id:${ids});out;`);
    // Key on String(e.id): Overpass returns numeric ids here too, and a
    // number-vs-string key mismatch against candidates' string ids would
    // make every lookup miss silently (byId.get() found nothing, so every
    // station fell back to "" name/code — this broke ALL 155 stations'
    // OSM-sourced names/codes network-wide before this fix).
    byId = new Map(nodeData.elements.map((e) => [String(e.id), e.tags ?? {}]));
  }

  const STOP_LIKE = new Set(["stop_position", "station", "platform"]);
  const stations = candidates.filter((s) => {
    if (/^stop/.test(s.role)) return true;
    const pt = byId.get(s.id)?.public_transport;
    return typeof pt === "string" && STOP_LIKE.has(pt);
  });
  for (const s of stations) {
    const tags = byId.get(s.id) ?? {};
    s.name = tags["name:en"] ?? tags.name ?? "";
    s.nameTh = tags["name:th"] ?? tags.name ?? "";
    s.code = tags.ref ?? "";
  }

  // Per-line structure histogram so a mis-tagged relation is obvious at
  // fetch time (e.g. a whole line coming back as pure "elevated" when it's
  // known to dive underground somewhere).
  const histogram = path.reduce((acc, p) => {
    acc[p[2]] = (acc[p[2]] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `${branchKey}: relation ${relationId} "${rel.tags?.name ?? ""}" — ` +
      `${trackWays.length} ways -> ${path.length} points ` +
      `(${Object.entries(histogram).map(([k, v]) => `${k}:${v}`).join(" ")}), ` +
      `${stations.length} stops`,
  );
  // Step-function altitude straight from STRUCTURE_ALTITUDE_M, per point —
  // this is what a raw OSM tag flip produces (e.g. a 108% grade wall where
  // an untagged way meets a tunnel=yes way). limitTrackGradient turns that
  // into a physically plausible ramp (MVP 6 Task 13, defect A) without
  // touching lon/lat/structure — see tools/trackProfile.mjs.
  const rawTrack = path.map(([lon, lat, structure]) => [
    lon,
    lat,
    STRUCTURE_ALTITUDE_M[structure],
    structure,
  ]);
  const track = limitTrackGradient(rawTrack);

  // Station altitude still defaults to the line's blanket nominal value
  // (STRUCTURE_ALTITUDE_M[defaultStructure]) — a station's own OSM node
  // carries no tunnel/bridge/layer tag to classify against, same as before
  // Task 13. The one narrow addition: if a station's nearest track point is
  // itself inside a ramp zone (its altitude changed between rawTrack and
  // the limited track), resample the station from the ramped value instead,
  // so its pole reaches the ramped deck rather than a stale nominal one.
  // Deliberately scoped this narrowly rather than "always resample from the
  // nearest ramped point": that broader version would also silently fix a
  // much bigger, separate pre-existing issue (every station on a
  // mixed-structure line like Blue currently renders at the line's single
  // nominal altitude regardless of whether that specific station is
  // actually underground) — real, but out of Task 13's scope; see the
  // Task 13 report.
  const stationAltitudeM = STRUCTURE_ALTITUDE_M[defaultStructure];
  return {
    relationId,
    osmName: rel.tags?.name ?? "",
    // [lon, lat, altitude_m, structure] per SRS §F1.3, structure per-point
    track,
    stations: stations.map((s) => {
      const { index } = nearestTrackAltitude(s.lon, s.lat, track);
      const onRamp = index >= 0 && rawTrack[index][2] !== track[index][2];
      const altitude = onRamp ? track[index][2] : stationAltitudeM;
      return {
        id: s.id,
        name: s.name ?? "",
        nameTh: s.nameTh ?? "",
        code: s.code ?? "",
        position: [s.lon, s.lat, altitude],
      };
    }),
  };
}

/** Resolve a relation id from `osm.match` when none is pinned. */
async function discoverRelationId(line) {
  // Under-construction alignments (MRT Orange, Purple Phase 2) are tagged
  // route=construction + construction:route=subway, NOT route=subway — the
  // operational-only filter never matches them.
  const data = await overpass(
    `[out:json][timeout:90];
     (
       relation["route"~"train|light_rail|subway|monorail"](13.4,100.2,14.3,101.0);
       relation["construction:route"~"train|light_rail|subway|monorail"](13.4,100.2,14.3,101.0);
       relation["proposed:route"~"train|light_rail|subway|monorail"](13.4,100.2,14.3,101.0);
     );
     out tags;`,
  );
  const candidates = data.elements.filter(
    (e) =>
      (e.tags?.type === "route" || e.tags?.type === "construction:route") &&
      line.osm.match.test(`${e.tags["name:en"] ?? ""} ${e.tags.name ?? ""}`) &&
      !/supplementary/i.test(e.tags["name:en"] ?? ""),
  );
  console.log(`${line.key}: ${candidates.length} candidate relation(s)`);
  for (const c of candidates) {
    console.log(`  ${c.id} | ${c.tags["name:en"] ?? c.tags.name} | ${c.tags.route ?? c.tags["construction:route"]}`);
  }
  if (candidates.length === 0) throw new Error(`${line.key}: no relation matched ${line.osm.match}`);
  // Route relations come in directional pairs — either variant's track is fine.
  console.log(`  -> pin osm.relationId: ${candidates[0].id} in tools/lines.config.mjs`);
  return candidates[0].id;
}

async function main() {
  assertRegistryValid();
  const only = process.argv.slice(2);
  const selected = only.length > 0 ? LINES.filter((l) => only.includes(l.key)) : LINES;
  if (selected.length === 0) throw new Error(`no registry line matches ${only.join(", ")}`);

  const lines = [];
  for (const line of LINES) {
    if (!selected.includes(line)) continue;
    const relationId = line.osm.relationId ?? (await discoverRelationId(line));
    const geom = await fetchBranch(relationId, line.key, line.structure);
    lines.push({
      key: line.key,
      name: line.name,
      nameTh: line.nameTh,
      color: line.color,
      structure: line.structure,
      vehicleType: line.vehicleType,
      gtfsRouteId: line.gtfsRouteId,
      preRevenue: line.preRevenue,
      excludeGtfsStopIds: line.excludeGtfsStopIds ?? [],
      allowLargeSnapStopIds: line.allowLargeSnapStopIds ?? [],
      ...geom,
    });
  }

  const out = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL 1.0",
    lines,
    interchangeOverrides: INTERCHANGE_OVERRIDES,
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote ${OUT_PATH} (${lines.length} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
