import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Spectrum,
  TwoDSpectrum,
  TwoDRawData,
  TwoDProcessingRecipe,
} from "../model";
import { importEntries, parseBrukerParameters } from "./imports";
import { readRawTwoD, maximumProjection } from "./twoD";
import {
  analyticQuadrature,
  autoPhaseTwoD,
  defaultTwoDRecipe,
  processTwoD,
  snapTwoDPeak,
  transformRawTwoD,
} from "./twoDProcessing";
function matrix(width = 64, height = 32): TwoDSpectrum {
  return {
    x: Float64Array.from(
      { length: width },
      (_, i) => 10 - (i * 10) / (width - 1),
    ),
    y: Float64Array.from(
      { length: height },
      (_, i) => 10 - (i * 10) / (height - 1),
    ),
    real: new Float64Array(width * height),
    imagF2: new Float64Array(width * height),
    imagF1: new Float64Array(width * height),
    imagBoth: new Float64Array(width * height),
    width,
    height,
    nucleusF1: "1H",
    frequencyF1: 400,
    referenceOffsetF1: 0,
    experiment: "test",
    source: "Bruker processed 2D",
    mode: "absorption",
  };
}
function spectrum(data = matrix()): Spectrum {
  const s = importEntries([
    { path: "test.csv", data: new TextEncoder().encode("10,0\n0,0").buffer },
  ]).spectra[0];
  s.twoD = data;
  s.twoDOriginal = data;
  s.frequencyMHz = 400;
  s.original = s.data = maximumProjection(data);
  s.twoDRecipe = defaultTwoDRecipe(s);
  return s;
}
describe("saved native 2D processing source", () => {
  it("keeps corrected and source quadrants separate and uses the explicitly chosen source", () => {
    const corrected = matrix(4, 2),
      source = matrix(4, 2);
    corrected.real.fill(20);
    corrected.imagF2!.fill(4);
    source.real.fill(3);
    source.imagF2!.fill(7);
    const s = spectrum(corrected);
    s.nativeSource2D = source;
    expect(Array.from(processTwoD(s).data.real)).toEqual(Array(8).fill(20));
    s.twoDRecipe = { ...s.twoDRecipe!, source: "mnova-source" };
    expect(Array.from(processTwoD(s).data.real)).toEqual(Array(8).fill(3));
    s.twoDRecipe.f2.ph0 = 90;
    expect(processTwoD(s).data.real[0]).toBeCloseTo(-7);
    expect(corrected.real[0]).toBe(20);
    expect(source.real[0]).toBe(3);
    s.nativeSource2D = undefined;
    expect(() => processTwoD(s)).toThrow("no saved Mnova source");
  });
});
function syntheticRaw(mode: TwoDRawData["acquisitionMode"]): TwoDRawData {
  const width = 16,
    increments = 8,
    height = increments * 2,
    real = new Float64Array(width * height),
    imag = new Float64Array(real.length);
  for (let t = 0; t < increments; t++)
    for (let j = 0; j < width; j++) {
      const f1 = (2 * Math.PI * 2 * t) / increments,
        f2 = (2 * Math.PI * 3 * j) / width,
        cr = Math.cos(f1) * Math.cos(f2),
        ci = Math.cos(f1) * Math.sin(f2),
        sr = Math.sin(f1) * Math.cos(f2),
        si = Math.sin(f1) * Math.sin(f2),
        a = 2 * t * width + j,
        b = a + width,
        sign = mode === "States-TPPI" && t % 2 ? -1 : 1;
      if (mode === "Echo-Antiecho") {
        real[a] = (cr + si) / 2;
        imag[a] = (ci - sr) / 2;
        real[b] = (-cr + si) / 2;
        imag[b] = (-ci - sr) / 2;
      } else {
        real[a] = cr * sign;
        imag[a] = ci * sign;
        real[b] = sr * sign;
        imag[b] = si * sign;
      }
    }
  return {
    real,
    imag,
    width,
    height,
    acquisitionMode: mode,
    dwellSecondsF2: 0.001,
    dwellSecondsF1: 0.001,
    spectralWidthHzF2: 1000,
    spectralWidthHzF1: 1000,
    carrierPpmF2: 5,
    carrierPpmF1: 5,
    groupDelay: 0,
    nucleusF1: "1H",
    frequencyF1: 400,
    experiment: "synthetic",
  };
}
function recipe(): TwoDProcessingRecipe {
  const r = defaultTwoDRecipe(spectrum());
  r.transform = true;
  r.echoAntiEchoOrder = "echo-first";
  r.f1.zeroFill = r.f2.zeroFill = 2;
  return r;
}
function maximum(data: TwoDSpectrum): [number, number] {
  let index = 0;
  for (let i = 1; i < data.real.length; i++)
    if (Math.abs(data.real[i]) > Math.abs(data.real[index])) index = i;
  return [data.x[index % data.width], data.y[Math.floor(index / data.width)]];
}
function actual(experiment: string, collection = "DAC-1P Nosy Cosy C13") {
  const base = join(process.cwd(), "../Example Files", collection, experiment),
    read = (path: string) => {
      const b = readFileSync(join(base, path));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    p = (path: string) =>
      parseBrukerParameters(new TextDecoder().decode(read(path)));
  return {
    raw: readRawTwoD(
      read("ser"),
      p("acqus"),
      p("acqu2s"),
      p("pdata/1/procs"),
      p("pdata/1/proc2s"),
    ),
    entries: [
      "acqus",
      "acqu2s",
      "pdata/1/procs",
      "pdata/1/proc2s",
      "pdata/1/2rr",
      "pdata/1/2ri",
      "pdata/1/2ir",
      "pdata/1/2ii",
    ]
      .filter((path) => existsSync(join(base, path)))
      .map((path) => ({
        path: join("fixture", experiment, path),
        data: read(path),
      })),
  };
}
describe("2D source-preserving processing", () => {
  it("does not reference-snap a constant nonzero baseline as a peak", () => {
    const data = matrix(8, 8);
    data.real.fill(42);
    expect(snapTwoDPeak(data, 5, 5, 0, 4)).toBeUndefined();
  });
  it("transforms real indirect QF increments without inventing a directional quadrature channel", () => {
    const raw = syntheticRaw("States");
    raw.acquisitionMode = "QF";
    raw.height /= 2;
    raw.real = Float64Array.from(
      { length: raw.width * raw.height },
      (_, i) =>
        raw.real[2 * Math.floor(i / raw.width) * raw.width + (i % raw.width)],
    );
    raw.imag = Float64Array.from(
      { length: raw.real.length },
      (_, i) =>
        raw.imag[2 * Math.floor(i / raw.width) * raw.width + (i % raw.width)],
    );
    const r = recipe();
    r.magnitude = true;
    const out = transformRawTwoD(raw, 400, r);
    const column = 10;
    expect(out.x[column]).toBe(5.46875);
    // A cosine sampled without sine quadrature cannot distinguish +/- F1 frequencies.
    expect(out.y[4]).toBe(5.625);
    expect(out.y[12]).toBe(4.375);
    expect(out.real[4 * out.width + column]).toBeCloseTo(
      out.real[12 * out.width + column],
      10,
    );
    const s = spectrum();
    s.twoDRaw = raw;
    s.twoDRecipe = r;
    expect(processTwoD(s).warnings.join(" ")).toMatch(
      /mirrored indirect-frequency/,
    );
  });
  it("preserves supplied QF COSY raw rows and supports repeatable Fourier/window replay", () => {
    const fixture = actual("", "COSY"),
      s = importEntries(fixture.entries).spectra[0];
    expect(fixture.raw.acquisitionMode).toBe("QF");
    expect(fixture.raw.height).toBe(128);
    const r = defaultTwoDRecipe(s);
    r.transform = true;
    r.magnitude = true;
    r.f1.window = r.f2.window = "exponential";
    r.f1.lbHz = r.f2.lbHz = 0.3;
    s.twoDRaw = fixture.raw;
    s.twoDRecipe = r;
    const first = processTwoD(s),
      second = processTwoD(s);
    expect(first.data.real.every(Number.isFinite)).toBe(true);
    expect(first.data.height).toBe(256);
    expect(first.data.acquisitionMode).toBe("QF");
    expect(first.data.real).toEqual(second.data.real);
    expect(first.warnings[0]).toMatch(/no measured F1 quadrature/);
  });
  for (const mode of ["States", "States-TPPI", "Echo-Antiecho"] as const)
    it(`transforms calibrated ${mode} samples with true hypercomplex quadrants`, () => {
      const raw = syntheticRaw(mode),
        saved = raw.real.slice(),
        data = transformRawTwoD(raw, 400, recipe());
      const [x, y] = maximum(data);
      expect(x).toBeCloseTo(5.46875, 10);
      expect(y).toBeCloseTo(5.625, 10);
      expect(data.imagBoth).toBeDefined();
      expect(raw.real).toEqual(saved);
      const r = recipe();
      r.magnitude = true;
      const mag = transformRawTwoD(raw, 400, r);
      expect(maximum(mag)).toEqual([x, y]);
      expect(mag.mode).toBe("magnitude");
      expect(mag.imagBoth).toBeUndefined();
    });
  it("per-axis windows and zero filling change actual Fourier data without altering acquired samples", () => {
    const raw = syntheticRaw("States"),
      r = recipe(),
      plain = transformRawTwoD(raw, 400, r);
    r.f2.window = "exponential";
    r.f2.lbHz = 50;
    r.f1.window = "gaussian";
    r.f1.gaussianHz = 50;
    r.f1.zeroFill = 4;
    const out = transformRawTwoD(raw, 400, r);
    expect(out.height).toBe(32);
    expect(out.width).toBe(32);
    expect(Math.max(...out.real)).toBeLessThan(Math.max(...plain.real));
    r.f2.zeroFill = 16;
    expect(() => transformRawTwoD(raw, 400, r)).toThrow(/zero filling/);
  });
  it("rotates all four quadrants along both axes and replays once from immutable source", () => {
    const d = matrix(2, 2);
    d.real.fill(1);
    d.imagF2!.fill(2);
    d.imagF1!.fill(3);
    d.imagBoth!.fill(4);
    const s = spectrum(d);
    s.twoDRecipe!.f2.ph0 = 90;
    s.twoDRecipe!.f1.ph0 = 90;
    const result = processTwoD(s);
    expect(result.data.real[0]).toBeCloseTo(4, 12);
    expect(result.data.imagF2![0]).toBeCloseTo(-3, 12);
    expect(result.data.imagF1![0]).toBeCloseTo(-2, 12);
    expect(result.data.imagBoth![0]).toBeCloseTo(1, 12);
    s.twoD = result.data;
    expect(processTwoD(s).data.real).toEqual(result.data.real);
    expect(d.real[0]).toBe(1);
  });
  it("preserves F1 reference shifts and uses referenced phase pivots on replay", () => {
    const d = matrix(2, 2);
    d.real.fill(1);
    const s = spectrum(d);
    s.referenceOffset = 5;
    s.twoD = { ...d, referenceOffsetF1: 2 };
    s.twoDRecipe!.f2.pivotPpm = 15;
    s.twoDRecipe!.f2.ph1 = 90;
    const out = processTwoD(s).data;
    expect(out.referenceOffsetF1).toBe(2);
    expect(out.real[0]).toBeCloseTo(1, 12);
    expect(out.real[1]).toBeCloseTo(0, 12);
    expect(out.imagF2![1]).toBeCloseTo(1, 12);
  });
  it("requires explicit reconstruction and computes analytic quadrature without inventing raw samples", () => {
    const n = 64,
      values = Float64Array.from({ length: n }, (_, i) =>
        Math.cos((2 * Math.PI * 3 * i) / n),
      );
    const im = analyticQuadrature(values);
    for (let i = 0; i < n; i++)
      expect(im[i]).toBeCloseTo(Math.sin((2 * Math.PI * 3 * i) / n), 10);
    const d = matrix(64, 2);
    d.real.set(values);
    d.real.set(values, 64);
    d.imagF2 = d.imagF1 = d.imagBoth = undefined;
    const s = spectrum(d);
    s.twoDRecipe!.f2.ph0 = 90;
    expect(() => processTwoD(s)).toThrow(/imaginary quadrants/);
    s.twoDRecipe!.reconstructImaginary = true;
    const result = processTwoD(s);
    expect(result.warnings.join(" ")).toMatch(/Hilbert/);
    for (let i = 0; i < n; i++)
      expect(result.data.real[i]).toBeCloseTo(-im[i], 10);
    expect(d.imagF2).toBeUndefined();
  });
  it("fits and previews a manual 2D plane with referenced masks and unchanged excluded points", () => {
    const d = matrix(16, 16),
      s = spectrum(d);
    s.referenceOffset = 1;
    s.twoD = { ...d, referenceOffsetF1: 2 };
    for (let row = 0; row < d.height; row++)
      for (let col = 0; col < d.width; col++)
        d.real[row * d.width + col] = 2 + 0.1 * d.x[col] + 0.2 * d.y[row];
    const r = s.twoDRecipe!;
    r.f2.baseline = "manual";
    r.f2.baselineRegion = [8, 2];
    r.f2.baselineExcludedRegions = [[5.5, 4.5]];
    r.baselinePoints = [
      { xPpm: 11, yPpm: 12, value: 5 },
      { xPpm: 1, yPpm: 12, value: 4 },
      { xPpm: 11, yPpm: 2, value: 3 },
    ];
    const out = processTwoD(s);
    for (let row = 0; row < d.height; row++)
      for (let col = 0; col < d.width; col++) {
        const index = row * d.width + col,
          x = d.x[col] + 1,
          inside = x >= 2 && x <= 8 && !(x >= 4.5 && x <= 5.5);
        expect(out.data.real[index]).toBeCloseTo(
          inside ? 0 : d.real[index],
          10,
        );
        expect(out.baseline![index]).toBeCloseTo(
          inside ? d.real[index] : 0,
          10,
        );
      }
    r.baselinePoints = [
      { xPpm: 1, yPpm: 2, value: 0 },
      { xPpm: 2, yPpm: 3, value: 0 },
      { xPpm: 3, yPpm: 4, value: 0 },
    ];
    expect(() => processTwoD(s)).toThrow(/collinear/);
  });
  it("automatic baseline removes a known row/column drift while retaining an isolated crosspeak", () => {
    const d = matrix(),
      s = spectrum(d);
    for (let row = 0; row < d.height; row++)
      for (let col = 0; col < d.width; col++)
        d.real[row * d.width + col] = 2 + 0.01 * d.x[col] + 0.03 * d.y[row];
    const peak = 16 * d.width + 32;
    d.real[peak] += 20;
    s.twoDRecipe!.f2.baseline = "auto";
    s.twoDRecipe!.f2.baselineMethod = "polynomial";
    s.twoDRecipe!.f2.baselineOrder = 1;
    s.twoDRecipe!.f2.baselineMedianWindow = 1;
    const result = processTwoD(s);
    expect(result.data.real[peak]).toBeCloseTo(20, 3);
    expect(Math.abs(result.data.real[0])).toBeLessThan(0.001);
    expect(result.baseline![0]).toBeCloseTo(d.real[0], 3);
  });
  it("snaps to the nearest signed local peak in referenced ppm, not a stronger remote peak", () => {
    const d = matrix(9, 9);
    d.real[4 * 9 + 4] = -10;
    d.real[4 * 9 + 6] = 40;
    d.referenceOffsetF1 = 2;
    const p = snapTwoDPeak(d, 6.1, 7.1, 1, [3, 2]);
    expect(p?.column).toBe(4);
    expect(p?.row).toBe(4);
    expect(p?.height).toBe(-10);
    expect(p?.xPpm).toBe(6);
    expect(p?.yPpm).toBe(7);
    expect(snapTwoDPeak(d, 50, 50, 1, 0.1)).toBeUndefined();
  });
  it("automatic phase optimizes only the chosen axis from a complex slice", () => {
    const d = matrix(128, 4);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 128; col++) {
        const x = (col - 60) / 3,
          a = (45 * Math.PI) / 180,
          z = 1 / (1 + x * x),
          disp = x / (1 + x * x),
          i = row * 128 + col;
        d.real[i] = z * Math.cos(a) - disp * Math.sin(a);
        d.imagF2![i] = z * Math.sin(a) + disp * Math.cos(a);
      }
    const s = spectrum(d);
    s.twoDRecipe!.f1.ph0 = 20;
    const p = autoPhaseTwoD(s, "F2");
    expect(Number.isFinite(p.ph0 + p.ph1)).toBe(true);
    s.twoDRecipe!.f2 = { ...s.twoDRecipe!.f2, ...p };
    const result = processTwoD(s);
    expect(result.data.real[60]).toBeGreaterThan(d.real[60]);
    expect(s.twoDRecipe!.f1.ph0).toBe(20);
  });
  for (const id of ["4", "5"])
    it(`reprocesses actual ${id === "4" ? "Echo-Antiecho COSY" : "States-TPPI NOESY"} raw sources with correct axis orientation`, () => {
      const files = actual(id),
        native = importEntries(files.entries).spectra[0],
        r = recipe();
      r.magnitude = true;
      const output = transformRawTwoD(files.raw, native.frequencyMHz, r),
        [px, py] = maximum(native.twoD!);
      // Before phase/window/baseline processing, COSY has a stronger carrier/edge artifact.
      // Check a known resolved vendor diagonal peak, excluding the carrier band, to validate orientation.
      let best = -1;
      for (let row = 0; row < output.height; row++)
        for (let col = 0; col < output.width; col++) {
          if (
            Math.abs(output.x[col] - px) > 0.1 ||
            Math.abs(output.y[row] - files.raw.carrierPpmF1) < 0.2
          )
            continue;
          const i = row * output.width + col;
          if (best < 0 || output.real[i] > output.real[best]) best = i;
        }
      const x = output.x[best % output.width],
        y = output.y[Math.floor(best / output.width)];
      expect(Math.abs(x - y)).toBeLessThan(0.08);
      expect(Math.abs(x - px)).toBeLessThan(0.08);
      expect(Math.abs(y - py)).toBeLessThan(0.08);
      expect(output.real.every(Number.isFinite)).toBe(true);
    });
});
