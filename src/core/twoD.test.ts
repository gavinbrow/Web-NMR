import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ImportEntry, Project } from "../model";
import { importEntries } from "./imports";
import {
  decodeTiledPlane,
  extractTwoDSlice,
  maximumProjection,
  processRawTwoDMagnitude,
  readProcessedTwoD,
} from "./twoD";
import {
  decodeProject,
  encodeProject,
  validateProject,
} from "../features/project";

function fixtures(folder: string, rawOnly = false): ImportEntry[] {
  const base = join(process.cwd(), "../Example Files", folder),
    entries: ImportEntry[] = [];
  const names = [
    "acqus",
    "acqu2s",
    "ser",
    "fid",
    "procs",
    "proc2s",
    "1r",
    "1i",
    "2rr",
    "2ri",
    "2ir",
    "2ii",
    "title",
  ];
  const walk = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, e.name);
      if (e.isDirectory()) {
        if (!rawOnly || e.name !== "pdata") walk(file);
      } else if (names.includes(e.name)) {
        const b = readFileSync(file);
        entries.push({
          path: join(folder, relative(base, file)),
          data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        });
      }
    }
  };
  walk(base);
  return entries;
}
function maxCoordinate(data: {
  x: Float64Array;
  y: Float64Array;
  real: Float64Array;
  width: number;
}): [number, number] {
  let best = 0;
  for (let i = 1; i < data.real.length; i++)
    if (Math.abs(data.real[i]) > Math.abs(data.real[best])) best = i;
  return [data.x[best % data.width], data.y[Math.floor(best / data.width)]];
}

describe("Bruker processed 2D support", () => {
  it("reorders independently constructed Bruker tiles and preserves sign/scaling", () => {
    const width = 6,
      height = 4,
      tileW = 3,
      tileH = 2,
      buffer = new ArrayBuffer(width * height * 4),
      view = new DataView(buffer);
    let sample = 0;
    for (let by = 0; by < height; by += tileH)
      for (let bx = 0; bx < width; bx += tileW)
        for (let row = by; row < by + tileH; row++)
          for (let col = bx; col < bx + tileW; col++)
            view.setInt32(sample++ * 4, 100 * row + col - 150, false);
    const result = decodeTiledPlane(
      buffer,
      width,
      height,
      tileW,
      tileH,
      1,
      0,
      0.5,
    );
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++)
        expect(result[row * width + col]).toBe((100 * row + col - 150) / 2);
  });
  it("calibrates heteronuclear axes independently and returns actual slices/projections", () => {
    const rr = new ArrayBuffer(4 * 4 * 4),
      view = new DataView(rr);
    for (let i = 0; i < 16; i++) view.setInt32(i * 4, i, true);
    const f2 = {
      SI: 4,
      XDIM: 4,
      SF: 400,
      SW_p: 4000,
      OFFSET: 10,
      BYTORDP: 0,
      DTYPP: 0,
      NC_proc: 0,
    };
    const f1 = {
      SI: 4,
      XDIM: 4,
      SF: 100,
      SW_p: 20000,
      OFFSET: 200,
      AXNUC: "13C",
    };
    const data = readProcessedTwoD({ rr }, f2, f1);
    expect([...data.x]).toEqual([10, 7.5, 5, 2.5]);
    expect([...data.y]).toEqual([200, 150, 100, 50]);
    expect(data.nucleusF1).toBe("13C");
    expect([...extractTwoDSlice(data, "F2", 150).real]).toEqual([4, 5, 6, 7]);
    expect([...extractTwoDSlice(data, "F1", 5).real]).toEqual([2, 6, 10, 14]);
    expect([...maximumProjection(data).real]).toEqual([12, 13, 14, 15]);
  });
  it("opens the supplied NOESY and COSY matrices with all available quadrants and titles", () => {
    for (const folder of [
      "DAC-1P Nosy Cosy C13/5",
      "DAC-1P Nosy Cosy C13/4",
      "COSY",
    ]) {
      const result = importEntries(fixtures(folder));
      expect(result.warnings).toEqual([]);
      expect(result.spectra).toHaveLength(1);
      const s = result.spectra[0],
        data = s.twoD!;
      expect(data).toBeDefined();
      expect(data.real.length).toBe(data.width * data.height);
      expect(s.data.real.length).toBe(data.width);
      expect(data.x[1]).toBeLessThan(data.x[0]);
      expect(data.y[1]).toBeLessThan(data.y[0]);
      expect(s.metadata.title).toBeTruthy();
      expect(s.metadata.comments).toBeTypeOf("string");
      expect(data.mode).toBe("absorption");
      if (folder.endsWith("/5")) {
        expect(data.width).toBe(1024);
        expect(data.height).toBe(512);
        expect(data.imagF1).toBeDefined();
        expect(data.imagF2).toBeDefined();
        expect(data.imagBoth).toBeDefined();
        expect(s.metadata.title).toBe("DAC-1-Polymer");
        expect(s.metadata.comments).toBe("NOSEY");
      }
    }
  });
  it("round-trips actual NOESY matrices, axes, quadrant components and comments", async () => {
    const s = importEntries(fixtures("DAC-1P Nosy Cosy C13/5")).spectra[0];
    const project: Project = {
      version: 1,
      name: "NOESY",
      spectra: [s],
      activeId: s.id,
      view: [10, 0],
      displayMode: "single",
      normalization: "none",
      savedAt: new Date().toISOString(),
    };
    validateProject(project);
    const decoded = await decodeProject(await encodeProject(project)),
      restored = decoded.spectra[0];
    expect(restored.metadata.comments).toBe("NOSEY");
    for (const key of [
      "real",
      "imagF2",
      "imagF1",
      "imagBoth",
      "x",
      "y",
    ] as const) {
      const original = s.twoD![key]!,
        copy = restored.twoD![key]!;
      // Compare every byte without Vitest constructing hundreds of thousands of assertions.
      expect(
        Buffer.from(copy.buffer, copy.byteOffset, copy.byteLength).equals(
          Buffer.from(
            original.buffer,
            original.byteOffset,
            original.byteLength,
          ),
        ),
      ).toBe(true);
    }
    expect(() =>
      validateProject({
        ...decoded,
        spectra: [{ ...restored, twoD: { ...restored.twoD, width: 9 } }],
      }),
    ).toThrow(/2D/);
  });
  it("rejects malformed or oversized processed planes instead of flattening them", () => {
    expect(() =>
      decodeTiledPlane(new ArrayBuffer(64), 4, 4, 3, 2, 0, 0, 1),
    ).toThrow(/divisible/);
    expect(() =>
      decodeTiledPlane(new ArrayBuffer(16), 4, 4, 2, 2, 0, 0, 1),
    ).toThrow(/size/);
    expect(() =>
      decodeTiledPlane(new ArrayBuffer(0), 10000, 10000, 10, 10, 0, 0, 1),
    ).toThrow(/10 million/);
  });
  it("extracts actual 1D titles and comments without changing processed spectrum data", () => {
    const s = importEntries(fixtures("Proton")).spectra[0];
    expect(s.metadata.title).toBeTruthy();
    expect(s.metadata.comments).toBeTypeOf("string");
    expect(s.twoD).toBeUndefined();
    expect(s.recipe.transform).toBe(false);
  });
});

describe("limited raw States/States-TPPI magnitude processing", () => {
  for (const mode of [4, 5]) {
    it(`decodes FnMODE ${mode} with analytically calibrated F1/F2 peak axes`, () => {
      const n2 = 16,
        n1 = 8,
        rows = n1 * 2,
        stride = 1024,
        buffer = new ArrayBuffer(rows * stride),
        view = new DataView(buffer);
      for (let t1 = 0; t1 < n1; t1++)
        for (let pair = 0; pair < 2; pair++)
          for (let t2 = 0; t2 < n2; t2++) {
            const a1 = (2 * Math.PI * 2 * t1) / n1,
              a2 = (2 * Math.PI * 3 * t2) / n2,
              sign = mode === 5 && t1 % 2 ? -1 : 1;
            const factor = pair ? Math.sin(a1) : Math.cos(a1),
              offset = (2 * t1 + pair) * stride + t2 * 8;
            view.setInt32(
              offset,
              Math.round(10000 * factor * sign * Math.cos(a2)),
              true,
            );
            view.setInt32(
              offset + 4,
              Math.round(10000 * factor * sign * Math.sin(a2)),
              true,
            );
          }
      const f2 = {
        TD: n2 * 2,
        SFO1: 400,
        O1: 2000,
        SW_h: 1000,
        BYTORDA: 0,
        DTYPA: 0,
        AQ_mod: 3,
        GRPDLY: 0,
      };
      const f1 = {
        TD: rows,
        SFO1: 400,
        O1: 2000,
        SW_h: 1000,
        NUC1: "1H",
        FnMODE: mode,
      };
      const result = processRawTwoDMagnitude(buffer, f2, f1);
      expect(result.mode).toBe("magnitude");
      const [x, y] = maxCoordinate(result);
      expect(x).toBeCloseTo(5.46875, 8);
      expect(y).toBeCloseTo(5.625, 8);
    });
  }
  it("raw-only supplied NOESY produces a 2D magnitude plane with diagonal axes matching processed data", () => {
    const raw = importEntries(fixtures("DAC-1P Nosy Cosy C13/5", true)),
      processed = importEntries(fixtures("DAC-1P Nosy Cosy C13/5"));
    expect(raw.spectra).toHaveLength(1);
    expect(raw.spectra[0].twoD!.mode).toBe("magnitude");
    expect(raw.warnings.join(" ")).toMatch(/magnitude/);
    const rawData = raw.spectra[0].twoD!,
      [rawX, rawY] = maxCoordinate(rawData),
      [procX, procY] = maxCoordinate(processed.spectra[0].twoD!);
    // Raw-only data have acquisition referencing; processed data can carry a small vendor reference correction.
    expect(Math.abs(rawX - rawY)).toBeLessThan(0.08);
    expect(Math.abs(rawX - procX)).toBeLessThan(0.08);
    expect(Math.abs(rawY - procY)).toBeLessThan(0.08);
  });
  it("raw-only echo/antiecho remains explicit unsupported, while its processed plane imports", () => {
    const result = importEntries(fixtures("DAC-1P Nosy Cosy C13/4", true));
    expect(result.spectra).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/FnMODE 6 is unsupported/);
  });
});
