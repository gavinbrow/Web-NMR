import { Molecule } from "openchemlib";
import {
  exportMoleculeMolfile,
  exportPredictionAromaticBonds,
  type MoleculeDocument,
} from "./molecule";
import { moleculeGraph } from "../prediction/molecule";
import type { CouplingOverride } from "./predictionSetup";
import type {
  PredictionResult,
  PredictedCoupling,
  PredictedSignal,
} from "../prediction/types";

export interface ProtonSite {
  atomIndex: number;
  atomId: string;
  label: string;
  hydrogens: number;
  parent: number;
  parentElement: string;
  symmetry: number;
}
export interface CouplingEstimate extends PredictedCoupling {
  atomIdA: string;
  atomIdB: string;
  labelA: string;
  labelB: string;
}
export interface SplittingLine {
  offsetHz: number;
  weight: number;
}

/** Site identifiers refer to original drawing atoms, including explicit H.
 * Heavy-parent symmetry prevents equivalent groups from splitting one another.
 * We deliberately do not infer separate stereotopic protons from a 2D drawing.
 */
export function estimateProtonCouplings(
  document: MoleculeDocument,
  overrides: CouplingOverride[] = [],
): {
  sites: ProtonSite[];
  couplings: CouplingEstimate[];
  warnings: string[];
} {
  const molfile = exportMoleculeMolfile(document);
  const graph = moleculeGraph({
    molfile,
    aromaticBonds: exportPredictionAromaticBonds(document),
  });
  const mol = Molecule.fromMolfile(molfile);
  for (let i = 0; i < mol.getAllAtoms(); i++) mol.setAtomMapNo(i, i + 1, false);
  mol.ensureHelperArrays(Molecule.cHelperSymmetrySimple);
  const ranks = new Map<number, number>();
  for (let i = 0; i < mol.getAllAtoms(); i++)
    ranks.set(mol.getAtomMapNo(i) - 1, mol.getSymmetryRank(i));
  const adjacent = graph.atoms.map(
    () => [] as { atom: number; order: number }[],
  );
  for (const [a, b, order] of graph.bonds) {
    adjacent[a].push({ atom: b, order });
    adjacent[b].push({ atom: a, order });
  }
  const grouped = new Map<number, ProtonSite>();
  for (let h = 0; h < graph.atoms.length; h++) {
    const a = graph.atoms[h];
    if (a.atomicNumber !== 1) continue;
    const atomIndex = a.parentIndex ?? a.atomIndex!;
    const atom = document.atoms[atomIndex];
    if (!atom || (atom.element === "H" && atom.isotope && atom.isotope !== 1))
      continue;
    const parent = adjacent[h].find(
      (n) => graph.atoms[n.atom].atomicNumber !== 1,
    )?.atom;
    if (parent === undefined) continue;
    const p = graph.atoms[parent];
    const prior = grouped.get(atomIndex);
    if (prior) prior.hydrogens++;
    else
      grouped.set(atomIndex, {
        atomIndex,
        atomId: atom.id,
        label: `${atom.element}${atom.index}`,
        hydrogens: 1,
        parent,
        parentElement: p.element,
        symmetry: ranks.get(p.atomIndex!) ?? -parent - 1,
      });
  }
  const sites = [...grouped.values()].sort((a, b) => a.atomIndex - b.atomIndex);
  const couplings: CouplingEstimate[] = [];
  function add(
    a: ProtonSite,
    b: ProtonSite,
    jHz: number,
    source: "estimate" | "manual",
    rule: string,
  ) {
    if (jHz <= 0) return;
    couplings.push({
      atomIndexA: a.atomIndex,
      atomIndexB: b.atomIndex,
      hydrogensA: a.hydrogens,
      hydrogensB: b.hydrogens,
      jHz,
      source,
      rule,
      atomIdA: a.atomId,
      atomIdB: b.atomId,
      labelA: a.label,
      labelB: b.label,
    });
  }
  // Shortest all-carbon paths: adjacent parents => 3JHH, aromatic distance 2/3 => 4J/5J.
  for (let i = 0; i < sites.length; i++)
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i],
        b = sites[j];
      if (a.parent === b.parent || a.symmetry === b.symmetry) continue;
      const manual = [...overrides]
        .reverse()
        .find(
          (c) =>
            (c.atomIdA === a.atomId && c.atomIdB === b.atomId) ||
            (c.atomIdA === b.atomId && c.atomIdB === a.atomId),
        );
      if (manual) {
        if (!Number.isFinite(manual.jHz) || manual.jHz < 0 || manual.jHz > 100)
          throw Error("J values must be between 0 and 100 Hz.");
        add(a, b, manual.jHz, "manual", "User-entered J magnitude");
        continue;
      }
      if (a.parentElement !== "C" || b.parentElement !== "C") continue;
      const queue = [{ atom: a.parent, orders: [] as number[] }],
        seen = new Set([a.parent]);
      let path: number[] | undefined;
      for (let q = 0; q < queue.length; q++) {
        const current = queue[q];
        if (current.atom === b.parent) {
          path = current.orders;
          break;
        }
        if (current.orders.length >= 3) continue;
        for (const n of adjacent[current.atom])
          if (!seen.has(n.atom) && graph.atoms[n.atom].element === "C") {
            seen.add(n.atom);
            queue.push({ atom: n.atom, orders: [...current.orders, n.order] });
          }
      }
      if (!path) continue;
      if (path.length === 1) {
        const order = path[0];
        if (order === 4)
          add(a, b, 8, "estimate", "Aromatic ortho · typical 8 Hz");
        else if (order === 2)
          add(
            a,
            b,
            12,
            "estimate",
            "Alkene vicinal · 12 Hz placeholder; set cis/trans J manually",
          );
        else if (order === 1)
          add(
            a,
            b,
            7,
            "estimate",
            "Vicinal H–C–C–H · typical 7 Hz; conformation unresolved",
          );
      } else if (path.every((order) => order === 4)) {
        add(
          a,
          b,
          path.length === 2 ? 2 : 0.5,
          "estimate",
          path.length === 2
            ? "Aromatic meta · typical 2 Hz"
            : "Aromatic para · typical 0.5 Hz",
        );
      }
    }
  const warnings = [
    "First-order splitting uses typical, editable J magnitudes, not calculated or database-predicted coupling constants. Protons on one atom are treated as equivalent; geminal/diastereotopic splitting and second-order roofing are unresolved.",
    "OH/NH/SH coupling is omitted under a rapid-exchange assumption. Add a manual coupling if exchange is slow. Other long-range and heteronuclear couplings are omitted.",
  ];
  if (couplings.some((c) => c.rule.startsWith("Alkene")))
    warnings.push(
      "Alkene J values use a placeholder. Enter known cis/trans couplings; drawing geometry is not a 3D conformer.",
    );
  return { sites, couplings, warnings };
}

const names = ["s", "d", "t", "q", "quint", "sext", "sept", "oct", "nonet"];
/** Product of normalized Pascal patterns. Equal J values coalesce into n+1 lines.
 * Equivalent partners are not split here; they are excluded by the site model.
 */
export function firstOrderLines(partners: { count: number; jHz: number }[]): {
  lines: SplittingLine[];
  kind: string;
  couplingsHz: number[];
} {
  const grouped = new Map<number, number>();
  for (const { count, jHz } of partners) {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 8 ||
      !Number.isFinite(jHz) ||
      jHz < 0 ||
      jHz > 100
    )
      throw Error("Invalid first-order coupling group.");
    if (jHz === 0) continue;
    const key = Math.round(jHz * 10000) / 10000;
    if (key > 0) grouped.set(key, (grouped.get(key) ?? 0) + count);
  }
  let lines: SplittingLine[] = [{ offsetHz: 0, weight: 1 }];
  const kinds: string[] = [],
    js: number[] = [];
  for (const [jHz, count] of [...grouped].sort((a, b) => b[0] - a[0])) {
    if (lines.length * (count + 1) > 1024)
      throw Error(
        "This first-order pattern exceeds 1,024 lines. Disable small couplings or predict unsplit signals.",
      );
    const pascal = [1];
    for (let k = 1; k <= count; k++)
      pascal.push((pascal[k - 1] * (count - k + 1)) / k);
    const denominator = 2 ** count;
    const next = new Map<number, number>();
    for (const line of lines)
      for (let k = 0; k <= count; k++) {
        const offset =
          Math.round((line.offsetHz + (k - count / 2) * jHz) * 1e6) / 1e6;
        next.set(
          offset,
          (next.get(offset) ?? 0) + (line.weight * pascal[k]) / denominator,
        );
      }
    lines = [...next].map(([offsetHz, weight]) => ({ offsetHz, weight }));
    kinds.push(names[count] ?? `${count + 1}-plet`);
    js.push(jHz);
  }
  return {
    lines: lines.sort((a, b) => b.offsetHz - a.offsetHz),
    kind: kinds.join("") || "s",
    couplingsHz: js,
  };
}

export function splitPredictionSignals(
  result: PredictionResult,
  document: MoleculeDocument,
  mode: "none" | "first-order",
  overrides: CouplingOverride[] = [],
  frequencyMHz = 400,
) {
  const model =
    mode === "first-order" && result.nucleus === "1H"
      ? estimateProtonCouplings(document, overrides)
      : null;
  const present = new Set(result.shifts.map((s) => s.atomIndex));
  const couplings = (model?.couplings ?? []).filter(
    (c) => present.has(c.atomIndexA) && present.has(c.atomIndexB),
  );
  const warnings = [...(model?.warnings ?? [])];
  let strong = 0;
  for (const c of couplings) {
    const a = result.shifts.find((s) => s.atomIndex === c.atomIndexA)!,
      b = result.shifts.find((s) => s.atomIndex === c.atomIndexB)!;
    if (Math.abs(a.shiftPpm - b.shiftPpm) * frequencyMHz < 10 * c.jHz) strong++;
  }
  if (strong)
    warnings.push(
      `${strong} coupled pair${strong === 1 ? "" : "s"} may show second-order effects (Δν/J < 10). The displayed first-order patterns do not simulate those effects.`,
    );
  const patterns = result.shifts.map((s) => {
    const partners = couplings.flatMap((c) =>
      c.atomIndexA === s.atomIndex
        ? [{ count: c.hydrogensB, jHz: c.jHz }]
        : c.atomIndexB === s.atomIndex
          ? [{ count: c.hydrogensA, jHz: c.jHz }]
          : [],
    );
    const pattern = firstOrderLines(partners);
    const signal: PredictedSignal = {
      atomIndex: s.atomIndex,
      shiftPpm: s.shiftPpm,
      hydrogenCount: s.hydrogenCount,
      kind: pattern.kind,
      lineCount: pattern.lines.length,
      couplingsHz: pattern.couplingsHz,
    };
    return { ...pattern, signal };
  });
  return { patterns, couplings, warnings };
}
