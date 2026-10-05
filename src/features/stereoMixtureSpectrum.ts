import { uid, type Spectrum } from "../model";
import { integrate } from "../core/numerics";
import type { MoleculeDocument } from "./molecule";
import type { PredictionSetup } from "./predictionSetup";
import type { PredictionResult } from "../prediction/types";
import { predictedSpectrum } from "./predictedSpectrum";
import { renderPredictionLines } from "./predictionLines";

/** Add weighted spectra, not averaged chemical shifts or coupling constants. */
export function stereoMixtureSpectrum(
  result: PredictionResult,
  setup: PredictionSetup,
  molecule: MoleculeDocument,
  colorIndex: number,
): Spectrum {
  const mixture = result.stereoMixture!;
  const components = mixture.components.map((c) => ({
    ...c,
    spectrum: predictedSpectrum(c.result, setup, molecule, colorIndex),
  }));
  const base = components[0].spectrum;
  const weights = new Map<number, number>();
  for (const { weight, spectrum } of components) {
    const gamma =
      spectrum.prediction!.splitting!.renderedLineWidthHz /
      setup.frequencyMHz /
      2;
    for (const peak of spectrum.peaks) {
      const key = Math.round(peak.ppm * 1e8) / 1e8;
      weights.set(
        key,
        (weights.get(key) ?? 0) + peak.height * Math.PI * gamma * weight,
      );
    }
  }
  const lines = [...weights].map(([ppm, weight]) => ({ ppm, weight }));
  const low = Math.min(...components.map((c) => c.spectrum.data.x.at(-1)!));
  const high = Math.max(...components.map((c) => c.spectrum.data.x[0]));
  const { data, renderedLineWidthHz } = renderPredictionLines(
    lines,
    low,
    high,
    setup.frequencyMHz,
    setup.lineWidthHz,
  );
  const gamma = renderedLineWidthHz / setup.frequencyMHz / 2;
  const regions = components
    .flatMap(({ weight, spectrum }) =>
      spectrum.integrals.map((i) => ({
        from: i.from,
        to: i.to,
        count: i.predicted!.nucleusCount * weight,
        atomIds: [...i.predicted!.atomIds],
      })),
    )
    .sort((a, b) => b.from - a.from);
  const merged: typeof regions = [];
  for (const r of regions) {
    const last = merged.at(-1);
    if (last && r.from >= last.to) {
      last.to = Math.min(last.to, r.to);
      last.count += r.count;
      last.atomIds = [...new Set([...last.atomIds, ...r.atomIds])];
    } else merged.push(r);
  }
  const label = (ids: string[]) =>
    ids
      .map((id) => molecule.atoms.find((a) => a.id === id))
      .filter((a) => !!a)
      .map((a) => `${a.element}${a.index}`)
      .join(", ");
  const integrals = merged.map((r, i) => ({
    id: uid(),
    from: r.from,
    to: r.to,
    area: integrate(data, 0, r.from, r.to),
    label: `I${i + 1} · ${label(r.atomIds)}`,
    predicted: { nucleusCount: r.count, atomIds: r.atomIds },
  }));
  const anchor = integrals.find((i) => i.area > 0);
  const assignments = new Map<
    string,
    NonNullable<Spectrum["molecule"]>["assignments"][number]
  >();
  const multiplets = new Map<string, Spectrum["multiplets"][number]>();
  for (const { spectrum } of components) {
    for (const a of spectrum.molecule!.assignments) {
      const key = `${[...a.atomIds].sort().join(":")}:${a.ppm.toFixed(5)}`;
      if (!assignments.has(key))
        assignments.set(key, { ...a, peakId: undefined });
    }
    for (const m of spectrum.multiplets) {
      const key = `${m.label}:${m.center.toFixed(5)}:${m.from.toFixed(5)}:${m.to.toFixed(5)}`;
      if (!multiplets.has(key)) multiplets.set(key, m);
    }
  }
  return {
    ...base,
    data,
    original: data,
    prediction: {
      ...structuredClone(result),
      splitting: { ...base.prediction!.splitting!, renderedLineWidthHz },
    },
    peaks: lines.map((l) => ({
      id: uid(),
      ppm: l.ppm,
      height: l.weight / (Math.PI * gamma),
    })),
    integrals,
    integralScale: anchor ? anchor.predicted.nucleusCount / anchor.area : 1,
    integralCalibration: anchor
      ? { anchorId: anchor.id, target: anchor.predicted.nucleusCount }
      : undefined,
    multiplets: [...multiplets.values()],
    molecule: { ...base.molecule!, assignments: [...assignments.values()] },
    metadata: {
      ...base.metadata,
      comments: `CASCADE · 50/50 at each of ${mixture.undefinedAtomIndices.length} undefined stereocenter${mixture.undefinedAtomIndices.length === 1 ? "" : "s"} · ${components.length} ${mixture.sampled ? "balanced sampled" : "equal-weight"} configurations\n${base.metadata.comments}`,
      predictionWarnings: result.warnings.join("\n"),
    },
    history: [
      ...base.history,
      "Equal-population stereoisomer spectra combined; proton counts preserved",
    ],
  };
}
