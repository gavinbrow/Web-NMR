/** Copyright (C) 2010-2015 Stefan Kuhn and NMRShiftDB project contributors.
 * Local nmrshiftdb standalone-predictor lookup. AGPL-3.0-or-later adaptation;
 * see public/prediction/licenses and scripts/prediction/README.md.
 */
import { generateHoseCode, hoseLookupKeys } from "./hose";
import { moleculeGraph } from "./molecule";
import type {
  PredictionInput,
  PredictionOptions,
  PredictionResult,
  PredictionNucleus,
  PredictedAtomShift,
} from "./types";
export type LookupValues = [number, number, number, number];
export type LookupTable = Record<string, LookupValues>;
export type LookupLoader = (
  nucleus: PredictionNucleus,
  code: string,
  signal?: AbortSignal,
) => Promise<LookupValues | undefined>;
export const DATASET_VERSION = "nmrshiftdb-2023-09-30-cdk-2.9-v1";
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Prediction canceled.", "AbortError");
}
export async function runPrediction(
  input: PredictionInput,
  lookup: LookupLoader,
  options: PredictionOptions = {},
): Promise<PredictionResult> {
  checkAbort(options.signal);
  if (input.nucleus !== "1H" && input.nucleus !== "13C")
    throw new Error("Select proton (1H) or carbon (13C) prediction.");
  options.onProgress?.({
    stage: "structure",
    completed: 0,
    total: 1,
    message: "Reading the molecule locally…",
  });
  const graph = moleculeGraph(input);
  const target = input.nucleus === "1H" ? 1 : 6;
  const targets = graph.atoms.flatMap((a, i) =>
    a.atomicNumber === target ? [i] : [],
  );
  const environments: { atom: number; hose: string }[] = [];
  for (const [index, atom] of targets.entries()) {
    checkAbort(options.signal);
    environments.push({ atom, hose: generateHoseCode(graph, atom) });
    options.onProgress?.({
      stage: "environments",
      completed: index + 1,
      total: targets.length,
      message: `Calculating local atom environments (${index + 1}/${targets.length})…`,
    });
    if (index % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const shifts: PredictedAtomShift[] = [];
  const warnings: string[] = [
    "Shifts use solvent-unspecified reference environments and a two-dimensional structure; stereochemical and conformational effects may be unresolved.",
  ];
  if (input.nucleus === "1H")
    warnings.push(
      "Proton shifts use the two-dimensional HOSE environment. Diastereotopic protons, solvent effects and exchangeable proton shifts may be unresolved. Optional splitting uses separate editable J estimates, not reference-database coupling predictions.",
    );
  let missing = 0;
  let completed = 0;
  await Promise.all(
    environments.map(async ({ atom, hose }) => {
      const original = graph.atoms[atom];
      const atomIndex = original.parentIndex ?? original.atomIndex!;
      let matched = false;
      for (const key of hoseLookupKeys(hose)) {
        checkAbort(options.signal);
        const values = await lookup(input.nucleus, key.code, options.signal);
        if (!values) continue;
        // Missing results are represented by absence, never by a negative-shift cutoff.
        const [minPpm, shiftPpm, maxPpm, sampleCount] = values;
        if (![minPpm, shiftPpm, maxPpm, sampleCount].every(Number.isFinite))
          throw new Error("The local prediction reference data is invalid.");
        matched = true;
        shifts.push({
          atomIndex,
          element: input.nucleus === "1H" ? "H" : "C",
          shiftPpm,
          hydrogenCount: 1,
          sampleCount,
          minPpm,
          maxPpm,
          radius: key.radius,
          hoseCode: hose,
        });
        break;
      }
      if (!matched) missing++;
      completed++;
      options.onProgress?.({
        stage: "lookup",
        completed,
        total: targets.length,
        message: `Looking up bundled reference environments (${completed}/${targets.length})…`,
      });
    }),
  );
  checkAbort(options.signal);
  // Implicit equivalent H atoms share a parent and HOSE code. Keep different codes distinct.
  const grouped = new Map<string, PredictedAtomShift>();
  for (const shift of shifts) {
    const key = `${shift.atomIndex}|${shift.hoseCode}`;
    const prior = grouped.get(key);
    if (prior) prior.hydrogenCount++;
    else grouped.set(key, { ...shift });
  }
  if (missing)
    warnings.push(
      `${missing} ${input.nucleus === "1H" ? "proton" : "carbon"} atom${missing === 1 ? "" : "s"} had no matching reference environment and were omitted.`,
    );
  if ([...grouped.values()].some((s) => s.radius <= 2))
    warnings.push(
      "Some shifts use only one or two matching environment spheres and have limited structural specificity.",
    );
  return {
    shifts: [...grouped.values()].sort(
      (a, b) => a.atomIndex - b.atomIndex || a.shiftPpm - b.shiftPpm,
    ),
    warnings,
    engine: "cdk-hose-nmrshiftdb",
    dataset: DATASET_VERSION,
    nucleus: input.nucleus,
    targetAtomCount: targets.length,
    missingAtomCount: missing,
  };
}
