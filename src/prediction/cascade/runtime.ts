import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-cpu'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { boltzmannWeights, constructCascadeGraph } from './preprocessor'
import type { CascadeGraph } from './preprocessor'
import type { CascadeInput, CascadeManifest, CascadeModelId, CascadeModelMetadata, CascadeNucleus, CascadeOptions, CascadePrediction } from './types'

type Weights = Record<string, tf.Tensor>
export interface LoadedCascadeModel { manifest: CascadeManifest; weights: Weights }
const MODEL_IDS: Record<CascadeNucleus, CascadeModelId> = { '13C': 'carbon-expnn-ff', '1H': 'proton-dftnn' }
const HASHES: Record<CascadeModelId, string> = {
  'carbon-expnn-ff': '5b3d1daf1f9394a96afcf49f083e1401836f5274d4b94b6e599596734b3cac40',
  'proton-dftnn': 'c649cfc2f01a122751af7c0a21b57c7ec106a7d1579cd4a1b1c908f08c4ea224',
}
const models = new Map<string, Promise<LoadedCascadeModel>>()
let backendReady: Promise<void> | undefined

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('CASCADE prediction canceled.', 'AbortError')
}
function assets(options: CascadeOptions): string {
  return (options.assetBaseUrl ?? `${import.meta.env.BASE_URL}cascade/`).replace(/\/?$/, '/')
}
async function initializeBackend(options: CascadeOptions): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      setWasmPaths(`${assets(options)}wasm/`)
      const requested = options.backend ?? 'wasm'
      if (requested === 'webgl') await import('@tensorflow/tfjs-backend-webgl')
      try {
        if (!(await tf.setBackend(requested))) throw new Error(`Backend ${requested} unavailable`)
        await tf.ready()
      } catch (error) {
        if (options.backend) throw error
        if (!(await tf.setBackend('cpu'))) throw new Error('No local CASCADE tensor backend available.')
        await tf.ready()
      }
    })().catch((error) => { backendReady = undefined; throw error })
  }
  await backendReady
}

export function createCascadeModel(manifest: CascadeManifest, buffer: ArrayBuffer): LoadedCascadeModel {
  if (manifest.format !== 'cascade-float32-v1' || manifest.weightsByteLength !== buffer.byteLength) throw new Error('CASCADE model asset format or size is invalid.')
  const weights: Weights = {}
  try {
    for (const spec of manifest.tensors) {
      if (spec.byteLength !== spec.shape.reduce((a, b) => a * b, 4)) throw new Error('CASCADE tensor shape does not match its byte length.')
      weights[spec.name] = tf.tensor(new Float32Array(buffer, spec.byteOffset, spec.byteLength / 4), spec.shape, 'float32')
    }
  } catch (error) {
    Object.values(weights).forEach((tensor) => tensor.dispose())
    throw error
  }
  return { manifest, weights }
}

async function loadModel(nucleus: CascadeNucleus, options: CascadeOptions): Promise<LoadedCascadeModel> {
  const id = MODEL_IDS[nucleus], key = `${assets(options)}${id}`
  if (!models.has(key)) {
    const promise = (async () => {
      options.onProgress?.(`Loading local CASCADE ${nucleus} neural network…`)
      const [manifestResponse, weightsResponse] = await Promise.all([
        fetch(`${assets(options)}${id}.json`, { signal: options.signal }),
        fetch(`${assets(options)}${id}.bin`, { signal: options.signal }),
      ])
      if (!manifestResponse.ok || !weightsResponse.ok) throw new Error(`CASCADE ${nucleus} model assets could not be loaded.`)
      const manifest = await manifestResponse.json() as CascadeManifest
      const buffer = await weightsResponse.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
      if (manifest.id !== id || manifest.weightsSha256 !== HASHES[id] || hash !== HASHES[id]) throw new Error('CASCADE neural-network weights failed the integrity check.')
      abortIfNeeded(options.signal)
      return createCascadeModel(manifest, buffer)
    })().catch((error) => { models.delete(key); throw error })
    models.set(key, promise)
  }
  return models.get(key)!
}

/** Implements upstream graph_network.py tensor operations, without a prediction server. */
export async function predictCascadeGraph(model: LoadedCascadeModel, graph: CascadeGraph): Promise<Float32Array> {
  if (!graph.targetAtomIndices.length) return new Float32Array()
  if (graph.edgeCount > 10000) throw new Error('CASCADE structure has too many close atom pairs for this browser session.')
  const prediction = tf.tidy(() => {
    const tokens = tf.tensor1d(graph.atomTokens, 'int32')
    const senders = tf.tensor1d(graph.senders, 'int32')
    const receivers = tf.tensor1d(graph.receivers, 'int32')
    const receiverIndices = tf.reshape(receivers, [graph.edgeCount, 1])
    const targets = tf.tensor1d(graph.targetAtomIndices, 'int32')
    const atomCount = graph.atomTokens.length
    let atomState = tf.gather(model.weights['atom_embedding/embeddings'], tokens) as tf.Tensor2D
    let bondState = tf.tensor2d(graph.distanceRbf, [graph.edgeCount, 256])
    const atomwiseShift = tf.gather(model.weights['atomwise_shift/embeddings'], tokens)
    let denseIndex = 1
    const dense = (input: tf.Tensor2D): tf.Tensor2D => {
      const name = `dense_${denseIndex++}`
      let output = tf.matMul(input, model.weights[`${name}/kernel`] as tf.Tensor2D)
      if (model.weights[`${name}/bias`]) output = tf.add(output, model.weights[`${name}/bias`]) as tf.Tensor2D
      return (model.manifest.activations[name] === 'softplus' ? tf.softplus(output) : output) as tf.Tensor2D
    }
    for (let block = 0; block < 3; block++) {
      const oldAtomState = atomState, oldBondState = bondState
      const updated = tf.tidy(() => {
        const transformed = dense(atomState)
        const source = tf.gather(transformed, senders) as tf.Tensor2D
        const target = tf.gather(transformed, receivers) as tf.Tensor2D
        let bondMessage = tf.concat([source, target, bondState], 1)
        for (let layer = 0; layer < 4; layer++) bondMessage = dense(bondMessage)
        const newBondState = tf.add(bondMessage, bondState) as tf.Tensor2D
        // ScatterND sums duplicate receivers, exactly the graph segment-sum.
        // Unlike UnsortedSegmentSum, it is supported by the WASM backend.
        let messages = tf.scatterND(receiverIndices, tf.mul(source, newBondState), [atomCount, 256]) as tf.Tensor2D
        messages = dense(dense(messages))
        const newAtomState = tf.add(transformed, messages) as tf.Tensor2D
        return [newAtomState, newBondState]
      })
      atomState = updated[0]; bondState = updated[1]
      oldAtomState.dispose(); oldBondState.dispose()
    }
    // Each output slot corresponds to one target atom. Gathering equals upstream
    // unsorted_segment_mean with unique atom_index >=0; non-target -1 rows ignored.
    atomState = tf.gather(atomState, targets) as tf.Tensor2D
    for (let layer = 0; layer < 4; layer++) atomState = dense(atomState)
    return tf.reshape(tf.add(atomState, tf.gather(atomwiseShift, targets)), [-1])
  })
  try {
    const values = await prediction.data() as Float32Array
    if (values.some((v) => !Number.isFinite(v))) throw new Error('CASCADE neural network produced a non-finite shift.')
    return Float32Array.from(values)
  } finally { prediction.dispose() }
}

export async function inferCascadeEnsemble(input: CascadeInput, options: CascadeOptions = {}): Promise<CascadePrediction> {
  abortIfNeeded(options.signal)
  const temperatureKelvin = input.temperatureKelvin ?? 298.15
  const conformerWeights = boltzmannWeights(input.conformers.map((c) => c.energyKcal), temperatureKelvin)
  const nuclei = [...new Set(input.nuclei ?? ['13C', '1H'] as CascadeNucleus[])]
  if (nuclei.some((n) => !(n in MODEL_IDS))) throw new Error('CASCADE predicts only 1H and 13C.')
  await initializeBackend(options)
  const shifts: CascadePrediction['shifts'] = [], metadata: CascadeModelMetadata[] = []
  for (const nucleus of nuclei) {
    abortIfNeeded(options.signal)
    const atomicNumber = nucleus === '13C' ? 6 : 1
    if (!input.atomicNumbers.includes(atomicNumber)) continue
    const model = await loadModel(nucleus, options)
    const conformerShifts: Float32Array[] = []
    let targetAtomIndices: Int32Array = new Int32Array()
    for (let conf = 0; conf < input.conformers.length; conf++) {
      abortIfNeeded(options.signal)
      options.onProgress?.(`CASCADE ${nucleus}: conformer ${conf + 1} of ${input.conformers.length}…`)
      const graph = constructCascadeGraph(input.atomicNumbers, input.conformers[conf].coordinates, atomicNumber, model.manifest.features)
      targetAtomIndices = graph.targetAtomIndices
      conformerShifts.push(await predictCascadeGraph(model, graph))
      // Permit cancel/progress messages to be delivered between graph evaluations.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    targetAtomIndices.forEach((atomIndex, target) => {
      const mean = conformerShifts.reduce((sum, row, conf) => sum + conformerWeights[conf] * row[target], 0)
      const variance = conformerShifts.reduce((sum, row, conf) => sum + conformerWeights[conf] * (row[target] - mean) ** 2, 0)
      shifts.push({ atomIndex, nucleus, shiftPpm: mean, conformerStdDevPpm: Math.sqrt(variance) })
    })
    const manifest = model.manifest
    metadata.push({ id: manifest.id, nucleus, lineage: manifest.lineage, weightsSha256: manifest.weightsSha256, sourceSha256: manifest.sourceSha256, upstreamRevision: manifest.upstreamRevision, citation: manifest.citation,
      ...(nucleus === '1H' ? { geometryCaveat: 'Proton DFTNN was trained on DFT geometries and DFT shifts; inference here uses force-field conformers. Experimental proton accuracy is not established by this numerical port.' } : {}),
    })
  }
  abortIfNeeded(options.signal)
  return { shifts, conformerWeights, conformerCount: input.conformers.length, temperatureKelvin, models: metadata, backend: tf.getBackend() }
}

/** Dispose cached neural weights, e.g. when releasing a worker. */
export async function disposeCascadeModels(): Promise<void> {
  const loaded = await Promise.allSettled(models.values())
  loaded.forEach((result) => { if (result.status === 'fulfilled') Object.values(result.value.weights).forEach((t) => t.dispose()) })
  models.clear()
}
