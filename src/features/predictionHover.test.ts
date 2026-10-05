import { describe, expect, it } from "vitest";
import { importMolecule } from "./molecule";
import { defaultPredictionSetup } from "./predictionSetup";
import { predictedSpectrum } from "./predictedSpectrum";
import {
  nearestPredictedHoverLine,
  predictedHoverLines,
  nearbyPredictedHoverLines,
} from "./predictionHover";
import type {
  PredictionResult,
  PredictedSpinSystem,
} from "../prediction/types";

function fixture(nucleus: "1H" | "13C" = "1H") {
  const molecule = importMolecule("CCO");
  const result: PredictionResult = {
    engine: "cdk-hose-nmrshiftdb",
    dataset: "test",
    nucleus,
    targetAtomCount: 3,
    missingAtomCount: 0,
    warnings: [],
    shifts: [1.2, 3.6, 2.0].map((shiftPpm, atomIndex) => ({
      shiftPpm,
      atomIndex,
      hydrogenCount: [3, 2, 1][atomIndex],
      element: nucleus === "13C" ? "C" : "H",
      sampleCount: 30,
      minPpm: shiftPpm,
      maxPpm: shiftPpm,
      radius: 4,
      hoseCode: "test",
    })),
  };
  const spectrum = predictedSpectrum(
    result,
    { ...defaultPredictionSetup(), nucleus },
    molecule,
  );
  return { spectrum, molecule, result };
}

describe("predicted peak hover atom mapping", () => {
  it("maps every line of a triplet and quartet to its source atom", () => {
    const { spectrum, molecule } = fixture();
    const lines = predictedHoverLines(spectrum);
    expect(lines).toHaveLength(8);
    for (const offset of [-7, 0, 7])
      expect(
        nearestPredictedHoverLine(lines, 1.2 + offset / 400, 0.0001)?.atomIds,
      ).toEqual([molecule.atoms[0].id]);
    expect(
      nearestPredictedHoverLine(lines, 3.6 + 10.5 / 400, 0.0001)?.atomIds,
    ).toEqual([molecule.atoms[1].id]);
    expect(nearestPredictedHoverLine(lines, 6, 0.1)).toBeUndefined();
    expect(nearbyPredictedHoverLines(lines, 1.2, 0.03)).toHaveLength(3);
    expect(nearbyPredictedHoverLines(lines, 6, 0.1)).toEqual([]);
  });
  it("honors calibration offsets, edited J values, and unsplit carbon", () => {
    const { spectrum, molecule } = fixture("13C");
    spectrum.referenceOffset = 0.37;
    expect(
      nearestPredictedHoverLine(predictedHoverLines(spectrum), 1.57, 0.001)
        ?.atomIds,
    ).toEqual([molecule.atoms[0].id]);
    const proton = fixture();
    proton.spectrum.prediction!.splitting!.couplings[0].jHz = 10;
    expect(
      nearestPredictedHoverLine(
        predictedHoverLines(proton.spectrum),
        1.225,
        0.0001,
      )?.atomIds,
    ).toEqual([proton.molecule.atoms[0].id]);
  });
  it("highlights every atom contributing to coincident lines", () => {
    const { spectrum, molecule } = fixture("13C");
    spectrum.prediction!.shifts[1].shiftPpm = 1.2;
    expect(
      nearestPredictedHoverLine(predictedHoverLines(spectrum), 1.2, 0.001)
        ?.atomIds,
    ).toEqual([molecule.atoms[0].id, molecule.atoms[1].id]);
  });
  it("uses saved learned proton lines and collective exact spin assignments", () => {
    const { spectrum, molecule } = fixture();
    const sites = molecule.atoms.slice(0, 2).map((_, i) => ({
      id: `H${i}`,
      atomIndex: i,
      explicitAtomIndex: i + 3,
      hydrogenOrdinal: 1,
      atomLabel: "H",
      shiftPpm: i + 1,
      equivalenceKey: `site${i}`,
      exchangeable: false,
    }));
    const spin = {
      sites,
      couplings: [],
      display: {
        mode: "first-order",
        frequencyMHz: 400,
        warnings: [],
        clusters: [
          { siteIds: ["H0"], lines: [{ ppm: 1.18, weight: 1 }] },
          { siteIds: ["H1"], lines: [{ ppm: 3.62, weight: 1 }] },
        ],
      },
    } as unknown as PredictedSpinSystem;
    spectrum.prediction!.spinSystem = spin;
    expect(
      nearestPredictedHoverLine(predictedHoverLines(spectrum), 3.62, 0.001)
        ?.atomIds,
    ).toEqual([molecule.atoms[1].id]);
    spin.display.mode = "spin-system";
    spin.display.clusters = [
      { siteIds: ["H0", "H1"], lines: [{ ppm: 1.15, weight: 1 }] },
    ];
    expect(
      nearestPredictedHoverLine(predictedHoverLines(spectrum), 1.15, 0.001)
        ?.atomIds,
    ).toEqual([molecule.atoms[0].id, molecule.atoms[1].id]);
  });
  it("keeps hover transient and ignores experimental spectra or 2D maps", () => {
    const { spectrum } = fixture();
    const before = structuredClone(spectrum.molecule);
    nearestPredictedHoverLine(predictedHoverLines(spectrum), 1.2, 0.01);
    expect(spectrum.molecule).toEqual(before);
    delete spectrum.prediction;
    delete spectrum.metadata.predictionEngine;
    expect(predictedHoverLines(spectrum)).toEqual([]);
    expect(nearestPredictedHoverLine([], 1.2, 0.1)).toBeUndefined();
  });
});
