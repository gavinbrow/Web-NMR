import { describe, expect, it } from "vitest";
import { defaultRecipe, type Integral, type Spectrum } from "../model";
import {
  autodetectIntegralCounts,
  displayedIntegralValue,
  normalizeIntegral,
  recalibrateIntegrals,
  removeIntegral,
} from "./integrals";
import { analysisCSV } from "./export";

function spectrum(areas: number[]): Spectrum {
  const data = {
    x: new Float64Array([3, 2, 1]),
    real: new Float64Array([1, 2, 3]),
  };
  return {
    id: "s",
    label: "S",
    color: "#aa3344",
    nucleus: "1H",
    frequencyMHz: 400,
    sourceFormat: "Test",
    metadata: {},
    original: data,
    data,
    recipe: defaultRecipe(),
    referenceOffset: 0,
    peaks: [],
    multiplets: [],
    integrals: areas.map((area, i) => ({
      id: `i${i}`,
      label: `I${i + 1}`,
      from: 3 - i,
      to: 2 - i,
      area,
    })),
    integralScale: 1,
    gain: 1,
    visible: true,
    history: [],
    revision: 0,
  };
}
describe("integral reporting calibration", () => {
  it("preserves independently saved Mnova values and recalculates edited regions with a stable reference", () => {
    const s = spectrum([100, 200, -50]);
    s.integrals = s.integrals.map((i, n) => ({
      ...i,
      imported: {
        source: "Mnova",
        normalizedValue: [3, 5.7, -1.2][n],
        rawArea: [3000, 5700, -1200][n],
        referenceArea: 1000,
      },
    }));
    expect(s.integrals.map((i) => displayedIntegralValue(s, i))).toEqual([
      3, 5.7, -1.2,
    ]);
    const withNew = recalibrateIntegrals(s, [
      ...s.integrals,
      { id: "new", label: "New", from: 0, to: -1, area: 150 },
    ]);
    expect(displayedIntegralValue(withNew, withNew.integrals[3])).toBe(4.5);
    expect(displayedIntegralValue(withNew, withNew.integrals[1])).toBe(5.7);
    const edited = recalibrateIntegrals(
      s,
      s.integrals.map((i) =>
        i.id === "i1" ? { ...i, area: 300, to: 0.5 } : i,
      ),
    );
    expect(edited.integralCalibration).toEqual({ anchorId: "i0", target: 3 });
    expect(
      edited.integrals.map((i) => displayedIntegralValue(edited, i)),
    ).toEqual([3, 9, -1.5]);
    expect(edited.integrals.every((i) => i.imported === undefined)).toBe(true);
    const normalized = normalizeIntegral(s, "i1", 2);
    expect(
      normalized.integrals.map((i) => displayedIntegralValue(normalized, i)),
    ).toEqual([1, 2, -0.5]);
  });
  it("reports small relative values before explicit calibration without changing raw areas", () => {
    const s = spectrum([320_000, 640_000, 480_000]);
    expect(s.integrals.map((i) => displayedIntegralValue(s, i))).toEqual([
      1, 2, 1.5,
    ]);
    expect(s.integrals.map((i) => i.area)).toEqual([320_000, 640_000, 480_000]);
  });
  it("keeps the Mnova unit reference fixed when it is not the first region", () => {
    const s = spectrum([100, 200]);
    s.integrals = s.integrals.map((i, n) => ({
      ...i,
      imported: {
        source: "Mnova",
        normalizedValue: [0.594, 1][n],
        rawArea: [594, 1000][n],
        referenceArea: 1000,
      },
    }));
    const withNew = recalibrateIntegrals(s, [
      ...s.integrals,
      { id: "new", label: "New", from: 0, to: -1, area: 150 },
    ]);
    expect(displayedIntegralValue(withNew, withNew.integrals[2])).toBe(0.75);
    const processed = recalibrateIntegrals(
      s,
      s.integrals.map((i, n) => ({ ...i, area: [110, 180][n] })),
    );
    expect(processed.integralCalibration).toEqual({ anchorId: "i1", target: 1 });
    expect(displayedIntegralValue(processed, processed.integrals[1])).toBe(1);
    expect(displayedIntegralValue(processed, processed.integrals[0])).toBeCloseTo(110 / 180);
  });
  it("exports the actual relative reporting factor and recalibrated explicit factor", () => {
    const s = spectrum([100, 200]);
    expect(analysisCSV(s, "integrals")).toContain("100,1,0.01");
    expect(analysisCSV(s, "integrals")).toContain("200,2,0.01");
    const calibrated = recalibrateIntegrals(
      normalizeIntegral(s, "i0", 3),
      s.integrals.map((i) => ({ ...i, area: i.area * 2 })),
    );
    expect(analysisCSV(calibrated, "integrals")).toContain("200,3,0.015");
    expect(analysisCSV(calibrated, "integrals")).toContain("400,6,0.015");
  });
  it("retains a stable anchor target after processing and region resizing", () => {
    const s = normalizeIntegral(spectrum([100, 200]), "i1", 4);
    expect(s.integrals.map((i) => displayedIntegralValue(s, i))).toEqual([
      2, 4,
    ]);
    const updated: Integral[] = s.integrals.map((i) => ({
      ...i,
      area: i.area * 0.7,
    }));
    const processed = recalibrateIntegrals(s, updated);
    expect(
      processed.integrals.map((i) => displayedIntegralValue(processed, i)),
    ).toEqual([2, 4]);
    expect(processed.integralScale).toBeCloseTo(4 / 140);
    const resized = recalibrateIntegrals(
      processed,
      processed.integrals.map((i) =>
        i.id === "i1" ? { ...i, area: 70, to: 0.5 } : i,
      ),
    );
    expect(displayedIntegralValue(resized, resized.integrals[1])).toBe(4);
    expect(displayedIntegralValue(resized, resized.integrals[0])).toBe(4);
  });
  it("migrates legacy normalization factors on reprocessing instead of drifting the reported reference", () => {
    const s = { ...spectrum([200, 600]), integralScale: 0.01 };
    const result = recalibrateIntegrals(
      s,
      s.integrals.map((i) => ({ ...i, area: i.area * 2 })),
    );
    expect(result.integralCalibration).toEqual({ anchorId: "i0", target: 2 });
    expect(
      result.integrals.map((i) => displayedIntegralValue(result, i)),
    ).toEqual([2, 6]);
  });
  it("handles deleted/zero anchors and preserves independent stack calibration", () => {
    const a = normalizeIntegral(spectrum([100, 200]), "i0", 3),
      b = normalizeIntegral(spectrum([50, 200]), "i0", 3);
    expect(displayedIntegralValue(a, a.integrals[1])).toBe(6);
    expect(displayedIntegralValue(b, b.integrals[1])).toBe(12);
    a.gain = 100;
    a.integralScale = 9;
    expect(displayedIntegralValue(a, a.integrals[1])).toBe(6);
    const removed = removeIntegral(a, "i0");
    expect(removed.integralCalibration).toBeUndefined();
    expect(displayedIntegralValue(removed, removed.integrals[0])).toBe(1);
    const zero = recalibrateIntegrals(
      a,
      a.integrals.map((i) => (i.id === "i0" ? { ...i, area: 0 } : i)),
    );
    expect(zero.integralCalibration).toBeUndefined();
    expect(zero.integralScale).toBe(1);
    expect(() => normalizeIntegral(zero, "i0", 1)).toThrow("nonzero");
    expect(() => normalizeIntegral(a, "i1", NaN)).toThrow("positive");
  });
  it("marks bounded integer-ratio count estimates tentative and selects primitive counts", () => {
    const s = autodetectIntegralCounts(spectrum([20, 30, 60]));
    expect(s.integrals.map((i) => displayedIntegralValue(s, i))).toEqual([
      2, 3, 6,
    ]);
    expect(s.integralCalibration?.tentative).toBe(true);
    expect(s.history.at(-1)).toContain("Tentative");
    expect(
      normalizeIntegral(s, "i0", 2).integralCalibration?.tentative,
    ).toBeUndefined();
  });
});
