import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  decodeNativeIntegrals,
  decodeNativePeaks,
  decodeNativeMultiplets,
} from "./mnovaNativeAnalysis";
import {
  displayedIntegralValue,
  normalizeIntegral,
  recalibrateIntegrals,
} from "../features/integrals";
import { createDemoSpectra } from "../features/demo";
import { encodeProject, decodeProject } from "../features/project";
import type { Project } from "../model";

function bytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
}
function uint(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function double(n: number) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return b;
}
function integral(raw: number, from: number, to: number) {
  const compatibility = bytes(
    ...[144, 96, 91, 83, 63, 12, 0].map(uint),
    double(0),
    new Uint8Array(112),
  );
  const values = Array(15).fill(0);
  values[2] = from;
  values[3] = to;
  values[14] = raw;
  const subregion = bytes(
    uint(21),
    uint(0),
    double(0),
    double(0),
    Uint8Array.of(0),
    ...values.map(double),
    Uint8Array.of(1),
    uint(1),
    uint(1),
    uint(0xffffffff),
  );
  return bytes(
    compatibility,
    double(raw),
    double(raw),
    Uint8Array.of(2, 0),
    uint(1),
    subregion,
  );
}
function collection(normalization: number, regions: Uint8Array[]) {
  const body = bytes(
    uint(4),
    uint(0),
    double(normalization),
    Uint8Array.of(1),
    uint(regions.length),
    ...regions,
  );
  return bytes(uint(body.length), body, new Uint8Array(25));
}
const data = {
  x: Float64Array.from([10, 8, 6, 4, 2, 0]),
  real: Float64Array.from([0, 2, 4, 2, -1, -1]),
};
function decode(b: Uint8Array) {
  return decodeNativeIntegrals(b, { from: 0, to: b.length, data });
}

describe("native Mnova saved integral records", () => {
  it("preserves saved normalization independently of recomputed signed ppm area", () => {
    const result = decode(
      collection(50, [integral(150, 8, 6), integral(40, 4, 2)]),
    );
    expect(result.found).toBe(true);
    expect(result.normalization).toBe(50);
    expect(
      result.integrals.map((i) => [
        i.from,
        i.to,
        i.area,
        i.imported?.normalizedValue,
      ]),
    ).toEqual([
      [8, 6, 6, 3],
      [4, 2, 1, 0.8],
    ]);
    expect(result.integrals[0].imported).toEqual({
      source: "Mnova",
      rawArea: 150,
      normalizedValue: 3,
      referenceArea: 50,
    });
    const spectrum = {
      ...createDemoSpectra()[0],
      data,
      original: data,
      integrals: result.integrals,
    };
    expect(displayedIntegralValue(spectrum, result.integrals[1])).toBe(0.8);
    const updated = recalibrateIntegrals(
      spectrum,
      result.integrals.map((i) => ({ ...i, area: i.area / 2 })),
    );
    expect(displayedIntegralValue(updated, updated.integrals[0])).toBe(3);
    const calibrated = normalizeIntegral(updated, updated.integrals[0].id, 1);
    expect(calibrated.integrals.every((i) => !i.imported)).toBe(true);
    expect(
      displayedIntegralValue(calibrated, calibrated.integrals[1]),
    ).toBeCloseTo(1 / 6);
  });
  it("keeps negative raw native area while preserving the native signed displayed value", () => {
    const result = decode(collection(20, [integral(-12, 2, 0)]));
    expect(result.integrals[0].area).toBe(-2);
    expect(result.integrals[0].imported?.rawArea).toBe(-12);
    expect(result.integrals[0].imported?.normalizedValue).toBe(-0.6);
  });
  it("recognizes an explicitly empty collection without fabricating analysis", () => {
    expect(decode(collection(1, []))).toEqual({
      integrals: [],
      normalization: 1,
      found: true,
      warnings: [],
    });
    expect(decode(new Uint8Array(100))).toEqual({
      integrals: [],
      found: false,
      warnings: [],
    });
  });
  it("rejects nonfinite normalization, excessive counts, corrupted nested frames and dimensions", () => {
    const original = collection(50, [integral(150, 8, 6)]);
    for (const [offset, value] of [
      [12, Infinity],
      [21, 10001],
      [25 + 24, 1],
      [25 + 170 + 25 + 120 + 1, 2],
    ] as const) {
      const corrupt = original.slice(),
        v = new DataView(corrupt.buffer);
      if (offset === 12) v.setFloat64(offset, value);
      else v.setUint32(offset, value);
      expect(() => decode(corrupt)).toThrow();
    }
    expect(() => decode(collection(0, [integral(0, 8, 6)]))).toThrow(
      /normalization/,
    );
  });
});

const sample =
  "/Users/gavinbrown/Documents/Projects/Web NMR/Example Files/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnova";
const reference = "/tmp/webnmr-native-probes/analysis-reference.json";
describe.skipIf(!existsSync(sample) || !existsSync(reference))(
  "optional independent Mnova script reference",
  () => {
    it("matches all190 saved limits, native raw areas and normalized values exactly", () => {
      const b = new Uint8Array(readFileSync(sample)),
        ref = JSON.parse(readFileSync(reference, "utf8"));
      const signature = Uint8Array.from([
        0, 0, 0, 74, 0, 0, 0, 22, 0, 0, 0, 10, 0, 0, 0, 5, 0, 0, 0, 0, 9, 1,
      ]);
      const prefix = Uint8Array.from([0, 0, 0, 13, 0, 0, 0, 5, 0, 0, 0, 0]);
      const starts: number[] = [];
      for (let at = 33; at < b.length - signature.length; at++)
        if (
          signature.every((n, i) => b[at + i] === n) &&
          prefix.every((n, i) => b[at - 33 + i] === n)
        )
          starts.push(at - 16);
      expect(starts).toHaveLength(76);
      let total = 0;
      for (let i = 0; i < 38; i++) {
        const result = decodeNativeIntegrals(b, {
          from: i ? starts[2 * i - 1] : 0,
          to: starts[2 * i],
          data,
        });
        expect(result.normalization).toBe(ref[i].normValue);
        expect(result.integrals).toHaveLength(ref[i].integrals.length);
        result.integrals.forEach((r, j) => {
          const expected = ref[i].integrals[j];
          expect(r.from).toBe(expected.max);
          expect(r.to).toBe(expected.min);
          expect(r.imported?.rawArea).toBe(expected.raw);
          expect(r.imported?.normalizedValue).toBe(expected.normalized);
        });
        total += result.integrals.length;
      }
      expect(total).toBe(190);
    });
  },
);

describe("authored Mnova17 analysis blocks exported independently through its scripting API", () => {
  const read = (name: string) =>
    new Uint8Array(
      readFileSync(
        new URL(`./fixtures/mnova-authored-${name}.bin`, import.meta.url),
      ),
    );
  it("restores positive and negative saved integrals with the exact first=3 normalization", () => {
    const b = bytes(read("integrals"), new Uint8Array(25)),
      result = decode(b);
    expect(result.normalization).toBe(1192.9092681805294);
    expect(
      result.integrals.map((i) => [
        i.to,
        i.from,
        i.imported?.rawArea,
        i.imported?.normalizedValue,
      ]),
    ).toEqual([
      [1.8, 2.35, 3578.727804541588, 3],
      [-2.95, -2.45, 1568.7607235312462, 1.3150712844439374],
      [0.5, 1.3, -61.09149358421564, -0.051212187895391836],
    ]);
  });
  it("restores saved line positions, heights and custom labels without rerunning picking", () => {
    const b = read("peaks");
    expect(
      decodeNativePeaks(b, { from: 0, to: b.length }).map((p) => [
        p.ppm,
        p.height,
        p.label,
      ]),
    ).toEqual([
      [2.1, 119.51354217529297, "Synthetic alpha"],
      [-2.7, 34.64925765991211, "Synthetic beta"],
    ]);
  });
  it("restores saved multiplet regions, centers, categories and names", () => {
    const b = read("multiplets"),
      result = decodeNativeMultiplets(b, { from: 0, to: b.length, data });
    expect(result.found).toBe(true);
    expect(
      result.multiplets.map((m) => [
        m.to,
        m.from,
        m.center,
        m.kind,
        m.label,
        m.couplingsHz,
      ]),
    ).toEqual([
      [1.8, 2.35, 2.1, "s", "Alpha", []],
      [-2.95, -2.45, -2.7, "s", "Beta", []],
    ]);
  });
});

it("restores nonzero saved coupling constants, categories and fractional native counts exactly", () => {
  const b = new Uint8Array(
      readFileSync(
        new URL("./fixtures/mnova-authored-couplings.bin", import.meta.url),
      ),
    ),
    result = decodeNativeMultiplets(b, { from: 0, to: b.length, data });
  expect(
    result.multiplets.map((m) => [
      m.kind,
      m.couplingsHz,
      m.imported?.nuclideCount,
    ]),
  ).toEqual([
    ["dd", [7.125, 2.5], 1],
    ["q", [12.75], 0],
  ]);
  expect(
    result.multiplets.every((m) =>
      Number.isFinite(m.imported?.normalizedValue),
    ),
  ).toBe(true);
});

it("excludes previous processing-history multiplets when reading the next stacked member", () => {
  const block = new Uint8Array(
    readFileSync(
      new URL("./fixtures/mnova-authored-multiplets.bin", import.meta.url),
    ),
  );
  const previous = bytes(
    uint(block.length),
    block,
    uint(block.length),
    block,
    uint(0),
  );
  const b = bytes(previous, block);
  const result = decodeNativeMultiplets(b, {
    from: 0,
    to: b.length,
    data,
    previousSourceEnd: 0,
  });
  expect(result.multiplets.map((m) => m.label)).toEqual(["Alpha", "Beta"]);
});

it("preserves all saved analysis through a portable project roundtrip", async () => {
  const read = (kind: string) =>
    new Uint8Array(
      readFileSync(
        new URL(`./fixtures/mnova-authored-${kind}.bin`, import.meta.url),
      ),
    );
  const integralBytes = bytes(read("integrals"), new Uint8Array(25)),
    mpBytes = read("couplings"),
    peakBytes = read("peaks");
  const base = createDemoSpectra()[0];
  const spectrum = {
    ...base,
    integrals: decode(integralBytes).integrals,
    peaks: decodeNativePeaks(peakBytes, { from: 0, to: peakBytes.length }),
    multiplets: decodeNativeMultiplets(mpBytes, {
      from: 0,
      to: mpBytes.length,
      data: base.data,
    }).multiplets,
  };
  const project: Project = {
    version: 1,
    name: "Authored saved analysis",
    spectra: [spectrum],
    activeId: spectrum.id,
    view: null,
    displayMode: "single",
    normalization: "none",
    savedAt: new Date().toISOString(),
  };
  const restored = await decodeProject(await encodeProject(project));
  expect(restored.spectra[0].integrals).toEqual(spectrum.integrals);
  expect(restored.spectra[0].peaks).toEqual(spectrum.peaks);
  expect(restored.spectra[0].multiplets).toEqual(spectrum.multiplets);
  expect(
    restored.spectra[0].integrals.map((i) =>
      displayedIntegralValue(restored.spectra[0], i),
    ),
  ).toEqual([3, 1.3150712844439374, -0.051212187895391836]);
});

it("recognizes a complete empty multiplet collection", () => {
  const block = bytes(
    uint(61),
    uint(44),
    uint(0),
    uint(0),
    uint(0),
    double(0),
    double(0),
    double(0),
    uint(0),
    uint(0),
    double(1),
    Uint8Array.of(1),
    uint(0),
  );
  expect(
    decodeNativeMultiplets(block, { from: 0, to: block.length, data }),
  ).toEqual({ multiplets: [], found: true, warnings: [] });
});
