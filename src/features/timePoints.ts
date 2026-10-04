import type { KineticsConfiguration } from "../model";
export type TimeFill = NonNullable<KineticsConfiguration["timeFill"]>;
export const defaultTimeFill = (): TimeFill => ({
  pattern: "doubling",
  start: 1,
  step: 1,
  includeZero: false,
  custom: "",
});
/** Returns times in the visible spectrum order, with no implicit sorting by existing time. */
export function generateTimePoints(
  count: number,
  settings: TimeFill,
): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error("Choose a series containing 1–200 spectra.");
  if (settings.pattern === "custom") {
    const values = settings.custom
      .trim()
      .split(/[,;\s]+/)
      .map(Number);
    if (
      !settings.custom.trim() ||
      values.length !== count ||
      values.some((n) => !Number.isFinite(n) || n < 0)
    )
      throw new Error(`Enter ${count} nonnegative times, separated by commas.`);
    return values;
  }
  if (
    !Number.isFinite(settings.start) ||
    settings.start < 0 ||
    !Number.isFinite(settings.step) ||
    settings.step <= 0 ||
    (settings.pattern === "doubling" && settings.start <= 0)
  )
    throw new Error("Use a positive interval and a valid starting time.");
  const values = Array.from({ length: count }, (_, i) =>
    settings.pattern === "linear"
      ? settings.start + i * settings.step
      : settings.includeZero && i === 0
        ? 0
        : settings.start * 2 ** (i - (settings.includeZero ? 1 : 0)),
  );
  if (values.some((n) => !Number.isFinite(n) || n > 1e12))
    throw new Error(
      "The generated time series is too long. Use a shorter interval or custom times.",
    );
  return values;
}
