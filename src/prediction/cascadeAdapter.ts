import { generateConformersInCurrentThread } from "./conformers/runtime";
import { inferCascadeEnsemble } from "./cascade";
import type { CascadePrediction } from "./cascade/types";
import type { ConformerEnsemble } from "./conformers/types";
import type {
  PredictionInput,
  PredictionOptions,
  PredictionResult,
  PredictedAtomShift,
} from "./types";
import { buildCouplingFeatures } from "./couplings/features";
import { predictLearnedCouplings } from "./couplings/runtime";
import type { LearnedCouplingPrediction } from "./couplings/types";
import { renderLearnedSpinSystem } from "./learnedSpin";
import { representativeStereo } from "./stereochemistry";
import { representativeStereoComment } from "./stereoSelection";

export function cascadeResult(
  input: PredictionInput,
  ensemble: ConformerEnsemble,
  output: CascadePrediction,
  learned?: LearnedCouplingPrediction,
): PredictionResult {
  const ordinals = new Map<number, number>();
  const raw: { index: number; shift: PredictedAtomShift; key: string }[] = [];
  for (const s of output.shifts.filter((s) => s.nucleus === input.nucleus)) {
    if (input.nucleus === "1H" && ensemble.atomIsotopes[s.atomIndex] >= 2)
      continue;
    const atom = s.atomIndex,
      isH = input.nucleus === "1H",
      parent = ensemble.hydrogenParents[atom];
    const original = ensemble.originalAtomIndices[atom];
    const parentOriginal =
      parent >= 0 ? ensemble.originalAtomIndices[parent] : original;
    const ordinal = ordinals.get(parentOriginal) ?? 0;
    if (isH) ordinals.set(parentOriginal, ordinal + 1);
    const siblings = ensemble.atomicNumbers.flatMap((z, i) =>
      z === 1 && ensemble.hydrogenParents[i] === parent ? [i] : [],
    );
    const distinct =
      new Set(siblings.map((i) => ensemble.hydrogenSiteKeys[i])).size > 1;
    const atomIndex = original >= 0 ? original : parentOriginal;
    if (atomIndex < 0)
      throw Error("CASCADE could not preserve the original atom mapping.");
    raw.push({
      index: atom,
      key: isH ? ensemble.hydrogenSiteKeys[atom] : `C:${atom}`,
      shift: {
        explicitAtomIndex: atom,
        atomIndex,
        element: isH ? "H" : "C",
        shiftPpm: s.shiftPpm,
        hydrogenCount: 1,
        ...(isH && original < 0
          ? {
              hydrogenOrdinal: ordinal,
              atomLabel: distinct
                ? `H${String.fromCharCode(97 + ordinal)}`
                : undefined,
            }
          : {}),
        conformerStdDevPpm: s.conformerStdDevPpm,
        sampleCount: output.conformerCount,
        minPpm: s.shiftPpm,
        maxPpm: s.shiftPpm,
        radius: 0,
        hoseCode: "",
      },
    });
  }
  // Symmetry averaging enforces physically equivalent protons without merging
  // distinct replacement IDs. Separate CH₂ sites retain separate model shifts.
  const averages = new Map<string, { sum: number; n: number }>();
  for (const item of raw) {
    const a = averages.get(item.key) ?? { sum: 0, n: 0 };
    a.sum += item.shift.shiftPpm;
    a.n++;
    averages.set(item.key, a);
  }
  for (const item of raw) {
    const avg = averages.get(item.key)!;
    item.shift.shiftPpm = avg.sum / avg.n;
    item.shift.minPpm = item.shift.maxPpm = item.shift.shiftPpm;
  }
  const model = output.models.find((m) => m.nucleus === input.nucleus)!;
  const result: PredictionResult = {
    engine: "cascade",
    dataset: `CASCADE ${model.id} · ${model.weightsSha256}`,
    nucleus: input.nucleus,
    targetAtomCount: raw.length,
    missingAtomCount: 0,
    shifts: raw.map((r) => r.shift),
    warnings: [
      "CASCADE neural-network prediction from local ETKDGv3/MMFF94 conformers. Conformer spread is variation, not a calibrated prediction error.",
      ...(input.nucleus === "1H"
        ? [
            "The proton CASCADE model was trained on DFT shifts/geometries. Using force-field conformers is a geometry approximation, and solvent/exchange are not modeled.",
          ]
        : []),
      ...(raw.some((r) => r.shift.atomLabel)
        ? [
            "Diastereotopic proton sites are kept separate (Ha/Hb); the letters are stable site labels, not pro-R/pro-S assignments.",
          ]
        : []),
      ...ensemble.hydrogenAlignmentWarnings,
      ...(input.nucleus === "1H" &&
      ensemble.atomicNumbers.some(
        (z, i) => z === 1 && ensemble.atomIsotopes[i] >= 2,
      )
        ? [
            "Deuterium/tritium are excluded from ¹H counts and J display; isotope shifts and heteronuclear D/T coupling are not modeled.",
          ]
        : []),
      ...(ensemble.conformers.some((c) => !c.converged)
        ? [
            "Some conformer optimizations reached the iteration limit. Review the conformer ensemble before interpreting shifts.",
          ]
        : []),
    ],
    cascade: {
      modelId: model.id,
      weightsSha256: model.weightsSha256,
      sourceSha256: model.sourceSha256,
      conformerCount: output.conformerCount,
      conformerWeights: output.conformerWeights,
      temperatureKelvin: output.temperatureKelvin,
      backend: output.backend,
      rdkitVersion: ensemble.rdkitVersion,
      geometryMethod: ensemble.method,
      lineage: model.lineage,
    },
  };
  if (input.nucleus === "1H" && learned) {
    const sites = raw.map((r) => ({
      id: `H:${r.index}`,
      explicitAtomIndex: r.index,
      atomIndex: r.shift.atomIndex,
      hydrogenOrdinal: r.shift.hydrogenOrdinal ?? 0,
      atomLabel: r.shift.atomLabel ?? "H",
      shiftPpm: r.shift.shiftPpm,
      equivalenceKey: r.key,
      exchangeable: [7, 8, 16].includes(
        ensemble.atomicNumbers[ensemble.hydrogenParents[r.index]],
      ),
    }));
    const byExplicit = new Map(sites.map((s) => [s.explicitAtomIndex, s]));
    // Two-site replacement keys average symmetry-related pairs without erasing
    // magnetic non-equivalence (e.g. separate aromatic ortho/meta couplings).
    const pairKeys = new Map(
      ensemble.hydrogenPairEquivalence.map(({ atomIndices, key }) => [
        atomIndices.join(":"),
        key,
      ]),
    );
    const pairKey = (a: number, b: number) => {
      const key = pairKeys.get([a, b].sort((x, y) => x - y).join(":"));
      if (!key)
        throw Error(
          "Missing stereochemical identity for a learned proton coupling.",
        );
      return key;
    };
    const averages = new Map<string, { sum: number; std: number; n: number }>();
    const protonCouplings = learned.couplings.filter((c) =>
      c.atomIndices.every((a) => byExplicit.has(a)),
    );
    for (const c of protonCouplings) {
      const key = pairKey(...c.atomIndices),
        v = averages.get(key) ?? { sum: 0, std: 0, n: 0 };
      v.sum += c.couplingHz;
      v.std += c.stdHz;
      v.n++;
      averages.set(key, v);
    }
    const couplings = protonCouplings.map((c) => {
      const avg = averages.get(pairKey(...c.atomIndices))!;
      return {
        siteIdA: byExplicit.get(c.atomIndices[0])!.id,
        siteIdB: byExplicit.get(c.atomIndices[1])!.id,
        jHz: avg.sum / avg.n,
        predictedJHz: avg.sum / avg.n,
        modelStdHz: avg.std / avg.n,
        equivalenceKey: pairKey(...c.atomIndices),
        bondDistance: c.bondDistance,
        source: "fullsspruce" as const,
      };
    });
    result.spinSystem = renderLearnedSpinSystem(
      {
        sites,
        couplings,
        model: {
          modelId: learned.metadata.modelId,
          weightsSha256: learned.metadata.weightsSha256,
          sourceSha256: learned.metadata.sourceSha256,
          upstreamRevision: learned.metadata.upstreamRevision,
          citation: learned.metadata.citation,
          rdkitVersion: ensemble.rdkitVersion,
          excludedProtonPairs: learned.metadata.excludedProtonPairs,
        },
      },
      input.splitting ?? "spin-system",
      input.frequencyMHz ?? 400,
      input.spinCouplingOverrides,
    );
    result.warnings.push(
      ...learned.metadata.warnings,
      ...result.spinSystem.display.warnings,
    );
  }
  return result;
}
export async function runCascadePrediction(
  input: PredictionInput,
  options: PredictionOptions = {},
) {
  if (!input.molfile?.trim())
    throw Error(
      "CASCADE requires a molecule drawing or imported SMILES structure.",
    );
  const selectedStereo = representativeStereo(input.molfile);
  const progress = (
    stage: import("./types").PredictionProgress["stage"],
    message: string,
    completed = 0,
    total = 1,
  ) => options.onProgress?.({ stage, message, completed, total });
  const ensemble = await generateConformersInCurrentThread(
    selectedStereo.molfile,
    {
      numConformers: input.numConformers ?? 10,
      signal: options.signal,
      onProgress: (p) =>
        progress(
          "conformers",
          p.stage === "loading"
            ? "Loading local RDKit geometry engine…"
            : `${p.stage === "embedding" ? "Generating" : "Optimizing"} 3D conformers · ${p.completed}/${p.total}`,
          p.completed,
          p.total,
        ),
    },
  );
  const output = await inferCascadeEnsemble(
    {
      atomicNumbers: ensemble.atomicNumbers,
      conformers: ensemble.conformers,
      nuclei: [input.nucleus],
    },
    {
      signal: options.signal,
      onProgress: (message) => progress("inference", message),
    },
  );
  const exceedsCouplingDomain = ensemble.atomicNumbers.length > 64;
  if (
    input.nucleus === "1H" &&
    exceedsCouplingDomain &&
    input.splitting !== "none"
  )
    throw Error(
      "The learned J model supports up to 64 atoms including hydrogens. Select unsplit prediction for larger molecules.",
    );
  const learned =
    input.nucleus === "1H" &&
    input.splitting !== "none" &&
    !exceedsCouplingDomain
      ? await predictLearnedCouplings(buildCouplingFeatures(ensemble), {
          signal: options.signal,
          onProgress: (message) => progress("inference", message),
        })
      : undefined;
  progress("inference", "Simulating the proton spin system…");
  const result = cascadeResult(input, ensemble, output, learned);
  if (selectedStereo.atomIndices.length) {
    result.stereoSelection = {
      undefinedAtomIndices: selectedStereo.atomIndices,
      molfile: selectedStereo.molfile,
    };
    result.warnings.unshift(representativeStereoComment(result)!);
  }
  if (input.nucleus === "1H" && exceedsCouplingDomain)
    result.warnings.push(
      "Chemical shifts only: this structure exceeds the learned coupling model’s 64-atom domain.",
    );
  return result;
}
