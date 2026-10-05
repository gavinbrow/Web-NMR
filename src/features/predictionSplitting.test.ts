import { describe, it, expect } from "vitest";
import { importMolecule } from "./molecule";
import {
  defaultPredictionSetup,
  validPredictionSetup,
  validPredictionResult,
} from "./predictionSetup";
import {
  estimateProtonCouplings,
  firstOrderLines,
  splitPredictionSignals,
} from "./predictionSplitting";
import { predictedSpectrum } from "./predictedSpectrum";
import { renderPredictionLines } from "./predictionLines";
import { integrate, detectPeaks } from "../core/numerics";
import { encodeProject, decodeProject, validateProject } from "./project";
import { createBlankProject } from "./workspaceDocuments";
import type { PredictionResult } from "../prediction/types";

const ethanol: PredictionResult = {
  nucleus: "1H",
  targetAtomCount: 6,
  missingAtomCount: 0,
  engine: "cdk-hose-nmrshiftdb",
  dataset: "coupling-test",
  warnings: [],
  shifts: [
    [0, 1.2, 3],
    [1, 3.6, 2],
    [2, 2.5, 1],
  ].map(([atomIndex, shiftPpm, hydrogenCount]) => ({
    atomIndex,
    shiftPpm,
    hydrogenCount,
    element: "H",
    sampleCount: 100,
    minPpm: shiftPpm - 0.1,
    maxPpm: shiftPpm + 0.1,
    radius: 4,
    hoseCode: "fixture",
  })),
};

describe("approximate first-order proton prediction", () => {
  it("derives reciprocal ethanol A3X2 couplings and excludes fast-exchange OH", () => {
    const molecule = importMolecule("CCO"),
      model = estimateProtonCouplings(molecule);
    expect(model.couplings).toHaveLength(1);
    expect(model.couplings[0]).toMatchObject({
      atomIndexA: 0,
      atomIndexB: 1,
      hydrogensA: 3,
      hydrogensB: 2,
      jHz: 7,
      source: "estimate",
    });
    const split = splitPredictionSignals(ethanol, molecule, "first-order");
    expect(split.patterns.map((p) => [p.kind, p.lines.length])).toEqual([
      ["t", 3],
      ["q", 4],
      ["s", 1],
    ]);
    expect(split.patterns[0].lines.map((l) => l.weight)).toEqual([
      0.25, 0.5, 0.25,
    ]);
    expect(split.patterns[1].lines.map((l) => l.weight)).toEqual([
      0.125, 0.375, 0.375, 0.125,
    ]);
  });
  it("coalesces equal J into n+1 lines and distinct J into a doublet of doublets", () => {
    const equal = firstOrderLines([
      { count: 1, jHz: 7 },
      { count: 1, jHz: 7 },
    ]);
    expect(equal.kind).toBe("t");
    expect(equal.lines.map((l) => l.offsetHz)).toEqual([7, 0, -7]);
    const dd = firstOrderLines([
      { count: 1, jHz: 10 },
      { count: 1, jHz: 3 },
    ]);
    expect(dd.kind).toBe("dd");
    expect(dd.lines.map((l) => l.offsetHz)).toEqual([6.5, 3.5, -3.5, -6.5]);
    expect(dd.lines.reduce((s, l) => s + l.weight, 0)).toBe(1);
    expect(() =>
      firstOrderLines(
        [1, 2, 3, 5].map((n) => ({ count: 8, jHz: Math.sqrt(n) })),
      ),
    ).toThrow(/1,024/);
  });
  it("does not split equivalent benzene groups and combines isopropyl neighbors into a septet", () => {
    expect(
      estimateProtonCouplings(importMolecule("c1ccccc1")).couplings,
    ).toHaveLength(0);
    const molecule = importMolecule("CC(O)C"),
      model = estimateProtonCouplings(molecule);
    expect(model.couplings).toHaveLength(2);
    const result = {
      ...ethanol,
      targetAtomCount: 8,
      shifts: [
        [0, 1.2, 3],
        [1, 4, 1],
        [2, 2.5, 1],
        [3, 1.2, 3],
      ].map(([atomIndex, shiftPpm, hydrogenCount]) => ({
        ...ethanol.shifts[0],
        atomIndex,
        shiftPpm,
        hydrogenCount,
      })),
    };
    const split = splitPredictionSignals(result, molecule, "first-order");
    expect(split.patterns.map((p) => p.kind)).toEqual(["d", "sept", "s", "d"]);
    const spectrum = predictedSpectrum(
      result,
      { ...defaultPredictionSetup(), molecule },
      molecule,
    );
    expect(spectrum.multiplets.filter((m) => m.kind === "d")).toHaveLength(1);
    expect(spectrum.multiplets.find((m) => m.kind === "d")!.label).toContain(
      "6H",
    );
  });
  it("uses aromatic ortho/meta/para heuristics and flags alkene stereochemical uncertainty", () => {
    const model = estimateProtonCouplings(importMolecule("Oc1cccc(Cl)c1"));
    expect(new Set(model.couplings.map((c) => c.jHz))).toEqual(
      new Set([8, 2, 0.5]),
    );
    const alkene = estimateProtonCouplings(importMolecule("CC=CCCl"));
    expect(alkene.couplings.some((c) => c.jHz === 12)).toBe(true);
    expect(alkene.warnings.some((w) => w.includes("cis/trans"))).toBe(true);
  });
  it("edits J once for both partners, removes J at zero and allows slow-exchange manual OH coupling", () => {
    const molecule = importMolecule("CCO"),
      [a, b, o] = molecule.atoms;
    const overrides = [
      { atomIdA: b.id, atomIdB: a.id, jHz: 9.5 },
      { atomIdA: b.id, atomIdB: o.id, jHz: 3 },
    ];
    const split = splitPredictionSignals(
      ethanol,
      molecule,
      "first-order",
      overrides,
    );
    expect(split.patterns[0].couplingsHz).toEqual([9.5]);
    expect(split.patterns[1].couplingsHz).toEqual([9.5, 3]);
    expect(split.patterns[2].kind).toBe("t");
    expect(
      estimateProtonCouplings(molecule, [
        { atomIdA: a.id, atomIdB: b.id, jHz: 0 },
      ]).couplings,
    ).toHaveLength(0);
    const missing = { ...ethanol, shifts: [ethanol.shifts[0]] };
    expect(
      splitPredictionSignals(missing, molecule, "first-order").patterns[0].kind,
    ).toBe("s");
    const near = {
      ...ethanol,
      shifts: ethanol.shifts.map((s) => ({
        ...s,
        shiftPpm: 1 + s.atomIndex * 0.01,
      })),
    };
    expect(
      splitPredictionSignals(
        near,
        molecule,
        "first-order",
        [],
        400,
      ).warnings.some((w) => w.includes("second-order")),
    ).toBe(true);
  });
  it("preserves 3:2 areas, resolves Pascal intensities and keeps J in Hz when changing field", () => {
    const molecule = importMolecule("CCO"),
      setup = { ...defaultPredictionSetup(), molecule };
    const spectrum = predictedSpectrum(ethanol, setup, molecule),
      highField = predictedSpectrum(
        ethanol,
        { ...setup, frequencyMHz: 800 },
        molecule,
      );
    expect(spectrum.peaks).toHaveLength(8);
    expect(integrate(spectrum.data, 0, 1, 1.4)).toBeCloseTo(3, 1);
    expect(integrate(spectrum.data, 0, 3.4, 3.8)).toBeCloseTo(2, 1);
    const t = spectrum.peaks
      .filter((p) => Math.abs(p.ppm - 1.2) < 0.1)
      .sort((a, b) => b.ppm - a.ppm);
    const t2 = highField.peaks
      .filter((p) => Math.abs(p.ppm - 1.2) < 0.1)
      .sort((a, b) => b.ppm - a.ppm);
    expect((t[0].ppm - t[1].ppm) * 400).toBeCloseTo(7, 8);
    expect((t2[0].ppm - t2[1].ppm) * 800).toBeCloseTo(7, 8);
    expect(t[1].height / t[0].height).toBe(2);
    const actual = detectPeaks(spectrum.data, 0, 1, 0)
      .filter((p) => Math.abs(p.ppm - 1.2) < 0.1)
      .sort((a, b) => b.ppm - a.ppm);
    expect(actual).toHaveLength(3);
    expect(actual[1].height / actual[0].height).toBeCloseTo(2, 1);
    expect(spectrum.prediction!.splitting!.mode).toBe("first-order");
    expect(spectrum.metadata.comments).toContain("not calculated");
  });
  it("keeps carbon decoupled and original project setups unsplit", () => {
    const molecule = importMolecule("CCO");
    const carbon = {
      ...ethanol,
      nucleus: "13C" as const,
      targetAtomCount: 2,
      shifts: ethanol.shifts.slice(0, 2).map((s) => ({
        ...s,
        element: "C" as const,
        hydrogenCount: 1,
        shiftPpm: s.shiftPpm * 20,
      })),
    };
    const spectrum = predictedSpectrum(
      carbon,
      {
        ...defaultPredictionSetup(),
        molecule,
        nucleus: "13C",
        frequencyMHz: 100.6,
      },
      molecule,
    );
    expect(spectrum.peaks).toHaveLength(2);
    expect(spectrum.multiplets).toHaveLength(0);
    expect(spectrum.prediction!.splitting!.mode).toBe("none");
    const legacy = { ...defaultPredictionSetup(), molecule };
    delete legacy.splitting;
    delete legacy.couplingOverrides;
    expect(validPredictionSetup(legacy)).toBe(true);
    expect(predictedSpectrum(ethanol, legacy, molecule).peaks).toHaveLength(8);
  });
  it("preserves J overrides, patterns and provenance in saved projects; rejects malformed saved J", async () => {
    const molecule = importMolecule("CCO"),
      setup = {
        ...defaultPredictionSetup(),
        molecule,
        couplingOverrides: [
          {
            atomIdA: molecule.atoms[0].id,
            atomIdB: molecule.atoms[1].id,
            jHz: 9.1,
          },
        ],
      };
    const spectrum = predictedSpectrum(ethanol, setup, molecule);
    const project = {
      ...createBlankProject("Split prediction"),
      prediction: setup,
      spectra: [spectrum],
      activeId: spectrum.id,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.prediction).toEqual(setup);
    expect(reopened.spectra[0].prediction).toEqual(spectrum.prediction);
    expect(validPredictionResult(spectrum.prediction)).toBe(true);
    const invalid = structuredClone(project);
    invalid.spectra[0].prediction!.splitting!.couplings[0].jHz = Infinity;
    expect(() => validateProject(invalid)).toThrow(/prediction/);
    expect(
      validPredictionSetup({
        ...setup,
        couplingOverrides: [{ ...setup.couplingOverrides[0], jHz: -2 }],
      }),
    ).toBe(false);
  });
  it("convolves full complex line shapes without edge wrap and bounds overly fine sampling explicitly", () => {
    const { data, renderedLineWidthHz } = renderPredictionLines(
      [{ ppm: 1, weight: 1 }],
      -2,
      14,
      400,
      1,
    );
    expect(renderedLineWidthHz).toBe(1);
    const index = data.x.findIndex((x) => x < 1),
      d = data.x[index] - 1,
      gamma = 1 / 400 / 2;
    const analytic = gamma / (Math.PI * (d * d + gamma * gamma));
    // Sub-grid stick interpolation changes peak height by less than one percent.
    expect(Math.abs(data.real[index] / analytic - 1)).toBeLessThan(0.01);
    const left = data.x.findIndex((x) => x < 1.05),
      right = data.x.findIndex((x) => x < 0.95);
    expect(data.imag![left]).toBeLessThan(0);
    expect(data.imag![right]).toBeGreaterThan(0);
    expect(data.real[0]).toBeLessThan(0.00001);
    expect(integrate(data, 0, -2, 14)).toBeCloseTo(1, 3);
    const bounded = renderPredictionLines(
      [{ ppm: 1, weight: 1 }],
      -2,
      14,
      2000,
      0.1,
    );
    expect(bounded.data.x.length).toBe(262144);
    expect(bounded.renderedLineWidthHz).toBeGreaterThan(0.1);
  });
});
