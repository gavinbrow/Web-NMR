import { disposeLearnedCouplingModels, predictLearnedCouplings } from '../../src/prediction/couplings/runtime'
import reference from './fixtures/reference.json'
import featureReference from '../../src/prediction/couplings/feature-fixtures.json'
import { buildCouplingFeatures } from '../../src/prediction/couplings/features'
import type { ConformerEnsemble } from '../../src/prediction/conformers/types'
import type { CouplingFeatures } from '../../src/prediction/couplings/types'

self.onmessage = async () => {
  try {
    let maximumMeanErrorHz = 0, maximumStdErrorHz = 0, negativeProtonPairs = 0, outputComparisons = 0, maximumFeatureError = 0
    const cases: { name: string; meanMaxErrorHz: number; stdMaxErrorHz: number; pairCount: number; inferenceMs: number }[] = []
    let coldInferenceMs = 0, warmInferenceMs = 0
    const start = performance.now()
    for (const fixture of reference.fixtures) {
      self.postMessage({ progress: `Validating ${fixture.name}…` })
      const response = await fetch(new URL(`./fixtures/${fixture.file}`, import.meta.url))
      const raw = await response.arrayBuffer()
      const floats = (key: keyof typeof fixture.arrays) => new Float32Array(raw, fixture.arrays[key].byteOffset, fixture.arrays[key].elementCount)
      const nativeFeatures: CouplingFeatures = { atomCount: fixture.atomCount, maxAtoms: 64,
        atomFeatures: floats('atomFeatures'), pairFeatures: floats('pairFeatures'),
        couplingTypes: new Int32Array(raw, fixture.arrays.couplingTypes.byteOffset, fixture.arrays.couplingTypes.elementCount),
        atomicNumbers: fixture.atomicNumbers, originalAtomIndices: fixture.originalAtomIndices, hydrogenParents: fixture.hydrogenParents,
      }
      const featureFixture = featureReference.cases.find((item) => item.name === fixture.name)
      if (!featureFixture) throw new Error(`Missing JS feature fixture: ${fixture.name}`)
      const features = buildCouplingFeatures(featureFixture.ensemble as unknown as ConformerEnsemble)
      for (const key of ['atomFeatures', 'pairFeatures'] as const) {
        features[key].forEach((value, index) => {
          const error = Math.abs(value - nativeFeatures[key][index])
          maximumFeatureError = Math.max(maximumFeatureError, error)
          if (error >= 0.000003) throw new Error(`JS feature parity failed: ${fixture.name} ${key} ${index}`)
        })
      }
      if (!features.couplingTypes.every((value, index) => value === nativeFeatures.couplingTypes[index])) throw new Error('Coupling type parity failed')
      const inferenceStart = performance.now()
      const result = await predictLearnedCouplings(features)
      const inferenceMs = performance.now() - inferenceStart
      if (!cases.length) {
        coldInferenceMs = inferenceMs
        const repeatStart = performance.now()
        const repeated = await predictLearnedCouplings(features)
        warmInferenceMs = performance.now() - repeatStart
        if (!repeated.meanMatrixHz.every((v, i) => v === result.meanMatrixHz[i])) throw new Error('Cached repeated inference changes J predictions')
      }
      const expectedMean = floats('meanMatrixHz'), expectedStd = floats('stdMatrixHz')
      let meanMax = 0, stdMax = 0
      for (let i = 0; i < 4096; i++) {
        const meanError = Math.abs(result.meanMatrixHz[i] - expectedMean[i])
        const stdError = Math.abs(result.stdMatrixHz[i] - expectedStd[i])
        if (meanError >= 0.001 || stdError >= 0.001) throw new Error(`${fixture.name}: J parity failed at ${i}: ${meanError}/${stdError} Hz`)
        meanMax = Math.max(meanMax, meanError); stdMax = Math.max(stdMax, stdError); outputComparisons += 2
      }
      for (const pair of result.couplings) {
        const [a, b] = pair.atomIndices
        if (features.atomicNumbers[a] !== 1 || features.atomicNumbers[b] !== 1 || features.couplingTypes[a*64+b] < 1 || features.couplingTypes[a*64+b] > 3) throw new Error('Output includes untrained proton pair')
        if (pair.couplingHz < 0) negativeProtonPairs++
        if (pair.couplingHz !== result.meanMatrixHz[a*64+b] || pair.stdHz !== result.stdMatrixHz[a*64+b]) throw new Error('Output modifies signed J or uncertainty')
      }
      maximumMeanErrorHz = Math.max(maximumMeanErrorHz, meanMax); maximumStdErrorHz = Math.max(maximumStdErrorHz, stdMax)
      cases.push({ name: fixture.name, meanMaxErrorHz: meanMax, stdMaxErrorHz: stdMax, pairCount: result.couplings.length, inferenceMs })
    }
    const controller = new AbortController(); controller.abort()
    let cancellationPass = false
    try { await predictLearnedCouplings({} as CouplingFeatures, { signal: controller.signal }) } catch (error) { cancellationPass = error instanceof DOMException && error.name === 'AbortError' }
    if (!cancellationPass) throw new Error('Abort did not stop prediction')
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const externalResources = resources.filter((url) => new URL(url).origin !== location.origin)
    if (externalResources.length) throw new Error('Inference loaded external resources')
    await disposeLearnedCouplingModels()
    self.postMessage({ status: 'PASS', backend: 'ONNX WASM', fixtureCount: cases.length, outputComparisons, maximumMeanErrorHz, maximumStdErrorHz,
      negativeProtonPairs, cancellationPass, maximumFeatureError, coldInferenceMs, warmInferenceMs, elapsedMs: performance.now()-start, externalResources,
      localModelResources: resources.filter((url) => url.includes('/prediction/couplings/')), cases,
      scope: 'Numerical equality to the original trained model; experimental accuracy is not newly measured by this port.' })
  } catch (error) { self.postMessage({ status: 'FAIL', message: error instanceof Error ? error.message : String(error) }) }
}
