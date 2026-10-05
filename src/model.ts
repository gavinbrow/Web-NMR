import type { SpectrumProperties } from "./features/appearance";
import type {
  PredictionSetup,
  SpectrumMolecule,
} from "./features/predictionSetup";
import type { PredictionResult } from "./prediction/types";
export type Tab =
  | "File"
  | "Home"
  | "Processing"
  | "Analysis"
  | "Stack"
  | "Kinetics"
  | "Prediction"
  | "Export";
export type Tool =
  | "select"
  | "zoom"
  | "pan"
  | "reference"
  | "peak"
  | "integral"
  | "multiplet"
  | "baseline";
export interface ComplexData {
  x: Float64Array;
  real: Float64Array;
  imag?: Float64Array;
}
export interface FidData {
  real: Float64Array;
  imag: Float64Array;
  dwellSeconds: number;
  groupDelay: number;
  carrierPpm: number;
  spectralWidthHz: number;
}
export interface BaselineAnchor {
  ppm: number;
  value: number;
}
export type BaselineMethod =
  | "polynomial"
  | "bernstein"
  | "whittaker"
  | "ablative"
  | "splines"
  | "pcbc"
  | "arpls"
  | "snip"
  | "apbk";
export type ManualBaselineMethod =
  "segments" | "splines" | "polynomial" | "whittaker";
export interface ProcessingRecipe {
  transform: boolean;
  digitalFilter: boolean;
  window: "none" | "exponential" | "gaussian" | "sinebell";
  lbHz: number;
  gaussianHz: number;
  zeroFill: number;
  ph0: number;
  ph1: number;
  pivotPpm: number;
  baseline: "none" | "auto" | "manual";
  baselineAnchors: BaselineAnchor[];
  /** Optional fields preserve numerical replay for older project archives. */
  baselineMethod?: BaselineMethod;
  manualBaselineMethod?: ManualBaselineMethod;
  baselineOrder?: number;
  baselineMedianWindow?: number;
  /** log10(lambda) on the reduced baseline-estimation grid. */
  baselineSmoothness?: number;
  baselineIterations?: number;
  baselineSnipWindow?: number;
  baselineRatio?: number;
  /** Regions and excluded regions are expressed in referenced ppm. */
  baselineRegion?: [number, number];
  baselineExcludedRegions?: [number, number][];
}
export const defaultRecipe = (): ProcessingRecipe => ({
  transform: false,
  digitalFilter: true,
  window: "exponential",
  lbHz: 0.3,
  gaussianHz: 1,
  zeroFill: 2,
  ph0: 0,
  ph1: 0,
  pivotPpm: 0,
  baseline: "none",
  baselineAnchors: [],
  baselineMethod: "bernstein",
  manualBaselineMethod: "segments",
  baselineOrder: 3,
  baselineMedianWindow: 9,
  baselineSmoothness: 6,
  baselineIterations: 20,
  baselineSnipWindow: 40,
  baselineRatio: 1e-6,
});
export interface Peak {
  id: string;
  ppm: number;
  height: number;
  label?: string;
}
export interface Integral {
  id: string;
  from: number;
  to: number;
  area: number;
  label: string;
  /** Exact nucleus count from the synthesized model, separate from a measured finite-window area.
   * Cleared when the data/limits are edited or the user chooses a measured normalization. */
  predicted?: { nucleusCount: number; atomIds: string[] };
  /** Saved Mnova values use its own integration convention, separately from our signed ppm areas. */
  imported?: {
    source: "Mnova";
    normalizedValue: number;
    rawArea: number;
    referenceArea: number;
  };
}
export interface Multiplet {
  id: string;
  from: number;
  to: number;
  center: number;
  kind: string;
  couplingsHz: number[];
  peakCount: number;
  label: string;
  imported?: {
    source: "Mnova";
    normalizedValue: number;
    rawArea: number;
    referenceArea: number;
    nuclideCount: number;
  };
}
export interface TwoDSpectrum {
  /** F2 columns and F1 rows; both axes descend in ppm. */
  x: Float64Array;
  y: Float64Array;
  /** Row-major matrix: real[rowF1 * width + columnF2]. */
  real: Float64Array;
  width: number;
  height: number;
  nucleusF1: string;
  frequencyF1: number;
  referenceOffsetF1: number;
  imagF2?: Float64Array;
  imagF1?: Float64Array;
  imagBoth?: Float64Array;
  experiment: string;
  source:
    | "Bruker processed 2D"
    | "Mnova native processed 2D"
    | "Bruker raw 2D magnitude"
    | "Bruker raw 2D absorption";
  mode: "absorption" | "magnitude";
  acquisitionMode?: "States" | "States-TPPI" | "Echo-Antiecho" | "QF";
}
export interface TwoDRawData {
  real: Float64Array;
  imag: Float64Array;
  width: number;
  height: number;
  acquisitionMode: "States" | "States-TPPI" | "Echo-Antiecho" | "QF";
  dwellSecondsF2: number;
  dwellSecondsF1: number;
  spectralWidthHzF2: number;
  spectralWidthHzF1: number;
  carrierPpmF2: number;
  carrierPpmF1: number;
  groupDelay: number;
  nucleusF1: string;
  frequencyF1: number;
  experiment: string;
}
export interface TwoDProcessingRecipe {
  source?: "processed" | "mnova-source";
  echoAntiEchoOrder?: "echo-first" | "antiecho-first";
  transform: boolean;
  digitalFilter: boolean;
  magnitude: boolean;
  reconstructImaginary: boolean;
  f2: ProcessingRecipe;
  f1: ProcessingRecipe;
  baselinePoints?: { xPpm: number; yPpm: number; value: number }[];
}
export interface TwoDView {
  /** Referenced ppm ranges, always [higher, lower]; F1 increases toward the bottom. */
  xView: [number, number];
  yView: [number, number];
  threshold: number;
  negative: boolean;
  topGain: number;
  leftGain: number;
  topSpectrumId?: string;
  leftSpectrumId?: string;
}
export interface Spectrum {
  prediction?: PredictionResult;
  molecule?: SpectrumMolecule;
  /** Saved individual document frame, in referenced ppm. */
  savedView?: [number, number];
  twoD?: TwoDSpectrum;
  twoDOriginal?: TwoDSpectrum;
  /** Separate saved source; never mixes source quadrature with corrected output. */
  nativeSource2D?: TwoDSpectrum;
  twoDRaw?: TwoDRawData;
  twoDRecipe?: TwoDProcessingRecipe;
  twoDView?: TwoDView;
  properties?: SpectrumProperties;
  id: string;
  label: string;
  color: string;
  nucleus: string;
  frequencyMHz: number;
  sourceFormat: string;
  metadata: Record<string, string | number>;
  original: ComplexData;
  fid?: FidData;
  data: ComplexData;
  recipe: ProcessingRecipe;
  referenceOffset: number;
  peaks: Peak[];
  integrals: Integral[];
  multiplets: Multiplet[];
  integralScale: number;
  integralCalibration?: {
    anchorId: string;
    target: number;
    tentative?: boolean;
  };
  gain: number;
  visible: boolean;
  timeMinutes?: number;
  history: string[];
  revision: number;
}
export interface ImportEntry {
  path: string;
  data: ArrayBuffer;
}
export interface ImportResult {
  spectra: Spectrum[];
  warnings: string[];
  stacks?: SpectrumStack[];
  view?: [number, number];
  projectName?: string;
}
export interface KineticTarget {
  id: string;
  label: string;
  color: string;
  from: number;
  to: number;
  protons: number;
  model: KineticFit["model"];
}
export interface KineticsConfiguration {
  targets: KineticTarget[];
  activeTargetId: string;
  mode: "area" | "ratio" | "concentration";
  standardFrom: number;
  standardTo: number;
  standardProtons: number;
  standardConcentration: number;
  concentrationUnit: string;
  excludedIds: string[];
  view: "curve" | "spectra";
  fitEnabled?: boolean;
  seriesSpectrumIds?: string[];
  seriesSource?: "document" | "custom";
  timeFill?: {
    pattern: "doubling" | "linear" | "custom";
    start: number;
    step: number;
    includeZero: boolean;
    custom: string;
  };
}
export interface Project {
  prediction?: PredictionSetup;
  /** Original document is retained losslessly alongside the editable browser data. */
  originalMnova?: { name: string; bytes: Uint8Array; importNotes: string[] };
  kinetics?: KineticsConfiguration;
  stacks?: SpectrumStack[];
  activeStackId?: string | null;
  properties?: SpectrumProperties;
  version: 1;
  name: string;
  spectra: Spectrum[];
  activeId: string | null;
  view: [number, number] | null;
  displayMode: "single" | "stack" | "overlay";
  normalization: "none" | "maximum" | "area";
  savedAt: string;
}
export interface SpectrumStack {
  id: string;
  label: string;
  spectrumIds: string[];
  referenceId?: string;
}
export interface KineticPoint {
  id: string;
  time: number;
  value: number;
  included: boolean;
}
export interface KineticFit {
  model: "decay" | "growth" | "linear";
  parameters: Record<string, number>;
  predicted: number[];
  residuals: number[];
  rSquared: number;
  rmse: number;
  halfLife?: number;
}
export const colors = [
  "#ba3349",
  "#267c87",
  "#7863ac",
  "#d18835",
  "#4575ad",
  "#7c9454",
  "#bc6584",
  "#655b4e",
];
export function uid(): string {
  return crypto.randomUUID();
}
export function extent(data: ComplexData, offset = 0): [number, number] {
  return [
    Math.max(data.x[0], data.x[data.x.length - 1]) + offset,
    Math.min(data.x[0], data.x[data.x.length - 1]) + offset,
  ];
}
