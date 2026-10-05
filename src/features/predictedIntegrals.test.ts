import { describe, it, expect } from "vitest";
import { importMolecule } from "./molecule";
import {
  defaultPredictionSetup,
  validPredictionResult,
  validPredictionSetup,
} from "./predictionSetup";
import { predictedSpectrum } from "./predictedSpectrum";
import {
  displayedIntegralValue,
  normalizeIntegral,
  recalibrateIntegrals,
} from "./integrals";
import { createBlankProject } from "./workspaceDocuments";
import { encodeProject, decodeProject } from "./project";
import { renderLearnedSpinSystem } from "../prediction/learnedSpin";
import type {
  PredictionResult,
  PredictedSpinSystem,
} from "../prediction/types";
function ethanol(): PredictionResult {
  return {
    engine: "cdk-hose-nmrshiftdb",
    dataset: "fixture",
    nucleus: "1H",
    targetAtomCount: 6,
    missingAtomCount: 0,
    warnings: [],
    shifts: [
      { atomIndex: 0, shiftPpm: 1.2, hydrogenCount: 3 },
      { atomIndex: 1, shiftPpm: 3.6, hydrogenCount: 2 },
      { atomIndex: 2, shiftPpm: 2.1, hydrogenCount: 1 },
    ].map((s) => ({
      ...s,
      element: "H",
      sampleCount: 5,
      minPpm: s.shiftPpm,
      maxPpm: s.shiftPpm,
      radius: 3,
      hoseCode: "fixture",
    })),
  };
}
describe("automatic predicted integral counts", () => {
  it("starts with splitting and exact 3:2:1 reporting without raw area values", () => {
    const m = importMolecule("CCO"),
      s = predictedSpectrum(
        ethanol(),
        { ...defaultPredictionSetup(), molecule: m },
        m,
      );
    expect(s.prediction?.splitting?.mode).toBe("first-order");
    expect(s.integrals.map((i) => displayedIntegralValue(s, i))).toEqual([
      2, 1, 3,
    ]);
    expect(s.integrals.reduce((n, i) => n + i.predicted!.nucleusCount, 0)).toBe(
      6,
    );
    expect(s.integrals.every((i) => i.area > 0)).toBe(true);
    const normalized = normalizeIntegral(s, s.integrals[0].id, 1);
    expect(normalized.integrals.every((i) => !i.predicted)).toBe(true);
    expect(displayedIntegralValue(normalized, normalized.integrals[0])).toBe(1);
  });
  it("combines overlapping modeled regions rather than double counting area", () => {
    const r = ethanol();
    r.shifts[1].shiftPpm = r.shifts[0].shiftPpm + 0.005;
    const m = importMolecule("CCO"),
      s = predictedSpectrum(
        r,
        { ...defaultPredictionSetup(), splitting: "none", molecule: m },
        m,
      );
    expect(s.integrals).toHaveLength(2);
    expect(s.integrals.map((i) => i.predicted?.nucleusCount).sort()).toEqual([
      1, 5,
    ]);
  });
  it("switches edited limits to measured areas while preserving the normalization target", () => {
    const m = importMolecule("CCO"),
      s = predictedSpectrum(
        ethanol(),
        { ...defaultPredictionSetup(), molecule: m },
        m,
      );
    const updated = s.integrals.map((i, k) =>
      k ? i : { ...i, to: i.to - 0.01, area: i.area * 1.1 },
    );
    const edited = recalibrateIntegrals(s, updated);
    expect(edited.integrals.every((i) => !i.predicted)).toBe(true);
    expect(edited.integralCalibration).toEqual(s.integralCalibration);
    expect(displayedIntegralValue(edited, edited.integrals[0])).toBeCloseTo(
      2,
      10,
    );
  });
  it("renders collective AB transitions while keeping two proton counts and metadata in archives", async () => {
    const m = importMolecule("CCl");
    const sites = [0, 1].map((i) => ({
      id: `H:${i + 2}`,
      explicitAtomIndex: i + 2,
      atomIndex: 0,
      hydrogenOrdinal: i,
      atomLabel: i ? "Hb" : "Ha",
      shiftPpm: 1.1 + i * 0.02,
      equivalenceKey: `H${i}`,
      exchangeable: false,
    }));
    const model = {
      modelId: "fixture",
      weightsSha256: "a".repeat(64),
      sourceSha256: "b".repeat(64),
      upstreamRevision: "fixture",
      citation: "fixture",
      rdkitVersion: "2025.09.1",
      excludedProtonPairs: 0,
    };
    const system: Omit<PredictedSpinSystem, "display"> = {
      model,
      sites,
      couplings: [
        {
          siteIdA: "H:2",
          siteIdB: "H:3",
          jHz: -12,
          predictedJHz: -12,
          modelStdHz: 0.5,
          bondDistance: 2,
          source: "fullsspruce",
        },
      ],
    };
    const r: PredictionResult = {
      ...ethanol(),
      engine: "cascade",
      targetAtomCount: 2,
      shifts: sites.map((site) => ({
        ...ethanol().shifts[0],
        atomIndex: 0,
        explicitAtomIndex: site.explicitAtomIndex,
        shiftPpm: site.shiftPpm,
        hydrogenCount: 1,
        atomLabel: site.atomLabel,
        radius: 0,
      })),
      spinSystem: renderLearnedSpinSystem(system, "spin-system", 400),
    };
    const setup = {
      ...defaultPredictionSetup(),
      engine: "cascade" as const,
      splitting: "spin-system" as const,
      molecule: m,
      spinCouplingOverrides: [{ atomIndexA: 2, atomIndexB: 3, jHz: -12 }],
    };
    const s = predictedSpectrum(r, setup, m);
    expect(s.peaks).toHaveLength(4);
    expect(s.multiplets.map((multiplet) => multiplet.peakCount)).toEqual([
      2, 2,
    ]);
    // Fine linewidth exposed a former first-order-envelope truncation: both
    // outer roofing transitions must lie inside the integration windows.
    const fine = predictedSpectrum(r, { ...setup, lineWidthHz: 0.03 }, m);
    expect(
      fine.peaks.every((peak) =>
        fine.integrals.some(
          (integral) => peak.ppm <= integral.from && peak.ppm >= integral.to,
        ),
      ),
    ).toBe(true);
    expect(
      fine.integrals.reduce(
        (total, integral) => total + displayedIntegralValue(fine, integral),
        0,
      ),
    ).toBeCloseTo(2, 10);
    expect(
      fine.integrals.every((i) => Number.isInteger(i.predicted!.nucleusCount)),
    ).toBe(true);
    expect(
      fine.integrals.reduce((total, integral) => total + integral.area, 0),
    ).toBeGreaterThan(1.9);
    expect(s.peaks[1].height).toBeGreaterThan(s.peaks[0].height * 5);
    expect(s.integrals).toHaveLength(1);
    expect(displayedIntegralValue(s, s.integrals[0])).toBe(2);
    expect(s.molecule!.assignments.map((a) => a.label)).toEqual([
      "C1 Ha",
      "C1 Hb",
    ]);
    expect(validPredictionResult(s.prediction)).toBe(true);
    expect(validPredictionSetup(setup)).toBe(true);
    const project = {
      ...createBlankProject("Spin fixture"),
      prediction: setup,
      spectra: [s],
      activeId: s.id,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra[0].prediction).toEqual(s.prediction);
    expect(reopened.prediction).toEqual(setup);
    expect(
      displayedIntegralValue(
        reopened.spectra[0],
        reopened.spectra[0].integrals[0],
      ),
    ).toBe(2);
    const invalid = structuredClone(s.prediction)!;
    invalid.spinSystem!.couplings[0].siteIdA = "missing";
    expect(validPredictionResult(invalid)).toBe(false);
  });
  it("mixes isomer spectra at equal population without doubling integrals or averaging peak positions", async () => {
    const m = importMolecule("CCO");
    const a = {
      ...ethanol(),
      engine: "cascade" as const,
      shifts: ethanol().shifts.map((s) => ({ ...s, radius: 0 })),
    };
    const b = structuredClone(a);
    b.shifts[1].shiftPpm += 0.3;
    const r: PredictionResult = {
      ...a,
      stereoMixture: {
        undefinedAtomIndices: [1],
        sampled: false,
        components: [
          { weight: 0.5, result: a },
          { weight: 0.5, result: b },
        ],
      },
    };
    const setup = {
      ...defaultPredictionSetup(),
      engine: "cascade" as const,
      splitting: "none" as const,
      molecule: m,
    };
    const s = predictedSpectrum(r, setup, m);
    const values = s.integrals.map((i) => displayedIntegralValue(s, i));
    expect(values.sort()).toEqual([1, 1, 1, 3]);
    expect(values.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.peaks.some((p) => Math.abs(p.ppm - 3.6) < 1e-6)).toBe(true);
    expect(s.peaks.some((p) => Math.abs(p.ppm - 3.9) < 1e-6)).toBe(true);
    expect(s.peaks.some((p) => Math.abs(p.ppm - 3.75) < 1e-6)).toBe(false);
    expect(validPredictionResult(s.prediction)).toBe(true);
    const project = {
      ...createBlankProject("Mixture"),
      spectra: [s],
      activeId: s.id,
      prediction: setup,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra[0].prediction?.stereoMixture).toEqual(
      s.prediction?.stereoMixture,
    );
    expect(
      reopened.spectra[0].integrals.reduce(
        (n, i) => n + displayedIntegralValue(reopened.spectra[0], i),
        0,
      ),
    ).toBe(6);
  });
  it("keeps the representative stereochemistry choice, comments and whole proton counts in saved projects", async () => {
    const m = importMolecule("CCO");
    const r: PredictionResult = {
      ...ethanol(),
      engine: "cascade",
      shifts: ethanol().shifts.map((s) => ({ ...s, radius: 0 })),
      stereoSelection: {
        undefinedAtomIndices: [1],
        molfile: "selected fixture molfile",
      },
    };
    const setup = {
      ...defaultPredictionSetup(),
      engine: "cascade" as const,
      molecule: m,
      splitting: "none" as const,
    };
    const s = predictedSpectrum(r, setup, m);
    expect(s.metadata.comments).toContain(
      "Only one representative stereoisomer is shown (one enantiomer",
    );
    expect(s.prediction?.stereoMixture).toBeUndefined();
    expect(s.integrals.map((i) => displayedIntegralValue(s, i)).sort()).toEqual(
      [1, 2, 3],
    );
    const project = {
      ...createBlankProject("Representative"),
      spectra: [s],
      activeId: s.id,
      prediction: setup,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra[0].prediction?.stereoSelection).toEqual(
      r.stereoSelection,
    );
    expect(reopened.spectra[0].metadata.comments).toEqual(s.metadata.comments);
    const bad = structuredClone(s.prediction)!;
    bad.stereoSelection!.undefinedAtomIndices = [-1];
    expect(validPredictionResult(bad)).toBe(false);
  });
});
