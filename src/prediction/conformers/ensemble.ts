import type { ConformerEnsemble } from "./types";
export const RT_KCAL = 0.001987 * 298.15;
/** Stable normalized Boltzmann probabilities at the reference temperature. */
export function boltzmannWeights(energies: readonly number[]): number[] {
  if (!energies.length || energies.some((energy) => !Number.isFinite(energy))) {
    throw new Error("Conformer energies must be nonempty and finite.");
  }
  const minimum = Math.min(...energies);
  const factors = energies.map((energy) =>
    Math.exp(-(energy - minimum) / RT_KCAL),
  );
  const total = factors.reduce((sum, value) => sum + value, 0);
  return factors.map((factor) => factor / total);
}
export function parseEnsemble(json: string): ConformerEnsemble {
  const parsed = JSON.parse(json);
  if (typeof parsed?.error === "string") throw new Error(parsed.error);
  const ensemble = parsed as ConformerEnsemble;
  const count = ensemble.atomicNumbers?.length;
  if (
    !count ||
    ensemble.method !== "ETKDGv3/MMFF94" ||
    !Number.isInteger(ensemble.originalAtomCount) ||
    ensemble.originalAtomCount > count ||
    ensemble.atomIsotopes?.length !== count ||
    ensemble.hydrogenSiteKeys?.length !== count ||
    !Array.isArray(ensemble.hydrogenPairEquivalence) ||
    ensemble.originalAtomIndices?.length !== count ||
    ensemble.hydrogenParents?.length !== count ||
    !ensemble.conformers?.length ||
    ensemble.conformers.length > 10
  ) {
    throw new Error("Invalid RDKit conformer ensemble.");
  }
  for (const conformer of ensemble.conformers) {
    if (
      conformer.coordinates.length !== count ||
      conformer.coordinates.some(
        (xyz) =>
          xyz.length !== 3 ||
          xyz.some((coordinate) => !Number.isFinite(coordinate)),
      )
    ) {
      throw new Error("Invalid RDKit conformer coordinates.");
    }
  }
  const weights = boltzmannWeights(
    ensemble.conformers.map((conformer) => conformer.energyKcal),
  );
  ensemble.conformers.forEach((conformer, index) => {
    conformer.weight = weights[index];
  });
  return ensemble;
}
