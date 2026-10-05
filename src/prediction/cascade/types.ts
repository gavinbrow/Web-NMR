export type CascadeNucleus = '1H' | '13C'
export type CascadeModelId = 'carbon-expnn-ff' | 'proton-dftnn'

export interface CascadeFeatures {
  atomTokens: Record<string, number>
  atomClasses: number
  explicitHs: boolean
  cutoffAngstrom: number
  maxNeighbors: number
  rbfDimension: number
  rbfDelta: number
  rbfMu: number
}
export interface CascadeManifest {
  format: 'cascade-float32-v1'
  id: CascadeModelId
  nucleus: CascadeNucleus
  lineage: string
  source: string
  sourceSha256: string
  upstreamRevision: string
  upstreamRepository: string
  citation: string
  license: string
  weightsFile: string
  weightsSha256: string
  weightsByteLength: number
  features: CascadeFeatures
  activations: Record<string, 'linear' | 'softplus'>
  tensors: { name: string; shape: number[]; byteOffset: number; byteLength: number }[]
}
export interface CascadeConformer {
  coordinates: readonly (readonly number[])[]
  energyKcal: number
}
export interface CascadeInput {
  atomicNumbers: readonly number[]
  conformers: readonly CascadeConformer[]
  nuclei?: readonly CascadeNucleus[]
  temperatureKelvin?: number
}
export interface CascadeAtomShift {
  atomIndex: number
  nucleus: CascadeNucleus
  shiftPpm: number
  conformerStdDevPpm: number
}
export interface CascadeModelMetadata {
  id: CascadeModelId
  nucleus: CascadeNucleus
  lineage: string
  weightsSha256: string
  sourceSha256: string
  upstreamRevision: string
  citation: string
  geometryCaveat?: string
}
export interface CascadePrediction {
  shifts: CascadeAtomShift[]
  conformerWeights: number[]
  conformerCount: number
  temperatureKelvin: number
  models: CascadeModelMetadata[]
  backend: string
}
export interface CascadeOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
  /** Defaults to local /cascade assets; no inference service is contacted. */
  assetBaseUrl?: string
  /** CPU is useful for numerical regression; WASM is preferred in the browser. */
  backend?: 'wasm' | 'cpu' | 'webgl'
}
