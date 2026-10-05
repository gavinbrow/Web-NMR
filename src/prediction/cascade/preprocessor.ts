import type { CascadeFeatures } from './types'

export interface CascadeGraph {
  atomTokens: Int32Array
  targetAtomIndices: Int32Array
  receivers: Int32Array
  senders: Int32Array
  distances: Float32Array
  distanceRbf: Float32Array
  edgeCount: number
}

/** Exact CASCADE MolAPreprocessor inputs, including float32 distances before RBF. */
export function constructCascadeGraph(
  atomicNumbers: readonly number[],
  coordinates: readonly (readonly number[])[],
  targetAtomicNumber: number,
  settings: CascadeFeatures,
): CascadeGraph {
  const atomCount = atomicNumbers.length
  if (!atomCount || atomCount > 256) throw new Error('CASCADE supports 1–256 explicit atoms per structure.')
  if (coordinates.length !== atomCount) throw new Error('CASCADE coordinate and atom counts differ.')
  if (coordinates.some((point) => point.length !== 3 || point.some((x) => !Number.isFinite(x)))) {
    throw new Error('CASCADE requires finite 3D coordinates in Å for every explicit atom.')
  }
  const atomTokens = new Int32Array(atomCount)
  const targets: number[] = []
  for (let i = 0; i < atomCount; i++) {
    const token = settings.atomTokens[atomicNumbers[i]]
    if (token === undefined) throw new Error(`CASCADE has no trained atom token for atomic number ${atomicNumbers[i]}. Supported elements: H, C, N, O, F, P, S, Cl.`)
    atomTokens[i] = token
    if (atomicNumbers[i] === targetAtomicNumber) targets.push(i)
  }
  const matrix = new Float64Array(atomCount * atomCount)
  let edgeCount = 0
  for (let receiver = 0; receiver < atomCount; receiver++) {
    for (let sender = 0; sender < atomCount; sender++) {
      const a = coordinates[receiver], b = coordinates[sender]
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      matrix[receiver * atomCount + sender] = distance
      if (receiver !== sender && distance === 0) throw new Error('CASCADE cannot process overlapping atom coordinates.')
      if (distance !== 0 && distance < settings.cutoffAngstrom) edgeCount++
    }
  }
  edgeCount = Math.max(1, edgeCount)
  // Upstream allocates all cutoff pairs, then fills at most maxNeighbors per atom.
  // Preserve trailing zero rows if that cap is reached, for numerical fidelity.
  const receivers = new Int32Array(edgeCount), senders = new Int32Array(edgeCount)
  const distances = new Float32Array(edgeCount)
  let edge = 0
  for (let receiver = 0; receiver < atomCount; receiver++) {
    const neighbors = Array.from({ length: atomCount }, (_, i) => i)
      .sort((a, b) => matrix[receiver * atomCount + a] - matrix[receiver * atomCount + b] || a - b)
      .filter((sender) => sender !== receiver && matrix[receiver * atomCount + sender] < settings.cutoffAngstrom)
      .slice(0, settings.maxNeighbors)
    if (!neighbors.length) neighbors.push(receiver)
    for (const sender of neighbors) {
      if (edge >= edgeCount) throw new Error('CASCADE preprocessing cannot represent isolated atoms in this structure.')
      receivers[edge] = receiver
      senders[edge] = sender
      distances[edge] = matrix[receiver * atomCount + sender]
      edge++
    }
  }
  const distanceRbf = new Float32Array(edgeCount * settings.rbfDimension)
  for (let e = 0; e < edgeCount; e++) {
    for (let k = 0; k < settings.rbfDimension; k++) {
      const deviation = distances[e] - (-settings.rbfMu + settings.rbfDelta * k)
      distanceRbf[e * settings.rbfDimension + k] = Math.exp(-deviation * deviation / settings.rbfDelta)
    }
  }
  return { atomTokens, targetAtomIndices: Int32Array.from(targets), receivers, senders, distances, distanceRbf, edgeCount }
}

export function boltzmannWeights(energiesKcal: readonly number[], temperatureKelvin = 298.15): number[] {
  if (!energiesKcal.length || energiesKcal.some((e) => !Number.isFinite(e))) throw new Error('CASCADE requires a finite energy for every conformer.')
  if (!Number.isFinite(temperatureKelvin) || temperatureKelvin <= 0) throw new Error('CASCADE temperature must be positive kelvin.')
  const minimum = Math.min(...energiesKcal)
  const values = energiesKcal.map((energy) => Math.exp(-(energy - minimum) / (0.001987 * temperatureKelvin)))
  const sum = values.reduce((a, b) => a + b, 0)
  return values.map((v) => v / sum)
}
