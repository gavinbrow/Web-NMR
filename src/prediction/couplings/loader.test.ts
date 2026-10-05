import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { COUPLING_MODEL_BYTES, COUPLING_MODEL_SHA256, loadCouplingModel, validateCouplingManifest } from './loader'
import type { CouplingManifest } from './types'

let originalManifest: CouplingManifest
const parts = new Map<string, ArrayBuffer>()
const root = new URL('../../../public/prediction/couplings/', import.meta.url)
beforeAll(async () => {
  originalManifest = JSON.parse(await readFile(new URL('fullsspruce-etkdg-coupling.json', root), 'utf8'))
  for (const chunk of originalManifest.weightsChunks) {
    const bytes = await readFile(new URL(chunk.file, root))
    const copy = new Uint8Array(bytes.length); copy.set(bytes)
    parts.set(chunk.file, copy.buffer)
  }
})
afterEach(() => vi.unstubAllGlobals())

function mockAssets(manifest = structuredClone(originalManifest), transform?: (file: string, bytes: ArrayBuffer) => ArrayBuffer) {
  const mocked = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const file = url.split('/').at(-1)!
    if (file.endsWith('.json')) return Response.json(manifest)
    const bytes = parts.get(file)
    if (!bytes) return new Response('', { status: 404 })
    return new Response(transform ? transform(file, bytes) : bytes)
  })
  vi.stubGlobal('fetch', mocked)
  return mocked
}
async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('')
}

describe('unchanged ONNX static-chunk loader', () => {
  it('reassembles the genuine model with its pinned whole-file SHA and only requests chunks', async () => {
    const requests = mockAssets()
    const result = await loadCouplingModel('/prediction/couplings/')
    expect(result.buffer.byteLength).toBe(COUPLING_MODEL_BYTES)
    expect(await hash(result.buffer)).toBe(COUPLING_MODEL_SHA256)
    expect(originalManifest.weightsChunks.every((part) => part.byteLength <= 16 * 1024 * 1024)).toBe(true)
    expect(requests.mock.calls.map(([url]) => String(url))).toEqual([
      '/prediction/couplings/fullsspruce-etkdg-coupling.json',
      ...originalManifest.weightsChunks.map((part) => `/prediction/couplings/${part.file}`),
    ])
  })
  it('rejects reversed chunk order before any binary download', async () => {
    const manifest = structuredClone(originalManifest); manifest.weightsChunks.reverse()
    const requests = mockAssets(manifest)
    await expect(loadCouplingModel('/')).rejects.toThrow('chunk order')
    expect(requests).toHaveBeenCalledTimes(1)
  })
  it('rejects gapped offsets and excessive chunk dimensions', () => {
    const gap = structuredClone(originalManifest); gap.weightsChunks[1].byteOffset++
    expect(() => validateCouplingManifest(gap)).toThrow('chunk order')
    const oversized = structuredClone(originalManifest); oversized.weightsChunks[0].byteLength++
    expect(() => validateCouplingManifest(oversized)).toThrow('chunk order')
  })
  it('rejects altered network input and output dimensions before binary downloads', async () => {
    for (const kind of ['inputShapes', 'outputShapes'] as const) {
      const manifest = structuredClone(originalManifest)
      if (kind === 'inputShapes') manifest.inputShapes.adj[2] = 63
      else manifest.outputShapes.coupling_mu[3] = 2
      const requests = mockAssets(manifest)
      await expect(loadCouplingModel('/')).rejects.toThrow('dimensions')
      expect(requests).toHaveBeenCalledTimes(1)
    }
  })
  it('rejects truncated response bytes', async () => {
    mockAssets(undefined, (file, bytes) => file.includes('000') ? bytes.slice(0, -1) : bytes)
    await expect(loadCouplingModel('/')).rejects.toThrow('chunk failed its integrity')
  })
  it('rejects one corrupted byte despite unchanged chunk length', async () => {
    mockAssets(undefined, (file, bytes) => {
      if (!file.includes('000')) return bytes
      const changed = new Uint8Array(bytes.slice(0)); changed[100] ^= 1
      return changed.buffer
    })
    await expect(loadCouplingModel('/')).rejects.toThrow('chunk failed its integrity')
  })
  it('checks the pinned full model even if a manifest claims a matching corrupted-part hash', async () => {
    const manifest = structuredClone(originalManifest)
    const changed = new Uint8Array(parts.get(manifest.weightsChunks[1].file)!.slice(0)); changed[100] ^= 1
    manifest.weightsChunks[1].sha256 = await hash(changed.buffer)
    mockAssets(manifest, (file, bytes) => file.includes('001') ? changed.buffer : bytes)
    await expect(loadCouplingModel('/')).rejects.toThrow('pinned whole-model integrity')
  })
  it('rejects changed total-model dimensions and missing parts', () => {
    const wrongTotal = structuredClone(originalManifest); wrongTotal.weightsByteLength--
    expect(() => validateCouplingManifest(wrongTotal)).toThrow('pinned manifest integrity')
    const missing = structuredClone(originalManifest); missing.weightsChunks.pop()
    expect(() => validateCouplingManifest(missing)).toThrow('chunk contract')
  })
  it('honors pre-download cancellation', async () => {
    const requests = mockAssets(); const controller = new AbortController(); controller.abort()
    await expect(loadCouplingModel('/', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).not.toHaveBeenCalled()
  })
})
