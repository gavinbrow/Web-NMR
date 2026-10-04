import {
  colors,
  defaultRecipe,
  uid,
  type ComplexData,
  type FidData,
  type ImportResult,
  type Spectrum,
  type SpectrumStack,
} from "../model";

const textDecoder = new TextDecoder();
const MAX_POINTS = 4_194_304;
const schema = (value: unknown, suffix: string): boolean => {
  if (!value || typeof value !== "object") return false;
  const s = (value as Record<string, unknown>).$mnova_schema;
  return (
    typeof s === "string" &&
    /^https:\/\/mestrelab\.com\/json-schemas\/mnova\//.test(s) &&
    s.endsWith(suffix)
  );
};
const record = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid Mnova JSON object.");
  return v as Record<string, any>;
};
const finite = (v: unknown, name: string, positive = false): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || (positive && v <= 0))
    throw new Error(`Invalid Mnova ${name}.`);
  return v;
};
const shortText = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").slice(0, 100_000) : "";
const safePath = (v: unknown): string => {
  if (
    typeof v !== "string" ||
    v.startsWith("/") ||
    /[\\\x00]/.test(v) ||
    v.split("/").some((p) => p === ".." || p === ".")
  )
    throw new Error("Unsafe Mnova resource path.");
  return v;
};
function json(bytes: ArrayBuffer | undefined): unknown {
  if (!bytes) throw new Error("Missing Mnova document resource.");
  return JSON.parse(textDecoder.decode(bytes));
}
/** Mnova 17 .mnjs stores a Qt big-endian string header, then big-endian float32 samples. */
function samples(
  value: unknown,
  count: number,
  files: Map<string, ArrayBuffer>,
  base: string,
): Float64Array {
  const v = record(value);
  let result: Float64Array;
  if (Array.isArray(v.array)) {
    if (v.array.length !== count)
      throw new Error("Mnova sample count does not match its metadata.");
    result = Float64Array.from(
      v.array.map((n: unknown) => finite(n, "sample")),
    );
  } else {
    const path = `${base}${safePath(v.binary_file)}`;
    const buffer = files.get(path);
    if (!buffer || buffer.byteLength !== 21 + count * 4)
      throw new Error("Missing, truncated or unsupported Mnova binary array.");
    const view = new DataView(buffer);
    if (
      view.getUint32(0, false) !== 17 ||
      textDecoder.decode(new Uint8Array(buffer, 4, 17)) !== "MNOVA JSON BINARY"
    )
      throw new Error("Unsupported Mnova binary header.");
    result = new Float64Array(count);
    for (let i = 0; i < count; i++)
      result[i] = finite(view.getFloat32(21 + i * 4, false), "binary sample");
  }
  return result;
}
function dimension(value: unknown): {
  n: number;
  frequency: number;
  width: number;
  lower: number;
  nucleus: string;
  groupDelay: number;
} {
  const v = record(value);
  const n = finite(v.points, "point count", true);
  if (!Number.isInteger(n) || n < 2 || n > MAX_POINTS)
    throw new Error("Mnova point count is outside the supported range.");
  return {
    n,
    frequency: finite(v.spectrometer_frequency, "spectrometer frequency", true),
    width: finite(v.spectral_width, "spectral width", true),
    lower: finite(v.lowest_frequency, "lowest frequency"),
    nucleus: shortText(v.nucleus) || "unknown",
    groupDelay:
      v.group_delay === undefined ? 0 : finite(v.group_delay, "group delay"),
  };
}
function parseSpectrum(
  value: unknown,
  files: Map<string, ArrayBuffer>,
  base: string,
  index: number,
  pageTitle: string,
  warnings: string[],
): Spectrum {
  const spec = record(value),
    stored = record(spec.data);
  if (!schema(spec, "/nmr/spec") || !schema(stored, "/nmr/base-spec"))
    throw new Error("Unsupported Mnova spectrum schema.");
  if (
    stored.type !== "spectrum" ||
    !Array.isArray(stored.dimensional_parameters) ||
    stored.dimensional_parameters.length !== 1
  )
    throw new Error(
      "Only processed 1D Mnova JSON spectra are currently supported; no 2D data were flattened.",
    );
  const dim = dimension(stored.dimensional_parameters[0]),
    channels = record(stored.data);
  const real = samples(channels["1r"], dim.n, files, base);
  const imag =
    channels["1i"] === undefined
      ? undefined
      : samples(channels["1i"], dim.n, files, base);
  const x = new Float64Array(dim.n);
  // Mnova scripting exports point 0 at Lowest Frequency + Spectral Width.
  for (let i = 0; i < dim.n; i++)
    x[i] = (dim.lower + ((dim.n - i) * dim.width) / dim.n) / dim.frequency;
  const data: ComplexData = { x, real, imag };
  const metadata: Record<string, string | number> = {
    processingSource:
      "Mnova stored processed spectrum; saved phase and baseline retained",
    mnovaPageTitle: pageTitle,
  };
  if (Array.isArray(spec.parameters)) {
    for (const p of spec.parameters.slice(0, 1000)) {
      if (!p || typeof p.name !== "string" || !Array.isArray(p.value)) continue;
      const values = p.value
        .map((v: any) => v?.value)
        .filter(
          (v: any) =>
            typeof v === "string" ||
            (typeof v === "number" && Number.isFinite(v)),
        );
      metadata[p.name.slice(0, 200)] =
        values.length === 1 && typeof values[0] === "number"
          ? values[0]
          : values
              .map(String)
              .join("\n")
              .replace(/\r\n?/g, "\n")
              .slice(0, 100_000);
    }
  }
  metadata.title =
    metadata.Title || pageTitle.split("\n")[0] || "Mnova spectrum";
  metadata.comments = metadata.Comment ?? "";
  if (spec.processing && typeof spec.processing === "object")
    metadata.mnovaProcessing = JSON.stringify(spec.processing).slice(
      0,
      100_000,
    );
  const p = record(stored.dimensional_parameters[0]);
  if (typeof p.ph0 === "number" && Number.isFinite(p.ph0))
    metadata.mnovaSavedPhase0Radians = p.ph0;
  if (typeof p.ph1 === "number" && Number.isFinite(p.ph1))
    metadata.mnovaSavedPhase1Radians = p.ph1;
  const recipe = defaultRecipe();
  recipe.window = "none";
  recipe.pivotPpm = (x[0] + x[x.length - 1]) / 2;
  let fid: FidData | undefined;
  if (spec.raw_data) {
    try {
      const raw = record(spec.raw_data);
      if (
        raw.type === "fid" &&
        Array.isArray(raw.dimensional_parameters) &&
        raw.dimensional_parameters.length === 1
      ) {
        const d = dimension(raw.dimensional_parameters[0]),
          c = record(raw.data);
        if (d.groupDelay < 0) throw new Error("Invalid Mnova raw group delay.");
        fid = {
          real: samples(c["1r"], d.n, files, base),
          imag: samples(c["1i"], d.n, files, base),
          dwellSeconds: 1 / d.width,
          spectralWidthHz: d.width,
          groupDelay: d.groupDelay,
          carrierPpm: (d.lower + d.width / 2) / d.frequency,
        };
      }
    } catch (e) {
      warnings.push(
        `${String(metadata.title)}: stored processed trace retained; raw FID unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return {
    id: uid(),
    label: String(metadata.title || "Mnova spectrum"),
    color: colors[index % colors.length],
    nucleus: dim.nucleus,
    frequencyMHz: dim.frequency,
    sourceFormat: "Mnova JSON",
    metadata,
    original: data,
    data,
    fid,
    recipe,
    referenceOffset: 0,
    peaks: [],
    integrals: [],
    multiplets: [],
    integralScale: 1,
    gain: 1,
    visible: true,
    history: [
      "Imported Mnova stored processed spectrum; phase and baseline preserved",
    ],
    revision: 0,
  };
}

/** Parse an exported dataset JSON or an expanded .mnjs ZIP without executing document content. */
export function importMnovaJson(
  files: Map<string, ArrayBuffer>,
  rootPath: string,
): ImportResult {
  const root = json(files.get(rootPath));
  const spectra: Spectrum[] = [],
    warnings: string[] = [],
    stacks: SpectrumStack[] = [];
  let view: [number, number] | undefined;
  const addDataset = (
    value: unknown,
    base: string,
    pageTitle = "",
    item?: Record<string, any>,
    pageIndex?: number,
  ) => {
    const dataset = record(value);
    if (
      !schema(dataset, "/nmr/dataset") ||
      !Array.isArray(dataset.spectra) ||
      dataset.spectra.length > 256
    )
      throw new Error("Unsupported Mnova NMR dataset schema.");
    const added: Spectrum[] = [];
    const sourceIndices = new Map<number, Spectrum>();
    for (const [sourceIndex, value] of dataset.spectra.entries()) {
      if (spectra.length >= 512)
        throw new Error("Mnova document exceeds 512 spectra.");
      try {
        const s = parseSpectrum(
          value,
          files,
          base,
          spectra.length,
          pageTitle,
          warnings,
        );
        if (pageIndex !== undefined) s.metadata.mnovaPageIndex = pageIndex;
        added.push(s);
        sourceIndices.set(sourceIndex, s);
        spectra.push(s);
      } catch (e) {
        warnings.push(
          `${pageTitle.split("\n")[0] || "Mnova spectrum"}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (item?.stack && added.length > 1) {
      const hidden = Array.isArray(item.stack.hidden_elements)
        ? item.stack.hidden_elements
        : [];
      sourceIndices.forEach((s, i) => {
        s.visible = !hidden.includes(i);
      });
      const ids = item.stack.ids;
      const validIds =
        Array.isArray(ids) &&
        ids.length <= dataset.spectra.length &&
        new Set(ids).size === ids.length &&
        ids.every(
          (i: unknown) =>
            typeof i === "number" &&
            Number.isInteger(i) &&
            i >= 0 &&
            i < dataset.spectra.length,
        );
      const members: Spectrum[] = validIds
        ? ids
            .map((i: number) => sourceIndices.get(i))
            .filter((s: Spectrum | undefined): s is Spectrum => Boolean(s))
        : added;
      if (!members.length) return;
      const stack = {
        id: uid(),
        label: pageTitle.split("\n")[0] || "Mnova stack",
        spectrumIds: members.map((s) => s.id),
        referenceId:
          members.find(
            (s) => s.id === sourceIndices.get(item.stack.active_element)?.id,
          )?.id ?? members[0].id,
      };
      stacks.push(stack);
      members.forEach((s) => {
        s.metadata.mnovaStackId = stack.id;
      });
    }
    const scale = item?.f1_scale;
    if (
      !view &&
      scale?.units === "ppm" &&
      Number.isFinite(scale.from) &&
      Number.isFinite(scale.to) &&
      scale.from !== scale.to
    )
      view = [Math.max(scale.from, scale.to), Math.min(scale.from, scale.to)];
  };
  const base = rootPath.slice(0, rootPath.lastIndexOf("/") + 1);
  if (schema(root, "/nmr/dataset")) addDataset(root, base);
  else {
    const doc = record(root);
    if (
      !schema(doc, "/doc/root") ||
      !Array.isArray(doc.pages) ||
      doc.pages.length > 512
    )
      throw new Error("Unsupported Mnova JSON document schema.");
    const visited = new Set<string>();
    for (const [pageIndex, pageId] of doc.pages.entries()) {
      const id = safePath(
        typeof pageId === "string" ? pageId.replace(/^\{|\}$/g, "") : pageId,
      );
      const page = record(json(files.get(`${base}pages/${id}/page.json`)));
      if (
        !schema(page, "/doc/page") ||
        !Array.isArray(page.items) ||
        page.items.length > 1024
      )
        throw new Error("Invalid Mnova page.");
      for (const entry of page.items) {
        if (entry?.rtti !== "NMR Spectrum") continue;
        const itemId = safePath(entry.uuid),
          path = `${base}items/${itemId}/`;
        if (visited.has(itemId)) continue;
        visited.add(itemId);
        const item = record(json(files.get(`${path}item.json`)));
        addDataset(
          json(files.get(`${path}data.json`)),
          path,
          shortText(page.title),
          item,
          pageIndex + 1,
        );
      }
    }
  }
  warnings.push(
    "Mnova JSON import preserves processed samples, available complex FIDs, comments, stack membership and first view range. Page artwork, acquisition array settings and analysis annotations are not imported.",
  );
  return {
    spectra,
    warnings,
    stacks,
    view,
    projectName: schema(root, "/doc/root")
      ? shortText(record(root).name).replace(/\.(mnjs|zip)$/i, "") ||
        "Mnova document"
      : "Mnova spectrum",
  };
}
export function isMnovaJsonDataset(buffer: ArrayBuffer): boolean {
  // Identification is separate from parsing, so malformed JSON receives a helpful import error.
  const head = textDecoder.decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)),
  );
  return /\"\$mnova_schema\"\s*:\s*\"https:\/\/mestrelab\.com\/json-schemas\/mnova\//.test(
    head,
  );
}
