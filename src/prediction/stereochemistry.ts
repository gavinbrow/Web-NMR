import { Molecule } from "openchemlib";

export interface StereoCenter {
  atomIndex: number;
  defined: boolean;
  label: string;
}

export interface StereoDoubleBond {
  atomIndices: [number, number];
  label: "E" | "Z";
}

function stereoGraph(molfile: string): Molecule {
  const mol = Molecule.fromMolfile(molfile);
  // Helper arrays may reorder explicit H. Source-order maps survive that move.
  for (let i = 0; i < mol.getAllAtoms(); i++) mol.setAtomMapNo(i, i + 1, false);
  mol.ensureHelperArrays(Molecule.cHelperCIP);
  return mol;
}

export function stereoCenters(molfile: string): StereoCenter[] {
  const mol = stereoGraph(molfile);
  const centers: StereoCenter[] = [];
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    if (!mol.isAtomStereoCenter(i)) continue;
    const parity = mol.getAtomParity(i);
    const defined =
      parity === Molecule.cAtomParity1 || parity === Molecule.cAtomParity2;
    const cip = mol.getAtomCIPParity(i);
    centers.push({
      atomIndex: mol.getAtomMapNo(i) - 1,
      defined,
      label: defined
        ? cip === Molecule.cAtomCIPParityRorM
          ? "R"
          : cip === Molecule.cAtomCIPParitySorP
            ? "S"
            : "defined"
        : "undefined · representative chosen",
    });
    if (defined && mol.isAtomParityPseudo(i))
      centers[centers.length - 1].label = centers.at(-1)!.label.toLowerCase();
  }
  return centers.sort((a, b) => a.atomIndex - b.atomIndex);
}

/** CIP priorities, rather than bond slope alone, determine E/Z. Source atom
 * maps also keep double-bond labels attached after explicit-H reordering. */
export function stereoDoubleBonds(molfile: string): StereoDoubleBond[] {
  const mol = stereoGraph(molfile);
  const bonds: StereoDoubleBond[] = [];
  for (let b = 0; b < mol.getAllBonds(); b++) {
    if (mol.getBondOrder(b) !== 2 || mol.isAromaticBond(b)) continue;
    const cip = mol.getBondCIPParity(b);
    if (
      ![Molecule.cBondCIPParityEorP, Molecule.cBondCIPParityZorM].includes(cip)
    )
      continue;
    bonds.push({
      atomIndices: [0, 1].map(
        (end) => mol.getAtomMapNo(mol.getBondAtom(end as 0 | 1, b)) - 1,
      ) as [number, number],
      label: cip === Molecule.cBondCIPParityEorP ? "E" : "Z",
    });
  }
  return bonds;
}

/** A saved prediction may supply an assumed configuration only while its
 * indexed molecular graph still matches. User-drawn configurations win. */
export function drawingStereochemistry(
  molfile: string,
  representativeMolfile?: string,
) {
  const centers = stereoCenters(molfile);
  const bonds = stereoDoubleBonds(molfile);
  const assumedAtomIndices: number[] = [];
  if (representativeMolfile) {
    const signature = (block: string) => {
      const m = stereoGraph(block);
      const atoms = Array.from({ length: m.getAllAtoms() }, (_, i) =>
        [
          m.getAtomMapNo(i),
          m.getAtomicNo(i),
          m.getAtomCharge(i),
          m.getAtomMass(i),
        ].join(":"),
      ).sort();
      const edges = Array.from(
        { length: m.getAllBonds() },
        (_, b) =>
          [
            m.getAtomMapNo(m.getBondAtom(0, b)),
            m.getAtomMapNo(m.getBondAtom(1, b)),
          ]
            .sort((a, c) => a - c)
            .join(":") + `:${m.getBondOrder(b)}:${m.isAromaticBond(b)}`,
      ).sort();
      return JSON.stringify([atoms, edges]);
    };
    if (signature(molfile) === signature(representativeMolfile)) {
      const assumed = new Map(
        stereoCenters(representativeMolfile).map((c) => [c.atomIndex, c]),
      );
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i],
          selected = assumed.get(c.atomIndex);
        if (!c.defined && selected?.defined) {
          centers[i] = selected;
          assumedAtomIndices.push(c.atomIndex);
        }
      }
    }
  }
  return { centers, bonds, assumedAtomIndices };
}

/** Every undefined tetrahedral center gets equal R/S population. Specified
 * centers and the source atom order remain unchanged. Highly combinatorial
 * structures use a deterministic, complement-paired balanced sample. */
export function enumerateStereoMixture(molfile: string) {
  return stereoVariants(molfile, false);
}

/** A reproducible single configuration for a readable prediction. Explicit
 * stereocenters and source atom slots remain unchanged. */
export function representativeStereo(molfile: string) {
  const selected = stereoVariants(molfile, true);
  return {
    atomIndices: selected.atomIndices,
    molfile: selected.variants[0].molfile,
  };
}

function stereoVariants(molfile: string, representativeOnly: boolean) {
  const mol = stereoGraph(molfile);
  const undefinedAtoms = Array.from(
    { length: mol.getAllAtoms() },
    (_, i) => i,
  ).filter(
    (i) =>
      mol.isAtomStereoCenter(i) &&
      ![Molecule.cAtomParity1, Molecule.cAtomParity2].includes(
        mol.getAtomParity(i),
      ),
  );
  const atomIndices = undefinedAtoms
    .map((i) => mol.getAtomMapNo(i) - 1)
    .sort((a, b) => a - b);
  if (!undefinedAtoms.length)
    return { atomIndices, sampled: false, variants: [{ molfile, weight: 1 }] };
  const count = representativeOnly
    ? 1
    : Math.min(64, 2 ** undefinedAtoms.length);
  const sampled = !representativeOnly && undefinedAtoms.length > 6;
  const variants: { molfile: string; weight: number }[] = [];
  const sourceLines = molfile.split(/\r?\n/);
  const sourceCount = Number(sourceLines[3].slice(0, 3));
  const bondCount = Number(sourceLines[3].slice(3, 6));
  for (let variant = 0; variant < count; variant++) {
    const copy = mol.getCompactCopy();
    let random = (Math.floor(variant / 2) + 1) * 0x9e3779b1;
    undefinedAtoms.forEach((atom, center) => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      const bit = sampled
        ? ((random >>> 0) & 1) ^ (variant & 1)
        : Math.floor(variant / 2 ** center) % 2;
      copy.setAtomParity(
        atom,
        bit ? Molecule.cAtomParity2 : Molecule.cAtomParity1,
        false,
      );
      copy.setAtomESR(atom, Molecule.cESRTypeAbs, 0);
    });
    copy.setParitiesValid(0);
    copy.setStereoBondsFromParity();
    // Patch only bond direction/stereo in the original V2000 block. Writing
    // via OCL would reorder explicit hydrogen slots and break atom assignment.
    const directions = new Map<
      string,
      { from: number; to: number; stereo: number }
    >();
    for (let b = 0; b < copy.getAllBonds(); b++) {
      const from = copy.getAtomMapNo(copy.getBondAtom(0, b)),
        to = copy.getAtomMapNo(copy.getBondAtom(1, b));
      const type = copy.getBondType(b);
      directions.set([from, to].sort((a, b) => a - b).join(":"), {
        from,
        to,
        stereo:
          type === Molecule.cBondTypeUp
            ? 1
            : type === Molecule.cBondTypeDown
              ? 6
              : 0,
      });
    }
    const lines = [...sourceLines];
    lines[3] = lines[3].slice(0, 12) + "  1" + lines[3].slice(15);
    for (let b = 0; b < bondCount; b++) {
      const row = 4 + sourceCount + b,
        line = lines[row];
      const key = [Number(line.slice(0, 3)), Number(line.slice(3, 6))]
        .sort((a, b) => a - b)
        .join(":");
      const direction = directions.get(key);
      if (!direction)
        throw Error("Stereoisomer bond mapping could not be preserved.");
      lines[row] =
        String(direction.from).padStart(3) +
        String(direction.to).padStart(3) +
        line.slice(6, 9) +
        String(direction.stereo).padStart(3) +
        line.slice(12);
    }
    variants.push({ molfile: lines.join("\n"), weight: 1 / count });
  }
  return { atomIndices, sampled, variants };
}
