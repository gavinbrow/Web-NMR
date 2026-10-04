import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { importMnovaNative, setNativeCodecForTests } from "./mnovaNative";
const merge = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
};
const f32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, n, false);
  return b;
};
const f64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, false);
  return b;
};
const text = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), false);
  return merge(u32(b.length), b);
};
function axis(
  n: number,
  nucleus = "1H",
  lower = -400,
  width = 4000,
  frequency = 400,
) {
  const bytes = nucleus.length * 2;
  return merge(
    ...[104 + bytes, 99 + bytes, 91, 86, 74, 22, 10, 5, 0].map(u32),
    new Uint8Array([9, 1]),
    ...[0, lower, frequency, width, 0, 0, 0].map(f64),
    f32(0),
    f32(0),
    new Uint8Array([0]),
    text(nucleus),
    new Uint8Array([1]),
    f32(lower),
    f32(400),
    u32(1),
    u32(n),
    f32(width),
    f32(0),
  );
}
function record(
  real: number[],
  imag?: number[],
  compressed?: Uint8Array,
  n = real.length,
  twoD: boolean | [number, number] = false,
  endian = 1,
) {
  const scalar = axis(1, "Unknown", 0, 1000),
    dims = twoD
      ? merge(
          scalar,
          axis(Array.isArray(twoD) ? twoD[1] : 2, "13C", -100, 2000, 100),
          axis(Array.isArray(twoD) ? twoD[0] : 3, "1H", -400, 4000, 400),
          scalar,
          scalar,
          scalar,
          scalar,
        )
      : merge(scalar, axis(n), scalar, scalar, scalar, scalar, scalar);
  let payload: Uint8Array;
  if (compressed) payload = compressed;
  else {
    payload = new Uint8Array(n * (imag ? 2 : 1) * 4);
    const v = new DataView(payload.buffer);
    for (let i = 0; i < n; i++) {
      v.setFloat32(i * (imag ? 2 : 1) * 4, real[i], endian === 1);
      if (imag) v.setFloat32(i * 8 + 4, imag[i], endian === 1);
    }
  }
  const data = merge(u32(payload.length), new Uint8Array([endian]), payload),
    array = merge(
      u32(0),
      new Uint8Array([1, compressed ? 1 : 0]),
      u32(data.length),
      data,
    );
  return merge(
    u32(13),
    u32(5),
    u32(0),
    new Uint8Array([imag ? 0 : 1]),
    u32(0),
    dims,
    u32(twoD ? 2 : 1),
    new Uint8Array([imag ? 0 : 1]),
    f32(1),
    dims,
    u32(array.length),
    array,
  );
}
function parameter(name: string, value: string) {
  return merge(
    text(value),
    new Uint8Array([233]),
    text(name),
    u32(13),
    u32(5),
    u32(0),
    new Uint8Array([1]),
  );
}
function doc(records: Uint8Array[], comment = "Synthetic\nfixture") {
  return merge(
    new TextEncoder().encode("Mestrelab Research S.L."),
    new Uint8Array([241, 226, 211, 196]),
    u32(12),
    new TextEncoder().encode("NMR Spectrum"),
    text("NMR"),
    parameter("Title", "Synthetic sample"),
    parameter("Comment", comment),
    ...records,
  );
}
const buffer = (v: Uint8Array) =>
  v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
beforeAll(() =>
  setNativeCodecForTests(
    readFileSync(new URL("./mnovaCodec/openjpeg.wasm", import.meta.url)),
  ),
);
describe("native Mnova bounded dialect", () => {
  it("decodes authored real and complex interleaved records, UTF-16 comments and exact ppm calibration", async () => {
    const real = [-2, 0, 3.5, 100],
      imag = [0.5, -2, 0, 9];
    const result = await importMnovaNative(
      buffer(doc([record(real, imag), record(real, imag)])),
    );
    const s = result.spectra[0];
    expect([...s.data.real]).toEqual(real);
    expect([...s.data.imag!]).toEqual(imag);
    expect([...s.data.x]).toEqual([9, 6.5, 4, 1.5]);
    expect(s.metadata.comment).toBe("Synthetic\nfixture");
    expect(s.recipe.ph0).toBe(0);
    expect(s.recipe.baseline).toBe("none");
  });
  it("reconstructs all 4096 authored compressed points exactly, including negative baseline and peak maxima", async () => {
    const encoded = readFileSync(
      new URL("./fixtures/mnova-synthetic-compressed.bin", import.meta.url),
    );
    const expected = readFileSync(
      new URL("./fixtures/mnova-synthetic-expected.bin", import.meta.url),
    );
    const n = 4096;
    const result = await importMnovaNative(
      buffer(
        doc([record([], undefined, encoded, n), record(Array(n).fill(0))]),
      ),
    );
    const v = new DataView(
      expected.buffer,
      expected.byteOffset,
      expected.byteLength,
    );
    for (let i = 0; i < n; i++)
      expect(result.spectra[0].data.real[i]).toBe(v.getFloat32(i * 4, false));
    expect(Math.min(...result.spectra[0].data.real)).toBeLessThan(0);
    expect(Math.max(...result.spectra[0].data.real)).toBeGreaterThan(119);
  });
  it("retains both compressed complex channels without discarding imaginary values", async () => {
    const stored = readFileSync(
      new URL("./fixtures/mnova-synthetic-compressed.bin", import.meta.url),
    );
    const v = new DataView(stored.buffer, stored.byteOffset, stored.byteLength),
      end = 29 + v.getUint32(25, false);
    const complex = merge(
      stored.subarray(0, end),
      stored.subarray(17, end),
      new Uint8Array([0]),
    );
    const n = 4096;
    const opened = await importMnovaNative(
      buffer(
        doc([
          record([], Array(n).fill(0), complex, n),
          record(Array(n).fill(0), Array(n).fill(0)),
        ]),
      ),
    );
    expect(opened.spectra[0].data.imag).toEqual(opened.spectra[0].data.real);
  });
  it("maps independent F1/F2 nuclei, frequencies and ranges onto a non-square row-major matrix", async () => {
    const values = [1, 2, 3, 4, 5, 6],
      r = record(values, undefined, undefined, 6, true);
    const result = await importMnovaNative(buffer(doc([r, r])));
    const s = result.spectra[0],
      p = s.twoD!;
    expect(p.width).toBe(3);
    expect(p.height).toBe(2);
    expect(s.nucleus).toBe("1H");
    expect(s.frequencyMHz).toBe(400);
    expect(p.nucleusF1).toBe("13C");
    expect(p.frequencyF1).toBe(100);
    expect(p.x[0]).toBe(9);
    expect(p.x[1]).toBeCloseTo(17 / 3, 12);
    expect(p.x[2]).toBeCloseTo(7 / 3, 12);
    expect([...p.y]).toEqual([19, 9]);
    expect([...p.real]).toEqual(values);
    expect([...s.data.real]).toEqual([4, 5, 6]);
  });
  it("rejects a JPEG matrix shape that disagrees with the separate axes even when its total sample count matches", async () => {
    const encoded = readFileSync(
      new URL("./fixtures/mnova-synthetic-compressed.bin", import.meta.url),
    );
    const r = record([], undefined, encoded, 4096, [256, 16]);
    await expect(importMnovaNative(buffer(doc([r, r])))).rejects.toThrow(
      "dimensions or precision",
    );
  });
  it("respects declared big-endian complex float samples", async () => {
    const real = [-100, 0.5, 2.25],
      imag = [2, 1, -3],
      r = record(real, imag, undefined, 3, false, 0);
    const imported = await importMnovaNative(buffer(doc([r, r])));
    expect([...imported.spectra[0].data.real]).toEqual(real);
    expect([...imported.spectra[0].data.imag!]).toEqual(imag);
  });
  it("rejects truncation rather than importing partial samples", async () => {
    const good = doc([record([1, 2, 3]), record([1, 2, 3])]);
    await expect(importMnovaNative(buffer(good.slice(0, -3)))).rejects.toThrow(
      /Truncated|outside|byte count/,
    );
  });
  it("rejects corrupt channel byte counts", async () => {
    const good = doc([record([1, 2, 3]), record([1, 2, 3])]);
    const altered = good.slice();
    const v = new DataView(altered.buffer);
    v.setUint32(altered.length - 17, 13, false);
    await expect(importMnovaNative(buffer(altered))).rejects.toThrow(
      /byte count|sample count/,
    );
  });
  it("bounds aggregate retained data before decompressing another array", async () => {
    const zeroBlob = merge(
      u32(13),
      u32(5),
      u32(0),
      new Uint8Array([1]),
      f32(1),
      f32(0),
      f32(0),
      u32(0),
      f32(0),
      f32(0),
      u32(0),
      new Uint8Array([0]),
    );
    const giant = record([], undefined, zeroBlob, 4_194_304);
    await expect(
      importMnovaNative(
        buffer(doc([giant, giant, giant, giant, giant, giant])),
      ),
    ).rejects.toThrow("160 MB");
  });
});
