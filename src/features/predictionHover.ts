import type { Spectrum } from "../model";
import { firstOrderLines } from "./predictionSplitting";
import { savedPredictionResult } from "./predictionResult";

export interface PredictedHoverLine {
  ppm: number;
  atomIds: string[];
}

/** Reuse the saved calculation, including individual split lines. Exact spin
 * transitions belong to the whole coupled system, rather than one atom. */
export function predictedHoverLines(spectrum: Spectrum): PredictedHoverLine[] {
  const result = savedPredictionResult(spectrum);
  const molecule = spectrum.molecule?.document;
  if (!result || !molecule || result.twoD) return [];
  const lines: PredictedHoverLine[] = [];
  const learned = result.spinSystem;
  if (learned) {
    const sites = new Map(learned.sites.map((s) => [s.id, s]));
    for (const cluster of learned.display.clusters) {
      const atomIds = [
        ...new Set(
          cluster.siteIds.flatMap((id) => {
            const site = sites.get(id);
            const atom = site && molecule.atoms[site.atomIndex];
            return atom ? [atom.id] : [];
          }),
        ),
      ];
      for (const line of cluster.lines)
        lines.push({ ppm: line.ppm + spectrum.referenceOffset, atomIds });
    }
  } else {
    for (const shift of result.shifts) {
      const atom = molecule.atoms[shift.atomIndex];
      if (!atom) continue;
      const partners =
        result.splitting?.mode === "none"
          ? []
          : (result.splitting?.couplings ?? []).flatMap((c) =>
              c.atomIndexA === shift.atomIndex
                ? [{ count: c.hydrogensB, jHz: c.jHz }]
                : c.atomIndexB === shift.atomIndex
                  ? [{ count: c.hydrogensA, jHz: c.jHz }]
                  : [],
            );
      for (const line of firstOrderLines(partners).lines)
        lines.push({
          ppm:
            shift.shiftPpm +
            line.offsetHz / spectrum.frequencyMHz +
            spectrum.referenceOffset,
          atomIds: [atom.id],
        });
    }
  }
  const merged = new Map<number, Set<string>>();
  for (const line of lines) {
    const key = Math.round(line.ppm * 1e8) / 1e8;
    const ids = merged.get(key) ?? new Set<string>();
    line.atomIds.forEach((id) => ids.add(id));
    merged.set(key, ids);
  }
  return [...merged]
    .map(([ppm, ids]) => ({ ppm, atomIds: [...ids] }))
    .sort((a, b) => a.ppm - b.ppm);
}

/** Sorted lookup keeps hover independent of matrix size or transition count. */
export function nearestPredictedHoverLine(
  lines: PredictedHoverLine[],
  ppm: number,
  tolerancePpm: number,
): PredictedHoverLine | undefined {
  if (!lines.length || !Number.isFinite(ppm) || tolerancePpm < 0) return;
  let low = 0,
    high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].ppm < ppm) low = mid + 1;
    else high = mid;
  }
  const before = lines[low - 1],
    after = lines[low];
  const nearest = !before
    ? after
    : !after
      ? before
      : Math.abs(before.ppm - ppm) <= Math.abs(after.ppm - ppm)
        ? before
        : after;
  return nearest && Math.abs(nearest.ppm - ppm) <= tolerancePpm
    ? nearest
    : undefined;
}

export function nearbyPredictedHoverLines(
  lines: PredictedHoverLine[],
  ppm: number,
  tolerancePpm: number,
): PredictedHoverLine[] {
  if (!Number.isFinite(ppm) || tolerancePpm < 0) return [];
  let low = 0,
    high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].ppm < ppm - tolerancePpm) low = mid + 1;
    else high = mid;
  }
  const nearby: PredictedHoverLine[] = [];
  for (let i = low; i < lines.length && lines[i].ppm <= ppm + tolerancePpm; i++)
    nearby.push(lines[i]);
  return nearby;
}
