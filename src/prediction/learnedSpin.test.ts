import { describe, it, expect } from "vitest";
import { renderLearnedSpinSystem } from "./learnedSpin";
import type { PredictedSpinSystem } from "./types";
const model = {
  modelId: "test",
  weightsSha256: "a".repeat(64),
  sourceSha256: "b".repeat(64),
  upstreamRevision: "test",
  citation: "test",
  rdkitVersion: "2025.09.1",
  excludedProtonPairs: 0,
};
function ab(): Omit<PredictedSpinSystem, "display"> {
  return {
    model,
    sites: [0, 1].map((i) => ({
      id: `H:${i}`,
      explicitAtomIndex: i,
      atomIndex: 0,
      hydrogenOrdinal: i,
      atomLabel: i ? "Hb" : "Ha",
      shiftPpm: 1.1 + i * 0.02,
      equivalenceKey: `diastereomer${i}`,
      exchangeable: false,
    })),
    couplings: [
      {
        siteIdA: "H:0",
        siteIdB: "H:1",
        jHz: -12,
        predictedJHz: -12,
        modelStdHz: 0.8,
        bondDistance: 2,
        source: "fullsspruce",
      },
    ],
  };
}
describe("learned per-proton spin display", () => {
  it("retains signed geminal J, diastereotopic sites and AB roofing", () => {
    const exact = renderLearnedSpinSystem(ab(), "spin-system", 400);
    expect(exact.couplings[0].jHz).toBe(-12);
    expect(exact.sites.map((s) => s.atomLabel)).toEqual(["Ha", "Hb"]);
    const lines = exact.display.clusters[0].lines;
    expect(lines).toHaveLength(4);
    expect(lines[1].weight).toBeGreaterThan(lines[0].weight * 5);
    expect(lines.reduce((n, l) => n + l.weight, 0)).toBeCloseTo(2, 10);
    const high = renderLearnedSpinSystem(ab(), "spin-system", 1600).display
      .clusters[0].lines;
    expect(high[1].weight / high[0].weight).toBeLessThan(
      lines[1].weight / lines[0].weight,
    );
  });
  it("switches to first-order and unsplit only when explicitly selected", () => {
    const first = renderLearnedSpinSystem(ab(), "first-order", 400);
    expect(first.display.clusters).toHaveLength(2);
    expect(first.display.clusters[0].lines.map((l) => l.weight)).toEqual([
      0.5, 0.5,
    ]);
    const none = renderLearnedSpinSystem(ab(), "none", 400);
    expect(none.display.clusters.flatMap((c) => c.lines)).toEqual([
      { ppm: 1.1, weight: 1 },
      { ppm: 1.12, weight: 1 },
    ]);
  });
  it("manual signed J applies once to reciprocal pair and zero disconnects it", () => {
    const changed = renderLearnedSpinSystem(ab(), "spin-system", 400, [
      { atomIndexA: 1, atomIndexB: 0, jHz: -15 },
    ]);
    expect(changed.couplings[0]).toMatchObject({
      jHz: -15,
      predictedJHz: -12,
      source: "manual",
    });
    expect(
      renderLearnedSpinSystem(ab(), "spin-system", 400, [
        { atomIndexA: 0, atomIndexB: 1, jHz: 0 },
      ]).display.clusters,
    ).toHaveLength(2);
  });
  it("retains exchangeable proton area without coupling under fast exchange", () => {
    const s = ab();
    s.sites[1].exchangeable = true;
    const r = renderLearnedSpinSystem(s, "spin-system", 400);
    expect(r.display.clusters.map((c) => c.lines)).toEqual([
      [{ ppm: 1.1, weight: 1 }],
      [{ ppm: 1.12, weight: 1 }],
    ]);
    expect(r.couplings).toHaveLength(1);
  });
  it("automatically renders a larger system in first order and labels the approximation", () => {
    const s = ab();
    s.sites = Array.from({ length: 11 }, (_, i) => ({
      ...s.sites[0],
      id: `H:${i}`,
      explicitAtomIndex: i,
      shiftPpm: i / 10,
      equivalenceKey: `H${i}`,
    }));
    s.couplings = Array.from({ length: 10 }, (_, i) => ({
      ...s.couplings[0],
      siteIdA: `H:${i}`,
      siteIdB: `H:${i + 1}`,
      jHz: 7,
    }));
    const automatic = renderLearnedSpinSystem(s, "spin-system", 400);
    expect(automatic.display.clusters).toHaveLength(11);
    expect(
      automatic.display.clusters.every((c) => c.method === "first-order"),
    ).toBe(true);
    expect(
      automatic.display.warnings.some((w) => /11-proton.*first-order/.test(w)),
    ).toBe(true);
    expect(automatic.couplings).toEqual(s.couplings);
    expect(
      automatic.display.clusters
        .flatMap((c) => c.lines)
        .reduce((n, l) => n + l.weight, 0),
    ).toBeCloseTo(11, 10);
    expect(
      renderLearnedSpinSystem(s, "first-order", 400).display.clusters,
    ).toHaveLength(11);
  });
  it("bounds dense learned patterns without losing proton area or removing J values", () => {
    const s = ab();
    s.sites = Array.from({ length: 15 }, (_, i) => ({
      ...s.sites[0],
      id: `H:${i}`,
      explicitAtomIndex: i,
      shiftPpm: i / 10,
      equivalenceKey: `H${i}`,
    }));
    s.couplings = s.sites.flatMap((a, i) =>
      s.sites
        .slice(i + 1)
        .map((b, j) => ({
          ...s.couplings[0],
          siteIdA: a.id,
          siteIdB: b.id,
          jHz: 0.51 + j * 0.2311,
        })),
    );
    const r = renderLearnedSpinSystem(s, "spin-system", 400);
    expect(r.display.clusters).toHaveLength(15);
    expect(r.couplings).toHaveLength(105);
    expect(r.display.clusters.every((c) => c.lines.length <= 1024)).toBe(true);
    expect(
      r.display.clusters
        .flatMap((c) => c.lines)
        .reduce((n, l) => n + l.weight, 0),
    ).toBeCloseTo(15, 10);
  });
});
