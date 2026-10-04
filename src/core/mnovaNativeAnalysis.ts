import type { ComplexData, Integral, Peak, Multiplet } from "../model";
import { integrate } from "./numerics";

/** Mnova's saved point-sum areas are independent of Web NMR's signed ppm areas. */
export interface NativeIntegralAnalysis {
  integrals: Integral[];
  normalization?: number;
  found: boolean;
  warnings: string[];
}
interface Limits {
  from: number;
  to: number;
  data: ComplexData;
  referenceOffset?: number;
  previousSourceEnd?: number;
}

class RecordReader {
  at: number;
  readonly bytes: Uint8Array;
  readonly end: number;
  constructor(bytes: Uint8Array, from: number, end: number) {
    this.bytes = bytes;
    this.end = end;
    this.at = from;
  }
  need(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.end)
      throw Error("Truncated native Mnova integral record.");
  }
  u8() {
    this.need(1);
    return this.bytes[this.at++];
  }
  u32() {
    this.need(4);
    const n = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.at,
      4,
    ).getUint32(0);
    this.at += 4;
    return n;
  }
  f64() {
    this.need(8);
    const n = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.at,
      8,
    ).getFloat64(0);
    this.at += 8;
    if (!Number.isFinite(n))
      throw Error("Non-finite native Mnova integral value.");
    return n;
  }
  skip(n: number) {
    this.need(n);
    this.at += n;
  }
}
function uint(bytes: Uint8Array, at: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
}

/**
 * Saved integration collection ends at the verified base-spectrum prefix, exactly
 * 25 bytes before its first dimension. Its length and nested compatibility frames
 * identify the collection; spectrum-array bytes are never searched for annotations.
 */
export function decodeNativeIntegrals(
  bytes: Uint8Array,
  limits: Limits,
): NativeIntegralAnalysis {
  const end = limits.to - 25;
  if (limits.from < 0 || end > bytes.length || end < limits.from)
    throw Error("Invalid native Mnova analysis bounds.");
  let start = -1;
  for (let at = limits.from; at + 25 <= end; at++) {
    if (
      uint(bytes, at) !== end - at - 4 ||
      uint(bytes, at + 4) !== 4 ||
      uint(bytes, at + 8) !== 0
    )
      continue;
    if (start !== -1)
      throw Error("Ambiguous native Mnova integral collection.");
    start = at;
  }
  if (start === -1) return { integrals: [], found: false, warnings: [] };
  const r = new RecordReader(bytes, start + 12, end),
    normalization = r.f64(),
    absolute = r.u8(),
    count = r.u32();
  if (absolute > 1 || count > 10_000 || (count && normalization === 0))
    throw Error("Invalid native Mnova integral normalization or count.");
  const integrals: Integral[] = [],
    warnings: string[] = [];
  for (let index = 0; index < count; index++) {
    integrals.push(
      readIntegrationEntry(r, limits, index, normalization, warnings).integral,
    );
  }
  if (r.at !== end)
    throw Error(
      "Native Mnova integral collection size does not match its records.",
    );
  return { integrals, normalization, found: true, warnings };
}

function readIntegrationEntry(
  r: RecordReader,
  limits: Limits,
  index: number,
  normalization: number,
  warnings: string[],
) {
  const at = r.at,
    frames = Array.from({ length: 7 }, () => r.u32());
  const ends = frames.map((n, i) => at + (i + 1) * 4 + n);
  if (
    frames[6] !== 0 ||
    frames[5] !== 12 ||
    frames[0] !== frames[1] + 48 ||
    frames[1] !== frames[2] + 5 ||
    frames[3] !== frames[4] + 20 ||
    ends.some((n, i) => n > r.end || (i && n > ends[i - 1]))
  )
    throw Error("Unsupported native Mnova integral compatibility record.");
  // The first modern field is a saved reference area, followed by method options,
  // UUID and optional historical multiplet data. Legacy measurement fields follow
  // the entire compatibility block and remain the authoritative saved areas.
  r.f64();
  r.skip(ends[0] - r.at);
  const savedArea = r.f64();
  r.f64(); // auxiliary accumulated area, distinct for baseline-corrected regions
  const kind = r.u8(),
    enabled = r.u8(),
    regions = r.u32();
  if (kind > 7 || enabled > 1 || !regions || regions > 1000)
    throw Error("Invalid native Mnova integral region count.");
  const bounds: Array<[number, number]> = [];
  for (let j = 0; j < regions; j++) {
    const length = r.u32();
    if (length !== 21 || r.u32() !== 0)
      throw Error("Unsupported native Mnova integration subregion.");
    r.f64();
    r.f64();
    if (r.u8() > 1)
      throw Error("Invalid native Mnova integration baseline flag.");
    const values = Array.from({ length: 15 }, () => r.f64()),
      integralFlag = r.u8(),
      minDimension = r.u32(),
      maxDimension = r.u32(),
      units = r.u32();
    if (
      integralFlag > 1 ||
      minDimension !== 1 ||
      maxDimension !== 1 ||
      units !== 0xffffffff ||
      values[2] === values[3]
    )
      throw Error("Unsupported native Mnova integral dimensions or units.");
    bounds.push([
      Math.min(values[2], values[3]),
      Math.max(values[2], values[3]),
    ]);
  }
  const from = Math.max(...bounds.map((a) => a[1])),
    to = Math.min(...bounds.map((a) => a[0]));
  const area = bounds.reduce(
    (sum, [a, b]) =>
      sum + integrate(limits.data, limits.referenceOffset ?? 0, a, b),
    0,
  );
  const normalizedValue = savedArea / normalization;
  if (![area, normalizedValue, from, to].every(Number.isFinite))
    throw Error("Invalid native Mnova integral measurement.");
  const integral: Integral = {
    id: `mnova-integral-${at}`,
    from,
    to,
    area,
    label: String(index + 1),
    imported: {
      source: "Mnova",
      normalizedValue,
      rawArea: savedArea,
      referenceArea: normalization,
    },
  };
  if (regions > 1)
    warnings.push(
      `Saved integral ${index + 1} combines ${regions} disjoint subregions; its saved value is preserved, and the editable envelope spans their outer limits.`,
    );
  return { integral, multipletFrom: ends[3], multipletTo: ends[2], at };
}

function nestedEnds(r: RecordReader, count: number) {
  const at = r.at,
    frames = Array.from({ length: count }, () => r.u32());
  const ends = frames.map((n, i) => at + (i + 1) * 4 + n);
  if (
    frames[count - 1] !== 0 ||
    ends.some((n, i) => n > r.end || (i && n > ends[i - 1]))
  )
    throw Error("Invalid native Mnova annotation compatibility frames.");
  return ends;
}
function text(r: RecordReader) {
  const n = r.u32();
  if (n === 0xffffffff) return "";
  if (n > 200_000 || n % 2)
    throw Error("Invalid native Mnova annotation text.");
  r.need(n);
  const result = new TextDecoder("utf-16be").decode(
    r.bytes.subarray(r.at, r.at + n),
  );
  r.skip(n);
  return result.replace(/\r\n?/g, "\n");
}
function skipFrame(r: RecordReader) {
  const n = r.u32();
  r.skip(n);
}

/** Two framed processing records precede the authoritative saved peak list. */
export function decodeNativePeaks(
  bytes: Uint8Array,
  limits: { from: number; to: number },
): Array<Peak & { label?: string }> {
  if (limits.from < 0 || limits.to > bytes.length || limits.from >= limits.to)
    throw Error("Invalid native Mnova peak bounds.");
  const r = new RecordReader(bytes, limits.from, limits.to);
  skipFrame(r);
  skipFrame(r);
  const listLength = r.u32(),
    listEnd = r.at + listLength;
  r.need(listLength);
  const list = new RecordReader(bytes, r.at, listEnd),
    headerStart = list.at,
    headerSize = list.u32();
  if (headerSize < 40 || headerSize > 100_000 || list.u32() !== 0)
    throw Error("Unsupported native Mnova peak collection.");
  const headerEnd = headerStart + 4 + headerSize;
  list.f64();
  list.f64();
  list.f64();
  if (list.u32() !== 0) throw Error("Unsupported native Mnova peak header.");
  list.u32();
  const widthCount = list.u32();
  if (widthCount > 7 || headerSize !== 40 + widthCount * 8)
    throw Error("Unsupported native Mnova peak dimensions.");
  for (let i = 0; i < widthCount; i++) list.f64();
  if (list.at !== headerEnd)
    throw Error("Invalid native Mnova peak header length.");
  const count = list.u32();
  if (count > 20_000)
    throw Error("Native Mnova peak count exceeds local limit.");
  const peaks: Array<Peak & { label?: string }> = [];
  for (let i = 0; i < count; i++) {
    const at = list.at,
      ends = nestedEnds(list, 11);
    list.skip(ends[2] - list.at);
    const label = text(list);
    if (list.at !== ends[1])
      throw Error("Invalid native Mnova peak annotation length.");
    list.u8();
    if (list.at !== ends[0])
      throw Error("Unsupported native Mnova peak compatibility tail.");
    if (list.u8() > 1) throw Error("Invalid native Mnova peak sign flag.");
    const ppm = list.f64();
    list.f64();
    list.f64();
    const height = list.f64();
    list.u8();
    list.u8();
    list.u8();
    for (let j = 0; j < 6; j++) list.f64();
    peaks.push({
      id: `mnova-peak-${at}`,
      ppm,
      height,
      ...(label ? { label } : {}),
    });
  }
  if (list.at !== listEnd)
    throw Error(
      "Native Mnova peak collection size does not match its records.",
    );
  return peaks;
}

function multipletData(bytes: Uint8Array, from: number, to: number) {
  const outer = new RecordReader(bytes, from, to),
    n = outer.u32();
  if (!n || outer.at + n !== to)
    throw Error("Missing native Mnova multiplet data.");
  const r = new RecordReader(bytes, outer.at, to),
    ends = nestedEnds(r, 12);
  r.skip(ends[10] - r.at);
  const nuclideCount = r.f64();
  if (r.at !== ends[9])
    throw Error("Invalid native Mnova nuclide count field.");
  // Saved peak membership lives in the modern UUID/flag map.
  r.skip(ends[5] - r.at);
  const memberCount = r.u32();
  if (memberCount > 20_000 || r.at + memberCount * 20 !== ends[4])
    throw Error("Invalid native Mnova multiplet peak membership.");
  r.skip(memberCount * 20);
  r.skip(ends[0] - r.at);
  if (r.u32() !== 0)
    throw Error("Unsupported native Mnova chemical-shift measure.");
  const center = r.f64();
  r.f64();
  const count = r.u32();
  if (count > 100)
    throw Error("Native Mnova multiplet coupling count exceeds local limit.");
  const couplingsHz: number[] = [];
  for (let i = 0; i < count; i++) {
    if (r.u32() !== 0)
      throw Error("Unsupported native Mnova coupling measure.");
    const coupling = r.f64();
    r.f64();
    couplingsHz.push(coupling);
  }
  r.u32();
  const label = text(r),
    kind = text(r);
  r.f64();
  if (r.u8() !== 1)
    throw Error("Invalid native Mnova multiplet validity flag.");
  // Deprecated compatibility peak list is framed separately; current membership
  // is taken from the authoritative modern UUID map above.
  const peakHeaderStart = r.at,
    peakHeader = r.u32();
  r.skip(peakHeader);
  const legacyPeakCount = r.u32();
  if (
    legacyPeakCount !== 0 ||
    r.at !== to ||
    peakHeaderStart + 4 + peakHeader + 4 !== to
  )
    throw Error(
      "Unsupported native Mnova historical multiplet peak extension.",
    );
  return {
    center,
    couplingsHz,
    label,
    kind,
    peakCount: memberCount,
    nuclideCount,
  };
}

/** Modern multiplet collection is independently framed before the processed data. */
export function decodeNativeMultiplets(
  bytes: Uint8Array,
  limits: Limits,
): { multiplets: Multiplet[]; found: boolean; warnings: string[] } {
  if (limits.from < 0 || limits.to > bytes.length || limits.from > limits.to)
    throw Error("Invalid native Mnova multiplet bounds.");
  let scanFrom = limits.from;
  if (limits.previousSourceEnd !== undefined) {
    const previous = new RecordReader(
      bytes,
      limits.previousSourceEnd,
      limits.to,
    );
    skipFrame(previous);
    skipFrame(previous);
    skipFrame(previous);
    scanFrom = previous.at;
  }
  const candidates: number[] = [];
  for (let at = scanFrom; at + 65 <= limits.to; at++) {
    if (
      uint(bytes, at + 4) !== 44 ||
      uint(bytes, at + 8) !== 0 ||
      uint(bytes, at + 12) !== 0
    )
      continue;
    const n = uint(bytes, at);
    if (n < 61 || at + 4 + n > limits.to) continue;
    candidates.push(at);
  }
  if (!candidates.length) return { multiplets: [], found: false, warnings: [] };
  if (candidates.length !== 1)
    throw Error("Ambiguous native Mnova multiplet collection.");
  const start = candidates[0],
    end = start + 4 + uint(bytes, start),
    r = new RecordReader(bytes, start + 52, end),
    norm = r.f64(),
    flag = r.u8(),
    count = r.u32();
  if (flag > 1 || count > 10_000 || (count && norm === 0))
    throw Error("Invalid native Mnova multiplet count or normalization.");
  const multiplets: Multiplet[] = [],
    warnings: string[] = [];
  for (let i = 0; i < count; i++) {
    const entry = readIntegrationEntry(r, limits, i, norm, warnings),
      decoded = multipletData(bytes, entry.multipletFrom, entry.multipletTo);
    const { nuclideCount, ...m } = decoded;
    multiplets.push({
      id: `mnova-multiplet-${entry.at}`,
      from: entry.integral.from,
      to: entry.integral.to,
      ...m,
      ...{ imported: { ...entry.integral.imported!, nuclideCount } },
    });
  }
  if (r.at !== end)
    throw Error(
      "Native Mnova multiplet collection size does not match its records.",
    );
  return { multiplets, found: true, warnings };
}
