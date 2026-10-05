import type { MoleculeDocument } from "./molecule";
import type { Spectrum } from "../model";
import type {
  PredictionResult,
  SpinCouplingOverride,
} from "../prediction/types";

export interface PredictionSetup {
  engine?: "cdk-hose-nmrshiftdb" | "cascade";
  numConformers?: number;
  molecule: MoleculeDocument | null;
  nucleus: "1H" | "13C";
  frequencyMHz: number;
  lineWidthHz: number;
  title: string;
  /** Missing in older setups: new predictions use splitting unless explicitly disabled. */
  splitting?: "none" | "first-order" | "spin-system";
  couplingOverrides?: CouplingOverride[];
  spinCouplingOverrides?: SpinCouplingOverride[];
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
    engine: "cdk-hose-nmrshiftdb",
    numConformers: 10,
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
    (p.engine === undefined ||
      ["cdk-hose-nmrshiftdb", "cascade"].includes(p.engine)) &&
    (p.numConformers === undefined ||
      (Number.isInteger(p.numConformers) &&
        p.numConformers >= 1 &&
        p.numConformers <= 10)) &&
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
      ["none", "first-order", "spin-system"].includes(p.splitting)) &&
    (p.spinCouplingOverrides === undefined ||
      (Array.isArray(p.spinCouplingOverrides) &&
        p.spinCouplingOverrides.length <= 2016 &&
        p.spinCouplingOverrides.every(
          (c) =>
            c &&
            [c.atomIndexA, c.atomIndexB].every(
              (n) => Number.isInteger(n) && n >= 0 && n < 64,
            ) &&
            c.atomIndexA !== c.atomIndexB &&
            Number.isFinite(c.jHz) &&
            Math.abs(c.jHz) <= 100,
        ))) &&
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
    ["cdk-hose-nmrshiftdb", "cascade"].includes(r.engine) &&
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
        (s.explicitAtomIndex === undefined ||
          (Number.isInteger(s.explicitAtomIndex) &&
            s.explicitAtomIndex >= 0 &&
            s.explicitAtomIndex < 300)) &&
        (s.hydrogenOrdinal === undefined ||
          (Number.isInteger(s.hydrogenOrdinal) &&
            s.hydrogenOrdinal >= 0 &&
            s.hydrogenOrdinal < 8)) &&
        (s.atomLabel === undefined ||
          (typeof s.atomLabel === "string" && s.atomLabel.length < 100)) &&
        (s.conformerStdDevPpm === undefined ||
          (Number.isFinite(s.conformerStdDevPpm) &&
            s.conformerStdDevPpm >= 0)) &&
        s.sampleCount > 0 &&
        s.hydrogenCount > 0 &&
        Number.isInteger(s.radius) &&
        s.radius >= (r.engine === "cascade" ? 0 : 1) &&
        s.radius <= 6 &&
        typeof s.hoseCode === "string" &&
        s.hoseCode.length < 10000,
    ) &&
    (r.cascade === undefined || validCascadeMetadata(r.cascade)) &&
    (r.spinSystem === undefined || validSpinSystem(r.spinSystem, r.shifts)) &&
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
    !["none", "first-order", "spin-system"].includes(value.mode) ||
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
        s.hydrogenCount <= 64 &&
        typeof s.kind === "string" &&
        s.kind.length < 100 &&
        Number.isInteger(s.lineCount) &&
        s.lineCount >= 1 &&
        s.lineCount <= 100_000 &&
        Array.isArray(s.couplingsHz) &&
        s.couplingsHz.length <= 100 &&
        s.couplingsHz.every((j) => Number.isFinite(j) && j > 0 && j <= 100),
    )
  );
}

function validCascadeMetadata(
  c: NonNullable<PredictionResult["cascade"]>,
): boolean {
  return (
    !!c &&
    typeof c.modelId === "string" &&
    c.modelId.length < 100 &&
    [c.weightsSha256, c.sourceSha256].every(
      (h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h),
    ) &&
    Number.isInteger(c.conformerCount) &&
    c.conformerCount >= 1 &&
    c.conformerCount <= 10 &&
    Array.isArray(c.conformerWeights) &&
    c.conformerWeights.length === c.conformerCount &&
    c.conformerWeights.every((w) => Number.isFinite(w) && w >= 0 && w <= 1) &&
    Math.abs(c.conformerWeights.reduce((a, b) => a + b, 0) - 1) < 1e-5 &&
    Number.isFinite(c.temperatureKelvin) &&
    c.temperatureKelvin > 0 &&
    c.temperatureKelvin < 10000 &&
    [c.backend, c.rdkitVersion, c.geometryMethod, c.lineage].every(
      (v) => typeof v === "string" && v.length < 1000,
    )
  );
}
function validSpinSystem(
  s: NonNullable<PredictionResult["spinSystem"]>,
  shifts: PredictionResult["shifts"],
): boolean {
  if (
    !s ||
    !Array.isArray(s.sites) ||
    !s.sites.length ||
    s.sites.length > 64 ||
    !Array.isArray(s.couplings) ||
    s.couplings.length > 2016 ||
    !s.model ||
    !s.display
  )
    return false;
  const ids = new Set<string>(),
    explicit = new Set<number>();
  for (const site of s.sites) {
    if (
      !site ||
      typeof site.id !== "string" ||
      site.id.length > 200 ||
      ids.has(site.id) ||
      !Number.isInteger(site.explicitAtomIndex) ||
      site.explicitAtomIndex < 0 ||
      site.explicitAtomIndex >= 64 ||
      explicit.has(site.explicitAtomIndex) ||
      !Number.isInteger(site.atomIndex) ||
      !shifts.some(
        (v) =>
          v.atomIndex === site.atomIndex &&
          v.explicitAtomIndex === site.explicitAtomIndex,
      ) ||
      !Number.isInteger(site.hydrogenOrdinal) ||
      site.hydrogenOrdinal < 0 ||
      site.hydrogenOrdinal > 7 ||
      typeof site.atomLabel !== "string" ||
      site.atomLabel.length > 100 ||
      typeof site.equivalenceKey !== "string" ||
      site.equivalenceKey.length > 10000 ||
      typeof site.exchangeable !== "boolean" ||
      !Number.isFinite(site.shiftPpm)
    )
      return false;
    ids.add(site.id);
    explicit.add(site.explicitAtomIndex);
  }
  const pairs = new Set<string>();
  for (const c of s.couplings) {
    if (
      !c ||
      !ids.has(c.siteIdA) ||
      !ids.has(c.siteIdB) ||
      c.siteIdA === c.siteIdB ||
      ![c.jHz, c.predictedJHz, c.modelStdHz].every(Number.isFinite) ||
      Math.abs(c.jHz) > 100 ||
      Math.abs(c.predictedJHz) > 100 ||
      c.modelStdHz < 0 ||
      c.modelStdHz > 1000 ||
      (c.equivalenceKey !== undefined &&
        (typeof c.equivalenceKey !== "string" ||
          c.equivalenceKey.length > 4096)) ||
      ![2, 3, 4].includes(c.bondDistance) ||
      !["fullsspruce", "manual"].includes(c.source)
    )
      return false;
    const key = [c.siteIdA, c.siteIdB].sort().join("|");
    if (pairs.has(key)) return false;
    pairs.add(key);
  }
  const m = s.model,
    d = s.display;
  if (
    ![m.modelId, m.upstreamRevision, m.citation, m.rdkitVersion].every(
      (v) => typeof v === "string" && v.length < 1000,
    ) ||
    ![m.weightsSha256, m.sourceSha256].every(
      (h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h),
    ) ||
    !Number.isInteger(m.excludedProtonPairs) ||
    m.excludedProtonPairs < 0 ||
    !["none", "first-order", "spin-system"].includes(d.mode) ||
    !Number.isFinite(d.frequencyMHz) ||
    d.frequencyMHz < 10 ||
    d.frequencyMHz > 2000 ||
    !Array.isArray(d.warnings) ||
    d.warnings.length > 100 ||
    !d.warnings.every((w) => typeof w === "string" && w.length < 10000) ||
    !Array.isArray(d.clusters) ||
    d.clusters.length > 64
  )
    return false;
  const seen = new Set<string>();
  for (const c of d.clusters) {
    if (
      !c ||
      !Array.isArray(c.siteIds) ||
      !c.siteIds.length ||
      c.siteIds.length > 64 ||
      !c.siteIds.every((id) => ids.has(id) && !seen.has(id)) ||
      new Set(c.siteIds).size !== c.siteIds.length ||
      !Array.isArray(c.lines) ||
      !c.lines.length ||
      c.lines.length > 250000 ||
      !c.lines.every(
        (l) =>
          l &&
          Number.isFinite(l.ppm) &&
          Number.isFinite(l.weight) &&
          l.weight > 0,
      )
    )
      return false;
    c.siteIds.forEach((id) => seen.add(id));
    if (
      Math.abs(c.lines.reduce((n, l) => n + l.weight, 0) - c.siteIds.length) >
      0.0001
    )
      return false;
  }
  return seen.size === ids.size;
}
