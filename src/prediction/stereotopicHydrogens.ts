import { Molecule } from "openchemlib";
/** Diastereotopic replacement IDs distinguish Ha/Hb beside stereocentres and
 * terminal alkene protons, while averaging enantiotopic/homotopic protons in
 * achiral solution. Stable ordinals are local to each original heavy atom. */
export function hydrogenEquivalence(molfile: string) {
  const molecule = Molecule.fromMolfile(molfile);
  for (let i = 0; i < molecule.getAllAtoms(); i++)
    molecule.setAtomMapNo(i, i + 1, false);
  molecule.addImplicitHydrogens();
  molecule.ensureHelperArrays(Molecule.cHelperRings);
  const ids = molecule.getDiastereotopicAtomIDs();
  const parents = new Map<
    number,
    { key: string; originalIndex: number; ordinal: number }[]
  >();
  for (let bond = 0; bond < molecule.getAllBonds(); bond++) {
    const a = molecule.getBondAtom(0, bond),
      b = molecule.getBondAtom(1, bond);
    for (const [h, parent] of [
      [a, b],
      [b, a],
    ])
      if (molecule.getAtomicNo(h) === 1 && molecule.getAtomicNo(parent) !== 1) {
        const parentIndex = molecule.getAtomMapNo(parent) - 1;
        const list = parents.get(parentIndex) ?? [];
        list.push({
          key: ids[h],
          originalIndex: molecule.getAtomMapNo(h) - 1,
          ordinal: list.length,
        });
        parents.set(parentIndex, list);
      }
  }
  return parents;
}
