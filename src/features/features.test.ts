import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { defaultRecipe, type Project, type Spectrum } from "../model";
import { encodeProject, decodeProject } from "./project";
import { fitKinetics } from "./kinetics";
import { csvCell, spectrumCSV, analysisCSV, spectrumJCAMP } from "./export";
import { shortcutCommand } from "./shortcuts";
import { createDemoSpectra } from "./demo";

function project(): Project {
  const original = {
    x: new Float64Array([4, 3, 2, 1]),
    real: new Float64Array([0, 1.123456789012345, -2, 0]),
    imag: new Float64Array([1, 2, 3, 4]),
  };
  const spectrum: Spectrum = {
    id: "test",
    label: '=malicious, "sample"',
    color: "#abc",
    nucleus: "1H",
    frequencyMHz: 400.13,
    sourceFormat: "Test",
    metadata: { experiment: "sample", scans: 16 },
    original,
    data: {
      x: original.x.slice(),
      real: original.real.slice(),
      imag: original.imag!.slice(),
    },
    fid: {
      real: new Float64Array([1, 2, 3, 4]),
      imag: new Float64Array([5, 6, 7, 8]),
      dwellSeconds: 0.0001,
      groupDelay: 1.5,
      carrierPpm: 5,
      spectralWidthHz: 10_000,
    },
    recipe: {
      ...defaultRecipe(),
      ph0: 35.6,
      baseline: "manual",
      baselineAnchors: [{ ppm: 1, value: 0.1 }],
    },
    referenceOffset: 0.2,
    peaks: [{ id: "p", ppm: 3, height: 1.123 }],
    integrals: [
      { id: "i", from: 3.5, to: 2.5, area: 2.5, label: "=HYPERLINK(1)" },
    ],
    multiplets: [
      {
        id: "m",
        from: 3.5,
        to: 2.5,
        center: 3,
        kind: "d",
        couplingsHz: [7.4],
        peakCount: 2,
        label: "A",
      },
    ],
    integralScale: 2,
    gain: 12,
    visible: true,
    timeMinutes: 15,
    history: ["Imported test"],
    revision: 1,
  };
  return {
    version: 1,
    name: "Project",
    spectra: [spectrum],
    activeId: spectrum.id,
    view: [4.2, 1.2],
    displayMode: "stack",
    normalization: "maximum",
    savedAt: new Date().toISOString(),
  };
}
describe("portable project", () => {
  it("round-trips original, processed and FID precision with complete analysis and display settings", async () => {
    const source = project(),
      result = await decodeProject(await encodeProject(source));
    expect(result.spectra[0]).toEqual(source.spectra[0]);
    expect(result.spectra[0].data.real).toBeInstanceOf(Float64Array);
    expect(result.spectra[0].fid?.imag).toEqual(new Float64Array([5, 6, 7, 8]));
    expect(result.view).toEqual(source.view);
  });
  it("rejects unsupported schema and malformed array references", async () => {
    const files = unzipSync(await encodeProject(project()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    manifest.version = 999;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(decodeProject(zipSync(files))).rejects.toThrow(
      "unsupported version",
    );
    manifest.version = 1;
    manifest.spectra[0].data.real.length = 2;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(decodeProject(zipSync(files))).rejects.toThrow("array length");
  });
  it("rejects nonmonotonic axes", async () => {
    const p = project();
    p.spectra[0].data.x[2] = 5;
    await expect(encodeProject(p)).rejects.toThrow("monotonic");
  });
  it("saves unknown spectrometer frequency without inventing JCAMP acquisition metadata", async () => {
    const source = project();
    source.spectra[0].frequencyMHz = 0;
    source.spectra[0].nucleus = "Unknown";
    const result = await decodeProject(await encodeProject(source));
    expect(result.spectra[0].frequencyMHz).toBe(0);
    expect(spectrumJCAMP(result.spectra[0])).not.toContain("##.OBSERVE FREQUENCY=");
    expect(spectrumJCAMP(result.spectra[0])).not.toContain("##.OBSERVE NUCLEUS=");
    expect(spectrumJCAMP(result.spectra[0])).toContain("##XYPOINTS=(XY..XY)");
  });
  it("rejects spectrum colors that could inject markup in figure exports", async () => {
    const source = project();
    source.spectra[0].color = '\"/><script>alert(1)</script>';
    await expect(encodeProject(source)).rejects.toThrow("color");
  });
});
describe("kinetic numerical recovery", () => {
  it("recovers offset decay parameters and ignores an excluded outlier", () => {
    const points = [2, 7, 12, 17, 22, 32].map((time, i) => ({
      id: String(i),
      time,
      value: 1.3 + 4.2 * Math.exp(-0.065 * (time - 2)),
      included: true,
    }));
    points.push({ id: "excluded", time: 14, value: 100, included: false });
    const fit = fitKinetics(points, "decay");
    expect(fit.parameters.rate).toBeCloseTo(0.065, 7);
    expect(fit.parameters.offset).toBeCloseTo(1.3, 6);
    expect(fit.parameters.amplitude).toBeCloseTo(4.2, 6);
    expect(fit.parameters.timeOrigin).toBe(2);
    expect(fit.halfLife).toBeCloseTo(Math.LN2 / 0.065, 5);
    expect(fit.rSquared).toBeCloseTo(1, 10);
    expect(fit.predicted).toHaveLength(7);
  });
  it("recovers exponential growth and a linear model", () => {
    const points = [0, 5, 10, 20, 30].map((time, i) => ({
      id: String(i),
      time,
      value: 0.2 + 2.5 * (1 - Math.exp(-0.1 * time)),
      included: true,
    }));
    const fit = fitKinetics(points, "growth");
    expect(fit.parameters.rate).toBeCloseTo(0.1, 7);
    expect(fit.parameters.offset).toBeCloseTo(0.2, 6);
    const linear = fitKinetics(
      points.map((p) => ({ ...p, value: -2 + 3 * p.time })),
      "linear",
    );
    expect(linear.parameters.slope).toBeCloseTo(3, 12);
    expect(linear.parameters.intercept).toBeCloseTo(-2, 12);
  });
  it("rejects insufficient time span and unresolved constant measurements", () => {
    const points = [0, 1, 2, 3].map((i) => ({
      id: String(i),
      time: 1,
      value: i,
      included: true,
    }));
    expect(() => fitKinetics(points, "decay")).toThrow("different");
    expect(() =>
      fitKinetics(
        points.map((p, i) => ({ ...p, time: i, value: 1 })),
        "decay",
      ),
    ).toThrow("constant");
  });
  it("recovers the simulated reaction rate from full-resolution real spectral areas", () => {
    const spectra = createDemoSpectra();
    const points = spectra.map((s) => {
      let area = 0;
      for (let i = 1; i < s.data.x.length; i++)
        if (s.data.x[i] >= 4 && s.data.x[i - 1] <= 4.24)
          area +=
            ((s.data.real[i - 1] + s.data.real[i]) / 2) *
            Math.abs(s.data.x[i] - s.data.x[i - 1]);
      return { id: s.id, time: s.timeMinutes!, value: area, included: true };
    });
    const fit = fitKinetics(points, "decay");
    expect(fit.parameters.rate).toBeCloseTo(0.065, 3);
    expect(fit.rSquared).toBeGreaterThan(0.999);
    expect(spectra[0].sourceFormat).toBe("Synthetic demo");
    expect(spectra[0].fid?.imag.length).toBe(8192);
  });
});
describe("exports and keys", () => {
  it("exports analytical arrays and normalization independently of display gain", () => {
    const s = project().spectra[0];
    expect(spectrumCSV(s)).toContain("3.2,1.123456789012345,2");
    expect(analysisCSV(s, "integrals")).toContain("2.5,5,2");
    expect(analysisCSV(s, "peaks")).toContain('"p",3,1.123');
    expect(analysisCSV(s, "integrals")).toContain("3.5,2.5,2.5,5,2");
    expect(analysisCSV(s, "multiplets")).toContain('3.5,2.5,3,"d"');
    expect(spectrumJCAMP(s)).toContain("##.OBSERVE FREQUENCY=400.13");
    expect(spectrumJCAMP({ ...s, label: "unsafe\n##END=" })).toContain(
      "##TITLE=unsafe END=",
    );
  });
  it("guards spreadsheet formulas while leaving negative numeric values intact", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell("  @cmd")).toBe('"\'  @cmd"');
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it("matches exact Mnova analysis keys without confusing peak-by-peak with threshold", () => {
    const key = {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      key: "k",
    };
    expect(shortcutCommand(key)).toBe("peakThreshold");
    expect(shortcutCommand({ ...key, metaKey: true })).toBe("peak");
    expect(shortcutCommand({ ...key, key: "P", shiftKey: true })).toBe(
      "manualPhase",
    );
    expect(shortcutCommand({ ...key, key: "y", ctrlKey: true })).toBe("redo");
  });
});
