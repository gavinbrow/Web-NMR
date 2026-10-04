import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  orderRegression,
  buildKineticsWorkbook,
  reportPlotSVG,
} from "./kineticsReport";
import { measureKineticTargets } from "./kinetics";
import { createDemoSpectra } from "./demo";
describe("Excel kinetics report", () => {
  it("recovers first- and second-order slopes, omitting excluded and nonpositive values", () => {
    const first = Array.from({ length: 6 }, (_, i) => ({
      time: i,
      value: 5 * Math.exp(-0.25 * i),
      included: true,
    }));
    const second = Array.from({ length: 6 }, (_, i) => ({
      time: i,
      value: 1 / (0.2 + 0.4 * i),
      included: true,
    }));
    expect(orderRegression(first, 1)?.slope).toBeCloseTo(-0.25, 12);
    expect(orderRegression(second, 2)?.slope).toBeCloseTo(0.4, 12);
    expect(
      orderRegression(
        [
          ...first,
          { time: 100, value: 1e9, included: false },
          { time: 200, value: -1, included: true },
        ],
        1,
      ),
    ).toEqual(orderRegression(first, 1));
    expect(
      orderRegression([{ time: 1, value: 0, included: true }], 2),
    ).toBeNull();
  });
  it("packages numeric tables, editable order formulas/charts and embedded PNGs with correct relationships", () => {
    const series = measureKineticTargets(
      createDemoSpectra(),
      [
        {
          id: "t",
          label: "Reactant & decay",
          color: "#1689e9",
          from: 4.24,
          to: 4,
          protons: 1,
          model: "decay",
        },
      ],
      { mode: "area", excludedIds: ["demo-0"] },
      true,
    );
    const files = unzipSync(
      buildKineticsWorkbook(
        "Test",
        series,
        { mode: "area", from: 4.24, to: 4 },
        [{ name: "figure", png: new Uint8Array([137, 80, 78, 71]) }],
      ),
    );
    const text = (path: string) => strFromU8(files[path]);
    expect(text("xl/workbook.xml")).toContain("Reactant &amp; decay");
    expect(text("xl/worksheets/sheet2.xml")).toContain(
      "IFERROR(-SLOPE(F13:F18,A13:A18)",
    );
    expect(text("xl/worksheets/sheet2.xml")).toContain("LN(B13)");
    expect(text("xl/charts/chart2.xml")).toContain("$F$13:$F$18");
    expect(text("xl/charts/chart3.xml")).toContain("$G$13:$G$18");
    expect(text("xl/charts/chart1.xml")).toContain("$L$13:$L$18");
    expect(text("xl/drawings/_rels/drawing1.xml.rels")).toContain(
      "../media/image1.png",
    );
    expect(files["xl/media/image1.png"]).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(reportPlotSVG(series, 1)).toContain("First-order plot");
    expect(reportPlotSVG(series, 2)).toContain("Second-order plot");
  });
});
