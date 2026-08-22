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
 *
 * A line with `osm.wayNamePattern` set (instead of a relation id) is fetched
 * straight from named OSM ways, bypassing the relation layer entirely — for
 * a line whose alignment is real, tagged OSM geometry but has no route
 * relation grouping it yet (MRT Orange, MRT Purple Phase 2 as of 2026-08-04;
 * see fetchBranchFromWayName's own comment for why).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRegistryValid,
  INTERCHANGE_OVERRIDES,
  LINES,
  STRUCTURE_ALTITUDE_M,
} from "./lines.config.mjs";
import {
  limitTrackGradient,
  nearestTrackAltitude,
  stitchWays,
  truncateAtFold,
} from "./trackProfile.mjs";

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/network.json");

/** Bangkok metropolitan area, south,west,north,east — every Overpass query in this file is scoped to it. */
const BBOX = "13.4,100.2,14.3,101.0";

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

/** Drop consecutive duplicate points. */
function dedupe(coords) {
  return coords.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - coords[i - 1][0], p[1] - coords[i - 1][1]) > 1e-7,
  );
}

/**
 * @param {Array<{id: string, nameEn?: string, code?: string}>} extraStationNodes
 *   Station nodes to add on top of whatever the relation's own members supply.
 *   Needed when a route relation carries no stop members at all — the
 *   Suvarnabhumi APM's relation (19955655) is tagged `route=light_rail` but has
 *   ZERO node members, so the member-derived path below finds nothing even
 *   though both of its stations exist in OSM as properly tagged
 *   `railway=station` nodes.
 *
 *   `nameEn`/`code` are overrides for what OSM genuinely lacks (the APM's Main
 *   Terminal node has `name:th` but no `name:en`). POSITIONS ARE NEVER
 *   OVERRIDABLE — they always come from the live node fetch, so this cannot
 *   become a way to hand-place a station from a guessed coordinate. That is
 *   the failure mode the Mo Chit hand-patch turned out to be: a citation to an
 *   untagged node ~270 m from the position it was used to justify.
 */
async function fetchBranch(relationId, branchKey, defaultStructure, extraStationNodes = []) {
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

  const stitched = stitchWays(trackWays, tagsByWay, defaultStructure);
  if (stitched.consumed < stitched.total) {
    console.warn(
      `  warning: ${branchKey}: stitched ${stitched.consumed}/${stitched.total} track ways — ` +
        `the rest didn't touch the main path (parallel opposite-direction track, depot spur, etc.) and were dropped`,
    );
  }
  const path = dedupe(stitched.path);

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

  // Explicitly-listed station nodes (see the extraStationNodes doc above).
  // Positions are unknown at this point — the shared node query below fills
  // them in from OSM, and a node it doesn't return is a hard error rather
  // than a station silently dropped or placed at a made-up coordinate.
  const extraById = new Map(extraStationNodes.map((s) => [String(s.id), s]));
  for (const id of extraById.keys()) {
    if (!candidates.some((c) => c.id === id)) {
      candidates.push({ id, role: "stop", lon: null, lat: null });
    }
  }

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
    // Positions for the explicitly-listed nodes, which have none yet.
    const posById = new Map(nodeData.elements.map((e) => [String(e.id), [e.lon, e.lat]]));
    for (const c of candidates) {
      if (c.lat != null) continue;
      const pos = posById.get(c.id);
      if (!pos) {
        throw new Error(
          `${branchKey}: extraStationNodeIds names node ${c.id}, which OSM did not return — ` +
            `check the id; a station is never placed from a registry-supplied coordinate`,
        );
      }
      [c.lon, c.lat] = pos;
    }
  }

  const STOP_LIKE = new Set(["stop_position", "station", "platform"]);
  const stations = candidates.filter((s) => {
    // An explicitly-named node always survives. It was named in the registry
    // precisely because the relation's own members can't be relied on, so
    // dropping it here would silently ignore that instruction. This matters
    // for a node that IS already a relation member with an empty role: it
    // skips the force-add above, then this filter tests `public_transport`
    // only — so a real `railway=station` node that happens to carry no
    // `public_transport` tag would vanish with no error, unlike the
    // not-returned-by-OSM case below which hard-fails.
    if (extraById.has(s.id)) return true;
    if (/^stop/.test(s.role)) return true;
    const pt = byId.get(s.id)?.public_transport;
    return typeof pt === "string" && STOP_LIKE.has(pt);
  });
  for (const s of stations) {
    const tags = byId.get(s.id) ?? {};
    const override = extraById.get(s.id) ?? {};
    // Override only where OSM has nothing — never silently rename a station
    // OSM already labels in English.
    s.name = tags["name:en"] ?? override.nameEn ?? tags.name ?? "";
    s.nameTh = tags["name:th"] ?? tags.name ?? "";
    s.code = tags.ref ?? override.code ?? "";
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

/**
 * Fetch track geometry directly from named OSM ways, bypassing the relation
 * layer — for a line with real, tagged construction geometry but no wrapping
 * route relation. Verified 2026-08-04: MRT Orange and MRT Purple Phase 2
 * have ZERO `type=route` relations anywhere in OSM's Bangkok data (checked
 * operational, `route=construction`, and `proposed:route` — none exist), yet
 * both have genuine `railway=construction` ways with real tunnel/bridge/layer
 * tags. `fetchBranch` cannot run without a relation id; this is the fallback.
 *
 * Deliberately returns NO stations. A citywide search for construction-stage
 * station nodes found exactly 2 in all of OSM, and both fall outside the
 * bounding box of these two lines' own track ways — either a station on a
 * section not fetched here, or a mistagged/unrelated node reusing a station
 * name. Either way, not reliable enough to place on the map (same standing
 * practice as the Mo Chit/Itsaraphap snap fixes in CLAUDE.md: verify a
 * position before committing it, never guess from a name alone).
 */
async function fetchBranchFromWayName(namePattern, branchKey, defaultStructure) {
  const data = await overpass(
    `[out:json][timeout:90];way["railway"="construction"]["name"~"${namePattern}"](${BBOX});out geom;`,
  );
  const allWays = data.elements.filter((e) => e.type === "way" && e.geometry);
  if (allWays.length === 0) {
    throw new Error(`${branchKey}: no construction way matched name pattern ${namePattern}`);
  }

  // Ways tagged `service` (crossover/siding/spur) are pocket track between
  // the two running tracks, not the route itself — stitching one in would
  // walk the path onto a dead-end. A real PTv2 route relation excludes these
  // automatically (they're never route members); a raw name-based way query
  // has no such filter, so this does it by hand.
  const trackWays = allWays.filter((w) => !w.tags?.service);
  if (trackWays.length === 0) {
    throw new Error(
      `${branchKey}: every way matching ${namePattern} is tagged 'service' (crossover/siding) — nothing left to stitch`,
    );
  }

  // Unlike a relation's `out geom` member list, a standalone way's `out geom`
  // response already carries its own tags — no follow-up tags query needed.
  const tagsByWay = new Map(trackWays.map((w) => [String(w.id), w.tags]));
  const wayRefs = trackWays.map((w) => ({ ref: w.id, geometry: w.geometry }));
  const stitched = stitchWays(wayRefs, tagsByWay, defaultStructure);
  if (stitched.consumed < stitched.total) {
    console.warn(
      `  warning: ${branchKey}: stitched ${stitched.consumed}/${stitched.total} track ways — ` +
        `the rest didn't touch the main path (a separate disconnected section, most likely) and were dropped`,
    );
  }

  // A way-name-based fetch has no relation-level direction to separate
  // up/down track: without this, a pair of nearly-parallel twin tracks along
  // the whole corridor greedily stitches into one out-and-back loop instead
  // of a single traverse (found on MRT Orange — see truncateAtFold's comment
  // for the numbers). Fails loudly rather than silently committing a doubled
  // alignment.
  const foldChecked = truncateAtFold(stitched.path);
  if (foldChecked.length < stitched.path.length) {
    console.warn(
      `  warning: ${branchKey}: detected an out-and-back fold in the stitched path — ` +
        `truncated from ${stitched.path.length} to ${foldChecked.length} points at the turnaround ` +
        `(likely two parallel tracks with no direction tag to separate them; verify the result)`,
    );
  }
  const path = dedupe(foldChecked);

  const histogram = path.reduce((acc, p) => {
    acc[p[2]] = (acc[p[2]] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `${branchKey}: ${stitched.consumed}/${allWays.length} ways stitched (of ${trackWays.length} non-service candidates) -> ` +
      `${path.length} points (${Object.entries(histogram).map(([k, v]) => `${k}:${v}`).join(" ")}), ` +
      `0 stops (no reliable OSM station data for this line yet)`,
  );

  const rawTrack = path.map(([lon, lat, structure]) => [
    lon,
    lat,
    STRUCTURE_ALTITUDE_M[structure],
    structure,
  ]);
  const track = limitTrackGradient(rawTrack);

  return {
    relationId: null,
    osmName: trackWays[0]?.tags.name ?? "",
    track,
    stations: [],
  };
}

/**
 * Fetch and concatenate MULTIPLE named-way branches into one line, in the
 * given order. Each branch is fetched via the existing, already-proven
 * single-pattern `fetchBranchFromWayName` — this function does not touch
 * stitching/fold-truncation logic at all, it only joins already-verified-
 * clean polylines end to end.
 *
 * Used for MRT Orange, whose Eastern and Western Sections have no shared OSM
 * route relation, so they are fetched as two separate named-way branches that
 * happen to physically connect at Thailand Cultural Centre. Consecutive
 * parts' track arrays are expected to share their junction point (part[i]'s
 * last point == part[i+1]'s first point, or very close); the duplicate is
 * dropped, not doubled.
 *
 * Each part arrives already gradient-limited (fetchBranchFromWayName runs
 * limitTrackGradient on it before returning), but concatenating two parts
 * creates a SEAM (prevLast -> nextPart[1], right after the shared junction
 * point is dropped below) that neither part's own limiter pass ever saw. A
 * second limitTrackGradient pass runs below on the fully merged track for
 * exactly this reason: it's a relaxation sweep, so it's a no-op on the
 * already-compliant interiors and only ever touches the seam. That also
 * means the preprocessor's gradient gate's own advice ("re-run the fetch so
 * limitTrackGradient ramps it") is now actually correct if it ever fires
 * here — a re-fetch reproduces this same merge-then-relimit pipeline.
 */
async function fetchBranchFromWayNames(namePatterns, branchKey, defaultStructure) {
  if (namePatterns.length < 2) {
    throw new Error(`${branchKey}: wayNamePatterns needs at least 2 entries — use wayNamePattern (singular) for one`);
  }
  const parts = [];
  for (const pattern of namePatterns) {
    parts.push(await fetchBranchFromWayName(pattern, branchKey, defaultStructure));
  }

  // Haversine distance in meters — same formula used elsewhere in this repo
  // (tools/trackProfile.mjs, the verify scripts) for consistency.
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => {
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // Generous but not silent: a real junction should be within a few meters
  // (measured 0.0 m for Orange). Anything under 20 m is still plausibly the
  // same physical point (rounding/resampling); anything over is NOT a known
  // junction and must not be silently spliced.
  const JUNCTION_TOLERANCE_M = 20;

  let track = parts[0].track;
  for (let i = 1; i < parts.length; i++) {
    const prevLast = track[track.length - 1];
    const nextFirst = parts[i].track[0];
    const gap = dist(prevLast, nextFirst);
    if (gap > JUNCTION_TOLERANCE_M) {
      throw new Error(
        `${branchKey}: part ${i - 1}->${i} junction gap is ${gap.toFixed(1)} m ` +
          `(over the ${JUNCTION_TOLERANCE_M} m tolerance) — these two named-way ` +
          `branches do not appear to physically connect; do not force a splice`,
      );
    }
    // Drop the duplicate/near-duplicate junction point from the NEXT part,
    // keep the previous part's copy of it (arbitrary but consistent choice).
    track = track.concat(parts[i].track.slice(1));
  }

  track = limitTrackGradient(track);

  const histogram = track.reduce((acc, p) => {
    acc[p[3]] = (acc[p[3]] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `${branchKey}: merged ${parts.length} named-way branches -> ${track.length} points ` +
      `(${Object.entries(histogram).map(([k, v]) => `${k}:${v}`).join(" ")}), 0 stops`,
  );

  return {
    relationId: null,
    osmName: parts.map((p) => p.osmName).join(" + "),
    track,
    stations: [],
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
       relation["route"~"train|light_rail|subway|monorail"](${BBOX});
       relation["construction:route"~"train|light_rail|subway|monorail"](${BBOX});
       relation["proposed:route"~"train|light_rail|subway|monorail"](${BBOX});
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
    const geom = line.osm.wayNamePatterns
      ? await fetchBranchFromWayNames(line.osm.wayNamePatterns, line.key, line.structure)
      : line.osm.wayNamePattern
        ? await fetchBranchFromWayName(line.osm.wayNamePattern, line.key, line.structure)
        : await fetchBranch(
            line.osm.relationId ?? (await discoverRelationId(line)),
            line.key,
            line.structure,
            line.osm.extraStationNodeIds ?? [],
          );
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
      claimGtfsStopIds: line.claimGtfsStopIds ?? [],
      // null (not undefined) so the field is present in network.json for
      // every line — the Rust side and the UI both branch on it.
      syntheticSchedule: line.syntheticSchedule ?? null,
      estimatedRunTimes: line.estimatedRunTimes ?? null,
      // null (not undefined) for every line, same reason as the two above —
      // the field is always present so the frontend can branch on it.
      rollingStock: line.rollingStock ?? null,
      allowLargeSnapStopIds: line.allowLargeSnapStopIds ?? [],
      snapWarnExemptStopIds: line.snapWarnExemptStopIds ?? [],
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
