import { describe, expect, it } from "vitest";
import {
  snapReferencePeak,
  solventReferences,
  solventShifts,
} from "./reference";
describe("reference picker", () => {
  it("snaps to individual nearest lines, preserves offset and ignores a larger distant signal", () => {
    const data = {
      x: Float64Array.from({ length: 101 }, (_, i) => 10 - i / 10),
      real: new Float64Array(101),
    };
    data.real[20] = 100;
    data.real[24] = 10;
    expect(snapReferencePeak(data, 0.2, 7.81, 0.3)?.ppm).toBeCloseTo(7.8);
    expect(snapReferencePeak(data, 0.2, 7.4, 0.1)).toBeUndefined();
  });
  it("handles ascending axes, negative lines only in absolute mode, and flat spectra", () => {
    const data = {
      x: new Float64Array([1, 2, 3, 4, 5]),
      real: new Float64Array([0, 0, -10, 0, 0]),
    };
    expect(snapReferencePeak(data, 0, 3, 0.2)).toBeUndefined();
    expect(snapReferencePeak(data, 0, 3, 0.2, true)?.ppm).toBe(3);
    expect(
      snapReferencePeak({ ...data, real: new Float64Array(5) }, 0, 3, 1),
    ).toBeUndefined();
  });
  it("pins requested solvents and offers only compatible nucleus shifts", () => {
    expect(solventReferences.slice(0, 4).map((s) => s.id)).toEqual([
      "dmso",
      "chloroform",
      "tms",
      "water",
    ]);
    const rest = solventReferences.slice(4).map((s) => s.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(solventShifts(solventReferences[1], "13C")).toEqual([77.16]);
    expect(solventShifts(solventReferences[3], "13C")).toEqual([]);
    expect(solventShifts(solventReferences[0], "19F")).toEqual([]);
  });
});
