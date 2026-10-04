import type {
  KineticFit,
  KineticPoint,
  Spectrum,
  KineticTarget,
} from "../model";
import { integrate } from "../core/numerics";

export interface KineticsMeasurementOptions {
  from: number;
  to: number;
  mode: "area" | "ratio" | "concentration";
  standardFrom?: number;
  standardTo?: number;
  targetProtons?: number;
  standardProtons?: number;
  standardConcentration?: number;
  concentrationUnit?: string;
  excludedIds?: string[];
  spectrumIds?: string[];
  nucleus?: string;
}
export interface KineticMeasurement {
  id: string;
  label: string;
  time?: number;
  targetArea?: number;
  standardArea?: number;
  value?: number;
  included: boolean;
  error?: string;
  mode: KineticsMeasurementOptions["mode"];
  unit: string;
}
const validNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** Measures real, processed data. Neither display gains nor reporting normalization are read. */
export function measureKinetics(
  spectra: Spectrum[],
  options: KineticsMeasurementOptions,
): KineticMeasurement[] {
  const mode = options.mode;
  const unit =
    mode === "area"
      ? "intensity·ppm"
      : mode === "ratio"
        ? "ratio"
        : options.concentrationUnit || "mM";
  const targetProtons = options.targetProtons ?? 1,
    standardProtons = options.standardProtons ?? 1;
  const protonFactor = standardProtons / targetProtons;
  let settingsError: string | undefined;
  if (!["area", "ratio", "concentration"].includes(mode))
    settingsError = "Choose an analytical measurement mode.";
  if (
    !validNumber(options.from) ||
    !validNumber(options.to) ||
    options.from === options.to
  )
    settingsError = "Set two different finite target region limits.";
  if (mode !== "area") {
    if (
      !validNumber(options.standardFrom) ||
      !validNumber(options.standardTo) ||
      options.standardFrom === options.standardTo
    )
      settingsError =
        "Set two different finite internal standard region limits.";
    else if (
      Math.max(
        Math.min(options.from, options.to),
        Math.min(options.standardFrom, options.standardTo),
      ) <
      Math.min(
        Math.max(options.from, options.to),
        Math.max(options.standardFrom, options.standardTo),
      )
    )
      settingsError = "Target and internal standard regions must not overlap.";
    if (
      !validNumber(targetProtons) ||
      !validNumber(standardProtons) ||
      targetProtons <= 0 ||
      standardProtons <= 0
    )
      settingsError = "Signal proton counts must be positive.";
    if (
      mode === "concentration" &&
      (!validNumber(options.standardConcentration) ||
        options.standardConcentration <= 0)
    )
      settingsError = "Enter a positive known internal standard concentration.";
  }
  const membership = options.spectrumIds ? new Set(options.spectrumIds) : null,
    excluded = new Set(options.excludedIds ?? []);
  return spectra
    .filter((s) => !membership || membership.has(s.id))
    .map((s) => {
      const row: KineticMeasurement = {
        id: s.id,
        label: s.label,
        time: s.timeMinutes,
        included: !excluded.has(s.id),
        mode,
        unit,
      };
      const fail = (error: string) => ({
        ...row,
        value: undefined,
        included: false,
        error,
      });
      if (settingsError) return fail(settingsError);
      if (options.nucleus && s.nucleus !== options.nucleus)
        return fail(
          `This spectrum is ${s.nucleus}; the series uses ${options.nucleus}.`,
        );
      const { x, real } = s.data;
      if (x.length < 2 || real.length !== x.length)
        return fail("Spectrum data are incomplete.");
      const min = Math.min(x[0], x[x.length - 1]) + s.referenceOffset,
        max = Math.max(x[0], x[x.length - 1]) + s.referenceOffset;
      const tolerance = Math.max(1, Math.abs(max), Math.abs(min)) * 1e-10;
      const contains = (a: number, b: number) =>
        Math.min(a, b) >= min - tolerance && Math.max(a, b) <= max + tolerance;
      if (!contains(options.from, options.to))
        return fail("Target region extends outside this spectrum.");
      row.targetArea = integrate(
        s.data,
        s.referenceOffset,
        options.from,
        options.to,
      );
      if (!validNumber(row.targetArea))
        return fail("Target area is not finite.");
      row.value = row.targetArea;
      if (mode !== "area") {
        if (!contains(options.standardFrom!, options.standardTo!))
          return fail(
            "Internal standard region extends outside this spectrum.",
          );
        row.standardArea = integrate(
          s.data,
          s.referenceOffset,
          options.standardFrom!,
          options.standardTo!,
        );
        // Scale-aware cancellation check: arbitrary intensity units may be very small.
        let absoluteArea = 0;
        for (let i = 1; i < x.length; i++)
          absoluteArea +=
            ((Math.abs(real[i - 1]) + Math.abs(real[i])) *
              Math.abs(x[i] - x[i - 1])) /
            2;
        const minimumStandard = Math.max(
          absoluteArea * 1e-12,
          Number.MIN_VALUE,
        );
        if (
          !validNumber(row.standardArea) ||
          row.standardArea <= minimumStandard
        )
          return fail(
            "Internal standard area is zero, negative, or too small. Check phase, baseline, and region limits.",
          );
        row.value = (row.targetArea / row.standardArea) * protonFactor;
        if (mode === "concentration")
          row.value *= options.standardConcentration!;
        if (!validNumber(row.value))
          return fail("The normalized measurement is not finite.");
      }
      if (!validNumber(row.time))
        return fail(
          "Set an acquisition time to include this spectrum in kinetics.",
        );
      return row;
    });
}

/** Stable ID join; invalid rows remain in the report but cannot become fit observations. */
export function kineticsPoints(rows: KineticMeasurement[]): KineticPoint[] {
  return rows
    .filter((r) => !r.error && validNumber(r.time) && validNumber(r.value))
    .map((r) => ({
      id: r.id,
      time: r.time!,
      value: r.value!,
      included: r.included,
    }))
    .sort((a, b) => a.time - b.time);
}

/** Fits analytical measurements. Display gains never enter this calculation. Times are minutes. */
export function fitKinetics(
  points: KineticPoint[],
  model: KineticFit["model"],
): KineticFit {
  const selected = points.filter(
    (p) => p.included && Number.isFinite(p.time) && Number.isFinite(p.value),
  );
  if (!["linear", "decay", "growth"].includes(model))
    throw new Error("Unknown kinetics model.");
  if (selected.length < (model === "linear" ? 2 : 4))
    throw new Error(
      model === "linear"
        ? "Include at least two measurements."
        : "Include at least four measurements for a three-parameter exponential fit.",
    );
  const t0 = Math.min(...selected.map((p) => p.time)),
    span = Math.max(...selected.map((p) => p.time)) - t0;
  if (!(span > 0))
    throw new Error("Measurements must have different acquisition times.");
  const mean = selected.reduce((s, p) => s + p.value, 0) / selected.length;
  const scale = Math.max(...selected.map((p) => Math.abs(p.value - mean)));
  if (!(scale > Number.EPSILON * Math.max(1, Math.abs(mean)) * 10))
    throw new Error(
      "The measurements are constant; a rate cannot be determined.",
    );
  const ts = selected.map((p) => (p.time - t0) / span),
    ys = selected.map((p) => (p.value - mean) / scale);
  const regression = (x: number[]) => {
    const mx = x.reduce((a, b) => a + b, 0) / x.length,
      my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let xx = 0,
      xy = 0;
    for (let i = 0; i < x.length; i++) {
      xx += (x[i] - mx) ** 2;
      xy += (x[i] - mx) * (ys[i] - my);
    }
    if (xx < 1e-24) return { a: 0, b: my, loss: Infinity };
    const a = xy / xx,
      b = my - a * mx;
    return {
      a,
      b,
      loss: ys.reduce((sum, y, i) => sum + (y - (a * x[i] + b)) ** 2, 0),
    };
  };
  let parameters: Record<string, number>,
    predict: (time: number) => number,
    halfLife: number | undefined;
  if (model === "linear") {
    const result = regression(ts),
      slope = (result.a * scale) / span,
      intercept = mean + scale * result.b - slope * t0;
    parameters = { slope, intercept };
    predict = (t) => intercept + slope * t;
  } else {
    // Variable projection: solve amplitude/offset exactly for each candidate rate,
    // then optimize only log(rate). This avoids an ill-conditioned three-way solver.
    const evaluate = (logRate: number) => {
      const rate = Math.exp(logRate),
        result = regression(ts.map((t) => Math.exp(-rate * t)));
      if (
        (model === "decay" && result.a <= 0) ||
        (model === "growth" && result.a >= 0)
      )
        result.loss = Infinity;
      return result;
    };
    const low = -10,
      high = 7,
      step = (high - low) / 160;
    let bestLog = low,
      bestLoss = Infinity;
    for (let log = low; log <= high; log += step) {
      const loss = evaluate(log).loss;
      if (loss < bestLoss) {
        bestLog = log;
        bestLoss = loss;
      }
    }
    if (!Number.isFinite(bestLoss))
      throw new Error(
        `The measurements do not follow an exponential ${model}.`,
      );
    if (bestLog <= low + step || bestLog >= high - step)
      throw new Error(
        "A finite exponential rate could not be resolved. Try a linear fit or acquire a wider time range.",
      );
    let left = bestLog - step,
      right = bestLog + step;
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = right - phi * (right - left),
      d = left + phi * (right - left);
    for (let i = 0; i < 100; i++) {
      if (evaluate(c).loss < evaluate(d).loss) {
        right = d;
        d = c;
        c = right - phi * (right - left);
      } else {
        left = c;
        c = d;
        d = left + phi * (right - left);
      }
    }
    const log = (left + right) / 2,
      rate = Math.exp(log) / span,
      result = evaluate(log);
    const asymptote = mean + scale * result.b,
      coefficient = scale * result.a;
    const amplitude = Math.abs(coefficient),
      offset = model === "decay" ? asymptote : asymptote + coefficient;
    parameters = { offset, amplitude, rate, timeOrigin: t0, asymptote };
    predict = (t) => asymptote + coefficient * Math.exp(-rate * (t - t0));
    halfLife = Math.LN2 / rate;
  }
  const predicted = points.map((p) => predict(p.time)),
    residuals = points.map((p, i) => p.value - predicted[i]);
  const sse = selected.reduce(
      (s, p) => s + (p.value - predict(p.time)) ** 2,
      0,
    ),
    total = selected.reduce((s, p) => s + (p.value - mean) ** 2, 0);
  return {
    model,
    parameters,
    predicted,
    residuals,
    rSquared: 1 - sse / total,
    rmse: Math.sqrt(sse / selected.length),
    ...(halfLife === undefined ? {} : { halfLife }),
  };
}

export interface KineticSeries {
  target: KineticTarget;
  measurements: KineticMeasurement[];
  points: KineticPoint[];
  fit: KineticFit | null;
  error: string;
}
/** Every target uses its own region, proton count, and model against the same standard. */
export function measureKineticTargets(
  spectra: Spectrum[],
  targets: KineticTarget[],
  options: Omit<KineticsMeasurementOptions, "from" | "to" | "targetProtons">,
  fitEnabled = false,
): KineticSeries[] {
  return targets.map((target) => {
    const measurements = measureKinetics(spectra, {
      ...options,
      from: target.from,
      to: target.to,
      targetProtons: target.protons,
    });
    const points = kineticsPoints(measurements);
    let fit: KineticFit | null = null,
      error = "";
    if (fitEnabled) {
      try {
        fit = fitKinetics(points, target.model);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return { target, measurements, points, fit, error };
  });
}
