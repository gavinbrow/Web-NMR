import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { boltzmannWeights, parseEnsemble, RT_KCAL } from "./ensemble";
import type { ConformerModule, Coordinates, ConformerEnsemble } from "./types";
import fixtures from "./parity-fixtures.json";
let module: ConformerModule;
beforeAll(async () => {
  const glueUrl = new URL(
    "../../../public/prediction/conformers/WebNMRConformers.mjs",
    import.meta.url,
  );
  // Keep the generated Emscripten loader outside Vite's source transforms.
  const { default: initialize } = await import(/* @vite-ignore */ glueUrl.href);
  const wasmBinary = await readFile(
    fileURLToPath(new URL("WebNMRConformers.wasm", glueUrl)),
  );
  module = await initialize({ wasmBinary });
}, 30000);
function distance(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
// A methyl group's three indistinguishable hydrogens can rotate by 120 degrees
// during platform-dependent minimization. Only these chemically equivalent
// hydrogens may permute. All heavy and stereotopic hydrogen indices stay fixed.
function methylSymmetryMapping(
  ensemble: ConformerEnsemble,
  coordinates: Coordinates,
  reference: number[][],
): number[] {
  const mapping = ensemble.atomicNumbers.map((_, index) => index);
  for (let parent = 0; parent < ensemble.atomicNumbers.length; parent++) {
    if (ensemble.atomicNumbers[parent] !== 6) continue;
    const hs = ensemble.hydrogenParents.flatMap((p, i) =>
      p === parent ? [i] : [],
    );
    if (hs.length !== 3) continue;
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    let best = permutations[0],
      minimum = Infinity;
    for (const permutation of permutations) {
      let error = 0;
      for (let h = 0; h < 3; h++)
        for (let atom = 0; atom < ensemble.atomicNumbers.length; atom++) {
          if (ensemble.atomicNumbers[atom] === 1) continue;
          const delta =
            distance(coordinates[hs[h]], coordinates[atom]) -
            distance(reference[hs[permutation[h]]], reference[atom]);
          error += delta * delta;
        }
      if (error < minimum) {
        minimum = error;
        best = permutation;
      }
    }
    hs.forEach((index, h) => {
      mapping[index] = hs[best[h]];
    });
  }
  return mapping;
}
function signedChiralVolume(xyz: number[][], neighbors: number[]) {
  const v = neighbors
    .slice(0, 3)
    .map((atom) => xyz[atom].map((value, i) => value - xyz[neighbors[3]][i]));
  return (
    v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) -
    v[0][1] * (v[1][0] * v[2][2] - v[1][2] * v[2][0]) +
    v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0])
  );
}
describe("real RDKit WASM conformers", () => {
  for (const fixture of fixtures.cases) {
    it(`matches native ETKDGv3/MMFF94 for ${fixture.name}`, () => {
      const progress: string[] = [];
      const actual = parseEnsemble(
        module.generate(fixture.molfile, 10, 0xf00d, (stage) =>
          progress.push(stage),
        ),
      );
      expect(actual.rdkitVersion).toBe(fixtures.rdkitVersion);
      expect(actual.originalAtomCount).toBe(fixture.originalAtomCount);
      expect(actual.atomicNumbers).toEqual(fixture.atomicNumbers);
      expect(actual.atomIsotopes).toEqual(fixture.atomIsotopes);
      expect(actual.originalAtomIndices).toEqual(fixture.originalAtomIndices);
      expect(actual.hydrogenParents).toEqual(fixture.hydrogenParents);
      expect(actual.atomDescriptors).toEqual(fixture.atomDescriptors);
      expect(actual.bonds).toEqual(fixture.bonds);
      expect(actual.hydrogenSiteKeys).toEqual(fixture.hydrogenSiteKeys);
      expect(actual.hydrogenPairEquivalence).toEqual(
        fixture.hydrogenPairEquivalence,
      );
      expect(actual.hydrogenAlignmentWarnings).toEqual([]);
      for (let i = 0; i < actual.atomicNumbers.length; i++) {
        for (let j = 0; j < actual.atomicNumbers.length; j++) {
          expect(actual.boundsMatrix[i][j]).toBeCloseTo(
            fixture.boundsMatrix[i][j],
            8,
          );
        }
      }
      expect(actual.conformers.length).toBe(fixture.conformers.length);
      expect(progress).toContain("embedding");
      expect(progress.at(-1)).toBe("complete");
      for (let c = 0; c < actual.conformers.length; c++) {
        const conformer = actual.conformers[c];
        const reference = fixture.conformers[c];
        expect(
          Math.abs(conformer.energyKcal - reference.energyKcal),
        ).toBeLessThan(0.002);
        expect(conformer.converged).toBe(reference.converged);
        const mapping = methylSymmetryMapping(
          actual,
          conformer.coordinates,
          reference.coordinates,
        );
        for (let atom = 0; atom < actual.atomicNumbers.length; atom++) {
          if (!actual.atomDescriptors[atom].chiralTag) continue;
          const neighbors = actual.bonds.flatMap(([a, b]) =>
            a === atom ? [b] : b === atom ? [a] : [],
          );
          if (neighbors.length !== 4) continue;
          expect(
            Math.sign(signedChiralVolume(conformer.coordinates, neighbors)),
          ).toBe(
            Math.sign(signedChiralVolume(reference.coordinates, neighbors)),
          );
        }
        // Pairwise distances are independent of rigid orientation and prove
        // the optimized geometry, beyond merely checking sane bond lengths.
        for (let i = 0; i < actual.atomicNumbers.length; i++) {
          for (let j = 0; j < i; j++) {
            expect(
              Math.abs(
                distance(conformer.coordinates[i], conformer.coordinates[j]) -
                  distance(
                    reference.coordinates[mapping[i]],
                    reference.coordinates[mapping[j]],
                  ),
              ),
            ).toBeLessThan(0.003);
          }
        }
      }
      expect(
        actual.conformers.reduce((sum, c) => sum + c.weight, 0),
      ).toBeCloseTo(1, 14);
    }, 30000);
  }
  it("retains explicit isotope identity so D/T can be excluded from 1H inference", () => {
    const fixture = fixtures.cases.find(
      (fixture) => fixture.name === "explicit-isotopic-chiral",
    )!;
    const ensemble = parseEnsemble(
      module.generate(fixture.molfile, 10, 0xf00d, () => {}),
    );
    const deuterium = ensemble.atomIsotopes.findIndex(
      (isotope) => isotope === 2,
    );
    expect(deuterium).toBeGreaterThanOrEqual(0);
    expect(ensemble.atomicNumbers[deuterium]).toBe(1);
    expect(ensemble.originalAtomIndices[deuterium]).toBe(deuterium);
    expect(ensemble.atomIsotopes.filter((isotope) => isotope >= 2)).toEqual([
      2,
    ]);
  });
  it("distinguishes isotope-defined CH2 sites while merging only enantiotopic equivalents", () => {
    for (const [name, parent, count] of [
      ["ethanol", 1, 1],
      ["chiral-butanol-stereotopic-H", 1, 2],
      ["terminal-alkene", 0, 2],
    ] as const) {
      const fixture = fixtures.cases.find((fixture) => fixture.name === name)!;
      const ensemble = parseEnsemble(
        module.generate(fixture.molfile, 10, 0xf00d, () => {}),
      );
      const keys = ensemble.hydrogenSiteKeys.filter(
        (_, h) => ensemble.hydrogenParents[h] === parent,
      );
      expect(new Set(keys).size).toBe(count);
    }
  });
  it("aligns fully explicit CH2 imports without changing source atom slots", () => {
    const fixture = fixtures.cases.find(
      (fixture) => fixture.name === "explicit-chiral-CH2",
    )!;
    const ensemble = parseEnsemble(
      module.generate(fixture.molfile, 10, 0xf00d, () => {}),
    );
    expect(ensemble.originalAtomCount).toBe(ensemble.atomicNumbers.length);
    expect(ensemble.originalAtomIndices).toEqual(
      ensemble.atomicNumbers.map((_, i) => i),
    );
    const keys = ensemble.hydrogenSiteKeys.filter(
      (_, h) => ensemble.hydrogenParents[h] === 1,
    );
    expect(new Set(keys).size).toBe(2);
    expect(ensemble.hydrogenAlignmentWarnings).toEqual([]);
  });
  it("clears drawing atom-map numbers from stereochemical replacement keys", () => {
    const fixture = fixtures.cases.find(
      (fixture) => fixture.name === "mapped-chiral-CH2",
    )!;
    const ensemble = parseEnsemble(
      module.generate(fixture.molfile, 10, 0xf00d, () => {}),
    );
    expect(ensemble.originalAtomIndices.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    for (const key of ensemble.hydrogenSiteKeys)
      expect(key).not.toMatch(/:\d+/);
    const keys = ensemble.hydrogenSiteKeys.filter(
      (_, h) => ensemble.hydrogenParents[h] === 1,
    );
    expect(new Set(keys).size).toBe(2);
  });
  it("reproduces identical geometry with the same seed", () => {
    const block = fixtures.cases[1].molfile;
    expect(module.generate(block, 10, 0xf00d, () => {})).toBe(
      module.generate(block, 10, 0xf00d, () => {}),
    );
  });
  it("averages A3X2 ethyl pairs without erasing diastereotopic pair identity", () => {
    for (const [name, expected] of [
      ["ethanol", 1],
      ["chiral-butanol-stereotopic-H", 2],
    ] as const) {
      const fixture = fixtures.cases.find((fixture) => fixture.name === name)!;
      const ensemble = parseEnsemble(
        module.generate(fixture.molfile, 10, 0xf00d, () => {}),
      );
      const ethylPairs = ensemble.hydrogenPairEquivalence.filter(
        ({ atomIndices: [a, b] }) => {
          const parents = [
            ensemble.hydrogenParents[a],
            ensemble.hydrogenParents[b],
          ].sort();
          return parents[0] === 0 && parents[1] === 1;
        },
      );
      expect(ethylPairs).toHaveLength(6);
      expect(new Set(ethylPairs.map((p) => p.key)).size).toBe(expected);
    }
  });
  it("preserves AA′BB′ ortho/meta pair distinctions despite chemical equivalence", () => {
    const fixture = fixtures.cases.find(
      (fixture) => fixture.name === "AAprimeBBprime-para-chlorotoluene",
    )!;
    const ensemble = parseEnsemble(
      module.generate(fixture.molfile, 10, 0xf00d, () => {}),
    );
    const hydrogens = ensemble.atomicNumbers.flatMap((z, i) =>
      z === 1 && ensemble.atomDescriptors[ensemble.hydrogenParents[i]].aromatic
        ? [i]
        : [],
    );
    expect(hydrogens).toHaveLength(4);
    expect(
      new Set(hydrogens.map((i) => ensemble.hydrogenSiteKeys[i])).size,
    ).toBe(2);
    const aromaticPairs = ensemble.hydrogenPairEquivalence.filter((p) =>
      p.atomIndices.every((i) => hydrogens.includes(i)),
    );
    expect(aromaticPairs).toHaveLength(4);
    const counts = new Map<string, number>();
    for (const pair of aromaticPairs)
      counts.set(pair.key, (counts.get(pair.key) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 1, 2]);
  });
  it("excludes deuterium/tritium from learned proton pair equivalence", () => {
    const fixture = fixtures.cases.find(
      (fixture) => fixture.name === "explicit-isotopic-chiral",
    )!;
    const ensemble = parseEnsemble(
      module.generate(fixture.molfile, 10, 0xf00d, () => {}),
    );
    for (const pair of ensemble.hydrogenPairEquivalence) {
      expect(
        pair.atomIndices.every(
          (i) =>
            ensemble.atomicNumbers[i] === 1 && ensemble.atomIsotopes[i] < 2,
        ),
      ).toBe(true);
    }
  });
  it("reports invalid structures and unavailable MMFF parameters", () => {
    expect(() =>
      parseEnsemble(
        module.generate(fixtures.unsupportedMMFFMolfile, 10, 0xf00d, () => {}),
      ),
    ).toThrow("MMFF94 parameters unavailable");
    expect(() =>
      parseEnsemble(module.generate("not a molfile", 10, 0xf00d, () => {})),
    ).toThrow();
    expect(() =>
      parseEnsemble(
        module.generate(fixtures.cases[0].molfile, 11, 0xf00d, () => {}),
      ),
    ).toThrow("1 to 10");
  });
});
describe("Boltzmann ensemble weighting", () => {
  it("uses the reference 298.15 K factor and tolerates large absolute offsets", () => {
    const energies = [1e6, 1e6 + RT_KCAL * Math.log(2), 1e6 + 1e4];
    const weights = boltzmannWeights(energies);
    expect(weights[0]).toBeCloseTo(2 / 3, 9);
    expect(weights[1]).toBeCloseTo(1 / 3, 9);
    expect(weights[2]).toBe(0);
  });
  it("rejects missing and nonfinite energies", () => {
    expect(() => boltzmannWeights([])).toThrow();
    expect(() => boltzmannWeights([NaN])).toThrow();
    expect(() => boltzmannWeights([Infinity])).toThrow();
  });
});
