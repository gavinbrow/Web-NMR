import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  decodeNativeDocumentFrame,
  decodeNativeStackDisplay,
  decodeNativeTextReports,
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
it("restores bounded stack order and hidden entries independently of storage order", () => {
  // Three authored members, one hidden. Lengths copied from the verified collection framing.
  const values = [
    52, 40, 20, 8, 0, 2, 1, 1, 3, 2, 0, 1, 0, 0, 3, 2, 0, 1, 0, 0, 3, 0, 1, 2,
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
