import { describe, it, expect } from "vitest";
import { importMolecule, removeMoleculeAtoms } from "./molecule";
import {
  defaultPredictionSetup,
  attachMolecule,
  assignAtoms,
  validSpectrumMolecule,
} from "./predictionSetup";
import { predictedSpectrum } from "./predictedSpectrum";
import { shiftSpectrum } from "./stacks";
import { encodeProject, decodeProject, validateProject } from "./project";
import { createBlankProject } from "./workspaceDocuments";
import { integrate } from "../core/numerics";
import type { PredictionResult } from "../prediction/types";

const lookup: PredictionResult = {
  nucleus: "1H",
  targetAtomCount: 6,
  missingAtomCount: 0,
  engine: "cdk-hose-nmrshiftdb",
  dataset: "test-fixture",
  warnings: [],
  shifts: [
    {
      atomIndex: 0,
      element: "H",
      shiftPpm: 1.2,
      hydrogenCount: 3,
      sampleCount: 100,
      minPpm: 1,
      maxPpm: 1.4,
      radius: 4,
      hoseCode: "test",
    },
    {
      atomIndex: 1,
      element: "H",
      shiftPpm: 3.6,
      hydrogenCount: 2,
      sampleCount: 90,
      minPpm: 3.3,
      maxPpm: 3.9,
      radius: 5,
      hoseCode: "test",
    },
    {
      atomIndex: 2,
      element: "H",
      shiftPpm: -0.2,
      hydrogenCount: 1,
      sampleCount: 5,
      minPpm: -0.4,
      maxPpm: 0,
      radius: 2,
      hoseCode: "test",
    },
  ],
};
describe("prediction spectrum and atom assignments", () => {
  it("keeps negative shifts, field-dependent linewidth and proton area ratios", () => {
    const molecule = importMolecule("CCO"),
      setup = {
        ...defaultPredictionSetup(),
        molecule,
        splitting: "none" as const,
      };
    const spectrum = predictedSpectrum(lookup, setup, molecule);
    expect(spectrum.peaks.map((p) => p.ppm)).toEqual([1.2, 3.6, -0.2]);
    expect(integrate(spectrum.data, 0, 1.1, 1.3)).toBeCloseTo(3, 1);
    expect(integrate(spectrum.data, 0, 3.5, 3.7)).toBeCloseTo(2, 1);
    expect(spectrum.molecule!.assignments[0].atomIds).toEqual([
      molecule.atoms[0].id,
    ]);
    const twiceField = predictedSpectrum(
      lookup,
      { ...setup, frequencyMHz: 800 },
      molecule,
    );
    expect(twiceField.peaks[0].height / spectrum.peaks[0].height).toBeCloseTo(
      2,
      8,
    );
    expect(spectrum.data.x[0]).toBeGreaterThan(spectrum.data.x.at(-1)!);
  });
  it("preserves complete drawing, prediction settings and assignment identities in project archives", async () => {
    const molecule = importMolecule("CCO"),
      setup = {
        ...defaultPredictionSetup(),
        molecule,
        title: "My experiment",
        nucleus: "13C" as const,
        frequencyMHz: 100.6,
      };
    const spectrum = predictedSpectrum(
      lookup,
      { ...setup, nucleus: "1H" },
      molecule,
    );
    const project = {
      ...createBlankProject("Prediction project"),
      prediction: setup,
      spectra: [spectrum],
      activeId: spectrum.id,
    };
    const reopened = await decodeProject(await encodeProject(project));
    expect(reopened.prediction).toEqual(setup);
    expect(reopened.spectra[0].molecule).toEqual(spectrum.molecule);
    expect(reopened.spectra[0].prediction).toEqual(spectrum.prediction);
    expect(reopened.spectra[0].data.real).toEqual(spectrum.data.real);
    const malformed = structuredClone(project);
    malformed.spectra[0].molecule!.assignments[0].atomIds = ["missing"];
    expect(() => validateProject(malformed)).toThrow(/molecule|assignment/i);
  });
  it("keeps assignments through referencing and removes only deleted atom links on editing", () => {
    const molecule = importMolecule("CCO"),
      spectrum = predictedSpectrum(
        lookup,
        { ...defaultPredictionSetup(), molecule },
        molecule,
      );
    const assigned = assignAtoms(spectrum, {
      id: "manual",
      atomIds: [molecule.atoms[0].id, molecule.atoms[1].id],
      ppm: 4.2,
    });
    const shifted = shiftSpectrum(assigned, 0.25);
    expect(shifted.molecule!.assignments.at(-1)!.ppm).toBe(4.45);
    const edited = removeMoleculeAtoms(molecule, [molecule.atoms[0].id]);
    const attached = attachMolecule(shifted, edited);
    expect(attached.molecule!.assignments.at(-1)!.atomIds).toEqual([
      molecule.atoms[1].id,
    ]);
    expect(validSpectrumMolecule(attached.molecule)).toBe(true);
    expect(attached.molecule!.document.atoms[0].index).toBe(2);
  });
  it("rejects an empty result and inconsistent atom maps instead of adding fabricated signals", () => {
    const molecule = importMolecule("CCO"),
      setup = { ...defaultPredictionSetup(), molecule };
    expect(() =>
      predictedSpectrum({ ...lookup, shifts: [] }, setup, molecule),
    ).toThrow(/No matching/);
    expect(() =>
      predictedSpectrum(
        { ...lookup, shifts: [{ ...lookup.shifts[0], atomIndex: 99 }] },
        setup,
        molecule,
      ),
    ).toThrow(/mapping/);
  });
});
