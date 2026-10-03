import { describe, expect, it } from "vitest";
import {
  defaultRecipe,
  type BaselineMethod,
  type ComplexData,
  type Spectrum,
} from "../model";
import {
  estimateBaseline,
  processSpectrum,
  processWithBaseline,
  whittakerSmooth,
} from "./numerics";

function fixture(
  size = 8192,
  signed = false,
): { spectrum: Spectrum; baseline: Float64Array; signal: Float64Array } {
  const x = new Float64Array(size),
    baseline = new Float64Array(size),
    real = new Float64Array(size),
    signal = new Float64Array(size),
    imag = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    x[i] = 10 - (10 * i) / (size - 1);
    baseline[i] = 0.2 + 0.03 * x[i] + 0.015 * ((x[i] - 5) / 5) ** 2;
    signal[i] =
      3 * Math.exp(-(((x[i] - 2) / 0.018) ** 2)) +
      2 * Math.exp(-(((x[i] - 5) / 0.025) ** 2));
    if (signed) signal[i] -= 1.5 * Math.exp(-(((x[i] - 7) / 0.015) ** 2));
    real[i] = baseline[i] + signal[i];
  }
  const data: ComplexData = { x, real, imag };
  const spectrum: Spectrum = {
    id: "baseline-fixture",
    label: "Baseline fixture",
    color: "#f00",
    nucleus: "1H",
    frequencyMHz: 400,
    sourceFormat: "synthetic",
    metadata: {},
    original: data,
    data,
    recipe: { ...defaultRecipe(), baseline: "auto" },
    referenceOffset: 0,
    peaks: [],
    integrals: [],
    multiplets: [],
    integralScale: 1,
    gain: 1,
    visible: true,
    history: [],
    revision: 0,
  };
  return { spectrum, baseline, signal };
}
function rmsDifference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

describe("expanded baseline algorithms", () => {
  for (const method of [
    "polynomial",
    "bernstein",
    "whittaker",
    "splines",
    "arpls",
    "snip",
    "ablative",
  ] as BaselineMethod[]) {
    it(`${method} estimates a curved baseline and Preview matches Apply`, () => {
      const { spectrum, baseline } = fixture();
      spectrum.recipe.baselineMethod = method;
      const result = processWithBaseline(spectrum),
        applied = processSpectrum(spectrum);
      expect(result.baseline.real.every(Number.isFinite)).toBe(true);
      expect(rmsDifference(result.baseline.real, baseline)).toBeLessThan(0.035);
      for (let i = 0; i < baseline.length; i += 97) {
        expect(result.source.real[i] - result.baseline.real[i]).toBeCloseTo(
          result.data.real[i],
          12,
        );
        expect(applied.real[i]).toBe(result.data.real[i]);
      }
      expect(spectrum.original.real).toBe(spectrum.data.real);
    });
  }
  it("robust polynomial/Bernstein/Whittaker preserve negative as well as positive signals", () => {
    for (const method of [
      "polynomial",
      "bernstein",
      "whittaker",
    ] as BaselineMethod[]) {
      const { spectrum, signal } = fixture(8192, true);
      spectrum.recipe.baselineMethod = method;
      expect(
        rmsDifference(processSpectrum(spectrum).real, signal),
      ).toBeLessThan(0.015);
    }
  });
  it("Whittaker solves an independently checked penalized objective and reproduces linear input", () => {
    const y = Float64Array.of(1, 4, 2, 6, 5, 3),
      weights = Float64Array.of(1, 1, 0.5, 1, 0, 1),
      lambda = 7;
    const fit = whittakerSmooth(y, weights, lambda),
      gradient = Float64Array.from(fit, (v, i) => weights[i] * (v - y[i]));
    for (let i = 0; i < y.length - 2; i++) {
      const d = lambda * (fit[i] - 2 * fit[i + 1] + fit[i + 2]);
      gradient[i] += d;
      gradient[i + 1] -= 2 * d;
      gradient[i + 2] += d;
    }
    expect(Math.max(...gradient.map(Math.abs))).toBeLessThan(1e-9);
    const line = Float64Array.from({ length: 64 }, (_, i) => 2 + 0.03 * i);
    expect(
      rmsDifference(
        whittakerSmooth(line, new Float64Array(64).fill(1), 1e6),
        line,
      ),
    ).toBeLessThan(1e-7);
  });
  for (const method of [
    "segments",
    "splines",
    "polynomial",
    "whittaker",
  ] as const) {
    it(`manual ${method} follows anchors and handles referenced coordinates`, () => {
      const { spectrum } = fixture(2001);
      spectrum.referenceOffset = 1.2;
      spectrum.recipe.baseline = "manual";
      spectrum.recipe.manualBaselineMethod = method;
      spectrum.recipe.baselineAnchors = [
        { ppm: 1.2, value: 0.3 },
        { ppm: 6.2, value: 0.4 },
        { ppm: 11.2, value: 0.5 },
      ];
      const curve = estimateBaseline(
        spectrum.original,
        spectrum.recipe,
        spectrum.referenceOffset,
      );
      expect(curve[0]).toBeCloseTo(0.5, method === "whittaker" ? 3 : 10);
      expect(curve[1000]).toBeCloseTo(0.4, method === "whittaker" ? 3 : 10);
      expect(curve[2000]).toBeCloseTo(0.3, method === "whittaker" ? 3 : 10);
    });
  }
  it("fit and subtraction honor selected and excluded regions", () => {
    const { spectrum } = fixture(4096);
    spectrum.referenceOffset = 1;
    spectrum.recipe.baselineRegion = [3, 9];
    spectrum.recipe.baselineExcludedRegions = [[5, 7]];
    // A deliberately extreme excluded signal must never contaminate the fitted curve.
    for (let i = 0; i < spectrum.original.x.length; i++)
      if (spectrum.original.x[i] + 1 >= 5 && spectrum.original.x[i] + 1 <= 7)
        spectrum.original.real[i] = 1e8;
    const curve = estimateBaseline(spectrum.original, spectrum.recipe, 1);
    for (let i = 0; i < curve.length; i++) {
      const ppm = spectrum.original.x[i] + 1;
      if (ppm < 3 || ppm > 9 || (ppm >= 5 && ppm <= 7))
        expect(curve[i]).toBe(0);
      else expect(Math.abs(curve[i])).toBeLessThan(1);
    }
  });
  it("high-order polynomial and Bernstein coordinates remain finite and fit a known quadratic", () => {
    for (const method of ["polynomial", "bernstein"] as const) {
      const { spectrum, baseline } = fixture(4096);
      spectrum.recipe.baselineMethod = method;
      spectrum.recipe.baselineOrder = 20;
      // Fit a pure baseline to test numerical conditioning independently of peak recognition.
      spectrum.original.real.set(baseline);
      expect(
        rmsDifference(
          estimateBaseline(spectrum.original, spectrum.recipe),
          baseline,
        ),
      ).toBeLessThan(1e-6);
    }
  });
  it("manual cubic and polynomial models interpolate curved anchors rather than return linear segments", () => {
    const { spectrum } = fixture(2001);
    spectrum.recipe.baseline = "manual";
    spectrum.recipe.baselineAnchors = [
      { ppm: 0, value: 0 },
      { ppm: 2, value: 1 },
      { ppm: 4, value: 0 },
      { ppm: 6, value: 1 },
    ];
    spectrum.recipe.manualBaselineMethod = "segments";
    const segments = estimateBaseline(spectrum.original, spectrum.recipe);
    for (const method of ["splines", "polynomial"] as const) {
      spectrum.recipe.manualBaselineMethod = method;
      const curve = estimateBaseline(spectrum.original, spectrum.recipe);
      expect(curve[1600]).toBeCloseTo(1, 10); // x=2 passes through the picked anchor.
      expect(Math.abs(curve[1800] - segments[1800])).toBeGreaterThan(0.05); // x=1 has actual curvature.
    }
  });
  it("region/exclusion edits on older recipes use a region-aware fit", () => {
    const { spectrum } = fixture(4096);
    delete spectrum.recipe.baselineMethod;
    spectrum.recipe.baselineExcludedRegions = [[4, 6]];
    for (let i = 0; i < spectrum.original.x.length; i++)
      if (spectrum.original.x[i] >= 4 && spectrum.original.x[i] <= 6)
        spectrum.original.real[i] = 1e8;
    const curve = estimateBaseline(spectrum.original, spectrum.recipe);
    expect(curve[100]).toBeLessThan(1);
    expect(curve[2048]).toBe(0);
  });
  it("all automatic methods leave excluded and out-of-region samples unchanged", () => {
    for (const method of [
      "polynomial",
      "bernstein",
      "whittaker",
      "ablative",
      "splines",
      "pcbc",
      "arpls",
      "snip",
      "apbk",
    ] as BaselineMethod[]) {
      const { spectrum } = fixture(2048);
      spectrum.recipe.baselineMethod = method;
      spectrum.recipe.baselineRegion = [2, 8];
      spectrum.recipe.baselineExcludedRegions = [[4, 6]];
      const result = processWithBaseline(spectrum);
      expect(result.effectivePhase).toBeUndefined();
      for (let i = 0; i < spectrum.original.x.length; i++) {
        const ppm = spectrum.original.x[i];
        if (ppm < 2 || ppm > 8 || (ppm >= 4 && ppm <= 6))
          expect(result.data.real[i]).toBe(spectrum.original.real[i]);
      }
    }
  });
  for (const method of ["pcbc", "apbk"] as const) {
    it(`${method} independent joint adaptation returns both complex baseline components and effective phase`, () => {
      const { spectrum, baseline, signal } = fixture(4096);
      const angle = (35 * Math.PI) / 180;
      for (let i = 0; i < signal.length; i++) {
        spectrum.original.real[i] = signal[i] * Math.cos(angle) + baseline[i];
        spectrum.original.imag![i] = signal[i] * Math.sin(angle) + 0.1;
      }
      spectrum.recipe.baselineMethod = method;
      spectrum.recipe.pivotPpm = 5;
      const result = processWithBaseline(spectrum);
      expect(result.effectivePhase).toBeDefined();
      expect(result.baseline.imag).toBeDefined();
      expect(result.data.real.every(Number.isFinite)).toBe(true);
      expect(Math.max(...result.data.real)).toBeGreaterThan(2.8);
      for (let i = 0; i < signal.length; i += 97)
        expect(result.source.imag![i] - result.baseline.imag![i]).toBeCloseTo(
          result.data.imag![i],
          12,
        );
      // Persist the requested recipe, and record effectivePhase separately: replay must not accumulate auto-phase.
      spectrum.data = result.data;
      const replay = processWithBaseline(spectrum);
      expect(replay.effectivePhase).toEqual(result.effectivePhase);
      expect(replay.data.real).toEqual(result.data.real);
      expect(replay.data.imag).toEqual(result.data.imag);
      expect(spectrum.recipe.ph0).toBe(0);
      expect(spectrum.recipe.ph1).toBe(0);
    });
  }
  it("estimates million-point data on a reduced grid without altering the source", () => {
    const { spectrum, baseline } = fixture(1_048_576);
    spectrum.recipe.baselineMethod = "bernstein";
    const sourceSample = spectrum.original.real[500000],
      result = processWithBaseline(spectrum);
    expect(result.baseline.real.length).toBe(1_048_576);
    expect(rmsDifference(result.baseline.real, baseline)).toBeLessThan(0.001);
    expect(spectrum.original.real[500000]).toBe(sourceSample);
  });
  it("rejects invalid tuning parameters and preserves legacy behavior without new fields", () => {
    const { spectrum } = fixture();
    spectrum.recipe.baselineOrder = 21;
    expect(() => processSpectrum(spectrum)).toThrow(/polynomial order/);
    delete spectrum.recipe.baselineMethod;
    expect(processSpectrum(spectrum).real.every(Number.isFinite)).toBe(true);
  });
});
