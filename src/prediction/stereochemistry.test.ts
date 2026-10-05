import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Molecule } from "openchemlib";
import { exportMoleculeMolfile, importMolecule } from "../features/molecule";
import {
  enumerateStereoMixture,
  representativeStereo,
  stereoCenters,
  stereoDoubleBonds,
  drawingStereochemistry,
} from "./stereochemistry";
import { parseEnsemble } from "./conformers/ensemble";
import type { ConformerModule } from "./conformers/types";
let wasm: ConformerModule;
beforeAll(async () => {
  const url = new URL(
    "../../public/prediction/conformers/WebNMRConformers.mjs",
    import.meta.url,
  );
  const { default: init } = await import(/* @vite-ignore */ url.href);
  wasm = await init({
    wasmBinary: await readFile(new URL("WebNMRConformers.wasm", url)),
  });
}, 30000);
const block = (smiles: string) => exportMoleculeMolfile(importMolecule(smiles));
describe("undefined stereochemistry mixtures", () => {
  it("uses representative labels only for unchanged, unspecified centers", () => {
    const undefinedBlock = block("CCC(O)C"),
      selected = representativeStereo(undefinedBlock).molfile;
    const assumed = drawingStereochemistry(undefinedBlock, selected);
    expect(assumed.assumedAtomIndices).toEqual([2]);
    expect(assumed.centers[0].defined).toBe(true);
    const drawn = block("CC[C@H](O)C");
    expect(drawingStereochemistry(drawn, selected).centers).toEqual(
      stereoCenters(drawn),
    );
    expect(drawingStereochemistry(drawn, selected).assumedAtomIndices).toEqual(
      [],
    );
    const different = block("CC(O)CC");
    expect(drawingStereochemistry(different, selected).centers).toEqual(
      stereoCenters(different),
    );
    expect(
      drawingStereochemistry(different, selected).assumedAtomIndices,
    ).toEqual([]);
  });
  it("assigns absolute R/S labels and keeps undefined centers unlabelled", () => {
    expect(stereoCenters(block("CC[C@H](O)C"))[0].label).toBe("R");
    expect(stereoCenters(block("CC[C@@H](O)C"))[0].label).toBe("S");
    expect(stereoCenters(block("CCC(O)C"))[0].defined).toBe(false);
  });
  it("labels stereogenic double bonds by CIP, excluding terminal and aromatic bonds", () => {
    expect(stereoDoubleBonds(block("C/C=C/C"))).toEqual([
      { atomIndices: [1, 2], label: "E" },
    ]);
    expect(stereoDoubleBonds(block("C/C=C\\C"))).toEqual([
      { atomIndices: [1, 2], label: "Z" },
    ]);
    expect(stereoDoubleBonds(block("C=C"))).toEqual([]);
    expect(stereoDoubleBonds(block("c1ccccc1"))).toEqual([]);
    // Higher-priority halogens change the CIP descriptor even with the same backbone geometry.
    expect(stereoDoubleBonds(block("C/C(Cl)=C/C"))[0].label).toBe("Z");
  });
  it("marks a genuine undefined center but not an achiral branch", () => {
    expect(stereoCenters(block("CCC(O)C"))).toEqual([
      {
        atomIndex: 2,
        defined: false,
        label: "undefined · representative chosen",
      },
    ]);
    expect(stereoCenters(block("CC(O)C"))).toEqual([]);
    expect(stereoCenters(block("CC[C@H](O)C"))[0].defined).toBe(true);
  });
  it("generates a 50/50 pair that actual RDKit can embed without alignment errors", () => {
    const source = block("CCC(O)C");
    const mixture = enumerateStereoMixture(source);
    expect(mixture.atomIndices).toEqual([2]);
    expect(mixture.variants.map((v) => v.weight)).toEqual([0.5, 0.5]);
    expect(
      new Set(
        mixture.variants.map((v) =>
          Molecule.fromMolfile(v.molfile).toIsomericSmiles(),
        ),
      ).size,
    ).toBe(2);
    for (const v of mixture.variants) {
      expect(enumerateStereoMixture(v.molfile).variants).toHaveLength(1);
      expect(stereoCenters(v.molfile).every((c) => c.defined)).toBe(true);
      const ensemble = parseEnsemble(
        wasm.generate(v.molfile, 10, 0xf00d, () => {}),
      );
      expect(ensemble.originalAtomIndices.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
      expect(ensemble.conformers.length).toBeGreaterThan(0);
      expect(ensemble.hydrogenAlignmentWarnings).toEqual([]);
    }
  }, 30000);
  it("enumerates all configurations of two unknown centers without changing defined ones", () => {
    const mixture = enumerateStereoMixture(block("CC(O)C(O)CC[C@H](F)C"));
    expect(mixture.variants).toHaveLength(4);
    expect(mixture.variants.map((v) => v.weight)).toEqual([
      0.25, 0.25, 0.25, 0.25,
    ]);
    const defined = stereoCenters(block("CC(O)C(O)CC[C@H](F)C")).find(
      (c) => c.defined,
    )!;
    for (const v of mixture.variants) {
      expect(
        stereoCenters(v.molfile).find((c) => c.atomIndex === defined.atomIndex)
          ?.label,
      ).toBe(defined.label);
      expect(enumerateStereoMixture(v.molfile).variants).toHaveLength(1);
    }
  });
  it("keeps explicit H and isotope-defined atom slots in source order", () => {
    const doc = importMolecule("[H]C([2H])(O)CC"),
      source = exportMoleculeMolfile(doc);
    for (const v of enumerateStereoMixture(source).variants) {
      const ensemble = parseEnsemble(
        wasm.generate(v.molfile, 10, 0xf00d, () => {}),
      );
      expect(ensemble.atomicNumbers.slice(0, doc.atoms.length)).toEqual(
        doc.atoms.map((a) => Molecule.getAtomicNoFromLabel(a.element)),
      );
      expect(
        ensemble.atomIsotopes[doc.atoms.findIndex((a) => a.isotope === 2)],
      ).toBe(2);
      expect(ensemble.originalAtomIndices.slice(0, doc.atoms.length)).toEqual(
        doc.atoms.map((_, i) => i),
      );
    }
  }, 30000);
  it("selects one deterministic embeddable isomer while preserving defined stereocenters and atom mapping", () => {
    const source = block("CC(O)C(O)CC[C@H](F)C");
    const selected = representativeStereo(source);
    expect(representativeStereo(source)).toEqual(selected);
    expect(selected.atomIndices).toHaveLength(2);
    const defined = stereoCenters(source).find((c) => c.defined)!;
    expect(stereoCenters(selected.molfile).every((c) => c.defined)).toBe(true);
    expect(
      stereoCenters(selected.molfile).find(
        (c) => c.atomIndex === defined.atomIndex,
      )?.label,
    ).toBe(defined.label);
    expect(representativeStereo(selected.molfile).atomIndices).toEqual([]);
    const doc = importMolecule(source, "molfile");
    const e = parseEnsemble(
      wasm.generate(selected.molfile, 3, 0xf00d, () => {}),
    );
    expect(e.hydrogenAlignmentWarnings).toEqual([]);
    expect(e.originalAtomIndices.slice(0, doc.atoms.length)).toEqual(
      doc.atoms.map((_, i) => i),
    );
  }, 30000);
});
