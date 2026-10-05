import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cascadeResult } from "./cascadeAdapter";
import { parseEnsemble } from "./conformers/ensemble";
import fixtures from "./conformers/parity-fixtures.json";
import type { ConformerEnsemble, ConformerModule } from "./conformers/types";
import type { CascadePrediction } from "./cascade/types";
import type { LearnedCouplingPrediction } from "./couplings/types";
import { importMolecule } from "../features/molecule";
import { predictedSpectrum } from "../features/predictedSpectrum";
import { defaultPredictionSetup } from "../features/predictionSetup";
let module: ConformerModule;
beforeAll(async () => {
  const url = new URL(
    "../../public/prediction/conformers/WebNMRConformers.mjs",
    import.meta.url,
  );
  const { default: initialize } = await import(/* @vite-ignore */ url.href);
  module = await initialize({
    wasmBinary: await readFile(
      fileURLToPath(new URL("WebNMRConformers.wasm", url)),
    ),
  });
}, 30000);
function ensemble(name: string) {
  const fixture = fixtures.cases.find((f) => f.name === name)!;
  return {
    fixture,
    ensemble: parseEnsemble(
      module.generate(fixture.molfile, 3, 0xf00d, () => {}),
    ),
  };
}
function output(
  e: ConformerEnsemble,
  nucleus: "1H" | "13C" = "1H",
): CascadePrediction {
  return {
    shifts: e.atomicNumbers.flatMap((z, atomIndex) =>
      z === (nucleus === "1H" ? 1 : 6)
        ? [
            {
              atomIndex,
              nucleus,
              shiftPpm:
                nucleus === "13C"
                  ? 20 + atomIndex
                  : e.hydrogenParents[atomIndex] === 0
                    ? 1.1 + atomIndex * 0.001
                    : e.hydrogenParents[atomIndex] === 1
                      ? 3.5 + atomIndex * 0.001
                      : 2.1,
              conformerStdDevPpm: 0.1,
            },
          ]
        : [],
    ),
    conformerWeights: e.conformers.map((c) => c.weight),
    conformerCount: e.conformers.length,
    temperatureKelvin: 298.15,
    backend: "fixture",
    models: [
      {
        id: nucleus === "1H" ? "proton-dftnn" : "carbon-expnn-ff",
        nucleus,
        lineage: "fixture",
        weightsSha256: "a".repeat(64),
        sourceSha256: "b".repeat(64),
        upstreamRevision: "fixture",
        citation: "fixture",
      },
    ],
  };
}
function learned(e: ConformerEnsemble): LearnedCouplingPrediction {
  const graph = e.atomicNumbers.map(() => [] as number[]);
  for (const [a, b] of e.bonds) {
    graph[a].push(b);
    graph[b].push(a);
  }
  const distance = (a: number, b: number) => {
    const seen = new Set([a]),
      queue = [{ atom: a, distance: 0 }];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].atom === b) return queue[i].distance;
      for (const atom of graph[queue[i].atom])
        if (!seen.has(atom)) {
          seen.add(atom);
          queue.push({ atom, distance: queue[i].distance + 1 });
        }
    }
    throw Error("Disconnected fixture pair");
  };
  return {
    couplings: e.hydrogenPairEquivalence.map(({ atomIndices: [a, b] }, i) => ({
      atomIndices: [a, b],
      couplingHz:
        distance(a, b) === 2 ? -12 : (distance(a, b) === 3 ? 6 : 1) + i * 0.1,
      stdHz: 0.3,
      bondDistance: distance(a, b) as 2 | 3 | 4,
    })),
    meanMatrixHz: new Float32Array(4096),
    stdMatrixHz: new Float32Array(4096),
    maxAtoms: 64,
    atomCount: e.atomicNumbers.length,
    backend: "wasm",
    metadata: {
      modelId: "fullsspruce-etkdg-coupling",
      sourceRepository: "fixture",
      upstreamRevision: "fixture",
      sourceSha256: "a".repeat(64),
      weightsSha256: "b".repeat(64),
      citation: "fixture",
      uncertainty: "fixture",
      trainedTypes: [],
      excludedProtonPairs: 0,
      warnings: [],
    },
  };
}
describe("CASCADE chemistry and spin-system integration", () => {
  it("averages all six ethyl vicinal pairs and reports actual triplet/quartet line counts", () => {
    const { fixture, ensemble: e } = ensemble("ethanol");
    const r = cascadeResult(
      { nucleus: "1H", splitting: "first-order", frequencyMHz: 400 },
      e,
      output(e),
      learned(e),
    );
    const pairs = r.spinSystem!.couplings.filter(
      (c) =>
        c.bondDistance === 3 &&
        [c.siteIdA, c.siteIdB].every(
          (id) => e.hydrogenParents[Number(id.slice(2))] < 2,
        ),
    );
    expect(pairs).toHaveLength(6);
    expect(new Set(pairs.map((c) => c.jHz)).size).toBe(1);
    const m = importMolecule(fixture.molfile, "molfile");
    const s = predictedSpectrum(
      r,
      {
        ...defaultPredictionSetup(),
        engine: "cascade",
        splitting: "first-order",
        molecule: m,
      },
      m,
    );
    expect(s.multiplets.map((p) => [p.kind, p.peakCount]).sort()).toEqual([
      ["q", 4],
      ["s", 1],
      ["t", 3],
    ]);
    expect(s.integrals.map((i) => i.predicted!.nucleusCount).sort()).toEqual([
      1, 2, 3,
    ]);
  });
  it("retains Ha/Hb and negative geminal J at a defined stereocenter", () => {
    const { ensemble: e } = ensemble("chiral-butanol-stereotopic-H");
    const r = cascadeResult(
      { nucleus: "1H", splitting: "spin-system", frequencyMHz: 400 },
      e,
      output(e),
      learned(e),
    );
    const ch2 = r.spinSystem!.sites.filter(
      (site) => e.hydrogenParents[site.explicitAtomIndex] === 1,
    );
    expect(ch2).toHaveLength(2);
    expect(ch2.map((site) => site.atomLabel)).toEqual(["Ha", "Hb"]);
    expect(ch2[0].equivalenceKey).not.toBe(ch2[1].equivalenceKey);
    expect(ch2[0].shiftPpm).not.toBe(ch2[1].shiftPpm);
    const geminal = r.spinSystem!.couplings.find(
      (c) =>
        ch2.some((h) => h.id === c.siteIdA) &&
        ch2.some((h) => h.id === c.siteIdB),
    );
    expect(geminal?.jHz).toBe(-12);
    expect(
      r
        .spinSystem!.display.clusters.flatMap((c) => c.lines)
        .reduce((n, line) => n + line.weight, 0),
    ).toBeCloseTo(r.shifts.length, 8);
  });
  it("keeps aromatic coupling classes distinct even when individual shifts are equivalent", () => {
    const { ensemble: e } = ensemble("AAprimeBBprime-para-chlorotoluene");
    const r = cascadeResult(
      { nucleus: "1H", splitting: "spin-system", frequencyMHz: 400 },
      e,
      output(e),
      learned(e),
    );
    const aromatic = new Set(
      r
        .spinSystem!.sites.filter(
          (site) =>
            e.atomDescriptors[e.hydrogenParents[site.explicitAtomIndex]]
              .aromatic,
        )
        .map((site) => site.id),
    );
    const pairs = r.spinSystem!.couplings.filter(
      (c) => aromatic.has(c.siteIdA) && aromatic.has(c.siteIdB),
    );
    expect(
      new Set(
        r
          .spinSystem!.sites.filter((site) => aromatic.has(site.id))
          .map((s) => s.equivalenceKey),
      ).size,
    ).toBe(2);
    expect(new Set(pairs.map((c) => c.equivalenceKey)).size).toBe(3);
    expect(
      pairs.filter((c) => c.bondDistance === 3).every((c) => c.jHz > 6),
    ).toBe(true);
    expect(
      pairs.filter((c) => c.bondDistance === 4).every((c) => c.jHz < 3),
    ).toBe(true);
  });
  it("omits D/T from proton sites and counts while keeping source atom indices", () => {
    const { ensemble: e } = ensemble("explicit-isotopic-chiral");
    const r = cascadeResult(
      { nucleus: "1H", splitting: "first-order" },
      e,
      output(e),
      learned(e),
    );
    expect(
      r.shifts.every((s) => e.atomIsotopes[s.explicitAtomIndex!] < 2),
    ).toBe(true);
    expect(r.shifts.reduce((n, s) => n + s.hydrogenCount, 0)).toBe(
      e.atomicNumbers.filter((z, i) => z === 1 && e.atomIsotopes[i] < 2).length,
    );
    expect(
      r.shifts
        .filter((s) => e.originalAtomIndices[s.explicitAtomIndex!] >= 0)
        .every(
          (s) => s.atomIndex === e.originalAtomIndices[s.explicitAtomIndex!],
        ),
    ).toBe(true);
  });
  it("keeps carbon decoupled and unsplit proton inference independent of the J model", () => {
    const { ensemble: e } = ensemble("ethanol");
    const c = cascadeResult({ nucleus: "13C" }, e, output(e, "13C"));
    expect(c.shifts).toHaveLength(2);
    expect(c.spinSystem).toBeUndefined();
    const h = cascadeResult({ nucleus: "1H", splitting: "none" }, e, output(e));
    expect(h.shifts).toHaveLength(6);
    expect(h.spinSystem).toBeUndefined();
  });
});
