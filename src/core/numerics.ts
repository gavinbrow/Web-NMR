import {
  uid,
  type ComplexData,
  type FidData,
  type Multiplet,
  type Peak,
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

/** Bruker GRPDLY correction: integer truncation and tail compensation, not a guessed fractional correction. */
export function correctDigitalFilter(fid: FidData): {
  real: Float64Array;
  imag: Float64Array;
} {
  const n = fid.real.length,
    delay = Math.floor(fid.groupDelay);
  if (!Number.isFinite(delay) || delay < 0)
    throw new Error(
      "Digital-filter delay is unavailable. Disable correction or import valid GRPDLY metadata.",
    );
  if (!delay) return { real: fid.real.slice(), imag: fid.imag.slice() };
  if (delay + 8 >= n)
    throw new Error("Digital-filter delay exceeds the available FID.");
  const skip = delay + 2,
    add = Math.max(skip - 6, 0),
    length = n - skip;
  const real = new Float64Array(length),
    imag = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    real[i] = fid.real[(i + delay) % n];
    imag[i] = fid.imag[(i + delay) % n];
    if (i < add) {
      const tail = (n - 1 - i + delay) % n;
      real[i] += fid.real[tail];
      imag[i] += fid.imag[tail];
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
  if (![1, 2, 4, 8].includes(s.recipe.zeroFill))
    throw new Error("Zero fill must be 1, 2, 4 or 8.");
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

export function processSpectrum(s: Spectrum): ComplexData {
  const data = sourceSpectrum(s);
  applyPhase(
    data,
    s.recipe.ph0,
    s.recipe.ph1,
    s.recipe.pivotPpm - s.referenceOffset,
  );
  if (s.recipe.baseline === "auto") {
    const baseline = automaticBaseline(data);
    for (let i = 0; i < data.real.length; i++) data.real[i] -= baseline[i];
  }
  if (s.recipe.baseline === "manual") {
    const anchors = [...s.recipe.baselineAnchors].sort((a, b) => a.ppm - b.ppm);
    if (anchors.length < 2)
      throw new Error("Manual baseline requires at least two anchors.");
    if (
      anchors.some(
        (a, i) =>
          !Number.isFinite(a.ppm + a.value) ||
          (i > 0 && a.ppm === anchors[i - 1].ppm),
      )
    )
      throw new Error(
        "Baseline anchors must be finite and have unique positions.",
      );
    for (let i = 0; i < data.real.length; i++) {
      const ppm = data.x[i] + s.referenceOffset;
      let b = 0;
      while (b < anchors.length - 2 && ppm > anchors[b + 1].ppm) b++;
      const a = anchors[b],
        c = anchors[b + 1],
        t = Math.max(0, Math.min(1, (ppm - a.ppm) / (c.ppm - a.ppm)));
      data.real[i] -= a.value * (1 - t) + c.value * t;
    }
  }
  return data;
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
  let max = 0;
  for (const y of data.real) max = Math.max(max, negative ? Math.abs(y) : y);
  const threshold = (max * Math.max(0, thresholdPercent)) / 100,
    candidates: { index: number; magnitude: number }[] = [];
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
      candidates.push({ index: i, magnitude: a });
  }
  candidates.sort((a, b) => b.magnitude - a.magnitude);
  const selected: Peak[] = [];
  for (const { index: i } of candidates) {
    const a = data.real[i - 1],
      b = data.real[i],
      c = data.real[i + 1],
      denominator = a - 2 * b + c;
    const delta = denominator
      ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator))
      : 0;
    const ppm = data.x[i] + delta * (data.x[i + 1] - data.x[i]) + offset;
    if (selected.every((p) => Math.abs(p.ppm - ppm) >= minDistancePpm))
      selected.push({ id: uid(), ppm, height: b - 0.25 * (a - c) * delta });
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

export function analyzeMultiplet(
  data: ComplexData,
  offset: number,
  from: number,
  to: number,
  frequencyMHz: number,
): Multiplet {
  const lo = Math.min(from, to),
    hi = Math.max(from, to),
    indices: number[] = [];
  for (let i = 0; i < data.x.length; i++)
    if (data.x[i] + offset >= lo && data.x[i] + offset <= hi) indices.push(i);
  const region: ComplexData = {
    x: Float64Array.from(indices.map((i) => data.x[i])),
    real: Float64Array.from(indices.map((i) => data.real[i])),
  };
  const spacing =
    region.x.length > 1 ? Math.abs(region.x[1] - region.x[0]) * 2 : 0.001;
  const peaks = detectPeaks(region, offset, 12, spacing),
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
        ? ({ 2: "d", 3: "t", 4: "q" } as Record<number, string>)[count]
        : "m";
  const center = peaks.length
    ? peaks.reduce((sum, p) => sum + p.ppm * p.height, 0) /
      peaks.reduce((sum, p) => sum + p.height, 0)
    : (from + to) / 2;
  return {
    id: uid(),
    from,
    to,
    center,
    kind,
    couplingsHz: kind !== "m" && meanGap && frequencyMHz > 0 ? [meanGap] : [],
    peakCount: count,
    label: "",
  };
}
