import { extent, type Spectrum } from "../model";
import { integrate } from "../core/numerics";
/** A reference is a coordinate change, preserving processing and analysis geometry. */
export function shiftSpectrum(s: Spectrum, delta: number): Spectrum {
  if (!Number.isFinite(delta)) throw new Error("Enter a finite ppm shift.");
  return {
    ...s,
    referenceOffset: s.referenceOffset + delta,
    ...(s.savedView
      ? { savedView: s.savedView.map((v) => v + delta) as [number, number] }
      : {}),
    recipe: {
      ...s.recipe,
      pivotPpm: s.recipe.pivotPpm + delta,
      baselineAnchors: s.recipe.baselineAnchors.map((a) => ({
        ...a,
        ppm: a.ppm + delta,
      })),
      ...(s.recipe.baselineRegion
        ? {
            baselineRegion: s.recipe.baselineRegion.map((n) => n + delta) as [
              number,
              number,
            ],
          }
        : {}),
      ...(s.recipe.baselineExcludedRegions
        ? {
            baselineExcludedRegions: s.recipe.baselineExcludedRegions.map(
              (r) => r.map((n) => n + delta) as [number, number],
            ),
          }
        : {}),
    },
    peaks: s.peaks.map((p) => ({ ...p, ppm: p.ppm + delta })),
    integrals: s.integrals.map((i) => ({
      ...i,
      from: i.from + delta,
      to: i.to + delta,
    })),
    multiplets: s.multiplets.map((m) => ({
      ...m,
      from: m.from + delta,
      to: m.to + delta,
      center: m.center + delta,
    })),
    revision: s.revision + 1,
    history: [
      ...s.history,
      `Alignment · ${delta >= 0 ? "+" : ""}${delta.toFixed(5)} ppm`,
    ],
  };
}
export function strongestPosition(
  s: Spectrum,
  from: number,
  to: number,
): number {
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new Error("Enter finite reference limits.");
  const lo = Math.min(from, to),
    hi = Math.max(from, to),
    bounds = extent(s.data, s.referenceOffset);
  if (lo < bounds[1] || hi > bounds[0] || lo === hi)
    throw new Error(`${s.label}: reference region is outside its spectrum.`);
  let best = -1;
  for (let i = 0; i < s.data.x.length; i++) {
    const x = s.data.x[i] + s.referenceOffset;
    if (x >= lo && x <= hi && (best < 0 || s.data.real[i] > s.data.real[best]))
      best = i;
  }
  if (best < 0) throw new Error("No reference signal found.");
  let x = s.data.x[best] + s.referenceOffset;
  if (best > 0 && best < s.data.real.length - 1) {
    const a = s.data.real[best - 1],
      b = s.data.real[best],
      c = s.data.real[best + 1],
      den = a - 2 * b + c;
    if (den < 0) {
      const d = (0.5 * (a - c)) / den;
      if (Math.abs(d) <= 1) x += d * (s.data.x[best + 1] - s.data.x[best]);
    }
  }
  return Math.max(lo, Math.min(hi, x));
}
export function sharedIntegral(
  s: Spectrum,
  from: number,
  to: number,
  id: string,
  label: string,
): Spectrum {
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new Error("Enter finite integral limits.");
  const b = extent(s.data, s.referenceOffset),
    lo = Math.min(from, to),
    hi = Math.max(from, to);
  if (lo === hi || lo < b[1] || hi > b[0])
    throw new Error(`${s.label}: integral region is outside its spectrum.`);
  return {
    ...s,
    integrals: [
      ...s.integrals,
      {
        id,
        from: hi,
        to: lo,
        area: integrate(s.data, s.referenceOffset, hi, lo),
        label,
      },
    ],
    history: [
      ...s.history,
      `Shared integral · ${hi.toFixed(4)}–${lo.toFixed(4)} ppm`,
    ],
  };
}
