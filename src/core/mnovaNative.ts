import { maximumProjection } from "./twoD";
import {
  colors,
  defaultRecipe,
  uid,
  type ImportResult,
  type Spectrum,
  type SpectrumStack,
} from "../model";
import initCodec, { type DecoderModule } from "./mnovaCodec/openjpeg.mjs";
import wasmUrl from "./mnovaCodec/openjpeg.wasm?url";

const MAX_POINTS = 4_194_304,
  MAX_FILE = 256 * 1024 * 1024;
const utf16 = new TextDecoder("utf-16be"),
  utf8 = new TextDecoder();
const essentialSignature = Uint8Array.from([
  0, 0, 0, 74, 0, 0, 0, 22, 0, 0, 0, 10, 0, 0, 0, 5, 0, 0, 0, 0, 9, 1,
]);
const itemSignature = new Uint8Array([
  ...new Uint8Array([0, 0, 0, 12]),
  ...new TextEncoder().encode("NMR Spectrum"),
  ...new Uint8Array([0, 0, 0, 6, 0, 78, 0, 77, 0, 82]),
]);
let codec: Promise<DecoderModule> | undefined;
/** Browser worker decoder is initialized only when a compressed native array is opened. */
export function setNativeCodecForTests(binary: Uint8Array): void {
  codec = initCodec({ wasmBinary: binary });
}
function getCodec() {
  return (codec ??= initCodec({ locateFile: () => wasmUrl }));
}
class Reader {
  view: DataView;
  bytes: Uint8Array;
  at: number;
  end: number;
  constructor(bytes: Uint8Array, at = 0, end = bytes.length) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.end)
      throw Error("Truncated Mnova native record.");
  }
  u8() {
    this.need(1);
    return this.bytes[this.at++];
  }
  u32() {
    this.need(4);
    const n = this.view.getUint32(this.at, false);
    this.at += 4;
    return n;
  }
  f32() {
    this.need(4);
    const n = this.view.getFloat32(this.at, false);
    this.at += 4;
    if (!Number.isFinite(n)) throw Error("Non-finite Mnova value.");
    return n;
  }
  f64() {
    this.need(8);
    const n = this.view.getFloat64(this.at, false);
    this.at += 8;
    if (!Number.isFinite(n)) throw Error("Non-finite Mnova value.");
    return n;
  }
  block() {
    const n = this.u32();
    this.need(n);
    return new Reader(this.bytes, this.at, this.at + n);
  }
  text() {
    const n = this.u32();
    if (n === 0xffffffff) return "";
    if (n > 200_000 || n % 2) throw Error("Invalid Mnova text length.");
    this.need(n);
    const t = utf16.decode(this.bytes.subarray(this.at, this.at + n));
    this.at += n;
    return t.replace(/\r\n?/g, "\n");
  }
}
function matches(b: Uint8Array, at: number, s: Uint8Array) {
  if (at < 0 || at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s[i]) return false;
  return true;
}
interface Dimension {
  end: number;
  n: number;
  nucleus: string;
  delay: number;
  lower: number;
  frequency: number;
  width: number;
  phase0: number;
  phase1: number;
}
/** Version-nine essentials: nested compatibility frames followed by the original Qt legacy tail. */
function dimension(b: Uint8Array, start: number): Dimension {
  const r = new Reader(b, start),
    frames = Array.from({ length: 9 }, () => r.u32());
  if (
    frames[0] !== frames[1] + 5 ||
    frames[2] !== 91 ||
    frames[3] !== 86 ||
    frames.slice(4).join(",") !== "74,22,10,5,0" ||
    r.u8() !== 9 ||
    r.u8() !== 1
  )
    throw Error("Unsupported Mnova dimensional record version.");
  const delay = r.f64(),
    lower = r.f64(),
    frequency = r.f64(),
    width = r.f64();
  r.f64();
  const phase0 = r.f64(),
    phase1 = r.f64();
  r.f32();
  r.f32();
  r.u8();
  const nucleus = r.text();
  r.u8();
  r.f32();
  r.f32();
  r.u32();
  const n = r.u32();
  r.f32();
  r.f32();
  if (
    r.at !== start + frames[0] + 28 ||
    frequency <= 0 ||
    width <= 0 ||
    !n ||
    n > MAX_POINTS ||
    delay < 0
  )
    throw Error("Invalid Mnova dimensional calibration.");
  return {
    end: r.at,
    n,
    nucleus,
    delay,
    lower,
    frequency,
    width,
    phase0,
    phase1,
  };
}
interface ArrayRecord {
  start: number;
  end: number;
  dimensions: Dimension[];
  realOnly: boolean;
  compressed: boolean;
  bytes: Uint8Array;
  endian: number;
  dimensionality: number;
}
function arrayRecord(b: Uint8Array, start: number): ArrayRecord {
  const original: Dimension[] = [];
  let at = start;
  for (let i = 0; i < 7; i++) {
    const d = dimension(b, at);
    original.push(d);
    at = d.end;
  }
  const r = new Reader(b, at),
    dimensionality = r.u32(),
    realOnly = r.u8();
  r.f32();
  if (dimensionality !== 1 && dimensionality !== 2)
    throw Error(
      "Native Mnova dimensions above 2D are unsupported; no projection was substituted.",
    );
  if (realOnly > 1) throw Error("Invalid Mnova channel flag.");
  const dimensions: Dimension[] = [];
  at = r.at;
  for (let i = 0; i < 7; i++) {
    const d = dimension(b, at);
    dimensions.push(d);
    at = d.end;
  }
  // Unused dimensions must remain scalar in this explicitly supported 1D dialect.
  if (dimensions.some((d, i) => (i === 0 || i > dimensionality) && d.n !== 1))
    throw Error("Unsupported native Mnova dimension layout.");
  const outer = new Reader(b, at).block();
  if (outer.u32() !== 0 || outer.u8() !== 1)
    throw Error("Missing Mnova spectrum array.");
  const compressed = outer.u8();
  if (compressed > 1) throw Error("Invalid Mnova compression flag.");
  const data = outer.block(),
    length = data.u32(),
    endian = data.u8();
  if (endian > 1 || length !== data.end - data.at)
    throw Error("Invalid Mnova array byte count.");
  if (data.end !== outer.end) throw Error("Unsupported Mnova array extension.");
  return {
    start,
    dimensionality,
    end: outer.end,
    dimensions,
    realOnly: !!realOnly,
    compressed: !!compressed,
    bytes: b.subarray(data.at, data.end),
    endian,
  };
}
async function decodeChannel(
  r: Reader,
  count: number,
  shape?: [number, number],
): Promise<Float64Array> {
  const lower = r.f32(),
    upper = r.f32(),
    n = r.u32();
  if (n === 0) return new Float64Array(count);
  if (n > 32 * 1024 * 1024)
    throw Error("Mnova compressed channel exceeds the local limit.");
  r.need(n);
  const bytes = r.bytes.subarray(r.at, r.at + n);
  r.at += n;
  // This dialect is one unsigned 28-bit grayscale component. Tile bounds are checked again before decode in WASM.
  if (
    bytes.length < 45 ||
    bytes[0] !== 255 ||
    bytes[1] !== 79 ||
    bytes[2] !== 255 ||
    bytes[3] !== 81
  )
    throw Error("Unsupported Mnova JPEG 2000 channel.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = v.getUint32(8, false) - v.getUint32(16, false),
    height = v.getUint32(12, false) - v.getUint32(20, false);
  if (
    width < 1 ||
    height < 1 ||
    v.getUint32(16, false) !== 0 ||
    v.getUint32(20, false) !== 0 ||
    v.getUint32(24, false) !== width ||
    v.getUint32(28, false) !== height ||
    v.getUint32(32, false) !== 0 ||
    v.getUint32(36, false) !== 0 ||
    (shape && (width !== shape[0] || height !== shape[1])) ||
    width * height !== count ||
    v.getUint16(40, false) !== 1 ||
    bytes[42] !== 27
  )
    throw Error("Unsupported native Mnova JPEG 2000 dimensions or precision.");
  const m = await getCodec();
  let encoded = 0,
    decoded = 0;
  try {
    encoded = m._malloc(n);
    if (!encoded) throw Error("Native decoder memory limit exceeded.");
    m.HEAPU8.set(bytes, encoded);
    decoded = m._decode(encoded, n, count);
    if (!decoded) throw Error("Invalid or unsupported Mnova JPEG 2000 data.");
    const normalized = new Float32Array(m.HEAPU8.buffer, decoded, count),
      result = new Float64Array(count),
      span = Math.fround(upper - lower);
    for (let i = 0; i < count; i++) {
      const value = Math.fround(lower + Math.fround(span * normalized[i]));
      if (!Number.isFinite(value))
        throw Error("Non-finite native Mnova sample.");
      result[i] = value;
    }
    return result;
  } finally {
    if (decoded) m._free(decoded);
    if (encoded) m._free(encoded);
  }
}
async function samples(
  record: ArrayRecord,
): Promise<{ real: Float64Array; imag?: Float64Array }> {
  const count =
    record.dimensions[1].n *
    (record.dimensionality === 2 ? record.dimensions[2].n : 1);
  if (count > MAX_POINTS)
    throw Error(
      "Native Mnova plane exceeds the 4 million point decoder limit.",
    );
  if (record.dimensionality === 2 && !record.realOnly)
    throw Error(
      "Native complex 2D layout is not supported yet; real-only processed 2D is supported.",
    );
  if (record.compressed) {
    const r = new Reader(record.bytes);
    if (r.u32() !== 13 || r.u32() !== 5 || r.u32() !== 0 || r.u8() !== 1)
      throw Error("Unsupported Mnova compressed record.");
    r.f32();
    const shape: [number, number] | undefined =
      record.dimensionality === 2
        ? [record.dimensions[2].n, record.dimensions[1].n]
        : undefined;
    const real = await decodeChannel(r, count, shape),
      imag = record.realOnly ? undefined : await decodeChannel(r, count, shape);
    if (record.realOnly) {
      r.f32();
      r.f32();
      if (r.u32() !== 0) throw Error("Unexpected complex Mnova channel.");
    }
    // Legacy min/max tail repeats the normalization values; it is not another spectrum.
    if (r.end - r.at !== 1)
      throw Error("Unsupported Mnova compression extension.");
    if (r.u8() !== 0)
      throw Error("Unsupported hypercomplex native Mnova data.");
    return { real, imag };
  }
  const channels = record.realOnly ? 1 : 2;
  if (record.bytes.length !== count * channels * 4)
    throw Error("Mnova native sample count does not match calibration.");
  const v = new DataView(
      record.bytes.buffer,
      record.bytes.byteOffset,
      record.bytes.byteLength,
    ),
    real = new Float64Array(count),
    imag = record.realOnly ? undefined : new Float64Array(count);
  for (let i = 0; i < count; i++) {
    real[i] = v.getFloat32(i * channels * 4, record.endian === 1);
    if (imag) imag[i] = v.getFloat32((i * 2 + 1) * 4, record.endian === 1);
    if (!Number.isFinite(real[i]) || (imag && !Number.isFinite(imag[i])))
      throw Error("Non-finite native Mnova sample.");
  }
  return { real, imag };
}
/** Recognize parameter text only when its value, identifier, name and compatibility frames all agree. */
function parameterText(
  b: Uint8Array,
  from: number,
  to: number,
  name: string,
): string {
  const encoded = new TextEncoder().encode(name);
  let last = "";
  for (let p = from; p + name.length * 2 + 20 < to; p++) {
    if (
      b[p] !== 0 ||
      b[p + 1] !== 0 ||
      b[p + 2] !== 0 ||
      b[p + 3] !== name.length * 2
    )
      continue;
    let yes = true;
    for (let i = 0; i < encoded.length; i++)
      if (b[p + 4 + i * 2] !== 0 || b[p + 5 + i * 2] !== encoded[i]) {
        yes = false;
        break;
      }
    if (!yes) continue;
    const after = p + 4 + name.length * 2,
      v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (
      v.getUint32(after, false) !== 13 ||
      v.getUint32(after + 4, false) !== 5 ||
      v.getUint32(after + 8, false) !== 0
    )
      continue;
    // Parameter value is a length-prefixed UTF-16 string immediately before the one-byte identifier.
    for (let q = Math.max(from, p - 200_005); q <= p - 5; q++) {
      if (b[q] !== 0) continue;
      const n = v.getUint32(q, false);
      if (n <= 200_000 && n % 2 === 0 && q + 4 + n === p - 1) {
        last = utf16.decode(b.subarray(q + 4, p - 1)).replace(/\r\n?/g, "\n");
        break;
      }
    }
  }
  return last;
}
export async function importMnovaNative(
  buffer: ArrayBuffer,
  label = "Mnova document",
): Promise<ImportResult> {
  if (buffer.byteLength > MAX_FILE)
    throw Error("Native Mnova document exceeds the 256 MB local limit.");
  const b = new Uint8Array(buffer);
  if (
    utf8.decode(b.subarray(0, 23)) !== "Mestrelab Research S.L." ||
    !matches(b, 23, Uint8Array.from([241, 226, 211, 196]))
  )
    throw Error("Not a supported native Mnova document.");
  const items: number[] = [];
  for (let p = 26; p < b.length - itemSignature.length; p++)
    if (matches(b, p, itemSignature)) items.push(p);
  if (!items.length || items.length > 512)
    throw Error("Unsupported native Mnova document layout.");
  let retainedBytes = 0;
  const spectra: Spectrum[] = [],
    stacks: SpectrumStack[] = [],
    warnings: string[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const from = items[itemIndex],
      to = items[itemIndex + 1] ?? b.length,
      records: ArrayRecord[] = [];
    for (let p = from; p < to - essentialSignature.length; p++)
      if (matches(b, p, essentialSignature)) {
        const start = p - 16;
        if (start < from) continue;
        // A base spectrum begins after the modern original-calibration header, not at arbitrary nested axis records.
        if (
          !matches(
            b,
            start - 17,
            Uint8Array.from([0, 0, 0, 13, 0, 0, 0, 5, 0, 0, 0, 0]),
          )
        )
          continue;
        const record = arrayRecord(b, start);
        if (record.end > to)
          throw Error("Native spectrum extends outside its document item.");
        records.push(record);
        p = record.end - 1;
      }
    if (!records.length || records.length % 2)
      throw Error("Unsupported native Mnova processed/source record layout.");
    const members: Spectrum[] = [];
    for (let i = 0; i < records.length; i += 2) {
      const record = records[i],
        d = record.dimensions[record.dimensionality === 2 ? 2 : 1],
        values = await (async () => {
          const count =
            record.dimensions[1].n *
            (record.dimensionality === 2 ? record.dimensions[2].n : 1);
          retainedBytes +=
            count * 8 * (record.realOnly ? 1 : 2) +
            (d.n + (record.dimensionality === 2 ? record.dimensions[1].n : 0)) *
              16;
          if (count > MAX_POINTS || retainedBytes > 160 * 1024 * 1024)
            throw Error(
              "Native Mnova decoded arrays exceed the 160 MB local limit.",
            );
          return samples(record);
        })();
      const metadataFrom = i ? records[i - 1].end : from;
      const title = parameterText(b, metadataFrom, record.start, "Title"),
        comment = parameterText(b, metadataFrom, record.start, "Comment");
      const x = Float64Array.from(
          { length: d.n },
          (_, j) => (d.lower + ((d.n - j) * d.width) / d.n) / d.frequency,
        ),
        f1 = record.dimensions[1],
        twoD =
          record.dimensionality === 2
            ? {
                x,
                y: Float64Array.from(
                  { length: f1.n },
                  (_, j) =>
                    (f1.lower + ((f1.n - j) * f1.width) / f1.n) / f1.frequency,
                ),
                real: values.real,
                width: d.n,
                height: f1.n,
                nucleusF1: f1.nucleus,
                frequencyF1: f1.frequency,
                referenceOffsetF1: 0,
                experiment: "Mnova native 2D",
                source: "Mnova native processed 2D" as const,
                mode: "absorption" as const,
              }
            : undefined,
        data = twoD ? maximumProjection(twoD) : { x, ...values };
      const recipe = defaultRecipe();
      recipe.window = "none";
      recipe.pivotPpm = (x[0] + x[x.length - 1]) / 2;
      const metadata: Record<string, string | number> = {
        title: title || `${label} ${spectra.length + 1}`,
        comment,
        Title: title,
        Comment: comment,
        processingSource:
          "Mnova stored processed spectrum; saved phase and baseline retained",
        mnovaNativeDialect: "Modern essentials v9 / native array v1",
        mnovaSavedPhase0Radians: d.phase0,
        mnovaSavedPhase1Radians: d.phase1,
        mnovaNativeItem: itemIndex + 1,
      };
      const spectrum: Spectrum = {
        id: uid(),
        revision: 0,
        label: String(metadata.title),
        sourceFormat: "Mnova native",
        color: colors[spectra.length % colors.length],
        nucleus: d.nucleus,
        frequencyMHz: d.frequency,
        metadata,
        twoD,
        twoDOriginal: twoD,
        original: data,
        data,
        recipe,
        referenceOffset: 0,
        peaks: [],
        integrals: [],
        multiplets: [],
        integralScale: 1,
        gain: 1,
        visible: true,
        history: [
          "Imported native Mnova stored processed samples; saved corrections retained",
        ],
      };
      spectra.push(spectrum);
      members.push(spectrum);
    }
    if (members.length > 1) {
      const stack = {
        id: uid(),
        label: `Mnova stack ${stacks.length + 1}`,
        spectrumIds: members.map((s) => s.id),
        referenceId: members[0].id,
      };
      stacks.push(stack);
      members.forEach((s) => (s.metadata.mnovaStackId = stack.id));
    }
  }
  if (!spectra.length)
    throw Error("No supported native Mnova 1D spectra were found.");
  warnings.push(
    "Native Mnova import preserves processed 1D spectra and real-only processed 2D planes, calibration, comments and dataset membership. Stack display order, gains, raw FID reprocessing, analysis annotations and page artwork are not restored yet.",
  );
  return {
    spectra,
    stacks,
    warnings,
    projectName: label.replace(/\.mnova$/i, ""),
  };
}
