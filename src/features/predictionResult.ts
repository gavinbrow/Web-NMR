import type { Spectrum } from "../model";
import type { PredictionResult } from "../prediction/types";

export function savedPredictionResult(
  spectrum?: Spectrum,
): PredictionResult | null {
  if (spectrum?.prediction) return spectrum.prediction;
  if (
    spectrum?.metadata.predictionEngine !== "cdk-hose-nmrshiftdb" ||
    typeof spectrum.metadata.predictionShifts !== "string"
  )
    return null;
  try {
    const shifts = JSON.parse(
      spectrum.metadata.predictionShifts,
    ) as PredictionResult["shifts"];
    if (
      !Array.isArray(shifts) ||
      shifts.length > 1000 ||
      !shifts.every(
        (s) =>
          s && Number.isInteger(s.atomIndex) && Number.isFinite(s.shiftPpm),
      )
    )
      return null;
    return {
      shifts,
      warnings: String(spectrum.metadata.predictionWarnings ?? "")
        .split("\n")
        .filter(Boolean),
      engine: "cdk-hose-nmrshiftdb",
      dataset: String(spectrum.metadata.predictionDataset),
      nucleus: spectrum.nucleus as "1H" | "13C",
      targetAtomCount: Number(
        spectrum.metadata.predictionTargetAtoms ?? shifts.length,
      ),
      missingAtomCount: Number(spectrum.metadata.predictionMissingAtoms ?? 0),
    };
  } catch {
    return null;
  }
}
