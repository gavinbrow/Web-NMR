import type { CouplingManifest } from './types'

export const COUPLING_MODEL_SHA256 = '58b7f73427439c05fdd4c9689801bb2fe2d34ac960f818ebba122f731a0d91f4'
export const COUPLING_SOURCE_SHA256 = '0a847ed10df34094fd3b052ae5e74428c85be38f244aeb0941e2e87dc73f09d3'
export const COUPLING_MODEL_ID = 'fullsspruce-etkdg-coupling'
export const COUPLING_MODEL_BYTES = 28383464
const MAX_CHUNK_BYTES = 16 * 1024 * 1024

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Learned coupling prediction canceled.', 'AbortError')
}
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
/** Validate the complete download contract before requesting any binary parts. */
export function validateCouplingManifest(value: unknown): asserts value is CouplingManifest {
  const manifest = value as CouplingManifest | null
  const expectedInputs = { adj: [1, 119, 64, 64], vect_feat: [1, 64, 94], coupling_types: [1, 64, 64] }
  const expectedOutputs = { coupling_mu: [1, 64, 64, 1], coupling_std: [1, 64, 64, 1] }
  const shapesMatch = (actual: unknown, expected: Record<string, number[]>) => {
    if (!actual || typeof actual !== 'object') return false
    return Object.entries(expected).every(([key, shape]) => {
      const supplied = (actual as Record<string, unknown>)[key]
      return Array.isArray(supplied) && supplied.length === shape.length && shape.every((n, i) => supplied[i] === n)
    })
  }
  if (!manifest || manifest.format !== 'fullsspruce-onnx-chunks-v2' || manifest.id !== COUPLING_MODEL_ID || manifest.sourceSha256 !== COUPLING_SOURCE_SHA256 || manifest.weightsByteLength !== COUPLING_MODEL_BYTES || manifest.weightsSha256 !== COUPLING_MODEL_SHA256) throw new Error('Learned coupling model failed its pinned manifest integrity check.')
  if (manifest.maxExplicitAtoms !== 64 || !shapesMatch(manifest.inputShapes, expectedInputs) || !shapesMatch(manifest.outputShapes, expectedOutputs)) throw new Error('Learned coupling model dimensions do not match the trained fixed64 model.')
  if (!Array.isArray(manifest.weightsChunks) || manifest.weightsChunks.length !== Math.ceil(COUPLING_MODEL_BYTES / MAX_CHUNK_BYTES)) throw new Error('Learned coupling model chunk contract is invalid.')
  let offset = 0
  manifest.weightsChunks.forEach((chunk, index) => {
    const expectedLength = Math.min(MAX_CHUNK_BYTES, COUPLING_MODEL_BYTES - offset)
    if (!chunk || chunk.file !== `${COUPLING_MODEL_ID}.part-${String(index).padStart(3, '0')}.bin` || chunk.byteOffset !== offset || chunk.byteLength !== expectedLength || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new Error('Learned coupling model chunk order, dimensions, or checksum contract is invalid.')
    offset += chunk.byteLength
  })
  if (offset !== COUPLING_MODEL_BYTES) throw new Error('Learned coupling model chunk lengths are incomplete.')
}

/** Concatenate unchanged ONNX bytes, then verify the pinned whole-model hash. */
export async function loadCouplingModel(base: string, signal?: AbortSignal): Promise<{ buffer: ArrayBuffer; manifest: CouplingManifest }> {
  abortIfNeeded(signal)
  const response = await fetch(`${base}${COUPLING_MODEL_ID}.json`, { signal })
  if (!response.ok) throw new Error('The learned coupling model manifest could not be loaded.')
  const manifest: unknown = await response.json()
  validateCouplingManifest(manifest)
  abortIfNeeded(signal)
  const chunks = await Promise.all(manifest.weightsChunks.map(async (chunk) => {
    const part = await fetch(`${base}${chunk.file}`, { signal })
    if (!part.ok) throw new Error(`The learned coupling model chunk could not be loaded: ${chunk.file}`)
    const bytes = await part.arrayBuffer()
    if (bytes.byteLength !== chunk.byteLength || await sha256(bytes) !== chunk.sha256) throw new Error(`Learned coupling model chunk failed its integrity check: ${chunk.file}`)
    abortIfNeeded(signal)
    return bytes
  }))
  const bytes = new Uint8Array(COUPLING_MODEL_BYTES)
  chunks.forEach((chunk, index) => bytes.set(new Uint8Array(chunk), manifest.weightsChunks[index].byteOffset))
  if (await sha256(bytes.buffer) !== COUPLING_MODEL_SHA256) throw new Error('Learned coupling model failed its pinned whole-model integrity check.')
  abortIfNeeded(signal)
  return { buffer: bytes.buffer, manifest }
}
