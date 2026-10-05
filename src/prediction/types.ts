export type PredictionNucleus = "1H" | "13C";
export interface PredictionInput {
  engine?: "cdk-hose-nmrshiftdb" | "cascade";
  numConformers?: number;
  splitting?: "none" | "first-order" | "spin-system";
  spinCouplingOverrides?: SpinCouplingOverride[];
  molfile?: string;
  smiles?: string;
  nucleus: PredictionNucleus;
  /** Explicit aromatic flags for original zero-based input atom pairs. Valence/H still use molfile bond orders. */
  aromaticBonds?: [number, number][];
  frequencyMHz?: number;
  lineWidthHz?: number;
}
export interface PredictedAtomShift {
  explicitAtomIndex?: number;
  /** Stable explicit-H site identities when a stereochemical model is used. */
  hydrogenOrdinal?: number;
  atomLabel?: string;
  conformerStdDevPpm?: number;
  /** Zero-based original molfile/SMILES atom order. Protons added implicitly refer to their heavy parent. */
  atomIndex: number;
  element: "H" | "C";
  shiftPpm: number;
  /** Number of equivalent attached protons represented by this line, or 1 for carbon/explicit H. */
  hydrogenCount: number;
  sampleCount: number;
  minPpm: number;
  maxPpm: number;
  radius: number;
  hoseCode: string;
}
export interface PredictionResult {
  shifts: PredictedAtomShift[];
  warnings: string[];
  engine: "cdk-hose-nmrshiftdb" | "cascade";
  dataset: string;
  nucleus: PredictionNucleus;
  targetAtomCount: number;
  missingAtomCount: number;
  /** Separate from database chemical shifts: editable, approximate first-order display. */
  splitting?: PredictionSplitting;
  spinSystem?: PredictedSpinSystem;
  /** Atom-linked approximate correlation map, not a pulse-sequence simulation. */
  twoD?: PredictedTwoD;
  cascade?: {
    modelId: string;
    weightsSha256: string;
    sourceSha256: string;
    conformerCount: number;
    conformerWeights: number[];
    temperatureKelvin: number;
    backend: string;
    rdkitVersion: string;
    geometryMethod: string;
    lineage: string;
  };
}
export interface PredictedTwoDCorrelation {
  id: string;
  kind: "direct" | "diagonal" | "cross";
  xPpm: number;
  yPpm: number;
  /** Original zero-based drawing/input atom positions, never RDKit-added H indices. */
  atomIndexX: number;
  atomIndexY: number;
  atomIdX: string;
  atomIdY: string;
  siteIdX?: string;
  siteIdY?: string;
  protonLabelX?: string;
  protonLabelY?: string;
  /** Positive illustrative transfer weight, separate from the editing phase. */
  weight: number;
  sign: 1 | -1;
  /** Signed scalar J; sign is not used as a COSY peak phase. */
  jHz?: number;
  source?: "fullsspruce" | "estimate" | "manual";
}
export interface PredictedTwoD {
  experiment: "HSQC" | "COSY";
  correlations: PredictedTwoDCorrelation[];
  carbonResult?: PredictionResult;
  settings: {
    hsqcEdited: boolean;
    cosyMinJHz: number;
    protonFrequencyMHz: number;
    carbonFrequencyMHz: number;
    lineWidthHz: number;
  };
  warnings: string[];
}
export interface PredictedCoupling {
  atomIndexA: number;
  atomIndexB: number;
  hydrogensA: number;
  hydrogensB: number;
  jHz: number;
  source: "estimate" | "manual";
  rule: string;
}
export interface PredictedSignal {
  atomIndex: number;
  shiftPpm: number;
  hydrogenCount: number;
  kind: string;
  lineCount: number;
  couplingsHz: number[];
}
export interface PredictionSplitting {
  mode: "none" | "first-order" | "spin-system";
  couplings: PredictedCoupling[];
  signals: PredictedSignal[];
  warnings: string[];
  renderedLineWidthHz: number;
}
export interface SpinCouplingOverride {
  /** RDKit explicit-H indices. Reset when the molecule changes. Zero removes J. */
  atomIndexA: number;
  atomIndexB: number;
  jHz: number;
}
export interface PredictedSpinSite {
  id: string;
  explicitAtomIndex: number;
  atomIndex: number;
  hydrogenOrdinal: number;
  atomLabel: string;
  shiftPpm: number;
  equivalenceKey: string;
  exchangeable: boolean;
}
export interface PredictedSpinCoupling {
  siteIdA: string;
  siteIdB: string;
  jHz: number;
  predictedJHz: number;
  /** Two-site isotope replacement class; separate from chemical equivalence. */
  equivalenceKey?: string;
  modelStdHz: number;
  bondDistance: 2 | 3 | 4;
  source: "fullsspruce" | "manual";
}
export interface PredictedSpinSystem {
  sites: PredictedSpinSite[];
  couplings: PredictedSpinCoupling[];
  model: {
    modelId: string;
    weightsSha256: string;
    sourceSha256: string;
    upstreamRevision: string;
    citation: string;
    rdkitVersion: string;
    excludedProtonPairs: number;
  };
  display: {
    mode: "none" | "first-order" | "spin-system";
    frequencyMHz: number;
    clusters: { siteIds: string[]; lines: { ppm: number; weight: number }[] }[];
    warnings: string[];
  };
}
export interface PredictionProgress {
  stage: "structure" | "environments" | "lookup" | "conformers" | "inference";
  completed: number;
  total: number;
  message: string;
}
export interface PredictionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PredictionProgress) => void;
}
