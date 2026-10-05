import { colors } from "../model";
import type { Spectrum, TwoDSpectrum } from "../model";
import type { MoleculeDocument } from "./molecule";
import type { PredictionSetup } from "./predictionSetup";
import type { PredictedTwoD, PredictionResult } from "../prediction/types";
import { predictedSpectrum } from "./predictedSpectrum";

export const MAX_PREDICTED_2D_ELEMENTS = 1024 * 1024;
export interface TwoDMapOptions {
  size?: number;
  profile?: "gaussian" | "lorentzian" | "voigt";
}
/** Finite, descending, absorption-like correlation map; no time-domain experiment. */
export function renderTwoDCorrelationMap(
  prediction: PredictedTwoD,
  options: TwoDMapOptions = {},
): {
  twoD: TwoDSpectrum;
  renderedLineWidthHzF2: number;
  renderedLineWidthHzF1: number;
  warnings: string[];
} {
  const size = options.size ?? 1024,
    profile = options.profile ?? "voigt";
  if (
    !Number.isInteger(size) ||
    size < 32 ||
    size * size > MAX_PREDICTED_2D_ELEMENTS ||
    !["gaussian", "lorentzian", "voigt"].includes(profile)
  )
    throw Error(
      "Predicted 2D grid must have 32–1024 points per axis and a supported line profile.",
    );
  const { correlations, settings, experiment } = prediction;
  if (
    !["HSQC", "COSY"].includes(experiment) ||
    !correlations.length ||
    correlations.length > 10000 ||
    !correlations.every(
      (c) =>
        [c.xPpm, c.yPpm, c.weight].every(Number.isFinite) &&
        Math.abs(c.xPpm) <= 1000 &&
        Math.abs(c.yPpm) <= 10000 &&
        c.weight > 0 &&
        [1, -1].includes(c.sign),
    )
  )
    throw Error("Invalid or excessively large 2D prediction correlation list.");
  const frequencyF2 = settings.protonFrequencyMHz,
    frequencyF1 =
      experiment === "HSQC" ? settings.carbonFrequencyMHz : frequencyF2;
  if (
    ![frequencyF2, frequencyF1, settings.lineWidthHz].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw Error("Invalid predicted 2D frequency or linewidth.");
  const bounds = (values: number[], carbon: boolean): [number, number] => [
    Math.max(carbon ? 240 : 14, ...values.map((v) => v + 1)),
    Math.min(carbon ? -20 : -2, ...values.map((v) => v - 1)),
  ];
  const xBounds = bounds(
    correlations.map((c) => c.xPpm),
    false,
  );
  const yBounds =
    experiment === "COSY"
      ? ([...xBounds] as [number, number])
      : bounds(
          correlations.map((c) => c.yPpm),
          true,
        );
  const axis = ([high, low]: [number, number]) =>
    Float64Array.from(
      { length: size },
      (_, i) => high - ((high - low) * i) / (size - 1),
    );
  const x = axis(xBounds),
    y = axis(yBounds);
  const stepX = (xBounds[0] - xBounds[1]) / (size - 1),
    stepY = (yBounds[0] - yBounds[1]) / (size - 1);
  const fwhmX = Math.max(settings.lineWidthHz / frequencyF2, 3 * stepX),
    fwhmY = Math.max(settings.lineWidthHz / frequencyF1, 3 * stepY);
  const kernel = (
    axis: Float64Array,
    center: number,
    fwhm: number,
    step: number,
  ) => {
    const position = (axis[0] - center) / step,
      radius = Math.ceil((8 * fwhm) / step);
    const points: { i: number; value: number }[] = [];
    for (
      let i = Math.max(0, Math.floor(position) - radius);
      i <= Math.min(size - 1, Math.ceil(position) + radius);
      i++
    ) {
      const ratio = (axis[i] - center) / fwhm;
      const gaussian = Math.exp(-4 * Math.LN2 * ratio * ratio),
        lorentzian = 1 / (1 + 4 * ratio * ratio);
      points.push({
        i,
        value:
          profile === "gaussian"
            ? gaussian
            : profile === "lorentzian"
              ? lorentzian
              : (gaussian + lorentzian) / 2,
      });
    }
    return points;
  };
  const real = new Float64Array(size * size);
  for (const c of correlations) {
    const kx = kernel(x, c.xPpm, fwhmX, stepX),
      ky = kernel(y, c.yPpm, fwhmY, stepY);
    for (const row of ky)
      for (const column of kx)
        real[row.i * size + column.i] +=
          c.sign * c.weight * row.value * column.value;
  }
  if (!real.every(Number.isFinite))
    throw Error("Predicted 2D map contains non-finite intensities.");
  const renderedLineWidthHzF2 = fwhmX * frequencyF2,
    renderedLineWidthHzF1 = fwhmY * frequencyF1;
  const warnings =
    renderedLineWidthHzF2 > settings.lineWidthHz * 1.001 ||
    renderedLineWidthHzF1 > settings.lineWidthHz * 1.001
      ? [
          `The bounded 2D display grid broadens peaks to ${renderedLineWidthHzF2.toFixed(2)} Hz in F2 and ${renderedLineWidthHzF1.toFixed(2)} Hz in F1. Correlation centers and editing signs are retained; widths and weights are illustrative.`,
        ]
      : [];
  return {
    twoD: {
      x,
      y,
      real,
      width: size,
      height: size,
      nucleusF1: experiment === "HSQC" ? "13C" : "1H",
      frequencyF1,
      referenceOffsetF1: 0,
      experiment,
      source: "Predicted 2D",
      mode: "absorption",
    },
    renderedLineWidthHzF2,
    renderedLineWidthHzF1,
    warnings,
  };
}

/** One document entry with embedded 1D traces; measured traces can override them. */
export function predictedTwoDSpectrum(
  result: PredictionResult,
  setup: PredictionSetup,
  molecule: MoleculeDocument,
  colorIndex = 0,
): Spectrum[] {
  if (!result.twoD || result.nucleus !== "1H")
    throw Error("A proton-based HSQC or COSY prediction is required.");
  const prediction = result.twoD,
    { settings, experiment } = prediction;
  if (
    setup.frequencyMHz !== settings.protonFrequencyMHz ||
    setup.lineWidthHz !== settings.lineWidthHz
  )
    throw Error(
      "Recalculate the 2D prediction after changing field or linewidth.",
    );
  for (const c of prediction.correlations) {
    if (
      molecule.atoms[c.atomIndexX]?.id !== c.atomIdX ||
      molecule.atoms[c.atomIndexY]?.id !== c.atomIdY
    )
      throw Error(
        "2D prediction atom identities do not match the saved molecule.",
      );
  }
  const protonResult = { ...result };
  delete protonResult.twoD;
  const proton = predictedSpectrum(
    protonResult,
    {
      ...setup,
      nucleus: "1H",
      frequencyMHz: settings.protonFrequencyMHz,
      splitting:
        result.spinSystem?.display.mode ??
        (experiment === "HSQC" ? "none" : "first-order"),
    },
    molecule,
    colorIndex,
  );
  const carbon =
    experiment === "HSQC"
      ? predictedSpectrum(
          prediction.carbonResult!,
          {
            ...setup,
            nucleus: "13C",
            frequencyMHz: settings.carbonFrequencyMHz,
            splitting: "none",
          },
          molecule,
          colorIndex,
        )
      : undefined;
  const map = renderTwoDCorrelationMap(prediction);
  const title =
    setup.title.trim() ||
    `Predicted ${experiment} · ${molecule.smiles || "drawn molecule"}`;
  const twoD = map.twoD;
  const viewAround = (
    values: number[],
    full: Float64Array,
    carbon: boolean,
  ): [number, number] => {
    const low = Math.min(...values),
      high = Math.max(...values),
      padding = carbon ? 10 : 0.6;
    const span = Math.max(carbon ? 40 : 4, high - low + 2 * padding),
      center = (high + low) / 2;
    return [
      Math.min(full[0], center + span / 2),
      Math.max(full.at(-1)!, center - span / 2),
    ];
  };
  const xView = viewAround(
    result.shifts.map((s) => s.shiftPpm),
    twoD.x,
    false,
  );
  const yView =
    experiment === "COSY"
      ? ([...xView] as [number, number])
      : viewAround(
          prediction.carbonResult!.shifts.map((s) => s.shiftPpm),
          twoD.y,
          true,
        );
  const spectrum: Spectrum = {
    ...proton,
    label: title.slice(0, 200),
    color: colors[colorIndex % colors.length],
    sourceFormat: "Predicted 2D",
    prediction: {
      ...structuredClone(result),
      warnings: [...new Set([...result.warnings, ...map.warnings])],
      twoD: {
        ...structuredClone(prediction),
        warnings: [...prediction.warnings, ...map.warnings],
      },
    },
    twoD,
    twoDOriginal: {
      ...twoD,
      x: twoD.x.slice(),
      y: twoD.y.slice(),
      real: twoD.real.slice(),
    },
    predictedTraces: { top: proton.data, left: carbon?.data ?? proton.data },
    twoDView: {
      xView,
      yView,
      threshold: 1,
      negative: settings.hsqcEdited && experiment === "HSQC",
      topGain: 1,
      leftGain: 1,
    },
    peaks: [],
    integrals: [],
    multiplets: [],
    integralScale: 1,
    integralCalibration: undefined,
    metadata: {
      title,
      experiment,
      comments: `${result.engine === "cascade" ? "CASCADE local neural shifts" : "CDK local shift estimates"} · ${experiment}.\n${experiment === "HSQC" && settings.hsqcEdited ? "Edited CH₂ phase · " : ""}Illustrative correlation map.`,
      renderedLineWidthHzF2: map.renderedLineWidthHzF2,
      renderedLineWidthHzF1: map.renderedLineWidthHzF1,
    },
    history: [
      ...proton.history,
      `${experiment} atom-linked correlation prediction; approximate transfer weights and line shapes`,
    ],
    molecule: {
      ...proton.molecule!,
      assignments: prediction.correlations.map((c) => ({
        id: c.id,
        ppm: c.xPpm,
        ppmF1: c.yPpm,
        atomIds: [...new Set([c.atomIdX, c.atomIdY])],
        label: [
          c.protonLabelX ??
            `${molecule.atoms[c.atomIndexX].element}${molecule.atoms[c.atomIndexX].index}`,
          c.protonLabelY ??
            `${molecule.atoms[c.atomIndexY].element}${molecule.atoms[c.atomIndexY].index}`,
        ].join(" ↔ "),
      })),
    },
  };
  return [spectrum];
}
