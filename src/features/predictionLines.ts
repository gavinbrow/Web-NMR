import { fft, nextPowerOfTwo } from "../core/numerics";
import type { ComplexData } from "../model";

/** Common-linewidth absorption/dispersion convolution. Linear padding prevents
 * opposite-edge wraparound. Sub-grid sticks preserve total nucleus weights.
 * Adaptive sampling is bounded so a large pattern cannot lock up the editor.
 */
export function renderPredictionLines(
  lines: { ppm: number; weight: number }[],
  low: number,
  high: number,
  frequencyMHz: number,
  lineWidthHz: number,
): { data: ComplexData; renderedLineWidthHz: number } {
  if (
    !lines.length ||
    lines.length > 100_000 ||
    !lines.every(
      (l) =>
        Number.isFinite(l.ppm) && Number.isFinite(l.weight) && l.weight > 0,
    )
  )
    throw Error("Invalid or excessively large predicted line pattern.");
  if (
    ![low, high, frequencyMHz, lineWidthHz].every(Number.isFinite) ||
    high <= low ||
    frequencyMHz <= 0 ||
    lineWidthHz <= 0
  )
    throw Error("Invalid prediction field or linewidth.");
  const n = Math.min(
    262144,
    Math.max(
      65536,
      nextPowerOfTwo((6 * (high - low) * frequencyMHz) / lineWidthHz),
    ),
  );
  const step = (high - low) / (n - 1),
    size = 2 * n;
  const renderedLineWidthHz = Math.max(lineWidthHz, 4 * step * frequencyMHz);
  const gamma = renderedLineWidthHz / frequencyMHz / 2;
  const sticks = new Float64Array(size),
    sticksImag = new Float64Array(size);
  const kernel = new Float64Array(size),
    kernelImag = new Float64Array(size);
  for (const line of lines) {
    const position = (high - line.ppm) / step,
      i = Math.floor(position),
      fraction = position - i;
    if (i < 0 || i + 1 >= n)
      throw Error("A predicted line lies outside its display axis.");
    sticks[i] += line.weight * (1 - fraction);
    sticks[i + 1] += line.weight * fraction;
  }
  for (let j = -n + 1; j < n; j++) {
    const d = j * step,
      denominator = Math.PI * (d * d + gamma * gamma),
      index = (j + size) % size;
    kernel[index] = gamma / denominator;
    // Descending ppm: positive index difference is negative chemical shift.
    kernelImag[index] = d / denominator;
  }
  fft(sticks, sticksImag);
  fft(kernel, kernelImag);
  for (let i = 0; i < size; i++) {
    const r = sticks[i] * kernel[i] - sticksImag[i] * kernelImag[i];
    sticksImag[i] = sticks[i] * kernelImag[i] + sticksImag[i] * kernel[i];
    sticks[i] = r;
  }
  fft(sticks, sticksImag, true);
  const x = Float64Array.from({ length: n }, (_, i) => high - i * step);
  const real = Float64Array.from(sticks.subarray(0, n), (v) => v / size),
    imag = Float64Array.from(sticksImag.subarray(0, n), (v) => v / size);
  return { data: { x, real, imag }, renderedLineWidthHz };
}
