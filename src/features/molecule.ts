import { Molecule } from "openchemlib";
import { aromaticInputBonds } from "../prediction/aromatic-input";

export interface MoleculeAtom {
  id: string;
  /** Stable within this structure; a new/cleared structure starts at one. */
  index: number;
  element: string;
  x: number;
  y: number;
  charge: number;
  isotope?: number;
}
export interface MoleculeBond {
  id: string;
  from: string;
  to: string;
  order: 1 | 2 | 3;
  aromatic?: boolean;
  stereo?: "none" | "wedge" | "dash";
}
export interface MoleculeDocument {
  version: 1;
  id: string;
  atoms: MoleculeAtom[];
  bonds: MoleculeBond[];
  nextAtomIndex: number;
  smiles?: string;
  molfile?: string;
}
export const moleculeElements = [
  "C",
  "N",
  "O",
  "S",
  "P",
  "F",
  "Cl",
  "Br",
  "I",
  "H",
  "B",
  "Si",
] as const;
export const moleculeBondLength = 48;
const newId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export function emptyMolecule(): MoleculeDocument {
  return {
    version: 1,
    id: newId("molecule"),
    atoms: [],
    bonds: [],
    nextAtomIndex: 1,
  };
}
export function moleculeChanged(document: MoleculeDocument): MoleculeDocument {
  const next = { ...document };
  delete next.smiles;
  delete next.molfile;
  return next;
}
export function addMoleculeAtom(
  document: MoleculeDocument,
  element: string,
  x: number,
  y: number,
): { document: MoleculeDocument; atom: MoleculeAtom } {
  const atom: MoleculeAtom = {
    id: newId("atom"),
    index: document.atoms.length ? document.nextAtomIndex : 1,
    element,
    x,
    y,
    charge: 0,
  };
  return {
    document: moleculeChanged({
      ...document,
      atoms: [...document.atoms, atom],
      nextAtomIndex: atom.index + 1,
    }),
    atom,
  };
}
export function addMoleculeBond(
  document: MoleculeDocument,
  from: string,
  to: string,
  properties: Partial<Pick<MoleculeBond, "order" | "aromatic" | "stereo">> = {},
): MoleculeDocument {
  if (
    from === to ||
    !document.atoms.some((a) => a.id === from) ||
    !document.atoms.some((a) => a.id === to)
  )
    return document;
  const existing = document.bonds.find(
    (b) => (b.from === from && b.to === to) || (b.from === to && b.to === from),
  );
  const bond: MoleculeBond = {
    id: existing?.id ?? newId("bond"),
    from,
    to,
    order: 1,
    aromatic: false,
    stereo: "none",
    ...properties,
  };
  return moleculeChanged({
    ...document,
    bonds: existing
      ? document.bonds.map((b) => (b.id === existing.id ? bond : b))
      : [...document.bonds, bond],
  });
}
export function removeMoleculeAtoms(
  document: MoleculeDocument,
  ids: string[],
): MoleculeDocument {
  const removed = new Set(ids);
  return moleculeChanged({
    ...document,
    atoms: document.atoms.filter((a) => !removed.has(a.id)),
    nextAtomIndex: document.atoms.every((a) => removed.has(a.id))
      ? 1
      : document.nextAtomIndex,
    bonds: document.bonds.filter(
      (b) => !removed.has(b.from) && !removed.has(b.to),
    ),
  });
}
export function addMoleculeRing(
  document: MoleculeDocument,
  x: number,
  y: number,
  size: number,
  aromatic = false,
  anchorId?: string,
): MoleculeDocument {
  if (!Number.isInteger(size) || size < 3 || size > 8)
    throw new Error("Ring size must be between 3 and 8.");
  const radius = moleculeBondLength / (2 * Math.sin(Math.PI / size));
  const anchor = document.atoms.find((a) => a.id === anchorId);
  const centerX = anchor ? anchor.x + radius : x;
  const centerY = anchor ? anchor.y : y;
  let result = document;
  const ids: string[] = [];
  for (let i = 0; i < size; i++) {
    if (i === 0 && anchor) {
      ids.push(anchor.id);
      continue;
    }
    const angle = Math.PI + (i * Math.PI * 2) / size;
    const added = addMoleculeAtom(
      result,
      "C",
      centerX + radius * Math.cos(angle),
      centerY + radius * Math.sin(angle),
    );
    result = added.document;
    ids.push(added.atom.id);
  }
  for (let i = 0; i < size; i++)
    result = addMoleculeBond(result, ids[i], ids[(i + 1) % size], {
      order: aromatic && i % 2 === 0 ? 2 : 1,
      aromatic,
    });
  return result;
}
export function moleculeBounds(
  document: MoleculeDocument | null,
  padding = 36,
) {
  if (!document?.atoms.length)
    return { x: -140, y: -100, width: 280, height: 200 };
  const xs = document.atoms.map((a) => a.x),
    ys = document.atoms.map((a) => a.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  const width = Math.max(80, maxX - minX + padding * 2),
    height = Math.max(80, maxY - minY + padding * 2);
  return {
    x: (minX + maxX - width) / 2,
    y: (minY + maxY - height) / 2,
    width,
    height,
  };
}
export function validateMolecule(document: MoleculeDocument): string[] {
  const issues: string[] = [];
  if (document.atoms.length > 300)
    issues.push("Structures support up to 300 atoms.");
  if (document.bonds.length > 600)
    issues.push("Structures support up to 600 bonds.");
  const ids = new Set<string>(),
    numbers = new Set<number>();
  for (const atom of document.atoms) {
    if (ids.has(atom.id)) issues.push("Atom identifiers must be unique.");
    if (
      !Number.isInteger(atom.index) ||
      atom.index < 1 ||
      numbers.has(atom.index)
    )
      issues.push("Atom assignment numbers must be unique positive integers.");
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y))
      issues.push("Atom coordinates must be finite.");
    if (!Number.isInteger(atom.charge) || Math.abs(atom.charge) > 8)
      issues.push("Atom charges must be integers between −8 and +8.");
    if (
      atom.isotope !== undefined &&
      (!Number.isInteger(atom.isotope) ||
        atom.isotope < 1 ||
        atom.isotope > 300)
    )
      issues.push("Isotope masses must be positive integers up to 300.");
    if (!Molecule.getAtomicNoFromLabel(atom.element))
      issues.push(`Unknown element: ${atom.element}.`);
    ids.add(atom.id);
    numbers.add(atom.index);
  }
  if (
    !Number.isInteger(document.nextAtomIndex) ||
    document.nextAtomIndex <= Math.max(0, ...numbers)
  )
    issues.push("The next atom number must exceed all existing atom numbers.");
  const pairs = new Set<string>(),
    bondIds = new Set<string>();
  for (const bond of document.bonds) {
    const pair = [bond.from, bond.to].sort().join("|");
    if (!ids.has(bond.from) || !ids.has(bond.to))
      issues.push("A bond references a missing atom.");
    if (bond.from === bond.to) issues.push("An atom cannot bond to itself.");
    if (pairs.has(pair)) issues.push("Duplicate bonds are not supported.");
    if (bondIds.has(bond.id)) issues.push("Bond identifiers must be unique.");
    if (![1, 2, 3].includes(bond.order))
      issues.push("Bond order must be one, two, or three.");
    if (bond.stereo && bond.stereo !== "none" && bond.order !== 1)
      issues.push("Wedge and dashed bonds must be single bonds.");
    pairs.add(pair);
    bondIds.add(bond.id);
  }
  return [...new Set(issues)];
}
export function moleculeValenceWarnings(document: MoleculeDocument): string[] {
  const limits: Record<string, number> = {
    C: 4,
    N: 3,
    O: 2,
    F: 1,
    Cl: 1,
    Br: 1,
    I: 1,
    H: 1,
    B: 3,
  };
  return document.atoms.flatMap((atom) => {
    const adjacent = document.bonds.filter(
      (b) => b.from === atom.id || b.to === atom.id,
    );
    const aromaticCount = adjacent.filter((b) => b.aromatic).length;
    const valence =
      adjacent.reduce((n, b) => n + (b.aromatic ? 1 : b.order), 0) +
      (aromaticCount >= 2 && ["C", "B"].includes(atom.element) ? 1 : 0);
    const limit = limits[atom.element];
    return limit && valence > limit + Math.abs(atom.charge)
      ? [`${atom.element}${atom.index}: check valence (${valence}).`]
      : [];
  });
}
/** Components already carrying a double bond retain their imported Kekulé orders.
 * An all-single aromatic component needs chemistry layout to resolve alternation. */
function unresolvedAromaticBonds(document: MoleculeDocument): Set<string> {
  const remaining = new Set(
    document.bonds.filter((b) => b.aromatic).map((b) => b.id),
  );
  const unresolved = new Set<string>();
  while (remaining.size) {
    const first = document.bonds.find(
      (b) => b.id === remaining.values().next().value,
    )!;
    const component = [first];
    const atoms = new Set([first.from, first.to]);
    remaining.delete(first.id);
    for (let cursor = 0; cursor < component.length; cursor++) {
      for (const bond of document.bonds)
        if (
          remaining.has(bond.id) &&
          (atoms.has(bond.from) || atoms.has(bond.to))
        ) {
          remaining.delete(bond.id);
          component.push(bond);
          atoms.add(bond.from);
          atoms.add(bond.to);
        }
    }
    if (!component.some((b) => b.order === 2))
      component.forEach((b) => unresolved.add(b.id));
  }
  return unresolved;
}
function toChemistry(document: MoleculeDocument): Molecule {
  const errors = validateMolecule(document);
  if (errors.length) throw new Error(errors.join(" "));
  const molecule = new Molecule(document.atoms.length, document.bonds.length);
  const unresolved = unresolvedAromaticBonds(document);
  const indices = new Map<string, number>();
  document.atoms.forEach((atom) => {
    const i = molecule.addAtom(Molecule.getAtomicNoFromLabel(atom.element));
    indices.set(atom.id, i);
    molecule.setAtomX(i, atom.x / moleculeBondLength);
    molecule.setAtomY(i, atom.y / moleculeBondLength);
    molecule.setAtomCharge(i, atom.charge);
    if (atom.isotope) molecule.setAtomMass(i, atom.isotope);
  });
  document.bonds.forEach((bond) => {
    const type =
      bond.stereo === "wedge"
        ? Molecule.cBondTypeUp
        : bond.stereo === "dash"
          ? Molecule.cBondTypeDown
          : unresolved.has(bond.id)
            ? Molecule.cBondTypeDelocalized
            : bond.order === 3
              ? Molecule.cBondTypeTriple
              : bond.order === 2
                ? Molecule.cBondTypeDouble
                : Molecule.cBondTypeSingle;
    molecule.setBondType(
      molecule.addBond(indices.get(bond.from)!, indices.get(bond.to)!),
      type,
    );
  });
  return molecule;
}
export function exportMoleculeSmiles(document: MoleculeDocument): string {
  if (!document.atoms.length) return "";
  return toChemistry(document).toIsomericSmiles();
}
/** Write V2000 in document order. Chemistry-library molfile writers may move H atoms,
 * which would break the input indices returned by the prediction engine. */
export function exportMoleculeMolfile(document: MoleculeDocument): string {
  const errors = validateMolecule(document);
  if (errors.length) throw new Error(errors.join(" "));
  const field = (value: number) => String(value).padStart(3, " ");
  const coordinate = (value: number) => {
    const formatted = (value / moleculeBondLength).toFixed(4);
    if (formatted.length > 10)
      throw new Error(
        "Coordinates are too large for a V2000 molfile. Clean the structure before exporting.",
      );
    return formatted.padStart(10, " ");
  };
  const lines = [
    "Web NMR structure",
    "  Web NMR          2D",
    "",
    // Drawing wedges encode absolute stereochemistry. A zero V2000 chiral
    // flag makes some readers reinterpret them as a racemic relative group.
    `${field(document.atoms.length)}${field(document.bonds.length)}  0  0${field(document.bonds.some((b) => b.stereo === "wedge" || b.stereo === "dash") ? 1 : 0)}  0  0  0  0  0999 V2000`,
  ];
  const indices = new Map(document.atoms.map((atom, i) => [atom.id, i + 1]));
  const resolvedOrders = new Map<string, number>();
  const unresolved = unresolvedAromaticBonds(document);
  if (unresolved.size) {
    let chemistry = toChemistry(document);
    document.atoms.forEach((_atom, i) =>
      chemistry.setAtomMapNo(i, i + 1, false),
    );
    // Parsing a mapped aromatic SMILES localizes the double bonds. Helper arrays
    // alone leave user-created delocalized bonds at formal order one in OCL.
    chemistry = Molecule.fromSmiles(
      chemistry.toIsomericSmiles({
        includeMapping: true,
        kekulizedOutput: true,
      }),
    );
    chemistry.ensureHelperArrays(Molecule.cHelperRings);
    for (let i = 0; i < chemistry.getAllBonds(); i++) {
      const from = chemistry.getAtomMapNo(chemistry.getBondAtom(0, i)),
        to = chemistry.getAtomMapNo(chemistry.getBondAtom(1, i));
      resolvedOrders.set(
        [from, to].sort((a, b) => a - b).join(":"),
        chemistry.getBondOrder(i),
      );
    }
  }
  for (const atom of document.atoms)
    lines.push(
      `${coordinate(atom.x)}${coordinate(-atom.y)}${coordinate(0)} ${atom.element.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  for (const bond of document.bonds) {
    const key = [indices.get(bond.from)!, indices.get(bond.to)!]
      .sort((a, b) => a - b)
      .join(":");
    const order = unresolved.has(bond.id)
      ? resolvedOrders.get(key)
      : bond.order;
    if (!order || order > 3)
      throw new Error(
        "Cannot resolve aromatic bonds. Use alternating single and double bonds.",
      );
    lines.push(
      `${field(indices.get(bond.from)!)}${field(indices.get(bond.to)!)}${field(order)}${field(bond.stereo === "wedge" ? 1 : bond.stereo === "dash" ? 6 : 0)}  0  0  0`,
    );
  }
  for (const [kind, values] of [
    [
      "CHG",
      document.atoms.flatMap((atom, i) =>
        atom.charge ? [[i + 1, atom.charge]] : [],
      ),
    ],
    [
      "ISO",
      document.atoms.flatMap((atom, i) =>
        atom.isotope ? [[i + 1, atom.isotope]] : [],
      ),
    ],
  ] as const) {
    for (let start = 0; start < values.length; start += 8) {
      const group = values.slice(start, start + 8);
      lines.push(
        `M  ${kind}${field(group.length)}${group.map(([index, value]) => ` ${field(index)} ${field(value)}`).join("")}`,
      );
    }
  }
  lines.push("M  END", "");
  return lines.join("\n");
}
export function importMolecule(
  text: string,
  format: "smiles" | "molfile" = "smiles",
): MoleculeDocument {
  if (!text.trim()) throw new Error("Enter a structure to import.");
  const molecule =
    format === "molfile"
      ? Molecule.fromMolfile(text)
      : Molecule.fromSmiles(text, { noCoordinates: true });
  if (!molecule.getAllAtoms())
    throw new Error("No atoms were found in this structure.");
  if (molecule.getAllAtoms() > 300)
    throw new Error("Please import a structure with no more than 300 atoms.");
  // Preserve raw notation before coordinate invention/helper arrays move explicit H.
  // Input atom order is also the order used by prediction and assignment mapping.
  const inputBonds = aromaticInputBonds(
    format === "molfile" ? { molfile: text } : { smiles: text },
  );
  for (let i = 0; i < molecule.getAllAtoms(); i++)
    molecule.setAtomMapNo(i, i + 1, false);
  const overlapping =
    molecule.getAllBonds() > 0 &&
    Array.from({ length: molecule.getAllAtoms() }, (_, i) =>
      Math.hypot(
        molecule.getAtomX(i) - molecule.getAtomX(0),
        molecule.getAtomY(i) - molecule.getAtomY(0),
      ),
    ).every((distance) => distance < 0.001);
  if (format === "smiles" || overlapping)
    molecule.inventCoordinates({ keepHydrogens: true });
  molecule.ensureHelperArrays(Molecule.cHelperRings);
  const drawingScale =
    moleculeBondLength / (molecule.getAverageBondLength(false) || 1);
  const result = emptyMolecule();
  const internalAtomIds: string[] = [];
  for (let i = 0; i < molecule.getAllAtoms(); i++) {
    const id = newId("atom");
    internalAtomIds.push(id);
    result.atoms.push({
      id,
      index: molecule.getAtomMapNo(i),
      element: molecule.getAtomLabel(i),
      x: molecule.getAtomX(i) * drawingScale,
      y: molecule.getAtomY(i) * drawingScale,
      charge: molecule.getAtomCharge(i),
      ...(molecule.getAtomMass(i) ? { isotope: molecule.getAtomMass(i) } : {}),
    });
  }
  result.atoms.sort((a, b) => a.index - b.index);
  for (let i = 0; i < molecule.getAllBonds(); i++) {
    const type = molecule.getBondType(i);
    const from = molecule.getBondAtom(0, i),
      to = molecule.getBondAtom(1, i);
    const sourceA = molecule.getAtomMapNo(from) - 1,
      sourceB = molecule.getAtomMapNo(to) - 1;
    const key =
      sourceA < sourceB ? `${sourceA}:${sourceB}` : `${sourceB}:${sourceA}`;
    const inputOrder = inputBonds.get(key);
    result.bonds.push({
      id: newId("bond"),
      from: internalAtomIds[from],
      to: internalAtomIds[to],
      order: (inputOrder !== undefined && inputOrder !== 4
        ? inputOrder
        : Math.max(1, Math.min(3, molecule.getBondOrder(i)))) as 1 | 2 | 3,
      aromatic:
        inputOrder !== undefined
          ? inputOrder === 4
          : type === Molecule.cBondTypeDelocalized ||
            molecule.isAromaticBond(i),
      stereo:
        type === Molecule.cBondTypeUp
          ? "wedge"
          : type === Molecule.cBondTypeDown
            ? "dash"
            : "none",
    });
  }
  result.nextAtomIndex = result.atoms.length + 1;
  const bounds = moleculeBounds(result, 0);
  result.atoms = result.atoms.map((a) => ({
    ...a,
    x: a.x - bounds.x - bounds.width / 2,
    y: a.y - bounds.y - bounds.height / 2,
  }));
  const errors = validateMolecule(result);
  if (errors.length) throw new Error(errors.join(" "));
  return result;
}
export function cleanMolecule(document: MoleculeDocument): MoleculeDocument {
  if (!document.atoms.length) return document;
  const molecule = toChemistry(document);
  document.atoms.forEach((atom, i) =>
    molecule.setAtomMapNo(i, atom.index, false),
  );
  molecule.ensureHelperArrays(Molecule.cHelperParities);
  molecule.inventCoordinates({ keepHydrogens: true });
  molecule.setStereoBondsFromParity();
  // Coordinate invention can move or reverse a wedge to depict the same
  // stereocenter. Copy its new stereo bonds along with the new coordinates;
  // retaining an old wedge on a new layout can invert absolute chirality.
  const atomsByIndex = new Map(
    document.atoms.map((atom) => [atom.index, atom]),
  );
  const stereoBonds = new Map<
    string,
    { from: string; to: string; stereo: "none" | "wedge" | "dash" }
  >();
  for (let i = 0; i < molecule.getAllBonds(); i++) {
    const from = atomsByIndex.get(
      molecule.getAtomMapNo(molecule.getBondAtom(0, i)),
    )!;
    const to = atomsByIndex.get(
      molecule.getAtomMapNo(molecule.getBondAtom(1, i)),
    )!;
    const type = molecule.getBondType(i);
    stereoBonds.set([from.id, to.id].sort().join(":"), {
      from: from.id,
      to: to.id,
      stereo:
        type === Molecule.cBondTypeUp
          ? "wedge"
          : type === Molecule.cBondTypeDown
            ? "dash"
            : "none",
    });
  }
  const bonds = document.bonds.map((bond) => {
    const depiction = stereoBonds.get([bond.from, bond.to].sort().join(":"))!;
    if (!depiction) return bond;
    if (depiction.stereo === "none")
      return !bond.stereo || bond.stereo === "none"
        ? bond
        : { ...bond, stereo: "none" as const };
    return { ...bond, ...depiction };
  });
  const drawingScale =
    moleculeBondLength / (molecule.getAverageBondLength(false) || 1);
  const coordinates = new Map(
    Array.from({ length: molecule.getAllAtoms() }, (_, i) => [
      molecule.getAtomMapNo(i),
      {
        x: molecule.getAtomX(i) * drawingScale,
        y: molecule.getAtomY(i) * drawingScale,
      },
    ]),
  );
  const atoms = document.atoms.map((atom) => ({
    ...atom,
    ...coordinates.get(atom.index),
  }));
  const bounds = moleculeBounds({ ...document, atoms }, 0);
  return moleculeChanged({
    ...document,
    bonds,
    atoms: atoms.map((a) => ({
      ...a,
      x: a.x - bounds.x - bounds.width / 2,
      y: a.y - bounds.y - bounds.height / 2,
    })),
  });
}

/** Chemistry-derived implicit H counts, mapped back after helper arrays reorder H. */
export function moleculeImplicitHydrogens(
  document: MoleculeDocument,
  orders = moleculeDisplayBondOrders(document),
): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    const molecule = toChemistry({
      ...document,
      bonds: document.bonds.map((bond) => ({
        ...bond,
        order: (orders.get(bond.id) ?? bond.order) as 1 | 2 | 3,
        aromatic: false,
      })),
    });
    document.atoms.forEach((_atom, i) =>
      molecule.setAtomMapNo(i, i + 1, false),
    );
    molecule.ensureHelperArrays(Molecule.cHelperRings);
    for (let i = 0; i < molecule.getAllAtoms(); i++) {
      const atom = document.atoms[molecule.getAtomMapNo(i) - 1];
      if (atom) counts.set(atom.id, molecule.getImplicitHydrogens(i));
    }
  } catch {
    /* An incomplete drawing remains editable even with invalid valence. */
  }
  return counts;
}

/** Localized aromatic orders for a conventional alternating-bond depiction. */
export function moleculeDisplayBondOrders(
  document: MoleculeDocument,
): Map<string, number> {
  const orders = new Map(document.bonds.map((b) => [b.id, b.order as number]));
  try {
    const lines = exportMoleculeMolfile(document).split("\n");
    document.bonds.forEach((bond, i) =>
      orders.set(
        bond.id,
        Number(lines[4 + document.atoms.length + i].slice(6, 9)),
      ),
    );
  } catch {
    /* Keep incomplete structures visible while they are being edited. */
  }
  return orders;
}

/** Compatibility name used by structure prediction and project integrations. */
export const moleculeToMolfile = exportMoleculeMolfile;
export const moleculeToSmiles = exportMoleculeSmiles;

/** Original aromatic notation for HOSE prediction; portable molfiles keep Kekulé orders. */
export function exportPredictionAromaticBonds(
  document: MoleculeDocument,
): [number, number][] {
  const indices = new Map(document.atoms.map((atom, i) => [atom.id, i]));
  return document.bonds
    .filter((bond) => bond.aromatic)
    .map((bond) => [indices.get(bond.from)!, indices.get(bond.to)!]);
}
