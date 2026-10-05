import { describe, expect, it } from "vitest";
import {
  predictedTwoDSpectrum,
  renderTwoDCorrelationMap,
} from "./predictedTwoDSpectrum";
import { assembleTwoDCorrelations } from "../prediction/twoDClient";
import { defaultPredictionSetup } from "./predictionSetup";
import { importMolecule } from "./molecule";
import type { PredictedAtomShift, PredictionResult } from "../prediction/types";

const molecule = importMolecule("CCO");
const shift = (
  atomIndex: number,
  shiftPpm: number,
  hydrogenCount = 1,
  element: "H" | "C" = "H",
): PredictedAtomShift => ({
  atomIndex,
  shiftPpm,
  hydrogenCount,
  element,
  sampleCount: 10,
  minPpm: shiftPpm,
  maxPpm: shiftPpm,
  radius: 1,
  hoseCode: "fixture",
});
const result = (
  shifts: PredictedAtomShift[],
  nucleus: "1H" | "13C" = "1H",
): PredictionResult => ({
  shifts,
  nucleus,
  engine: "cdk-hose-nmrshiftdb",
  warnings: [],
  dataset: "topology fixture",
  targetAtomCount: shifts.length,
  missingAtomCount: 0,
});
const proton = result([shift(0, 1.2, 3), shift(1, 3.5, 2), shift(2, 2.5)]);
const carbon = result([shift(0, 18, 1, "C"), shift(1, 58, 1, "C")], "13C");
const input = {
  experiment: "HSQC" as const,
  nucleus: "1H" as const,
  molecule,
  frequencyMHz: 400,
  lineWidthHz: 1,
};
const hsqc = assembleTwoDCorrelations(
  { ...input, hsqcEdited: true },
  proton,
  molecule,
  carbon,
);
const cosy = assembleTwoDCorrelations(
  { ...input, experiment: "COSY" },
  proton,
  molecule,
);
const nearest = (axis: Float64Array, ppm: number) =>
  axis.reduce(
    (best, value, i) =>
      Math.abs(value - ppm) < Math.abs(axis[best] - ppm) ? i : best,
    0,
  );

describe("processed predicted 2D maps", () => {
  it("contains finite descending F2/F1 axes and negative edited CH2 versus positive CH3", () => {
    const { twoD } = renderTwoDCorrelationMap(hsqc.twoD!, { size: 256 });
    expect(twoD.width).toBe(256);
    expect(twoD.height).toBe(256);
    expect(twoD.real).toHaveLength(256 * 256);
    expect(twoD.real.every(Number.isFinite)).toBe(true);
    expect([...twoD.x].every((v, i) => i === 0 || v < twoD.x[i - 1])).toBe(
      true,
    );
    expect([...twoD.y].every((v, i) => i === 0 || v < twoD.y[i - 1])).toBe(
      true,
    );
    expect(
      twoD.real[nearest(twoD.y, 18) * 256 + nearest(twoD.x, 1.2)],
    ).toBeGreaterThan(0);
    expect(
      twoD.real[nearest(twoD.y, 58) * 256 + nearest(twoD.x, 3.5)],
    ).toBeLessThan(0);
    expect(twoD).toMatchObject({
      source: "Predicted 2D",
      nucleusF1: "13C",
      frequencyF1: 100.58,
      mode: "absorption",
    });
  });
  it("generates a symmetric COSY plane with diagonal and both off-diagonal orientations", () => {
    const { twoD } = renderTwoDCorrelationMap(cosy.twoD!, { size: 128 });
    expect(twoD.x).toEqual(twoD.y);
    for (let row = 0; row < 128; row++)
      for (let col = 0; col < 128; col++)
        expect(twoD.real[row * 128 + col]).toBeCloseTo(
          twoD.real[col * 128 + row],
          12,
        );
    expect(
      twoD.real[nearest(twoD.y, 1.2) * 128 + nearest(twoD.x, 3.5)],
    ).toBeGreaterThan(0);
    expect(
      twoD.real[nearest(twoD.y, 3.5) * 128 + nearest(twoD.x, 1.2)],
    ).toBeGreaterThan(0);
    expect(
      twoD.real[nearest(twoD.y, 2.5) * 128 + nearest(twoD.x, 2.5)],
    ).toBeGreaterThan(0);
  });
  it("supports Gaussian and Lorentzian kernels and reports bounded-grid broadening honestly", () => {
    const gaussian = renderTwoDCorrelationMap(hsqc.twoD!, {
      size: 64,
      profile: "gaussian",
    });
    const lorentzian = renderTwoDCorrelationMap(hsqc.twoD!, {
      size: 64,
      profile: "lorentzian",
    });
    expect(gaussian.twoD.real).not.toEqual(lorentzian.twoD.real);
    expect(gaussian.warnings.join(" ")).toContain("broadens");
    expect(gaussian.renderedLineWidthHzF1).toBeGreaterThan(1);
  });
  it("rejects nonfinite correlations, impossible dimensions, and invalid widths", () => {
    expect(() => renderTwoDCorrelationMap(hsqc.twoD!, { size: 2048 })).toThrow(
      "grid",
    );
    const invalid = structuredClone(hsqc.twoD!);
    invalid.correlations[0].xPpm = Infinity;
    expect(() => renderTwoDCorrelationMap(invalid)).toThrow("correlation");
    invalid.correlations[0].xPpm = 1e100;
    expect(() => renderTwoDCorrelationMap(invalid)).toThrow("correlation");
    const width = structuredClone(hsqc.twoD!);
    width.settings.lineWidthHz = 0;
    expect(() => renderTwoDCorrelationMap(width)).toThrow("linewidth");
  });
});
describe("single saved predicted 2D spectrum", () => {
  it("embeds both 1D traces without duplicate spectra/list entries and saves atom-linked 2D assignments", () => {
    const setup = {
      ...defaultPredictionSetup(),
      molecule,
      title: "Edited ethanol HSQC",
    };
    const spectra = predictedTwoDSpectrum(hsqc, setup, molecule);
    expect(spectra).toHaveLength(1);
    const spectrum = spectra[0];
    expect(spectrum.sourceFormat).toBe("Predicted 2D");
    expect(spectrum.predictedTraces!.top.x.length).toBeGreaterThan(0);
    expect(spectrum.predictedTraces!.left.x[0]).toBeGreaterThan(
      spectrum.predictedTraces!.top.x[0],
    );
    expect(spectrum.twoDView!.negative).toBe(true);
    expect(spectrum.twoDView!.threshold).toBe(1);
    expect(spectrum.peaks).toEqual([]);
    expect(spectrum.integrals).toEqual([]);
    expect(spectrum.multiplets).toEqual([]);
    expect(spectrum.molecule!.assignments.map((a) => [a.ppm, a.ppmF1])).toEqual(
      [
        [1.2, 18],
        [3.5, 58],
      ],
    );
    expect(String(spectrum.metadata.comments).split("\n")).toHaveLength(2);
    expect(
      spectrum.twoDView!.xView[0] - spectrum.twoDView!.xView[1],
    ).toBeLessThan(16);
    expect(
      spectrum.twoDView!.xView[0] - spectrum.twoDView!.xView[1],
    ).toBeCloseTo(4, 12);
    expect(
      spectrum.twoDView!.yView[0] - spectrum.twoDView!.yView[1],
    ).toBeLessThan(260);
  });
  it("uses the same proton trace for both COSY axes and preserves symmetric views", () => {
    const [spectrum] = predictedTwoDSpectrum(
      cosy,
      { ...defaultPredictionSetup(), molecule },
      molecule,
    );
    expect(spectrum.predictedTraces!.left).toBe(spectrum.predictedTraces!.top);
    expect(spectrum.twoDView!.xView).toEqual(spectrum.twoDView!.yView);
    expect(spectrum.twoD!.nucleusF1).toBe("1H");
  });
  it("rejects a changed permanent atom ID or field rather than silently remapping", () => {
    const moved = structuredClone(molecule);
    moved.atoms[0].id = "wrong";
    expect(() =>
      predictedTwoDSpectrum(hsqc, defaultPredictionSetup(), moved),
    ).toThrow("identities");
    expect(() =>
      predictedTwoDSpectrum(
        hsqc,
        { ...defaultPredictionSetup(), frequencyMHz: 600 },
        molecule,
      ),
    ).toThrow("Recalculate");
  });
});
