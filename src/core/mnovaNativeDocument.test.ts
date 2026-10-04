import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  decodeNativeDocumentFrame,
  decodeNativeStackDisplay,
  decodeNativeTextReports,
  decodeNativePages,
} from "./mnovaNativeDocument";

function authoredAxis(type: number, name: string, from: number, to: number) {
  const chunks: Uint8Array[] = [];
  const write = (n: number, bytes: number) => {
    const b = new Uint8Array(bytes);
    const v = new DataView(b.buffer);
    if (bytes === 4) v.setUint32(0, n);
    else if (bytes === 8) v.setFloat64(0, n);
    else b[0] = n;
    chunks.push(b);
  };
  [24, 19, 11, 5, 0].forEach((n) => write(n, 4));
  [0, 0, 0].forEach((n) => write(n, 1));
  write(6, 4);
  write(1, 1);
  const payload = 71 + name.length * 2;
  write(payload, 4);
  [type, 0, 0].forEach((n) => write(n, 4));
  write(1, 1);
  write(0, 8);
  write(1, 1);
  [from, to, from, to].forEach((n) => write(n, 8));
  write(10, 4);
  chunks.push(new Uint8Array([0, 2, 0, 0, 1]));
  write(name.length * 2, 4);
  const text = new Uint8Array(name.length * 2);
  name
    .split("")
    .forEach((c, i) =>
      new DataView(text.buffer).setUint16(i * 2, c.charCodeAt(0)),
    );
  chunks.push(text);
  write(0, 4);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
it("requires consecutive full Qt axes and restores exact range plus Qt RGB color", () => {
  const axes = [
    authoredAxis(0, "ppm", 1.1, 8.2),
    authoredAxis(1, "Intensity", -2, 100),
    authoredAxis(2, "", 0, 1),
  ];
  const b = new Uint8Array(150 + axes.reduce((n, a) => n + a.length, 0) + 11);
  let at = 150;
  for (const a of axes) {
    b.set(a, at);
    at += a.length;
  }
  b.set([1, 255, 255, 18, 18, 52, 52, 86, 86, 0, 0], at);
  const frame = decodeNativeDocumentFrame(b, 0, b.length);
  expect(frame?.xView).toEqual([8.2, 1.1]);
  expect(frame?.color).toBe("#123456");
  expect(frame?.metadata.mnovaIntensityMin).toBe(-2);
  const truncated = b.slice(0, at - 1);
  expect(
    decodeNativeDocumentFrame(truncated, 0, truncated.length),
  ).toBeUndefined();
});

it("decodes authored page names and multiple canvas-item membership without treating datasets as pages", () => {
  const concat = (...parts: Uint8Array[]) => {
    const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      b.set(p, at);
      at += p.length;
    }
    return b;
  };
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n);
    return b;
  };
  const block = (b: Uint8Array) => concat(u32(b.length), b);
  const empty = () => block(new Uint8Array());
  const text = (s: string) => {
    const b = new Uint8Array(s.length * 2);
    const v = new DataView(b.buffer);
    for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i));
    return block(b);
  };
  const item = (rtti: number, payload: number) =>
    concat(
      empty(),
      block(
        concat(u32(rtti), new Uint8Array(16), Uint8Array.of(payload, 9, 8)),
      ),
    );
  const page = (title: string, notes: string, items: Uint8Array[]) => {
    const d = block(concat(empty(), empty()));
    const c = block(concat(d, text(notes)));
    const b = block(concat(c, text(title)));
    const modern = block(concat(b, empty()));
    const list = concat(
      empty(),
      block(concat(u32(items.length), block(concat(...items)))),
    );
    const legacy = block(
      concat(
        block(new Uint8Array(40)),
        block(new Uint8Array(32)),
        new Uint8Array(16),
        list,
      ),
    );
    return concat(modern, legacy);
  };
  const first = page("Owned page α", "Saved notes\r\nSecond line", [
    item(109, 123),
    item(107, 124),
  ]);
  const second = page("", "", [item(109, 125)]);
  const bytes = concat(
    Uint8Array.of(222, 111, 33),
    empty(),
    block(concat(u32(2), block(concat(first, second)))),
  );
  const offsets = [bytes.indexOf(123), bytes.indexOf(125)];
  const result = decodeNativePages(bytes, offsets);
  expect(result).toHaveLength(2);
  expect(result?.[0].title).toBe("Owned page α");
  expect(result?.[0].notes).toBe("Saved notes\nSecond line");
  expect(result?.map((p) => p.pageIndex)).toEqual([1, 2]);
  expect(result?.map((p) => p.items.length)).toEqual([2, 1]);
  expect(result?.[0].items.map((i) => i.nmrOffsets)).toEqual([
    [offsets[0]],
    [],
  ]);
  expect(result?.[1].items[0].nmrOffsets).toEqual([offsets[1]]);
  expect(result?.[0].to).toBe(result?.[1].from);
  expect(decodeNativePages(bytes.slice(0, -1), offsets)).toBeUndefined();
  expect(decodeNativePages(bytes, [1])).toBeUndefined();
  const corrupt = bytes.slice();
  new DataView(corrupt.buffer).setUint32(11, 3);
  expect(decodeNativePages(corrupt, offsets)).toBeUndefined();
});
it("restores bounded stack order and hidden entries independently of storage order", () => {
  // Three authored members, one hidden. Lengths copied from the verified collection framing.
  const values = [
    52, 40, 20, 8, 0, 0, 1, 1, 3, 2, 0, 1, 0, 2, 3, 2, 0, 1, 0, 0, 3, 0, 1, 2,
    0,
  ];
  const b = new Uint8Array(83 + values.length * 4);
  const v = new DataView(b.buffer);
  values.forEach((n, i) => v.setUint32(83 + i * 4, n));
  const result = decodeNativeStackDisplay(b, 0, b.length, 3);
  expect(result).toEqual({ order: [2, 0, 1], hidden: [1], selected: 2 });
  v.setUint32(83 + 9 * 4, 99);
  expect(decodeNativeStackDisplay(b, 0, b.length, 3)).toBeUndefined();
});
describe("external native document framing", () => {
  const p =
    "/Users/gavinbrown/Documents/Projects/Web NMR/Example Files/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnova";
  it.skipIf(!existsSync(p))(
    "matches independently exported first1D axes and genuine five-member stack",
    () => {
      const b = new Uint8Array(readFileSync(p));
      const frame = decodeNativeDocumentFrame(b, 379256, 419559);
      expect(frame?.xView).toEqual([8.440252831970579, 3.341754477624404]);
      expect(frame?.metadata.mnovaCanvasX).toBe(5321);
      expect(decodeNativeStackDisplay(b, 8514780, 8800000, 5)).toEqual({
        order: [0, 1, 2, 3, 4],
        hidden: [],
        selected: 0,
      });
      expect(decodeNativeStackDisplay(b, 6050534, 6400000, 7)?.selected).toBe(
        0,
      );
      expect(
        decodeNativeStackDisplay(b, 10532996, 10800000, 13)?.selected,
      ).toBe(11);
      const offsets = [
        379256, 845043, 1294107, 1738381, 2180693, 2624936, 3065187, 3505166,
        3943965, 4382852, 4814995, 5242861, 5678955, 6050534, 8514780, 10532996,
      ];
      const pages = decodeNativePages(b, offsets);
      expect(pages).toHaveLength(16);
      expect(pages?.every((p) => p.title === "" && p.notes === "")).toBe(true);
      expect(pages?.map((p) => p.items.length)).toEqual([
        1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1,
      ]);
      expect(
        pages?.flatMap((p) => p.items.flatMap((i) => i.nmrOffsets)),
      ).toEqual(offsets);
      const reports = decodeNativeTextReports(b);
      expect(reports).toHaveLength(2);
      expect(reports[0].offset).toBe(1204670);
      expect(
        reports.every((r) => r.text.startsWith("Multiplet Report\n1H NMR")),
      ).toBe(true);
      expect(reports[0].text).toContain("δ");
      expect(reports[0].html).toContain("<!DOCTYPE HTML");
    },
  );
});
it("preserves saved report markup while extracting inert text and rejects a truncated legacy text frame", () => {
  const merge = (...parts: Uint8Array[]) => {
    const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      b.set(p, at);
      at += p.length;
    }
    return b;
  };
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n);
    return b;
  };
  const f64 = (n: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n);
    return b;
  };
  const block = (b: Uint8Array) => merge(u32(b.length), b);
  const html =
    "<html><head><style>hidden</style><script>danger()</script></head><body><p>Owned &amp; editable &#x3b4;</p><p>Second</p></body></html>";
  const encoded = new Uint8Array(html.length * 2);
  [...html].forEach((c, i) =>
    new DataView(encoded.buffer).setUint16(i * 2, c.charCodeAt(0)),
  );
  const modern = block(merge(u32(5), u32(0), Uint8Array.of(1), u32(0), u32(0)));
  const legacy = block(merge(block(encoded), new Uint8Array(33)));
  const b = merge(
    Uint8Array.from([0, 0, 0, 4, 84, 101, 120, 116, 255, 255, 255, 255]),
    ...[10, 20, 30, 40].map(f64),
    new Uint8Array(5),
    block(merge(u32(0), modern, legacy)),
  );
  expect(decodeNativeTextReports(b)).toEqual([
    {
      offset: 0,
      canvas: [10, 20, 30, 40],
      html,
      text: "Owned & editable δ\nSecond",
    },
  ]);
  expect(decodeNativeTextReports(b.slice(0, -1))).toEqual([]);
});
