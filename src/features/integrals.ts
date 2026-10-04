import type { Integral, Spectrum } from "../model";

function nonzeroArea(integrals: Integral[], area: number): boolean {
  const max = integrals.reduce((a, i) => Math.max(a, Math.abs(i.area)), 0);
  return (
    Number.isFinite(area) &&
    Math.abs(area) > Math.max(Number.MIN_VALUE, max * 1e-12)
  );
}
function naturalAnchor(integrals: Integral[]): Integral | undefined {
  return (
    integrals.find((i) => i.area > 0 && nonzeroArea(integrals, i.area)) ??
    integrals.find((i) => nonzeroArea(integrals, i.area))
  );
}
function importedAnchor(
  integrals: Integral[],
  retained = integrals,
): Integral | undefined {
  const candidates = integrals.filter(
    (i) =>
      i.imported &&
      i.imported.normalizedValue > 0 &&
      nonzeroArea(integrals, i.area) &&
      retained.some((a) => a.id === i.id),
  );
  // Prefer the saved unit reference over whichever region appears first.
  return (
    candidates.find((i) => Math.abs(i.imported!.normalizedValue - 1) < 1e-12) ??
    candidates[0]
  );
}
/** Uncalibrated reporting uses a relative first integral. Raw signed areas stay unchanged. */
export function integralReportingScale(s: Spectrum): number {
  if (s.integralCalibration) {
    const anchor = s.integrals.find(
      (i) => i.id === s.integralCalibration!.anchorId,
    );
    if (anchor && nonzeroArea(s.integrals, anchor.area))
      return s.integralCalibration.target / anchor.area;
  } else if (Number.isFinite(s.integralScale) && s.integralScale !== 1)
    return s.integralScale;
  const saved =
    importedAnchor(s.integrals) ??
    s.integrals.find((i) => i.imported && nonzeroArea(s.integrals, i.area));
  if (saved) return saved.imported!.normalizedValue / saved.area;
  const anchor = naturalAnchor(s.integrals);
  return anchor ? 1 / Math.abs(anchor.area) : 0;
}
export function displayedIntegralValue(
  s: Spectrum,
  integral: Integral,
): number {
  return (
    integral.imported?.normalizedValue ??
    integral.area * integralReportingScale(s)
  );
}
/** Preserves calibration by stable integral ID after processing or boundary edits. */
export function recalibrateIntegrals(
  s: Spectrum,
  updated: Integral[],
): Spectrum {
  let calibration = s.integralCalibration;
  const measurementChanged = updated.some((i) => {
    const old = s.integrals.find((a) => a.id === i.id);
    return (
      old?.imported &&
      (i.area !== old.area || i.from !== old.from || i.to !== old.to)
    );
  });
  if (measurementChanged) {
    // Mnova's saved Sum convention is preserved exactly on opening. Once the
    // signal or limits change, measure the corrected browser trace and retain
    // the existing reference target, rather than freezing old measurements.
    const saved = importedAnchor(s.integrals, updated);
    if (!calibration && saved)
      calibration = {
        anchorId: saved.id,
        target: saved.imported!.normalizedValue,
      };
    updated = updated.map((i) => ({ ...i, imported: undefined }));
  }
  // Existing archives recorded only the factor. Adopt their first reference so
  // subsequent changes can preserve the previously reported reference value.
  if (
    !calibration &&
    Number.isFinite(s.integralScale) &&
    s.integralScale !== 1
  ) {
    const oldAnchor = naturalAnchor(s.integrals);
    if (oldAnchor)
      calibration = {
        anchorId: oldAnchor.id,
        target: oldAnchor.area * s.integralScale,
      };
  }
  const anchor = calibration
    ? updated.find((i) => i.id === calibration!.anchorId)
    : undefined;
  if (
    !anchor ||
    !nonzeroArea(updated, anchor.area) ||
    !Number.isFinite(calibration!.target)
  )
    return {
      ...s,
      integrals: updated,
      integralScale: 1,
      integralCalibration: undefined,
    };
  return {
    ...s,
    integrals: updated,
    integralCalibration: calibration,
    integralScale: calibration!.target / anchor.area,
  };
}
export function normalizeIntegral(
  s: Spectrum,
  anchorId: string,
  target: number,
): Spectrum {
  if (!Number.isFinite(target) || target <= 0)
    throw new Error("Enter a positive integral reference value.");
  const anchor = s.integrals.find((i) => i.id === anchorId);
  if (!anchor || !nonzeroArea(s.integrals, anchor.area))
    throw new Error("Choose a nonzero integral to normalize.");
  return {
    ...s,
    integrals: s.integrals.map((i) => ({ ...i, imported: undefined })),
    integralCalibration: { anchorId, target },
    integralScale: target / anchor.area,
    history: [
      ...s.history,
      `Integral reference · ${anchor.label || anchor.id} = ${target}`,
    ],
  };
}
export function removeIntegral(s: Spectrum, id: string): Spectrum {
  return recalibrateIntegrals(
    s,
    s.integrals.filter((i) => i.id !== id),
  );
}
/** Bounded integer-ratio heuristic. It is a tentative report, not a chemical assignment. */
export function autodetectIntegralCounts(s: Spectrum, maxCount = 12): Spectrum {
  if (!Number.isFinite(maxCount) || maxCount < 1)
    throw new Error("Enter a positive maximum nuclide count.");
  maxCount = Math.min(100, Math.floor(maxCount));
  const positive = s.integrals.filter(
    (i) => i.area > 0 && nonzeroArea(s.integrals, i.area),
  );
  if (!positive.length)
    throw new Error(
      "Create positive nonzero integrals before detecting counts.",
    );
  const anchor = positive.reduce((a, i) => (i.area < a.area ? i : a));
  let bestCount = 1,
    bestScore = Infinity;
  for (let count = 1; count <= maxCount; count++) {
    const values = positive.map((i) => (i.area / anchor.area) * count);
    if (values.some((v) => v > maxCount + 0.35)) continue;
    const score =
      values.reduce((sum, v) => sum + (v - Math.round(v)) ** 2, 0) /
        values.length +
      (values.reduce((sum, v) => sum + v, 0) / values.length) * 0.001;
    if (score < bestScore) {
      bestScore = score;
      bestCount = count;
    }
  }
  if (!Number.isFinite(bestScore))
    throw new Error(
      "Integral ratios exceed the maximum count. Review or separate the regions.",
    );
  const result = normalizeIntegral(s, anchor.id, bestCount);
  return {
    ...result,
    integralCalibration: { ...result.integralCalibration!, tentative: true },
    history: [
      ...s.history,
      `Tentative nuclide counts · integer-ratio heuristic, maximum ${maxCount}; review manually`,
    ],
  };
}
