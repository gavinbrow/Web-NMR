import type { CouplingFeatures, CouplingManifest, LearnedCouplingOptions, LearnedCouplingPrediction } from './types'
import type * as Ort from 'onnxruntime-web/wasm'

const MODEL_SHA256 = '58b7f73427439c05fdd4c9689801bb2fe2d34ac960f818ebba122f731a0d91f4'
const SOURCE_SHA256 = '0a847ed10df34094fd3b052ae5e74428c85be38f244aeb0941e2e87dc73f09d3'
const MODEL_ID = 'fullsspruce-etkdg-coupling'
interface LoadedSession { session: Ort.InferenceSession; manifest: CouplingManifest; ort: typeof Ort }
const sessions = new Map<string, Promise<LoadedSession>>()

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Learned coupling prediction canceled.', 'AbortError')
}
function baseUrl(options: LearnedCouplingOptions): string {
  return (options.assetBaseUrl ?? `${import.meta.env.BASE_URL}prediction/couplings/`).replace(/\/?$/, '/')
}
export function validateCouplingFeatures(features: CouplingFeatures): void {
  if (!Number.isInteger(features.atomCount) || features.atomCount < 1 || features.atomCount > 64 || features.maxAtoms !== 64) throw new Error('The learned FullSSPrUCe coupling model supports at most 64 explicit atoms, including hydrogens.')
  if (features.atomFeatures.length !== 64 * 94 || features.pairFeatures.length !== 119 * 64 * 64 || features.couplingTypes.length !== 64 * 64) throw new Error('Learned coupling feature dimensions do not match the trained model.')
  if (features.atomicNumbers.length !== features.atomCount || features.originalAtomIndices.length !== features.atomCount || features.hydrogenParents.length !== features.atomCount) throw new Error('Learned coupling atom identities are incomplete.')
  if (features.atomFeatures.some((x) => !Number.isFinite(x)) || features.pairFeatures.some((x) => !Number.isFinite(x))) throw new Error('Learned coupling inputs contain non-finite features.')
  if (features.couplingTypes.some((x) => x < -2 || x > 11)) throw new Error('Learned coupling type codes are outside the upstream model vocabulary.')
}
async function loadSession(options: LearnedCouplingOptions): Promise<LoadedSession> {
  const base = baseUrl(options)
  if (!sessions.has(base)) {
    const promise = (async () => {
      options.onProgress?.('Loading the local learned J-coupling neural network…')
      const [ort, modelResponse, manifestResponse] = await Promise.all([
        import('onnxruntime-web/wasm'),
        fetch(`${base}${MODEL_ID}.onnx`, { signal: options.signal }),
        fetch(`${base}${MODEL_ID}.json`, { signal: options.signal }),
      ])
      if (!modelResponse.ok || !manifestResponse.ok) throw new Error('The learned coupling model assets could not be loaded.')
      const [buffer, manifest] = await Promise.all([modelResponse.arrayBuffer(), manifestResponse.json() as Promise<CouplingManifest>])
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
      if (manifest.format !== 'fullsspruce-onnx-v1' || manifest.id !== MODEL_ID || manifest.sourceSha256 !== SOURCE_SHA256 || manifest.weightsByteLength !== buffer.byteLength || manifest.weightsSha256 !== MODEL_SHA256 || hash !== MODEL_SHA256) throw new Error('Learned coupling model failed its pinned integrity check.')
      abortIfNeeded(options.signal)
      // A single-thread SIMD WASM runtime works inside a worker and does not
      // require cross-origin isolation or a server. All runtime files are local.
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.wasm.wasmPaths = {
        mjs: new URL(`${base}wasm/ort-wasm-simd-threaded.mjs`, location.href).href,
        wasm: new URL(`${base}wasm/ort-wasm-simd-threaded.wasm`, location.href).href,
      }
      options.onProgress?.('Preparing local learned J-coupling inference…')
      const session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      if (options.signal?.aborted) { await session.release(); abortIfNeeded(options.signal) }
      return { session, manifest, ort }
    })().catch((error) => { sessions.delete(base); throw error })
    sessions.set(base, promise)
  }
  return sessions.get(base)!
}

/** Fixed 64-atom inference matches upstream padding, including padded GRU states. */
export async function predictLearnedCouplings(features: CouplingFeatures, options: LearnedCouplingOptions = {}): Promise<LearnedCouplingPrediction> {
  abortIfNeeded(options.signal)
  validateCouplingFeatures(features)
  const { session, manifest, ort } = await loadSession(options)
  abortIfNeeded(options.signal)
  options.onProgress?.('Predicting signed proton–proton J couplings with FullSSPrUCe…')
  const inputs = {
    adj: new ort.Tensor('float32', features.pairFeatures, [1, 119, 64, 64]),
    vect_feat: new ort.Tensor('float32', features.atomFeatures, [1, 64, 94]),
    coupling_types: new ort.Tensor('int64', BigInt64Array.from(features.couplingTypes, (value) => BigInt(value)), [1, 64, 64]),
  }
  let outputs: Ort.InferenceSession.ReturnType | undefined
  try {
    outputs = await session.run(inputs)
    abortIfNeeded(options.signal)
    const meanMatrixHz = Float32Array.from(await outputs.coupling_mu.getData() as Float32Array)
    const stdMatrixHz = Float32Array.from(await outputs.coupling_std.getData() as Float32Array)
    if (meanMatrixHz.length !== 4096 || stdMatrixHz.length !== 4096 || meanMatrixHz.some((v) => !Number.isFinite(v)) || stdMatrixHz.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Learned coupling model returned invalid predictions.')
    const couplings: LearnedCouplingPrediction['couplings'] = []
    let excludedProtonPairs = 0
    for (let a = 0; a < features.atomCount; a++) {
      if (features.atomicNumbers[a] !== 1) continue
      for (let b = a + 1; b < features.atomCount; b++) {
        if (features.atomicNumbers[b] !== 1) continue
        const index = a * 64 + b, type = features.couplingTypes[index]
        if (type < 1 || type > 3) { excludedProtonPairs++; continue }
        couplings.push({ atomIndices: [a, b], couplingHz: meanMatrixHz[index], stdHz: stdMatrixHz[index], bondDistance: (type + 1) as 2 | 3 | 4 })
      }
    }
    return { couplings, meanMatrixHz, stdMatrixHz, atomCount: features.atomCount, maxAtoms: 64, backend: 'wasm', metadata: {
      modelId: MODEL_ID, sourceRepository: manifest.sourceRepository, upstreamRevision: manifest.upstreamRevision,
      sourceSha256: manifest.sourceSha256, weightsSha256: manifest.weightsSha256, citation: manifest.citation,
      uncertainty: manifest.uncertainty, trainedTypes: manifest.trainedTypes, excludedProtonPairs,
      warnings: [
        'Learned proton couplings cover 2, 3, and 4 bonds. More distant and unsupported pairs are omitted.',
        'Bootstrap-head standard deviations express model disagreement and are not calibrated experimental error bars.',
      ],
    } }
  } finally {
    Object.values(inputs).forEach((tensor) => tensor.dispose())
    if (outputs) Object.values(outputs).forEach((tensor) => tensor.dispose())
  }
}

export async function disposeLearnedCouplingModels(): Promise<void> {
  const loaded = await Promise.allSettled(sessions.values())
  await Promise.all(loaded.map((item) => item.status === 'fulfilled' ? item.value.session.release() : undefined))
  sessions.clear()
}
