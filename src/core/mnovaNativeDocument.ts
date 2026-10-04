import { NativeReader, nativeMatches } from "./mnovaNativeReader";

export interface NativePageFrame {
  pageIndex: number;
  pageId: string;
  title: string;
  notes: string;
  from: number;
  to: number;
  items: {
    from: number;
    to: number;
    rtti: number;
    pluginId: string;
    nmrOffsets: number[];
  }[];
}
function nativeUuid(r: NativeReader): string {
  r.need(16);
  const hex = Array.from(r.bytes.subarray(r.at, r.at + 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  r.at += 16;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function nextBlock(r: NativeReader): NativeReader {
  const child = r.block();
  r.at = child.end;
  return child;
}
function exactEnd(r: NativeReader) {
  if (r.at !== r.end) throw Error("Mnova page frame endpoint mismatch.");
}
/** Modern TPage/Utils::Page serialization; require the complete collection and known NMR item membership. */
export function decodeNativePages(
  bytes: Uint8Array,
  nmrOffsets: number[],
): NativePageFrame[] | undefined {
  if (
    !nmrOffsets.length ||
    nmrOffsets.some((p) => !Number.isInteger(p) || p < 0 || p >= bytes.length)
  )
    return;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = Math.min(...nmrOffsets);
  // The page-list location varies with document history. Candidate recognition is cheap;
  // acceptance requires all page/item endpoints, counts and supplied NMR positions.
  for (let at = 0; at + 16 <= first; at++) {
    if (v.getUint32(at, false) !== 0) continue;
    const length = v.getUint32(at + 4, false),
      count = v.getUint32(at + 8, false);
    if (
      count < 1 ||
      count > 512 ||
      length < 8 ||
      at + 8 + length > bytes.length ||
      v.getUint32(at + 12, false) !== length - 8
    )
      continue;
    try {
      const list = new NativeReader(bytes, at + 12, at + 8 + length);
      const pages = nextBlock(list);
      exactEnd(list);
      const result: NativePageFrame[] = [];
      for (let i = 0; i < count; i++) {
        const from = pages.at;
        const modern = nextBlock(pages),
          b = nextBlock(modern),
          c = nextBlock(b),
          d = nextBlock(c);
        const compatibility = nextBlock(d);
        exactEnd(compatibility); // Empty modern compatibility frame.
        nextBlock(d); // Bounded page history, unrelated to canvas membership.
        exactEnd(d);
        const notes = c.text();
        exactEnd(c);
        const title = b.text();
        exactEnd(b);
        nextBlock(modern); // TPageLayout frame.
        exactEnd(modern);
        const legacy = nextBlock(pages),
          oldPaper = nextBlock(legacy),
          rectangles = nextBlock(legacy);
        if (
          oldPaper.end - oldPaper.at !== 40 ||
          rectangles.end - rectangles.at !== 32
        )
          throw Error("Unrecognized Mnova page geometry.");
        const pageId = nativeUuid(legacy);
        exactEnd(nextBlock(legacy));
        const members = nextBlock(legacy),
          itemCount = members.u32();
        if (itemCount > 4096)
          throw Error("Mnova canvas item count exceeds bounds.");
        const itemList = nextBlock(members);
        exactEnd(members);
        const items: NativePageFrame["items"] = [];
        for (let j = 0; j < itemCount; j++) {
          const itemFrom = itemList.at;
          exactEnd(nextBlock(itemList));
          const item = nextBlock(itemList),
            rtti = item.u32(),
            pluginId = nativeUuid(item);
          if (rtti > 1_000_000) throw Error("Invalid Mnova canvas item type.");
          items.push({
            from: itemFrom,
            to: item.end,
            rtti,
            pluginId,
            nmrOffsets: nmrOffsets.filter((p) => p >= item.at && p < item.end),
          });
        }
        exactEnd(itemList);
        exactEnd(legacy);
        result.push({
          pageIndex: i + 1,
          pageId,
          title,
          notes,
          from,
          to: pages.at,
          items,
        });
      }
      exactEnd(pages);
      const recognized = result.flatMap((p) =>
        p.items.flatMap((item) => item.nmrOffsets),
      );
      if (
        recognized.length !== nmrOffsets.length ||
        !nmrOffsets.every((p) => recognized.includes(p))
      )
        continue;
      return result;
    } catch {
      // A candidate inside an unrelated Qt object cannot pass the complete page-list framing.
    }
  }
}

const axisFrames = Uint8Array.from([
  0, 0, 0, 24, 0, 0, 0, 19, 0, 0, 0, 11, 0, 0, 0, 5, 0, 0, 0, 0,
]);
interface NativeAxis {
  end: number;
  type: number;
  from: number;
  to: number;
  name: string;
}
/** Modern Qt TAxis compatibility frames followed by its bounded legacy value block. */
function axis(
  bytes: Uint8Array,
  at: number,
  end: number,
): NativeAxis | undefined {
  if (!nativeMatches(bytes, at, axisFrames)) return;
  const r = new NativeReader(bytes, at + axisFrames.length, end);
  const direction = r.u8(),
    tick = r.u8(),
    unused = r.u8();
  const decimals = r.u32(),
    enabled = r.u8();
  if (direction > 2 || tick > 3 || unused !== 0 || decimals > 16 || enabled > 1)
    return;
  const block = r.block();
  const type = block.u32();
  block.u32();
  block.u32();
  if (type > 2 || block.u8() > 1) return;
  block.f64();
  if (block.u8() > 1) return;
  block.f64();
  block.f64();
  const from = block.f64(),
    to = block.f64();
  block.u32();
  block.need(5);
  block.at += 5;
  const name = block.text();
  block.u32();
  if (block.at !== block.end) return;
  return { end: block.end, type, from, to, name };
}
function color(bytes: Uint8Array, at: number, end: number): string | undefined {
  if (at + 11 > end || bytes[at] !== 1) return; // QColor RGB, five big-endian 16-bit components.
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(at + 9, false) !== 0) return;
  return (
    "#" +
    [3, 5, 7]
      .map((o) =>
        Math.round(v.getUint16(at + o, false) / 257)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export interface NativeDocumentFrame {
  xView: [number, number];
  color?: string;
  metadata: Record<string, string | number>;
}
/** Accept a plot only when all three independently framed axes occur consecutively in its graph record. */
export function decodeNativeDocumentFrame(
  bytes: Uint8Array,
  from: number,
  to: number,
): NativeDocumentFrame | undefined {
  for (let p = from; p + axisFrames.length < to; p++) {
    if (!nativeMatches(bytes, p, axisFrames)) continue;
    try {
      const x = axis(bytes, p, to);
      if (!x || x.type !== 0 || x.name !== "ppm") continue;
      const y = axis(bytes, x.end, to);
      if (!y || y.type !== 1) continue;
      const z = axis(bytes, y.end, to);
      if (!z || z.type !== 2) continue;
      if (
        Math.abs(x.from) > 100_000 ||
        Math.abs(x.to) > 100_000 ||
        x.from === x.to ||
        y.from === y.to
      )
        continue;
      const metadata: Record<string, string | number> =
        y.name === "ppm"
          ? {
              mnovaViewF1High: Math.max(y.from, y.to),
              mnovaViewF1Low: Math.min(y.from, y.to),
            }
          : {
              mnovaIntensityMin: Math.min(y.from, y.to),
              mnovaIntensityMax: Math.max(y.from, y.to),
            };
      // The recognized item preamble follows Qt type/plugin strings with a canvas QRectF.
      if (from + 58 <= to) {
        const r = new NativeReader(bytes, from + 26, from + 58),
          values = [r.f64(), r.f64(), r.f64(), r.f64()];
        if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
          [
            "mnovaCanvasX",
            "mnovaCanvasY",
            "mnovaCanvasWidth",
            "mnovaCanvasHeight",
          ].forEach((k, i) => (metadata[k] = values[i]));
        }
      }
      return {
        xView: [Math.max(x.from, x.to), Math.min(x.from, x.to)],
        color: color(bytes, z.end, to),
        metadata,
      };
    } catch {
      /* Other Qt objects share some compatibility lengths, but fail complete axis framing. */
    }
  }
}

export interface NativeStackDisplay {
  order: number[];
  hidden: number[];
  selected: number;
}
/** The five TStackedSpectra compatibility frames have exact endpoint checks for each collection. */
export function decodeNativeStackDisplay(
  bytes: Uint8Array,
  from: number,
  to: number,
  count: number,
): NativeStackDisplay | undefined {
  const start = from + 83;
  if (start + 20 > to) return;
  const r = new NativeReader(bytes, start, to);
  const lengths = Array.from({ length: 5 }, () => r.u32());
  if (
    lengths[4] !== 0 ||
    lengths[3] !== 8 ||
    lengths[2] < 16 ||
    lengths[1] < 28 ||
    lengths[0] < 40
  )
    return;
  const list = () => {
    const n = r.u32();
    if (n > 512)
      throw Error("Native stack collection is outside the supported range.");
    return Array.from({ length: n }, () => r.u32());
  };
  r.u32(); // Independent compatibility scalar (+0x88), not the active member.
  if (r.at !== start + 12 + 4 + lengths[3]) return;
  const hidden = list();
  if (r.at !== start + 8 + 4 + lengths[2]) return;
  const order = list();
  if (r.at !== start + 4 + 4 + lengths[1]) return;
  list();
  const selected = r.u32(); // TStackedSpectra current/active member (+0x2c).
  if (r.at !== start + 4 + lengths[0]) return;
  const legacyOrder = list();
  r.u32();
  list();
  // TCanvasNMRSpectrum writes its independent original dataset index list next.
  const original = list();
  const reserved = r.u32();
  if (
    reserved !== 0 ||
    original.length !== count ||
    new Set(original).size !== count ||
    original.some((n, i) => n !== i)
  )
    return;
  const effective = order.length ? order : legacyOrder;
  if (
    effective.length !== count ||
    new Set(effective).size !== count ||
    [...effective, ...hidden].some((n) => n >= count) ||
    selected >= count
  )
    return;
  return { order: effective, hidden, selected };
}

const textItemSignature = Uint8Array.from([
  0, 0, 0, 4, 84, 101, 120, 116, 255, 255, 255, 255,
]);
export interface NativeTextReport {
  offset: number;
  text: string;
  html: string;
  canvas: [number, number, number, number];
}
/** Convert saved QTextDocument markup to inert text, never execute or render imported HTML. */
function reportText(html: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    delta: "δ",
  };
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] !== "#") return entities[entity.toLowerCase()] ?? whole;
      const n =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Modern TCanvasText frames followed by the bounded legacy HTML/QSizeF payload. */
export function decodeNativeTextReports(bytes: Uint8Array): NativeTextReport[] {
  const reports: NativeTextReport[] = [];
  for (let p = 0; p + textItemSignature.length + 70 < bytes.length; p++) {
    if (!nativeMatches(bytes, p, textItemSignature)) continue;
    try {
      const geometry = new NativeReader(bytes, p + 12, p + 44);
      const canvas = [
        geometry.f64(),
        geometry.f64(),
        geometry.f64(),
        geometry.f64(),
      ] as NativeTextReport["canvas"];
      if (canvas[2] <= 0 || canvas[3] <= 0) continue;
      // The item extension is independently bounded and starts with the zero compatibility frame.
      const outer = new NativeReader(bytes, p + 49).block();
      if (outer.u32() !== 0) continue;
      const modernStart = outer.at,
        modern = outer.block();
      if (modern.u32() !== 5 || modern.u32() !== 0 || modern.u8() > 1) continue;
      // Property map is inside the modern frame; the authoritative legacy text follows its endpoint.
      const propertyCount = modern.u32();
      if (propertyCount > 1024 || modern.end <= modernStart + 17) continue;
      outer.at = modern.end;
      const legacy = outer.block(),
        html = legacy.text();
      if (
        legacy.end - legacy.at !== 33 ||
        !/^\s*<!DOCTYPE HTML|^\s*<html\b/i.test(html)
      )
        continue;
      for (let i = 0; i < 4; i++) legacy.f64();
      if (legacy.u8() > 1 || legacy.at !== legacy.end) continue;
      reports.push({ offset: p, canvas, html, text: reportText(html) });
      if (reports.length > 512)
        throw Error("Native text object count exceeds the local limit.");
      p = legacy.end - 1;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Native text object count exceeds the local limit."
      )
        throw error;
      /* Reject unrelated Qt strings unless the complete item and text frames agree. */
    }
  }
  return reports;
}
