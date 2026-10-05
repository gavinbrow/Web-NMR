import { colors, defaultRecipe, uid } from "../model";
import type { Spectrum } from "../model";
import type { PredictionSetup } from "./predictionSetup";
import type { MoleculeDocument } from "./molecule";
import type { PredictionResult } from "../prediction/types";
import { splitPredictionSignals } from "./predictionSplitting";
import { renderPredictionLines } from "./predictionLines";

/** Database shifts and first-order J estimates have separate, persisted provenance. */
export function predictedSpectrum(
  result: PredictionResult,
  setup: PredictionSetup,
  molecule: MoleculeDocument,
  colorIndex = 0,
): Spectrum {
  const shifts = result.shifts.filter((s) => Number.isFinite(s.shiftPpm));
  if (!shifts.length)
    throw new Error(
      "No matching environments were found. Try a different structure; unsupported shifts are not estimated.",
    );
  if (result.nucleus !== setup.nucleus)
    throw new Error(
      "Prediction nucleus does not match the selected experiment.",
    );
  if (shifts.some((s) => !molecule.atoms[s.atomIndex]))
    throw new Error("Prediction atom mapping does not match the molecule.");
  const carbon = setup.nucleus === "13C",
    mode = carbon ? "none" : (setup.splitting ?? "none");
  const split = splitPredictionSignals(
    result,
    molecule,
    mode,
    setup.couplingOverrides,
    setup.frequencyMHz,
  );
  const groups: {
    shift: number;
    weight: number;
    atoms: string[];
    kind: string;
    couplingsHz: number[];
    lines: { offsetHz: number; weight: number }[];
  }[] = [];
  split.patterns.forEach((pattern, i) => {
    const s = shifts[i],
      atom = molecule.atoms[s.atomIndex];
    const weight = carbon ? 1 : Math.max(1, s.hydrogenCount);
    const key = JSON.stringify(pattern.lines);
    const group = groups.find(
      (g) =>
        Math.abs(g.shift - s.shiftPpm) < 1e-5 &&
        JSON.stringify(g.lines) === key,
    );
    if (group) {
      group.weight += weight;
      if (!group.atoms.includes(atom.id)) group.atoms.push(atom.id);
    } else
      groups.push({
        shift: s.shiftPpm,
        weight,
        atoms: [atom.id],
        kind: pattern.kind,
        couplingsHz: pattern.couplingsHz,
        lines: pattern.lines,
      });
  });
  const atomLabel = (ids: string[]) =>
    ids
      .map((id) => {
        const a = molecule.atoms.find((a) => a.id === id)!;
        return `${a.element}${a.index}`;
      })
      .join(", ");
  const lineMap = new Map<
    number,
    { ppm: number; weight: number; atoms: string[] }
  >();
  for (const g of groups)
    for (const l of g.lines) {
      const ppm = g.shift + l.offsetHz / setup.frequencyMHz,
        key = Math.round(ppm * 1e8) / 1e8;
      const prior = lineMap.get(key);
      if (prior) {
        prior.weight += g.weight * l.weight;
        prior.atoms = [...new Set([...prior.atoms, ...g.atoms])];
      } else
        lineMap.set(key, {
          ppm,
          weight: g.weight * l.weight,
          atoms: [...g.atoms],
        });
    }
  const lines = [...lineMap.values()];
  const low = Math.min(carbon ? -20 : -2, ...lines.map((l) => l.ppm - 1));
  const high = Math.max(carbon ? 240 : 14, ...lines.map((l) => l.ppm + 1));
  const { data, renderedLineWidthHz } = renderPredictionLines(
    lines,
    low,
    high,
    setup.frequencyMHz,
    setup.lineWidthHz,
  );
  const gamma = renderedLineWidthHz / setup.frequencyMHz / 2;
  const warnings = [...split.warnings];
  if (renderedLineWidthHz > setup.lineWidthHz * 1.001)
    warnings.push(
      `The requested linewidth is finer than the bounded display grid. Rendered at ${renderedLineWidthHz.toFixed(3)} Hz; coupling spacings and total areas are preserved.`,
    );
  const peaks = lines.map((l) => ({
    id: uid(),
    ppm: l.ppm,
    height: l.weight / (Math.PI * gamma),
    label: atomLabel(l.atoms),
  }));
  const prediction: PredictionResult = {
    ...structuredClone(result),
    splitting: {
      mode,
      couplings: split.couplings.map(
        ({
          atomIndexA,
          atomIndexB,
          hydrogensA,
          hydrogensB,
          jHz,
          source,
          rule,
        }) => ({
          atomIndexA,
          atomIndexB,
          hydrogensA,
          hydrogensB,
          jHz,
          source,
          rule,
        }),
      ),
      signals: split.patterns.map((p) => p.signal),
      warnings,
      renderedLineWidthHz,
    },
  };
  const title =
    setup.title.trim() ||
    `Predicted ${setup.nucleus} · ${molecule.smiles || "drawn molecule"}`;
  return {
    prediction,
    id: uid(),
    label: title.slice(0, 200),
    color: colors[colorIndex % colors.length],
    nucleus: setup.nucleus,
    frequencyMHz: setup.frequencyMHz,
    sourceFormat: "CDK environment prediction",
    metadata: {
      title,
      comments: `Predicted from nmrshiftdb environments · ${renderedLineWidthHz.toFixed(2)} Hz linewidth\n${carbon ? "Proton-decoupled carbon signals." : mode === "first-order" ? "First-order splitting · editable J estimates; not calculated couplings." : "Unsplit lookup signals."}`,
      predictionEngine: result.engine,
      predictionDataset: result.dataset,
      predictionWarnings: [...result.warnings, ...warnings].join("\n"),
      predictionTargetAtoms: result.targetAtomCount,
      predictionMissingAtoms: result.missingAtomCount,
    },
    original: data,
    data,
    recipe: { ...defaultRecipe(), window: "none" },
    referenceOffset: 0,
    peaks,
    integrals: [],
    multiplets:
      mode === "first-order"
        ? groups.map((g) => ({
            id: uid(),
            from:
              g.shift + g.lines[0].offsetHz / setup.frequencyMHz + 4 * gamma,
            to:
              g.shift +
              g.lines.at(-1)!.offsetHz / setup.frequencyMHz -
              4 * gamma,
            center: g.shift,
            kind: g.kind,
            couplingsHz: g.couplingsHz,
            peakCount: g.lines.length,
            label: `${atomLabel(g.atoms)} · ${g.weight}H`,
          }))
        : [],
    integralScale: 1,
    gain: 1,
    visible: true,
    history: [
      "Predicted locally with CDK HOSE / nmrshiftdb environments",
      ...(mode === "first-order"
        ? ["First-order display from editable typical J estimates"]
        : []),
    ],
    revision: 0,
    molecule: {
      document: structuredClone(molecule),
      visible: true,
      position: { x: 0.62, y: 0.07, width: 270, height: 210 },
      assignments: groups.map((g) => ({
        id: uid(),
        atomIds: g.atoms,
        ppm: g.shift,
        ...(g.lines.length === 1
          ? { peakId: peaks.find((p) => Math.abs(p.ppm - g.shift) < 1e-6)?.id }
          : {}),
        label: atomLabel(g.atoms),
      })),
    },
  };
}

export { savedPredictionResult } from "./predictionResult";
