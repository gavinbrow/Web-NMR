import { it, expect } from "vitest";
import { Molecule } from "openchemlib";
import { hydrogenEquivalence } from "./stereotopicHydrogens";
it("separates chiral-neighbour CH₂ and alkene H while retaining methyl/enantiotopic equivalence", () => {
  const ethanol = hydrogenEquivalence(Molecule.fromSmiles("CCO").toMolfile());
  expect(new Set(ethanol.get(0)!.map((h) => h.key)).size).toBe(1);
  expect(new Set(ethanol.get(1)!.map((h) => h.key)).size).toBe(1);
  const chiral = hydrogenEquivalence(
    Molecule.fromSmiles("CC[C@H](O)C").toMolfile(),
  );
  expect(chiral.get(1)).toHaveLength(2);
  expect(new Set(chiral.get(1)!.map((h) => h.key)).size).toBe(2);
  const alkene = hydrogenEquivalence(Molecule.fromSmiles("C=CC").toMolfile());
  expect(new Set(alkene.get(0)!.map((h) => h.key)).size).toBe(2);
});
