import { strToU8, zipSync } from "fflate";
import type { Spectrum } from "../model";
import { integrate } from "../core/numerics";
import { integralReportingScale, displayedIntegralValue } from "./integrals";
import { safeFilename } from "./project";

export interface SpectrumReportOptions {
  includeIntegrals: boolean;
  includePeaks: boolean;
  includeMultiplets: boolean;
  includeImaginary: boolean;
  includeProcessing: boolean;
  includeFigure: boolean;
  standaloneSVG: boolean;
}
export interface SpectrumReportFigure {
  /** Exact current-view SVG; retained byte-for-byte in the workbook. */
  svg: string;
  png: Uint8Array;
  width: number;
  height: number;
}
export const defaultSpectrumReportOptions = (
  s: Spectrum,
  showPeaks = false,
  showMultiplets = false,
): SpectrumReportOptions => ({
  includeIntegrals: true,
  includePeaks: showPeaks,
  includeMultiplets: showMultiplets,
  includeImaginary: !s.twoD && !!s.data.imag,
  includeProcessing: true,
  includeFigure: true,
  standaloneSVG: true,
});
export const MAX_SPECTRUM_REPORT_CELLS = 4_500_000;
const MAX_XML_BYTES = 192 * 1024 * 1024;
const EXCEL_DATA_ROWS = 1_048_575;
const EXCEL_MATRIX_COLUMNS = 16_383;
/** Cheap preflight before typed-array snapshots/worker copies. No values are downsampled. */
export function validateSpectrumReportSize(
  s: Spectrum,
  options: Partial<SpectrumReportOptions> = {},
): void {
  const imaginary =
    options.includeImaginary ??
    defaultSpectrumReportOptions(s).includeImaginary;
  if (s.twoD) {
    const d = s.twoD;
    if (
      !Number.isInteger(d.width) ||
      !Number.isInteger(d.height) ||
      d.width < 2 ||
      d.height < 2 ||
      d.real.length !== d.width * d.height ||
      d.x.length !== d.width ||
      d.y.length !== d.height
    )
      throw new Error("Invalid processed 2D matrix dimensions.");
    const planes =
      1 +
      (imaginary ? [d.imagF2, d.imagF1, d.imagBoth].filter(Boolean).length : 0);
    if ((d.width + 1) * (d.height + 1) * planes > MAX_SPECTRUM_REPORT_CELLS)
      throw new Error(
        "This 2D report exceeds the 4.5-million-cell limit. Omit imaginary planes or export CSV.",
      );
    if (
      imaginary &&
      [d.imagF2, d.imagF1, d.imagBoth].some(
        (plane) => plane && plane.length !== d.real.length,
      )
    )
      throw new Error("Invalid 2D imaginary plane dimensions.");
  } else {
    const d = s.data;
    if (
      d.real.length < 2 ||
      d.x.length !== d.real.length ||
      (d.imag && d.imag.length !== d.real.length)
    )
      throw new Error("Invalid processed spectrum dimensions.");
    if (
      d.real.length * (imaginary && d.imag ? 3 : 2) >
      MAX_SPECTRUM_REPORT_CELLS
    )
      throw new Error(
        "This spectrum exceeds the Excel report's 4.5-million-cell limit. Omit imaginary data or export CSV.",
      );
  }
}
/** One header row per Excel sheet; boundary points remain present in the next sheet. */
export function spectrumReportRowPartitions(
  points: number,
): { start: number; count: number }[] {
  if (!Number.isSafeInteger(points) || points < 0)
    throw new Error("Invalid report point count.");
  const parts: { start: number; count: number }[] = [];
  for (let start = 0; start < points; start += EXCEL_DATA_ROWS)
    parts.push({ start, count: Math.min(EXCEL_DATA_ROWS, points - start) });
  return parts;
}
const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function excelColumn(index: number): string {
  let result = "";
  for (index++; index > 0; index = Math.floor((index - 1) / 26))
    result = String.fromCharCode(65 + ((index - 1) % 26)) + result;
  return result;
}
type Cell = string | number | undefined | { formula: string; value: number };
function cell(value: Cell, column: number, row: number, style = 0): string {
  const reference = excelColumn(column) + row;
  if (value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("The report contains a non-finite numerical value.");
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  if (typeof value === "object") {
    if (!Number.isFinite(value.value))
      throw new Error("The report contains an invalid analysis result.");
    return `<c r="${reference}" s="${style}"><f>${xml(value.formula)}</f><v>${value.value}</v></c>`;
  }
  if (value.length > 32767)
    throw new Error(
      "A report text field exceeds Excel's 32,767-character cell limit.",
    );
  // Inline strings remain text even if a label starts with =, +, - or @.
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
interface Sheet {
  name: string;
  rows: number;
  columns: number;
  row: (index: number) => Cell[];
  headerRows: Set<number>;
  freeze?: number;
  matrix?: boolean;
  drawing?: boolean;
  drawingColumn?: number;
  drawingRow?: number;
  titleRows?: Set<number>;
  widths?: number[];
  wrap?: boolean;
  numberStyle?: (row: number, column: number) => number;
}
function sheetXML(sheet: Sheet): string {
  const chunks: string[] = [];
  let chunk = "",
    chars = 0;
  for (let r = 0; r < sheet.rows; r++) {
    const header = sheet.headerRows.has(r),
      title = sheet.titleRows?.has(r);
    const values = sheet.row(r);
    const rowHeight = title
      ? 27
      : sheet.wrap
        ? Math.min(
            150,
            Math.max(
              20,
              ...values.map((v, c) =>
                typeof v === "string"
                  ? v
                      .split(/\n/)
                      .reduce(
                        (sum, line) =>
                          sum +
                          Math.max(
                            1,
                            Math.ceil(line.length / (sheet.widths?.[c] || 80)),
                          ),
                        0,
                      ) *
                      15 +
                    5
                  : 20,
              ),
            ),
          )
        : undefined;
    const line = `<row r="${r + 1}"${rowHeight ? ` ht="${rowHeight}" customHeight="1"` : ""}>${values.map((v, c) => cell(v, c, r + 1, title ? 1 : header ? 2 : typeof v === "number" || typeof v === "object" ? (sheet.numberStyle?.(r, c) ?? (c === 0 ? 4 : 3)) : sheet.wrap ? 5 : 0)).join("")}</row>`;
    chars += line.length;
    if (chars > MAX_XML_BYTES)
      throw new Error(
        "The Excel report exceeds its 192 MiB XML limit. Omit imaginary planes or use CSV for larger data.",
      );
    chunk += line;
    if (r % 2048 === 2047) {
      chunks.push(chunk);
      chunk = "";
    }
  }
  if (chunk) chunks.push(chunk);
  const freeze = sheet.freeze || 0;
  const widths = sheet.widths
    ? sheet.widths
        .map(
          (width, c) =>
            `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`,
        )
        .join("")
    : `<col min="1" max="1" width="23" customWidth="1"/>${sheet.columns > 1 ? `<col min="2" max="${Math.max(sheet.columns, 12)}" width="23" customWidth="1"/>` : ""}`;
  return (
    decl +
    `<worksheet xmlns="${ns}" xmlns:r="${rel}"><dimension ref="A1:${excelColumn(sheet.columns - 1)}${sheet.rows}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze ? `<pane ySplit="${freeze}"${sheet.matrix ? ' xSplit="1"' : ""} topLeftCell="${sheet.matrix ? "B" : "A"}${freeze + 1}" activePane="${sheet.matrix ? "bottomRight" : "bottomLeft"}" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths}</cols><sheetData>${chunks.join("")}</sheetData>${sheet.headerRows.has(0) && sheet.rows > 1 && !sheet.matrix ? `<autoFilter ref="A1:${excelColumn(sheet.columns - 1)}${sheet.rows}"/>` : ""}<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>${sheet.drawing ? '<drawing r:id="rIdDrawing"/>' : ""}</worksheet>`
  );
}
const relationships = (items: { id: string; type: string; target: string }[]) =>
  decl +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((item) => `<Relationship Id="${item.id}" Type="${rel}/${item.type}" Target="${xml(item.target)}"/>`).join("")}</Relationships>`;
function numericSheets(s: Spectrum, options: SpectrumReportOptions): Sheet[] {
  const sheets: Sheet[] = [];
  if (!s.twoD) {
    const d = s.data,
      imaginary = options.includeImaginary && !!d.imag;
    if (
      d.real.length < 2 ||
      d.real.length !== d.x.length ||
      (d.imag && d.imag.length !== d.real.length)
    )
      throw new Error("Invalid processed spectrum dimensions.");
    if (d.real.length * (imaginary ? 3 : 2) > MAX_SPECTRUM_REPORT_CELLS)
      throw new Error(
        "This spectrum exceeds the Excel report's 4.5-million-cell limit. Omit imaginary data or export CSV.",
      );
    for (const { start: first, count } of spectrumReportRowPartitions(
      d.real.length,
    )) {
      const part = sheets.length + 1;
      sheets.push({
        name: part === 1 ? "Spectrum" : `Spectrum ${part}`,
        rows: count + 1,
        columns: imaginary ? 3 : 2,
        headerRows: new Set([0]),
        freeze: 1,
        row: (row) =>
          row === 0
            ? [
                "Chemical shift (ppm)",
                "Corrected real intensity",
                ...(imaginary ? ["Imaginary intensity"] : []),
              ]
            : [
                d.x[first + row - 1] + s.referenceOffset,
                d.real[first + row - 1],
                ...(imaginary ? [d.imag![first + row - 1]] : []),
              ],
      });
    }
    return sheets;
  }
  const d = s.twoD;
  if (
    !Number.isInteger(d.width) ||
    !Number.isInteger(d.height) ||
    d.width < 2 ||
    d.height < 2 ||
    d.real.length !== d.width * d.height ||
    d.x.length !== d.width ||
    d.y.length !== d.height
  )
    throw new Error("Invalid processed 2D matrix dimensions.");
  const planes: [string, Float64Array][] = [["Spectrum", d.real]];
  if (options.includeImaginary)
    for (const [name, values] of [
      ["F2 imaginary", d.imagF2],
      ["F1 imaginary", d.imagF1],
      ["Both imaginary", d.imagBoth],
    ] as const)
      if (values) planes.push([name, values]);
  if (
    (d.width + 1) * (d.height + 1) * planes.length >
    MAX_SPECTRUM_REPORT_CELLS
  )
    throw new Error(
      "This 2D report exceeds the 4.5-million-cell limit. Omit imaginary planes or export CSV.",
    );
  for (const [name, plane] of planes) {
    if (plane.length !== d.real.length)
      throw new Error("Invalid 2D imaginary plane dimensions.");
    let part = 0;
    for (let fromRow = 0; fromRow < d.height; fromRow += EXCEL_DATA_ROWS)
      for (
        let fromCol = 0;
        fromCol < d.width;
        fromCol += EXCEL_MATRIX_COLUMNS
      ) {
        const r0 = fromRow,
          c0 = fromCol,
          rows = Math.min(EXCEL_DATA_ROWS, d.height - r0),
          columns = Math.min(EXCEL_MATRIX_COLUMNS, d.width - c0);
        part++;
        sheets.push({
          name: name + (part > 1 ? ` ${part}` : ""),
          rows: rows + 1,
          columns: columns + 1,
          headerRows: new Set([0]),
          freeze: 1,
          matrix: true,
          row: (row) =>
            row === 0
              ? [
                  "F1 ppm / F2 ppm",
                  ...Array.from(
                    d.x.subarray(c0, c0 + columns),
                    (x) => x + s.referenceOffset,
                  ),
                ]
              : [
                  d.y[r0 + row - 1] + d.referenceOffsetF1,
                  ...plane.subarray(
                    (r0 + row - 1) * d.width + c0,
                    (r0 + row - 1) * d.width + c0 + columns,
                  ),
                ],
        });
      }
  }
  return sheets;
}
function analysisSheet(s: Spectrum, options: SpectrumReportOptions): Sheet {
  const rows: Cell[][] = [
      [],
      [String(s.metadata.title || s.label) + " analysis"],
    ],
    headers = new Set<number>();
  if (s.twoD) {
    rows.push(
      ["Dimension", "2D matrix"],
      [
        "Analysis",
        "1D integrals, peaks and multiplets are not exported as 2D measurements.",
      ],
    );
    if (s.prediction?.twoD) {
      rows.push(
        [
          "Prediction",
          `${s.prediction.twoD.experiment} · ${s.prediction.engine}`,
        ],
        [
          "Interpretation",
          "Predicted atom correlations; weights are illustrative, not measured peak volumes or simulated pulse-sequence intensities.",
        ],
        [],
      );
      headers.add(rows.length);
      rows.push([
        "Correlation ID",
        "F2 (ppm)",
        "F1 (ppm)",
        "F2 atom",
        "F1 atom",
        "Type",
        "Sign",
        "J (Hz)",
        "Coupling source",
      ]);
      const atom = (id: string, label?: string) => {
        const a = s.molecule?.document.atoms.find((a) => a.id === id);
        return label ?? (a ? `${a.element}${a.index}` : id);
      };
      for (const c of s.prediction.twoD.correlations)
        rows.push([
          c.id,
          c.xPpm + s.referenceOffset,
          c.yPpm + s.twoD.referenceOffsetF1,
          atom(c.atomIdX, c.protonLabelX),
          atom(c.atomIdY, c.protonLabelY),
          c.kind,
          c.sign,
          c.jHz ?? "",
          c.source ?? "Direct bond",
        ]);
    }
  } else {
    const integrals = s.integrals.map((region) => ({
      ...region,
      area: integrate(s.data, s.referenceOffset, region.from, region.to),
    }));
    const factor = integralReportingScale({ ...s, integrals });
    rows.push(
      [
        "Integral method",
        s.integrals.some((i) => i.imported)
          ? "Signed trapezoidal areas from the corrected trace; saved Mnova normalized values are preserved separately."
          : "Signed trapezoidal areas from the exported corrected trace.",
      ],
      ["Normalization factor", factor],
      [
        "Normalization reference",
        s.integralCalibration
          ? `${s.integrals.find((i) => i.id === s.integralCalibration!.anchorId)?.label || s.integralCalibration.anchorId} = ${s.integralCalibration.target}${s.integralCalibration.tentative ? " (tentative)" : ""}`
          : "Relative / current integral scale",
      ],
      [],
    );
    if (options.includeIntegrals) {
      headers.add(rows.length);
      rows.push([
        "Integral ID",
        "Label",
        "From (ppm)",
        "To (ppm)",
        "Signed area (intensity·ppm)",
        "Normalized integral",
      ]);
      if (!integrals.length) rows.push(["No integral regions"]);
      for (const i of integrals) {
        const row = rows.length + 1;
        rows.push([
          i.id,
          i.label,
          i.from,
          i.to,
          i.area,
          i.imported
            ? displayedIntegralValue(s, i)
            : { formula: `E${row}*$B$4`, value: i.area * factor },
        ]);
      }
      rows.push([]);
    }
    if (options.includePeaks) {
      headers.add(rows.length);
      rows.push([
        "Peak ID",
        "Chemical shift (ppm)",
        "Peak intensity",
        "Annotation",
      ]);
      if (!s.peaks.length) rows.push(["No picked peaks"]);
      for (const p of s.peaks)
        rows.push([p.id, p.ppm, p.height, p.label || ""]);
      rows.push([]);
    }
    if (options.includeMultiplets) {
      const count = Math.max(
        0,
        ...s.multiplets.map((m) => m.couplingsHz.length),
      );
      if (count > 100)
        throw new Error(
          "A multiplet has too many coupling columns for this report.",
        );
      headers.add(rows.length);
      rows.push([
        "Multiplet ID",
        "Label",
        "From (ppm)",
        "To (ppm)",
        "Center (ppm)",
        "Multiplicity",
        "Peak count",
        "Saved normalized integral",
        "Saved nuclide count",
        ...Array.from({ length: count }, (_, i) => `J${i + 1} (Hz)`),
      ]);
      if (!s.multiplets.length) rows.push(["No analyzed multiplets"]);
      for (const m of s.multiplets)
        rows.push([
          m.id,
          m.label,
          m.from,
          m.to,
          m.center,
          m.kind,
          m.peakCount,
          m.imported?.normalizedValue ?? "",
          m.imported?.nuclideCount ?? "",
          ...m.couplingsHz,
        ]);
    }
    if (
      !options.includeIntegrals &&
      !options.includePeaks &&
      !options.includeMultiplets
    )
      rows.push(["No analysis tables selected"]);
  }
  return {
    name: "Analysis",
    rows: rows.length,
    columns: Math.max(6, ...rows.map((r) => r.length)),
    row: (i) => rows[i],
    headerRows: headers,
    titleRows: new Set([1]),
    widths: [34, 32, 22, 22, 31, 25, 20],
    numberStyle: (row, column) =>
      typeof rows[row][column] === "object" ? 4 : 3,
  };
}
function processingSheet(s: Spectrum): Sheet {
  const rows: Cell[][] = [
    [],
    [String(s.metadata.title || s.label) + " processing"],
    ["Property", "Value"],
  ];
  const add = (name: string, value: unknown) => {
    if (value !== undefined)
      rows.push([
        name,
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? value
            : JSON.stringify(value),
      ]);
  };
  add("Exported at (UTC)", new Date().toISOString());
  add("Filename / label", s.label);
  add("Source format", s.sourceFormat);
  add("Nucleus F2", s.nucleus);
  add("Frequency F2 (MHz)", s.frequencyMHz || "Unknown");
  add("Reference offset F2 (ppm)", s.referenceOffset);
  add("Data source", "Current processed numerical data; display gain excluded");
  if (s.twoD) {
    add("Nucleus F1", s.twoD.nucleusF1);
    add("Frequency F1 (MHz)", s.twoD.frequencyF1);
    add("Reference offset F1 (ppm)", s.twoD.referenceOffsetF1);
    add("2D mode", s.twoD.mode);
    add("Matrix width", s.twoD.width);
    add("Matrix height", s.twoD.height);
    add("Matrix order", "F1 rows / F2 columns, descending ppm");
  }
  const recipe = (label: string, value: unknown) => {
    if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        add(`${label}${key}`, item);
  };
  if (s.twoD && s.twoDRecipe) {
    recipe(
      "2D ",
      Object.fromEntries(
        Object.entries(s.twoDRecipe).filter(([k]) => k !== "f1" && k !== "f2"),
      ),
    );
    recipe("F2 ", s.twoDRecipe.f2);
    recipe("F1 ", s.twoDRecipe.f1);
  } else recipe("Processing ", s.recipe);
  for (const [key, value] of Object.entries(s.metadata))
    add(`Source ${key}`, value);
  for (const line of s.history) add("History", line);
  return {
    name: "Processing",
    rows: rows.length,
    columns: 2,
    row: (i) => rows[i],
    headerRows: new Set([2]),
    titleRows: new Set([1]),
    freeze: 3,
    widths: [42, 110],
    wrap: true,
  };
}
function drawingXML(figure: SpectrumReportFigure, column = 0, row = 5): string {
  const width = 1000,
    height = Math.round((width * figure.height) / figure.width);
  return (
    decl +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><xdr:oneCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${width * 9525}" cy="${height * 9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Spectrum SVG" descr="Current spectrum view"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdPNG"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdSVG"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width * 9525}" cy="${height * 9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
  );
}
/** Pure worker-safe OOXML export. Numeric data are full-resolution snapshots, never display-normalized or reprocessed. */
export function buildSpectrumWorkbook(
  s: Spectrum,
  selection: Partial<SpectrumReportOptions> = {},
  figure?: SpectrumReportFigure,
): Uint8Array {
  validateSpectrumReportSize(s, selection);
  const options = { ...defaultSpectrumReportOptions(s), ...selection },
    sheets = numericSheets(s, options);
  sheets.push(analysisSheet(s, options));
  if (options.includeFigure) {
    if (
      !figure ||
      !/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/.test(figure.svg) ||
      !figure.png.length ||
      !(figure.width > 0 && figure.height > 0) ||
      !Number.isFinite(figure.width + figure.height)
    )
      throw new Error(
        "The Excel report requires the current SVG and its PNG fallback.",
      );
    if (!s.twoD)
      Object.assign(sheets[0], {
        drawing: true,
        drawingColumn: 4,
        drawingRow: 1,
      });
    const rows: Cell[][] = [
      [],
      [String(s.metadata.title || s.label)],
      ["Figure", "Current spectrum view"],
      ["Format", "Embedded SVG with PNG fallback for older Excel versions."],
    ];
    sheets.push({
      name: "Spectrum figure",
      rows: rows.length,
      columns: 6,
      row: (i) => rows[i],
      headerRows: new Set(),
      titleRows: new Set([1]),
      drawing: true,
    });
  }
  if (options.includeProcessing) sheets.push(processingSheet(s));
  const files: Record<string, Uint8Array> = {},
    overrides: string[] = [];
  let bytes = 0;
  const add = (path: string, value: string | Uint8Array, type?: string) => {
    const encoded = typeof value === "string" ? strToU8(value) : value;
    bytes += encoded.byteLength;
    if (bytes > MAX_XML_BYTES)
      throw new Error(
        "The Excel report exceeds its 192 MiB package limit. Omit imaginary data or export CSV.",
      );
    files[path] = encoded;
    if (type)
      overrides.push(
        `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`,
      );
  };
  add(
    "_rels/.rels",
    relationships([
      { id: "rIdWorkbook", type: "officeDocument", target: "xl/workbook.xml" },
    ]),
  );
  add(
    "xl/workbook.xml",
    decl +
      `<workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "spreadsheetml.sheet.main",
  );
  add(
    "xl/_rels/workbook.xml.rels",
    relationships([
      ...sheets.map((_, i) => ({
        id: `rId${i + 1}`,
        type: "worksheet",
        target: `worksheets/sheet${i + 1}.xml`,
      })),
      { id: "rIdStyles", type: "styles", target: "styles.xml" },
    ]),
  );
  add(
    "xl/styles.xml",
    decl +
      `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.000000E+00"/><numFmt numFmtId="165" formatCode="0.000000"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/><color rgb="FF26313D"/></font><font><b/><sz val="16"/><name val="Arial"/><color rgb="FF86283D"/></font><font><b/><sz val="11"/><name val="Arial"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF303C49"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="165" fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "spreadsheetml.styles",
  );
  sheets.forEach((sheet, i) => {
    add(
      `xl/worksheets/sheet${i + 1}.xml`,
      sheetXML(sheet),
      "spreadsheetml.worksheet",
    );
    if (sheet.drawing && figure) {
      add(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        relationships([
          {
            id: "rIdDrawing",
            type: "drawing",
            target: `../drawings/drawing${i + 1}.xml`,
          },
        ]),
      );
      add(
        `xl/drawings/drawing${i + 1}.xml`,
        drawingXML(figure, sheet.drawingColumn, sheet.drawingRow),
        "drawing",
      );
      add(
        `xl/drawings/_rels/drawing${i + 1}.xml.rels`,
        relationships([
          { id: "rIdPNG", type: "image", target: "../media/spectrum.png" },
          { id: "rIdSVG", type: "image", target: "../media/spectrum.svg" },
        ]),
      );
    }
  });
  if (options.includeFigure && figure) {
    add("xl/media/spectrum.svg", figure.svg);
    add("xl/media/spectrum.png", figure.png);
  }
  add(
    "[Content_Types].xml",
    decl +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>${overrides.join("")}</Types>`,
  );
  return zipSync(files, { level: 6 });
}
/** Drop acquisition/duplicate source arrays before crossing the worker boundary. */
export function spectrumReportSnapshot(s: Spectrum): Spectrum {
  return {
    ...s,
    original: s.data,
    fid: undefined,
    twoDOriginal: undefined,
    twoDRaw: undefined,
  };
}
export function spectrumReportFilename(
  s: Spectrum,
  extension: "xlsx" | "svg",
): string {
  return `${safeFilename(s.label || "spectrum")}-${extension === "xlsx" ? "report" : "spectrum"}.${extension}`;
}
