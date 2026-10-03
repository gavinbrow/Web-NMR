import type { KineticFit, KineticPoint, Spectrum } from "../model";
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
      ["id", "ppm", "height"],
      ...s.peaks.map((p) => [p.id, p.ppm, p.height]),
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
        i.area * s.integralScale,
        s.integralScale,
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
    ...(/^\^?\d+[A-Za-z]+$/.test(s.nucleus) ? [`##.OBSERVE NUCLEUS=^${jcampText(s.nucleus.replace(/^\^/, ""))}`] : []),
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
export function kineticsCSV(points: KineticPoint[], fit?: KineticFit): string {
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
export function exportKineticsCSV(points: KineticPoint[], fit?: KineticFit) {
  return csvDownload(kineticsCSV(points, fit), "kinetics.csv");
}
