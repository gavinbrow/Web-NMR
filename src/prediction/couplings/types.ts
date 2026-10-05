export interface CouplingFeatures {
  atomCount: number
  maxAtoms: 64
  atomFeatures: Float32Array
  pairFeatures: Float32Array
  couplingTypes: Int32Array
  atomicNumbers: number[]
  originalAtomIndices: number[]
  hydrogenParents: number[]
}
export interface LearnedPairCoupling {
  /** Atom positions in the explicit-H molecule; never merged by parent atom. */
  atomIndices: [number, number]
  couplingHz: number
  /** Upstream bootstrap-head standard deviation, not an experimental error bar. */
  stdHz: number
  bondDistance: 2 | 3 | 4
}
export interface CouplingManifest {
  format: 'fullsspruce-onnx-chunks-v2'
  id: 'fullsspruce-etkdg-coupling'
  sourceRepository: string
  upstreamRevision: string
  sourceFile: string
  sourceSha256: string
  weightsChunks: { file: string; byteOffset: number; byteLength: number; sha256: string }[]
  weightsSha256: string
  weightsByteLength: number
  citation: string
  maxExplicitAtoms: 64
  inputShapes: { adj: number[]; vect_feat: number[]; coupling_types: number[] }
  outputShapes: { coupling_mu: number[]; coupling_std: number[] }
  trainedTypes: string[]
  uncertainty: string
}
export interface LearnedCouplingPrediction {
  couplings: LearnedPairCoupling[]
  meanMatrixHz: Float32Array
  stdMatrixHz: Float32Array
  atomCount: number
  maxAtoms: 64
  backend: 'wasm'
  metadata: {
    modelId: 'fullsspruce-etkdg-coupling'
    sourceRepository: string
    upstreamRevision: string
    sourceSha256: string
    weightsSha256: string
    citation: string
    uncertainty: string
    trainedTypes: string[]
    excludedProtonPairs: number
    warnings: string[]
  }
}
export interface LearnedCouplingOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
  assetBaseUrl?: string
}
