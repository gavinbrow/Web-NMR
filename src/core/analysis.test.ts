import { describe, expect, it } from 'vitest';
import { defaultRecipe, type ComplexData, type Spectrum } from '../model';
import { analyzeMultiplet, autoMultiplets, detectPeaks } from './numerics';

function signal(lines: { ppm: number; height: number; width?: number }[], low = 0, high = 8, n = 65_536): ComplexData {
  const x = new Float64Array(n), real = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = high - (high - low) * i / (n - 1);
    for (const line of lines) real[i] += line.height / (1 + ((x[i] - line.ppm) / (line.width ?? 0.0008)) ** 2);
  }
  return { x, real };
}
function spectrum(data: ComplexData): Spectrum {
  return { id: 's', label: 'S', color: '#aa3344', nucleus: '1H', frequencyMHz: 400, sourceFormat: 'Test', metadata: {}, original: data, data, recipe: defaultRecipe(), referenceOffset: 0.2, peaks: [], multiplets: [], integrals: [], integralScale: 1, gain: 1, visible: true, history: [], revision: 0 };
}
describe('resolved line peak picking', () => {
  it('finds every resolved quartet line even when splitting is below the former 0.012 ppm default', () => {
    const lines = [1, 3, 3, 1].map((height, i) => ({ ppm: 3 + (i - 1.5) * 0.006, height }));
    const data = signal(lines), peaks = detectPeaks(data, 0.2, 2, 0);
    expect(peaks).toHaveLength(4);
    peaks.forEach((p, i) => expect(p.ppm).toBeCloseTo(lines[3 - i].ppm + 0.2, 4));
    const m = analyzeMultiplet(data, 0.2, 3.23, 3.17, 400);
    expect(m.kind).toBe('q'); expect(m.peakCount).toBe(4); expect(m.couplingsHz[0]).toBeCloseTo(2.4, 2);
  });
  it('preserves broad maxima despite small noisy local maxima on their tops', () => {
    const data = signal([{ ppm: 3, height: 1, width: 0.04 }, { ppm: 4, height: 0.4, width: 0.01 }]);
    let seed = 42;
    for (let i = 0; i < data.real.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data.real[i] += (seed / 4294967296 - 0.5) * 0.001; }
    const peaks = detectPeaks(data, 0, 5, 0);
    expect(peaks.some(p => Math.abs(p.ppm - 3) < 0.005)).toBe(true);
    expect(peaks.some(p => Math.abs(p.ppm - 4) < 0.003)).toBe(true);
    expect(peaks.length).toBeLessThan(10);
  });
  it('supports negative spectral lines and explicit spacing overrides', () => {
    const data = signal([{ ppm: 2, height: -1 }, { ppm: 2.006, height: -1 }]);
    expect(detectPeaks(data, 0, 2, 0)).toHaveLength(0);
    expect(detectPeaks(data, 0, 2, 0, true)).toHaveLength(2);
    expect(detectPeaks(data, 0, 2, 0.02, true)).toHaveLength(1);
  });
});
describe('automatic multiplet candidates', () => {
  it('separates distant signals and estimates modest first-order singlet/doublet/triplet patterns', () => {
    const lines = [{ ppm: 1.2, height: 1 }, ...[1, 1].map((height, i) => ({ ppm: 2.4 + (i - 0.5) * 7 / 400, height })), ...[1, 2, 1].map((height, i) => ({ ppm: 4.1 + (i - 1) * 6 / 400, height }))];
    const groups = autoMultiplets(spectrum(signal(lines)));
    expect(groups.map(m => m.kind)).toEqual(['s', 'd', 't']);
    expect(groups.map(m => m.peakCount)).toEqual([1, 2, 3]);
    expect(groups[1].couplingsHz[0]).toBeCloseTo(7, 2); expect(groups[2].couplingsHz[0]).toBeCloseTo(6, 2);
    const cropped = autoMultiplets(spectrum(signal(lines)), 4.35, 4.25);
    expect(cropped).toHaveLength(1); expect(cropped[0].kind).toBe('t');
  });
  it('returns an unresolved pattern rather than forcing a first-order label onto irregular lines', () => {
    const data = signal([{ ppm: 3, height: 1 }, { ppm: 3.008, height: 0.8 }, { ppm: 3.024, height: 1.7 }]);
    expect(analyzeMultiplet(data, 0, 3.06, 2.98, 400).kind).toBe('m');
  });
});
