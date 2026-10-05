import { describe, it, expect } from "vitest";
import { simulateSpinSystem } from "./spinSystem";
import fixtures from "./spinSystem.fixtures.json";

describe("exact homonuclear spin Hamiltonian", () => {
  it("matches the analytical AB quartet frequencies and roofing intensities", () => {
    const field = 400,
      j = 12,
      delta = 8,
      center = 3.61;
    const lines = simulateSpinSystem(
      [
        { id: "Ha", shiftPpm: center + delta / field / 2 },
        { id: "Hb", shiftPpm: center - delta / field / 2 },
      ],
      [{ a: 0, b: 1, jHz: j }],
      field,
    );
    expect(lines.map((l) => l.siteIds)).toEqual([
      ["Ha"],
      ["Ha"],
      ["Hb"],
      ["Hb"],
    ]);
    const r = Math.hypot(delta, j);
    expect(lines).toHaveLength(4);
    const offsets = [(r + j) / 2, (r - j) / 2, -(r - j) / 2, -(r + j) / 2];
    const weights = [
      (1 - j / r) / 2,
      (1 + j / r) / 2,
      (1 + j / r) / 2,
      (1 - j / r) / 2,
    ];
    lines.forEach((line, i) => {
      expect((line.ppm - center) * field).toBeCloseTo(offsets[i], 8);
      expect(line.weight).toBeCloseTo(weights[i], 10);
    });
    expect(lines[1].weight / lines[0].weight).toBeGreaterThan(10);
  });
  it.each(fixtures)(
    "agrees with independent full-matrix NumPy diagonalization for $name",
    (fixture) => {
      const lines = simulateSpinSystem(
        fixture.shifts.map((shiftPpm, i) => ({ id: String(i), shiftPpm })),
        fixture.couplings.map(([a, b, jHz]) => ({ a, b, jHz })),
        fixture.field,
      );
      expect(lines).toHaveLength(fixture.lines.length);
      lines.forEach((line, i) => {
        expect(line.ppm).toBeCloseTo(fixture.lines[i].ppm, 9);
        expect(line.weight).toBeCloseTo(fixture.lines[i].weight, 9);
      });
    },
  );
  it("equivalent spins remain a unit-position signal with conserved counts", () => {
    const lines = simulateSpinSystem(
      [
        { id: "a", shiftPpm: 1.5 },
        { id: "b", shiftPpm: 1.5 },
      ],
      [{ a: 0, b: 1, jHz: -14 }],
      400,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ ppm: 1.5, weight: 2, siteIds: ["a", "b"] });
  });
  it("approaches equal-height first-order doublets at high chemical-shift separation", () => {
    const lines = simulateSpinSystem(
      [
        { id: "a", shiftPpm: 1 },
        { id: "b", shiftPpm: 4 },
      ],
      [{ a: 0, b: 1, jHz: 7 }],
      800,
    );
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.siteIds)).toEqual([["b"], ["b"], ["a"], ["a"]]);
    lines.forEach((line) => expect(line.weight).toBeCloseTo(0.5, 2));
    expect((lines[0].ppm - lines[1].ppm) * 800).toBeCloseTo(7, 8);
    expect(lines.reduce((n, l) => n + l.weight, 0)).toBeCloseTo(2, 10);
  });
  it("handles disconnected spins, reorderings, and refuses silently truncated large systems", () => {
    const lines = simulateSpinSystem(
      [
        { id: "a", shiftPpm: 1.2 },
        { id: "b", shiftPpm: 3.7 },
      ],
      [],
      400,
    );
    expect(lines[0].ppm).toBeCloseTo(3.7, 12);
    expect(lines[1].ppm).toBeCloseTo(1.2, 12);
    expect(lines.map((l) => l.weight)).toEqual([1, 1]);
    expect(lines.map((l) => l.siteIds)).toEqual([["b"], ["a"]]);
    expect(() =>
      simulateSpinSystem(
        Array.from({ length: 11 }, (_, i) => ({ id: String(i), shiftPpm: i })),
        [],
        400,
      ),
    ).toThrow(/1–10/);
    expect(() =>
      simulateSpinSystem(
        [
          { id: "a", shiftPpm: 1 },
          { id: "b", shiftPpm: 2 },
        ],
        [{ a: 0, b: 1, jHz: NaN }],
        400,
      ),
    ).toThrow(/Invalid/);
  });
});
