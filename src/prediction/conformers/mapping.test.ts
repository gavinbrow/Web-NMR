import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Molecule } from "openchemlib";
import {
  addMoleculeAtom,
  addMoleculeBond,
  cleanMolecule,
  emptyMolecule,
  exportMoleculeMolfile,
  exportMoleculeSmiles,
  importMolecule,
  moleculeChanged,
} from "../../features/molecule";
import { parseEnsemble } from "./ensemble";
import type { ConformerModule } from "./types";
import fixtures from "./parity-fixtures.json";

let module: ConformerModule;
beforeAll(async () => {
  const url = new URL(
    "../../../public/prediction/conformers/WebNMRConformers.mjs",
    import.meta.url,
  );
  const { default: initialize } = await import(/* @vite-ignore */ url.href);
  module = await initialize({
    wasmBinary: await readFile(
      fileURLToPath(new URL("WebNMRConformers.wasm", url)),
    ),
  });
}, 30000);
const generate = (block: string) =>
  parseEnsemble(module.generate(block, 3, 0xf00d, () => {}));

describe("drawing and import mapping into real RDKit WASM", () => {
  it("retains a drawn explicit H between original heavy atom slots", () => {
    const carbon = addMoleculeAtom(emptyMolecule(), "C", 0, 0);
    const hydrogen = addMoleculeAtom(carbon.document, "H", 48, 0);
    const oxygen = addMoleculeAtom(hydrogen.document, "O", 0, 48);
    const drawing = addMoleculeBond(
      addMoleculeBond(oxygen.document, carbon.atom.id, hydrogen.atom.id),
      carbon.atom.id,
      oxygen.atom.id,
    );
    const ensemble = generate(exportMoleculeMolfile(drawing));
    expect(ensemble.atomicNumbers.slice(0, 3)).toEqual([6, 1, 8]);
    expect(ensemble.originalAtomIndices.slice(0, 3)).toEqual([0, 1, 2]);
    expect(ensemble.hydrogenParents[1]).toBe(0);
    expect(ensemble.originalAtomIndices.slice(3).every((i) => i === -1)).toBe(
      true,
    );
  });
  for (const name of [
    "alanine-R",
    "explicit-isotopic-chiral",
    "explicit-chiral-CH2",
    "mapped-chiral-CH2",
    "symmetric-multi-CH2",
    "aspirin",
  ]) {
    it(`preserves original graph, isotope and stereo identity through molfile import: ${name}`, () => {
      const fixture = fixtures.cases.find((f) => f.name === name)!;
      const original = generate(fixture.molfile);
      const drawing = importMolecule(fixture.molfile, "molfile");
      const roundTrip = generate(exportMoleculeMolfile(drawing));
      expect(drawing.atoms.map((a) => a.index)).toEqual(
        Array.from({ length: original.originalAtomCount }, (_, i) => i + 1),
      );
      expect(roundTrip.originalAtomIndices).toEqual(
        original.originalAtomIndices,
      );
      expect(roundTrip.atomicNumbers).toEqual(original.atomicNumbers);
      expect(roundTrip.atomIsotopes).toEqual(original.atomIsotopes);
      expect(roundTrip.hydrogenParents).toEqual(original.hydrogenParents);
      // Keys are canonical isotope substitution identities, independent of
      // atom maps, coordinate layout, or bond-list ordering.
      expect([...roundTrip.hydrogenSiteKeys].sort()).toEqual(
        [...original.hydrogenSiteKeys].sort(),
      );
      const normalize = (bonds: number[][]) =>
        bonds
          .map(
            ([a, b, order]) => `${Math.min(a, b)}:${Math.max(a, b)}:${order}`,
          )
          .sort();
      expect(normalize(roundTrip.bonds)).toEqual(normalize(original.bonds));
      const cleaned = cleanMolecule(drawing);
      const cleanEnsemble = generate(exportMoleculeMolfile(cleaned));
      expect(cleanEnsemble.originalAtomIndices).toEqual(
        original.originalAtomIndices,
      );
      expect(cleanEnsemble.atomIsotopes).toEqual(original.atomIsotopes);
      expect([...cleanEnsemble.hydrogenSiteKeys].sort()).toEqual(
        [...original.hydrogenSiteKeys].sort(),
      );
    }, 30000);
  }
  for (const smiles of [
    "CCO",
    "[H]C([H])([H])O[H]",
    "[H]c1ccccc1",
    "[2H][C@H](C)[C@H](O)C",
    "CC[C@H](O)C",
    "C/C=C/C",
    "C/C=C\\C",
    "CC(=O)Oc1ccccc1C(=O)O",
  ]) {
    it(`keeps source SMILES atom slots through depiction and native geometry: ${smiles}`, () => {
      const source = Molecule.fromSmiles(smiles, { noCoordinates: true });
      const expectedZ = Array.from({ length: source.getAllAtoms() }, (_, i) =>
        source.getAtomicNo(i),
      );
      const expectedIsotopes = Array.from(
        { length: source.getAllAtoms() },
        (_, i) => source.getAtomMass(i),
      );
      const drawing = importMolecule(smiles);
      const ensemble = generate(exportMoleculeMolfile(drawing));
      expect(ensemble.atomicNumbers.slice(0, expectedZ.length)).toEqual(
        expectedZ,
      );
      expect(ensemble.atomIsotopes.slice(0, expectedZ.length)).toEqual(
        expectedIsotopes,
      );
      expect(ensemble.originalAtomIndices.slice(0, expectedZ.length)).toEqual(
        expectedZ.map((_, i) => i),
      );
      const sourceCanonical = source.toIsomericSmiles();
      const roundTripCanonical = Molecule.fromMolfile(
        exportMoleculeMolfile(drawing),
      ).toIsomericSmiles();
      expect(roundTripCanonical).toBe(sourceCanonical);
      const cleaned = cleanMolecule(drawing);
      expect(exportMoleculeSmiles(cleaned)).toBe(sourceCanonical);
      expect(
        Molecule.fromMolfile(exportMoleculeMolfile(cleaned)).toIsomericSmiles(),
      ).toBe(sourceCanonical);
      const cleanEnsemble = generate(exportMoleculeMolfile(cleaned));
      expect([...cleanEnsemble.hydrogenSiteKeys].sort()).toEqual(
        [...ensemble.hydrogenSiteKeys].sort(),
      );
      expect(cleanEnsemble.originalAtomIndices).toEqual(
        ensemble.originalAtomIndices,
      );
      const edited = moleculeChanged({
        ...cleaned,
        atoms: cleaned.atoms.map((a) => ({ ...a, x: a.x + 17, y: a.y - 12 })),
      });
      const editedEnsemble = generate(exportMoleculeMolfile(edited));
      expect([...editedEnsemble.hydrogenSiteKeys].sort()).toEqual(
        [...ensemble.hydrogenSiteKeys].sort(),
      );
    }, 30000);
  }
});
