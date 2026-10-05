import { describe, expect, it } from "vitest";
import { Molecule } from "openchemlib";
import { moleculeGraph } from "../prediction/molecule";
import { generateHoseCode } from "../prediction/hose";
import protonFixtures from "../prediction/proton-fixtures.json";
import carbonFixtures from "../prediction/carbon-fixtures.json";
import {
  addMoleculeAtom,
  addMoleculeBond,
  addMoleculeRing,
  cleanMolecule,
  emptyMolecule,
  exportMoleculeMolfile,
  exportMoleculeSmiles,
  exportPredictionAromaticBonds,
  importMolecule,
  moleculeValenceWarnings,
  removeMoleculeAtoms,
  validateMolecule,
} from "./molecule";

describe("original molecule document and chemistry exchange", () => {
  it("never reuses assignment numbers after deleting atoms and adding new ones", () => {
    const first = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    const second = addMoleculeAtom(first.document, "O", 48, 0);
    const bonded = addMoleculeBond(
      second.document,
      first.atom.id,
      second.atom.id,
    );
    const deleted = removeMoleculeAtoms(bonded, [first.atom.id]);
    const next = addMoleculeAtom(deleted, "N", 0, 0);
    expect(next.document.atoms.map((a) => a.index)).toEqual([2, 3]);
    expect(next.document.bonds).toHaveLength(0);
    expect(second.atom.id).toBe(next.document.atoms[0].id);
    expect(validateMolecule(next.document)).toEqual([]);
  });
  it("updates an existing bond without duplicate edges or changing its identity", () => {
    const a = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    const b = addMoleculeAtom(a.document, "O", 48, 0);
    const single = addMoleculeBond(b.document, a.atom.id, b.atom.id);
    const double = addMoleculeBond(single, b.atom.id, a.atom.id, { order: 2 });
    expect(double.bonds).toHaveLength(1);
    expect(double.bonds[0].id).toBe(single.bonds[0].id);
    expect(exportMoleculeSmiles(double)).toBe("C=O");
    expect(addMoleculeBond(double, a.atom.id, a.atom.id)).toBe(double);
  });
  it("creates complete aromatic rings and round-trips aromatic chemistry", () => {
    const ring = addMoleculeRing(emptyMolecule(), 0, 0, 6, true);
    expect(ring.atoms).toHaveLength(6);
    expect(ring.bonds).toHaveLength(6);
    expect(ring.bonds.every((b) => b.aromatic)).toBe(true);
    expect(exportMoleculeSmiles(ring)).toBe("c1ccccc1");
    const parsed = importMolecule(exportMoleculeMolfile(ring), "molfile");
    expect(exportMoleculeSmiles(parsed)).toBe("c1ccccc1");
    expect(() => addMoleculeRing(ring, 0, 0, 2)).toThrow(/between 3 and 8/);
  });
  it("preserves every atom ID, assignment number, bond ID, charge, and isotope during cleaning", () => {
    const a = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    const h = addMoleculeAtom(a.document, "H", 40, 3);
    const o = addMoleculeAtom(h.document, "O", -40, -9);
    let document = addMoleculeBond(o.document, a.atom.id, h.atom.id);
    document = addMoleculeBond(document, a.atom.id, o.atom.id);
    document.atoms[2] = { ...document.atoms[2], charge: -1, isotope: 18 };
    const cleaned = cleanMolecule(document);
    expect(cleaned.atoms.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual(
      document.atoms.map(({ x: _x, y: _y, ...rest }) => rest),
    );
    expect(cleaned.bonds).toEqual(document.bonds);
    expect(cleaned.nextAtomIndex).toBe(document.nextAtomIndex);
    expect(validateMolecule(cleaned)).toEqual([]);
  });
  it("exports molfiles in original atom order including explicit H, preserving prediction input indices", () => {
    const a = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    const h = addMoleculeAtom(a.document, "H", 48, 0);
    const o = addMoleculeAtom(h.document, "O", 0, 48);
    const bonded = addMoleculeBond(
      addMoleculeBond(o.document, a.atom.id, h.atom.id),
      a.atom.id,
      o.atom.id,
      { stereo: "wedge" },
    );
    const molfile = exportMoleculeMolfile(bonded);
    const atomLines = molfile.split("\n").slice(4, 7);
    expect(atomLines.map((line) => line.slice(31, 34).trim())).toEqual([
      "C",
      "H",
      "O",
    ]);
    expect(molfile.split("\n")[8].slice(0, 12)).toBe("  1  3  1  1");
    const parsed = Molecule.fromMolfile(molfile);
    expect(parsed.getAllAtoms()).toBe(3);
    expect(parsed.getAllBonds()).toBe(2);
  });
  it("round-trips charges and isotope masses in chemistry export", () => {
    const molecule = importMolecule("[13CH3][NH3+]");
    const exported = exportMoleculeMolfile(molecule);
    expect(exported).toContain("M  CHG");
    expect(exported).toContain("M  ISO");
    const parsed = importMolecule(exported, "molfile");
    expect(
      parsed.atoms.some((a) => a.element === "C" && a.isotope === 13),
    ).toBe(true);
    expect(parsed.atoms.some((a) => a.element === "N" && a.charge === 1)).toBe(
      true,
    );
    expect(exportMoleculeSmiles(parsed)).toBe(exportMoleculeSmiles(molecule));
  });
  it("reports malformed references, duplicate numbering, and implausible valence", () => {
    const carbon = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    let molecule = carbon.document;
    for (let i = 0; i < 5; i++) {
      const added = addMoleculeAtom(molecule, "H", i * 20, 48);
      molecule = addMoleculeBond(added.document, carbon.atom.id, added.atom.id);
    }
    expect(moleculeValenceWarnings(molecule)).toEqual([
      "C1: check valence (5).",
    ]);
    const broken = {
      ...molecule,
      atoms: molecule.atoms.map((a) => ({ ...a, index: 1 })),
      bonds: [
        ...molecule.bonds,
        { id: "bad", from: carbon.atom.id, to: "missing", order: 1 as const },
      ],
    };
    expect(validateMolecule(broken)).toContain(
      "A bond references a missing atom.",
    );
    expect(validateMolecule(broken)).toContain(
      "Atom assignment numbers must be unique positive integers.",
    );
    expect(() => exportMoleculeMolfile(broken)).toThrow(/missing atom/);
  });
  it("preserves tetrahedral and alkene stereochemistry through structure exchange", () => {
    for (const smiles of ["N[C@@H](C)C(=O)O", "F/C=C/F", "F/C=C\\F"]) {
      const structure = importMolecule(smiles);
      const parsed = importMolecule(
        exportMoleculeMolfile(structure),
        "molfile",
      );
      expect(exportMoleculeSmiles(parsed)).toBe(
        exportMoleculeSmiles(structure),
      );
    }
  });
  it("exports defined wedges as absolute stereochemistry and retains it when cleaning", () => {
    for (const smiles of [
      "CC[C@H](O)C",
      "N[C@@H](C)C(=O)O",
      "[2H][C@H](C)[C@H](O)C",
      "F/C=C/F",
      "F/C=C\\F",
    ]) {
      const original = importMolecule(smiles);
      const expected = Molecule.fromSmiles(smiles).toIsomericSmiles();
      const cleaned = cleanMolecule(original);
      expect(exportMoleculeSmiles(cleaned)).toBe(expected);
      expect(
        Molecule.fromMolfile(exportMoleculeMolfile(cleaned)).toIsomericSmiles(),
      ).toBe(expected);
      expect(
        cleaned.atoms.map((a) => [
          a.id,
          a.index,
          a.element,
          a.charge,
          a.isotope,
        ]),
      ).toEqual(
        original.atoms.map((a) => [
          a.id,
          a.index,
          a.element,
          a.charge,
          a.isotope,
        ]),
      );
      expect(cleaned.bonds.map((b) => b.id)).toEqual(
        original.bonds.map((b) => b.id),
      );
      if (
        original.bonds.some((b) => b.stereo === "wedge" || b.stereo === "dash")
      )
        expect(
          Number(exportMoleculeMolfile(cleaned).split("\n")[3].slice(12, 15)),
        ).toBe(1);
    }
  });
  it("keeps ordinary explicit hydrogens when importing SMILES and cleaning", () => {
    const original = importMolecule("[H]C([H])([H])O[H]");
    expect(original.atoms.filter((a) => a.element === "H")).toHaveLength(4);
    expect(original.atoms).toHaveLength(6);
    const cleaned = cleanMolecule(original);
    expect(cleaned.atoms.map((a) => a.id)).toEqual(
      original.atoms.map((a) => a.id),
    );
    expect(cleaned.bonds.map((b) => b.id)).toEqual(
      original.bonds.map((b) => b.id),
    );
    expect(
      cleaned.atoms.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)),
    ).toBe(true);
  });
  it("does not warn about normal aromatic fused carbons or heteroatoms", () => {
    expect(moleculeValenceWarnings(importMolecule("c1ccc2ccccc2c1"))).toEqual(
      [],
    );
    expect(moleculeValenceWarnings(importMolecule("c1ccoc1"))).toEqual([]);
  });
  it("resolves all-single aromatic drawing tools into portable Kekulé bonds", () => {
    const ring = addMoleculeRing(emptyMolecule(), 0, 0, 6, true);
    const aromatic = {
      ...ring,
      bonds: ring.bonds.map((b) => ({ ...b, order: 1 as const })),
    };
    const graph = moleculeGraph({
      molfile: exportMoleculeMolfile(aromatic),
      aromaticBonds: exportPredictionAromaticBonds(aromatic),
    });
    expect(graph.atoms.filter((a) => a.element === "H")).toHaveLength(6);
    expect(graph.bonds.filter((b) => b[2] === 4)).toHaveLength(6);
    expect(exportMoleculeSmiles(aromatic)).toBe("c1ccccc1");
  });
  it("preserves caffeine's raw aromatic input through the editor and exact CDK fixture environments", () => {
    const smiles = "Cn1c(=O)c2c(ncn2C)n(C)c1=O";
    const document = importMolecule(smiles);
    const molfile = exportMoleculeMolfile(document);
    const graph = moleculeGraph({
      molfile,
      aromaticBonds: exportPredictionAromaticBonds(document),
    });
    const normalizeBonds = (bonds: number[][]) =>
      bonds
        .map(([a, b, order]) => [Math.min(a, b), Math.max(a, b), order])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const fixtures = [...protonFixtures, ...carbonFixtures].filter(
      (f) => f.smiles === smiles,
    );
    expect(fixtures).toHaveLength(2);
    for (const fixture of fixtures) {
      expect(
        graph.atoms.map(
          ({ atomIndex: _atomIndex, parentIndex: _parentIndex, ...atom }) =>
            atom,
        ),
      ).toEqual(fixture.atoms);
      expect(normalizeBonds(graph.bonds)).toEqual(
        normalizeBonds(fixture.bonds),
      );
      for (const prediction of fixture.predictions)
        expect(generateHoseCode(graph, prediction.atom)).toBe(prediction.hose);
    }
    // Portable exchange retains chemistry while prediction keeps original notation separately.
    expect(exportMoleculeSmiles(importMolecule(molfile, "molfile"))).toBe(
      exportMoleculeSmiles(document),
    );
  });
  it("rejects empty/invalid input without returning a document", () => {
    expect(() => importMolecule("")).toThrow(/Enter a structure/);
    expect(() => importMolecule("C1CCCC")).toThrow();
    expect(() => importMolecule("not a molfile", "molfile")).toThrow();
  });
});
