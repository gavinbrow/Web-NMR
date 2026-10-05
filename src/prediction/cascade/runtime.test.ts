import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as tf from '@tensorflow/tfjs-core'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import { fileURLToPath } from 'node:url'
import { boltzmannWeights, constructCascadeGraph } from './preprocessor'
import { createCascadeModel, disposeCascadeModels, inferCascadeEnsemble, predictCascadeGraph } from './runtime'
import type { LoadedCascadeModel } from './runtime'
import type { CascadeManifest, CascadeNucleus } from './types'
import reference from './reference-fixtures.json'

const root = new URL('../../../', import.meta.url)
const models = new Map<CascadeNucleus, LoadedCascadeModel>()
let maximumError = 0
beforeAll(async () => {
  await tf.setBackend('cpu'); await tf.ready()
  for (const [nucleus, id] of [['13C', 'carbon-expnn-ff'], ['1H', 'proton-dftnn']] as const) {
    const manifest = JSON.parse(await readFile(new URL(`public/cascade/${id}.json`, root), 'utf8')) as CascadeManifest
    const bytes = await readFile(new URL(`public/cascade/${id}.bin`, root))
    models.set(nucleus, createCascadeModel(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
  }
})
afterAll(async () => {
  for (const model of models.values()) Object.values(model.weights).forEach((tensor) => tensor.dispose())
  await disposeCascadeModels()
  vi.unstubAllGlobals()
  console.info(`CASCADE CPU vs Python Keras maximum absolute error: ${maximumError.toFixed(7)} ppm`)
})

describe('genuine CASCADE weights and exact preprocessing', () => {
  for (const fixture of reference.fixtures) {
    for (const nucleus of ['13C', '1H'] as const) {
      it(`matches Python fixed-conformer shifts: ${fixture.name} ${nucleus}`, async () => {
        const model = models.get(nucleus)!
        const before = tf.memory().numTensors
        for (const conformer of fixture.conformers) {
          const graph = constructCascadeGraph(fixture.atomicNumbers, conformer.coordinates, nucleus === '13C' ? 6 : 1, model.manifest.features)
          const expectedFeatures = conformer.features[nucleus]
          expect([...graph.atomTokens]).toEqual(expectedFeatures.atomTokens)
          expect([...graph.receivers]).toEqual(expectedFeatures.receivers)
          expect([...graph.senders]).toEqual(expectedFeatures.senders)
          expect([...graph.distances]).toEqual(expectedFeatures.distances)
          for (let k = 0; k < 256; k++) expect(graph.distanceRbf[k]).toBeCloseTo(expectedFeatures.rbfFirstEdge[k], 7)
          const actual = await predictCascadeGraph(model, graph)
          const expected = conformer.predictions[nucleus].shiftsPpm
          expect(actual.length).toBe(expected.length)
          actual.forEach((value, target) => {
            const error = Math.abs(value - expected[target]); maximumError = Math.max(maximumError, error)
            expect(error).toBeLessThan(0.001)
          })
        }
        expect(tf.memory().numTensors).toBe(before)
      }, 30000)
    }
  }
  it('uses actual energies and preserves explicit proton identities in the ensemble', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const file = new URL(`public${url}`, root)
      return new Response(await readFile(file))
    })
    const fixture = reference.fixtures[0]
    const conformers = fixture.conformers.map((c, i) => ({ coordinates: c.coordinates, energyKcal: i * 1.5 }))
    const result = await inferCascadeEnsemble({ atomicNumbers: fixture.atomicNumbers, conformers }, { assetBaseUrl: '/cascade/', backend: 'cpu' })
    const expectedWeights = boltzmannWeights([0, 1.5])
    expect(result.conformerWeights).toEqual(expectedWeights)
    expect(result.models.map((m) => m.id)).toEqual(['carbon-expnn-ff', 'proton-dftnn'])
    expect(result.models[1].geometryCaveat).toContain('DFT geometries')
    expect(result.shifts.filter((s) => s.nucleus === '1H')).toHaveLength(fixture.atomicNumbers.filter((z) => z === 1).length)
    for (const shift of result.shifts) {
      const target = fixture.conformers[0].predictions[shift.nucleus].atomIndices.indexOf(shift.atomIndex)
      const expected = fixture.conformers.reduce((sum, c, index) => sum + expectedWeights[index] * c.predictions[shift.nucleus].shiftsPpm[target], 0)
      expect(Math.abs(shift.shiftPpm - expected)).toBeLessThan(0.001)
    }
  }, 30000)
  it('runs all fixed-conformer fixtures with the accelerated WASM backend', async () => {
    vi.unstubAllGlobals()
    setWasmPaths(fileURLToPath(new URL('public/cascade/wasm/', root)))
    await tf.setBackend('wasm'); await tf.ready()
    expect(tf.getBackend()).toBe('wasm')
    let wasmMaximumError = 0
    for (const fixture of reference.fixtures) {
      for (const nucleus of ['13C', '1H'] as const) {
        const model = models.get(nucleus)!
        for (const conformer of fixture.conformers) {
          const graph = constructCascadeGraph(fixture.atomicNumbers, conformer.coordinates, nucleus === '13C' ? 6 : 1, model.manifest.features)
          const actual = await predictCascadeGraph(model, graph)
          actual.forEach((value, index) => {
            const error = Math.abs(value - conformer.predictions[nucleus].shiftsPpm[index])
            wasmMaximumError = Math.max(wasmMaximumError, error)
            expect(error).toBeLessThan(0.001)
          })
        }
      }
    }
    console.info(`CASCADE WASM vs Python Keras maximum absolute error: ${wasmMaximumError.toFixed(7)} ppm`)
  }, 30000)
  it('releases intermediates when canceled during a conformer ensemble', async () => {
    const fixture = reference.fixtures[0]
    const controller = new AbortController()
    const before = tf.memory().numTensors
    await expect(inferCascadeEnsemble({ atomicNumbers: fixture.atomicNumbers, conformers: fixture.conformers, nuclei: ['1H'] }, {
      signal: controller.signal, assetBaseUrl: '/cascade/',
      onProgress: (message) => { if (message.includes('conformer 1')) controller.abort() },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(tf.memory().numTensors).toBe(before)
  })
  it('rejects modified model weights before constructing tensors', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const name = url.split('/').pop()!
      const bytes = await readFile(new URL(`public/cascade/${name}`, root))
      if (name.endsWith('.bin')) bytes[0] ^= 1
      return new Response(bytes)
    })
    const fixture = reference.fixtures[0]
    const before = tf.memory().numTensors
    await expect(inferCascadeEnsemble({ atomicNumbers: fixture.atomicNumbers, conformers: fixture.conformers, nuclei: ['1H'] }, { assetBaseUrl: '/tampered/' })).rejects.toThrow('integrity check')
    expect(tf.memory().numTensors).toBe(before)
    vi.unstubAllGlobals()
  })
  it('rejects invalid geometry, unsupported atom types, and cancellation', async () => {
    const settings = models.get('13C')!.manifest.features
    expect(() => constructCascadeGraph([6], [[NaN, 0, 0]], 6, settings)).toThrow('finite 3D')
    expect(() => constructCascadeGraph([35], [[0, 0, 0]], 6, settings)).toThrow('no trained atom token')
    const controller = new AbortController(); controller.abort()
    await expect(inferCascadeEnsemble({ atomicNumbers: [6], conformers: [{ coordinates: [[0, 0, 0]], energyKcal: 0 }] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(boltzmannWeights([100000, 100001])[0]).toBeGreaterThan(0.8)
    expect(() => boltzmannWeights([NaN])).toThrow('finite energy')
  })
})
