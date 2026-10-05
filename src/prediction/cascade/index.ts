import type { CascadeInput, CascadeOptions, CascadePrediction } from './types'
export type * from './types'
export { boltzmannWeights } from './preprocessor'

/** Keep TensorFlow and its backends out of the app's initial bundle. */
export async function inferCascadeEnsemble(input: CascadeInput, options: CascadeOptions = {}): Promise<CascadePrediction> {
  const runtime = await import('./runtime')
  return runtime.inferCascadeEnsemble(input, options)
}
