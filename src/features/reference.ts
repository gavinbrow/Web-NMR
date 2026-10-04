import type { ComplexData } from "../model";

export interface ReferenceSignal {
  ppm: number;
  value: number;
  index: number;
}
const peakCache = new WeakMap<Float64Array, ReferenceSignal[]>();
const median = (a: number[]) => {
  a.sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] ?? 0;
};
/** Index real extrema once, then snap to the nearest resolved line in the mouse tolerance. */
export function snapReferencePeak(
  data: ComplexData,
  offset: number,
  ppm: number,
  tolerance: number,
  absolute = false,
): ReferenceSignal | undefined {
  if (!Number.isFinite(ppm + offset + tolerance) || tolerance <= 0) return;
  let peaks = peakCache.get(data.real);
  if (!peaks) {
    const y = data.real,
      samples: number[] = [],
      differences: number[] = [];
    let maximum = 0;
    const stride = Math.max(1, Math.floor(y.length / 2048));
    for (let i = 0; i < y.length; i++) {
      maximum = Math.max(maximum, Math.abs(y[i]));
      if (i % stride === 0) {
        samples.push(y[i]);
        if (i) differences.push(Math.abs(y[i] - y[i - 1]));
      }
    }
    const center = median(samples);
    const threshold = Math.max(
      differences.length >= 16 ? (6 * median(differences)) / 0.9539 : 0,
      maximum * 1e-6,
      Number.EPSILON,
    );
    peaks = [];
    for (let i = 1; i < y.length - 1; i++) {
      const sign = y[i] >= center ? 1 : -1;
      if (
        Math.abs(y[i] - center) < threshold ||
        sign * y[i] <= sign * y[i - 1] ||
        sign * y[i] < sign * y[i + 1]
      )
        continue;
      const denominator = y[i - 1] - 2 * y[i] + y[i + 1];
      const fraction = denominator
        ? (0.5 * (y[i - 1] - y[i + 1])) / denominator
        : 0;
      const correction = Math.abs(fraction) <= 0.5 ? fraction : 0;
      peaks.push({
        ppm: data.x[i] + correction * (data.x[i + 1] - data.x[i]),
        value: y[i] - 0.25 * (y[i - 1] - y[i + 1]) * correction,
        index: i,
      });
    }
    peaks.sort((a, b) => a.ppm - b.ppm);
    peakCache.set(data.real, peaks);
  }
  const desired = ppm - offset;
  let left = 0,
    right = peaks.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (peaks[middle].ppm < desired - tolerance) left = middle + 1;
    else right = middle;
  }
  let best: ReferenceSignal | undefined;
  let distance = tolerance;
  for (
    let i = left;
    i < peaks.length && peaks[i].ppm <= desired + tolerance;
    i++
  ) {
    const p = peaks[i],
      d = Math.abs(p.ppm - desired);
    if ((absolute || p.value > 0) && d <= distance) {
      best = p;
      distance = d;
    }
  }
  return best ? { ...best, ppm: best.ppm + offset } : undefined;
}

export interface SolventReference {
  id: string;
  name: string;
  formula: string;
  h: number[];
  c: number[];
  note?: string;
}
// Residual solvent lines, not the shifts of impurities dissolved in a different solvent.
// Fulmer et al., Organometallics 2010, doi:10.1021/om100106e, Tables 1/2;
// additional deuterated solvents: MilliporeSigma NMR solvent reference chart.
export const solventReferences: SolventReference[] = [
  { id: "dmso", name: "DMSO", formula: "DMSO-d₆", h: [2.5], c: [39.52] },
  {
    id: "chloroform",
    name: "Chloroform",
    formula: "CDCl₃",
    h: [7.26],
    c: [77.16],
  },
  { id: "tms", name: "TMS", formula: "Tetramethylsilane", h: [0], c: [0] },
  {
    id: "water",
    name: "D₂O",
    formula: "Residual HDO",
    h: [4.79],
    c: [],
    note: "HDO near 25 °C; temperature and conditions change its shift. No carbon solvent line.",
  },
  ...(
    [
      {
        id: "dioxane",
        name: "1,4-Dioxane",
        formula: "1,4-Dioxane-d₈",
        h: [3.53],
        c: [66.5],
      },
      {
        id: "acetic",
        name: "Acetic acid",
        formula: "Acetic acid-d₄",
        h: [2.03, 11.53],
        c: [20.0, 178.4],
      },
      {
        id: "acetone",
        name: "Acetone",
        formula: "Acetone-d₆",
        h: [2.05],
        c: [29.84, 206.26],
      },
      {
        id: "acetonitrile",
        name: "Acetonitrile",
        formula: "CD₃CN",
        h: [1.94],
        c: [1.32, 118.26],
      },
      {
        id: "benzene",
        name: "Benzene",
        formula: "Benzene-d₆",
        h: [7.16],
        c: [128.06],
      },
      {
        id: "chlorobenzene",
        name: "Chlorobenzene",
        formula: "Chlorobenzene-d₅",
        h: [6.96, 6.97, 6.99, 7.14],
        c: [125.96, 128.25, 129.26, 134.19],
      },
      {
        id: "cyclohexane",
        name: "Cyclohexane",
        formula: "Cyclohexane-d₁₂",
        h: [1.38],
        c: [26.4],
      },
      {
        id: "dcm",
        name: "Dichloromethane",
        formula: "CD₂Cl₂",
        h: [5.32],
        c: [53.84],
      },
      {
        id: "dmf",
        name: "Dimethylformamide",
        formula: "DMF-d₇",
        h: [2.74, 2.91, 8.01],
        c: [30.1, 35.2, 162.7],
      },
      {
        id: "dss",
        name: "DSS",
        formula: "Aqueous internal standard",
        h: [0],
        c: [],
        note: "Proton internal standard at 0 ppm.",
      },
      {
        id: "ethanol",
        name: "Ethanol",
        formula: "Ethanol-d₆",
        h: [1.11, 3.55, 5.19],
        c: [17.2, 56.8],
      },
      {
        id: "methanol",
        name: "Methanol",
        formula: "CD₃OD",
        h: [3.31],
        c: [49.0],
      },
      {
        id: "propanol",
        name: "Propanol (2-)",
        formula: "2-Propanol-d₈",
        h: [3.89, 5.12],
        c: [62.9],
      },
      {
        id: "pyridine",
        name: "Pyridine",
        formula: "Pyridine-d₅",
        h: [7.19, 7.55, 8.71],
        c: [123.5, 135.5, 149.9],
      },
      {
        id: "thf",
        name: "Tetrahydrofuran",
        formula: "THF-d₈",
        h: [1.72, 3.58],
        c: [25.31, 67.21],
      },
      {
        id: "toluene",
        name: "Toluene",
        formula: "Toluene-d₈",
        h: [2.08, 7.01, 7.09],
        c: [20.43, 125.13, 127.96, 128.87, 137.48],
      },
      {
        id: "tfa",
        name: "Trifluoroacetic acid",
        formula: "TFA-d",
        h: [11.5],
        c: [116.6, 164.2],
      },
      {
        id: "tfe",
        name: "Trifluoroethanol (2,2,2-)",
        formula: "TFE-d₃",
        h: [3.88, 5.02],
        c: [61.5, 126.28],
      },
      {
        id: "tsp",
        name: "TSP",
        formula: "Aqueous internal standard",
        h: [0],
        c: [],
        note: "Proton internal standard at 0 ppm.",
      },
    ] satisfies SolventReference[]
  ).sort((a, b) => a.name.localeCompare(b.name)),
];
export function referenceNucleus(nucleus: string): "1H" | "13C" | "other" {
  const n = nucleus.replace(/[\s^{}]/g, "");
  return n === "1H" || n === "H1"
    ? "1H"
    : n === "13C" || n === "C13"
      ? "13C"
      : "other";
}
export function solventShifts(s: SolventReference, nucleus: string): number[] {
  const n = referenceNucleus(nucleus);
  return n === "1H" ? s.h : n === "13C" ? s.c : [];
}
