import type { ComplexData, Spectrum, TwoDView } from "../model";
import type { ContourGrid } from "./contours";

export type TracePoint = { ppm: number; value: number };

export function traceSourceKey(
  view: Pick<TwoDView, "topSpectrumId" | "leftSpectrumId">,
): string {
  return JSON.stringify([
    view.topSpectrumId ?? null,
    view.leftSpectrumId ?? null,
  ]);
}
/** Merge external source attachments only. Outgoing snapshots are acknowledgements, even if they arrive late. */
export function reconcileTraceSources(
  current: TwoDView,
  incoming: TwoDView,
  outgoing: ReadonlySet<string>,
): TwoDView {
  const key = traceSourceKey(incoming);
  if (key === traceSourceKey(current) || outgoing.has(key)) return current;
  return {
    ...current,
    topSpectrumId: incoming.topSpectrumId,
    leftSpectrumId: incoming.leftSpectrumId,
  };
}

/** Robust display-only floor. This does not baseline-correct or change the source matrix. */
export function projectionNoiseFloor(matrix: ContourGrid): number {
  const samples: number[] = [],
    stride = Math.max(1, Math.floor(matrix.real.length / 8192));
  for (let i = 0; i < matrix.real.length; i += stride)
    samples.push(matrix.real[i]);
  if (!samples.length) return 0;
  samples.sort((a, b) => a - b);
  const center = samples[Math.floor(samples.length / 2)];
  const deviations = samples
    .map((value) => Math.abs(value - center))
    .sort((a, b) => a - b);
  return Math.max(
    0,
    Math.abs(center) +
      (5 * deviations[Math.floor(deviations.length / 2)]) / 0.67449,
  );
}

/** Positive amplitude skyline: each coordinate keeps its largest absolute crosspeak, displayed positive.
 * Subtracting the estimated display floor removes the extreme-value noise pedestal. Negative peaks
 * contribute positively here, but keep their signs in matrix/contours and imported 1D traces.
 * The skyline is neither a sum nor a quantitative or phase-sensitive projection.
 */
export function skylineProjections(
  matrix: ContourGrid,
  floor?: number,
): {
  top: ComplexData;
  left: ComplexData;
  floor: number;
  topFloor: number;
  leftFloor: number;
} {
  const minimum = floor ?? projectionNoiseFloor(matrix);
  const top = new Float64Array(matrix.width),
    left = new Float64Array(matrix.height);
  for (let row = 0; row < matrix.height; row++)
    for (let col = 0; col < matrix.width; col++) {
      const value = Math.max(
        0,
        Math.abs(matrix.real[row * matrix.width + col]),
      );
      if (value > top[col]) top[col] = value;
      if (value > left[row]) left[row] = value;
    }
  // Maximum projections raise the apparent noise pedestal above the matrix's noise.
  // Estimate that pedestal from the quiet lower quartile of each projected trace.
  // Explicit floor=0 returns the complete unfiltered amplitude skyline.
  const displayFloor = (values: Float64Array) =>
    floor === undefined
      ? Math.max(
          minimum,
          values.slice().sort()[Math.floor(values.length / 4)] || 0,
        )
      : minimum;
  const topFloor = displayFloor(top),
    leftFloor = displayFloor(left);
  for (let i = 0; i < top.length; i++) top[i] = Math.max(0, top[i] - topFloor);
  for (let i = 0; i < left.length; i++)
    left[i] = Math.max(0, left[i] - leftFloor);
  return {
    top: { x: matrix.x, real: top },
    left: { x: matrix.y, real: left },
    floor: minimum,
    topFloor,
    leftFloor,
  };
}
const nucleusKey = (value: string) =>
  value.replace(/[\s^<>]/g, "").toLowerCase();

/** A matching nucleus and overlapping referenced axis are required; field strength may differ. */
export function suitableTraceSources(
  spectra: Spectrum[],
  nucleus: string,
  range: [number, number],
): Spectrum[] {
  const key = nucleusKey(nucleus);
  return spectra.filter((s) => {
    const x = s.data.x;
    return (
      !s.twoD &&
      key !== "unknown" &&
      key === nucleusKey(s.nucleus) &&
      x.length >= 2 &&
      x[0] > x[x.length - 1] &&
      x[0] + s.referenceOffset >= range[1] &&
      x[x.length - 1] + s.referenceOffset <= range[0]
    );
  });
}

/** Pixel-bin extrema retain every narrow positive/negative line without drawing every source sample. */
export function traceEnvelope(
  data: ComplexData,
  offset: number,
  range: [number, number],
  pixels: number,
): TracePoint[] {
  const x = data.x,
    y = data.real,
    n = x.length;
  if (
    n < 2 ||
    x[0] <= x[n - 1] ||
    range[0] <= range[1] ||
    !Number.isFinite(offset)
  )
    return [];
  const firstBelow = (ppm: number) => {
    let lo = 0,
      hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (x[mid] + offset > ppm) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  if (x[0] + offset < range[1] || x[n - 1] + offset > range[0]) return [];
  const start = Math.max(0, firstBelow(range[0]) - 1),
    end = Math.min(n - 1, firstBelow(range[1]));
  const bins = Math.max(1, Math.min(4096, Math.ceil(pixels))),
    span = range[0] - range[1],
    output: TracePoint[] = [];
  let bin = -1,
    min = start,
    max = start,
    first = start,
    last = start;
  const flush = () => {
    for (const i of [...new Set([first, min, max, last])].sort((a, b) => a - b))
      output.push({ ppm: x[i] + offset, value: y[i] });
  };
  for (let i = start; i <= end; i++) {
    const next = Math.max(
      0,
      Math.min(
        bins - 1,
        Math.floor(((range[0] - x[i] - offset) / span) * bins),
      ),
    );
    if (next !== bin) {
      if (bin !== -1) flush();
      bin = next;
      min = max = first = last = i;
    } else {
      if (y[i] < y[min]) min = i;
      if (y[i] > y[max]) max = i;
      last = i;
    }
  }
  flush();
  return output;
}

export function tracePath(
  points: TracePoint[],
  coordinate: (ppm: number) => number,
  baseline: number,
  extent: number,
  gain: number,
  orientation: "top" | "left",
): string {
  let max = 0;
  for (const p of points) max = Math.max(max, Math.abs(p.value));
  if (!max) max = 1;
  return points
    .map((p, i) => {
      const along = coordinate(p.ppm),
        intensity = baseline - (p.value / max) * extent * gain;
      const x = orientation === "top" ? along : intensity,
        y = orientation === "top" ? intensity : along;
      return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join("");
}

export function f1Pixel(
  ppm: number,
  range: [number, number],
  top: number,
  height: number,
): number {
  return top + ((ppm - range[1]) / (range[0] - range[1])) * height;
}
export function validTwoDView(value: unknown): value is TwoDView {
  if (!value || typeof value !== "object") return false;
  const v = value as TwoDView,
    range = (r: unknown) =>
      Array.isArray(r) &&
      r.length === 2 &&
      r.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      r[0] > r[1] &&
      Number.isFinite(r[0] - r[1]);
  return (
    range(v.xView) &&
    range(v.yView) &&
    Number.isFinite(v.threshold) &&
    v.threshold >= 0.01 &&
    v.threshold <= 80 &&
    typeof v.negative === "boolean" &&
    Number.isFinite(v.topGain) &&
    v.topGain >= 0.01 &&
    v.topGain <= 100 &&
    Number.isFinite(v.leftGain) &&
    v.leftGain >= 0.01 &&
    v.leftGain <= 100 &&
    [v.topSpectrumId, v.leftSpectrumId].every(
      (id) =>
        id === undefined || (typeof id === "string" && id.length <= 100000),
    )
  );
}
