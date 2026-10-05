import type { MoleculeDocument } from "./molecule";
import type { Spectrum } from "../model";
import type { PredictionResult } from "../prediction/types";

export interface PredictionSetup {
  molecule: MoleculeDocument | null;
  nucleus: "1H" | "13C";
  frequencyMHz: number;
  lineWidthHz: number;
  title: string;
  /** Absent in older project files: retain their original unsplit display. */
  splitting?: "none" | "first-order";
  couplingOverrides?: CouplingOverride[];
}
export interface CouplingOverride {
  atomIdA: string;
  atomIdB: string;
  /** Zero explicitly removes this coupling. Values are first-order magnitudes. */
  jHz: number;
}
export interface AtomAssignment {
  id: string;
  atomIds: string[];
  ppm: number;
  peakId?: string;
  label?: string;
}
export interface SpectrumMolecule {
  document: MoleculeDocument;
  assignments: AtomAssignment[];
  visible: boolean;
  position: { x: number; y: number; width: number; height: number };
}
export function defaultPredictionSetup(): PredictionSetup {
  return {
    molecule: null,
    nucleus: "1H",
    frequencyMHz: 400,
    lineWidthHz: 1,
    title: "",
    splitting: "first-order",
    couplingOverrides: [],
  };
}
export function attachMolecule(
  spectrum: Spectrum,
  document: MoleculeDocument,
): Spectrum {
  const ids = new Set(document.atoms.map((a) => a.id));
  const same = spectrum.molecule?.document.id === document.id;
  return {
    ...spectrum,
    molecule: {
      document: structuredClone(document),
      assignments: same
        ? spectrum
            .molecule!.assignments.map((a) => ({
              ...a,
              atomIds: a.atomIds.filter((id) => ids.has(id)),
            }))
            .filter((a) => a.atomIds.length)
        : [],
      visible: true,
      position: spectrum.molecule?.position ?? {
        x: 0.62,
        y: 0.07,
        width: 270,
        height: 210,
      },
    },
    revision: spectrum.revision + 1,
  };
}
export function assignAtoms(
  spectrum: Spectrum,
  assignment: AtomAssignment,
): Spectrum {
  if (!spectrum.molecule || !Number.isFinite(assignment.ppm)) return spectrum;
  const ids = new Set(spectrum.molecule.document.atoms.map((a) => a.id));
  const atomIds = [...new Set(assignment.atomIds)].filter((id) => ids.has(id));
  if (!atomIds.length) return spectrum;
  // Assigning this atom group to an existing line replaces that group's earlier assignment.
  const key = [...atomIds].sort().join("|");
  const assignments = spectrum.molecule.assignments.filter(
    (a) =>
      !(
        Math.abs(a.ppm - assignment.ppm) < 1e-6 &&
        [...a.atomIds].sort().join("|") === key
      ),
  );
  return {
    ...spectrum,
    molecule: {
      ...spectrum.molecule,
      assignments: [...assignments, { ...assignment, atomIds }],
    },
    revision: spectrum.revision + 1,
  };
}
export function validMoleculeDocument(
  value: unknown,
): value is MoleculeDocument {
  const m = value as MoleculeDocument;
  if (
    !m ||
    m.version !== 1 ||
    typeof m.id !== "string" ||
    m.id.length > 200 ||
    !Array.isArray(m.atoms) ||
    m.atoms.length > 300 ||
    !Array.isArray(m.bonds) ||
    m.bonds.length > 600 ||
    !Number.isInteger(m.nextAtomIndex)
  )
    return false;
  const ids = new Set<string>(),
    indices = new Set<number>();
  for (const a of m.atoms) {
    if (
      !a ||
      typeof a.id !== "string" ||
      a.id.length > 200 ||
      ids.has(a.id) ||
      !Number.isInteger(a.index) ||
      a.index < 1 ||
      indices.has(a.index) ||
      typeof a.element !== "string" ||
      !/^[A-Z][a-z]?$/.test(a.element) ||
      ![a.x, a.y, a.charge].every(Number.isFinite) ||
      Math.abs(a.charge) > 10 ||
      (a.isotope !== undefined &&
        (!Number.isInteger(a.isotope) || a.isotope < 1))
    )
      return false;
    ids.add(a.id);
    indices.add(a.index);
  }
  const bonds = new Set<string>();
  return (
    m.bonds.every((b) => {
      if (
        !b ||
        typeof b.id !== "string" ||
        bonds.has(b.id) ||
        !ids.has(b.from) ||
        !ids.has(b.to) ||
        b.from === b.to ||
        ![1, 2, 3].includes(b.order) ||
        (b.aromatic !== undefined && typeof b.aromatic !== "boolean") ||
        (b.stereo !== undefined &&
          !["none", "wedge", "dash"].includes(b.stereo))
      )
        return false;
      bonds.add(b.id);
      return true;
    }) &&
    [m.smiles, m.molfile].every(
      (v) => v === undefined || (typeof v === "string" && v.length < 100_000),
    )
  );
}
export function validPredictionSetup(value: unknown): value is PredictionSetup {
  const p = value as PredictionSetup;
  return (
    !!p &&
    (p.molecule === null || validMoleculeDocument(p.molecule)) &&
    ["1H", "13C"].includes(p.nucleus) &&
    Number.isFinite(p.frequencyMHz) &&
    p.frequencyMHz >= 10 &&
    p.frequencyMHz <= 2000 &&
    Number.isFinite(p.lineWidthHz) &&
    p.lineWidthHz >= 0.1 &&
    p.lineWidthHz <= 100 &&
    typeof p.title === "string" &&
    p.title.length <= 500 &&
    (p.splitting === undefined ||
      ["none", "first-order"].includes(p.splitting)) &&
    (p.couplingOverrides === undefined ||
      (Array.isArray(p.couplingOverrides) &&
        p.couplingOverrides.length <= 1000 &&
        p.couplingOverrides.every(
          (c) =>
            c &&
            [c.atomIdA, c.atomIdB].every(
              (id) => typeof id === "string" && id.length <= 200,
            ) &&
            c.atomIdA !== c.atomIdB &&
            Number.isFinite(c.jHz) &&
            c.jHz >= 0 &&
            c.jHz <= 100,
        )))
  );
}
export function validSpectrumMolecule(
  value: unknown,
): value is SpectrumMolecule {
  const m = value as SpectrumMolecule;
  if (
    !m ||
    !validMoleculeDocument(m.document) ||
    typeof m.visible !== "boolean" ||
    !m.position ||
    !Object.values(m.position).every(Number.isFinite) ||
    m.position.x < 0 ||
    m.position.x > 1 ||
    m.position.y < 0 ||
    m.position.y > 1 ||
    m.position.width < 120 ||
    m.position.width > 2000 ||
    m.position.height < 100 ||
    m.position.height > 2000 ||
    !Array.isArray(m.assignments) ||
    m.assignments.length > 5000
  )
    return false;
  const atomIds = new Set(m.document.atoms.map((a) => a.id)),
    assignmentIds = new Set<string>();
  return m.assignments.every((a) => {
    if (
      !a ||
      typeof a.id !== "string" ||
      assignmentIds.has(a.id) ||
      !Number.isFinite(a.ppm) ||
      !Array.isArray(a.atomIds) ||
      !a.atomIds.length ||
      !a.atomIds.every((id) => atomIds.has(id)) ||
      (a.peakId !== undefined && typeof a.peakId !== "string") ||
      (a.label !== undefined &&
        (typeof a.label !== "string" || a.label.length > 1000))
    )
      return false;
    assignmentIds.add(a.id);
    return true;
  });
}
export function validPredictionResult(
  value: unknown,
): value is PredictionResult {
  const r = value as PredictionResult;
  return (
    !!r &&
    r.engine === "cdk-hose-nmrshiftdb" &&
    typeof r.dataset === "string" &&
    r.dataset.length < 1000 &&
    ["1H", "13C"].includes(r.nucleus) &&
    [r.targetAtomCount, r.missingAtomCount].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 2500,
    ) &&
    Array.isArray(r.warnings) &&
    r.warnings.length <= 100 &&
    r.warnings.every((s) => typeof s === "string" && s.length < 10000) &&
    Array.isArray(r.shifts) &&
    r.shifts.length <= 1500 &&
    r.shifts.every(
      (s) =>
        s &&
        Number.isInteger(s.atomIndex) &&
        s.atomIndex >= 0 &&
        s.atomIndex < 300 &&
        ["H", "C"].includes(s.element) &&
        [s.shiftPpm, s.minPpm, s.maxPpm, s.sampleCount, s.hydrogenCount].every(
          Number.isFinite,
        ) &&
        s.sampleCount > 0 &&
        s.hydrogenCount > 0 &&
        Number.isInteger(s.radius) &&
        s.radius >= 1 &&
        s.radius <= 6 &&
        typeof s.hoseCode === "string" &&
        s.hoseCode.length < 10000,
    ) &&
    (r.splitting === undefined ||
      validPredictionSplitting(r.splitting, r.shifts))
  );
}

function validPredictionSplitting(
  value: PredictionResult["splitting"],
  shifts: PredictionResult["shifts"],
): boolean {
  if (
    !value ||
    !["none", "first-order"].includes(value.mode) ||
    !Number.isFinite(value.renderedLineWidthHz) ||
    value.renderedLineWidthHz <= 0 ||
    value.renderedLineWidthHz > 1000 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 100 ||
    !value.warnings.every((w) => typeof w === "string" && w.length < 10000) ||
    !Array.isArray(value.couplings) ||
    value.couplings.length > 1000 ||
    !Array.isArray(value.signals) ||
    value.signals.length > 1500
  )
    return false;
  const atoms = new Set(shifts.map((s) => s.atomIndex));
  return (
    value.couplings.every(
      (c) =>
        c &&
        atoms.has(c.atomIndexA) &&
        atoms.has(c.atomIndexB) &&
        c.atomIndexA !== c.atomIndexB &&
        [c.hydrogensA, c.hydrogensB].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 8,
        ) &&
        Number.isFinite(c.jHz) &&
        c.jHz > 0 &&
        c.jHz <= 100 &&
        ["estimate", "manual"].includes(c.source) &&
        typeof c.rule === "string" &&
        c.rule.length < 1000,
    ) &&
    value.signals.every(
      (s) =>
        s &&
        atoms.has(s.atomIndex) &&
        Number.isFinite(s.shiftPpm) &&
        Number.isInteger(s.hydrogenCount) &&
        s.hydrogenCount > 0 &&
        s.hydrogenCount <= 8 &&
        typeof s.kind === "string" &&
        s.kind.length < 100 &&
        Number.isInteger(s.lineCount) &&
        s.lineCount >= 1 &&
        s.lineCount <= 1024 &&
        Array.isArray(s.couplingsHz) &&
        s.couplingsHz.length <= 100 &&
        s.couplingsHz.every((j) => Number.isFinite(j) && j > 0 && j <= 100),
    )
  );
}
