import {
  defaultRecipe,
  type ProcessingRecipe,
  type Spectrum,
  type TwoDSpectrum,
  type TwoDRawData,
  type TwoDProcessingRecipe,
} from "../model";
import {
  autoPhase,
  correctDigitalFilter,
  estimateBaseline,
  fft,
  nextPowerOfTwo,
} from "./numerics";

const MAX_BYTES = 160 * 1024 * 1024;
export interface TwoDProcessingResult {
  data: TwoDSpectrum;
  baseline?: Float64Array;
  warnings: string[];
}
export function defaultTwoDRecipe(s: Spectrum): TwoDProcessingRecipe {
  const matrix = s.twoDOriginal || s.twoD;
  const axis = (pivot: number): ProcessingRecipe => ({
    ...defaultRecipe(),
    window: "none",
    pivotPpm: pivot,
  });
  return {
    transform: !s.twoDOriginal && !!s.twoDRaw,
    digitalFilter: true,
    magnitude: matrix?.mode === "magnitude",
    reconstructImaginary: false,
    echoAntiEchoOrder: "echo-first",
    f2: axis(
      ((matrix?.x[0] || 0) + (matrix?.x.at(-1) || 0)) / 2 + s.referenceOffset,
    ),
    f1: axis(
      ((matrix?.y[0] || 0) + (matrix?.y.at(-1) || 0)) / 2 +
        (matrix?.referenceOffsetF1 || 0),
    ),
  };
}
function budget(width: number, height: number, components = 5): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width * height > 10_000_000 ||
    width * height * components * 8 > MAX_BYTES
  )
    throw new Error(
      "2D processing exceeds the 10-million-element or 160 MiB working-plane limit. Reduce zero filling.",
    );
}
function weight(
  recipe: ProcessingRecipe,
  i: number,
  n: number,
  dwell: number,
): number {
  if (
    !["none", "exponential", "gaussian", "sinebell"].includes(recipe.window) ||
    !Number.isFinite(recipe.lbHz + recipe.gaussianHz) ||
    recipe.lbHz < 0 ||
    recipe.gaussianHz < 0
  )
    throw new Error("Invalid 2D apodization parameters.");
  const t = i * dwell;
  if (recipe.window === "exponential")
    return Math.exp(-Math.PI * recipe.lbHz * t);
  if (recipe.window === "gaussian")
    return Math.exp(
      -((Math.PI * recipe.gaussianHz * t) ** 2) / (4 * Math.log(2)),
    );
  if (recipe.window === "sinebell")
    return Math.sin((Math.PI * i) / Math.max(1, n - 1));
  return 1;
}
/** Positive 2D Fourier transform; QF has no measured indirect quadrature and retains both mirror responses. */
export function transformRawTwoD(
  raw: TwoDRawData,
  frequencyF2: number,
  recipe: TwoDProcessingRecipe,
): TwoDSpectrum {
  if (
    !(frequencyF2 > 0) ||
    (raw.acquisitionMode !== "QF" && raw.height % 2) ||
    raw.real.length !== raw.width * raw.height ||
    raw.imag.length !== raw.real.length ||
    !["QF", "States", "States-TPPI", "Echo-Antiecho"].includes(
      raw.acquisitionMode,
    ) ||
    ![
      raw.dwellSecondsF1,
      raw.dwellSecondsF2,
      raw.spectralWidthHzF1,
      raw.spectralWidthHzF2,
      raw.frequencyF1,
    ].every((v) => Number.isFinite(v) && v > 0) ||
    ![raw.carrierPpmF1, raw.carrierPpmF2].every(Number.isFinite)
  )
    throw new Error("Invalid raw 2D quadrature source.");
  if (
    ![1, 2, 4, 8].includes(recipe.f2.zeroFill) ||
    ![1, 2, 4, 8].includes(recipe.f1.zeroFill)
  )
    throw new Error(
      "2D zero filling must be 1, 2, 4 or 8 independently on each axis.",
    );
  const delay = recipe.digitalFilter ? Math.floor(raw.groupDelay) : 0;
  if (!Number.isFinite(delay) || delay < 0)
    throw new Error("2D digital-filter correction requires valid GRPDLY.");
  const retained = raw.width - (delay ? delay + 2 : 0),
    increments = raw.acquisitionMode === "QF" ? raw.height : raw.height / 2;
  if (retained < 2)
    throw new Error("2D digital-filter delay exceeds the acquired FID.");
  const width = nextPowerOfTwo(retained * recipe.f2.zeroFill),
    height = nextPowerOfTwo(increments * recipe.f1.zeroFill);
  budget(width, height, 9);
  const cosR = new Float64Array(width * increments),
    cosI = new Float64Array(width * increments),
    sinR = new Float64Array(width * increments),
    sinI = new Float64Array(width * increments);
  for (let t = 0; t < increments; t++) {
    const a = t * (raw.acquisitionMode === "QF" ? 1 : 2) * raw.width,
      b = a + raw.width;
    for (let pair = 0; pair < (raw.acquisitionMode === "QF" ? 1 : 2); pair++) {
      const real = new Float64Array(raw.width),
        imag = new Float64Array(raw.width);
      for (let col = 0; col < raw.width; col++) {
        if (raw.acquisitionMode === "Echo-Antiecho") {
          // Bruker Rance-Kay: cosine=E-A; sine=i(E+A), removing the separate 90-degree F1 rotation.
          const echo = recipe.echoAntiEchoOrder === "antiecho-first" ? b : a;
          const antiecho =
            recipe.echoAntiEchoOrder === "antiecho-first" ? a : b;
          real[col] = pair
            ? -(raw.imag[echo + col] + raw.imag[antiecho + col])
            : raw.real[echo + col] - raw.real[antiecho + col];
          imag[col] = pair
            ? raw.real[echo + col] + raw.real[antiecho + col]
            : raw.imag[echo + col] - raw.imag[antiecho + col];
        } else {
          real[col] = raw.real[(pair ? b : a) + col];
          imag[col] = raw.imag[(pair ? b : a) + col];
        }
      }
      const corrected = recipe.digitalFilter
        ? correctDigitalFilter({
            real,
            imag,
            groupDelay: raw.groupDelay,
            dwellSeconds: raw.dwellSecondsF2,
            spectralWidthHz: raw.spectralWidthHzF2,
            carrierPpm: raw.carrierPpmF2,
          })
        : { real, imag };
      const r = new Float64Array(width),
        im = new Float64Array(width);
      for (let col = 0; col < corrected.real.length; col++) {
        const win = weight(
          recipe.f2,
          col,
          corrected.real.length,
          raw.dwellSecondsF2,
        );
        r[col] = corrected.real[col] * win;
        im[col] = corrected.imag[col] * win;
      }
      fft(r, im, true);
      const targetR = pair ? sinR : cosR,
        targetI = pair ? sinI : cosI;
      for (let col = 0; col < width; col++) {
        const shifted = (col + width / 2) % width;
        targetR[t * width + col] = r[shifted];
        targetI[t * width + col] = im[shifted];
      }
    }
  }
  const rr = new Float64Array(width * height),
    ri = new Float64Array(rr.length),
    ir = new Float64Array(rr.length),
    ii = new Float64Array(rr.length),
    r = new Float64Array(height),
    im = new Float64Array(height);
  for (let col = 0; col < width; col++)
    for (let channel = 0; channel < 2; channel++) {
      r.fill(0);
      im.fill(0);
      const inputR = channel ? cosI : cosR,
        inputI = channel ? sinI : sinR;
      for (let t = 0; t < increments; t++) {
        const sign = raw.acquisitionMode === "States-TPPI" && t % 2 ? -1 : 1,
          win = weight(recipe.f1, t, increments, raw.dwellSecondsF1);
        r[t] = inputR[t * width + col] * sign * win;
        im[t] = inputI[t * width + col] * sign * win;
      }
      fft(r, im, true);
      for (let row = 0; row < height; row++) {
        const shifted = (row + height / 2) % height,
          index = row * width + col;
        (channel ? ri : rr)[index] = r[shifted];
        (channel ? ii : ir)[index] = im[shifted];
      }
    }
  const axis = (size: number, carrier: number, sw: number, freq: number) =>
    Float64Array.from(
      { length: size },
      (_, i) => carrier + sw / (2 * freq) - (i * sw) / (size * freq),
    );
  const data: TwoDSpectrum = {
    x: axis(width, raw.carrierPpmF2, raw.spectralWidthHzF2, frequencyF2),
    y: axis(height, raw.carrierPpmF1, raw.spectralWidthHzF1, raw.frequencyF1),
    real: rr,
    imagF2: ri,
    imagF1: ir,
    imagBoth: ii,
    width,
    height,
    nucleusF1: raw.nucleusF1,
    frequencyF1: raw.frequencyF1,
    referenceOffsetF1: 0,
    experiment: raw.experiment,
    source: "Bruker raw 2D absorption",
    mode: "absorption",
    acquisitionMode: raw.acquisitionMode,
  };
  return recipe.magnitude ? magnitudeTwoD(data) : data;
}
export function magnitudeTwoD(data: TwoDSpectrum): TwoDSpectrum {
  if (!data.imagF2 || !data.imagF1 || !data.imagBoth) {
    if (data.mode === "magnitude") return data;
    throw new Error(
      "Full 2D magnitude requires all four quadrature components.",
    );
  }
  const real = Float64Array.from(data.real, (value, i) =>
    Math.hypot(value, data.imagF2![i], data.imagF1![i], data.imagBoth![i]),
  );
  return {
    ...data,
    real,
    imagF2: undefined,
    imagF1: undefined,
    imagBoth: undefined,
    mode: "magnitude",
    source: data.source.startsWith("Bruker raw")
      ? "Bruker raw 2D magnitude"
      : data.source,
  };
}
function clone(data: TwoDSpectrum): TwoDSpectrum {
  budget(data.width, data.height, 6);
  return {
    ...data,
    x: data.x.slice(),
    y: data.y.slice(),
    real: data.real.slice(),
    imagF2: data.imagF2?.slice(),
    imagF1: data.imagF1?.slice(),
    imagBoth: data.imagBoth?.slice(),
  };
}
/** Hilbert quadrature on a sampled real spectrum; explicit approximation, not recovery of discarded acquired data. */
export function analyticQuadrature(values: Float64Array): Float64Array {
  const n = values.length,
    size = nextPowerOfTwo(n),
    r = new Float64Array(size),
    im = new Float64Array(size);
  r.set(values);
  fft(r, im, false);
  for (let i = 0; i < size; i++) {
    const factor = i === 0 || i === size / 2 ? 1 : i < size / 2 ? 2 : 0;
    r[i] *= factor;
    im[i] *= factor;
  }
  fft(r, im, true);
  return Float64Array.from(im.slice(0, n), (v) => v / size);
}
function hilbertPlane(
  data: TwoDSpectrum,
  values: Float64Array,
  axis: "F2" | "F1",
): Float64Array {
  const out = new Float64Array(values.length);
  if (axis === "F2")
    for (let row = 0; row < data.height; row++)
      out.set(
        analyticQuadrature(
          values.subarray(row * data.width, (row + 1) * data.width),
        ),
        row * data.width,
      );
  else
    for (let col = 0; col < data.width; col++) {
      const column = Float64Array.from(
          { length: data.height },
          (_, row) => values[row * data.width + col],
        ),
        im = analyticQuadrature(column);
      for (let row = 0; row < data.height; row++)
        out[row * data.width + col] = im[row];
    }
  return out;
}
function quadrature(
  data: TwoDSpectrum,
  axis: "F2" | "F1",
  reconstruct: boolean,
  warnings: string[],
): void {
  if (data.mode === "magnitude")
    throw new Error(
      "Phase correction of magnitude-only data cannot recover acquired phase. Enable raw Fourier reprocessing.",
    );
  const missing = axis === "F2" ? !data.imagF2 : !data.imagF1,
    needsBoth = !!data.imagF2 && !!data.imagF1 && !data.imagBoth;
  if ((missing || needsBoth) && !reconstruct)
    throw new Error(
      "2D phase requires the corresponding imaginary quadrants. Enable explicit analytic reconstruction or reprocess raw ser.",
    );
  if (missing || needsBoth) {
    // A lone 2ii plane (including QF's two-quadrant storage) is not a complete
    // hypercomplex pair. Use a consistent analytic reconstruction of RR.
    if (!data.imagF2 && !data.imagF1) data.imagBoth = undefined;
    if (!data.imagF2) data.imagF2 = hilbertPlane(data, data.real, "F2");
    if (!data.imagF1) data.imagF1 = hilbertPlane(data, data.real, "F1");
    if (!data.imagBoth) data.imagBoth = hilbertPlane(data, data.imagF2, "F1");
    warnings.push(
      "Missing imaginary components reconstructed with a discrete Hilbert transform. This assumes an analytic spectrum; it does not recover discarded raw quadrature and can show edge artifacts.",
    );
  }
}
function phase(
  data: TwoDSpectrum,
  axis: "F2" | "F1",
  recipe: ProcessingRecipe,
  offset: number,
  reconstruct: boolean,
  warnings: string[],
): void {
  if (recipe.ph0 === 0 && recipe.ph1 === 0) return;
  if (!Number.isFinite(recipe.ph0 + recipe.ph1 + recipe.pivotPpm))
    throw new Error("2D phase values must be finite.");
  quadrature(data, axis, reconstruct, warnings);
  const coordinates = axis === "F2" ? data.x : data.y,
    span = coordinates[0] - coordinates.at(-1)!;
  for (let row = 0; row < data.height; row++)
    for (let col = 0; col < data.width; col++) {
      const i = row * data.width + col,
        a =
          ((recipe.ph0 +
            (recipe.ph1 *
              (recipe.pivotPpm -
                offset -
                coordinates[axis === "F2" ? col : row])) /
              span) *
            Math.PI) /
          180,
        c = Math.cos(a),
        si = Math.sin(a),
        r = data.real[i],
        im = (axis === "F2" ? data.imagF2 : data.imagF1)![i];
      data.real[i] = r * c - im * si;
      (axis === "F2" ? data.imagF2 : data.imagF1)![i] = r * si + im * c;
      if (data.imagBoth) {
        const other = axis === "F2" ? data.imagF1! : data.imagF2!,
          v = other[i],
          cross = data.imagBoth[i];
        other[i] = v * c - cross * si;
        data.imagBoth[i] = v * si + cross * c;
      }
    }
}
function included(ppm: number, r: ProcessingRecipe): boolean {
  return (
    (!r.baselineRegion ||
      (ppm >= Math.min(...r.baselineRegion) &&
        ppm <= Math.max(...r.baselineRegion))) &&
    !(r.baselineExcludedRegions || []).some(
      (v) => ppm >= Math.min(...v) && ppm <= Math.max(...v),
    )
  );
}
function manualSurface(
  data: TwoDSpectrum,
  recipe: TwoDProcessingRecipe,
  offset: number,
): Float64Array {
  const points = recipe.baselinePoints || [];
  if (points.length < 3)
    throw new Error(
      "Manual 2D baseline surface needs at least three non-collinear picked points.",
    );
  const xs = data.x[0] - data.x.at(-1)!,
    ys = data.y[0] - data.y.at(-1)!,
    normal = Array.from({ length: 3 }, () => new Float64Array(4));
  for (const p of points) {
    if (!Number.isFinite(p.xPpm + p.yPpm + p.value))
      throw new Error("Manual baseline points must be finite.");
    const t = [
      1,
      (p.xPpm - offset - data.x.at(-1)!) / xs,
      (p.yPpm - data.referenceOffsetF1 - data.y.at(-1)!) / ys,
    ];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) normal[j][k] += t[j] * t[k];
      normal[j][3] += t[j] * p.value;
    }
  }
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    for (let row = k + 1; row < 3; row++)
      if (Math.abs(normal[row][k]) > Math.abs(normal[pivot][k])) pivot = row;
    [normal[k], normal[pivot]] = [normal[pivot], normal[k]];
    if (Math.abs(normal[k][k]) < 1e-10)
      throw new Error(
        "Manual baseline points are collinear; choose points spanning both axes.",
      );
    const divisor = normal[k][k];
    for (let j = k; j < 4; j++) normal[k][j] /= divisor;
    for (let row = 0; row < 3; row++)
      if (row !== k) {
        const factor = normal[row][k];
        for (let j = k; j < 4; j++) normal[row][j] -= factor * normal[k][j];
      }
  }
  const model = new Float64Array(data.real.length);
  for (let row = 0; row < data.height; row++)
    for (let col = 0; col < data.width; col++)
      if (
        included(data.x[col] + offset, recipe.f2) &&
        included(data.y[row] + data.referenceOffsetF1, recipe.f1)
      )
        model[row * data.width + col] =
          normal[0][3] +
          (normal[1][3] * (data.x[col] - data.x.at(-1)!)) / xs +
          (normal[2][3] * (data.y[row] - data.y.at(-1)!)) / ys;
  return model;
}
function axisBaseline(
  data: TwoDSpectrum,
  axis: "F2" | "F1",
  recipe: ProcessingRecipe,
  offset: number,
  model: Float64Array,
): void {
  const along = axis === "F2",
    length = along ? data.width : data.height,
    count = along ? data.height : data.width,
    coordinates = along ? data.x : data.y;
  for (let slice = 0; slice < count; slice++) {
    const values = Float64Array.from(
      { length },
      (_, i) =>
        data.real[along ? slice * data.width + i : i * data.width + slice],
    );
    const fitted = estimateBaseline(
      { x: coordinates, real: values },
      recipe,
      offset,
    );
    for (let i = 0; i < length; i++) {
      const index = along ? slice * data.width + i : i * data.width + slice;
      data.real[index] -= fitted[i];
      model[index] += fitted[i];
    }
  }
}
export function processTwoD(s: Spectrum): TwoDProcessingResult {
  const recipe = s.twoDRecipe || defaultTwoDRecipe(s),
    original =
      recipe.source === "mnova-source"
        ? s.nativeSource2D
        : s.twoDOriginal || s.twoD,
    warnings: string[] = [];
  if (recipe.source === "mnova-source" && !original)
    throw new Error("This spectrum has no saved Mnova source plane.");
  if (!original && !s.twoDRaw) throw new Error("No 2D source data available.");
  let data: TwoDSpectrum;
  if (recipe.transform) {
    if (!s.twoDRaw)
      throw new Error(
        "2D Fourier transform and apodization require preserved raw ser data. Reimport the experiment folder.",
      );
    data = transformRawTwoD(s.twoDRaw, s.frequencyMHz, {
      ...recipe,
      magnitude: false,
    });
    if (s.twoDRaw.acquisitionMode === "QF")
      warnings.push(
        "QF has no measured F1 quadrature: raw Fourier processing retains mirrored indirect-frequency responses. Magnitude is recommended; phase cannot recover directional F1 information.",
      );
    data.referenceOffsetF1 = original?.referenceOffsetF1 || 0;
  } else {
    data = clone(original!);
    if (recipe.f1.window !== "none" || recipe.f2.window !== "none")
      throw new Error(
        "2D apodization is a time-domain operation. Enable raw Fourier reprocessing instead of modifying a processed plane.",
      );
  }
  data.referenceOffsetF1 =
    s.twoD?.referenceOffsetF1 ?? original?.referenceOffsetF1 ?? 0;
  phase(
    data,
    "F2",
    recipe.f2,
    s.referenceOffset,
    recipe.reconstructImaginary,
    warnings,
  );
  phase(
    data,
    "F1",
    recipe.f1,
    data.referenceOffsetF1,
    recipe.reconstructImaginary,
    warnings,
  );
  if (recipe.magnitude) {
    if (data.mode !== "magnitude") {
      if (recipe.reconstructImaginary) {
        quadrature(data, "F2", true, warnings);
        quadrature(data, "F1", true, warnings);
      }
      data = magnitudeTwoD(data);
    }
  }
  const baselineNeeded =
    recipe.f1.baseline !== "none" || recipe.f2.baseline !== "none";
  let baseline: Float64Array | undefined;
  if (baselineNeeded) {
    baseline = new Float64Array(data.real.length);
    const manualPoints =
      recipe.baselinePoints?.length &&
      (recipe.f1.baseline === "manual" || recipe.f2.baseline === "manual");
    if (
      recipe.f2.baseline !== "none" &&
      !(manualPoints && recipe.f2.baseline === "manual")
    )
      axisBaseline(data, "F2", recipe.f2, s.referenceOffset, baseline);
    if (
      recipe.f1.baseline !== "none" &&
      !(manualPoints && recipe.f1.baseline === "manual")
    )
      axisBaseline(data, "F1", recipe.f1, data.referenceOffsetF1, baseline);
    if (manualPoints) {
      const plane = manualSurface(data, recipe, s.referenceOffset);
      for (let i = 0; i < data.real.length; i++) {
        data.real[i] -= plane[i];
        baseline[i] += plane[i];
      }
    }
  }
  for (const component of [data.real, data.imagF2, data.imagF1, data.imagBoth])
    if (component)
      for (const v of component)
        if (!Number.isFinite(v))
          throw new Error("2D processing produced a non-finite value.");
  return { data, baseline, warnings: [...new Set(warnings)] };
}
export function autoPhaseTwoD(
  s: Spectrum,
  axis: "F2" | "F1",
): { ph0: number; ph1: number } {
  const recipe = s.twoDRecipe || defaultTwoDRecipe(s),
    blank = (r: ProcessingRecipe) => ({ ...r, baseline: "none" as const }),
    candidate = {
      ...s,
      twoDRecipe: {
        ...recipe,
        magnitude: false,
        f2: {
          ...blank(recipe.f2),
          ...(axis === "F2" ? { ph0: 0, ph1: 0 } : {}),
        },
        f1: {
          ...blank(recipe.f1),
          ...(axis === "F1" ? { ph0: 0, ph1: 0 } : {}),
        },
      },
    };
  const data = processTwoD(candidate).data;
  quadrature(data, axis, recipe.reconstructImaginary, []);
  const along = axis === "F2",
    length = along ? data.width : data.height,
    count = along ? data.height : data.width,
    imag = along ? data.imagF2! : data.imagF1!;
  let best = 0,
    bestScore = -Infinity;
  for (let slice = 0; slice < count; slice++) {
    let score = 0;
    for (let i = 0; i < length; i++) {
      const index = along ? slice * data.width + i : i * data.width + slice;
      score = Math.max(score, Math.hypot(data.real[index], imag[index]));
    }
    if (score > bestScore) {
      best = slice;
      bestScore = score;
    }
  }
  const trace = {
    x: along ? data.x : data.y,
    real: Float64Array.from(
      { length },
      (_, i) =>
        data.real[along ? best * data.width + i : i * data.width + best],
    ),
    imag: Float64Array.from(
      { length },
      (_, i) => imag[along ? best * data.width + i : i * data.width + best],
    ),
  };
  return autoPhase({
    ...s,
    original: trace,
    data: trace,
    fid: undefined,
    recipe: {
      ...(along ? recipe.f2 : recipe.f1),
      transform: false,
      baseline: "none",
    },
    referenceOffset: along ? s.referenceOffset : data.referenceOffsetF1,
  });
}
export interface TwoDPeakPick {
  xPpm: number;
  yPpm: number;
  column: number;
  row: number;
  height: number;
}
/** Snap within an explicitly supplied ppm radius (normally converted from screen pixels), retaining peak sign. */
export function snapTwoDPeak(
  data: TwoDSpectrum,
  xPpm: number,
  yPpm: number,
  offsetF2 = 0,
  radius: number | [number, number] = 0.1,
): TwoDPeakPick | undefined {
  const [rx, ry] = typeof radius === "number" ? [radius, radius] : radius;
  if (!Number.isFinite(xPpm + yPpm + rx + ry) || rx <= 0 || ry <= 0)
    return undefined;
  const columns: number[] = [],
    rows: number[] = [];
  for (let i = 0; i < data.width; i++)
    if (Math.abs(data.x[i] + offsetF2 - xPpm) <= rx) columns.push(i);
  for (let i = 0; i < data.height; i++)
    if (Math.abs(data.y[i] + data.referenceOffsetF1 - yPpm) <= ry) rows.push(i);
  if (columns.length * rows.length > 1_000_000)
    throw new Error(
      "Reference snap radius is too large. Zoom in before picking.",
    );
  let maximum = 0;
  for (const row of rows)
    for (const col of columns)
      maximum = Math.max(maximum, Math.abs(data.real[row * data.width + col]));
  if (maximum === 0) return undefined;
  let best: TwoDPeakPick | undefined,
    distance = Infinity;
  for (const row of rows)
    for (const col of columns) {
      const height = data.real[row * data.width + col],
        amplitude = Math.abs(height);
      if (amplitude < maximum * 0.1) continue;
      let local = true,
        hasLowerNeighbor = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy,
            c = col + dx;
          if (r >= 0 && r < data.height && c >= 0 && c < data.width) {
            const neighbor = Math.abs(data.real[r * data.width + c]);
            if (neighbor > amplitude) local = false;
            if (neighbor < amplitude) hasLowerNeighbor = true;
          }
        }
      if (!local || !hasLowerNeighbor) continue;
      const x = data.x[col] + offsetF2,
        y = data.y[row] + data.referenceOffsetF1,
        d = ((x - xPpm) / rx) ** 2 + ((y - yPpm) / ry) ** 2;
      if (d < distance) {
        best = { xPpm: x, yPpm: y, column: col, row, height };
        distance = d;
      }
    }
  return best;
}
