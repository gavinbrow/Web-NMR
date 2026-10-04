import { unzipSync } from "fflate";
import {
  colors,
  defaultRecipe,
  uid,
  type ComplexData,
  type FidData,
  type ImportEntry,
  type ImportResult,
  type Spectrum,
  type SpectrumStack,
} from "../model";
import {
  processSpectrum,
  correctDigitalFilter,
  nextPowerOfTwo,
  brukerPhaseCorrection,
  applyPhase,
} from "./numerics";
import { importMnovaJson, isMnovaJsonDataset } from "./mnovaJson";
import { transformRawTwoD } from "./twoDProcessing";
import { maximumProjection, readRawTwoD, readProcessedTwoD } from "./twoD";

type Params = Record<string, string | number>;
const decoder = new TextDecoder();
const MAX_BYTES = 256 * 1024 * 1024;
const basename = (path: string) => path.split("/").pop() || path;
const dirname = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
/** Bruker uses the first title line and all following lines as the comment. */
export function parseBrukerTitle(text: string): Params {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trimEnd();
  const lines = normalized.split("\n");
  const title = (lines[0] || "").trim().slice(0, 100_000);
  const comments = lines.slice(1).join("\n").trimEnd().slice(0, 100_000);
  return {
    title,
    comments,
    Title: title,
    Comment: comments,
    sourceTitle: normalized.slice(0, 100_000),
  };
}
export function parseBrukerParameters(text: string): Params {
  const p: Params = {};
  for (const match of text.matchAll(/^##\$([\w]+)\s*=\s*([^\r\n]*)/gm)) {
    const v = match[2].trim();
    if (v.startsWith("(")) continue;
    p[match[1]] = /^[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?$/.test(v)
      ? Number(v)
      : v.replace(/^<|>$/g, "");
  }
  return p;
}
function number(p: Params, key: string, positive = false): number {
  const value = Number(p[key]);
  if (!Number.isFinite(value) || (positive && value <= 0))
    throw new Error(`Missing or invalid Bruker parameter ${key}.`);
  return value;
}
function binary(
  buffer: ArrayBuffer,
  count: number,
  byteOrder: number,
  type: number,
  scale = 1,
): Float64Array {
  if (![0, 1].includes(byteOrder))
    throw new Error("Unsupported binary byte order.");
  if (![0, 2].includes(type))
    throw new Error(
      `Unsupported Bruker numeric type ${type}; int32 and float64 are supported.`,
    );
  const bytes = type === 2 ? 8 : 4;
  if (
    !Number.isInteger(count) ||
    count < 2 ||
    count > 4_194_304 ||
    count * bytes > buffer.byteLength
  )
    throw new Error("Binary sample count is invalid or the file is truncated.");
  const view = new DataView(buffer),
    values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    values[i] =
      (type === 2
        ? view.getFloat64(i * bytes, byteOrder === 0)
        : view.getInt32(i * bytes, byteOrder === 0)) * scale;
    if (!Number.isFinite(values[i]))
      throw new Error("Binary data contain non-finite samples.");
  }
  return values;
}
function createSpectrum(
  label: string,
  sourceFormat: string,
  original: ComplexData,
  metadata: Params,
  frequencyMHz: number,
  nucleus: string,
  index: number,
): Spectrum {
  const recipe = defaultRecipe();
  recipe.window = "none";
  recipe.pivotPpm = original.x[Math.floor(original.x.length / 2)] || 0;
  return {
    id: uid(),
    label,
    color: colors[index % colors.length],
    nucleus,
    frequencyMHz,
    sourceFormat,
    metadata,
    original,
    data: original,
    recipe,
    referenceOffset: 0,
    peaks: [],
    integrals: [],
    multiplets: [],
    integralScale: 1,
    gain: 1,
    visible: true,
    history: ["Imported source"],
    revision: 0,
  };
}
function readProcessed(
  realFile: ArrayBuffer,
  imagFile: ArrayBuffer | undefined,
  p: Params,
): ComplexData {
  const size = number(p, "SI", true),
    sf = number(p, "SF", true),
    sw = number(p, "SW_p", true),
    offset = number(p, "OFFSET");
  if (
    (p.STSR !== undefined && number(p, "STSR") !== 0) ||
    (p.STSI !== undefined &&
      number(p, "STSI") !== 0 &&
      number(p, "STSI") !== size)
  )
    throw new Error(
      "Cropped Bruker STSR/STSI spectra are not supported. Export a full processed spectrum.",
    );
  const scale = 2 ** number(p, "NC_proc"),
    type = number(p, "DTYPP"),
    order = number(p, "BYTORDP");
  const real = binary(realFile, size, order, type, scale),
    imag = imagFile ? binary(imagFile, size, order, type, scale) : undefined;
  // TopSpin's saved 1i is conjugated relative to our positive-exponential FFT.
  // Preserve 1r exactly and convert the imaginary sign for subsequent phase edits.
  if (imag) for (let i = 0; i < imag.length; i++) imag[i] = -imag[i];
  const x = new Float64Array(size);
  for (let i = 0; i < size; i++) x[i] = offset - (i * sw) / (size * sf);
  return { x, real, imag };
}
function readFid(
  buffer: ArrayBuffer,
  a: Params,
  p?: Params,
): { fid: FidData; frequency: number } {
  if (![1, 3].includes(number(a, "AQ_mod")))
    throw new Error(
      "Only complex 1D Bruker AQ_mod 1 or 3 acquisition is supported.",
    );
  if (Number(a.FnTYPE) === 2)
    throw new Error("Non-uniformly sampled acquisitions are not supported.");
  const td = number(a, "TD", true);
  if (td % 2) throw new Error("Complex FID TD must be even.");
  const raw = binary(buffer, td, number(a, "BYTORDA"), number(a, "DTYPA"));
  const size = td / 2,
    real = new Float64Array(size),
    imag = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    real[i] = raw[2 * i];
    imag[i] = raw[2 * i + 1];
  }
  const sfo = number(a, "SFO1", true),
    frequency = p ? number(p, "SF", true) : sfo;
  const sw = number(a, "SW_h", true),
    carrierPpm = p
      ? ((sfo - frequency) * 1e6) / frequency
      : number(a, "O1") / frequency;
  const gd = Number(a.GRPDLY),
    groupDelay =
      Number.isFinite(gd) && gd >= 0 ? gd : Number(a.DSPFVS) >= 14 ? 0 : NaN;
  return {
    fid: {
      real,
      imag,
      dwellSeconds: 1 / sw,
      spectralWidthHz: sw,
      carrierPpm,
      groupDelay,
    },
    frequency,
  };
}
function sortedData(x: number[], y: number[], imag?: number[]): ComplexData {
  if (x.length < 2 || x.length > 4_194_304 || x.length !== y.length)
    throw new Error("A spectrum requires 2–4 million matching samples.");
  if (
    x.some(
      (v, i) =>
        !Number.isFinite(v) ||
        !Number.isFinite(y[i]) ||
        (imag && !Number.isFinite(imag[i])),
    )
  )
    throw new Error("Spectrum contains invalid numbers.");
  const rows = x
    .map((ppm, i) => ({ ppm, real: y[i], imag: imag?.[i] }))
    .sort((a, b) => b.ppm - a.ppm);
  if (rows.some((r, i) => i > 0 && r.ppm === rows[i - 1].ppm))
    throw new Error("Chemical-shift positions must be unique.");
  return {
    x: Float64Array.from(rows.map((r) => r.ppm)),
    real: Float64Array.from(rows.map((r) => r.real)),
    imag: imag ? Float64Array.from(rows.map((r) => r.imag!)) : undefined,
  };
}
function readText(text: string): ComplexData {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*[#;]/.test(l));
  const x: number[] = [],
    real: number[] = [],
    imaginary: number[] = [];
  let hasImag = false;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]
      .trim()
      .split(/[,\t\s]+/)
      .map(Number);
    if (i === 0 && row.some((v) => !Number.isFinite(v))) continue;
    if (
      row.length < 2 ||
      row.length > 3 ||
      row.some((v) => !Number.isFinite(v))
    )
      throw new Error(
        `Invalid spectrum row ${i + 1}; expected ppm, intensity, optional imaginary.`,
      );
    x.push(row[0]);
    real.push(row[1]);
    hasImag ||= row.length === 3;
    imaginary.push(row[2] ?? 0);
  }
  return sortedData(x, real, hasImag ? imaginary : undefined);
}
/** Basic JCAMP-DX AFFN XYPOINTS or XYDATA X++(Y..Y), ppm only; compressed/NTUPLES explicitly rejected. */
function readJcamp(text: string): { data: ComplexData; parameters: Params } {
  const p: Params = {};
  let mode = "",
    inData = false;
  const rows: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("##")) {
      const m = line.match(/^##([^=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toUpperCase().replace(/\s+/g, ""),
        value = m[2].trim();
      p[key] = value;
      if (key === "NTUPLES" || key === "DATATABLE")
        throw new Error(
          "JCAMP NTUPLES is unsupported. Export AFFN XYPOINTS in ppm.",
        );
      if (key === "XYPOINTS" || key === "XYDATA") {
        mode = key;
        inData = true;
      } else inData = false;
    } else if (inData && line.trim() && !line.trim().startsWith("$$"))
      rows.push(line.split("$$")[0]);
  }
  if (String(p.XUNITS).toUpperCase() !== "PPM")
    throw new Error(
      "JCAMP XUNITS must be PPM; Hz axes require referencing metadata.",
    );
  if (!mode) throw new Error("JCAMP requires AFFN XYPOINTS or XYDATA.");
  const xf = p.XFACTOR === undefined ? 1 : Number(p.XFACTOR),
    yf = p.YFACTOR === undefined ? 1 : Number(p.YFACTOR),
    x: number[] = [],
    y: number[] = [];
  const n = Number(p.NPOINTS),
    first = Number(p.FIRSTX),
    last = Number(p.LASTX),
    step = n > 1 ? (last - first) / (n - 1) : NaN;
  for (const row of rows) {
    const values = row
      .trim()
      .split(/[,;\s]+/)
      .map(Number);
    if (values.some((v) => !Number.isFinite(v)))
      throw new Error(
        "Compressed JCAMP SQZ/DIF/DUP data are unsupported. Export uncompressed AFFN data.",
      );
    if (mode === "XYPOINTS") {
      if (values.length % 2) throw new Error("Invalid JCAMP XYPOINTS pairs.");
      for (let i = 0; i < values.length; i += 2) {
        x.push(values[i] * xf);
        y.push(values[i + 1] * yf);
      }
    } else {
      if (!Number.isFinite(step))
        throw new Error("JCAMP XYDATA requires FIRSTX, LASTX and NPOINTS.");
      const start = values[0] * xf;
      for (let i = 1; i < values.length; i++) {
        x.push(start + (i - 1) * step);
        y.push(values[i] * yf);
      }
    }
  }
  if (Number.isFinite(n) && n !== x.length)
    throw new Error("JCAMP declared point count does not match its data.");
  return { data: sortedData(x, y), parameters: p };
}

export function importEntries(input: ImportEntry[]): ImportResult {
  const spectra: Spectrum[] = [],
    stacks: SpectrumStack[] = [],
    warnings: string[] = [],
    entries: ImportEntry[] = [];
  let total = 0;
  let importedView: [number, number] | undefined;
  let importedName: string | undefined;
  for (const entry of input) {
    if (/\.(zip|mnjs)$/i.test(entry.path)) {
      let expandedBytes = 0;
      const expanded = unzipSync(new Uint8Array(entry.data), {
        filter: (file) => {
          if (file.name.split("/").includes("..")) {
            warnings.push(`Ignored unsafe archive path: ${file.name}`);
            return false;
          }
          expandedBytes += file.originalSize;
          if (expandedBytes > MAX_BYTES)
            throw new Error(
              "Uncompressed ZIP exceeds the 256 MB local import limit.",
            );
          return true;
        },
      });
      for (const [path, data] of Object.entries(expanded))
        if (!path.endsWith("/"))
          entries.push({
            path: /\.mnjs$/i.test(entry.path) ? `${entry.path}/${path}` : path,
            data: data.slice().buffer as ArrayBuffer,
          });
    } else entries.push(entry);
  }
  const files = new Map<string, ArrayBuffer>();
  for (const entry of entries) {
    total += entry.data.byteLength;
    if (total > MAX_BYTES)
      throw new Error("Upload exceeds the 256 MB local import limit.");
    const path = entry.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (path.split("/").includes("..")) {
      warnings.push(`Ignored unsafe archive path: ${path}`);
      continue;
    }
    if (files.has(path)) {
      warnings.push(
        `Duplicate path ignored: ${path}. Use a folder or ZIP to preserve experiment directories.`,
      );
      continue;
    }
    files.set(path, entry.data);
  }
  for (const [path, buffer] of files) {
    if (!/\.json$/i.test(path) || !isMnovaJsonDataset(buffer)) continue;
    if (
      path.endsWith("/data.json") ||
      path.includes("/pages/") ||
      path.includes("/items/")
    )
      continue;
    try {
      const imported = importMnovaJson(files, path);
      spectra.push(...imported.spectra);
      warnings.push(...imported.warnings);
      stacks.push(...(imported.stacks || []));
      importedView ??= imported.view;
      importedName ??= imported.projectName;
    } catch (e) {
      warnings.push(
        `${basename(path)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const params = (path: string) =>
    files.has(path)
      ? parseBrukerParameters(decoder.decode(files.get(path)))
      : undefined;
  const titleMetadata = (root: string, processingPath?: string): Params => {
    const buffer =
      (processingPath && files.get(join(processingPath, "title"))) ||
      files.get(join(root, "title")) ||
      files.get(join(root, "pdata/1/title"));
    if (!buffer) return {};
    return parseBrukerTitle(decoder.decode(buffer));
  };
  const roots = new Set<string>();
  for (const path of files.keys()) {
    if (["acqus", "fid", "ser", "acqu2s"].includes(basename(path)))
      roots.add(dirname(path));
    if (basename(path) === "1r" || basename(path) === "2rr")
      roots.add(
        path.includes("/pdata/")
          ? path.slice(0, path.indexOf("/pdata/"))
          : dirname(path),
      );
  }
  for (const root of roots) {
    const label = basename(root) || "Imported spectrum";
    try {
      const processedPaths = [...files.keys()]
        .filter(
          (path) =>
            (path.startsWith(join(root, "pdata") + "/") ||
              dirname(path) === root) &&
            ["1r", "2rr"].includes(basename(path)),
        )
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (
        files.has(join(root, "ser")) ||
        files.has(join(root, "acqu2s")) ||
        processedPaths.some((p) => basename(p) === "2rr")
      ) {
        const acquisition = params(join(root, "acqus")),
          acquisitionF1 = params(join(root, "acqu2s"));
        const planePath = processedPaths.find(
            (path) => basename(path) === "2rr",
          ),
          processingPath = planePath ? dirname(planePath) : undefined;
        const p2 = processingPath
          ? params(join(processingPath, "procs"))
          : params(join(root, "pdata/1/procs"));
        const p1 = processingPath
          ? params(join(processingPath, "proc2s"))
          : params(join(root, "pdata/1/proc2s"));
        const title = titleMetadata(root, processingPath),
          experiment = String(
            acquisition?.PULPROG || title.comments || "2D NMR",
          );
        if (
          files.has(join(root, "acqu3s")) ||
          (processingPath && files.has(join(processingPath, "proc3s")))
        )
          throw new Error(
            "3D and higher spectra are not supported. Import a processed 2D plane.",
          );
        let twoD;
        if (planePath) {
          if (!p2 || !p1)
            throw new Error(
              "Processed 2rr requires matching procs and proc2s parameters.",
            );
          twoD = readProcessedTwoD(
            {
              rr: files.get(planePath)!,
              ri: files.get(join(processingPath!, "2ri")),
              ir: files.get(join(processingPath!, "2ir")),
              ii: files.get(join(processingPath!, "2ii")),
            },
            p2,
            p1,
            acquisitionF1,
            experiment,
          );
        } else {
          const ser = files.get(join(root, "ser"));
          if (!ser || !acquisition || !acquisitionF1)
            throw new Error(
              "Raw ser requires acqus and acqu2s, or upload processed 2rr + procs + proc2s. No data were flattened.",
            );
          const raw = readRawTwoD(
            ser,
            acquisition,
            acquisitionF1,
            p2,
            p1,
            experiment,
          );
          const f2 = defaultRecipe(),
            f1 = defaultRecipe();
          f2.window = f1.window = "none";
          f2.pivotPpm = raw.carrierPpmF2;
          f1.pivotPpm = raw.carrierPpmF1;
          twoD = transformRawTwoD(
            raw,
            p2 ? number(p2, "SF", true) : number(acquisition, "SFO1", true),
            {
              transform: true,
              digitalFilter: true,
              magnitude: true,
              reconstructImaginary: false,
              f2,
              f1,
            },
          );
          warnings.push(
            `${label}: raw ${twoD.acquisitionMode} transformed as a 2D magnitude spectrum. Peak signs and phase-sensitive intensities are not preserved; use processed 2rr for absorption contours.${twoD.acquisitionMode === "QF" ? " QF has no acquired indirect quadrature and retains mirrored F1 responses." : ""}`,
          );
        }
        const frequency = p2
            ? number(p2, "SF", true)
            : number(acquisition!, "SFO1", true),
          projection = maximumProjection(twoD);
        const metadata: Params = {
          ...(acquisition || {}),
          ...(p2 || {}),
          ...Object.fromEntries(
            Object.entries(acquisitionF1 || {}).map(([key, value]) => [
              `F1_${key}`,
              value,
            ]),
          ),
          ...title,
          importPath: root,
          processingPath: processingPath || "raw ser magnitude",
          dimensions: 2,
          projection: "F2 maximum absolute intensity, retaining sign",
          twoDProcessing: twoD.source,
          ...(planePath
            ? {
                imaginaryConvention:
                  "Bruker 2ir→imagF2 and 2ri→imagF1 conjugated to positive-FFT convention; real2rr and double-imaginary2ii unchanged",
              }
            : {}),
        };
        const spectrum = createSpectrum(
          label,
          twoD.source,
          projection,
          metadata,
          frequency,
          String(acquisition?.NUC1 || p2?.AXNUC || "unknown"),
          spectra.length,
        );
        spectrum.twoD = twoD;
        spectrum.twoDOriginal = twoD;
        const ser = files.get(join(root, "ser"));
        if (ser && acquisition && acquisitionF1) {
          try {
            spectrum.twoDRaw = readRawTwoD(
              ser,
              acquisition,
              acquisitionF1,
              p2,
              p1,
              experiment,
            );
          } catch (e) {
            warnings.push(
              `${label}: 2D spectrum retained; raw reprocessing source unavailable: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        spectrum.history.push(
          planePath
            ? "Imported processed 2D matrix; vendor phase and baseline preserved"
            : "Raw 2D quadrature, digital filter, per-dimension FT and magnitude",
        );
        spectra.push(spectrum);
        if (processedPaths.length > 1)
          warnings.push(
            `${label}: ${processedPaths.length} processing versions found; opened ${processingPath}.`,
          );
        continue;
      }
      const a = params(join(root, "acqus")),
        processed = processedPaths.find((p) => basename(p) === "1r");
      let p = processed ? params(join(dirname(processed), "procs")) : undefined;
      if (processed && !p)
        throw new Error(
          "Processed 1r requires its matching procs parameter file.",
        );
      if (!p) p = params(join(root, "pdata/1/procs"));
      const fidFile = files.get(join(root, "fid"));
      let raw: { fid: FidData; frequency: number } | undefined;
      if (fidFile) {
        try {
          if (!a) throw new Error("Raw fid requires matching acqus.");
          raw = readFid(fidFile, a, p);
        } catch (e) {
          if (!processed) throw e;
          warnings.push(
            `${label}: processed spectrum retained; raw reprocessing source unavailable: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (!processed && !raw) continue;
      const metadata: Params = {
        ...(a || {}),
        ...(p || {}),
        importPath: root,
        processingPath: processed ? dirname(processed) : "raw",
        digitalFilterMethod:
          "full GRPDLY centered-frequency shift with tail compensation",
        processingSource: processed
          ? "Vendor processed 1r/1i; existing phase and baseline retained"
          : "Raw FID",
        ...(p
          ? {
              vendorPhase0Deg: Number(p?.PHC0) || 0,
              vendorPhase1Deg: Number(p?.PHC1) || 0,
              vendorBaselineParameters: [
                "BC_mod",
                "ABSF1",
                "ABSF2",
                "ABSG",
                "BCFW",
              ]
                .filter((key) => p?.[key] !== undefined)
                .map((key) => `${key}=${p![key]}`)
                .join("; "),
            }
          : {}),
        ...titleMetadata(root, processed ? dirname(processed) : undefined),
      };
      const data = processed
        ? readProcessed(
            files.get(processed)!,
            files.get(join(dirname(processed), "1i")),
            p!,
          )
        : { x: new Float64Array(0), real: new Float64Array(0) };
      if (processed && data.imag)
        metadata.imaginaryConvention =
          "Saved TopSpin 1i conjugated to positive-FFT convention; real 1r unchanged";
      const frequency = processed ? number(p!, "SF", true) : raw!.frequency;
      const s = createSpectrum(
        label,
        "Bruker",
        data,
        metadata,
        frequency,
        String(a?.NUC1 || p?.AXNUC || "unknown"),
        spectra.length,
      );
      if (raw) {
        s.fid = raw.fid;
        if (!Number.isFinite(raw.fid.groupDelay))
          warnings.push(
            `${label}: GRPDLY missing for a legacy digital filter. Automatic correction cannot run.`,
          );
      }
      if (!processed) {
        s.recipe.transform = true;
        s.recipe.pivotPpm = raw!.fid.carrierPpm;
        if (p) {
          const window = Number(p.WDW),
            lb = Number(p.LB);
          if (window === 0) s.recipe.window = "none";
          else if (window === 1 && Number.isFinite(lb) && lb >= 0) {
            s.recipe.window = "exponential";
            s.recipe.lbHz = lb;
          } else if (p.WDW !== undefined)
            warnings.push(
              `${label}: saved window WDW=${p.WDW} cannot be reproduced by the supported windows; no alternative apodization was substituted.`,
            );
          const count =
            s.recipe.digitalFilter && Number.isFinite(raw!.fid.groupDelay)
              ? correctDigitalFilter(raw!.fid).real.length
              : raw!.fid.real.length;
          const baseSize = nextPowerOfTwo(count),
            factor = Number(p.SI) / baseSize;
          if ([1, 2, 4, 8, 16, 32].includes(factor)) s.recipe.zeroFill = factor;
          else if (p.SI !== undefined)
            warnings.push(
              `${label}: saved SI=${p.SI} cannot be matched by supported zero filling; using ${nextPowerOfTwo(count * s.recipe.zeroFill)} points.`,
            );
          s.metadata.rawProcessingParameters = `WDW=${p.WDW ?? "unknown"}; LB=${p.LB ?? "unknown"}; SI=${p.SI ?? "unknown"}; PHC0=${p.PHC0 ?? "unknown"}; PHC1=${p.PHC1 ?? "unknown"}`;
        }
        s.original = processSpectrum(s);
        if (
          p &&
          Number.isFinite(Number(p.PHC0)) &&
          Number.isFinite(Number(p.PHC1))
        ) {
          Object.assign(
            s.recipe,
            brukerPhaseCorrection(
              s.original,
              Number(p.PHC0),
              Number(p.PHC1),
              s.referenceOffset,
            ),
          );

          s.metadata.machinePhaseImported = "true";
          s.history.push(
            "Applied saved Bruker PHC0/PHC1 with vendor grid convention",
          );
        }
        // Keep the initial transformed source unphased so transform=false replay
        // applies the stored recipe exactly once. Display data is a separate copy.
        s.data = applyPhase(
          {
            x: s.original.x.slice(),
            real: s.original.real.slice(),
            imag: s.original.imag?.slice(),
          },
          s.recipe.ph0,
          s.recipe.ph1,
          s.recipe.pivotPpm - s.referenceOffset,
        );
        s.history.push(
          "Raw FID transformed with imported source processing settings",
        );
      } else
        s.history.push(
          "Imported vendor-processed 1r/1i; saved phase and baseline retained without reapplying corrections",
        );
      if (processedPaths.length > 1)
        warnings.push(
          `${label}: ${processedPaths.length} processing versions found; opened ${dirname(processed!)}.`,
        );
      if (processed && !data.imag && !raw)
        warnings.push(
          `${label}: real-only spectrum; phase correction requires 1i or raw fid.`,
        );
      spectra.push(s);
    } catch (e) {
      warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const [path, buffer] of files) {
    if (
      !/\.(csv|tsv|txt|dx|jdx|jcamp)$/i.test(path) ||
      /(^|\/)(title|auditp\.txt|audita\.txt)$/i.test(path)
    )
      continue;
    try {
      const text = decoder.decode(buffer),
        jcamp = /\.(dx|jdx|jcamp)$/i.test(path);
      const parsed = jcamp
        ? readJcamp(text)
        : { data: readText(text), parameters: {} as Params };
      const frequency = Number(parsed.parameters[".OBSERVEFREQUENCY"]) || 0;
      const s = createSpectrum(
        basename(path).replace(/\.[^.]+$/, ""),
        jcamp ? "JCAMP-DX AFFN" : "Text (ppm)",
        parsed.data,
        parsed.parameters,
        frequency,
        String(parsed.parameters[".OBSERVENUCLEUS"] || "unknown").replace(
          /^\^/,
          "",
        ),
        spectra.length,
      );
      spectra.push(s);
      if (!frequency)
        warnings.push(
          `${s.label}: spectrometer frequency is unknown. Set it before reporting J values in Hz.`,
        );
    } catch (e) {
      warnings.push(
        `${basename(path)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  for (const path of files.keys()) {
    if (/\.mnova$/i.test(path))
      warnings.push(
        `${basename(path)}: native .mnova decoding requires the asynchronous browser importer.`,
      );
    else if (/\.jdf$/i.test(path))
      warnings.push(
        `${basename(path)}: this proprietary format is not supported. Upload Bruker experiment folders, ZIP, JCAMP-DX or ppm/intensity text.`,
      );
  }
  if (!spectra.length && !warnings.length)
    warnings.push(
      "No supported spectrum found. Include fid + acqus, or 1r + procs, or ppm/intensity CSV.",
    );
  return {
    spectra,
    warnings,
    ...(stacks.length ? { stacks } : {}),
    ...(importedView ? { view: importedView } : {}),
    ...(importedName ? { projectName: importedName } : {}),
  };
}

/** Native compressed arrays need a lazy WASM decoder; all other formats retain the synchronous parser. */
export async function importEntriesAsync(
  entries: ImportEntry[],
): Promise<ImportResult> {
  const native = entries.filter((e) => /\.mnova$/i.test(e.path));
  if (!native.length) return importEntries(entries);
  const remaining = entries.filter((e) => !/\.mnova$/i.test(e.path));
  const result: ImportResult = remaining.length
    ? importEntries(remaining)
    : { spectra: [], warnings: [] };
  const { importMnovaNative } = await import("./mnovaNative");
  for (const entry of native) {
    try {
      const opened = await importMnovaNative(entry.data, basename(entry.path));
      result.spectra.push(...opened.spectra);
      result.warnings.push(...opened.warnings);
      result.stacks = [...(result.stacks ?? []), ...(opened.stacks ?? [])];
      result.projectName ??= opened.projectName;
      result.view ??= opened.view;
    } catch (error) {
      result.warnings.push(
        `${basename(entry.path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
