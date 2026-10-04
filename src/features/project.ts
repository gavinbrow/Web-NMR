import { zip, unzip, strToU8, strFromU8, type Zippable } from "fflate";
import { get, set, del } from "idb-keyval";
import type {
  ComplexData,
  Project,
  Spectrum,
  TwoDSpectrum,
  ProcessingRecipe,
} from "../model";
import { validProperties } from "./appearance";
import { validTwoDView } from "./twoDTraces";

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_POINTS = 8_388_608;
const MAX_MATRIX_POINTS = 10_000_000;
const RECOVERY_KEY = "web-nmr-recovery-v1";
type ArrayRef = {
  __array: "float64le" | "uint8";
  path: string;
  length: number;
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100_000;
}
function list(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= 100_000;
}

function validateData(data: ComplexData) {
  assert(
    data && data.x instanceof Float64Array && data.real instanceof Float64Array,
    "Invalid spectrum arrays.",
  );
  assert(
    data.x.length >= 2 &&
      data.x.length <= MAX_POINTS &&
      data.real.length === data.x.length,
    "Invalid spectrum array lengths.",
  );
  assert(
    !data.imag ||
      (data.imag instanceof Float64Array && data.imag.length === data.x.length),
    "Invalid imaginary spectrum.",
  );
  for (const a of [data.x, data.real, data.imag])
    if (a)
      for (const n of a)
        assert(finite(n), "Spectrum contains nonfinite values.");
  const direction = Math.sign(data.x[1] - data.x[0]);
  assert(direction !== 0, "Spectrum axis must be monotonic.");
  for (let i = 1; i < data.x.length; i++)
    assert(
      Math.sign(data.x[i] - data.x[i - 1]) === direction,
      "Spectrum axis must be monotonic.",
    );
}
function validateTwoD(data: TwoDSpectrum): void {
  assert(
    data &&
      Number.isInteger(data.width) &&
      Number.isInteger(data.height) &&
      data.width >= 2 &&
      data.height >= 2 &&
      data.width * data.height <= MAX_MATRIX_POINTS,
    "Invalid 2D matrix dimensions.",
  );
  assert(
    data.x instanceof Float64Array &&
      data.y instanceof Float64Array &&
      data.x.length === data.width &&
      data.y.length === data.height,
    "Invalid 2D axes.",
  );
  for (const axis of [data.x, data.y]) {
    for (let i = 0; i < axis.length; i++)
      assert(
        finite(axis[i]) && (i === 0 || axis[i] < axis[i - 1]),
        "2D axes must be finite and descend in ppm.",
      );
  }
  const matrices = [data.real, data.imagF2, data.imagF1, data.imagBoth];
  let total = 0;
  for (const [index, matrix] of matrices.entries()) {
    assert(
      index > 0 || matrix instanceof Float64Array,
      "2D real matrix is missing.",
    );
    if (matrix !== undefined) {
      assert(
        matrix instanceof Float64Array &&
          matrix.length === data.width * data.height,
        "Invalid 2D component dimensions.",
      );
      for (const v of matrix)
        assert(finite(v), "2D matrix contains nonfinite values.");
      total += matrix.byteLength;
    }
  }
  assert(
    total <= 160 * 1024 * 1024,
    "2D components exceed the 160 MB matrix limit.",
  );
  assert(
    text(data.nucleusF1) &&
      finite(data.frequencyF1) &&
      data.frequencyF1 > 0 &&
      finite(data.referenceOffsetF1) &&
      text(data.experiment) &&
      [
        "Bruker processed 2D",
        "Mnova native processed 2D",
        "Bruker raw 2D magnitude",
        "Bruker raw 2D absorption",
      ].includes(data.source) &&
      ["absorption", "magnitude"].includes(data.mode),
    "Invalid 2D acquisition metadata.",
  );
  assert(
    data.acquisitionMode === undefined ||
      ["States", "States-TPPI", "Echo-Antiecho", "QF"].includes(
        data.acquisitionMode,
      ),
    "Invalid raw 2D acquisition mode.",
  );
}

function validateRecipe(r: ProcessingRecipe) {
  assert(
    r &&
      typeof r.transform === "boolean" &&
      typeof r.digitalFilter === "boolean" &&
      ["none", "exponential", "gaussian", "sinebell"].includes(r.window) &&
      ["none", "auto", "manual"].includes(r.baseline),
    "Invalid processing recipe.",
  );
  assert(
    [r.lbHz, r.gaussianHz, r.zeroFill, r.ph0, r.ph1, r.pivotPpm].every(
      finite,
    ) &&
      [1, 2, 4, 8, 16, 32].includes(r.zeroFill) &&
      r.lbHz >= 0 &&
      r.gaussianHz >= 0,
    "Invalid processing parameters.",
  );
  assert(
    list(r.baselineAnchors) &&
      r.baselineAnchors.every((a) => a && finite(a.ppm) && finite(a.value)),
    "Invalid baseline anchors.",
  );
  assert(
    r.baselineMethod === undefined ||
      [
        "polynomial",
        "bernstein",
        "whittaker",
        "ablative",
        "splines",
        "pcbc",
        "arpls",
        "snip",
        "apbk",
      ].includes(r.baselineMethod),
    "Invalid automatic baseline method.",
  );
  assert(
    r.manualBaselineMethod === undefined ||
      ["segments", "splines", "polynomial", "whittaker"].includes(
        r.manualBaselineMethod,
      ),
    "Invalid manual baseline method.",
  );
  for (const key of [
    "baselineOrder",
    "baselineMedianWindow",
    "baselineSmoothness",
    "baselineIterations",
    "baselineSnipWindow",
    "baselineRatio",
  ] as const)
    assert(
      r[key] === undefined || (finite(r[key]) && Math.abs(r[key]!) <= 100_000),
      `Invalid ${key} parameter.`,
    );
  const region = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(finite) &&
    value[0] !== value[1];
  assert(
    r.baselineRegion === undefined || region(r.baselineRegion),
    "Invalid baseline region.",
  );
  assert(
    r.baselineExcludedRegions === undefined ||
      (list(r.baselineExcludedRegions) &&
        r.baselineExcludedRegions.length <= 1000 &&
        r.baselineExcludedRegions.every(region)),
    "Invalid excluded baseline regions.",
  );
}

/** Strictly validates persisted data before allowing it into the application. */
export function validateProject(value: unknown): asserts value is Project {
  const p = value as Project;
  assert(
    p &&
      p.version === 1 &&
      text(p.name) &&
      text(p.savedAt) &&
      list(p.spectra) &&
      p.spectra.length <= 200,
    "Invalid Web NMR project or unsupported version.",
  );
  assert(
    ["single", "stack", "overlay"].includes(p.displayMode) &&
      ["none", "maximum", "area"].includes(p.normalization),
    "Invalid display settings.",
  );
  assert(p.activeId === null || text(p.activeId), "Invalid active spectrum.");
  assert(
    p.view === null ||
      (Array.isArray(p.view) &&
        p.view.length === 2 &&
        p.view.every(finite) &&
        p.view[0] > p.view[1]),
    "Invalid view limits.",
  );
  const ids = new Set<string>();
  if (p.originalMnova) {
    assert(
      text(p.originalMnova.name) &&
        /\.mnova$/i.test(p.originalMnova.name) &&
        p.originalMnova.bytes instanceof Uint8Array &&
        p.originalMnova.bytes.length >= 27 &&
        p.originalMnova.bytes.length <= MAX_BYTES &&
        list(p.originalMnova.importNotes) &&
        p.originalMnova.importNotes.every(text),
      "Invalid retained Mnova source document.",
    );
  }
  for (const s of p.spectra as Spectrum[]) {
    assert(
      s &&
        text(s.id) &&
        !ids.has(s.id) &&
        text(s.label) &&
        text(s.color) &&
        text(s.nucleus) &&
        text(s.sourceFormat),
      "Invalid or duplicate spectrum identity.",
    );
    ids.add(s.id);
    assert(
      s.properties === undefined || validProperties(s.properties),
      "Invalid spectrum appearance properties.",
    );
    assert(
      /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(s.color),
      "Invalid spectrum color. Use a hexadecimal color.",
    );
    assert(
      finite(s.frequencyMHz) &&
        s.frequencyMHz >= 0 &&
        finite(s.referenceOffset) &&
        finite(s.integralScale) &&
        finite(s.gain) &&
        s.gain > 0 &&
        typeof s.visible === "boolean",
      "Invalid spectrum settings.",
    );
    assert(
      s.timeMinutes === undefined || finite(s.timeMinutes),
      "Invalid acquisition time.",
    );
    assert(
      Number.isInteger(s.revision) &&
        s.revision >= 0 &&
        list(s.history) &&
        s.history.every(text),
      "Invalid spectrum history.",
    );
    assert(
      s.metadata &&
        typeof s.metadata === "object" &&
        !Array.isArray(s.metadata) &&
        Object.values(s.metadata).every((v) => text(v) || finite(v)),
      "Invalid spectrum metadata.",
    );
    validateData(s.original);
    validateData(s.data);
    if (s.twoD) validateTwoD(s.twoD);
    if (s.twoDOriginal) {
      assert(s.twoD, "2D source requires a 2D spectrum.");
      validateTwoD(s.twoDOriginal);
    }
    if (s.twoDRaw) {
      const r = s.twoDRaw;
      assert(
        s.twoD &&
          Number.isInteger(r.width) &&
          Number.isInteger(r.height) &&
          r.width >= 2 &&
          r.height >= 2 &&
          r.width * r.height <= MAX_MATRIX_POINTS &&
          r.real instanceof Float64Array &&
          r.imag instanceof Float64Array &&
          r.real.length === r.width * r.height &&
          r.imag.length === r.real.length,
        "Invalid raw 2D dimensions.",
      );
      assert(
        ["States", "States-TPPI", "Echo-Antiecho", "QF"].includes(
          r.acquisitionMode,
        ) &&
          [
            r.dwellSecondsF2,
            r.dwellSecondsF1,
            r.spectralWidthHzF2,
            r.spectralWidthHzF1,
            r.frequencyF1,
          ].every((n) => finite(n) && n > 0) &&
          [r.carrierPpmF2, r.carrierPpmF1, r.groupDelay].every(finite) &&
          r.groupDelay >= 0 &&
          text(r.nucleusF1) &&
          text(r.experiment),
        "Invalid raw 2D metadata.",
      );
      for (const values of [r.real, r.imag])
        for (const n of values)
          assert(finite(n), "Raw 2D data contain nonfinite values.");
    }
    if (s.nativeSource2D) {
      assert(!!s.twoD, "Native 2D source requires a 2D spectrum.");
      validateTwoD(s.nativeSource2D);
    }
    if (s.twoDRecipe) {
      const r = s.twoDRecipe;
      assert(
        s.twoD &&
          [
            r.transform,
            r.digitalFilter,
            r.magnitude,
            r.reconstructImaginary,
          ].every((v) => typeof v === "boolean"),
        "Invalid 2D processing recipe.",
      );
      validateRecipe(r.f2);
      validateRecipe(r.f1);
      assert(
        r.source === undefined ||
          ["processed", "mnova-source"].includes(r.source),
        "Invalid 2D processing source.",
      );
      assert(
        r.source !== "mnova-source" || !!s.nativeSource2D,
        "Saved Mnova processing source is missing.",
      );
      assert(
        r.echoAntiEchoOrder === undefined ||
          ["echo-first", "antiecho-first"].includes(r.echoAntiEchoOrder),
        "Invalid echo/antiecho order.",
      );
      assert(
        r.baselinePoints === undefined ||
          (list(r.baselinePoints) &&
            r.baselinePoints.length <= 1000 &&
            r.baselinePoints.every(
              (p) => p && [p.xPpm, p.yPpm, p.value].every(finite),
            )),
        "Invalid 2D baseline points.",
      );
    }
    assert(
      s.twoDView === undefined || (s.twoD && validTwoDView(s.twoDView)),
      "Invalid 2D view settings.",
    );
    if (s.fid) {
      const f = s.fid;
      assert(
        f.real instanceof Float64Array &&
          f.imag instanceof Float64Array &&
          f.real.length >= 2 &&
          f.real.length <= MAX_POINTS &&
          f.real.length === f.imag.length,
        "Invalid FID arrays.",
      );
      assert(
        finite(f.dwellSeconds) &&
          f.dwellSeconds > 0 &&
          finite(f.groupDelay) &&
          f.groupDelay >= 0 &&
          finite(f.carrierPpm) &&
          finite(f.spectralWidthHz) &&
          f.spectralWidthHz > 0,
        "Invalid FID parameters.",
      );
      for (const a of [f.real, f.imag])
        for (const n of a) assert(finite(n), "FID contains nonfinite values.");
    }
    validateRecipe(s.recipe);
    assert(
      s.savedView === undefined ||
        (Array.isArray(s.savedView) &&
          s.savedView.length === 2 &&
          s.savedView.every(finite) &&
          s.savedView[0] > s.savedView[1]),
      "Invalid saved spectrum view.",
    );
    assert(
      list(s.peaks) &&
        s.peaks.every(
          (a) =>
            a &&
            text(a.id) &&
            finite(a.ppm) &&
            finite(a.height) &&
            (a.label === undefined || text(a.label)),
        ),
      "Invalid peaks.",
    );
    assert(
      list(s.integrals) &&
        s.integrals.every(
          (a) =>
            a &&
            text(a.id) &&
            text(a.label) &&
            [a.from, a.to, a.area].every(finite),
        ),
      "Invalid integrals.",
    );
    if (s.integralCalibration !== undefined) {
      const calibration = s.integralCalibration;
      assert(
        calibration &&
          typeof calibration === "object" &&
          !Array.isArray(calibration) &&
          text(calibration.anchorId) &&
          finite(calibration.target) &&
          calibration.target > 0 &&
          (calibration.tentative === undefined ||
            typeof calibration.tentative === "boolean") &&
          s.integrals.some(
            (i) => i.id === calibration.anchorId && i.area !== 0,
          ),
        "Invalid integral calibration reference.",
      );
    }
    for (const i of s.integrals)
      if (i.imported)
        assert(
          i.imported.source === "Mnova" &&
            [
              i.imported.normalizedValue,
              i.imported.rawArea,
              i.imported.referenceArea,
            ].every(finite) &&
            i.imported.referenceArea !== 0,
          "Invalid imported integral values.",
        );
    assert(
      list(s.multiplets) &&
        s.multiplets.every(
          (a) =>
            a &&
            text(a.id) &&
            text(a.label) &&
            text(a.kind) &&
            [a.from, a.to, a.center, a.peakCount].every(finite) &&
            list(a.couplingsHz) &&
            a.couplingsHz.every(finite),
        ),
      "Invalid multiplets.",
    );
    for (const m of s.multiplets)
      if (m.imported)
        assert(
          m.imported.source === "Mnova" &&
            [
              m.imported.normalizedValue,
              m.imported.rawArea,
              m.imported.referenceArea,
              m.imported.nuclideCount,
            ].every(finite) &&
            m.imported.referenceArea !== 0 &&
            m.imported.nuclideCount >= 0,
          "Invalid imported multiplet values.",
        );
  }
  assert(
    p.activeId === null || ids.has(p.activeId),
    "Active spectrum does not exist.",
  );
  if (p.kinetics !== undefined) {
    const k = p.kinetics;
    assert(
      k &&
        typeof k === "object" &&
        !Array.isArray(k) &&
        list(k.targets) &&
        k.targets.length >= 1 &&
        k.targets.length <= 20,
      "Invalid kinetic targets.",
    );
    const targetIds = new Set<string>();
    assert(
      k.seriesSource === undefined ||
        ["document", "custom"].includes(k.seriesSource),
      "Invalid kinetics series source.",
    );
    assert(
      k.fitEnabled === undefined || typeof k.fitEnabled === "boolean",
      "Invalid kinetics fit setting.",
    );
    assert(
      k.seriesSpectrumIds === undefined ||
        (list(k.seriesSpectrumIds) &&
          k.seriesSpectrumIds.length <= 200 &&
          k.seriesSpectrumIds.every((id) => text(id) && ids.has(id)) &&
          new Set(k.seriesSpectrumIds).size === k.seriesSpectrumIds.length),
      "Invalid kinetics spectrum membership.",
    );
    if (k.timeFill)
      assert(
        ["doubling", "linear", "custom"].includes(k.timeFill.pattern) &&
          finite(k.timeFill.start) &&
          k.timeFill.start >= 0 &&
          finite(k.timeFill.step) &&
          k.timeFill.step > 0 &&
          typeof k.timeFill.includeZero === "boolean" &&
          text(k.timeFill.custom),
        "Invalid time point pattern.",
      );
    for (const target of k.targets) {
      assert(
        target &&
          text(target.id) &&
          target.id.length > 0 &&
          !targetIds.has(target.id) &&
          text(target.label) &&
          text(target.color) &&
          /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(
            target.color,
          ) &&
          finite(target.from) &&
          finite(target.to) &&
          target.from !== target.to &&
          finite(target.protons) &&
          target.protons > 0 &&
          ["decay", "growth", "linear"].includes(target.model),
        "Invalid or duplicate kinetic target.",
      );
      targetIds.add(target.id);
    }
    assert(
      targetIds.has(k.activeTargetId) &&
        ["area", "ratio", "concentration"].includes(k.mode) &&
        ["curve", "spectra"].includes(k.view) &&
        finite(k.standardFrom) &&
        finite(k.standardTo) &&
        k.standardFrom !== k.standardTo &&
        finite(k.standardProtons) &&
        k.standardProtons > 0 &&
        finite(k.standardConcentration) &&
        k.standardConcentration > 0 &&
        text(k.concentrationUnit) &&
        list(k.excludedIds) &&
        k.excludedIds.length <= 200 &&
        k.excludedIds.every(text) &&
        new Set(k.excludedIds).size === k.excludedIds.length,
      "Invalid kinetic measurement settings.",
    );
  }
  const optional = p as Project & { stacks?: unknown; activeStackId?: unknown };
  const stackIds = new Set<string>();
  if (optional.stacks !== undefined) {
    assert(
      list(optional.stacks) && optional.stacks.length <= 200,
      "Invalid spectrum stacks.",
    );
    for (const value of optional.stacks) {
      const stack = value as {
        id: string;
        label: string;
        spectrumIds: string[];
        referenceId?: string;
      };
      assert(
        stack && text(stack.id) && !stackIds.has(stack.id) && text(stack.label),
        "Invalid or duplicate stack identity.",
      );
      stackIds.add(stack.id);
      assert(
        list(stack.spectrumIds) &&
          stack.spectrumIds.length <= 200 &&
          stack.spectrumIds.every((id) => text(id) && ids.has(id)) &&
          new Set(stack.spectrumIds).size === stack.spectrumIds.length,
        "Stack contains a missing or duplicate spectrum.",
      );
      assert(
        stack.referenceId === undefined ||
          (text(stack.referenceId) &&
            stack.spectrumIds.includes(stack.referenceId)),
        "Stack reference spectrum must be a member.",
      );
    }
  }
  assert(
    optional.activeStackId === undefined ||
      optional.activeStackId === null ||
      (text(optional.activeStackId) && stackIds.has(optional.activeStackId)),
    "Active stack does not exist.",
  );
  assert(
    p.properties === undefined || validProperties(p.properties),
    "Invalid project properties settings.",
  );
}

/** Binary arrays are stored as portable little endian IEEE 754 values, without precision loss. */
export async function encodeProject(project: Project): Promise<Uint8Array> {
  validateProject(project);
  const files: Zippable = {};
  let count = 0,
    total = 0;
  const arrays = new WeakMap<object, ArrayRef>();
  function encode(value: unknown): unknown {
    if (value instanceof Uint8Array || value instanceof Float64Array) {
      const existing = arrays.get(value);
      if (existing) return existing;
    }
    if (value instanceof Uint8Array) {
      total += value.byteLength;
      assert(total <= MAX_BYTES, "Project exceeds the 256 MB save limit.");
      const path = `arrays/${count++}.u8`;
      files[path] = [value, { level: 1 }];
      const ref: ArrayRef = { __array: "uint8", path, length: value.length };
      arrays.set(value, ref);
      return ref;
    }
    if (value instanceof Float64Array) {
      total += value.byteLength;
      assert(total <= MAX_BYTES, "Project exceeds the 256 MB save limit.");
      const path = `arrays/${count++}.f64`;
      const bytes = new Uint8Array(value.byteLength),
        dv = new DataView(bytes.buffer);
      for (let i = 0; i < value.length; i++)
        dv.setFloat64(i * 8, value[i], true);
      files[path] = [bytes, { level: 1 }];
      const ref: ArrayRef = {
        __array: "float64le",
        path,
        length: value.length,
      };
      arrays.set(value, ref);
      return ref;
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, encode(v)]),
      );
    return value;
  }
  files["manifest.json"] = strToU8(
    JSON.stringify(encode({ ...project, savedAt: new Date().toISOString() })),
  );
  return new Promise((resolve, reject) =>
    zip(files, { level: 1 }, (error, data) =>
      error ? reject(error) : resolve(data),
    ),
  );
}

export async function decodeProject(bytes: Uint8Array): Promise<Project> {
  assert(
    bytes.length <= MAX_BYTES,
    "Project archive exceeds the 256 MB limit.",
  );
  let total = 0,
    count = 0,
    oversized = false;
  const files = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(
        bytes,
        {
          filter: (file) => {
            total += file.originalSize;
            count++;
            if (
              total > MAX_BYTES ||
              count > 3000 ||
              file.originalSize > MAX_BYTES ||
              !Number.isFinite(file.originalSize)
            )
              oversized = true;
            return (
              !oversized &&
              (file.name === "manifest.json" ||
                /^arrays\/\d+\.(f64|u8)$/.test(file.name))
            );
          },
        },
        (error, result) =>
          error
            ? reject(new Error("Unable to read this Web NMR project."))
            : oversized
              ? reject(new Error("Expanded project exceeds safe size limits."))
              : resolve(result),
      );
    },
  );
  assert(
    files["manifest.json"] && files["manifest.json"].length < 16 * 1024 * 1024,
    "Project manifest is missing or too large.",
  );
  const manifest: unknown = JSON.parse(strFromU8(files["manifest.json"]));
  let decodedBytes = 0;
  const arrays = new Map<string, Float64Array | Uint8Array>();
  function decode(value: unknown, depth = 0): unknown {
    assert(depth < 30, "Project structure is too deeply nested.");
    if (Array.isArray(value)) return value.map((v) => decode(v, depth + 1));
    if (value && typeof value === "object") {
      const ref = value as ArrayRef;
      if (ref.__array) {
        if (ref.__array === "uint8") {
          assert(
            /^arrays\/\d+\.u8$/.test(ref.path) &&
              Number.isInteger(ref.length) &&
              ref.length >= 27 &&
              ref.length <= MAX_BYTES,
            "Invalid source document array reference.",
          );
          const source = files[ref.path];
          assert(
            source && source.length === ref.length,
            "Source document length does not match its manifest.",
          );
          const existing = arrays.get(ref.path);
          if (existing) return existing;
          decodedBytes += source.length;
          assert(
            decodedBytes <= MAX_BYTES,
            "Decoded project arrays exceed the 256 MB limit.",
          );
          arrays.set(ref.path, source);
          return source;
        }
        assert(
          ref.__array === "float64le" &&
            /^arrays\/\d+\.f64$/.test(ref.path) &&
            Number.isInteger(ref.length) &&
            ref.length >= 2 &&
            ref.length <= MAX_MATRIX_POINTS,
          "Invalid binary array reference.",
        );
        const source = files[ref.path];
        assert(
          source && source.byteLength === ref.length * 8,
          "Project array length does not match its manifest.",
        );
        const existing = arrays.get(ref.path);
        if (existing) return existing;
        decodedBytes += source.byteLength;
        assert(
          decodedBytes <= MAX_BYTES,
          "Decoded project arrays exceed the 256 MB limit.",
        );
        const result = new Float64Array(ref.length),
          dv = new DataView(
            source.buffer,
            source.byteOffset,
            source.byteLength,
          );
        for (let i = 0; i < result.length; i++)
          result[i] = dv.getFloat64(i * 8, true);
        arrays.set(ref.path, result);
        return result;
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, decode(v, depth + 1)]),
      );
    }
    return value;
  }
  const project = decode(manifest);
  validateProject(project);
  return project;
}
export async function loadProject(file: Blob): Promise<Project> {
  assert(file.size <= MAX_BYTES, "Project archive exceeds the 256 MB limit.");
  return decodeProject(new Uint8Array(await file.arrayBuffer()));
}
export function safeFilename(label: string): string {
  return (
    label
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "spectrum"
  );
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = safeFilename(filename);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function downloadProject(project: Project) {
  const bytes = await encodeProject(project);
  downloadBlob(
    new Blob([bytes.slice().buffer], { type: "application/zip" }),
    `${safeFilename(project.name)}.webnmr`,
  );
}
/** Recovery uses structured cloning, keeping arrays intact and avoiding compression on each edit. */
export async function saveRecovery(project: Project): Promise<boolean> {
  try {
    await set(RECOVERY_KEY, project);
    return true;
  } catch {
    return false;
  }
}
export async function loadRecovery(): Promise<Project | null> {
  try {
    const p = await get<unknown>(RECOVERY_KEY);
    if (!p) return null;
    validateProject(p);
    return p;
  } catch {
    return null;
  }
}
export async function clearRecovery(): Promise<void> {
  try {
    await del(RECOVERY_KEY);
  } catch {
    /* Browser storage may be unavailable. */
  }
}
