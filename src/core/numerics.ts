import {
  uid,
  type ComplexData,
  type FidData,
  type Multiplet,
  type Peak,
  type ProcessingRecipe,
  type Spectrum,
} from "../model";

const DEG = Math.PI / 180;
const MAX_POINTS = 4_194_304;
export function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

/** In-place radix-2 complex FFT. Positive exponential matches Bruker direct-dimension ordering. */
export function fft(
  real: Float64Array,
  imag: Float64Array,
  positive = false,
): void {
  const n = real.length;
  if (imag.length !== n || n < 2 || n & (n - 1))
    throw new Error("FFT requires matching power-of-two arrays.");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let width = 2; width <= n; width *= 2) {
    const angle = ((positive ? 2 : -2) * Math.PI) / width,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let start = 0; start < n; start += width) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < width / 2; j++) {
        const a = start + j,
          b = a + width / 2,
          tr = ur * real[b] - ui * imag[b],
          ti = ur * imag[b] + ui * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
        const nr = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = nr;
      }
    }
  }
}

/** Advance the declared full Bruker delay, including its fractional sample, then compensate/truncate the wrapped tail. */
export function correctDigitalFilter(fid: FidData): {
  real: Float64Array;
  imag: Float64Array;
} {
  const n = fid.real.length,
    delay = Math.floor(fid.groupDelay);
  if (!Number.isFinite(fid.groupDelay) || fid.groupDelay < 0)
    throw new Error(
      "Digital-filter delay is unavailable. Disable correction or import valid GRPDLY metadata.",
    );
  if (fid.groupDelay === 0)
    return { real: fid.real.slice(), imag: fid.imag.slice() };
  if (delay + 8 >= n)
    throw new Error("Digital-filter delay exceeds the available FID.");
  const skip = delay + 2,
    add = Math.max(skip - 6, 0),
    length = n - skip;
  let shiftedReal = Float64Array.from(
      fid.real,
      (_, i) => fid.real[(i + delay) % n],
    ),
    shiftedImag = Float64Array.from(
      fid.imag,
      (_, i) => fid.imag[(i + delay) % n],
    );
  const fraction = fid.groupDelay - delay;
  if (fraction !== 0) {
    const size = nextPowerOfTwo(n);
    if (size > MAX_POINTS)
      throw new Error(
        "Digital-filter correction exceeds the 4 million point limit.",
      );
    const r = new Float64Array(size),
      im = new Float64Array(size);
    r.set(shiftedReal);
    im.set(shiftedImag);
    fft(r, im);
    for (let k = 0; k < size; k++) {
      // Signed frequencies avoid an artificial phase discontinuity at the carrier.
      const frequency = (k < size / 2 ? k : k - size) / size;
      const angle = 2 * Math.PI * frequency * fraction,
        c = Math.cos(angle),
        si = Math.sin(angle),
        old = r[k];
      r[k] = old * c - im[k] * si;
      im[k] = old * si + im[k] * c;
    }
    fft(r, im, true);
    shiftedReal = Float64Array.from(r.subarray(0, n), (v) => v / size);
    shiftedImag = Float64Array.from(im.subarray(0, n), (v) => v / size);
  }
  const real = new Float64Array(length),
    imag = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    real[i] = shiftedReal[i];
    imag[i] = shiftedImag[i];
    if (i < add) {
      real[i] += shiftedReal[n - 1 - i];
      imag[i] += shiftedImag[n - 1 - i];
    }
  }
  return { real, imag };
}

function sourceSpectrum(s: Spectrum): ComplexData {
  if (!s.recipe.transform)
    return {
      x: s.original.x.slice(),
      real: s.original.real.slice(),
      imag: s.original.imag?.slice(),
    };
  const fid = s.fid;
  if (!fid) throw new Error("Fourier transform requires an imported raw FID.");
  if (!(s.frequencyMHz > 0) || !(fid.dwellSeconds > 0))
    throw new Error("Frequency and dwell time must be positive.");
  const corrected = s.recipe.digitalFilter
    ? correctDigitalFilter(fid)
    : { real: fid.real, imag: fid.imag };
  if (![1, 2, 4, 8, 16, 32].includes(s.recipe.zeroFill))
    throw new Error("Zero fill must be 1, 2, 4, 8, 16 or 32.");
  const size = nextPowerOfTwo(corrected.real.length * s.recipe.zeroFill);
  if (size > MAX_POINTS)
    throw new Error(
      "Transform exceeds the 4 million point limit. Reduce zero filling.",
    );
  if (s.recipe.lbHz < 0 || s.recipe.gaussianHz < 0)
    throw new Error("Window widths must be non-negative.");
  const real = new Float64Array(size),
    imag = new Float64Array(size),
    x = new Float64Array(size);
  for (let i = 0; i < corrected.real.length; i++) {
    const t = i * fid.dwellSeconds;
    let w = 1;
    if (s.recipe.window === "exponential")
      w = Math.exp(-Math.PI * s.recipe.lbHz * t);
    if (s.recipe.window === "gaussian")
      w = Math.exp(
        -((Math.PI * s.recipe.gaussianHz * t) ** 2) / (4 * Math.log(2)),
      );
    if (s.recipe.window === "sinebell")
      w = Math.sin((Math.PI * i) / Math.max(1, corrected.real.length - 1));
    real[i] = corrected.real[i] * w;
    imag[i] = corrected.imag[i] * w;
  }
  fft(real, imag, true);
  for (let i = 0; i < size / 2; i++) {
    [real[i], real[i + size / 2]] = [real[i + size / 2], real[i]];
    [imag[i], imag[i + size / 2]] = [imag[i + size / 2], imag[i]];
  }
  const high = fid.carrierPpm + fid.spectralWidthHz / (2 * s.frequencyMHz);
  for (let i = 0; i < size; i++)
    x[i] = high - (i * fid.spectralWidthHz) / (size * s.frequencyMHz);
  return { x, real, imag };
}

export function applyPhase(
  data: ComplexData,
  ph0: number,
  ph1: number,
  pivotPpm: number,
): ComplexData {
  if (!Number.isFinite(ph0 + ph1 + pivotPpm))
    throw new Error("Phase values must be finite.");
  if (!data.imag) {
    if (ph0 !== 0 || ph1 !== 0)
      throw new Error(
        "Phase correction needs imaginary spectrum data or a raw FID.",
      );
    return data;
  }
  const span = data.x[0] - data.x[data.x.length - 1] || 1;
  for (let i = 0; i < data.real.length; i++) {
    const a = (ph0 + (ph1 * (pivotPpm - data.x[i])) / span) * DEG;
    const c = Math.cos(a),
      si = Math.sin(a),
      r = data.real[i],
      im = data.imag[i];
    data.real[i] = r * c - im * si;
    data.imag[i] = r * si + im * c;
  }
  return data;
}

/** TopSpin's negative rotation uses index/N; our referenced-pivot recipe uses index/(N-1). */
export function brukerPhaseCorrection(
  data: ComplexData,
  phc0: number,
  phc1: number,
  referenceOffset = 0,
): { ph0: number; ph1: number; pivotPpm: number } {
  const n = data.real.length;
  if (
    n < 2 ||
    data.x.length !== n ||
    ![phc0, phc1, referenceOffset, data.x[0]].every(Number.isFinite)
  )
    throw new Error(
      "Stored Bruker phase requires a calibrated spectrum and finite PHC0/PHC1.",
    );
  return {
    ph0: -phc0,
    ph1: (-phc1 * (n - 1)) / n,
    pivotPpm: data.x[0] + referenceOffset,
  };
}

/** Conservative baseline: median estimates in blocks followed by robust linear interpolation. */
export function automaticBaseline(data: ComplexData): Float64Array {
  const n = data.real.length,
    blocks = Math.min(n, 96, Math.max(2, Math.floor(n / 128))),
    centers: number[] = [],
    levels: number[] = [];
  if (n < 2) return new Float64Array(n);
  for (let b = 0; b < blocks; b++) {
    const start = Math.floor((b * n) / blocks),
      end = Math.floor(((b + 1) * n) / blocks),
      values: number[] = [];
    const stride = Math.max(1, Math.floor((end - start) / 256));
    for (let i = start; i < end; i += stride) values.push(data.real[i]);
    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const deviation = values
        .map((v) => Math.abs(v - median))
        .sort((a, b) => a - b),
      mad = deviation[Math.floor(deviation.length / 2)] || 1e-12;
    const quiet = values.filter((v) => Math.abs(v - median) < 2 * mad);
    centers.push((start + end - 1) / 2);
    levels.push(
      quiet.length ? quiet.reduce((a, b) => a + b, 0) / quiet.length : median,
    );
  }
  // Smooth estimates without treating signed narrow peaks as baseline anchors.
  const smooth = levels.map((_, i) => {
    const v = levels
      .slice(Math.max(0, i - 2), Math.min(blocks, i + 3))
      .sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  const baseline = new Float64Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    while (b < blocks - 2 && i > centers[b + 1]) b++;
    const t = Math.max(
      0,
      Math.min(1, (i - centers[b]) / (centers[b + 1] - centers[b])),
    );
    baseline[i] = smooth[b] * (1 - t) + smooth[b + 1] * t;
  }
  return baseline;
}

function bounded(
  value: number | undefined,
  fallback: number,
  low: number,
  high: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < low || result > high)
    throw new Error(`${label} must be between ${low} and ${high}.`);
  return result;
}
function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}
function medianFilter(y: Float64Array, window: number): Float64Array {
  const result = new Float64Array(y.length),
    half = Math.floor(window / 2);
  for (let i = 0; i < y.length; i++)
    result[i] = median(
      Array.from(
        y.slice(Math.max(0, i - half), Math.min(y.length, i + half + 1)),
      ),
    );
  return result;
}
function inBaselineRegion(ppm: number, recipe: ProcessingRecipe): boolean {
  if (
    recipe.baselineRegion &&
    (ppm < Math.min(...recipe.baselineRegion) ||
      ppm > Math.max(...recipe.baselineRegion))
  )
    return false;
  return !(recipe.baselineExcludedRegions ?? []).some(
    ([a, b]) => ppm >= Math.min(a, b) && ppm <= Math.max(a, b),
  );
}
function validateBaselineRegions(recipe: ProcessingRecipe): void {
  const regions = [
    ...(recipe.baselineRegion ? [recipe.baselineRegion] : []),
    ...(recipe.baselineExcludedRegions ?? []),
  ];
  if (
    regions.length > 1000 ||
    regions.some((r) => r.length !== 2 || !r.every(Number.isFinite))
  )
    throw new Error("Baseline regions require two finite ppm boundaries.");
}
interface ReducedBaseline {
  x: Float64Array;
  y: Float64Array;
  weights: Float64Array;
}
/** At most 2048 robust bin medians, with exclusions represented by zero fit weight. */
function reduceBaseline(
  data: ComplexData,
  recipe: ProcessingRecipe,
  offset: number,
): ReducedBaseline {
  let first = 0,
    last = data.x.length - 1;
  if (recipe.baselineRegion) {
    const low = Math.min(...recipe.baselineRegion) - offset,
      high = Math.max(...recipe.baselineRegion) - offset;
    while (
      first < data.x.length &&
      (data.x[first] < low || data.x[first] > high)
    )
      first++;
    while (last >= first && (data.x[last] < low || data.x[last] > high)) last--;
  }
  if (last - first < 1)
    throw new Error(
      "Baseline region must contain at least two spectrum points.",
    );
  const count = Math.min(2048, last - first + 1),
    x = new Float64Array(count),
    y = new Float64Array(count),
    weights = new Float64Array(count);
  for (let b = 0; b < count; b++) {
    const start = first + Math.floor((b * (last - first + 1)) / count),
      end = first + Math.floor(((b + 1) * (last - first + 1)) / count),
      values: number[] = [];
    const step = Math.max(1, Math.floor((end - start) / 32));
    for (let i = start; i < end; i += step)
      if (inBaselineRegion(data.x[i] + offset, recipe))
        values.push(data.real[i]);
    x[b] = (data.x[start] + data.x[end - 1]) / 2 + offset;
    y[b] = median(values);
    weights[b] = values.length ? 1 : 0;
  }
  if (weights.reduce((a, b) => a + b, 0) < 2)
    throw new Error("Baseline exclusions leave fewer than two usable points.");
  const knownX: number[] = [],
    knownY: number[] = [];
  for (let i = 0; i < count; i++)
    if (weights[i]) {
      knownX.push(x[i]);
      knownY.push(y[i]);
    }
  for (let i = 0; i < count; i++)
    if (!weights[i]) y[i] = interpolate(knownX, knownY, x[i]);
  return { x, y, weights };
}
function interpolate(
  x: Float64Array | number[],
  y: Float64Array | number[],
  at: number,
): number {
  const n = x.length,
    ascending = x[n - 1] > x[0];
  if (ascending ? at <= x[0] : at >= x[0]) return y[0];
  if (ascending ? at >= x[n - 1] : at <= x[n - 1]) return y[n - 1];
  let low = 0,
    high = n - 1;
  while (high - low > 1) {
    const m = (low + high) >> 1;
    if (ascending ? x[m] <= at : x[m] >= at) low = m;
    else high = m;
  }
  const t = (at - x[low]) / (x[high] - x[low]);
  return y[low] * (1 - t) + y[high] * t;
}
function basis(t: number, order: number, bernstein: boolean): Float64Array {
  const out = new Float64Array(order + 1);
  if (bernstein) {
    let choose = 1;
    for (let k = 0; k <= order; k++) {
      if (k) choose *= (order - k + 1) / k;
      out[k] = choose * t ** k * (1 - t) ** (order - k);
    }
  } else {
    const z = 2 * t - 1;
    out[0] = 1;
    if (order > 0) out[1] = z;
    // Legendre coordinates span the same polynomial space without monomial instability at order 20.
    for (let k = 2; k <= order; k++)
      out[k] = ((2 * k - 1) * z * out[k - 1] - (k - 1) * out[k - 2]) / k;
  }
  return out;
}
function polynomialCoefficients(
  t: Float64Array,
  y: Float64Array,
  weights: Float64Array,
  order: number,
  bernstein: boolean,
): Float64Array {
  const n = y.length,
    width = order + 1,
    q: Float64Array[] = [],
    r = Array.from({ length: width }, () => new Float64Array(width));
  const design = Array.from({ length: width }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const values = basis(t[i], order, bernstein),
      weight = Math.sqrt(weights[i]);
    for (let k = 0; k < width; k++) design[k][i] = values[k] * weight;
  }
  const projection = new Float64Array(width);
  for (let k = 0; k < width; k++) {
    const column = design[k];
    // Two-pass modified Gram-Schmidt for stable weighted Bernstein fits.
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < k; j++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += q[j][i] * column[i];
        r[j][k] += dot;
        for (let i = 0; i < n; i++) column[i] -= dot * q[j][i];
      }
    let norm = 0;
    for (const v of column) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm < 1e-12)
      throw new Error(
        "Polynomial fit is underdetermined. Reduce its order or provide more baseline points.",
      );
    r[k][k] = norm;
    for (let i = 0; i < n; i++) column[i] /= norm;
    q.push(column);
    for (let i = 0; i < n; i++)
      projection[k] += column[i] * y[i] * Math.sqrt(weights[i]);
  }
  const coefficients = new Float64Array(width);
  for (let k = width - 1; k >= 0; k--) {
    let value = projection[k];
    for (let j = k + 1; j < width; j++) value -= r[k][j] * coefficients[j];
    coefficients[k] = value / r[k][k];
  }
  return coefficients;
}
function evaluatePolynomial(
  t: Float64Array,
  coefficients: Float64Array,
  bernstein: boolean,
): Float64Array {
  return Float64Array.from(t, (value) => {
    const b = basis(value, coefficients.length - 1, bernstein);
    let result = 0;
    for (let k = 0; k < b.length; k++) result += coefficients[k] * b[k];
    return result;
  });
}
function initialPeakWeights(
  y: Float64Array,
  weights: Float64Array,
  window: number,
): Float64Array {
  const local = medianFilter(y, window),
    residual = Array.from(y, (v, i) => v - local[i]),
    center = median([...residual]);
  const scale = Math.max(
    1e-12,
    Math.max(...y.map(Math.abs)) * 1e-8,
    1.4826 * median(residual.map((v) => Math.abs(v - center))),
  );
  return Float64Array.from(
    weights,
    (w, i) => w * (Math.abs(residual[i] - center) > 3 * scale ? 0.001 : 1),
  );
}
function robustPolynomial(
  reduced: ReducedBaseline,
  order: number,
  bernstein: boolean,
  window: number,
): Float64Array {
  const low = Math.min(reduced.x[0], reduced.x[reduced.x.length - 1]),
    span = Math.abs(reduced.x[0] - reduced.x[reduced.x.length - 1]) || 1;
  const t = Float64Array.from(reduced.x, (x) => (x - low) / span);
  let weights = initialPeakWeights(reduced.y, reduced.weights, window);
  let result: Float64Array = reduced.y.slice();
  order = Math.min(
    order,
    Math.floor(reduced.weights.reduce((a, b) => a + b, 0)) - 1,
  );
  for (let iteration = 0; iteration < 8; iteration++) {
    result = evaluatePolynomial(
      t,
      polynomialCoefficients(t, reduced.y, weights, order, bernstein),
      bernstein,
    );
    const residual = Array.from(reduced.y, (v, i) => v - result[i]),
      included = residual.filter((_, i) => reduced.weights[i] > 0),
      center = median(included);
    const scale = Math.max(
      1e-12,
      Math.max(...reduced.y.map(Math.abs)) * 1e-8,
      1.4826 * median(included.map((v) => Math.abs(v - center))),
    );
    weights = Float64Array.from(
      reduced.weights,
      (w, i) =>
        w *
        Math.max(
          1e-6,
          Math.min(
            1,
            ((2.5 * scale) / Math.max(scale, Math.abs(residual[i] - center))) **
              2,
          ),
        ),
    );
  }
  return result;
}
/** O(n) LDL factorization of W + lambda D2' D2 (symmetric pentadiagonal). */
export function whittakerSmooth(
  y: Float64Array,
  weights: Float64Array,
  lambda: number,
): Float64Array {
  const n = y.length;
  if (weights.length !== n || !(lambda >= 0) || !Number.isFinite(lambda))
    throw new Error("Invalid Whittaker smoothing parameters.");
  const diagonal = weights.slice(),
    first = new Float64Array(Math.max(0, n - 1)),
    second = new Float64Array(Math.max(0, n - 2));
  for (let i = 0; i < n - 2; i++) {
    diagonal[i] += lambda;
    diagonal[i + 1] += 4 * lambda;
    diagonal[i + 2] += lambda;
    first[i] -= 2 * lambda;
    first[i + 1] -= 2 * lambda;
    second[i] += lambda;
  }
  const d = new Float64Array(n),
    l1 = new Float64Array(n),
    l2 = new Float64Array(n),
    z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i >= 2) l2[i] = second[i - 2] / d[i - 2];
    if (i >= 1)
      l1[i] =
        (first[i - 1] - (i >= 2 ? l2[i] * d[i - 2] * l1[i - 1] : 0)) / d[i - 1];
    d[i] =
      diagonal[i] +
      1e-12 -
      (i >= 1 ? l1[i] ** 2 * d[i - 1] : 0) -
      (i >= 2 ? l2[i] ** 2 * d[i - 2] : 0);
    if (!(d[i] > 0) || !Number.isFinite(d[i]))
      throw new Error(
        "Whittaker smoothing is numerically singular. Reduce smoothness or add anchors.",
      );
    z[i] =
      weights[i] * y[i] -
      (i >= 1 ? l1[i] * z[i - 1] : 0) -
      (i >= 2 ? l2[i] * z[i - 2] : 0);
  }
  const out = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--)
    out[i] =
      z[i] / d[i] -
      (i + 1 < n ? l1[i + 1] * out[i + 1] : 0) -
      (i + 2 < n ? l2[i + 2] * out[i + 2] : 0);
  return out;
}
function penalizedBaseline(
  reduced: ReducedBaseline,
  recipe: ProcessingRecipe,
  asymmetric: boolean,
): Float64Array {
  const lambda =
      10 **
      bounded(recipe.baselineSmoothness, 6, 0, 12, "Baseline log10(lambda)"),
    iterations = Math.round(
      bounded(recipe.baselineIterations, 20, 1, 100, "Baseline iterations"),
    );
  const ratio = bounded(
      recipe.baselineRatio,
      1e-6,
      1e-9,
      0.1,
      "Baseline convergence ratio",
    ),
    window = Math.round(
      bounded(recipe.baselineMedianWindow, 9, 1, 101, "Baseline median window"),
    );
  let weights = initialPeakWeights(reduced.y, reduced.weights, window);
  let out: Float64Array = reduced.y.slice();
  for (let iteration = 0; iteration < iterations; iteration++) {
    out = whittakerSmooth(reduced.y, weights, lambda);
    const residual = Array.from(reduced.y, (v, i) => v - out[i]),
      negative = residual.filter((v, i) => v < 0 && reduced.weights[i] > 0);
    const mean = negative.length
      ? negative.reduce((a, b) => a + b, 0) / negative.length
      : 0;
    const sd = Math.max(
      1e-12,
      Math.sqrt(
        negative.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          Math.max(1, negative.length),
      ),
    );
    const center = median(residual.filter((_, i) => reduced.weights[i] > 0)),
      scale = Math.max(
        1e-12,
        Math.max(...reduced.y.map(Math.abs)) * 1e-8,
        median(residual.map((v) => Math.abs(v - center))) * 1.4826,
      );
    const next = Float64Array.from(reduced.weights, (w, i) => {
      if (!w) return 0;
      if (asymmetric) {
        const exponent = Math.max(
          -60,
          Math.min(60, (2 * (residual[i] - (2 * sd - mean))) / sd),
        );
        return Math.max(1e-6, 1 / (1 + Math.exp(exponent)));
      }
      return Math.max(
        1e-6,
        Math.min(
          1,
          ((2.5 * scale) / Math.max(scale, Math.abs(residual[i] - center))) **
            2,
        ),
      );
    });
    let change = 0,
      size = 0;
    for (let i = 0; i < weights.length; i++) {
      change += (next[i] - weights[i]) ** 2;
      size += weights[i] ** 2;
    }
    weights = next;
    if (Math.sqrt(change / Math.max(1e-12, size)) < ratio) break;
  }
  return out;
}
function naturalSpline(x: number[], y: number[]): (at: number) => number {
  const n = x.length,
    second = new Float64Array(n),
    work = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ratio = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]),
      p = ratio * second[i - 1] + 2;
    second[i] = (ratio - 1) / p;
    const slope =
      (y[i + 1] - y[i]) / (x[i + 1] - x[i]) -
      (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
    work[i] = ((6 * slope) / (x[i + 1] - x[i - 1]) - ratio * work[i - 1]) / p;
  }
  for (let i = n - 2; i >= 0; i--)
    second[i] = second[i] * second[i + 1] + work[i];
  return (at) => {
    if (at <= x[0]) return y[0];
    if (at >= x[n - 1]) return y[n - 1];
    let low = 0,
      high = n - 1;
    while (high - low > 1) {
      const m = (low + high) >> 1;
      if (x[m] <= at) low = m;
      else high = m;
    }
    const h = x[high] - x[low],
      a = (x[high] - at) / h,
      b = (at - x[low]) / h;
    return (
      a * y[low] +
      b * y[high] +
      (((a ** 3 - a) * second[low] + (b ** 3 - b) * second[high]) * h ** 2) / 6
    );
  };
}
function autoSpline(reduced: ReducedBaseline, window: number): Float64Array {
  const seed = robustPolynomial(reduced, 3, false, window),
    residual = Array.from(reduced.y, (v, i) => v - seed[i]);
  const quiet = residual.filter((_, i) => reduced.weights[i] > 0),
    center = median(quiet);
  const noise = Math.max(
    1e-12,
    Math.max(...reduced.y.map(Math.abs)) * 1e-8,
    median(quiet.map((v) => Math.abs(v - center))) * 1.4826,
  );
  const knots: { x: number; y: number }[] = [],
    block = Math.max(4, Math.floor(reduced.y.length / 96));
  for (let start = 0; start < reduced.y.length; start += block) {
    const indices: number[] = [];
    for (let i = start; i < Math.min(reduced.y.length, start + block); i++)
      if (reduced.weights[i] && Math.abs(residual[i] - center) <= 3 * noise)
        indices.push(i);
    if (indices.length)
      knots.push({
        x: median(indices.map((i) => reduced.x[i])),
        y: median(indices.map((i) => reduced.y[i])),
      });
  }
  if (knots.length < 2)
    return penalizedBaseline(
      reduced,
      { baselineSmoothness: 6, baseline: "auto" } as ProcessingRecipe,
      false,
    );
  knots.sort((a, b) => a.x - b.x);
  const spline = naturalSpline(
    knots.map((k) => k.x),
    knots.map((k) => k.y),
  );
  return Float64Array.from(reduced.x, spline);
}
/** Independent alternating peak shaving; intended for spectra without negative peaks. */
function ablativeBaseline(
  reduced: ReducedBaseline,
  window: number,
  iterations: number,
): Float64Array {
  let out = reduced.y.slice();
  for (let sweep = 0; sweep < iterations; sweep++) {
    const span = Math.max(1, Math.round(window * (1 - sweep / iterations))),
      direction = sweep % 2 ? -1 : 1;
    for (let j = span; j < out.length - span; j++) {
      const i = direction > 0 ? j : out.length - 1 - j;
      if (reduced.weights[i])
        out[i] = Math.min(out[i], (out[i - span] + out[i + span]) / 2);
    }
  }
  return medianFilter(out, 5);
}
/** SNIP log-log-square-root transform followed by symmetric iterative clipping. */
function snipBaseline(reduced: ReducedBaseline, window: number): Float64Array {
  const low = Math.min(...reduced.y),
    shift = low < 0 ? -low : 0;
  let out = Float64Array.from(reduced.y, (v) =>
    Math.log(Math.log(Math.sqrt(Math.max(0, v + shift)) + 1) + 1),
  );
  for (let span = window; span >= 1; span--) {
    const next = out.slice();
    for (let i = span; i < out.length - span; i++)
      if (reduced.weights[i])
        next[i] = Math.min(out[i], (out[i - span] + out[i + span]) / 2);
    out = next;
  }
  return Float64Array.from(
    out,
    (v) => (Math.exp(Math.exp(v) - 1) - 1) ** 2 - shift,
  );
}

/** Returns full-resolution baseline values; excludes regions from both fitting and subtraction. */
export function estimateBaseline(
  data: ComplexData,
  recipe: ProcessingRecipe,
  offset = 0,
): Float64Array {
  validateBaselineRegions(recipe);
  const baseline = new Float64Array(data.real.length);
  if (recipe.baseline === "none") return baseline;
  if (recipe.baseline === "manual") {
    const anchors = [...recipe.baselineAnchors]
      .sort((a, b) => a.ppm - b.ppm)
      .filter((a) => inBaselineRegion(a.ppm, recipe));
    if (anchors.length < 2)
      throw new Error("Manual baseline requires at least two usable anchors.");
    if (
      anchors.some(
        (a, i) =>
          !Number.isFinite(a.ppm + a.value) ||
          (i && a.ppm === anchors[i - 1].ppm),
      )
    )
      throw new Error(
        "Baseline anchors must be finite and have unique positions.",
      );
    const method = recipe.manualBaselineMethod ?? "segments",
      x = anchors.map((a) => a.ppm),
      y = anchors.map((a) => a.value);
    let evaluator: (at: number) => number;
    if (method === "segments") evaluator = (at) => interpolate(x, y, at);
    else if (method === "splines") evaluator = naturalSpline(x, y);
    else if (method === "polynomial") {
      const order = Math.min(
          Math.round(
            bounded(
              recipe.baselineOrder,
              3,
              1,
              20,
              "Baseline polynomial order",
            ),
          ),
          anchors.length - 1,
        ),
        span = x[x.length - 1] - x[0];
      const t = Float64Array.from(x, (at) => (at - x[0]) / span),
        coefficients = polynomialCoefficients(
          t,
          Float64Array.from(y),
          new Float64Array(x.length).fill(1),
          order,
          false,
        );
      evaluator = (at) =>
        evaluatePolynomial(
          Float64Array.of(Math.max(0, Math.min(1, (at - x[0]) / span))),
          coefficients,
          false,
        )[0];
    } else if (method === "whittaker") {
      const size = 1024,
        grid = Float64Array.from(
          { length: size },
          (_, i) => x[0] + ((x[x.length - 1] - x[0]) * i) / (size - 1),
        ),
        values = new Float64Array(size),
        weights = new Float64Array(size);
      for (let a = 0; a < anchors.length; a++) {
        const i = Math.round(
          ((x[a] - x[0]) / (x[x.length - 1] - x[0])) * (size - 1),
        );
        values[i] = y[a];
        weights[i] = 1;
      }
      const smoothed = whittakerSmooth(
        values,
        weights,
        10 **
          bounded(
            recipe.baselineSmoothness,
            6,
            0,
            12,
            "Baseline log10(lambda)",
          ),
      );
      evaluator = (at) => interpolate(grid, smoothed, at);
    } else throw new Error("Unsupported manual baseline method.");
    for (let i = 0; i < baseline.length; i++) {
      const ppm = data.x[i] + offset;
      if (inBaselineRegion(ppm, recipe)) baseline[i] = evaluator(ppm);
    }
    return baseline;
  }
  if (
    !recipe.baselineMethod &&
    !recipe.baselineRegion &&
    !recipe.baselineExcludedRegions?.length
  ) {
    const legacy = automaticBaseline(data);
    for (let i = 0; i < baseline.length; i++)
      if (inBaselineRegion(data.x[i] + offset, recipe)) baseline[i] = legacy[i];
    return baseline;
  }
  const reduced = reduceBaseline(data, recipe, offset),
    window = Math.round(
      bounded(recipe.baselineMedianWindow, 9, 1, 101, "Baseline median window"),
    );
  const method = recipe.baselineMethod ?? "bernstein";
  let model: Float64Array;
  if (method === "polynomial" || method === "bernstein" || method === "pcbc")
    model = robustPolynomial(
      reduced,
      Math.round(
        bounded(recipe.baselineOrder, 3, 1, 20, "Baseline polynomial order"),
      ),
      method === "bernstein",
      window,
    );
  else if (method === "whittaker" || method === "arpls" || method === "apbk")
    model = penalizedBaseline(reduced, recipe, method === "arpls");
  else if (method === "splines") model = autoSpline(reduced, window);
  else if (method === "ablative")
    model = ablativeBaseline(
      reduced,
      Math.round(
        bounded(recipe.baselineSnipWindow, 40, 1, 512, "Peak shaving window"),
      ),
      Math.round(
        bounded(recipe.baselineIterations, 20, 1, 100, "Baseline iterations"),
      ),
    );
  else if (method === "snip")
    model = snipBaseline(
      reduced,
      Math.min(
        Math.floor(reduced.y.length / 2) - 1,
        Math.round(
          bounded(recipe.baselineSnipWindow, 40, 1, 512, "SNIP window"),
        ),
      ),
    );
  else throw new Error("Unsupported automatic baseline method.");
  for (let i = 0; i < baseline.length; i++) {
    const ppm = data.x[i] + offset;
    if (inBaselineRegion(ppm, recipe))
      baseline[i] = interpolate(reduced.x, model, ppm);
  }
  return baseline;
}

export interface BaselineProcessingResult {
  data: ComplexData;
  source: ComplexData;
  baseline: ComplexData;
  effectivePhase?: { ph0: number; ph1: number };
}
/** Preview and Apply share the identical fitted curve and corrected arrays. */
export function processWithBaseline(s: Spectrum): BaselineProcessingResult {
  let source = sourceSpectrum(s),
    effectivePhase: { ph0: number; ph1: number } | undefined;
  applyPhase(
    source,
    s.recipe.ph0,
    s.recipe.ph1,
    s.recipe.pivotPpm - s.referenceOffset,
  );
  // Regional fitting must not introduce a hidden global phase change outside the selected/excluded regions.
  // The joint adaptations run baseline-only when a region mask is requested.
  if (
    s.recipe.baseline === "auto" &&
    !s.recipe.baselineRegion &&
    !s.recipe.baselineExcludedRegions?.length &&
    (s.recipe.baselineMethod === "pcbc" || s.recipe.baselineMethod === "apbk")
  ) {
    if (!source.imag)
      throw new Error(
        "Joint phase/baseline methods require imaginary data or a raw FID.",
      );
    // Independent joint adaptation: remove a smooth baseline in both components, estimate phase on the residual,
    // then refit baseline after that rotation. It does not reproduce proprietary PcBc/apbk internals or neural weights.
    const method =
        s.recipe.baselineMethod === "pcbc" ? "polynomial" : "whittaker",
      fitRecipe = { ...s.recipe, baselineMethod: method } as ProcessingRecipe;
    let extra0 = 0,
      extra1 = 0;
    for (let pass = 0; pass < 2; pass++) {
      const r = estimateBaseline(source, fitRecipe, s.referenceOffset),
        im = estimateBaseline(
          { x: source.x, real: source.imag! },
          fitRecipe,
          s.referenceOffset,
        );
      const residual = {
        x: source.x,
        real: Float64Array.from(source.real, (v, i) => v - r[i]),
        imag: Float64Array.from(source.imag!, (v, i) => v - im[i]),
      };
      const correction = autoPhase({
        ...s,
        original: residual,
        recipe: {
          ...s.recipe,
          transform: false,
          ph0: 0,
          ph1: 0,
          baseline: "none",
        },
      });
      extra0 += correction.ph0;
      extra1 += correction.ph1;
      source = applyPhase(
        source,
        correction.ph0,
        correction.ph1,
        s.recipe.pivotPpm - s.referenceOffset,
      );
    }
    effectivePhase = { ph0: s.recipe.ph0 + extra0, ph1: s.recipe.ph1 + extra1 };
    const real = estimateBaseline(source, fitRecipe, s.referenceOffset),
      imag = estimateBaseline(
        { x: source.x, real: source.imag! },
        fitRecipe,
        s.referenceOffset,
      );
    const baseline = { x: source.x, real, imag },
      data = {
        x: source.x,
        real: Float64Array.from(source.real, (v, i) => v - real[i]),
        imag: Float64Array.from(source.imag!, (v, i) => v - imag[i]),
      };
    return { data, source, baseline, effectivePhase };
  }
  const curve = estimateBaseline(source, s.recipe, s.referenceOffset),
    baseline = { x: source.x, real: curve };
  const data = {
    x: source.x,
    real: Float64Array.from(source.real, (v, i) => v - curve[i]),
    imag: source.imag?.slice(),
  };
  return { data, source, baseline };
}
export function processSpectrum(s: Spectrum): ComplexData {
  if (s.recipe.baseline === "none") {
    const data = sourceSpectrum(s);
    return applyPhase(
      data,
      s.recipe.ph0,
      s.recipe.ph1,
      s.recipe.pivotPpm - s.referenceOffset,
    );
  }
  return processWithBaseline(s).data;
}

export function autoPhase(s: Spectrum): { ph0: number; ph1: number } {
  const data = sourceSpectrum(s);
  if (!data.imag) throw new Error("Automatic phase requires complex data.");
  const n = data.real.length,
    stride = Math.max(1, Math.floor(n / 8192));
  const indices: number[] = [];
  let max = 0;
  for (let i = 0; i < n; i += stride)
    max = Math.max(max, Math.hypot(data.real[i], data.imag[i]));
  for (let i = 0; i < n; i += stride)
    if (Math.hypot(data.real[i], data.imag[i]) > max * 0.015) indices.push(i);
  if (!indices.length) return { ph0: 0, ph1: 0 };
  const span = data.x[0] - data.x[n - 1] || 1,
    pivot = s.recipe.pivotPpm - s.referenceOffset;
  // Maximize positive absorption with a negative-intensity penalty; suitable for ordinary positive 1D spectra.
  const score = (p0: number, p1: number) => {
    let loss = 0;
    for (const i of indices) {
      const a = (p0 + (p1 * (pivot - data.x[i])) / span) * DEG,
        r = (data.real[i] * Math.cos(a) - data.imag![i] * Math.sin(a)) / max;
      loss += Math.max(0, -r) * 4 - r;
    }
    return loss;
  };
  let best0 = 0,
    best1 = 0,
    loss = Infinity;
  for (let p0 = -180; p0 < 180; p0 += 15)
    for (let p1 = -180; p1 <= 180; p1 += 30) {
      const l = score(p0, p1);
      if (l < loss) {
        loss = l;
        best0 = p0;
        best1 = p1;
      }
    }
  for (const step of [6, 2, 0.5, 0.1]) {
    let changed = true,
      rounds = 0;
    while (changed && rounds++ < 30) {
      changed = false;
      for (const [d0, d1] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const l = score(best0 + d0, best1 + d1);
        if (l < loss - 1e-10) {
          loss = l;
          best0 += d0;
          best1 += d1;
          changed = true;
        }
      }
    }
  }
  return { ph0: Math.round(best0 * 10) / 10, ph1: Math.round(best1 * 10) / 10 };
}

export function detectPeaks(
  data: ComplexData,
  offset: number,
  thresholdPercent: number,
  minDistancePpm: number,
  negative = false,
): Peak[] {
  if (data.x.length !== data.real.length || data.real.length < 3) return [];
  if (![offset, thresholdPercent, minDistancePpm].every(Number.isFinite))
    throw new Error("Peak picking settings must be finite.");
  let max = 0;
  for (const y of data.real) max = Math.max(max, negative ? Math.abs(y) : y);
  if (!(max > 0)) return [];
  const differences: number[] = [],
    stride = Math.max(1, Math.floor(data.real.length / 8192));
  for (let i = 1; i < data.real.length; i += stride)
    differences.push(Math.abs(data.real[i] - data.real[i - 1]));
  const noise = data.real.length >= 32 ? median(differences) / 0.9538725524 : 0;
  const threshold = Math.max(
      (max * Math.max(0, thresholdPercent)) / 100,
      noise * 4,
    ),
    candidates: { index: number; magnitude: number; sign: number }[] = [];
  for (let i = 1; i < data.real.length - 1; i++) {
    const y = data.real[i],
      sign = y < 0 ? -1 : 1,
      a = y * sign;
    if (
      (negative || sign > 0) &&
      a >= threshold &&
      a > data.real[i - 1] * sign &&
      a >= data.real[i + 1] * sign
    )
      candidates.push({ index: i, magnitude: a, sign });
  }
  // Adjacent peak intervals partition the array: valley/prominence checks are O(N).
  const valleys: { min: number; max: number }[] = [];
  let start = 0;
  for (const end of [...candidates.map((c) => c.index), data.real.length - 1]) {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = start; i <= end; i++) {
      lo = Math.min(lo, data.real[i]);
      hi = Math.max(hi, data.real[i]);
    }
    valleys.push({ min: lo, max: hi });
    start = end;
  }
  // Topographic prominence searches up to a taller peak, so tiny noisy maxima
  // on a broad signal cannot hide that signal's actual highest line.
  const higherLeft = new Int32Array(candidates.length).fill(-1),
    higherRight = new Int32Array(candidates.length).fill(candidates.length);
  const positiveStack: number[] = [],
    negativeStack: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const stack = candidates[i].sign > 0 ? positiveStack : negativeStack;
    while (
      stack.length &&
      candidates[stack.at(-1)!].magnitude <= candidates[i].magnitude
    )
      stack.pop();
    if (stack.length) higherLeft[i] = stack.at(-1)!;
    stack.push(i);
  }
  positiveStack.length = 0;
  negativeStack.length = 0;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const stack = candidates[i].sign > 0 ? positiveStack : negativeStack;
    while (
      stack.length &&
      candidates[stack.at(-1)!].magnitude <= candidates[i].magnitude
    )
      stack.pop();
    if (stack.length) higherRight[i] = stack.at(-1)!;
    stack.push(i);
  }
  const treeSize = nextPowerOfTwo(valleys.length),
    minTree = new Float64Array(treeSize * 2).fill(Infinity),
    maxTree = new Float64Array(treeSize * 2).fill(-Infinity);
  valleys.forEach((v, i) => {
    minTree[treeSize + i] = v.min;
    maxTree[treeSize + i] = v.max;
  });
  for (let i = treeSize - 1; i > 0; i--) {
    minTree[i] = Math.min(minTree[i * 2], minTree[i * 2 + 1]);
    maxTree[i] = Math.max(maxTree[i * 2], maxTree[i * 2 + 1]);
  }
  function valleyMinimum(left: number, right: number, sign: number): number {
    left += treeSize;
    right += treeSize;
    let result = Infinity;
    while (left <= right) {
      if (left & 1) {
        result = Math.min(result, sign > 0 ? minTree[left] : -maxTree[left]);
        left++;
      }
      if (!(right & 1)) {
        result = Math.min(result, sign > 0 ? minTree[right] : -maxTree[right]);
        right--;
      }
      left >>= 1;
      right >>= 1;
    }
    return result;
  }
  const resolved = candidates.filter(
    (c, i) =>
      c.magnitude -
        Math.max(
          valleyMinimum(higherLeft[i] + 1, i, c.sign),
          valleyMinimum(i + 1, higherRight[i], c.sign),
        ) >=
      Math.max(noise * 3.5, max * 1e-12),
  );
  resolved.sort((a, b) => b.magnitude - a.magnitude);
  const selected: Peak[] = [];
  const distance = Math.max(0, minDistancePpm),
    buckets = new Map<number, number[]>();
  for (const { index: i } of resolved) {
    const a = data.real[i - 1],
      b = data.real[i],
      c = data.real[i + 1],
      denominator = a - 2 * b + c;
    const delta = denominator
      ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator))
      : 0;
    const ppm = data.x[i] + delta * (data.x[i + 1] - data.x[i]) + offset;
    const bucket = distance > 0 ? Math.floor(ppm / distance) : 0;
    const tooClose =
      distance > 0 &&
      [bucket - 1, bucket, bucket + 1].some((k) =>
        (buckets.get(k) ?? []).some(
          (position) => Math.abs(position - ppm) < distance,
        ),
      );
    if (!tooClose) {
      selected.push({ id: uid(), ppm, height: b - 0.25 * (a - c) * delta });
      if (distance > 0)
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), ppm]);
    }
    if (selected.length >= 5000) break;
  }
  return selected.sort((a, b) => b.ppm - a.ppm);
}

/** Signed area in intensity·ppm; clipped endpoints are interpolated and decreasing axes use positive widths. */
export function integrate(
  data: ComplexData,
  offset: number,
  from: number,
  to: number,
): number {
  const low = Math.min(from, to) - offset,
    high = Math.max(from, to) - offset;
  let area = 0;
  for (let i = 1; i < data.x.length; i++) {
    const a = data.x[i - 1],
      b = data.x[i],
      l = Math.max(low, Math.min(a, b)),
      h = Math.min(high, Math.max(a, b));
    if (h <= l || a === b) continue;
    const at = (x: number) =>
      data.real[i - 1] +
      ((data.real[i] - data.real[i - 1]) * (x - a)) / (b - a);
    area += ((at(l) + at(h)) * (h - l)) / 2;
  }
  return area;
}

function analysisRegionIndices(
  data: ComplexData,
  offset: number,
  low: number,
  high: number,
): [number, number] {
  const ascending = data.x[0] < data.x[data.x.length - 1];
  const a = ascending ? low - offset : -(high - offset),
    b = ascending ? high - offset : -(low - offset);
  function bound(value: number, upper: boolean) {
    let left = 0,
      right = data.x.length;
    while (left < right) {
      const middle = (left + right) >>> 1,
        x = ascending ? data.x[middle] : -data.x[middle];
      if (x < value || (upper && x === value)) left = middle + 1;
      else right = middle;
    }
    return left;
  }
  return [bound(a, false), bound(b, true)];
}
export function analyzeMultiplet(
  data: ComplexData,
  offset: number,
  from: number,
  to: number,
  frequencyMHz: number,
): Multiplet {
  const lo = Math.min(from, to),
    hi = Math.max(from, to);
  if (![lo, hi, offset, frequencyMHz].every(Number.isFinite) || lo === hi)
    throw new Error("Choose finite multiplet region limits.");
  const [start, end] = analysisRegionIndices(data, offset, lo, hi);
  const region: ComplexData = {
    x: data.x.slice(start, end),
    real: data.real.slice(start, end),
  };
  const spacing =
    region.x.length > 1 ? Math.abs(region.x[1] - region.x[0]) * 2 : 0.001;
  const peaks = detectPeaks(region, offset, 4, spacing),
    count = peaks.length;
  const gaps = peaks
    .slice(1)
    .map((p, i) => Math.abs(peaks[i].ppm - p.ppm) * frequencyMHz);
  const meanGap = gaps.length
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length
    : 0;
  const equalSpacing = gaps.every(
    (g) => Math.abs(g - meanGap) < Math.max(0.2, meanGap * 0.12),
  );
  const patterns: Record<number, number[]> = {
    2: [1, 1],
    3: [1, 2, 1],
    4: [1, 3, 3, 1],
    5: [1, 4, 6, 4, 1],
    6: [1, 5, 10, 10, 5, 1],
    7: [1, 6, 15, 20, 15, 6, 1],
  };
  const expected = patterns[count],
    maximum = Math.max(...peaks.map((p) => p.height), 0);
  const equalPattern =
    expected &&
    peaks.every(
      (p, i) =>
        Math.abs(p.height / maximum - expected[i] / Math.max(...expected)) <
        0.22,
    );
  const kind =
    count === 1
      ? "s"
      : equalSpacing && equalPattern
        ? (
            {
              2: "d",
              3: "t",
              4: "q",
              5: "quint",
              6: "sext",
              7: "sept",
            } as Record<number, string>
          )[count]
        : "m";
  const center = peaks.length
    ? peaks.reduce((sum, p) => sum + p.ppm * p.height, 0) /
      peaks.reduce((sum, p) => sum + p.height, 0)
    : (from + to) / 2;
  return {
    id: uid(),
    from: hi,
    to: lo,
    center,
    kind,
    couplingsHz: kind !== "m" && meanGap && frequencyMHz > 0 ? [meanGap] : [],
    peakCount: count,
    label: "",
  };
}

/** Automatic candidate regions; simple first-order labels remain tentative estimates. */
export function autoMultiplets(
  s: Spectrum,
  from?: number,
  to?: number,
): Multiplet[] {
  if (s.data.x.length < 3) return [];
  const bounds = [
    Math.max(s.data.x[0], s.data.x[s.data.x.length - 1]) + s.referenceOffset,
    Math.min(s.data.x[0], s.data.x[s.data.x.length - 1]) + s.referenceOffset,
  ];
  const low = Math.min(from ?? bounds[0], to ?? bounds[1]),
    high = Math.max(from ?? bounds[0], to ?? bounds[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high)
    throw new Error("Choose a valid multiplet analysis region.");
  const [start, end] = analysisRegionIndices(
    s.data,
    s.referenceOffset,
    low,
    high,
  );
  const region = {
    x: s.data.x.slice(start, end),
    real: s.data.real.slice(start, end),
  };
  const peaks = detectPeaks(region, s.referenceOffset, 0.5, 0).sort(
    (a, b) => a.ppm - b.ppm,
  );
  if (!peaks.length) return [];
  const step = Math.abs(s.data.x[1] - s.data.x[0]),
    maxGap = s.frequencyMHz > 0 ? 20 / s.frequencyMHz : 0.05;
  const groups: Peak[][] = [];
  for (const peak of peaks) {
    const last = groups.at(-1),
      previous = last?.at(-1);
    if (last && previous && peak.ppm - previous.ppm <= maxGap) {
      const gap = peak.ppm - previous.ppm;
      const [a, b] = analysisRegionIndices(
        s.data,
        s.referenceOffset,
        previous.ppm,
        peak.ppm,
      );
      let valley = Infinity;
      for (let i = a; i < b; i++) valley = Math.min(valley, s.data.real[i]);
      // Deep baseline separation plus large spacing splits independent signals;
      // tightly spaced resolved lines form one tentative multiplet candidate.
      const boundary =
        valley < Math.min(previous.height, peak.height) * 0.02 &&
        gap > (s.frequencyMHz > 0 ? 12 / s.frequencyMHz : 0.03);
      if (!boundary) {
        last.push(peak);
        continue;
      }
    }
    groups.push([peak]);
  }
  return groups.slice(0, 1000).map((group, index) => {
    const first = group[0].ppm,
      last = group.at(-1)!.ppm;
    const adjacentLow = groups[index - 1]?.at(-1)?.ppm ?? low,
      adjacentHigh = groups[index + 1]?.[0]?.ppm ?? high;
    const padding = Math.max(
      step * 4,
      Math.min(0.04, s.frequencyMHz > 0 ? 4 / s.frequencyMHz : 0.01),
    );
    const left = Math.max(low, first - padding, (adjacentLow + first) / 2),
      right = Math.min(high, last + padding, (last + adjacentHigh) / 2);
    const result = analyzeMultiplet(
      s.data,
      s.referenceOffset,
      right,
      left,
      s.frequencyMHz,
    );
    return {
      ...result,
      label:
        String.fromCharCode(65 + (index % 26)) +
        (index >= 26 ? String(Math.floor(index / 26) + 1) : ""),
    };
  });
}
