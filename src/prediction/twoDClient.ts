import { predictMolecule } from "./client";
import {
  exportMoleculeMolfile,
  importMolecule,
  moleculeImplicitHydrogens,
  type MoleculeDocument,
} from "../features/molecule";
import { estimateProtonCouplings } from "../features/predictionSplitting";
import { moleculeGraph } from "./molecule";
import type { CouplingOverride } from "../features/predictionSetup";
import type {
  PredictedAtomShift,
  PredictedTwoDCorrelation,
  PredictionInput,
  PredictionOptions,
  PredictionResult,
} from "./types";

export type TwoDPredictionInput = PredictionInput & {
  experiment: "HSQC" | "COSY";
  hsqcEdited?: boolean;
  cosyMinJHz?: number;
  /** Permanent drawing IDs in the same original input atom order. */
  molecule?: MoleculeDocument;
  couplingOverrides?: CouplingOverride[];
};
export const CARBON_PROTON_FREQUENCY_RATIO = 0.25145;
interface Proton {
  shift: PredictedAtomShift;
  id: string;
  label: string;
  parent: number;
  exchangeable: boolean;
  count: number;
  equivalenceKey?: string;
}
function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Prediction canceled.", "AbortError");
}
function documentFor(input: TwoDPredictionInput): MoleculeDocument {
  if (input.molecule) {
    const document = input.molecule;
    if (input.molfile?.trim() || input.smiles?.trim()) {
      const graph = moleculeGraph(input);
      const originals = graph.atoms.filter((a) => a.atomIndex !== undefined);
      const ids = new Map(document.atoms.map((a, i) => [a.id, i]));
      const pairs = new Set(
        document.bonds.map((b) =>
          [ids.get(b.from)!, ids.get(b.to)!].sort((a, b) => a - b).join(":"),
        ),
      );
      const inputPairs = graph.bonds.flatMap(([a, b]) => {
        const ia = graph.atoms[a].atomIndex,
          ib = graph.atoms[b].atomIndex;
        return ia === undefined || ib === undefined
          ? []
          : [[ia, ib].sort((x, y) => x - y).join(":")];
      });
      if (
        originals.length !== document.atoms.length ||
        originals.some(
          (a) => document.atoms[a.atomIndex!]?.element !== a.element,
        ) ||
        pairs.size !== inputPairs.length ||
        inputPairs.some((p) => !pairs.has(p))
      )
        throw Error(
          "The prediction structure does not match the original molecule atom mapping.",
        );
    }
    return document;
  }
  const document = importMolecule(
    input.molfile?.trim() || input.smiles || "",
    input.molfile?.trim() ? "molfile" : "smiles",
  );
  // A standalone notation input has no saved drawing IDs. Its original atom
  // positions still give deterministic IDs and preserve explicit-H mapping.
  const mapped = new Map(
    document.atoms.map((a, i) => [a.id, `input-atom-${i}`]),
  );
  return {
    ...document,
    id: "prediction-input",
    atoms: document.atoms.map((a) => ({ ...a, id: mapped.get(a.id)! })),
    bonds: document.bonds.map((b, i) => ({
      ...b,
      id: `input-bond-${i}`,
      from: mapped.get(b.from)!,
      to: mapped.get(b.to)!,
    })),
  };
}
function settingsFor(input: TwoDPredictionInput) {
  if (!["HSQC", "COSY"].includes(input.experiment))
    throw Error("Choose HSQC or COSY prediction.");
  const protonFrequencyMHz = input.frequencyMHz ?? 400,
    lineWidthHz = input.lineWidthHz ?? 1,
    cosyMinJHz = input.cosyMinJHz ?? 0.5;
  if (
    !Number.isFinite(protonFrequencyMHz) ||
    protonFrequencyMHz < 10 ||
    protonFrequencyMHz > 2000 ||
    !Number.isFinite(lineWidthHz) ||
    lineWidthHz < 0.1 ||
    lineWidthHz > 100
  )
    throw Error("Invalid 2D prediction field or linewidth.");
  if (!Number.isFinite(cosyMinJHz) || cosyMinJHz < 0 || cosyMinJHz > 100)
    throw Error("COSY minimum J must be between 0 and 100 Hz.");
  if (input.hsqcEdited !== undefined && typeof input.hsqcEdited !== "boolean")
    throw Error("Invalid HSQC editing setting.");
  return {
    protonFrequencyMHz,
    carbonFrequencyMHz: protonFrequencyMHz * CARBON_PROTON_FREQUENCY_RATIO,
    lineWidthHz,
    cosyMinJHz,
    hsqcEdited: input.hsqcEdited ?? false,
  };
}
function protonSites(
  result: PredictionResult,
  molecule: MoleculeDocument,
): Proton[] {
  if (result.nucleus !== "1H")
    throw Error("2D correlations require a proton shift result.");
  const byId = new Map(molecule.atoms.map((a, i) => [a.id, i]));
  return result.shifts
    .map<Proton | undefined>((shift, i) => {
      const atom = molecule.atoms[shift.atomIndex];
      if (
        !atom ||
        shift.element !== "H" ||
        !Number.isFinite(shift.shiftPpm) ||
        !Number.isInteger(shift.hydrogenCount) ||
        shift.hydrogenCount < 1
      )
        throw Error(
          "Invalid proton shift or original atom mapping for 2D prediction.",
        );
      let parent = shift.atomIndex;
      if (atom.element === "H") {
        if (atom.isotope && atom.isotope !== 1) return undefined;
        const bonds = molecule.bonds.filter(
          (b) => b.from === atom.id || b.to === atom.id,
        );
        if (bonds.length !== 1)
          throw Error(
            "A predicted explicit proton must have one bonded parent.",
          );
        parent = byId.get(
          bonds[0].from === atom.id ? bonds[0].to : bonds[0].from,
        )!;
      }
      const p = molecule.atoms[parent];
      if (!p || p.element === "H")
        throw Error("Missing parent for a predicted proton.");
      const learned = result.spinSystem?.sites.find(
        (s) =>
          s.explicitAtomIndex === shift.explicitAtomIndex &&
          s.atomIndex === shift.atomIndex,
      );
      return {
        shift,
        parent,
        id:
          learned?.id ??
          (shift.explicitAtomIndex !== undefined
            ? `H:${shift.explicitAtomIndex}`
            : `H-group:${shift.atomIndex}:${i}`),
        label: `${atom.element}${atom.index}${shift.atomLabel ? ` ${shift.atomLabel}` : atom.element === "H" ? "" : ` H${shift.hydrogenCount > 1 ? shift.hydrogenCount : ""}`}`,
        count: shift.hydrogenCount,
        exchangeable:
          learned?.exchangeable ?? ["N", "O", "S"].includes(p.element),
        equivalenceKey: learned?.equivalenceKey,
      };
    })
    .filter((site): site is Proton => site !== undefined);
}

/** Pure topology/J-to-correlation step, independently testable without workers. */
export function assembleTwoDCorrelations(
  input: TwoDPredictionInput,
  protonResult: PredictionResult,
  molecule: MoleculeDocument,
  carbonResult?: PredictionResult,
): PredictionResult {
  const settings = settingsFor(input),
    sites = protonSites(protonResult, molecule);
  const correlations: PredictedTwoDCorrelation[] = [];
  const warnings = [
    "2D peak weights and Gaussian/Lorentzian shapes are illustrative. Pulse timings, transfer efficiencies, relaxation, strong-coupling cross-peak structure, and phase-cycle effects are not simulated.",
  ];
  const atom = (site: Proton) => molecule.atoms[site.shift.atomIndex];
  if (input.experiment === "HSQC") {
    if (!carbonResult || carbonResult.nucleus !== "13C" || carbonResult.twoD)
      throw Error("HSQC requires a separate carbon shift prediction.");
    const carbon = new Map<number, PredictedAtomShift>();
    for (const s of carbonResult.shifts) {
      if (
        !Number.isFinite(s.shiftPpm) ||
        s.element !== "C" ||
        molecule.atoms[s.atomIndex]?.element !== "C"
      )
        throw Error("Invalid carbon atom mapping for HSQC.");
      carbon.set(s.atomIndex, s);
    }
    const counts = moleculeImplicitHydrogens(molecule);
    for (const h of molecule.atoms.filter(
      (a) => a.element === "H" && (!a.isotope || a.isotope === 1),
    )) {
      for (const b of molecule.bonds.filter(
        (b) => b.from === h.id || b.to === h.id,
      )) {
        const other = b.from === h.id ? b.to : b.from;
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
    }
    let missing = 0;
    for (const site of sites) {
      if (molecule.atoms[site.parent].element !== "C") continue;
      const c = carbon.get(site.parent);
      if (!c) {
        missing++;
        continue;
      }
      const carbonAtom = molecule.atoms[c.atomIndex];
      correlations.push({
        id: `HSQC:${site.id}:C:${c.atomIndex}`,
        kind: "direct",
        xPpm: site.shift.shiftPpm,
        yPpm: c.shiftPpm,
        atomIndexX: site.shift.atomIndex,
        atomIndexY: c.atomIndex,
        atomIdX: atom(site).id,
        atomIdY: carbonAtom.id,
        siteIdX: site.id,
        protonLabelX: site.label,
        weight: site.count,
        sign: settings.hsqcEdited && counts.get(carbonAtom.id) === 2 ? -1 : 1,
      });
    }
    warnings.push(
      "HSQC includes only directly bonded ¹H–¹³C pairs; exchangeable heteroatom-bound protons and unprotonated carbons have no correlation.",
    );
    if (settings.hsqcEdited)
      warnings.push(
        "Illustrative multiplicity editing: CH₂ is opposite phase to CH/CH₃. Phase conventions may be reversed in measured spectra.",
      );
    if (
      missing ||
      protonResult.missingAtomCount ||
      carbonResult.missingAtomCount
    )
      warnings.push(
        "Missing proton or carbon shifts leave unsupported HSQC correlations absent.",
      );
  } else {
    for (const site of sites)
      correlations.push({
        id: `COSY:diagonal:${site.id}`,
        kind: "diagonal",
        xPpm: site.shift.shiftPpm,
        yPpm: site.shift.shiftPpm,
        atomIndexX: site.shift.atomIndex,
        atomIndexY: site.shift.atomIndex,
        atomIdX: atom(site).id,
        atomIdY: atom(site).id,
        siteIdX: site.id,
        siteIdY: site.id,
        protonLabelX: site.label,
        protonLabelY: site.label,
        weight: site.count,
        sign: 1,
      });
    const addPair = (
      a: Proton,
      b: Proton,
      jHz: number,
      source: "fullsspruce" | "estimate" | "manual",
    ) => {
      if (!Number.isFinite(jHz)) throw Error("COSY coupling is not finite.");
      if (
        a.id === b.id ||
        a.exchangeable ||
        b.exchangeable ||
        (a.equivalenceKey !== undefined &&
          a.equivalenceKey === b.equivalenceKey) ||
        jHz === 0 ||
        Math.abs(jHz) < settings.cosyMinJHz
      )
        return;
      // J sign is provenance, not an arbitrary positive/negative COSY phase.
      const weight =
        Math.sqrt(a.count * b.count) * Math.min(1, Math.abs(jHz) / 7);
      for (const [x, y] of [
        [a, b],
        [b, a],
      ])
        correlations.push({
          id: `COSY:cross:${x.id}:${y.id}`,
          kind: "cross",
          xPpm: x.shift.shiftPpm,
          yPpm: y.shift.shiftPpm,
          atomIndexX: x.shift.atomIndex,
          atomIndexY: y.shift.atomIndex,
          atomIdX: atom(x).id,
          atomIdY: atom(y).id,
          siteIdX: x.id,
          siteIdY: y.id,
          protonLabelX: x.label,
          protonLabelY: y.label,
          weight,
          sign: 1,
          jHz,
          source,
        });
    };
    if (protonResult.engine === "cascade") {
      if (!protonResult.spinSystem)
        throw Error(
          "CASCADE COSY requires learned proton J couplings; recalculate with first-order splitting.",
        );
      const bySite = new Map(sites.map((s) => [s.id, s]));
      for (const c of protonResult.spinSystem.couplings) {
        const a = bySite.get(c.siteIdA),
          b = bySite.get(c.siteIdB);
        if (!a || !b)
          throw Error("COSY learned coupling site mapping is incomplete.");
        addPair(a, b, c.jHz, c.source);
      }
      warnings.push(
        "COSY cross peaks use learned or manually overridden H–H J values in the trained 2–4-bond range; unsupported longer-range transfer is omitted.",
      );
    } else {
      const estimated = estimateProtonCouplings(
        molecule,
        input.couplingOverrides,
      );
      const byAtom = new Map(sites.map((s) => [s.shift.atomIndex, s]));
      for (const c of estimated.couplings) {
        const a = byAtom.get(c.atomIndexA),
          b = byAtom.get(c.atomIndexB);
        if (a && b) addPair(a, b, c.jHz, c.source);
      }
      warnings.push(
        "CDK COSY uses approximate typical J estimates, not learned/calculated couplings. Grouped database protons do not resolve Ha/Hb or geminal cross peaks.",
        ...estimated.warnings,
      );
    }
    warnings.push(
      "Symmetric COSY cross peaks indicate nonzero scalar coupling above the selected cutoff. Exchangeable-proton cross peaks are omitted; their available diagonal signals remain.",
    );
    if (protonResult.missingAtomCount)
      warnings.push(
        "Missing proton shifts leave unsupported COSY diagonal and cross peaks absent.",
      );
  }
  if (!correlations.length)
    throw Error(
      `No supported ${input.experiment} correlations were found for this molecule.`,
    );
  return {
    ...protonResult,
    warnings: [
      ...new Set([
        ...protonResult.warnings,
        ...(carbonResult?.warnings ?? []),
        ...warnings,
      ]),
    ],
    twoD: {
      experiment: input.experiment,
      correlations,
      ...(carbonResult ? { carbonResult } : {}),
      settings,
      warnings,
    },
  };
}

/** Same-origin browser shifts/J inference; molecule data never leave the device. */
export async function predictTwoDMolecule(
  input: TwoDPredictionInput,
  options: PredictionOptions = {},
): Promise<PredictionResult> {
  abortIfNeeded(options.signal);
  const settings = settingsFor(input),
    molecule = documentFor(input);
  const {
    experiment: _experiment,
    hsqcEdited: _edited,
    cosyMinJHz: _minJ,
    molecule: _molecule,
    couplingOverrides: _overrides,
    ...predictionInput
  } = input;
  if (!predictionInput.molfile?.trim() && !predictionInput.smiles?.trim())
    predictionInput.molfile = exportMoleculeMolfile(molecule);
  const protonInput: PredictionInput = {
    ...predictionInput,
    nucleus: "1H",
    frequencyMHz: settings.protonFrequencyMHz,
    splitting:
      input.experiment === "COSY" && input.engine === "cascade"
        ? "first-order"
        : "none",
  };
  const proton = await predictMolecule(protonInput, options);
  abortIfNeeded(options.signal);
  const carbon =
    input.experiment === "HSQC"
      ? await predictMolecule(
          {
            ...predictionInput,
            nucleus: "13C",
            frequencyMHz: settings.carbonFrequencyMHz,
            splitting: "none",
          },
          options,
        )
      : undefined;
  abortIfNeeded(options.signal);
  return assembleTwoDCorrelations(input, proton, molecule, carbon);
}
