import { displayedIntegralValue, integralReportingScale } from "./integrals";
import type { KineticFit, KineticPoint, Spectrum } from "../model";
import type {
  KineticMeasurement,
  KineticsMeasurementOptions,
} from "./kinetics";
import { downloadBlob, safeFilename } from "./project";

/** Quoting alone does not neutralize spreadsheet formulas; guard string cells explicitly. */
export function csvCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function makeCSV(
  rows: (string | number | boolean | undefined)[][],
): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
function csvDownload(text: string, name: string) {
  downloadBlob(
    new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }),
    name,
  );
  return text;
}
export function spectrumCSV(s: Spectrum): string {
  if (s.twoD) {
    const m = s.twoD,
      lines = [
        "F1_ppm/F2_ppm," +
          Array.from(m.x, (x) => x + s.referenceOffset).join(","),
      ];
    for (let row = 0; row < m.height; row++)
      lines.push(
        `${m.y[row] + m.referenceOffsetF1},` +
          Array.from(m.real.subarray(row * m.width, (row + 1) * m.width)).join(
            ",",
          ),
      );
    return lines.join("\r\n");
  }
  const lines = ["ppm,real" + (s.data.imag ? ",imaginary" : "")];
  for (let i = 0; i < s.data.x.length; i++)
    lines.push(
      `${s.data.x[i] + s.referenceOffset},${s.data.real[i]}${s.data.imag ? "," + s.data.imag[i] : ""}`,
    );
  return lines.join("\r\n");
}
export function exportSpectrumCSV(s: Spectrum) {
  return csvDownload(spectrumCSV(s), `${safeFilename(s.label)}-spectrum.csv`);
}
export function analysisCSV(
  s: Spectrum,
  type: "peaks" | "integrals" | "multiplets",
): string {
  // Analysis objects already store the displayed, referenced coordinates.
  if (type === "peaks")
    return makeCSV([
      ["id", "ppm", "height", "annotation"],
      ...s.peaks.map((p) => [p.id, p.ppm, p.height, p.label || ""]),
    ]);
  if (type === "integrals")
    return makeCSV([
      [
        "id",
        "label",
        "from_ppm",
        "to_ppm",
        "signed_area",
        "reported_integral",
        "normalization_factor",
      ],
      ...s.integrals.map((i) => [
        i.id,
        i.label,
        i.from,
        i.to,
        i.area,
        displayedIntegralValue(s, i),
        integralReportingScale(s),
      ]),
    ]);
  return makeCSV([
    [
      "id",
      "label",
      "from_ppm",
      "to_ppm",
      "center_ppm",
      "multiplicity",
      "couplings_Hz",
      "peak_count",
    ],
    ...s.multiplets.map((m) => [
      m.id,
      m.label,
      m.from,
      m.to,
      m.center,
      m.kind,
      m.couplingsHz.join("; "),
      m.peakCount,
    ]),
  ]);
}
export function exportAnalysisCSV(
  s: Spectrum,
  type: "peaks" | "integrals" | "multiplets",
) {
  return csvDownload(
    analysisCSV(s, type),
    `${safeFilename(s.label)}-${type}.csv`,
  );
}
function jcampText(value: unknown) {
  return String(value)
    .replace(/[\r\n\u0000]/g, " ")
    .replace(/##/g, "")
    .replace(/\$\$/g, "")
    .slice(0, 1000);
}
export function spectrumJCAMP(s: Spectrum): string {
  const x = s.data.x,
    y = s.data.real;
  const lines = [
    `##TITLE=${jcampText(s.label)}`,
    "##JCAMP-DX=5.00",
    "##DATA TYPE=NMR SPECTRUM",
    "##DATA CLASS=XYPOINTS",
    "##ORIGIN=Web NMR",
    "##OWNER=",
    "##XUNITS=PPM",
    "##YUNITS=ARBITRARY UNITS",
    "##XFACTOR=1",
    "##YFACTOR=1",
    `##FIRSTX=${x[0] + s.referenceOffset}`,
    `##LASTX=${x[x.length - 1] + s.referenceOffset}`,
    `##NPOINTS=${x.length}`,
    ...(s.frequencyMHz > 0 ? [`##.OBSERVE FREQUENCY=${s.frequencyMHz}`] : []),
    ...(/^\^?\d+[A-Za-z]+$/.test(s.nucleus)
      ? [`##.OBSERVE NUCLEUS=^${jcampText(s.nucleus.replace(/^\^/, ""))}`]
      : []),
    "$$ Real processed data; display gain is excluded.",
    "##XYPOINTS=(XY..XY)",
  ];
  for (let i = 0; i < x.length; i++)
    lines.push(`${x[i] + s.referenceOffset}, ${y[i]}`);
  lines.push("##END=");
  return lines.join("\r\n");
}
export function exportJCAMP(s: Spectrum) {
  const text = spectrumJCAMP(s);
  downloadBlob(
    new Blob([text], { type: "chemical/x-jcamp-dx" }),
    `${safeFilename(s.label)}.jdx`,
  );
  return text;
}
export function xmlText(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
export function exportFigureSVG(svgText: string, label: string) {
  if (!/^\s*<svg[\s>]/.test(svgText))
    throw new Error("A spectrum figure is required.");
  const source = svgText.replace(
    /<svg\b([^>]*)>/,
    (_match, attributes: string) =>
      `<svg${attributes.includes("xmlns=") ? attributes : `${attributes} xmlns="http://www.w3.org/2000/svg"`}><title>${xmlText(label)}</title>`,
  );
  downloadBlob(
    new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', source], {
      type: "image/svg+xml;charset=utf-8",
    }),
    `${safeFilename(label)}.svg`,
  );
}
export interface KineticsExportContext {
  measurements?: KineticMeasurement[];
  options?: KineticsMeasurementOptions;
  stackLabel?: string;
}
export function kineticsCSV(
  points: KineticPoint[],
  fit?: KineticFit,
  context?: KineticsExportContext,
): string {
  const rows: (string | number | boolean | undefined)[][] = [
    [
      "spectrum_id",
      "time_minutes",
      "analytical_value",
      "included",
      "predicted",
      "residual",
    ],
  ];
  if (context?.measurements) {
    rows[0].push(
      "spectrum_label",
      "target_signed_area",
      "standard_signed_area",
      "measurement_mode",
      "measurement_unit",
      "measurement_error",
    );
    const indices = new Map(points.map((p, i) => [p.id, i]));
    for (const row of context.measurements) {
      const index = indices.get(row.id);
      rows.push([
        row.id,
        row.time,
        row.error ? undefined : row.value,
        row.included,
        index === undefined ? undefined : fit?.predicted[index],
        index === undefined ? undefined : fit?.residuals[index],
        row.label,
        row.targetArea,
        row.standardArea,
        row.mode,
        row.unit,
        row.error,
      ]);
    }
  } else
    points.forEach((p, i) =>
      rows.push([
        p.id,
        p.time,
        p.value,
        p.included,
        fit?.predicted[i],
        fit?.residuals[i],
      ]),
    );
  if (context?.stackLabel || context?.options) {
    rows.push([]);
    if (context.stackLabel) rows.push(["stack", context.stackLabel]);
    if (context.options) {
      const o = context.options;
      rows.push(
        ["measurement_mode", o.mode],
        ["target_from_ppm", o.from],
        ["target_to_ppm", o.to],
      );
      if (o.mode !== "area")
        rows.push(
          ["standard_from_ppm", o.standardFrom],
          ["standard_to_ppm", o.standardTo],
          ["target_protons", o.targetProtons ?? 1],
          ["standard_protons", o.standardProtons ?? 1],
        );
      if (o.mode === "concentration")
        rows.push(
          ["standard_concentration", o.standardConcentration],
          ["concentration_unit", o.concentrationUnit ?? "mM"],
        );
    }
  }
  if (fit) {
    rows.push(
      [],
      ["fit_model", fit.model],
      ["r_squared", fit.rSquared],
      ["rmse", fit.rmse],
    );
    Object.entries(fit.parameters).forEach(([key, value]) =>
      rows.push([key, value]),
    );
    if (fit.halfLife !== undefined)
      rows.push(["half_life_minutes", fit.halfLife]);
  }
  return makeCSV(rows);
}
export function exportKineticsCSV(
  points: KineticPoint[],
  fit?: KineticFit,
  context?: KineticsExportContext,
) {
  return csvDownload(kineticsCSV(points, fit, context), "kinetics.csv");
}

/** One CSV contains every target, its measurement context, and its independent fit. */
export function exportKineticTargetsCSV(
  series: import("./kinetics").KineticSeries[],
  options: import("./kinetics").KineticsMeasurementOptions,
  stackLabel?: string,
) {
  const sections = series.map(
    (s) =>
      makeCSV([
        ["target_id", s.target.id],
        ["target_label", s.target.label],
        ["model", s.target.model],
      ]) +
      "\r\n" +
      kineticsCSV(s.points, s.fit ?? undefined, {
        measurements: s.measurements,
        options: {
          ...options,
          from: s.target.from,
          to: s.target.to,
          targetProtons: s.target.protons,
        },
        stackLabel,
      }),
  );
  return csvDownload(sections.join("\r\n\r\n"), "kinetics-targets.csv");
}
