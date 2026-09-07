import type { StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";
import { projectLocal, type ViewProjection } from "./screenProject";
import { useAppStore, type PrimaryLanguage } from "../stores/useAppStore";
import { formatBilingualStation } from "../utils/stationTypography";

export type StationTier = 1 | 2 | 3;

export interface BillboardCandidate {
  station: StationInfo;
  screenX: number;
  screenY: number;
  tier: StationTier;
  isSelected: boolean;
  width: number;
  height: number;
}

/**
 * Classifies a station into one of 3 LOD hierarchy tiers:
 * - Tier 1: Multi-line interchange hubs (visible z >= 12.0)
 * - Tier 2: Line termini / major junctions (visible z >= 13.5)
 * - Tier 3: Standard intermediate stations (visible z >= 14.8)
 */
export function classifyStationTier(station: StationInfo, isTerminus: boolean): StationTier {
  if (station.interchanges.length > 0) return 1;
  if (isTerminus) return 2;
  return 3;
}

/**
 * Evaluates visibility of a station tier at the given zoom level.
 * The currently selected station is always visible regardless of zoom.
 */
export function isStationVisibleAtZoom(
  tier: StationTier,
  zoom: number,
  isSelected: boolean,
): boolean {
  if (isSelected) return true;
  if (zoom < 12.0) return false;
  if (zoom < 13.5) return tier === 1;
  if (zoom < 14.8) return tier <= 2;
  return true;
}

/**
 * Tests whether two 2D Axis-Aligned Bounding Boxes (AABBs) collide.
 * Format: [x, y, width, height]
 */
export function checkAABBCollision(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number],
): boolean {
  return (
    boxA[0] < boxB[0] + boxB[2] &&
    boxA[0] + boxA[2] > boxB[0] &&
    boxA[1] < boxB[1] + boxB[3] &&
    boxA[1] + boxA[3] > boxB[1]
  );
}

/**
 * Sorts candidates by priority (Selected > Tier 1 > Tier 2 > Tier 3)
 * and culls colliding lower-priority badges.
 */
export function declutterBillboards(candidates: BillboardCandidate[]): BillboardCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.screenY - b.screenY;
  });

  const accepted: BillboardCandidate[] = [];
  const acceptedBoxes: [number, number, number, number][] = [];

  for (const candidate of sorted) {
    const box: [number, number, number, number] = [
      candidate.screenX - candidate.width / 2,
      candidate.screenY - candidate.height,
      candidate.width,
      candidate.height,
    ];

    let collides = false;
    for (const otherBox of acceptedBoxes) {
      if (checkAABBCollision(box, otherBox)) {
        collides = true;
        break;
      }
    }

    if (!collides || candidate.isSelected) {
      accepted.push(candidate);
      acceptedBoxes.push(box);
    }
  }

  return accepted;
}

const POOL_SIZE = 40;
const BADGE_WIDTH = 90;
const BADGE_HEIGHT = 26;

export class StationBillboardManager {
  private readonly container: HTMLDivElement;
  private readonly badgePool: HTMLDivElement[] = [];
  private lastStations: StationInfo[] | null = null;
  private routeLengths: Map<number, number> = new Map();

  constructor(mountParent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.dataset.testid = "station-billboard-container";
    this.container.className =
      "pointer-events-none absolute inset-0 overflow-hidden select-none z-10";

    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement("div");
      el.dataset.testid = "station-billboard";
      el.className =
        "pointer-events-auto absolute left-0 top-0 hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-md transition-opacity cursor-pointer panel-glass";
      this.container.appendChild(el);
      this.badgePool.push(el);
    }

    mountParent.appendChild(this.container);
  }

  /**
   * Evaluated per rAF frame outside React state.
   */
  apply(
    view: ViewProjection,
    zoom: number,
    undergroundMode: boolean,
    hiddenRoutes: number[],
    selectedStation: { routeIdx: number; stationIdx: number } | null,
    uiHidden: boolean,
    stations: StationInfo[],
    routes: LineGeometry[],
    primaryLang: PrimaryLanguage = "en",
  ): void {
    if (uiHidden || stations.length === 0 || zoom < 11.5) {
      this.container.style.display = "none";
      return;
    }
    this.container.style.display = "block";

    const candidates: BillboardCandidate[] = [];

    // Pre-determine line lengths to identify termini (cached across frames)
    if (this.lastStations !== stations) {
      this.lastStations = stations;
      this.routeLengths.clear();
      for (const s of stations) {
        const cur = this.routeLengths.get(s.route_idx) ?? 0;
        if (s.station_idx >= cur) this.routeLengths.set(s.route_idx, s.station_idx + 1);
      }
    }
    const routeLengths = this.routeLengths;

    for (const station of stations) {
      if (hiddenRoutes.includes(station.route_idx)) continue;

      const isSelected =
        selectedStation !== null &&
        selectedStation.routeIdx === station.route_idx &&
        selectedStation.stationIdx === station.station_idx;

      const maxIdx = routeLengths.get(station.route_idx) ?? 1;
      const isTerminus = station.station_idx === 0 || station.station_idx === maxIdx - 1;
      const tier = classifyStationTier(station, isTerminus);

      if (!isStationVisibleAtZoom(tier, zoom, isSelected)) continue;

      const screenPt = projectLocal(view, station.x, station.y, station.z);
      if (!screenPt) continue;

      // Skip offscreen
      if (
        screenPt.x < -BADGE_WIDTH ||
        screenPt.x > view.widthPx + BADGE_WIDTH ||
        screenPt.y < -BADGE_HEIGHT ||
        screenPt.y > view.heightPx + BADGE_HEIGHT
      ) {
        continue;
      }

      candidates.push({
        station,
        screenX: screenPt.x,
        screenY: screenPt.y,
        tier,
        isSelected,
        width: BADGE_WIDTH,
        height: BADGE_HEIGHT,
      });
    }

    const visible = declutterBillboards(candidates);

    for (let i = 0; i < POOL_SIZE; i++) {
      const el = this.badgePool[i];
      if (i < visible.length) {
        const item = visible[i];
        const s = item.station;
        const route = routes[s.route_idx];
        const lineColor = route?.color ?? "#64748b";

        const isUnderground = s.z < 0;
        const opacity = isUnderground && !undergroundMode ? "0.65" : "1.0";

        el.style.display = "flex";
        el.style.opacity = opacity;
        el.style.transform = `translate3d(${Math.round(item.screenX)}px, ${Math.round(
          item.screenY - 8,
        )}px, 0) translate(-50%, -100%)`;

        const badgeKey = `${s.route_idx}:${s.station_idx}:${primaryLang}:${s.code}`;
        if (el.dataset.stationKey !== badgeKey) {
          el.dataset.stationKey = badgeKey;
          const { primaryName, subtitle } = formatBilingualStation(s, primaryLang);
          el.innerHTML = `
            <span class="h-2 w-2 rounded-full shrink-0" style="background-color: ${lineColor}"></span>
            <span class="truncate max-w-28 text-ink font-semibold">${primaryName}</span>
            ${subtitle ? `<span class="truncate max-w-20 text-[10px] text-ink-subtle">${subtitle}</span>` : ""}
          `;
          el.onclick = (e) => {
            e.stopPropagation();
            useAppStore.getState().selectStation({
              routeIdx: s.route_idx,
              stationIdx: s.station_idx,
            });
          };
        }
      } else {
        el.style.display = "none";
        el.dataset.stationKey = "";
        el.onclick = null;
      }
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
