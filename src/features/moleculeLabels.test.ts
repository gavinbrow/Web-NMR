import { describe, it, expect } from "vitest";
import {
  addMoleculeAtom,
  emptyMolecule,
  importMolecule,
  removeMoleculeAtoms,
  moleculeImplicitHydrogens,
} from "./molecule";
import {
  moleculeNumberPositions,
  moleculeStereoLabelPositions,
} from "./moleculeLabels";
describe("structure numbering and label placement", () => {
  it("restarts after clearing all atoms, including an older high counter", () => {
    const old = importMolecule("CC=CC");
    old.nextAtomIndex = 41;
    old.atoms.forEach((a, i) => {
      a.index = i + 37;
    });
    const cleared = removeMoleculeAtoms(
      old,
      old.atoms.map((a) => a.id),
    );
    expect(cleared.nextAtomIndex).toBe(1);
    expect(addMoleculeAtom(cleared, "C", 0, 0).atom.index).toBe(1);
    expect(
      addMoleculeAtom({ ...emptyMolecule(), nextAtomIndex: 41 }, "C", 0, 0).atom
        .index,
    ).toBe(1);
    expect(removeMoleculeAtoms(old, [old.atoms[0].id]).atoms[0].index).toBe(38);
  });
  it("keeps numbers away from atoms and one another in rings and crowded heteroatoms", () => {
    for (const smiles of [
      "CC=CC",
      "c1ccccc1",
      "OC1CC(O)CC(O)C1",
      "CC(C)(O)C(=O)O",
    ]) {
      const m = importMolecule(smiles),
        positions = moleculeNumberPositions(m, moleculeImplicitHydrogens(m));
      expect(positions.size).toBe(m.atoms.length);
      for (const a of m.atoms) {
        const p = positions.get(a.id)!;
        expect(Math.hypot(p.x - a.x, p.y - a.y)).toBeGreaterThan(19);
        for (const other of m.atoms)
          expect(Math.hypot(p.x - other.x, p.y - other.y)).toBeGreaterThan(14);
        for (const b of m.atoms)
          if (a !== b) {
            const q = positions.get(b.id)!;
            expect(Math.abs(p.x - q.x) > 10 || Math.abs(p.y - q.y) > 13).toBe(
              true,
            );
          }
      }
    }
  });
  it("places CIP descriptors separately from atom numbers and chemical labels", () => {
    const m = importMolecule("C/C=C/[C@H](O)C"),
      h = moleculeImplicitHydrogens(m);
    const numbers = moleculeNumberPositions(m, h);
    const labels = [
      {
        id: "double",
        text: "E",
        x: (m.atoms[1].x + m.atoms[2].x) / 2,
        y: (m.atoms[1].y + m.atoms[2].y) / 2,
      },
      { id: "center", text: "R", x: m.atoms[3].x, y: m.atoms[3].y },
    ];
    const placed = moleculeStereoLabelPositions(m, labels, numbers, h);
    for (const p of placed.values()) {
      for (const q of numbers.values())
        expect(Math.abs(p.x - q.x) > 12 || Math.abs(p.y - q.y) > 14).toBe(true);
      for (const atom of m.atoms)
        expect(Math.hypot(p.x - atom.x, p.y - atom.y)).toBeGreaterThan(15);
    }
  });
});
