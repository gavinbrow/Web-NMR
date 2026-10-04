import { zipSync, strToU8 } from "fflate";
import type { KineticSeries, KineticsMeasurementOptions } from "./kinetics";
import type { Spectrum } from "../model";

export interface OrderRegression {
  slope: number;
  intercept: number;
  rSquared: number;
  count: number;
}
export function orderRegression(
  points: { time: number; value: number; included: boolean }[],
  order: 1 | 2,
): OrderRegression | null {
  const valid = points.filter(
    (p) =>
      p.included &&
      Number.isFinite(p.time) &&
      Number.isFinite(p.value) &&
      p.value > 0,
  );
  if (valid.length < 2) return null;
  const xs = valid.map((p) => p.time),
    ys = valid.map((p) => (order === 1 ? Math.log(p.value) : 1 / p.value));
  const mx = xs.reduce((a, b) => a + b) / xs.length,
    my = ys.reduce((a, b) => a + b) / ys.length;
  let xx = 0,
    xy = 0,
    yy = 0;
  xs.forEach((x, i) => {
    xx += (x - mx) ** 2;
    xy += (x - mx) * (ys[i] - my);
    yy += (ys[i] - my) ** 2;
  });
  if (xx === 0) return null;
  return {
    slope: xy / xx,
    intercept: my - (xy / xx) * mx,
    rSquared: yy === 0 ? 1 : xy ** 2 / xx / yy,
    count: xs.length,
  };
}
const xml = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (entries: { id: string; type: string; target: string }[]) =>
  decl +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((r) => `<Relationship Id="${r.id}" Type="${rel}/${r.type}" Target="${xml(r.target)}"/>`).join("")}</Relationships>`;
type Cell =
  | string
  | number
  | boolean
  | undefined
  | { formula: string; value: number | string | undefined };
const col = (n: number) => {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
function cell(v: Cell, c: number, r: number, style = 0): string {
  const ref = col(c) + r;
  if (v === undefined) return `<c r="${ref}" s="${style}"/>`;
  if (typeof v === "object")
    return `<c r="${ref}" s="${style}"${typeof v.value === "string" ? ' t="str"' : ""}><f>${xml(v.formula)}</f>${v.value === undefined ? "" : `<v>${xml(v.value)}</v>`}</c>`;
  if (typeof v === "number")
    return Number.isFinite(v)
      ? `<c r="${ref}" s="${style}"><v>${v}</v></c>`
      : `<c r="${ref}"/>`;
  if (typeof v === "boolean")
    return `<c r="${ref}" t="b" s="${style}"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}
function worksheet(rows: Cell[][], drawing = false, freeze = 0): string {
  return (
    decl +
    `<worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="11" width="18" customWidth="1"/><col min="12" max="21" width="12" customWidth="1"/></cols><sheetData>${rows.map((row, i) => `<row r="${i + 1}"${i === 0 ? ' ht="30" customHeight="1"' : ""}>${row.map((v, c) => cell(v, c, i + 1, i === 0 ? 1 : i === 11 ? 2 : typeof v === "number" || typeof v === "object" ? 3 : 0)).join("")}</row>`).join("")}</sheetData>${drawing ? '<drawing r:id="rIdDrawing"/>' : ""}</worksheet>`
  );
}
const title = (text: string) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${xml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
function chart(sheet: string, series: KineticSeries, index: 0 | 1 | 2): string {
  const rows = series.measurements,
    start = 13,
    end = Math.max(start, start + rows.length - 1),
    column = ["L", "F", "G"][index];
  const eligible = rows
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        r.included &&
        !r.error &&
        r.time !== undefined &&
        r.value !== undefined &&
        (index === 0 || r.value > 0),
    );
  const cache = (axis: "x" | "y") =>
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${rows.length}"/>${eligible.map(({ r, i }) => `<c:pt idx="${i}"><c:v>${axis === "x" ? r.time : index === 0 ? r.value : index === 1 ? Math.log(r.value!) : 1 / r.value!}</c:v></c:pt>`).join("")}</c:numCache>`;
  const axis = (id: number, cross: number, pos: string, label: string) =>
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${title(label)}<c:numFmt formatCode="${id === 100 ? "0.##" : "0.###E+00"}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
  const labels = [
    "Measured signal",
    "First order · ln(signal)",
    "Second order · 1/signal",
  ];
  return (
    decl +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><c:lang val="en-US"/><c:chart>${title(series.target.label + " · " + labels[index])}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="marker"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(series.target.label)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${series.target.color.slice(1)}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${index > 0 && eligible.length >= 2 ? '<c:trendline><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>' : ""}<c:xVal><c:numRef><c:f>'${xml(sheet.replace(/'/g, "''"))}'!$A$${start}:$A$${end}</c:f>${cache("x")}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>'${xml(sheet.replace(/'/g, "''"))}'!$${column}$${start}:$${column}$${end}</c:f>${cache("y")}</c:numRef></c:yVal></c:ser><c:axId val="100"/><c:axId val="200"/></c:scatterChart>${axis(100, 200, "b", "Time (min)")}${axis(200, 100, "l", labels[index])}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
}
function anchor(
  row: number,
  id: number,
  relationship: string,
  image = false,
  rows = 17,
): string {
  const from = `<xdr:from><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`,
    to = `<xdr:to><xdr:col>21</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`;
  const shape = image
    ? `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Report figure ${id}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3238500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`
    : `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Kinetics chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${relationship}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  return `<xdr:twoCellAnchor>${from}${to}${shape}<xdr:clientData/></xdr:twoCellAnchor>`;
}
const drawing = (anchors: string[]) =>
  decl +
  `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}">${anchors.join("")}</xdr:wsDr>`;
export interface ReportImage {
  name: string;
  png: Uint8Array;
  width?: number;
  height?: number;
}
/** Browser-native OOXML export; tables and charts remain editable in Excel. */
export function buildKineticsWorkbook(
  name: string,
  series: KineticSeries[],
  options: KineticsMeasurementOptions,
  images: ReportImage[] = [],
): Uint8Array {
  const files: Record<string, Uint8Array> = {},
    overrides: string[] = [];
  const add = (path: string, value: string | Uint8Array, type?: string) => {
    files[path] = typeof value === "string" ? strToU8(value) : value;
    if (type)
      overrides.push(
        `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`,
      );
  };
  const names = [
    "Report",
    ...series.map((s, i) =>
      `${i + 1} ${s.target.label}`.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31),
    ),
  ];
  add(
    "_rels/.rels",
    rels([
      { id: "rIdWorkbook", type: "officeDocument", target: "xl/workbook.xml" },
    ]),
  );
  add(
    "xl/workbook.xml",
    decl +
      `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "spreadsheetml.sheet.main",
  );
  add(
    "xl/_rels/workbook.xml.rels",
    rels([
      ...names.map((_, i) => ({
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
      `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000E+00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/><color rgb="FF25313C"/></font><font><b/><sz val="20"/><name val="Calibri"/><color rgb="FF86283D"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF303C49"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "spreadsheetml.styles",
  );
  const report: Cell[][] = [
    [name + " · Kinetics"],
    ["Created", new Date().toISOString()],
    ["Measurement", options.mode],
    [
      "Unit",
      options.mode === "area"
        ? "intensity·ppm"
        : options.mode === "ratio"
          ? "ratio"
          : options.concentrationUnit || "mM",
    ],
    [
      "Internal standard",
      options.mode === "area"
        ? "None"
        : `${options.standardFrom}–${options.standardTo} ppm`,
    ],
    ["Standard protons", options.standardProtons],
    ["Standard concentration", options.standardConcentration],
    [
      "Method",
      "First order: ln(signal) vs time. Second order: 1/signal vs time.",
    ],
    [
      "Interpretation",
      "Order plots assume a disappearing species, positive signal and no additive offset.",
    ],
    [
      "Calibration",
      "Area/ratio order plots are comparative. Second-order rate units require calibrated concentration.",
    ],
    [
      "Source",
      "Processed signed areas; display gain and integral normalization excluded.",
    ],
    [
      "Target",
      "From (ppm)",
      "To (ppm)",
      "Protons",
      "Fit model",
      "R²",
      "First k (min⁻¹)",
      "First R²",
      "Second k",
      "Second R²",
    ],
  ];
  series.forEach((s, i) => {
    const first = orderRegression(s.points, 1),
      second = orderRegression(s.points, 2);
    report.push([
      s.target.label,
      s.target.from,
      s.target.to,
      s.target.protons,
      s.target.model,
      s.fit?.rSquared,
      {
        formula: `'${names[i + 1].replace(/'/g, "''")}'!B4`,
        value: first ? -first.slope : "",
      },
      {
        formula: `'${names[i + 1].replace(/'/g, "''")}'!B5`,
        value: first?.rSquared ?? "",
      },
      {
        formula: `'${names[i + 1].replace(/'/g, "''")}'!B6`,
        value: second?.slope ?? "",
      },
      {
        formula: `'${names[i + 1].replace(/'/g, "''")}'!B7`,
        value: second?.rSquared ?? "",
      },
    ]);
  });
  images.forEach((img, i) => add(`xl/media/image${i + 1}.png`, img.png));
  add(
    "xl/worksheets/sheet1.xml",
    worksheet(report, images.length > 0, 12),
    "spreadsheetml.worksheet",
  );
  if (images.length) {
    add(
      "xl/worksheets/_rels/sheet1.xml.rels",
      rels([
        {
          id: "rIdDrawing",
          type: "drawing",
          target: "../drawings/drawing1.xml",
        },
      ]),
    );
    add(
      "xl/drawings/drawing1.xml",
      drawing(
        images.map((img, i) =>
          anchor(
            images
              .slice(0, i)
              .reduce(
                (sum, p) =>
                  sum +
                  Math.ceil(
                    (640 * (p.height ?? 640)) / (p.width ?? 1200) / 26.7,
                  ) +
                  2,
                1,
              ),
            i + 1,
            `rIdImage${i + 1}`,
            true,
            Math.ceil((640 * (img.height ?? 640)) / (img.width ?? 1200) / 26.7),
          ),
        ),
      ),
      "drawing",
    );
    add(
      "xl/drawings/_rels/drawing1.xml.rels",
      rels(
        images.map((_, i) => ({
          id: `rIdImage${i + 1}`,
          type: "image",
          target: `../media/image${i + 1}.png`,
        })),
      ),
    );
  }
  series.forEach((s, i) => {
    const first = orderRegression(s.points, 1),
      second = orderRegression(s.points, 2),
      sheet = names[i + 1],
      n = i + 2,
      end = Math.max(13, 12 + s.measurements.length);
    const rows: Cell[][] = [
      [s.target.label],
      ["Region (ppm)", s.target.from, s.target.to],
      ["Signal protons", s.target.protons],
      [
        "First-order k",
        {
          formula: `IFERROR(-SLOPE(F13:F${end},A13:A${end}),"")`,
          value: first ? -first.slope : "",
        },
        "min⁻¹",
      ],
      [
        "First-order R²",
        {
          formula: `IFERROR(RSQ(F13:F${end},A13:A${end}),"")`,
          value: first?.rSquared ?? "",
        },
      ],
      [
        "Second-order k",
        {
          formula: `IFERROR(SLOPE(G13:G${end},A13:A${end}),"")`,
          value: second?.slope ?? "",
        },
        options.mode === "concentration"
          ? `${options.concentrationUnit || "mM"}⁻¹ min⁻¹`
          : "signal⁻¹ min⁻¹",
      ],
      [
        "Second-order R²",
        {
          formula: `IFERROR(RSQ(G13:G${end},A13:A${end}),"")`,
          value: second?.rSquared ?? "",
        },
      ],
      [
        "Nonlinear fit",
        s.fit?.model ?? "Not available",
        s.fit?.parameters.rate,
        s.fit?.rSquared,
      ],
      [
        "Order fit selection",
        "Only included, valid, positive measurements. Raw signal plot includes negative values.",
      ],
      [
        "Assumptions",
        "First/second order linearizations assume no offset and reactant decay.",
      ],
      ["Source", "Full precision values; editable Excel formulas and charts."],
      [
        "Time (min)",
        "Measurement",
        "Included",
        "Target area",
        "Standard area",
        "ln(signal)",
        "1/signal",
        "Fitted value",
        "Residual",
        "Status",
        "Spectrum",
        "Plot signal",
      ],
    ];
    s.measurements.forEach((r, j) => {
      const rn = j + 13,
        p = s.points.findIndex((p) => p.id === r.id),
        valid = r.included && !r.error && r.value !== undefined && r.value > 0;
      rows.push([
        r.time,
        r.error ? undefined : r.value,
        r.included && !r.error,
        r.targetArea,
        r.standardArea,
        {
          formula: `IF(AND(C${rn},ISNUMBER(B${rn}),B${rn}>0),LN(B${rn}),"")`,
          value: valid ? Math.log(r.value!) : "",
        },
        {
          formula: `IF(AND(C${rn},ISNUMBER(B${rn}),B${rn}>0),1/B${rn},"")`,
          value: valid ? 1 / r.value! : "",
        },
        p >= 0 ? s.fit?.predicted[p] : undefined,
        p >= 0 ? s.fit?.residuals[p] : undefined,
        r.error ?? (r.included ? "Included" : "Excluded"),
        r.label,
        {
          formula: `IF(AND(C${rn},ISNUMBER(B${rn})),B${rn},"")`,
          value: r.included && !r.error ? r.value : "",
        },
      ]);
    });
    add(
      `xl/worksheets/sheet${n}.xml`,
      worksheet(rows, true, 12),
      "spreadsheetml.worksheet",
    );
    add(
      `xl/worksheets/_rels/sheet${n}.xml.rels`,
      rels([
        {
          id: "rIdDrawing",
          type: "drawing",
          target: `../drawings/drawing${n}.xml`,
        },
      ]),
    );
    add(
      `xl/drawings/drawing${n}.xml`,
      drawing(
        [0, 1, 2].map((j) => anchor(1 + j * 19, j + 1, `rIdChart${j + 1}`)),
      ),
      "drawing",
    );
    add(
      `xl/drawings/_rels/drawing${n}.xml.rels`,
      rels(
        [0, 1, 2].map((j) => ({
          id: `rIdChart${j + 1}`,
          type: "chart",
          target: `../charts/chart${i * 3 + j + 1}.xml`,
        })),
      ),
    );
    ([0, 1, 2] as const).forEach((j) =>
      add(
        `xl/charts/chart${i * 3 + j + 1}.xml`,
        chart(sheet, s, j),
        "drawingml.chart",
      ),
    );
  });
  add(
    "[Content_Types].xml",
    decl +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join("")}</Types>`,
  );
  return zipSync(files, { level: 6 });
}

export function reportPlotSVG(
  series: KineticSeries[],
  order: 0 | 1 | 2 = 0,
): string {
  const sets = series.map((s) => ({
    s,
    points: s.points
      .filter((p) => p.included && (order === 0 || p.value > 0))
      .map((p) => ({
        x: p.time,
        y:
          order === 0 ? p.value : order === 1 ? Math.log(p.value) : 1 / p.value,
      })),
    regression: order ? orderRegression(s.points, order) : null,
  }));
  const all = sets.flatMap((s) => s.points),
    xs = all.map((p) => p.x),
    ys = all.map((p) => p.y);
  let x0 = Math.min(0, ...xs),
    x1 = Math.max(1, ...xs),
    y0 = ys.length ? Math.min(...ys) : 0,
    y1 = ys.length ? Math.max(...ys) : 1;
  if (y0 === y1) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const margin = (y1 - y0) * 0.08;
  y0 -= margin;
  y1 += margin;
  const px = (x: number) => 90 + ((x - x0) / (x1 - x0)) * 1060,
    py = (y: number) =>
      550 -
      ((y - y0) / (y1 - y0)) *
        (550 - Math.max(105, 85 + Math.ceil(sets.length / 4) * 18));
  const yLabel =
    order === 0 ? "Measured signal" : order === 1 ? "ln(signal)" : "1/signal";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640"><rect width="1200" height="640" fill="white"/><g font-family="Arial" fill="#303c49"><text x="90" y="36" font-size="23">${order === 0 ? "Kinetics" : order === 1 ? "First-order plot" : "Second-order plot"}</text>${sets.map(({ s }, i) => `<text x="${90 + (i % 4) * 260}" y="${65 + Math.floor(i / 4) * 18}" font-size="13" fill="${s.target.color}">${xml(s.target.label)}</text>`).join("")}${Array.from(
    { length: 6 },
    (_, i) => {
      const x = x0 + ((x1 - x0) * i) / 5,
        y = y0 + ((y1 - y0) * i) / 5;
      return `<path d="M${px(x)} ${Math.max(105, 85 + Math.ceil(sets.length / 4) * 18)}V550 M90 ${py(y)}H1150" stroke="#e2e6ec"/><text x="${px(x)}" y="575" text-anchor="middle" font-size="13">${Number(x.toPrecision(4))}</text><text x="80" y="${py(y) + 4}" text-anchor="end" font-size="13">${Number(y.toPrecision(4))}</text>`;
    },
  ).join(
    "",
  )}<path d="M90 ${Math.max(105, 85 + Math.ceil(sets.length / 4) * 18)}V550H1150" fill="none" stroke="#687582"/>${sets
    .map(
      ({ s, points, regression }) =>
        `${points.map((p) => `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="4" fill="${s.target.color}"/>`).join("")}${
          regression
            ? `<path d="M${px(x0)} ${py(regression.intercept + regression.slope * x0)}L${px(x1)} ${py(regression.intercept + regression.slope * x1)}" stroke="${s.target.color}" fill="none"/>`
            : order === 0 && s.fit
              ? `<polyline fill="none" stroke="${s.target.color}" points="${s.points
                  .filter((p) => p.included)
                  .map((p) => {
                    const j = s.points.findIndex((q) => q.id === p.id);
                    return `${px(p.time)},${py(s.fit!.predicted[j])}`;
                  })
                  .join(" ")}"/>`
              : ""
        }`,
    )
    .join(
      "",
    )}<text x="620" y="615" text-anchor="middle" font-size="16">Time (min)</text><text transform="translate(24,330) rotate(-90)" text-anchor="middle" font-size="16">${xml(yLabel)}</text></g></svg>`;
}
export function reportSpectraSVG(
  spectra: Spectrum[],
  series: KineticSeries[],
): string {
  const list = spectra.filter((s) => !s.twoD),
    high = Math.max(...list.map((s) => s.data.x[0] + s.referenceOffset)),
    low = Math.min(...list.map((s) => s.data.x.at(-1)! + s.referenceOffset)),
    height = Math.max(450, 100 + list.length * 75),
    px = (x: number) => 80 + ((high - x) / (high - low)) * 1050;
  const lines = list.map((s, i) => {
    let max = 0;
    for (const v of s.data.real) max = Math.max(max, Math.abs(v));
    const y = height - 75 - i * 75,
      stride = Math.max(1, Math.floor(s.data.x.length / 2400));
    let d = "";
    for (let start = 0; start < s.data.x.length; start += stride) {
      const end = Math.min(s.data.x.length, start + stride);
      let min = start,
        maxIndex = start;
      for (let j = start + 1; j < end; j++) {
        if (s.data.real[j] < s.data.real[min]) min = j;
        if (s.data.real[j] > s.data.real[maxIndex]) maxIndex = j;
      }
      for (const j of [...new Set([start, min, maxIndex, end - 1])].sort(
        (a, b) => a - b,
      ))
        d += `${d ? "L" : "M"}${px(s.data.x[j] + s.referenceOffset).toFixed(2)} ${(y - (s.data.real[j] / (max || 1)) * 60).toFixed(2)}`;
    }
    return `<path d="${d}" stroke="${s.color}" fill="none" stroke-width=".8"/><text x="1120" y="${y - 5}" text-anchor="end" fill="${s.color}" font-size="12">${xml(s.label)} · ${s.timeMinutes ?? "?"} min</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="white"/><g font-family="Arial"><text x="80" y="28" font-size="21" fill="#303c49">Spectra · individual display normalization</text>${series.map((s) => `<rect x="${px(Math.max(s.target.from, s.target.to))}" y="45" width="${Math.abs(px(s.target.to) - px(s.target.from))}" height="${height - 100}" fill="${s.target.color}" fill-opacity=".08"/>`).join("")}${lines.join("")}<path d="M80 ${height - 45}H1130" stroke="#687582"/>${Array.from(
    { length: 9 },
    (_, i) => {
      const p = high - ((high - low) * i) / 8;
      return `<text x="${px(p)}" y="${height - 27}" text-anchor="middle" font-size="12" fill="#687582">${p.toFixed(2)}</text>`;
    },
  ).join(
    "",
  )}<text x="600" y="${height - 7}" text-anchor="middle" font-size="13" fill="#303c49">Chemical shift (ppm)</text></g></svg>`;
}
export async function svgReportImage(
  svg: string,
  name: string,
): Promise<ReportImage> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render report figure."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not export report image.")),
        "image/png",
      ),
    );
    return {
      name,
      png: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function downloadReport(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: name.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/zip",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function reportImagesZip(images: ReportImage[]) {
  return zipSync(
    Object.fromEntries(images.map((image) => [image.name + ".png", image.png])),
    { level: 1 },
  );
}
