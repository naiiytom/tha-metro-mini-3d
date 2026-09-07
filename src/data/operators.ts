import type { LineGeometry } from "../types";

export type TransitOperatorId = "bts" | "mrt" | "srt" | "bkk_airport";

export interface TransitOperator {
  id: TransitOperatorId;
  nameEn: string;
  nameTh: string;
  brandColor: string;
  lineKeys: string[];
}

export interface OperatorLineItem {
  line: LineGeometry;
  routeIdx: number;
}

export interface OperatorGroup {
  operator: TransitOperator;
  activeLines: OperatorLineItem[];
  preRevenueLines: OperatorLineItem[];
}

export const TRANSIT_OPERATORS: TransitOperator[] = [
  {
    id: "bts",
    nameEn: "BTS Skytrain",
    nameTh: "รถไฟฟ้าบีทีเอส",
    brandColor: "#70BA38",
    lineKeys: ["sukhumvit", "silom", "gold"],
  },
  {
    id: "mrt",
    nameEn: "MRT Bangkok Metro",
    nameTh: "รถไฟฟ้ามหานคร",
    brandColor: "#1964B7",
    lineKeys: ["blue", "purple", "yellow", "pink", "orange", "purple-ext"],
  },
  {
    id: "srt",
    nameEn: "SRT Commuter & Airport Link",
    nameTh: "รถไฟชานเมืองและแอร์พอร์ต เรล ลิงก์",
    brandColor: "#85172C",
    lineKeys: ["arl", "dark-red", "light-red"],
  },
  {
    id: "bkk_airport",
    nameEn: "Suvarnabhumi Airport Shuttle",
    nameTh: "ท่าอากาศยานสุวรรณภูมิ (APM)",
    brandColor: "#475569",
    lineKeys: ["apm"],
  },
];

/**
 * Returns the transit operator matching the given route line key.
 */
export function getOperatorForLine(lineKey: string): TransitOperator | undefined {
  const direct = TRANSIT_OPERATORS.find((op) => op.lineKeys.includes(lineKey));
  if (direct) return direct;

  const norm = lineKey.toLowerCase();
  if (norm.includes("red") || norm === "arl") {
    return TRANSIT_OPERATORS.find((op) => op.id === "srt");
  }
  if (
    norm.startsWith("pink") ||
    norm.startsWith("purple") ||
    norm === "blue" ||
    norm === "yellow" ||
    norm === "orange"
  ) {
    return TRANSIT_OPERATORS.find((op) => op.id === "mrt");
  }
  if (norm === "sukhumvit" || norm === "silom" || norm === "gold") {
    return TRANSIT_OPERATORS.find((op) => op.id === "bts");
  }
  if (norm === "apm") {
    return TRANSIT_OPERATORS.find((op) => op.id === "bkk_airport");
  }

  return undefined;
}

/**
 * Groups lines by their operator, cleanly separating active revenue lines from
 * pre-revenue / under-construction lines. Preserves the original routeIdx.
 */
export function groupLinesByOperator(routes: LineGeometry[]): OperatorGroup[] {
  const groupMap = new Map<TransitOperatorId, OperatorGroup>();

  for (const op of TRANSIT_OPERATORS) {
    groupMap.set(op.id, {
      operator: op,
      activeLines: [],
      preRevenueLines: [],
    });
  }

  routes.forEach((line, routeIdx) => {
    const op = getOperatorForLine(line.key);
    if (!op) return;

    const group = groupMap.get(op.id);
    if (!group) return;

    const item: OperatorLineItem = { line, routeIdx };
    if (line.preRevenue) {
      group.preRevenueLines.push(item);
    } else {
      group.activeLines.push(item);
    }
  });

  return TRANSIT_OPERATORS.map((op) => groupMap.get(op.id)!).filter(
    (g) => g.activeLines.length > 0 || g.preRevenueLines.length > 0,
  );
}
