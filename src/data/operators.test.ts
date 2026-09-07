import { describe, expect, it } from "vitest";
import {
  TRANSIT_OPERATORS,
  getOperatorForLine,
  groupLinesByOperator,
  type TransitOperatorId,
} from "./operators";
import type { LineGeometry } from "../types";

function mockLine(key: string, preRevenue = false): LineGeometry {
  return {
    key,
    name: `Line ${key}`,
    nameTh: `สาย ${key}`,
    color: "#000000",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue,
    syntheticSchedule: null,
    estimatedRunTimes: null,
    rollingStock: null,
    relationId: 1,
    osmName: key,
    track: [],
    stations: [],
  };
}

describe("Transit Operators & IA", () => {
  it("defines all 4 major Bangkok transit operators exactly per spec §4.1", () => {
    const ids: TransitOperatorId[] = TRANSIT_OPERATORS.map((op) => op.id);
    expect(ids).toEqual(["bts", "mrt", "srt", "bkk_airport"]);
    expect(TRANSIT_OPERATORS).toHaveLength(4);

    const bts = TRANSIT_OPERATORS.find((op) => op.id === "bts")!;
    expect(bts.lineKeys).toEqual(["sukhumvit", "silom", "gold"]);

    const mrt = TRANSIT_OPERATORS.find((op) => op.id === "mrt")!;
    expect(mrt.lineKeys).toEqual(["blue", "purple", "yellow", "pink", "orange", "purple-ext"]);

    const srt = TRANSIT_OPERATORS.find((op) => op.id === "srt")!;
    expect(srt.lineKeys).toEqual(["arl", "dark-red", "light-red"]);

    const apm = TRANSIT_OPERATORS.find((op) => op.id === "bkk_airport")!;
    expect(apm.lineKeys).toEqual(["apm"]);
  });

  it("finds the operator for given line keys and feed variances", () => {
    expect(getOperatorForLine("sukhumvit")?.id).toBe("bts");
    expect(getOperatorForLine("silom")?.id).toBe("bts");
    expect(getOperatorForLine("gold")?.id).toBe("bts");

    expect(getOperatorForLine("blue")?.id).toBe("mrt");
    expect(getOperatorForLine("purple")?.id).toBe("mrt");
    expect(getOperatorForLine("orange")?.id).toBe("mrt");
    expect(getOperatorForLine("purple-ext")?.id).toBe("mrt");
    expect(getOperatorForLine("pink-spur")?.id).toBe("mrt");

    expect(getOperatorForLine("arl")?.id).toBe("srt");
    expect(getOperatorForLine("dark-red")?.id).toBe("srt");
    expect(getOperatorForLine("light-red")?.id).toBe("srt");
    expect(getOperatorForLine("red-dark")?.id).toBe("srt");
    expect(getOperatorForLine("red-light")?.id).toBe("srt");

    expect(getOperatorForLine("apm")?.id).toBe("bkk_airport");
    expect(getOperatorForLine("non-existent")).toBeUndefined();
  });

  it("groups lines by operator, correctly partitioning active and pre-revenue lines", () => {
    const routes: LineGeometry[] = [
      mockLine("sukhumvit", false),
      mockLine("blue", false),
      mockLine("orange", true),
      mockLine("arl", false),
      mockLine("purple-ext", true),
      mockLine("apm", false),
    ];

    const groups = groupLinesByOperator(routes);

    const btsGroup = groups.find((g) => g.operator.id === "bts");
    expect(btsGroup).toBeDefined();
    expect(btsGroup?.activeLines.map((l) => l.line.key)).toEqual(["sukhumvit"]);
    expect(btsGroup?.preRevenueLines).toHaveLength(0);

    const mrtGroup = groups.find((g) => g.operator.id === "mrt");
    expect(mrtGroup).toBeDefined();
    expect(mrtGroup?.activeLines.map((l) => l.line.key)).toEqual(["blue"]);
    expect(mrtGroup?.preRevenueLines.map((l) => l.line.key)).toEqual([
      "orange",
      "purple-ext",
    ]);

    const srtGroup = groups.find((g) => g.operator.id === "srt");
    expect(srtGroup).toBeDefined();
    expect(srtGroup?.activeLines.map((l) => l.line.key)).toEqual(["arl"]);

    const apmGroup = groups.find((g) => g.operator.id === "bkk_airport");
    expect(apmGroup).toBeDefined();
    expect(apmGroup?.activeLines.map((l) => l.line.key)).toEqual(["apm"]);
  });

  it("preserves routeIdx in OperatorLineItem", () => {
    const routes: LineGeometry[] = [
      mockLine("blue", false),     // idx 0
      mockLine("sukhumvit", false),// idx 1
    ];
    const groups = groupLinesByOperator(routes);
    const bts = groups.find((g) => g.operator.id === "bts");
    expect(bts?.activeLines[0].routeIdx).toBe(1);

    const mrt = groups.find((g) => g.operator.id === "mrt");
    expect(mrt?.activeLines[0].routeIdx).toBe(0);
  });
});
