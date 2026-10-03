import { describe, expect, it } from "vitest";
import { defaultRecipe, type Spectrum } from "../model";
import { integrate } from "../core/numerics";
import { shiftSpectrum, strongestPosition, sharedIntegral } from "./stacks";

function spectrum(): Spectrum {
  const x = new Float64Array([4, 3, 2, 1]);
  const real = new Float64Array([1, 2, 4, 3]);
  const data = { x, real, imag: new Float64Array([0, 1, -1, 0]) };
  return {
    id: "s1",
    label: "Spectrum 1",
    color: "#aa3344",
    nucleus: "1H",
    frequencyMHz: 400,
    sourceFormat: "Test",
    original: { x: x.slice(), real: real.slice() },
    data,
    metadata: {},
    recipe: {
      ...defaultRecipe(),
      pivotPpm: 2.2,
      baselineAnchors: [
        { ppm: 1.2, value: 0.1 },
        { ppm: 4.2, value: 0.2 },
      ],
      baselineRegion: [4.2, 1.2],
      baselineExcludedRegions: [[3.5, 2.8]],
    },
    referenceOffset: 0.2,
    peaks: [{ id: "p", ppm: 2.2, height: 4 }],
    integrals: [{ id: "i", from: 3.2, to: 1.2, area: 6.5, label: "I1" }],
    multiplets: [
      {
        id: "m",
        from: 3.2,
        to: 1.2,
        center: 2.2,
        kind: "d",
        couplingsHz: [7.2],
        peakCount: 2,
        label: "A",
      },
    ],
    integralScale: 2,
    gain: 1,
    visible: true,
    timeMinutes: 0,
    history: [],
    revision: 2,
  };
}
describe("stack referencing", () => {
  it("translates every displayed coordinate once while preserving arrays, signed area and coupling constants", () => {
    const source = spectrum(),
      result = shiftSpectrum(source, 0.5);
    expect(result.referenceOffset).toBeCloseTo(0.7);
    expect(result.recipe.pivotPpm).toBeCloseTo(2.7);
    expect(result.recipe.baselineAnchors.map((a) => a.ppm)).toEqual([1.7, 4.7]);
    expect(result.recipe.baselineAnchors.map((a) => a.value)).toEqual([
      0.1, 0.2,
    ]);
    expect(result.recipe.baselineRegion).toEqual([4.7, 1.7]);
    expect(result.recipe.baselineExcludedRegions).toEqual([[4, 3.3]]);
    expect(result.peaks[0].ppm).toBeCloseTo(2.7);
    expect(result.integrals[0]).toEqual({
      ...source.integrals[0],
      from: 3.7,
      to: 1.7,
    });
    expect(result.multiplets[0]).toEqual({
      ...source.multiplets[0],
      from: 3.7,
      to: 1.7,
      center: 2.7,
    });
    expect(result.data).toBe(source.data);
    expect(result.original).toBe(source.original);
    expect(
      integrate(
        result.data,
        result.referenceOffset,
        result.integrals[0].from,
        result.integrals[0].to,
      ),
    ).toBeCloseTo(
      integrate(
        source.data,
        source.referenceOffset,
        source.integrals[0].from,
        source.integrals[0].to,
      ),
    );
    expect(source.referenceOffset).toBe(0.2);
    expect(source.recipe.baselineAnchors[0].ppm).toBe(1.2);
    expect(result.revision).toBe(3);
    expect(result.history[0]).toContain("+0.50000");
  });
  it("round-trips shifts without applying a second offset to analysis or changing geometry", () => {
    const source = spectrum(),
      restored = shiftSpectrum(shiftSpectrum(source, 0.35), -0.35);
    expect(restored.peaks[0].ppm).toBeCloseTo(source.peaks[0].ppm);
    expect(restored.integrals[0].from).toBeCloseTo(source.integrals[0].from);
    expect(restored.recipe.baselineExcludedRegions![0][0]).toBeCloseTo(
      source.recipe.baselineExcludedRegions![0][0],
    );
    expect(restored.referenceOffset).toBeCloseTo(source.referenceOffset);
    expect(() => shiftSpectrum(source, Infinity)).toThrow("finite");
  });
  it("estimates a peak center between sampled points in referenced coordinates", () => {
    const s = spectrum();
    s.data = {
      x: new Float64Array([4, 3, 2, 1]),
      real: new Float64Array([4, 3, 2, 1].map((x) => 5 - (x - 2.7) ** 2)),
    };
    expect(strongestPosition(s, 4.2, 1.2)).toBeCloseTo(2.9, 12);
    expect(strongestPosition(s, 2.2, 3.2)).toBeCloseTo(2.9, 12);
    expect(() => strongestPosition(s, 5, 1)).toThrow("outside");
    expect(() => strongestPosition(s, 2.5, 2.5)).toThrow("outside");
  });
});
describe("shared integration", () => {
  it("uses one shared identity across spectra and measures each raw area independently of gain", () => {
    const a = spectrum(),
      b = {
        ...spectrum(),
        id: "s2",
        gain: 99,
        integralScale: 500,
        data: {
          x: new Float64Array([4, 3, 2, 1]),
          real: new Float64Array([2, 4, 8, 6]),
        },
      };
    const aa = sharedIntegral(a, 1.2, 3.2, "shared-1", "Reactant"),
      bb = sharedIntegral(b, 3.2, 1.2, "shared-1", "Reactant");
    const ai = aa.integrals.at(-1)!,
      bi = bb.integrals.at(-1)!;
    expect(ai.id).toBe(bi.id);
    expect(ai.from).toBe(3.2);
    expect(ai.to).toBe(1.2);
    expect(ai.area).toBeCloseTo(6.5);
    expect(bi.area).toBeCloseTo(13);
    expect(ai.label).toBe("Reactant");
    expect(a.integrals).toHaveLength(1);
    expect(aa.integrals).toHaveLength(2);
    expect(aa.data).toBe(a.data);
    expect(aa.history.at(-1)).toContain("Shared integral");
  });
  it("refuses partial or empty regions rather than silently integrating the clipped remainder", () => {
    expect(() => sharedIntegral(spectrum(), 4.5, 1.2, "x", "A")).toThrow(
      "outside",
    );
    expect(() => sharedIntegral(spectrum(), 2.2, 0, "x", "A")).toThrow(
      "outside",
    );
    expect(() => sharedIntegral(spectrum(), 2.2, 2.2, "x", "A")).toThrow(
      "outside",
    );
  });
});
