import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  defaultRecipe,
  type ComplexData,
  type ImportEntry,
  type Spectrum,
} from "../model";
import {
  analyzeMultiplet,
  applyPhase,
  autoPhase,
  correctDigitalFilter,
  brukerPhaseCorrection,
  detectPeaks,
  fft,
  integrate,
  processSpectrum,
} from "./numerics";
import { importEntries } from "./imports";

function spectrum(data: ComplexData): Spectrum {
  return {
    id: "test",
    label: "test",
    color: "#000",
    sourceFormat: "synthetic",
    frequencyMHz: 400,
    nucleus: "1H",
    metadata: {},
    original: data,
    data,
    recipe: defaultRecipe(),
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
}
function gaussian(center = 2, width = 0.02): ComplexData {
  const x = new Float64Array(8192),
    real = new Float64Array(8192),
    imag = new Float64Array(8192);
  for (let i = 0; i < x.length; i++) {
    x[i] = 8 - (i * 10) / x.length;
    real[i] = Math.exp(-(((x[i] - center) / width) ** 2));
  }
  return { x, real, imag };
}
function fixtureEntries(folder: string): ImportEntry[] {
  const base = join(process.cwd(), "../Example Files", folder),
    entries: ImportEntry[] = [];
  const walk = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, e.name);
      if (e.isDirectory()) walk(file);
      else if (
        [
          "fid",
          "ser",
          "acqus",
          "acqu2s",
          "procs",
          "proc2s",
          "1r",
          "1i",
          "2rr",
          "2ri",
          "2ir",
          "2ii",
          "title",
        ].includes(e.name)
      ) {
        const data = readFileSync(file);
        entries.push({
          path: join(folder, relative(base, file)),
          data: data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ),
        });
      }
    }
  };
  walk(base);
  return entries;
}

describe("independent numerical engine", () => {
  it("matches an analytical complex DFT and preserves source arrays", () => {
    const real = Float64Array.from([1, 2, 3, -1, 0, 2, -3, 1]),
      imag = Float64Array.from([0, 2, 1, 1, 0, -1, 1, 0]);
    const expectedR = new Float64Array(8),
      expectedI = new Float64Array(8);
    for (let k = 0; k < 8; k++)
      for (let j = 0; j < 8; j++) {
        const angle = (2 * Math.PI * j * k) / 8;
        expectedR[k] += real[j] * Math.cos(angle) - imag[j] * Math.sin(angle);
        expectedI[k] += real[j] * Math.sin(angle) + imag[j] * Math.cos(angle);
      }
    fft(real, imag, true);
    for (let i = 0; i < 8; i++) {
      expect(real[i]).toBeCloseTo(expectedR[i], 10);
      expect(imag[i]).toBeCloseTo(expectedI[i], 10);
    }
    const data = gaussian(),
      before = data.real.slice(),
      s = spectrum(data);
    s.recipe.ph0 = 90;
    const processed = processSpectrum(s);
    expect(processed.real[4915]).toBeCloseTo(0, 10);
    expect(data.real).toEqual(before);
  });
  it("constructs decreasing ppm with correct positive-exponential Bruker frequency convention", () => {
    const n = 1024,
      real = new Float64Array(n),
      imag = new Float64Array(n),
      s = spectrum(gaussian());
    for (let i = 0; i < n; i++) {
      real[i] = Math.cos((2 * Math.PI * 64 * i) / n);
      imag[i] = Math.sin((2 * Math.PI * 64 * i) / n);
    }
    s.fid = {
      real,
      imag,
      dwellSeconds: 1 / 4000,
      spectralWidthHz: 4000,
      carrierPpm: 5,
      groupDelay: 0,
    };
    s.recipe.transform = true;
    s.recipe.window = "none";
    s.recipe.zeroFill = 1;
    s.recipe.digitalFilter = false;
    const data = processSpectrum(s),
      peak = detectPeaks(data, 0, 50, 0)[0];
    expect(data.x[0]).toBe(10);
    expect(data.x[1]).toBeLessThan(data.x[0]);
    expect(peak.ppm).toBeCloseTo(5.625, 10);
    expect(peak.height).toBeCloseTo(1024, 8);
  });
  it("validates integer GRPDLY correction and compensation against its direct circular-shift identity", () => {
    const real = Float64Array.from({ length: 128 }, (_, i) => i),
      imag = Float64Array.from(real, (v) => -v);
    const out = correctDigitalFilter({
      real,
      imag,
      groupDelay: 10,
      dwellSeconds: 1,
      spectralWidthHz: 1,
      carrierPpm: 0,
    });
    expect(out.real.length).toBe(116);
    expect(out.real[0]).toBe(10 + 9);
    expect(out.real[5]).toBe(15 + 4);
    expect(out.real[6]).toBe(16);
    expect(out.imag[0]).toBe(-19);
    expect(real[0]).toBe(0);
  });
  it("removes a known fractional delay from a periodic complex FID, preserving phase and samples", () => {
    for (const groupDelay of [0.375, 10.375]) {
      const n = 128,
        k = 5,
        angle = (i: number) => (2 * Math.PI * k * i) / n;
      const real = Float64Array.from({ length: n }, (_, i) =>
          Math.cos(angle(i - groupDelay)),
        ),
        imag = Float64Array.from({ length: n }, (_, i) =>
          Math.sin(angle(i - groupDelay)),
        ),
        saved = real.slice();
      const out = correctDigitalFilter({
        real,
        imag,
        groupDelay,
        dwellSeconds: 1,
        spectralWidthHz: 1,
        carrierPpm: 0,
      });
      const skip = Math.floor(groupDelay) + 2,
        add = Math.max(skip - 6, 0);
      expect(out.real.length).toBe(n - skip);
      for (let i = 0; i < out.real.length; i++) {
        expect(out.real[i]).toBeCloseTo(
          Math.cos(angle(i)) + (i < add ? Math.cos(angle(n - 1 - i)) : 0),
          10,
        );
        expect(out.imag[i]).toBeCloseTo(
          Math.sin(angle(i)) + (i < add ? Math.sin(angle(n - 1 - i)) : 0),
          10,
        );
      }
      expect(real).toEqual(saved);
    }
  });
  it("maps stored TopSpin phase onto the exact descending FFT grid and referenced pivot", () => {
    const data = {
      x: Float64Array.from([10, 8, 6, 4]),
      real: Float64Array.from([1, 1, 1, 1]),
      imag: new Float64Array(4),
    };
    const mapped = brukerPhaseCorrection(data, 30, -80, 2);
    expect(mapped).toEqual({ ph0: -30, ph1: 60, pivotPpm: 12 });
    applyPhase(data, mapped.ph0, mapped.ph1, mapped.pivotPpm - 2);
    for (let i = 0; i < 4; i++)
      expect(data.real[i]).toBeCloseTo(
        Math.cos(((-30 + (80 * i) / 4) * Math.PI) / 180),
        12,
      );
  });
  it("integrates clipped endpoints, signed intensity and reference offsets", () => {
    const data = {
      x: Float64Array.from([3, 2, 1, 0]),
      real: Float64Array.from([3, 2, 1, 0]),
    };
    expect(integrate(data, 0, 0.5, 2.5)).toBeCloseTo(3, 12);
    expect(integrate(data, 4, 4.5, 6.5)).toBeCloseTo(3, 12);
    const negative = {
      x: data.x,
      real: Float64Array.from(data.real, (v) => -v),
    };
    expect(integrate(negative, 0, 0.5, 2.5)).toBeCloseTo(-3, 12);
    const g = gaussian();
    expect(integrate(g, 0, 1, 3)).toBeCloseTo(0.02 * Math.sqrt(Math.PI), 9);
  });
  it("preserves isolated positive and negative peak areas when removing a flat baseline", () => {
    for (const sign of [-1, 1]) {
      const g = gaussian();
      for (let i = 0; i < g.real.length; i++) g.real[i] = 3 + sign * g.real[i];
      const s = spectrum(g);
      s.recipe.baseline = "auto";
      const corrected = processSpectrum(s);
      expect(corrected.real[0]).toBeCloseTo(0, 8);
      expect(integrate(corrected, 0, 1.9, 2.1)).toBeCloseTo(
        sign * 0.02 * Math.sqrt(Math.PI),
        5,
      );
      expect(g.real[0]).toBe(3);
    }
  });
  it("uses exact piecewise interpolation for manual baseline anchors", () => {
    const x = Float64Array.from([3, 2, 1, 0]),
      real = Float64Array.from([5, 4, 3, 2]),
      s = spectrum({ x, real });
    s.recipe.baseline = "manual";
    s.recipe.baselineAnchors = [
      { ppm: 0, value: 2 },
      { ppm: 3, value: 5 },
    ];
    expect([...processSpectrum(s).real]).toEqual([0, 0, 0, 0]);
    expect([...real]).toEqual([5, 4, 3, 2]);
  });
  it("rotates complex data about an explicit pivot and recovers constant positive phase", () => {
    const g = gaussian(),
      distorted = applyPhase(
        { x: g.x.slice(), real: g.real.slice(), imag: g.imag!.slice() },
        47,
        0,
        2,
      );
    const s = spectrum(distorted);
    s.recipe.pivotPpm = 2;
    const result = autoPhase(s);
    const corrected = applyPhase(
      {
        x: distorted.x,
        real: distorted.real.slice(),
        imag: distorted.imag!.slice(),
      },
      result.ph0,
      result.ph1,
      2,
    );
    const peak = detectPeaks(corrected, 0, 80, 0)[0];
    expect(peak.height).toBeGreaterThan(0.998);
    expect(result.ph0).toBeCloseTo(-47, 0);
    expect(() => applyPhase({ x: g.x, real: g.real }, 1, 0, 2)).toThrow(
      /imaginary/,
    );
  });
  it("classifies only conservative first-order multiplicities with nucleus frequency", () => {
    const g = gaussian(2 - 0.01, 0.002),
      second = gaussian(2 + 0.01, 0.002);
    for (let i = 0; i < g.real.length; i++) g.real[i] += second.real[i];
    const m = analyzeMultiplet(g, 0, 1.95, 2.05, 400);
    expect(m.kind).toBe("d");
    expect(m.couplingsHz[0]).toBeCloseTo(8, 1);
    expect(m.center).toBeCloseTo(2, 3);
  });
});

describe("reference and replay regression checks", () => {
  it("replaying phase and manual baseline is invariant to referenced coordinate translation", () => {
    const g = gaussian(),
      s = spectrum(g);
    s.recipe.ph0 = 20;
    s.recipe.ph1 = 35;
    s.recipe.pivotPpm = 2;
    s.recipe.baseline = "manual";
    s.recipe.baselineAnchors = [
      { ppm: 0, value: 0.1 },
      { ppm: 5, value: 0.2 },
    ];
    const before = processSpectrum(s),
      delta = 3.7;
    const translated = {
      ...s,
      referenceOffset: delta,
      recipe: {
        ...s.recipe,
        pivotPpm: s.recipe.pivotPpm + delta,
        baselineAnchors: s.recipe.baselineAnchors.map((a) => ({
          ...a,
          ppm: a.ppm + delta,
        })),
      },
    };
    const after = processSpectrum(translated);
    for (let i = 0; i < before.real.length; i += 37) {
      expect(after.real[i]).toBeCloseTo(before.real[i], 12);
      expect(after.imag![i]).toBeCloseTo(before.imag![i], 12);
    }
    expect(integrate(after, delta, 1.9 + delta, 2.1 + delta)).toBeCloseTo(
      integrate(before, 0, 1.9, 2.1),
      12,
    );
  });
  it("always replays source rather than applying corrections to previously processed data", () => {
    const s = spectrum(gaussian());
    s.recipe.ph0 = 30;
    s.recipe.baseline = "manual";
    s.recipe.baselineAnchors = [
      { ppm: 0, value: 0.2 },
      { ppm: 7, value: 0.2 },
    ];
    const once = processSpectrum(s);
    s.data = once;
    const twice = processSpectrum(s);
    expect(twice.real).toEqual(once.real);
    expect(twice.imag).toEqual(once.imag);
    s.recipe.ph0 = 0;
    s.recipe.baseline = "none";
    expect(processSpectrum(s).real).toEqual(s.original.real);
  });
  it("decodes declared big-endian float64 processed data and NC_proc scaling", () => {
    const buffer = new ArrayBuffer(32),
      view = new DataView(buffer);
    for (let i = 0; i < 4; i++) view.setFloat64(i * 8, i + 0.5, false);
    const procs =
      "##$BYTORDP= 1\n##$DTYPP= 2\n##$SI= 4\n##$SF= 100\n##$SW_p= 400\n##$OFFSET= 3\n##$NC_proc= -1";
    const r = importEntries([
      { path: "float64/1r", data: buffer },
      { path: "float64/procs", data: new TextEncoder().encode(procs).buffer },
    ]);
    expect([...r.spectra[0].data.real]).toEqual([0.25, 0.75, 1.25, 1.75]);
    expect([...r.spectra[0].data.x]).toEqual([3, 2, 1, 0]);
  });
  it("raw-only import preserves original FID and yields repeatable transforms", () => {
    const entries = fixtureEntries("Proton").filter(
      (e) => !e.path.includes("/pdata/"),
    );
    const r = importEntries(entries);
    expect(r.warnings).toEqual([]);
    expect(r.spectra).toHaveLength(1);
    const s = r.spectra[0];
    expect(s.recipe.transform).toBe(true);
    const fidBefore = s.fid!.real.slice(),
      originalBefore = s.original.real.slice();
    expect(processSpectrum(s).real).toEqual(originalBefore);
    s.recipe.lbHz = 2;
    s.recipe.window = "exponential";
    s.data = processSpectrum(s);
    expect(s.fid!.real).toEqual(fidBefore);
    expect(s.original.real).toEqual(originalBefore);
    s.recipe.window = "none";
    expect(processSpectrum(s).real).toEqual(originalBefore);
    s.recipe.transform = false;
    expect(processSpectrum(s).real).toEqual(originalBefore);
  });
});

describe("vendor and text adapters", () => {
  it("replays full fractional delay and saved phase against actual native proton and carbon absorption", () => {
    for (const folder of ["Proton", "Carbon (publication grade)"]) {
      const s = importEntries(fixtureEntries(folder)).spectra[0],
        vendor = s.original;
      const file = readFileSync(
          join(process.cwd(), "../Example Files", folder, "pdata/1/1i"),
        ),
        vendorImag = Float64Array.from(
          { length: vendor.real.length },
          (_, i) => -file.readInt32LE(i * 4) * 2 ** Number(s.metadata.NC_proc),
        );
      s.recipe = {
        ...defaultRecipe(),
        transform: true,
        window: "exponential",
        lbHz: Number(s.metadata.LB),
        zeroFill: 4,
      };
      const unphased = processSpectrum(s);
      Object.assign(
        s.recipe,
        brukerPhaseCorrection(
          unphased,
          Number(s.metadata.PHC0),
          Number(s.metadata.PHC1),
        ),
      );
      const actual = processSpectrum(s);
      let dotR = 0,
        normR = 0,
        normV = 0,
        crossR = 0,
        crossI = 0,
        normComplex = 0,
        vendorComplex = 0,
        peakAmplitude = 0;
      for (let i = 0; i < vendor.real.length; i++)
        peakAmplitude = Math.max(
          peakAmplitude,
          Math.hypot(vendor.real[i], vendorImag[i]),
        );
      for (let i = 0; i < actual.real.length; i++) {
        const r = actual.real[i],
          im = actual.imag![i],
          vr = vendor.real[i],
          vi = vendorImag[i];
        dotR += r * vr;
        normR += r * r;
        normV += vr * vr;
        if (Math.hypot(vr, vi) > peakAmplitude * 0.01) {
          crossR += r * vr + im * vi;
          crossI += r * vi - im * vr;
          normComplex += r * r + im * im;
          vendorComplex += vr * vr + vi * vi;
        }
      }
      // Check real absorption across the full dataset and complex phase in resolved signal above 1% noise/background.
      expect(dotR / Math.sqrt(normR * normV)).toBeGreaterThan(
        folder === "Proton" ? 0.99 : 0.9,
      );
      expect(
        Math.hypot(crossR, crossI) / Math.sqrt(normComplex * vendorComplex),
      ).toBeGreaterThan(folder === "Proton" ? 0.999 : 0.985);
      expect(
        Math.abs((Math.atan2(crossI, crossR) * 180) / Math.PI),
      ).toBeLessThan(6);
      expect(actual.real.length).toBe(vendor.real.length);
      expect(s.original.real).toBe(vendor.real);
    }
  }, 15000);
  it("imports actual supplied Bruker proton and million-point carbon without reapplying phase", () => {
    for (const folder of ["Proton", "Carbon (publication grade)"]) {
      const result = importEntries(fixtureEntries(folder));
      expect(result.warnings).toEqual([]);
      expect(result.spectra).toHaveLength(1);
      const s = result.spectra[0];
      expect(s.fid).toBeDefined();
      expect(s.original.imag).toBeDefined();
      expect(s.recipe.transform).toBe(false);
      expect(s.recipe.ph0).toBe(0);
      expect(s.original.x[0]).toBeCloseTo(Number(s.metadata.OFFSET), 10);
      expect(s.original.x[1]).toBeLessThan(s.original.x[0]);
      expect(s.original.real.length).toBe(
        folder === "Proton" ? 131072 : 1048576,
      );
      const copy = processSpectrum(s);
      expect(copy.real[1000]).toBe(s.original.real[1000]);
      expect(copy.real).not.toBe(s.original.real);
      s.recipe.transform = true;
      s.recipe.zeroFill = 2;
      const raw = processSpectrum(s);
      expect(raw.real.every(Number.isFinite)).toBe(true);
      const magnitude = (d: ComplexData): ComplexData => ({
        x: d.x,
        real: Float64Array.from(d.real, (v, i) =>
          Math.hypot(v, d.imag?.[i] || 0),
        ),
      });
      const processedPeak = detectPeaks(magnitude(s.original), 0, 85, 0.02)[0],
        rawPeak = detectPeaks(magnitude(raw), 0, 85, 0.02)[0];
      expect(Math.abs(processedPeak.ppm - rawPeak.ppm)).toBeLessThan(0.05);
    }
  }, 15000);
  it("opens actual COSY and NOESY as 2D matrices with a separate projection", () => {
    for (const folder of ["COSY", "DAC-1P Nosy Cosy C13/5"]) {
      const r = importEntries(fixtureEntries(folder));
      expect(r.spectra).toHaveLength(1);
      expect(r.warnings).toEqual([]);
      const twoD = r.spectra[0].twoD!;
      expect(twoD.real.length).toBe(twoD.width * twoD.height);
      expect(r.spectra[0].data.real.length).toBe(twoD.width);
    }
  });
  it("sorts explicit ppm CSV and rejects duplicate coordinates", () => {
    const entry = (text: string): ImportEntry => ({
      path: "test.csv",
      data: new TextEncoder().encode(text).buffer,
    });
    const result = importEntries([entry("ppm,intensity\n0,1\n2,3\n1,2")]);
    expect([...result.spectra[0].data.x]).toEqual([2, 1, 0]);
    expect(result.spectra[0].frequencyMHz).toBe(0);
    expect(importEntries([entry("1,1\n1,3")]).warnings.join(" ")).toMatch(
      /unique/,
    );
  });
  it("supports AFFN JCAMP and rejects compressed or uncalibrated axes", () => {
    const input = (text: string): ImportEntry => ({
      path: "test.dx",
      data: new TextEncoder().encode(text).buffer,
    });
    const text =
      "##TITLE=Test\n##XUNITS=PPM\n##NPOINTS=3\n##.OBSERVE FREQUENCY=400\n##XYPOINTS=(XY..XY)\n3,1 2,4 1,1\n##END=";
    const r = importEntries([input(text)]);
    expect(r.warnings).toEqual([]);
    expect(r.spectra[0].frequencyMHz).toBe(400);
    expect([...r.spectra[0].data.real]).toEqual([1, 4, 1]);
    expect(
      importEntries([
        input(text.replace("3,1 2,4 1,1", "3A2B1")),
      ]).warnings.join(" "),
    ).toMatch(/Compressed/);
    expect(
      importEntries([input(text.replace("PPM", "HZ"))]).warnings.join(" "),
    ).toMatch(/XUNITS/);
  });
});
