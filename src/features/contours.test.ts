import { describe, it, expect } from "vitest";
import { contourPath, visibleGrid } from "./contours";
describe("2D contours", () => {
  it("interpolates a closed positive crosspeak and negative crosspeak", () => {
    const g = {
      x: Float64Array.of(3, 2, 1),
      y: Float64Array.of(3, 2, 1),
      real: Float64Array.of(0, 0, 0, 0, 2, 0, 0, 0, 0),
      width: 3,
      height: 3,
    };
    const p = contourPath(
      g,
      1,
      (x) => x,
      (y) => y,
    );
    expect((p.match(/M/g) || []).length).toBe(4);
    expect(p).toContain("2.50");
    g.real[4] = -2;
    expect(
      (
        contourPath(
          g,
          -1,
          (x) => x,
          (y) => y,
        ).match(/M/g) || []
      ).length,
    ).toBe(4);
  });
  it("retains a narrow peak while reducing the visible grid", () => {
    const real = new Float64Array(10000);
    real[2020] = 100;
    const g = {
      x: Float64Array.from({ length: 100 }, (_, i) => 100 - i),
      y: Float64Array.from({ length: 100 }, (_, i) => 100 - i),
      real,
      width: 100,
      height: 100,
    };
    const v = visibleGrid(g, [100, 1], [100, 1], 10);
    expect(v.real.length).toBe(100);
    expect(Math.max(...v.real)).toBe(100);
  });
  it("handles saddle cells without NaN coordinates", () => {
    const g = {
      x: Float64Array.of(2, 1),
      y: Float64Array.of(2, 1),
      real: Float64Array.of(1, -1, -1, 1),
      width: 2,
      height: 2,
    };
    expect(
      contourPath(
        g,
        0,
        (x) => x,
        (y) => y,
      ),
    ).not.toContain("NaN");
    expect(
      (
        contourPath(
          g,
          0,
          (x) => x,
          (y) => y,
        ).match(/M/g) || []
      ).length,
    ).toBe(2);
  });
});
