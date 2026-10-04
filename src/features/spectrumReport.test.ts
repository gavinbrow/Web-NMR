import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { importEntries } from "../core/imports";
import {
  buildSpectrumWorkbook,
  defaultSpectrumReportOptions,
  spectrumReportRowPartitions,
  spectrumReportSnapshot,
} from "./spectrumReport";

function fixture() {
  const s = importEntries([
    {
      path: "reference.csv",
      data: new TextEncoder().encode("3,99\n2,99\n1,99\n0,99").buffer,
    },
  ]).spectra[0];
  s.label = "Corrected & referenced";
  s.frequencyMHz = 400;
  s.referenceOffset = 5;
  s.gain = 100;
  s.data = {
    x: Float64Array.from([3, 2, 1, 0]),
    real: Float64Array.from([2, 2, -4, -4]),
    imag: Float64Array.from([1, 2, 3, 4]),
  };
  s.integrals = [
    { id: "positive", label: "Reference", from: 8, to: 7, area: 999 },
    { id: "negative", label: "=SUM(1,1)", from: 6, to: 5, area: 999 },
  ];
  s.integralCalibration = { anchorId: "positive", target: 2 };
  s.peaks = [{ id: "p1", ppm: 7.5, height: 2 }];
  s.multiplets = [
    {
      id: "m1",
      from: 8,
      to: 7,
      center: 7.5,
      kind: "d",
      couplingsHz: [7.125, 12.25],
      peakCount: 2,
      label: "Doublet",
    },
  ];
  s.recipe.ph0 = 35;
  s.recipe.baseline = "auto";
  s.metadata.title = "Sample & title";
  s.metadata.comments = "Experiment comments\nSecond line";
  return s;
}
function readCell(source: string, reference: string): string {
  return (
    source.match(new RegExp(`<c r="${reference}"[^>]*>(.*?)</c>`))?.[1] || ""
  );
}
const numeric = (source: string, reference: string) =>
  Number(readCell(source, reference).match(/<v>(.*?)<\/v>/)?.[1]);
describe("Excel spectrum report", () => {
  it("exports the actual corrected trace and referenced ppm, excluding display gain and immutable originals", () => {
    const s = fixture(),
      copy = s.data.real.slice(),
      files = unzipSync(
        buildSpectrumWorkbook(s, {
          includeFigure: false,
          includePeaks: true,
          includeMultiplets: true,
        }),
      );
    const text = (path: string) => strFromU8(files[path]),
      trace = text("xl/worksheets/sheet1.xml"),
      analysis = text("xl/worksheets/sheet2.xml");
    expect(numeric(trace, "A2")).toBe(8);
    expect(numeric(trace, "B2")).toBe(2);
    expect(numeric(trace, "B4")).toBe(-4);
    expect(numeric(trace, "C2")).toBe(1);
    expect(numeric(analysis, "B4")).toBe(1);
    expect(numeric(analysis, "E8")).toBe(2);
    expect(numeric(analysis, "E9")).toBe(-4);
    expect(readCell(analysis, "F8")).toContain("<f>E8*$B$4</f><v>2</v>");
    expect(readCell(analysis, "F9")).toContain("<f>E9*$B$4</f><v>-4</v>");
    expect(analysis).toContain("=SUM(1,1)");
    expect(analysis).not.toContain("<f>=SUM");
    expect(analysis).toContain("Peak intensity");
    expect(analysis).toContain("J2 (Hz)");
    expect(analysis).toContain("<v>7.125</v>");
    expect(text("xl/workbook.xml")).toMatch(
      /name="Spectrum".*name="Analysis".*name="Processing"/,
    );
    expect(text("xl/worksheets/sheet3.xml")).toContain("Processing ph0");
    expect(text("xl/worksheets/sheet3.xml")).toContain("Source comments");
    expect(s.data.real).toEqual(copy);
    expect(s.original.real[0]).toBe(99);
    expect(s.integrals[0].area).toBe(999);
  });
  it("keeps full numeric precision while analysis selections remain optional", () => {
    const s = fixture();
    s.data.real[0] = 12.345678901234567;
    const files = unzipSync(
      buildSpectrumWorkbook(s, {
        includeFigure: false,
        includeImaginary: false,
        includePeaks: false,
        includeMultiplets: false,
        includeIntegrals: false,
        includeProcessing: false,
      }),
    );
    const trace = strFromU8(files["xl/worksheets/sheet1.xml"]),
      analysis = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect(numeric(trace, "B2")).toBe(s.data.real[0]);
    expect(readCell(trace, "C2")).toBe("");
    expect(analysis).not.toContain("Peak intensity");
    expect(analysis).not.toContain("Multiplicity");
    expect(analysis).not.toContain("Signed area (intensity");
    expect(analysis).toContain("No analysis tables selected");
    expect(files["xl/worksheets/sheet3.xml"]).toBeUndefined();
    expect(defaultSpectrumReportOptions(s, true, true)).toMatchObject({
      includePeaks: true,
      includeMultiplets: true,
      includeIntegrals: true,
    });
  });
  it("embeds the exact SVG with an explicit PNG fallback and valid relationships", () => {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><text>δ · exact view</text><path d="M0 1L2 3"/></svg>',
      png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const files = unzipSync(
        buildSpectrumWorkbook(
          fixture(),
          {},
          { svg, png, width: 1200, height: 700 },
        ),
      ),
      text = (path: string) => strFromU8(files[path]);
    expect(text("xl/media/spectrum.svg")).toBe(svg);
    expect(files["xl/media/spectrum.png"]).toEqual(png);
    expect(text("xl/drawings/drawing1.xml")).toContain(
      '<a:blip r:embed="rIdPNG">',
    );
    expect(text("xl/drawings/drawing1.xml")).toContain(
      '<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdSVG"/>',
    );
    expect(text("xl/drawings/_rels/drawing1.xml.rels")).toContain(
      "../media/spectrum.svg",
    );
    expect(text("xl/drawings/_rels/drawing1.xml.rels")).toContain(
      "../media/spectrum.png",
    );
    expect(text("xl/worksheets/_rels/sheet3.xml.rels")).toContain(
      "../drawings/drawing3.xml",
    );
    expect(text("xl/worksheets/_rels/sheet1.xml.rels")).toContain(
      "../drawings/drawing1.xml",
    );
    expect(text("xl/drawings/drawing1.xml")).toContain("<xdr:col>4</xdr:col>");
    expect(text("xl/drawings/drawing1.xml")).toContain("<xdr:row>1</xdr:row>");
    expect(text("xl/drawings/drawing3.xml")).toContain("<xdr:col>0</xdr:col>");
    expect(text("[Content_Types].xml")).toContain(
      'Extension="svg" ContentType="image/svg+xml"',
    );
    expect(text("xl/workbook.xml")).toMatch(
      /name="Spectrum".*name="Analysis".*name="Spectrum figure".*name="Processing"/,
    );
  });
  it("exports a true 2D matrix and each selected quadrant with both independent reference offsets", () => {
    const s = fixture();
    s.twoD = {
      x: Float64Array.from([10, 5]),
      y: Float64Array.from([20, 10]),
      real: Float64Array.from([1, 2, 3, 4]),
      imagF2: Float64Array.from([5, 6, 7, 8]),
      imagF1: Float64Array.from([9, 10, 11, 12]),
      imagBoth: Float64Array.from([13, 14, 15, 16]),
      width: 2,
      height: 2,
      nucleusF1: "13C",
      frequencyF1: 100,
      referenceOffsetF1: -2,
      experiment: "HSQC",
      source: "Bruker processed 2D",
      mode: "absorption",
    };
    const files = unzipSync(
        buildSpectrumWorkbook(s, {
          includeImaginary: true,
          includeFigure: false,
        }),
      ),
      text = (path: string) => strFromU8(files[path]),
      first = text("xl/worksheets/sheet1.xml");
    expect(numeric(first, "B1")).toBe(15);
    expect(numeric(first, "C1")).toBe(10);
    expect(numeric(first, "A2")).toBe(18);
    expect(numeric(first, "A3")).toBe(8);
    expect(numeric(first, "B2")).toBe(1);
    expect(numeric(first, "C3")).toBe(4);
    expect(numeric(text("xl/worksheets/sheet2.xml"), "B2")).toBe(5);
    expect(numeric(text("xl/worksheets/sheet3.xml"), "B2")).toBe(9);
    expect(numeric(text("xl/worksheets/sheet4.xml"), "B2")).toBe(13);
    expect(text("xl/worksheets/sheet5.xml")).toContain(
      "not exported as 2D measurements",
    );
    expect(text("xl/worksheets/sheet5.xml")).not.toContain(
      "Normalized integral",
    );
    expect(defaultSpectrumReportOptions(s).includeImaginary).toBe(false);
  });
  it("partitions Excel row limits without dropping the last carbon point and rejects excessive browser memory", () => {
    expect(spectrumReportRowPartitions(1048576)).toEqual([
      { start: 0, count: 1048575 },
      { start: 1048575, count: 1 },
    ]);
    expect(spectrumReportRowPartitions(2097151)).toEqual([
      { start: 0, count: 1048575 },
      { start: 1048575, count: 1048575 },
      { start: 2097150, count: 1 },
    ]);
    const s = fixture(),
      oversized = new Float64Array(2_250_001);
    s.data = { x: oversized, real: oversized };
    expect(() =>
      buildSpectrumWorkbook(s, {
        includeFigure: false,
        includeImaginary: false,
      }),
    ).toThrow(/4.5-million-cell/);
    expect(() => buildSpectrumWorkbook(fixture(), {})).toThrow(
      /requires the current SVG/,
    );
  });
  it("worker snapshots omit raw acquisitions and duplicate sources while retaining corrected data and analysis", () => {
    const s = fixture();
    s.fid = {
      real: new Float64Array(10),
      imag: new Float64Array(10),
      carrierPpm: 1,
      dwellSeconds: 1,
      groupDelay: 0,
      spectralWidthHz: 1,
    };
    const copy = spectrumReportSnapshot(s);
    expect(copy.fid).toBeUndefined();
    expect(copy.original).toBe(s.data);
    expect(copy.data).toBe(s.data);
    expect(copy.integrals).toBe(s.integrals);
    expect(s.fid).toBeDefined();
  });
});
