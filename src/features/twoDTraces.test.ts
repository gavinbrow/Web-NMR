import { describe, expect, it } from "vitest";
import type { Spectrum, TwoDView } from "../model";
import {
  f1Pixel,
  suitableTraceSources,
  skylineProjections,
  projectionNoiseFloor,
  traceSourceKey,
  reconcileTraceSources,
  traceEnvelope,
  tracePath,
  validTwoDView,
} from "./twoDTraces";
import { importEntries } from "../core/imports";
import { maximumProjection } from "../core/twoD";
import { decodeProject, encodeProject, validateProject } from "./project";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (): Spectrum =>
  importEntries([
    {
      path: "trace.csv",
      data: new TextEncoder().encode("ppm,intensity\n10,0\n7,4\n0,0").buffer,
    },
  ]).spectra[0];
describe("2D trace display", () => {
  it("ignores delayed source-selection acknowledgements while accepting new imports without resetting the viewport", () => {
    const initial: TwoDView = {
      xView: [8, 2],
      yView: [9, 1],
      threshold: 3,
      negative: true,
      topGain: 2,
      leftGain: 4,
    };
    const top = { ...initial, topSpectrumId: "proton" },
      both = { ...top, leftSpectrumId: "proton" };
    const outgoing = new Set([
      traceSourceKey(initial),
      traceSourceKey(top),
      traceSourceKey(both),
    ]);
    expect(reconcileTraceSources(both, top, outgoing)).toBe(both);
    expect(reconcileTraceSources(both, initial, outgoing)).toBe(both);
    const external = {
      ...initial,
      xView: [10, 0] as [number, number],
      topGain: 1,
      leftGain: 1,
      topSpectrumId: "new-1d",
      leftSpectrumId: "new-1d",
    };
    const merged = reconcileTraceSources(both, external, outgoing);
    expect(merged).toEqual({
      ...both,
      topSpectrumId: "new-1d",
      leftSpectrumId: "new-1d",
    });
    expect(merged.xView).toBe(both.xView);
    expect(merged.yView).toBe(both.yView);
    expect(reconcileTraceSources(merged, external, outgoing)).toBe(merged);
  });
  it("uses positive amplitude skylines without cancellation or alternating signs", () => {
    const matrix = {
      x: Float64Array.of(3, 2, 1),
      y: Float64Array.of(4, 3, 2),
      width: 3,
      height: 3,
      real: Float64Array.of(10, -50, 0, -100, 6, 0, 0, 2, -20),
    };
    const projection = skylineProjections(matrix, 0);
    expect([...projection.top.real]).toEqual([100, 50, 20]);
    expect([...projection.left.real]).toEqual([50, 100, 20]);
    expect(matrix.real[3]).toBe(-100); // Display projection does not mutate source values.
    const floored = skylineProjections(matrix, 3);
    expect([...floored.top.real]).toEqual([97, 47, 17]);
  });
  it("suppresses the extreme-value noise pedestal while retaining narrow crosspeaks", () => {
    let state = 17;
    const real = Float64Array.from({ length: 10000 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 0xffffffff) * 2 - 1;
    });
    real[1234] = 20;
    real[5678] = -40;
    const matrix = {
      x: Float64Array.from({ length: 100 }, (_, i) => 100 - i),
      y: Float64Array.from({ length: 100 }, (_, i) => 100 - i),
      width: 100,
      height: 100,
      real,
    };
    const floor = projectionNoiseFloor(matrix),
      result = skylineProjections(matrix);
    expect(floor).toBeGreaterThan(1);
    expect(result.top.real[34]).toBeCloseTo(20 - floor, 10);
    expect(result.left.real[12]).toBeCloseTo(20 - floor, 10);
    expect(result.top.real[78]).toBeCloseTo(40 - floor, 10);
    expect([...result.top.real].filter((v) => v > 0)).toHaveLength(2);
    expect([...result.left.real].filter((v) => v > 0)).toHaveLength(2);
  });
  it("keeps supplied NOESY skyline positions aligned on both axes and removes display noise only", () => {
    const folder = "DAC-1P Nosy Cosy C13/5",
      base = join(process.cwd(), "../Example Files", folder);
    const entries = [
      "acqus",
      "acqu2s",
      "pdata/1/procs",
      "pdata/1/proc2s",
      "pdata/1/2rr",
    ].map((path) => {
      const b = readFileSync(join(base, path));
      return {
        path: join(folder, path),
        data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      };
    });
    const matrix = importEntries(entries).spectra[0].twoD!,
      original = matrix.real.slice(),
      unfiltered = skylineProjections(matrix, 0),
      filtered = skylineProjections(matrix);
    const maxIndex = (values: Float64Array) =>
      values.reduce(
        (best, value, index) => (value > values[best] ? index : best),
        0,
      );
    const x = matrix.x[maxIndex(filtered.top.real)],
      y = matrix.y[maxIndex(filtered.left.real)];
    expect(Math.abs(x - y)).toBeLessThan(0.03);
    expect(x).toBeCloseTo(7.275, 2);
    expect(filtered.floor).toBeGreaterThan(0);
    expect(filtered.top.real.filter((v) => v > 0).length).toBeLessThan(
      unfiltered.top.real.filter((v) => v > 0).length,
    );
    expect(
      Buffer.from(matrix.real.buffer).equals(Buffer.from(original.buffer)),
    ).toBe(true);
  });
  it("preserves narrow positive and negative peaks across a million-point trace", () => {
    const x = Float64Array.from(
        { length: 1_000_000 },
        (_, i) => 10 - i / 100_000,
      ),
      real = new Float64Array(x.length);
    real[123456] = 99;
    real[123457] = -41;
    const result = traceEnvelope({ x, real }, 0.2, [10.2, 0.2], 420);
    expect(result.length).toBeLessThanOrEqual(1680);
    expect(
      result.some((p) => p.value === 99 && Math.abs(p.ppm - 8.96544) < 1e-10),
    ).toBe(true);
    expect(result.some((p) => p.value === -41)).toBe(true);
    for (let i = 1; i < result.length; i++)
      expect(result[i].ppm).toBeLessThan(result[i - 1].ppm);
  });
  it("retains crossing segments at viewport boundaries and excludes nonoverlapping data", () => {
    const data = {
      x: Float64Array.of(10, 5, 0),
      real: Float64Array.of(0, 3, 0),
    };
    expect(traceEnvelope(data, 1, [9, 7], 100).map((p) => p.ppm)).toEqual([
      11, 6,
    ]);
    expect(traceEnvelope(data, 1, [20, 15], 100)).toEqual([]);
  });
  it("offers nucleus-matched 1D sources using referenced overlap and rejects 2D or ascending axes", () => {
    const a = source();
    a.nucleus = "^1H";
    a.referenceOffset = 15;
    const b = { ...a, id: "carbon", nucleus: "13C" },
      c = { ...a, id: "other-2d", twoD: {} as NonNullable<Spectrum["twoD"]> },
      d = {
        ...a,
        id: "ascending",
        data: { x: Float64Array.of(1, 2), real: Float64Array.of(0, 1) },
      };
    expect(
      suitableTraceSources([a, b, c, d], "1H", [22, 20]).map((s) => s.id),
    ).toEqual([a.id]);
    expect(suitableTraceSources([a], "1H", [10, 0])).toEqual([]);
  });
  it("maps higher F1 ppm toward the bottom and scales traces independently from coordinate axes", () => {
    expect(f1Pixel(10, [10, 0], 80, 400)).toBe(480);
    expect(f1Pixel(0, [10, 0], 80, 400)).toBe(80);
    const points = [
      { ppm: 10, value: 2 },
      { ppm: 0, value: 0 },
    ];
    expect(tracePath(points, (v) => 100 - v * 5, 80, 20, 1, "top")).toBe(
      "M50.00,60.00L100.00,80.00",
    );
    expect(
      tracePath(points, (v) => f1Pixel(v, [10, 0], 80, 400), 90, 20, 2, "left"),
    ).toBe("M50.00,480.00L90.00,80.00");
  });
  it("projects actual rows/columns without flattening or losing negative intensity", () => {
    const m = {
      x: Float64Array.of(2, 1),
      y: Float64Array.of(3, 0),
      real: Float64Array.of(2, -6, -5, 3),
      width: 2,
      height: 2,
    } as NonNullable<Spectrum["twoD"]>;
    expect([...maximumProjection(m, "F2").real]).toEqual([-5, -6]);
    expect([...maximumProjection(m, "F1").real]).toEqual([-6, -5]);
  });
  it("validates and persists view ranges, independent gains and selected source IDs", async () => {
    const s = source();
    s.twoD = {
      x: Float64Array.of(10, 0),
      y: Float64Array.of(10, 0),
      real: Float64Array.of(0, 1, 1, 0),
      width: 2,
      height: 2,
      nucleusF1: "1H",
      frequencyF1: 400,
      referenceOffsetF1: 0,
      experiment: "NOESY",
      source: "Bruker processed 2D",
      mode: "absorption",
    };
    const view: TwoDView = {
      xView: [8, 1],
      yView: [9, 2],
      threshold: 3,
      negative: true,
      topGain: 2,
      leftGain: 0.5,
      topSpectrumId: "reference",
    };
    s.twoDView = view;
    const p = {
      version: 1 as const,
      name: "Trace test",
      spectra: [s],
      activeId: s.id,
      view: null,
      displayMode: "single" as const,
      normalization: "none" as const,
      savedAt: new Date().toISOString(),
    };
    validateProject(p);
    const copy = await decodeProject(await encodeProject(p));
    expect(copy.spectra[0].twoDView).toEqual(view);
    expect(validTwoDView({ ...view, yView: [1, 9] })).toBe(false);
    expect(validTwoDView({ ...view, topGain: NaN })).toBe(false);
    expect(() =>
      validateProject({
        ...p,
        spectra: [{ ...s, twoDView: { ...view, leftGain: 101 } }],
      }),
    ).toThrow(/2D view/);
  });
});
