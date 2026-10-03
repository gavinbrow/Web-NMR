import type { KineticFit, KineticPoint } from "../model";

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
