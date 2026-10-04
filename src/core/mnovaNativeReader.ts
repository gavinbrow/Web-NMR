const utf16 = new TextDecoder("utf-16be");
export class NativeReader {
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
    return new NativeReader(this.bytes, this.at, this.at + n);
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
export function nativeMatches(b: Uint8Array, at: number, s: Uint8Array) {
  if (at < 0 || at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s[i]) return false;
  return true;
}
