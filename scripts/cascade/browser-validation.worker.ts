import { inferCascadeEnsemble } from '../../src/prediction/cascade/index'
import { disposeCascadeModels } from '../../src/prediction/cascade/runtime'
import reference from '../../src/prediction/cascade/reference-fixtures.json'
import * as tf from '@tensorflow/tfjs-core'

self.onmessage = async () => {
  try {
    const start = performance.now()
    let maximumError = 0, atomComparisons = 0, graphEvaluations = 0
    let backend = '', baselineTensors = 0
    const cases: { name: string; maximumErrorPpm: number }[] = []
    for (const fixture of reference.fixtures) {
      let caseMaximum = 0
      for (const conformer of fixture.conformers) {
        const result = await inferCascadeEnsemble({ atomicNumbers: fixture.atomicNumbers, conformers: [conformer] }, {
          backend: 'wasm', onProgress: (progress) => self.postMessage({ progress: `${fixture.name}: ${progress}` }),
        })
        backend = result.backend
        if (backend !== 'wasm') throw new Error(`Expected WASM, received ${backend}`)
        graphEvaluations += result.models.length
        for (const shift of result.shifts) {
          const expected = conformer.predictions[shift.nucleus]
          const index = expected.atomIndices.indexOf(shift.atomIndex)
          const error = Math.abs(shift.shiftPpm - expected.shiftsPpm[index])
          if (!Number.isFinite(error) || error >= 0.001) throw new Error(`Parity failed: ${fixture.name} atom${shift.atomIndex}: ${error} ppm`)
          maximumError = Math.max(maximumError, error); caseMaximum = Math.max(caseMaximum, error)
          atomComparisons++
        }
        if (!baselineTensors) baselineTensors = tf.memory().numTensors
        if (tf.memory().numTensors !== baselineTensors) throw new Error('Tensor count grows between inference runs')
      }
      cases.push({ name: fixture.name, maximumErrorPpm: caseMaximum })
    }
    const elapsedMs = performance.now() - start
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const externalResources = resources.filter((url) => new URL(url).origin !== location.origin)
    if (externalResources.length) throw new Error(`External resources used: ${externalResources.join(', ')}`)
    await disposeCascadeModels()
    if (tf.memory().numTensors !== 0) throw new Error('Neural weights not fully disposed')
    self.postMessage({ status: 'PASS', backend, fixtures: reference.fixtureCount, graphEvaluations, atomComparisons, maximumErrorPpm: maximumError,
      elapsedMs, cachedWeightTensorCount: baselineTensors, tensorsAfterDisposal: tf.memory().numTensors,
      externalResources, localModelResources: resources.filter((url) => url.includes('/cascade/') && !url.includes('/src/')), cases,
      scope: 'Exact numerical port on fixed force-field geometries; this does not establish experimental proton accuracy.' })
  } catch (error) { self.postMessage({ status: 'FAIL', message: error instanceof Error ? error.message : String(error) }) }
}
