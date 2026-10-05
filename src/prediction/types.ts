export type PredictionNucleus = '1H' | '13C'
export interface PredictionInput {
  molfile?: string
  smiles?: string
  nucleus: PredictionNucleus
  /** Explicit aromatic flags for original zero-based input atom pairs. Valence/H still use molfile bond orders. */
  aromaticBonds?: [number, number][]
  frequencyMHz?: number
  lineWidthHz?: number
}
export interface PredictedAtomShift {
  /** Zero-based original molfile/SMILES atom order. Protons added implicitly refer to their heavy parent. */
  atomIndex: number
  element: 'H' | 'C'
  shiftPpm: number
  /** Number of equivalent attached protons represented by this line, or 1 for carbon/explicit H. */
  hydrogenCount: number
  sampleCount: number
  minPpm: number
  maxPpm: number
  radius: number
  hoseCode: string
}
export interface PredictionResult {
  shifts: PredictedAtomShift[]
  warnings: string[]
  engine: 'cdk-hose-nmrshiftdb'
  dataset: string
  nucleus: PredictionNucleus
  targetAtomCount: number
  missingAtomCount: number
}
export interface PredictionProgress { stage: 'structure' | 'environments' | 'lookup'; completed: number; total: number; message: string }
export interface PredictionOptions { signal?: AbortSignal; onProgress?: (progress: PredictionProgress)=>void }
