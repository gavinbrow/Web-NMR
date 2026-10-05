import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { importMolecule } from "./molecule";
import {
  defaultPredictionSetup,
  validPredictionResult,
  validPredictionSetup,
} from "./predictionSetup";
import { assembleTwoDCorrelations } from "../prediction/twoDClient";
import {
  predictedTwoDSpectrum,
  renderTwoDCorrelationMap,
} from "./predictedTwoDSpectrum";
import { createBlankProject } from "./workspaceDocuments";
import { decodeProject, encodeProject, validateProject } from "./project";
import { buildSpectrumWorkbook } from "./spectrumReport";
import type { PredictionResult } from "../prediction/types";

function fixture(experiment: "HSQC" | "COSY" = "HSQC") {
  const molecule = importMolecule("CCO");
  const proton: PredictionResult = {
    engine: "cdk-hose-nmrshiftdb",
    nucleus: "1H",
    dataset: "test",
    warnings: [],
    targetAtomCount: 6,
    missingAtomCount: 0,
    shifts: [
      { atomIndex: 0, shiftPpm: 1.2, hydrogenCount: 3 },
      { atomIndex: 1, shiftPpm: 3.6, hydrogenCount: 2 },
      { atomIndex: 2, shiftPpm: 2.0, hydrogenCount: 1 },
    ].map((s) => ({
      ...s,
      element: "H",
      radius: 4,
      sampleCount: 30,
      minPpm: s.shiftPpm - 0.1,
      maxPpm: s.shiftPpm + 0.1,
      hoseCode: "test",
    })),
  };
  const carbon: PredictionResult = {
    ...proton,
    nucleus: "13C",
    targetAtomCount: 2,
    shifts: [17, 58].map((shiftPpm, atomIndex) => ({
      ...proton.shifts[atomIndex],
      shiftPpm,
      element: "C",
      hydrogenCount: 1,
      minPpm: shiftPpm,
      maxPpm: shiftPpm,
    })),
  };
  const setup = {
    ...defaultPredictionSetup(),
    molecule,
    experiment,
    hsqcEdited: true,
    cosyMinJHz: 0.8,
  };
  const result = assembleTwoDCorrelations(
    { ...setup, nucleus: "1H", experiment },
    proton,
    molecule,
    experiment === "HSQC" ? carbon : undefined,
  );
  const spectrum = predictedTwoDSpectrum(result, setup, molecule)[0];
  // Archive tests use a small matrix; the same helper renders the production grid.
  spectrum.twoD = renderTwoDCorrelationMap(result.twoD!, { size: 64 }).twoD;
  spectrum.twoDOriginal = structuredClone(spectrum.twoD);
  const project = {
    ...createBlankProject("2D prediction"),
    prediction: setup,
    spectra: [spectrum],
    activeId: spectrum.id,
  };
  return { setup, result, spectrum, project };
}

describe("2D prediction persistence and reports", () => {
  it("pairs stereoisomer H/C predictions rather than making cross-isomer HSQC peaks", async () => {
    const { setup, result } = fixture();
    const make = (r: PredictionResult, offset: number): PredictionResult => {
      const copy = { ...structuredClone(r), engine: "cascade" as const };
      delete copy.twoD;
      copy.shifts.forEach((s) => {
        s.shiftPpm += offset;
        s.radius = 0;
      });
      return copy;
    };
    const h1 = make(result, 0),
      h2 = make(result, 0.3),
      c1 = make(result.twoD!.carbonResult!, 0),
      c2 = make(result.twoD!.carbonResult!, 5);
    const mix = (
      a: PredictionResult,
      b: PredictionResult,
    ): PredictionResult => ({
      ...a,
      stereoMixture: {
        undefinedAtomIndices: [1],
        sampled: false,
        components: [
          { weight: 0.5, result: a },
          { weight: 0.5, result: b },
        ],
      },
    });
    const assembled = assembleTwoDCorrelations(
      { ...setup, nucleus: "1H", experiment: "HSQC" },
      mix(h1, h2),
      setup.molecule!,
      mix(c1, c2),
    );
    expect(assembled.twoD!.correlations.map((c) => [c.xPpm, c.yPpm])).toEqual([
      [1.2, 17],
      [3.6, 58],
      [1.5, 22],
      [3.9, 63],
    ]);
    expect(assembled.twoD!.correlations.map((c) => c.weight)).toEqual([
      1.5, 1, 1.5, 1,
    ]);
    expect(validPredictionResult(assembled)).toBe(true);
    const spectrum = predictedTwoDSpectrum(
      assembled,
      { ...setup, engine: "cascade" },
      setup.molecule!,
    )[0];
    spectrum.twoD = renderTwoDCorrelationMap(assembled.twoD!, {
      size: 64,
    }).twoD;
    spectrum.twoDOriginal = structuredClone(spectrum.twoD);
    const project = {
      ...createBlankProject("Mixture HSQC"),
      spectra: [spectrum],
      activeId: spectrum.id,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra[0].prediction?.stereoMixture?.components).toEqual(
      spectrum.prediction?.stereoMixture?.components,
    );
    expect(reopened.spectra[0].prediction?.twoD?.correlations).toEqual(
      assembled.twoD!.correlations,
    );
  });
  it("saves HSQC settings, carbon model, editing signs, embedded traces and atom pairs as one dataset", async () => {
    const { project, spectrum, setup } = fixture();
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra).toHaveLength(1);
    expect(reopened.prediction).toEqual(setup);
    expect(reopened.spectra[0].prediction).toEqual(spectrum.prediction);
    expect(
      reopened.spectra[0].prediction!.twoD!.correlations.map((c) => c.sign),
    ).toEqual([1, -1]);
    expect(reopened.spectra[0].twoD!.real).toEqual(spectrum.twoD!.real);
    expect(reopened.spectra[0].predictedTraces).toEqual(
      spectrum.predictedTraces,
    );
    expect(reopened.spectra[0].molecule!.assignments).toEqual(
      spectrum.molecule!.assignments,
    );
    expect(
      reopened.spectra[0].molecule!.assignments.every((a) =>
        Number.isFinite(a.ppmF1),
      ),
    ).toBe(true);
  });
  it("retains COSY symmetric pairs and cutoff without adding trace datasets", async () => {
    const { project, result, spectrum } = fixture("COSY");
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.spectra).toHaveLength(1);
    expect(reopened.spectra[0].prediction!.twoD).toEqual(
      spectrum.prediction!.twoD,
    );
    const pairs = result.twoD!.correlations.filter((c) => c.kind === "cross");
    expect(pairs).toHaveLength(2);
    expect(pairs[0].xPpm).toBe(pairs[1].yPpm);
    expect(pairs[0].yPpm).toBe(pairs[1].xPpm);
  });
  it("rejects malformed models, duplicate correlation identities and mismatched atom mappings", () => {
    const { result, project } = fixture();
    expect(validPredictionResult(result)).toBe(true);
    const invalid = structuredClone(result);
    invalid.twoD!.correlations.push(invalid.twoD!.correlations[0]);
    expect(validPredictionResult(invalid)).toBe(false);
    invalid.twoD!.correlations.pop();
    invalid.twoD!.carbonResult!.twoD = result.twoD;
    expect(validPredictionResult(invalid)).toBe(false);
    project.spectra[0].prediction!.twoD!.correlations[0].atomIdX = "wrong";
    expect(() => validateProject(project)).toThrow(/atom mapping/);
  });
  it("rejects broken embedded trace arrays and inconsistent experiment setup while retaining old 1D projects", () => {
    const { setup, project } = fixture();
    expect(validPredictionSetup(setup)).toBe(true);
    expect(validPredictionSetup({ ...setup, nucleus: "13C" })).toBe(false);
    expect(validPredictionSetup({ ...setup, cosyMinJHz: -1 })).toBe(false);
    expect(validPredictionSetup(defaultPredictionSetup())).toBe(true);
    project.spectra[0].predictedTraces!.left.real[0] = NaN;
    expect(() => validateProject(project)).toThrow(/nonfinite/);
  });
  it("exports calibrated 2D correlation coordinates and atom labels in Excel alongside the matrix", () => {
    const { spectrum } = fixture();
    spectrum.referenceOffset = 0.5;
    spectrum.twoD!.referenceOffsetF1 = -1;
    const zip = unzipSync(
      buildSpectrumWorkbook(spectrum, {
        includeFigure: false,
        includeProcessing: false,
        includeImaginary: false,
      }),
    );
    const analysis = strFromU8(zip["xl/worksheets/sheet2.xml"]);
    expect(analysis).toContain("Correlation ID");
    expect(analysis).toContain("C1");
    expect(analysis).toContain("illustrative");
    expect(analysis).toContain("<v>1.7</v>");
    expect(analysis).toContain("<v>16</v>");
    expect(analysis).toContain("<v>-1</v>");
  });
});
