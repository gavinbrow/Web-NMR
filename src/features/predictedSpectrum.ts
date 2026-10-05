import { colors, defaultRecipe, uid } from "../model";
import type { Spectrum } from "../model";
import type { PredictionSetup } from "./predictionSetup";
import type { MoleculeDocument } from "./molecule";
import type { PredictionResult } from "../prediction/types";

/** Absorption lines have unit ppm area per predicted nucleus; no invented couplings. */
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
  const carbon = setup.nucleus === "13C";
  const low = Math.min(carbon ? -20 : -2, ...shifts.map((s) => s.shiftPpm - 1));
  const high = Math.max(
    carbon ? 240 : 14,
    ...shifts.map((s) => s.shiftPpm + 1),
  );
  const x = new Float64Array(65536),
    real = new Float64Array(x.length),
    imag = new Float64Array(x.length);
  const gamma = setup.lineWidthHz / setup.frequencyMHz / 2;
  const groups: { shift: number; weight: number; atoms: string[] }[] = [];
  for (const s of shifts) {
    const atom = molecule.atoms[s.atomIndex];
    if (!atom)
      throw new Error("Prediction atom mapping does not match the molecule.");
    const weight = carbon ? 1 : Math.max(1, s.hydrogenCount);
    const group = groups.find((g) => Math.abs(g.shift - s.shiftPpm) < 1e-5);
    if (group) {
      group.weight += weight;
      if (!group.atoms.includes(atom.id)) group.atoms.push(atom.id);
    } else groups.push({ shift: s.shiftPpm, weight, atoms: [atom.id] });
  }
  for (let i = 0; i < x.length; i++) {
    const ppm = high - (i * (high - low)) / (x.length - 1);
    x[i] = ppm;
    for (const g of groups) {
      const d = ppm - g.shift,
        divisor = Math.PI * (d * d + gamma * gamma);
      real[i] += (g.weight * gamma) / divisor;
      imag[i] += (-g.weight * d) / divisor;
    }
  }
  const peaks = groups.map((g) => ({
    id: uid(),
    ppm: g.shift,
    height: g.weight / (Math.PI * gamma),
    label: g.atoms
      .map((id) => {
        const a = molecule.atoms.find((a) => a.id === id)!;
        return `${a.element}${a.index}`;
      })
      .join(", "),
  }));
  const title =
    setup.title.trim() ||
    `Predicted ${setup.nucleus} · ${molecule.smiles || "drawn molecule"}`;
  const data = { x, real, imag };
  return {
    prediction: structuredClone(result),
    id: uid(),
    label: title.slice(0, 200),
    color: colors[colorIndex % colors.length],
    nucleus: setup.nucleus,
    frequencyMHz: setup.frequencyMHz,
    sourceFormat: "CDK environment prediction",
    metadata: {
      title,
      comments: `Predicted from nmrshiftdb environments · ${setup.lineWidthHz} Hz linewidth\nUnsplit lookup signals; coupling constants are not predicted.`,
      predictionEngine: result.engine,
      predictionDataset: result.dataset,
      predictionWarnings: result.warnings.join("\n"),
      predictionTargetAtoms: result.targetAtomCount,
      predictionMissingAtoms: result.missingAtomCount,
    },
    original: data,
    data,
    recipe: { ...defaultRecipe(), window: "none" },
    referenceOffset: 0,
    peaks,
    integrals: [],
    multiplets: [],
    integralScale: 1,
    gain: 1,
    visible: true,
    history: ["Predicted locally with CDK HOSE / nmrshiftdb environments"],
    revision: 0,
    molecule: {
      document: structuredClone(molecule),
      visible: true,
      position: { x: 0.62, y: 0.07, width: 270, height: 210 },
      assignments: groups.map((g, i) => ({
        id: uid(),
        atomIds: g.atoms,
        ppm: g.shift,
        peakId: peaks[i].id,
        label: peaks[i].label,
      })),
    },
  };
}

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
