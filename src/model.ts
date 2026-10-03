import type { SpectrumProperties } from "./features/appearance";
export type Tab =
  "File" | "Home" | "Processing" | "Analysis" | "Stack" | "Kinetics" | "Export";
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
}
export interface Integral {
  id: string;
  from: number;
  to: number;
  area: number;
  label: string;
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
}
export interface Spectrum {
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
}
export interface Project {
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
