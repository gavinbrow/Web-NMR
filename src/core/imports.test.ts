import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { strToU8, zipSync } from "fflate";
import { importEntries, parseBrukerTitle } from "./imports";
import { processSpectrum } from "./numerics";
import type { ImportEntry } from "../model";

const bytes = (v: Uint8Array) => new Uint8Array(v).buffer as ArrayBuffer;
const text = (v: string) => bytes(strToU8(v));
const schema = "https://mestrelab.com/json-schemas/mnova/2025-10/01/";
const dim = {
  points: 4,
  spectrometer_frequency: 400,
  nucleus: "1H",
  spectral_width: 1600,
  lowest_frequency: -400,
  group_delay: 0,
  ph0: 0.3,
  ph1: -0.4,
};
const channel = (a: number[]) => ({ array: a });
const spec = () => ({
  $mnova_schema: schema + "nmr/spec",
  data: {
    $mnova_schema: schema + "nmr/base-spec",
    type: "spectrum",
    dimensional_parameters: [dim],
    data: { "1r": channel([0, 5, 2, -1]), "1i": channel([1, 2, 0, 0]) },
  },
  raw_data: {
    type: "fid",
    dimensional_parameters: [{ ...dim, points: 4 }],
    data: { "1r": channel([10, 8, 3, 0]), "1i": channel([0, 2, 1, 0]) },
  },
  parameters: [
    { name: "Title", value: [{ value: "Sample A" }] },
    {
      name: "Comment",
      value: [{ value: "Title line\r\nEntire comment\r\nLast line" }],
    },
  ],
  processing: {
    pc: [{ method: "Auto" }],
    bc: [{ algorithm: { name: "SNIP" }, apply: true }],
  },
});
const dataset = (spectra: unknown[]) => ({
  $mnova_schema: schema + "nmr/dataset",
  spectra,
});
function archive(replacements: Record<string, Uint8Array> = {}) {
  return bytes(
    zipSync({
      "root.json": strToU8(
        JSON.stringify({
          $mnova_schema: schema + "doc/root",
          pages: ["{page-a}"],
        }),
      ),
      "pages/page-a/page.json": strToU8(
        JSON.stringify({
          $mnova_schema: schema + "doc/page",
          title: "A stack\nFull comments",
          items: [{ uuid: "item-a", rtti: "NMR Spectrum" }],
        }),
      ),
      "items/item-a/item.json": strToU8(
        JSON.stringify({
          stack: { hidden_elements: [1], active_element: 0 },
          f1_scale: { from: 0.5, to: 2.5, units: "ppm" },
        }),
      ),
      "items/item-a/data.json": strToU8(
        JSON.stringify(dataset([spec(), spec()])),
      ),
      ...replacements,
    }),
  );
}
function binary(values: number[]): Uint8Array {
  const b = new Uint8Array(21 + values.length * 4),
    v = new DataView(b.buffer);
  v.setUint32(0, 17, false);
  b.set(strToU8("MNOVA JSON BINARY"), 4);
  values.forEach((n, i) => v.setFloat32(21 + i * 4, n, false));
  return b;
}
function fixtures(folder: string): ImportEntry[] {
  const base = join(process.cwd(), "../Example Files", folder),
    result: ImportEntry[] = [];
  const walk = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, e.name);
      if (e.isDirectory()) walk(file);
      else if (
        /^(fid|ser|acqus|acqu2s|procs|proc2s|1r|1i|2rr|2ri|2ir|2ii|title)$/.test(
          e.name,
        )
      )
        result.push({
          path: `${folder}/${relative(base, file)}`,
          data: bytes(readFileSync(file)),
        });
    }
  };
  walk(base);
  return result;
}

describe("source-aware imports", () => {
  it("preserves multiline comments and blank first title lines", () => {
    expect(
      parseBrukerTitle(
        "\uFEFFDAC-1 Polymer \r\n13C- Not much material\r\nMore detail\r\n",
      ),
    ).toMatchObject({
      title: "DAC-1 Polymer",
      comments: "13C- Not much material\nMore detail",
      sourceTitle: "DAC-1 Polymer \n13C- Not much material\nMore detail",
    });
    expect(parseBrukerTitle("\r\nOnly a comment")).toMatchObject({
      title: "",
      comments: "Only a comment",
    });
  });
  it("initializes raw-only imports from saved window, size and phase with reproducible replay", () => {
    const raw = new ArrayBuffer(32),
      v = new DataView(raw);
    [10, 0, 5, 1, 2, -1, 0, 0].forEach((n, i) => v.setInt32(i * 4, n, true));
    const a =
      "##$AQ_mod= 3\n##$TD= 8\n##$BYTORDA= 0\n##$DTYPA= 0\n##$SFO1= 400.0004\n##$SW_h= 1600\n##$GRPDLY= 0\n##$NUC1= <1H>";
    const p =
      "##$SI= 8\n##$SF= 400\n##$PHC0= 45\n##$PHC1= -20\n##$WDW= 1\n##$LB= 1";
    const r = importEntries([
      { path: "raw/fid", data: raw },
      { path: "raw/acqus", data: text(a) },
      { path: "raw/pdata/1/procs", data: text(p) },
      {
        path: "raw/pdata/1/title",
        data: text("Raw sample\nAcquisition comments"),
      },
    ]);
    expect(r.spectra, r.warnings.join("; ")).toHaveLength(1);
    const s = r.spectra[0];
    expect(s.recipe).toMatchObject({
      window: "exponential",
      lbHz: 1,
      zeroFill: 2,
      ph0: -45,
      ph1: 17.5,
      baseline: "none",
    });
    expect(s.recipe.pivotPpm).toBe(s.data.x[0]);
    expect(s.metadata.comments).toBe("Acquisition comments");
    expect(s.metadata.machinePhaseImported).toBe("true");
    expect(processSpectrum(s).real).toEqual(s.data.real);
    const original = s.original.real.slice();
    expect(s.data.real).not.toBe(s.original.real);
    expect(s.data.real).not.toEqual(s.original.real);
    const replay = processSpectrum({
      ...s,
      recipe: { ...s.recipe, transform: false },
    });
    expect(replay.real).toEqual(s.data.real);
    expect(replay.imag).toEqual(s.data.imag);
    expect(s.original.real).toEqual(original);
  });
  it("retains exact vendor-processed phase/baseline even if a raw FID cannot be decoded", () => {
    const values = [0, 10, 3, -2],
      b = new ArrayBuffer(16),
      v = new DataView(b);
    values.forEach((n, i) => v.setInt32(i * 4, n, true));
    const params =
      "##$SI= 4\n##$SF= 400\n##$SW_p= 1600\n##$OFFSET= 3\n##$NC_proc= -1\n##$DTYPP= 0\n##$BYTORDP= 0\n##$PHC0= 41.25645\n##$PHC1= -24.55319";
    const r = importEntries([
      { path: "sample/pdata/1/1r", data: b },
      { path: "sample/pdata/1/procs", data: text(params) },
      { path: "sample/fid", data: new ArrayBuffer(1) },
      { path: "sample/pdata/1/title", data: text("Sample\nFull comments") },
    ]);
    expect(r.spectra).toHaveLength(1);
    const s = r.spectra[0];
    expect(Array.from(s.data.real)).toEqual([0, 5, 1.5, -1]);
    expect(s.metadata).toMatchObject({
      vendorPhase0Deg: 41.25645,
      vendorPhase1Deg: -24.55319,
      comments: "Full comments",
    });
    expect(s.recipe).toMatchObject({
      transform: false,
      ph0: 0,
      ph1: 0,
      baseline: "none",
      window: "none",
    });
    expect(processSpectrum(s).real).toEqual(s.data.real);
    expect(r.warnings.join(" ")).toContain(
      "raw reprocessing source unavailable",
    );
  });
  it("imports standalone Mnova JSON calibration, complex data, complete comments and raw FID", () => {
    const r = importEntries([
      { path: "example.json", data: text(JSON.stringify(dataset([spec()]))) },
    ]);
    expect(r.spectra).toHaveLength(1);
    const s = r.spectra[0];
    expect(Array.from(s.data.x)).toEqual([3, 2, 1, 0]);
    expect(Array.from(s.data.real)).toEqual([0, 5, 2, -1]);
    expect(s.data.imag).toEqual(Float64Array.from([1, 2, 0, 0]));
    expect(s.metadata.comments).toBe("Title line\nEntire comment\nLast line");
    expect(s.fid?.carrierPpm).toBe(1);
    expect(s.recipe.ph0).toBe(0);
    expect(s.recipe.baseline).toBe("none");
    expect(processSpectrum(s).real).toEqual(s.data.real);
  });
  it("restores document pages and stack members without applying display transforms to intensities", () => {
    const r = importEntries([{ path: "example.mnjs", data: archive() }]);
    expect(r.spectra).toHaveLength(2);
    expect(r.stacks).toHaveLength(1);
    expect(r.stacks?.[0].spectrumIds).toEqual(r.spectra.map((s) => s.id));
    expect(r.spectra.map((s) => s.visible)).toEqual([true, false]);
    expect(r.view).toEqual([2.5, 0.5]);
    expect(r.spectra[0].gain).toBe(1);
    expect(Array.from(r.spectra[0].data.real)).toEqual([0, 5, 2, -1]);
  });
  it("namespaces separate Mnova archives and preserves saved stack order", () => {
    const reordered = strToU8(
      JSON.stringify({
        stack: { ids: [1, 0], hidden_elements: [1] },
        f1_scale: { from: 3, to: 0, units: "ppm" },
      }),
    );
    const a = archive({ "items/item-a/item.json": reordered });
    const r = importEntries([
      { path: "first.mnjs", data: a },
      { path: "second.mnjs", data: a },
    ]);
    expect(r.spectra).toHaveLength(4);
    expect(r.stacks).toHaveLength(2);
    expect(r.stacks?.[0].spectrumIds).toEqual([
      r.spectra[1].id,
      r.spectra[0].id,
    ]);
    expect(r.stacks?.[1].spectrumIds).toEqual([
      r.spectra[3].id,
      r.spectra[2].id,
    ]);
    expect(r.spectra[1].visible).toBe(false);
    expect(r.spectra[0].visible).toBe(true);
  });
  it("decodes exact Mnova big-endian binary resources and rejects truncated arrays", () => {
    const s = spec();
    s.data.data["1r"] = { binary_file: "files/0/data/1r.bin" } as any;
    const data = strToU8(JSON.stringify(dataset([s]))),
      resource = binary([0, 5, 2, -1]);
    const good = importEntries([
      {
        path: "example.mnjs",
        data: archive({
          "items/item-a/data.json": data,
          "items/item-a/files/0/data/1r.bin": resource,
        }),
      },
    ]);
    expect(Array.from(good.spectra[0].data.real)).toEqual([0, 5, 2, -1]);
    const bad = importEntries([
      {
        path: "example.mnjs",
        data: archive({
          "items/item-a/data.json": data,
          "items/item-a/files/0/data/1r.bin": resource.slice(0, -1),
        }),
      },
    ]);
    expect(bad.spectra).toHaveLength(0);
    expect(bad.warnings.join(" ")).toContain("truncated");
  });
  it("rejects unsafe resource paths, non-finite arrays and unprocessed/2D Mnova data honestly", () => {
    for (const change of ["unsafe", "nonfinite", "2d", "fid"]) {
      const s = spec();
      if (change === "unsafe")
        s.data.data["1r"] = { binary_file: "../../private.bin" } as any;
      if (change === "nonfinite") s.data.data["1r"].array[1] = "NaN" as any;
      if (change === "2d") s.data.dimensional_parameters.push(dim);
      if (change === "fid") s.data.type = "fid";
      const r = importEntries([
        { path: "example.json", data: text(JSON.stringify(dataset([s]))) },
      ]);
      expect(r.spectra).toHaveLength(0);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
  it("retains processed Mnova samples when optional raw arrays are unavailable", () => {
    const s = spec();
    s.raw_data.data["1i"] = { binary_file: "missing.bin" } as any;
    const r = importEntries([
      { path: "example.json", data: text(JSON.stringify(dataset([s]))) },
    ]);
    expect(r.spectra).toHaveLength(1);
    expect(r.spectra[0].fid).toBeUndefined();
    expect(r.warnings.join(" ")).toContain("stored processed trace retained");
  });
  it("provides an accurate native .mnova conversion message", () => {
    const r = importEntries([
      { path: "example.mnova", data: text("Mestrelab Research S.L.") },
    ]);
    expect(r.spectra).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("native .mnova");
    expect(r.warnings.join(" ")).toContain(".mnjs");
  });
  it.skipIf(
    !existsSync(
      join(
        process.cwd(),
        "../Example Files/Converted for Web NMR/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnjs",
      ),
    ),
  )(
    "imports the converted real Mnova document as38spectra and3stacks",
    () => {
      const b = readFileSync(
        join(
          process.cwd(),
          "../Example Files/Converted for Web NMR/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnjs",
        ),
      );
      const r = importEntries([{ path: "document.mnjs", data: bytes(b) }]);
      expect(r.spectra, r.warnings.join("; ")).toHaveLength(38);
      expect(r.stacks).toHaveLength(3);
      expect(
        r.stacks?.map((s) => s.spectrumIds.length).sort((a, b) => a - b),
      ).toEqual([5, 7, 13]);
      expect(r.spectra[0].metadata.comments).toBe(
        "GB-DAC1\nWhite Powder\nFor paper",
      );
      expect(r.spectra[0].data.real[0]).toBe(0.009490728378295898);
      expect(r.spectra[0].fid?.real.length).toBe(32768);
      expect(
        r.spectra.every(
          (s) =>
            s.recipe.transform === false &&
            s.recipe.ph0 === 0 &&
            s.recipe.baseline === "none",
        ),
      ).toBe(true);
    },
    20000,
  );
  it.skipIf(
    !existsSync(join(process.cwd(), "../Example Files/DAC-1P Nosy Cosy C13")),
  )(
    "imports all four DAC experiments, retaining titles, comments and original 2D planes",
    () => {
      const r = importEntries(fixtures("DAC-1P Nosy Cosy C13"));
      expect(r.spectra, r.warnings.join("; ")).toHaveLength(4);
      expect(
        r.spectra.every(
          (s) =>
            s.metadata.title === "DAC-1 Polymer" ||
            s.metadata.title === "DAC-1-Polymer",
        ),
      ).toBe(true);
      expect(r.spectra.map((s) => s.metadata.comments).sort()).toEqual(
        ["13C- Not much material", "Cosy", "High res 1H", "NOSEY"].sort(),
      );
      for (const s of r.spectra) {
        if (s.twoD) {
          expect(s.twoDOriginal).toBe(s.twoD);
          expect(s.twoDRaw?.real.length).toBeGreaterThan(0);
        } else {
          expect(s.fid?.real.length).toBeGreaterThan(0);
          expect(s.recipe.transform).toBe(true);
          expect(s.recipe.ph0).toBe(-Number(s.metadata.PHC0));
          expect(s.metadata.machinePhaseImported).toBe("true");
          expect(s.data.real.length).toBe(Number(s.metadata.SI));
        }
      }
    },
    20000,
  );
});
