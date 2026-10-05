import { beforeEach, describe, expect, it, vi } from "vitest";
import { importMolecule } from "../features/molecule";
import { assembleTwoDCorrelations, predictTwoDMolecule } from "./twoDClient";
import { predictMolecule } from "./client";
import type { PredictedAtomShift, PredictionResult } from "./types";
vi.mock("./client", () => ({ predictMolecule: vi.fn() }));

export function testShift(
  atomIndex: number,
  shiftPpm: number,
  hydrogenCount = 1,
  element: "H" | "C" = "H",
  explicitAtomIndex?: number,
  atomLabel?: string,
): PredictedAtomShift {
  return {
    atomIndex,
    shiftPpm,
    hydrogenCount,
    element,
    explicitAtomIndex,
    atomLabel,
    sampleCount: 10,
    minPpm: shiftPpm,
    maxPpm: shiftPpm,
    radius: 1,
    hoseCode: "fixture",
  };
}
export function testResult(
  shifts: PredictedAtomShift[],
  nucleus: "1H" | "13C" = "1H",
): PredictionResult {
  return {
    shifts,
    nucleus,
    engine: "cdk-hose-nmrshiftdb",
    warnings: [],
    dataset: "independent topology fixture",
    targetAtomCount: shifts.length,
    missingAtomCount: 0,
  };
}
const ethanol = importMolecule("CCO");
const protons = testResult([
  testShift(0, 1.2, 3),
  testShift(1, 3.4, 1, "H", 6, "Ha"),
  testShift(1, 3.7, 1, "H", 7, "Hb"),
  testShift(2, 2.5),
]);
const carbons = testResult(
  [testShift(0, 18, 1, "C"), testShift(1, 58, 1, "C")],
  "13C",
);
const input = {
  experiment: "HSQC" as const,
  nucleus: "1H" as const,
  frequencyMHz: 400,
  molecule: ethanol,
};
function learned(): PredictionResult {
  const shifts = [
    testShift(0, 1.2, 1, "H", 3),
    testShift(1, 3.4, 1, "H", 6, "Ha"),
    testShift(1, 3.7, 1, "H", 7, "Hb"),
    testShift(2, 2.5, 1, "H", 8),
  ];
  const result = { ...testResult(shifts), engine: "cascade" as const };
  result.spinSystem = {
    sites: shifts.map((s, i) => ({
      id: `H:${s.explicitAtomIndex}`,
      explicitAtomIndex: s.explicitAtomIndex!,
      atomIndex: s.atomIndex,
      hydrogenOrdinal: i,
      atomLabel: s.atomLabel ?? "H",
      shiftPpm: s.shiftPpm,
      equivalenceKey: String(i),
      exchangeable: s.atomIndex === 2,
    })),
    couplings: [
      {
        siteIdA: "H:6",
        siteIdB: "H:7",
        jHz: -12,
        predictedJHz: -12,
        modelStdHz: 0.2,
        bondDistance: 2,
        source: "fullsspruce",
      },
      {
        siteIdA: "H:3",
        siteIdB: "H:6",
        jHz: -7,
        predictedJHz: -7,
        modelStdHz: 0.2,
        bondDistance: 3,
        source: "fullsspruce",
      },
      {
        siteIdA: "H:3",
        siteIdB: "H:7",
        jHz: 0,
        predictedJHz: 7,
        modelStdHz: 0.2,
        bondDistance: 3,
        source: "manual",
      },
      {
        siteIdA: "H:6",
        siteIdB: "H:8",
        jHz: 5,
        predictedJHz: 5,
        modelStdHz: 0.2,
        bondDistance: 3,
        source: "fullsspruce",
      },
    ],
    model: {
      modelId: "fixture",
      weightsSha256: "0".repeat(64),
      sourceSha256: "0".repeat(64),
      upstreamRevision: "fixture",
      citation: "fixture",
      rdkitVersion: "fixture",
      excludedProtonPairs: 0,
    },
    display: {
      mode: "first-order",
      frequencyMHz: 400,
      clusters: [],
      warnings: [],
    },
  };
  return result;
}
beforeEach(() => vi.mocked(predictMolecule).mockReset());

describe("atom-linked HSQC correlations", () => {
  it("links only directly attached carbon and preserves Ha/Hb original IDs", () => {
    const result = assembleTwoDCorrelations(input, protons, ethanol, carbons);
    expect(result.twoD!.correlations).toHaveLength(3);
    expect(result.twoD!.correlations.map((c) => [c.xPpm, c.yPpm])).toEqual([
      [1.2, 18],
      [3.4, 58],
      [3.7, 58],
    ]);
    expect(result.twoD!.correlations.map((c) => c.atomIdX)).toEqual([
      ethanol.atoms[0].id,
      ethanol.atoms[1].id,
      ethanol.atoms[1].id,
    ]);
    expect(result.twoD!.correlations[1].siteIdX).not.toBe(
      result.twoD!.correlations[2].siteIdX,
    );
    expect(result.twoD!.correlations[1].protonLabelX).toContain("Ha");
    expect(result.twoD!.correlations.every((c) => c.sign === 1)).toBe(true);
  });
  it("edits CH2 negative and CH3 positive using topology, not shift line count", () => {
    const result = assembleTwoDCorrelations(
      { ...input, hsqcEdited: true },
      protons,
      ethanol,
      carbons,
    );
    expect(result.twoD!.correlations.map((c) => c.sign)).toEqual([1, -1, -1]);
    expect(result.twoD!.correlations[0].weight).toBe(3);
    expect(result.twoD!.warnings.join(" ")).toContain("illustrative");
  });
  it("maps original explicit H to its carbon instead of treating H index as parent", () => {
    const molecule = importMolecule("C([H])([H])([H])O");
    const h = molecule.atoms.findIndex((a) => a.element === "H"),
      c = molecule.atoms.findIndex((a) => a.element === "C");
    const result = assembleTwoDCorrelations(
      input,
      testResult([testShift(h, 3.2)]),
      molecule,
      testResult([testShift(c, 52, 1, "C")], "13C"),
    );
    expect(result.twoD!.correlations[0]).toMatchObject({
      atomIndexX: h,
      atomIndexY: c,
      atomIdX: molecule.atoms[h].id,
      atomIdY: molecule.atoms[c].id,
    });
  });
  it("omits unsupported carbon shifts and unprotonated carbon instead of a Cartesian product", () => {
    const result = assembleTwoDCorrelations(
      input,
      protons,
      ethanol,
      testResult([carbons.shifts[0]], "13C"),
    );
    expect(result.twoD!.correlations).toHaveLength(1);
    expect(result.twoD!.warnings.join(" ")).toContain("absent");
    const acetone = importMolecule("CC(=O)C");
    const acetoneResult = assembleTwoDCorrelations(
      input,
      testResult([testShift(0, 2.1, 3), testShift(3, 2.1, 3)]),
      acetone,
      testResult(
        [
          testShift(0, 30, 1, "C"),
          testShift(1, 205, 1, "C"),
          testShift(3, 30, 1, "C"),
        ],
        "13C",
      ),
    );
    expect(acetoneResult.twoD!.correlations.map((c) => c.atomIndexY)).toEqual([
      0, 3,
    ]);
  });
  it("excludes explicit deuterium from proton correlations and multiplicity editing", () => {
    const molecule = importMolecule("C([2H])([H])([H])O");
    const c = molecule.atoms.findIndex((a) => a.element === "C");
    const hydrogenIndices = molecule.atoms.flatMap((a, i) =>
      a.element === "H" ? [i] : [],
    );
    const result = assembleTwoDCorrelations(
      { ...input, hsqcEdited: true },
      testResult(hydrogenIndices.map((h, i) => testShift(h, 3.2 + i * 0.1))),
      molecule,
      testResult([testShift(c, 52, 1, "C")], "13C"),
    );
    expect(result.twoD!.correlations).toHaveLength(2);
    expect(
      result.twoD!.correlations.every(
        (correlation) =>
          molecule.atoms[correlation.atomIndexX].isotope !== 2 &&
          correlation.sign === -1,
      ),
    ).toBe(true);
  });
});
describe("scalar-coupled COSY topology", () => {
  it("has diagonals and symmetric signed-J cross peaks, excludes zero J and exchangeable transfer", () => {
    const result = assembleTwoDCorrelations(
      { ...input, experiment: "COSY", cosyMinJHz: 0 },
      learned(),
      ethanol,
    );
    const correlations = result.twoD!.correlations,
      cross = correlations.filter((c) => c.kind === "cross");
    expect(correlations.filter((c) => c.kind === "diagonal")).toHaveLength(4);
    expect(cross).toHaveLength(4);
    expect(cross.every((c) => c.sign === 1 && c.jHz! < 0)).toBe(true);
    expect(cross.some((c) => c.atomIndexX === 2 || c.atomIndexY === 2)).toBe(
      false,
    );
    for (const c of cross)
      expect(cross).toContainEqual(
        expect.objectContaining({
          xPpm: c.yPpm,
          yPpm: c.xPpm,
          atomIdX: c.atomIdY,
          atomIdY: c.atomIdX,
          siteIdX: c.siteIdY,
          siteIdY: c.siteIdX,
          weight: c.weight,
          jHz: c.jHz,
        }),
      );
    expect(cross.filter((c) => c.atomIndexX === c.atomIndexY)).toHaveLength(2); // Ha/Hb geminal
  });
  it("uses absolute-J cutoff while preserving the signed value", () => {
    const result = assembleTwoDCorrelations(
      { ...input, experiment: "COSY", cosyMinJHz: 8 },
      learned(),
      ethanol,
    );
    expect(
      result
        .twoD!.correlations.filter((c) => c.kind === "cross")
        .map((c) => c.jHz),
    ).toEqual([-12, -12]);
  });
  it("does not invent a resolved cross peak between chemically equivalent proton sites", () => {
    const equivalent = learned();
    equivalent.spinSystem!.sites[1].equivalenceKey =
      equivalent.spinSystem!.sites[2].equivalenceKey;
    const result = assembleTwoDCorrelations(
      { ...input, experiment: "COSY" },
      equivalent,
      ethanol,
    );
    expect(
      result.twoD!.correlations.filter((c) => c.kind === "cross"),
    ).toHaveLength(2);
    expect(
      result.twoD!.correlations.some(
        (c) => c.kind === "cross" && c.atomIndexX === c.atomIndexY,
      ),
    ).toBe(false);
  });
  it("uses honest CDK estimates and honors zero manual overrides", () => {
    const grouped = testResult([
      testShift(0, 1.2, 3),
      testShift(1, 3.4, 2),
      testShift(2, 2.5),
    ]);
    const result = assembleTwoDCorrelations(
      { ...input, experiment: "COSY" },
      grouped,
      ethanol,
    );
    expect(
      result.twoD!.correlations.filter((c) => c.kind === "cross"),
    ).toHaveLength(2);
    expect(
      result
        .twoD!.correlations.filter((c) => c.kind === "cross")
        .every((c) => c.source === "estimate"),
    ).toBe(true);
    const zero = assembleTwoDCorrelations(
      {
        ...input,
        experiment: "COSY",
        couplingOverrides: [
          {
            atomIdA: ethanol.atoms[0].id,
            atomIdB: ethanol.atoms[1].id,
            jHz: 0,
          },
        ],
      },
      grouped,
      ethanol,
    );
    expect(
      zero.twoD!.correlations.filter((c) => c.kind === "cross"),
    ).toHaveLength(0);
  });
  it("rejects invalid field/cutoff and incomplete learned J identities", () => {
    expect(() =>
      assembleTwoDCorrelations(
        { ...input, cosyMinJHz: -1 },
        protons,
        ethanol,
        carbons,
      ),
    ).toThrow("minimum J");
    expect(() =>
      assembleTwoDCorrelations(
        { ...input, frequencyMHz: Infinity },
        protons,
        ethanol,
        carbons,
      ),
    ).toThrow("field");
    const invalid = learned();
    invalid.spinSystem!.couplings[0].siteIdA = "missing";
    expect(() =>
      assembleTwoDCorrelations(
        { ...input, experiment: "COSY" },
        invalid,
        ethanol,
      ),
    ).toThrow("mapping");
  });
});
describe("2D browser prediction orchestration", () => {
  it("requests H and C shifts at the proper field ratio for HSQC", async () => {
    vi.mocked(predictMolecule)
      .mockResolvedValueOnce(protons)
      .mockResolvedValueOnce(carbons);
    const result = await predictTwoDMolecule(input);
    expect(result.twoD!.carbonResult).toBe(carbons);
    expect(
      vi
        .mocked(predictMolecule)
        .mock.calls.map(([value]) => [
          value.nucleus,
          value.frequencyMHz,
          value.splitting,
        ]),
    ).toEqual([
      ["1H", 400, "none"],
      ["13C", 100.58, "none"],
    ]);
  });
  it("forces first-order learned J inference for COSY even if exact splitting was selected", async () => {
    vi.mocked(predictMolecule).mockResolvedValueOnce(learned());
    await predictTwoDMolecule({
      ...input,
      experiment: "COSY",
      engine: "cascade",
      splitting: "spin-system",
    });
    expect(predictMolecule).toHaveBeenCalledTimes(1);
    expect(vi.mocked(predictMolecule).mock.calls[0][0]).toMatchObject({
      nucleus: "1H",
      splitting: "first-order",
    });
  });
  it("stops before carbon inference when canceled after proton inference", async () => {
    const controller = new AbortController();
    vi.mocked(predictMolecule).mockImplementationOnce(async () => {
      controller.abort();
      return protons;
    });
    await expect(
      predictTwoDMolecule(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(predictMolecule).toHaveBeenCalledTimes(1);
  });
  it("rejects stale drawing atom mappings before invoking the prediction worker", async () => {
    await expect(
      predictTwoDMolecule({ ...input, smiles: "COC" }),
    ).rejects.toThrow("atom mapping");
    expect(predictMolecule).not.toHaveBeenCalled();
  });
});
