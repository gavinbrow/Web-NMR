import type { ComplexData, TwoDSpectrum, TwoDRawData } from "../model";
import { correctDigitalFilter, fft, nextPowerOfTwo } from "./numerics";

export type BrukerParams = Record<string, string | number>;
export const MAX_2D_ELEMENTS = 10_000_000;
const MAX_COMPONENT_BYTES = 160 * 1024 * 1024;
function required(p: BrukerParams, key: string, positive = false): number {
  const value = Number(p[key]);
  if (!Number.isFinite(value) || (positive && value <= 0))
    throw new Error(`Missing or invalid 2D Bruker parameter ${key}.`);
  return value;
}
function dimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width * height > MAX_2D_ELEMENTS
  )
    throw new Error(
      "2D matrix must contain 2 or more points on each axis and at most 10 million elements.",
    );
}
export function processedAxis(p: BrukerParams): Float64Array {
  const size = required(p, "SI", true),
    frequency = required(p, "SF", true),
    width = required(p, "SW_p", true),
    offset = required(p, "OFFSET");
  if (size > MAX_2D_ELEMENTS || !Number.isInteger(size))
    throw new Error("Invalid 2D processing axis size.");
  if (
    (p.STSR !== undefined && Number(p.STSR) !== 0) ||
    (p.STSI !== undefined && Number(p.STSI) !== 0 && Number(p.STSI) !== size)
  )
    throw new Error(
      "Cropped 2D STSR/STSI processing is not supported. Export full processed planes.",
    );
  return Float64Array.from(
    { length: size },
    (_, i) => offset - (i * width) / (size * frequency),
  );
}

/** Bruker submatrices occur F1 block-major, F2 block-minor; each tile itself is row-major. */
export function decodeTiledPlane(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  byteOrder: number,
  numericType: number,
  scale: number,
): Float64Array {
  dimensions(width, height);
  if (![0, 1].includes(byteOrder) || ![0, 2].includes(numericType))
    throw new Error(
      "2D binary decoding supports declared little/big-endian int32 or float64 only.",
    );
  if (
    !Number.isInteger(tileWidth) ||
    !Number.isInteger(tileHeight) ||
    tileWidth < 1 ||
    tileHeight < 1 ||
    width % tileWidth ||
    height % tileHeight
  )
    throw new Error(
      "Bruker 2D SI must be divisible by XDIM in both dimensions.",
    );
  const bytes = numericType === 2 ? 8 : 4,
    count = width * height;
  if (buffer.byteLength !== count * bytes)
    throw new Error(
      "2D plane size does not match SI/XDIM parameters; partial or padded matrices are unsupported.",
    );
  const data = new Float64Array(count),
    view = new DataView(buffer);
  let stored = 0;
  for (let blockY = 0; blockY < height; blockY += tileHeight)
    for (let blockX = 0; blockX < width; blockX += tileWidth) {
      for (let row = 0; row < tileHeight; row++)
        for (let col = 0; col < tileWidth; col++) {
          const value =
            (numericType === 2
              ? view.getFloat64(stored * bytes, byteOrder === 0)
              : view.getInt32(stored * bytes, byteOrder === 0)) * scale;
          if (!Number.isFinite(value))
            throw new Error("2D plane contains non-finite values.");
          data[(blockY + row) * width + blockX + col] = value;
          stored++;
        }
    }
  return data;
}
export function readProcessedTwoD(
  files: {
    rr: ArrayBuffer;
    ri?: ArrayBuffer;
    ir?: ArrayBuffer;
    ii?: ArrayBuffer;
  },
  f2: BrukerParams,
  f1: BrukerParams,
  acquisitionF1?: BrukerParams,
  experiment = "2D NMR",
): TwoDSpectrum {
  const width = required(f2, "SI", true),
    height = required(f1, "SI", true);
  dimensions(width, height);
  const parts = [files.rr, files.ri, files.ir, files.ii].filter(Boolean).length;
  if (width * height * parts * 8 > MAX_COMPONENT_BYTES)
    throw new Error(
      "2D components exceed the 160 MB decoded matrix limit. Import the 2rr plane only.",
    );
  const x = processedAxis(f2),
    y = processedAxis(f1),
    tileW = required(f2, "XDIM", true),
    tileH = required(f1, "XDIM", true),
    order = required(f2, "BYTORDP"),
    type = required(f2, "DTYPP"),
    scale = 2 ** required(f2, "NC_proc");
  const decode = (buffer?: ArrayBuffer) =>
    buffer
      ? decodeTiledPlane(
          buffer,
          width,
          height,
          tileW,
          tileH,
          order,
          type,
          scale,
        )
      : undefined;
  const conjugate = (buffer?: ArrayBuffer) => {
    const plane = decode(buffer);
    if (plane) for (let i = 0; i < plane.length; i++) plane[i] = -plane[i];
    return plane;
  };
  return {
    x,
    y,
    real: decode(files.rr)!,
    // Bruker names the F2 component first. Conjugate each imaginary axis to
    // the positive-FFT convention; two conjugations leave 2ii unchanged.
    imagF2: conjugate(files.ir),
    imagF1: conjugate(files.ri),
    imagBoth: decode(files.ii),
    width,
    height,
    frequencyF1: required(f1, "SF", true),
    nucleusF1: String(acquisitionF1?.NUC1 || f1.AXNUC || "unknown"),
    referenceOffsetF1: 0,
    experiment,
    source: "Bruker processed 2D",
    mode: "absorption",
  };
}
/** Explicit maximum projection, never a flattened 2D plane. */
export function maximumProjection(
  twoD: TwoDSpectrum,
  dimension: "F2" | "F1" = "F2",
): ComplexData {
  const alongF2 = dimension === "F2",
    real = new Float64Array(alongF2 ? twoD.width : twoD.height);
  for (let row = 0; row < twoD.height; row++)
    for (let col = 0; col < twoD.width; col++) {
      const index = alongF2 ? col : row,
        value = twoD.real[row * twoD.width + col];
      if (Math.abs(value) > Math.abs(real[index])) real[index] = value;
    }
  return { x: (alongF2 ? twoD.x : twoD.y).slice(), real };
}
export function extractTwoDSlice(
  twoD: TwoDSpectrum,
  dimension: "F2" | "F1",
  position: number,
): ComplexData {
  const axis = dimension === "F2" ? twoD.y : twoD.x;
  let nearest = 0;
  for (let i = 1; i < axis.length; i++)
    if (Math.abs(axis[i] - position) < Math.abs(axis[nearest] - position))
      nearest = i;
  if (dimension === "F2")
    return {
      x: twoD.x.slice(),
      real: twoD.real.slice(nearest * twoD.width, (nearest + 1) * twoD.width),
    };
  return {
    x: twoD.y.slice(),
    real: Float64Array.from(
      { length: twoD.height },
      (_, row) => twoD.real[row * twoD.width + nearest],
    ),
  };
}

function rawAxis(
  acquisition: BrukerParams,
  processing: BrukerParams | undefined,
  size: number,
): {
  axis: Float64Array;
  frequency: number;
  spectralWidth: number;
  carrier: number;
} {
  const observed = required(acquisition, "SFO1", true),
    frequency = processing ? required(processing, "SF", true) : observed;
  const spectralWidth =
    acquisition.SW_h !== undefined
      ? required(acquisition, "SW_h", true)
      : required(acquisition, "SW", true) * observed;
  const carrier = processing
    ? ((observed - frequency) * 1e6) / frequency
    : required(acquisition, "O1") / frequency;
  const high = carrier + spectralWidth / (2 * frequency);
  return {
    axis: Float64Array.from(
      { length: size },
      (_, i) => high - (i * spectralWidth) / (size * frequency),
    ),
    frequency,
    spectralWidth,
    carrier,
  };
}

/** Decode immutable, unwindowed acquired samples; stored F1 rows remain interleaved quadrature/echo pairs. */
export function readRawTwoD(
  buffer: ArrayBuffer,
  f2: BrukerParams,
  f1: BrukerParams,
  procs?: BrukerParams,
  proc2s?: BrukerParams,
  experiment = "2D NMR",
): TwoDRawData {
  const mode = required(f1, "FnMODE");
  if (![1, 4, 5, 6].includes(mode))
    throw new Error(
      `Raw 2D FnMODE ${mode} is unsupported; supported modes are QF, States, States-TPPI and Echo-Antiecho.`,
    );
  if (
    ![1, 3].includes(required(f2, "AQ_mod")) ||
    Number(f2.FnTYPE) === 2 ||
    Number(f1.FnTYPE) === 2
  )
    throw new Error(
      "2D processing requires uniform complex direct acquisition; NUS is unsupported.",
    );
  const td = required(f2, "TD", true),
    height = required(f1, "TD", true),
    type = required(f2, "DTYPA"),
    order = required(f2, "BYTORDA"),
    bytes = type === 2 ? 8 : 4;
  if (
    ![0, 2].includes(type) ||
    ![0, 1].includes(order) ||
    !Number.isInteger(td) ||
    !Number.isInteger(height) ||
    td % 2 ||
    (mode !== 1 && height % 2)
  )
    throw new Error("Invalid raw 2D numeric format or quadrature row count.");
  const width = td / 2;
  dimensions(width, height);
  if (width * height * 16 > MAX_COMPONENT_BYTES)
    throw new Error("Raw 2D samples exceed the 160 MiB source limit.");
  const stride = Math.ceil((td * bytes) / 1024) * 1024;
  if (buffer.byteLength !== stride * height)
    throw new Error(
      "Raw 2D ser length does not match padded direct TD and indirect TD; partial acquisition is unsupported.",
    );
  const direct = rawAxis(f2, procs, width),
    indirect = rawAxis(f1, proc2s, mode === 1 ? height : height / 2),
    real = new Float64Array(width * height),
    imag = new Float64Array(width * height),
    view = new DataView(buffer);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const at = row * stride + col * bytes * 2,
        index = row * width + col;
      real[index] =
        bytes === 8
          ? view.getFloat64(at, order === 0)
          : view.getInt32(at, order === 0);
      imag[index] =
        bytes === 8
          ? view.getFloat64(at + bytes, order === 0)
          : view.getInt32(at + bytes, order === 0);
      if (!Number.isFinite(real[index] + imag[index]))
        throw new Error("Raw 2D contains non-finite samples.");
    }
  const groupDelay = Number(f2.GRPDLY);
  if (!Number.isFinite(groupDelay) || groupDelay < 0)
    throw new Error(
      "Raw 2D source requires valid non-negative GRPDLY; legacy digital-filter metadata is not guessed.",
    );
  return {
    real,
    imag,
    width,
    height,
    acquisitionMode:
      mode === 1
        ? "QF"
        : mode === 4
          ? "States"
          : mode === 5
            ? "States-TPPI"
            : "Echo-Antiecho",
    dwellSecondsF2: 1 / direct.spectralWidth,
    dwellSecondsF1: 1 / indirect.spectralWidth,
    spectralWidthHzF2: direct.spectralWidth,
    spectralWidthHzF1: indirect.spectralWidth,
    carrierPpmF2: direct.carrier,
    carrierPpmF1: indirect.carrier,
    groupDelay,
    nucleusF1: String(f1.NUC1 || "unknown"),
    frequencyF1: indirect.frequency,
    experiment,
  };
}
/** Limited, explicit States/States-TPPI hypercomplex magnitude processing; no phase-sensitive claim. */
export function processRawTwoDMagnitude(
  buffer: ArrayBuffer,
  f2: BrukerParams,
  f1: BrukerParams,
  procs?: BrukerParams,
  proc2s?: BrukerParams,
  experiment = "2D NMR",
): TwoDSpectrum {
  const mode = required(f1, "FnMODE");
  if (![4, 5].includes(mode))
    throw new Error(
      `Raw 2D FnMODE ${mode} is unsupported. Import processed 2rr + procs + proc2s; supported raw modes are States (4) and States-TPPI (5).`,
    );
  if (![1, 3].includes(required(f2, "AQ_mod")) || Number(f2.FnTYPE) === 2)
    throw new Error(
      "Raw 2D requires uniform complex direct-dimension acquisition.",
    );
  const td = required(f2, "TD", true),
    rows = required(f1, "TD", true),
    bytes = required(f2, "DTYPA") === 2 ? 8 : 4,
    order = required(f2, "BYTORDA");
  if (
    ![0, 2].includes(required(f2, "DTYPA")) ||
    ![0, 1].includes(order) ||
    td % 2 ||
    rows % 2 ||
    !Number.isInteger(td) ||
    !Number.isInteger(rows)
  )
    throw new Error("Raw 2D acquisition sizes or numeric format are invalid.");
  const stride = Math.ceil((td * bytes) / 1024) * 1024;
  if (buffer.byteLength !== rows * stride)
    throw new Error(
      "Raw ser size does not match the padded direct TD and indirect TD. Partial acquisitions are unsupported.",
    );
  const groupDelay = Number(f2.GRPDLY);
  if (!Number.isFinite(groupDelay) || groupDelay < 0)
    throw new Error("Raw 2D digital filter requires non-negative GRPDLY.");
  const acquiredWidth = td / 2,
    retained =
      acquiredWidth - (Math.floor(groupDelay) ? Math.floor(groupDelay) + 2 : 0),
    increments = rows / 2;
  if (retained < 2)
    throw new Error("Raw 2D FID is shorter than its digital filter delay.");
  const width = nextPowerOfTwo(retained * 2),
    height = nextPowerOfTwo(increments * 2);
  dimensions(width, height);
  // Four hypercomplex work planes plus the returned magnitude must fit the same bounded working memory.
  if (width * height * 5 * 8 > MAX_COMPONENT_BYTES)
    throw new Error(
      "Raw 2D transform exceeds the 160 MB working-matrix limit. Import processed 2rr instead.",
    );
  const direct = rawAxis(f2, procs, width),
    indirect = rawAxis(f1, proc2s, height),
    view = new DataView(buffer),
    cosR = new Float64Array(width * increments),
    cosI = new Float64Array(width * increments),
    sinR = new Float64Array(width * increments),
    sinI = new Float64Array(width * increments);
  const rawR = new Float64Array(acquiredWidth),
    rawI = new Float64Array(acquiredWidth);
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < acquiredWidth; i++) {
      const offset = row * stride + i * bytes * 2;
      rawR[i] =
        bytes === 8
          ? view.getFloat64(offset, order === 0)
          : view.getInt32(offset, order === 0);
      rawI[i] =
        bytes === 8
          ? view.getFloat64(offset + bytes, order === 0)
          : view.getInt32(offset + bytes, order === 0);
      if (!Number.isFinite(rawR[i] + rawI[i]))
        throw new Error("Raw 2D contains non-finite samples.");
    }
    const corrected = correctDigitalFilter({
        real: rawR,
        imag: rawI,
        groupDelay,
        dwellSeconds: 1 / direct.spectralWidth,
        spectralWidthHz: direct.spectralWidth,
        carrierPpm: direct.carrier,
      }),
      real = new Float64Array(width),
      imag = new Float64Array(width);
    for (let i = 0; i < corrected.real.length; i++) {
      const weight = Math.exp((-Math.PI * 0.3 * i) / direct.spectralWidth);
      real[i] = corrected.real[i] * weight;
      imag[i] = corrected.imag[i] * weight;
    }
    fft(real, imag, true);
    const targetR = row % 2 ? sinR : cosR,
      targetI = row % 2 ? sinI : cosI,
      start = Math.floor(row / 2) * width;
    for (let col = 0; col < width; col++) {
      const shifted = (col + width / 2) % width;
      targetR[start + col] = real[shifted];
      targetI[start + col] = imag[shifted];
    }
  }
  const magnitude = new Float64Array(width * height),
    realF1 = new Float64Array(height),
    imagF1 = new Float64Array(height);
  for (let col = 0; col < width; col++)
    for (let channel = 0; channel < 2; channel++) {
      realF1.fill(0);
      imagF1.fill(0);
      const sourceR = channel ? cosI : cosR,
        sourceI = channel ? sinI : sinR;
      for (let t = 0; t < increments; t++) {
        // States-TPPI alternates whole complex increments. Imaginary negation belongs to
        // the distinct States-TPPI-N convention, not Bruker FnMODE=5.
        const sign = mode === 5 && t % 2 ? -1 : 1,
          window = Math.exp((-Math.PI * 0.3 * t) / indirect.spectralWidth);
        realF1[t] = sourceR[t * width + col] * sign * window;
        imagF1[t] = sourceI[t * width + col] * sign * window;
      }
      fft(realF1, imagF1, true);
      for (let row = 0; row < height; row++) {
        const shifted = (row + height / 2) % height;
        magnitude[row * width + col] +=
          realF1[shifted] ** 2 + imagF1[shifted] ** 2;
      }
    }
  for (let i = 0; i < magnitude.length; i++)
    magnitude[i] = Math.sqrt(magnitude[i]);
  return {
    x: direct.axis,
    y: indirect.axis,
    real: magnitude,
    width,
    height,
    nucleusF1: String(f1.NUC1 || "unknown"),
    frequencyF1: indirect.frequency,
    referenceOffsetF1: 0,
    experiment,
    source: "Bruker raw 2D magnitude",
    mode: "magnitude",
    acquisitionMode: mode === 5 ? "States-TPPI" : "States",
  };
}
