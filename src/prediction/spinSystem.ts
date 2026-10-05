export interface Spin {
  id: string;
  shiftPpm: number;
}
export interface SpinCoupling {
  a: number;
  b: number;
  jHz: number;
}
export interface SpinLine {
  ppm: number;
  weight: number;
  /** Dominant site magnetization changes, merged across coincident transitions. */
  siteIds?: string[];
}
type EigenSystem = {
  values: Float64Array;
  vectors: Float64Array;
  states: number[];
};

/** Cyclic Jacobi diagonalization of a real symmetric Hamiltonian. Columns are
 * orthonormal eigenvectors. Check the off-diagonal residual before accepting. */
function diagonalize(matrix: Float64Array, states: number[]): EigenSystem {
  const n = states.length,
    a = matrix.slice(),
    v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  const norm = Math.max(1, ...Array.from(a, Math.abs));
  let converged = false;
  for (let sweep = 0; sweep < 80; sweep++) {
    let maxOff = 0;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        maxOff = Math.max(maxOff, Math.abs(apq));
        if (Math.abs(apq) < norm * 1e-13) continue;
        const tau = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
        const c = 1 / Math.hypot(1, t),
          s = t * c;
        const app = a[p * n + p],
          aqq = a[q * n + q];
        a[p * n + p] = app - t * apq;
        a[q * n + q] = aqq + t * apq;
        a[p * n + q] = a[q * n + p] = 0;
        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const arp = a[r * n + p],
              arq = a[r * n + q];
            a[r * n + p] = a[p * n + r] = c * arp - s * arq;
            a[r * n + q] = a[q * n + r] = s * arp + c * arq;
          }
          const vrp = v[r * n + p],
            vrq = v[r * n + q];
          v[r * n + p] = c * vrp - s * vrq;
          v[r * n + q] = s * vrp + c * vrq;
        }
      }
    if (maxOff < norm * 1e-11) {
      converged = true;
      break;
    }
  }
  if (!converged)
    throw Error(
      "The spin Hamiltonian did not converge. No approximate pattern was substituted.",
    );
  return {
    states,
    values: Float64Array.from({ length: n }, (_, i) => a[i * n + i]),
    vectors: v,
  };
}
function population(bits: number) {
  let n = 0;
  while (bits) {
    bits &= bits - 1;
    n++;
  }
  return n;
}

/** Exact isotropic homonuclear spin-1/2 Hamiltonian (Hz):
 * H = sum nu_i Izi + sum Jij (Izi Izj + (Ii+ Ij- + Ii- Ij+)/2).
 * Allowed transitions use the total transverse magnetization operator, so
 * interference produces roofing and additional second-order lines naturally.
 * Magnetization blocks reduce the diagonalization; the explicit 10-spin cap
 * protects the browser and is never replaced silently with first-order lines.
 */
export function simulateSpinSystem(
  spins: Spin[],
  couplings: SpinCoupling[],
  frequencyMHz: number,
): SpinLine[] {
  const n = spins.length;
  if (n < 1 || n > 10)
    throw Error(
      "Exact spin simulation supports 1–10 coupled protons per system. Reduce the system or select first-order splitting.",
    );
  if (
    !Number.isFinite(frequencyMHz) ||
    frequencyMHz <= 0 ||
    spins.some((s) => !Number.isFinite(s.shiftPpm))
  )
    throw Error("Invalid spin chemical shifts or field.");
  const edges = new Map<string, SpinCoupling>();
  for (const edge of couplings) {
    if (
      !Number.isInteger(edge.a) ||
      !Number.isInteger(edge.b) ||
      edge.a < 0 ||
      edge.b < 0 ||
      edge.a >= n ||
      edge.b >= n ||
      edge.a === edge.b ||
      !Number.isFinite(edge.jHz) ||
      Math.abs(edge.jHz) > 1000
    )
      throw Error("Invalid spin coupling.");
    const key = [edge.a, edge.b].sort((a, b) => a - b).join(":");
    if (edges.has(key)) throw Error("Duplicate spin coupling.");
    edges.set(key, edge);
  }
  const center = spins.reduce((sum, s) => sum + s.shiftPpm, 0) / n;
  const nu = spins.map((s) => (s.shiftPpm - center) * frequencyMHz);
  const statesByBlock: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let state = 0; state < 2 ** n; state++)
    statesByBlock[population(state)].push(state);
  const blocks = statesByBlock.map((states) => {
    const dim = states.length,
      matrix = new Float64Array(dim * dim),
      index = new Map(states.map((s, i) => [s, i]));
    for (let row = 0; row < dim; row++) {
      const bits = states[row];
      let energy = 0;
      for (let spin = 0; spin < n; spin++)
        energy += nu[spin] * (bits & (1 << spin) ? 0.5 : -0.5);
      for (const edge of edges.values()) {
        const upA = !!(bits & (1 << edge.a)),
          upB = !!(bits & (1 << edge.b));
        energy += edge.jHz * (upA === upB ? 0.25 : -0.25);
        if (upA !== upB)
          matrix[
            row * dim + index.get(bits ^ (1 << edge.a) ^ (1 << edge.b))!
          ] += edge.jHz / 2;
      }
      matrix[row * dim + row] = energy;
    }
    const block = diagonalize(matrix, states);
    // Spin-resolved magnetization expectations in each eigenstate. Differences
    // identify the dominant source of a transition without assigning every line
    // to the entire connected system. This leaves total-I+ intensities intact.
    const magnetizations = new Float64Array(dim * n);
    for (let eigen = 0; eigen < dim; eigen++)
      for (let row = 0; row < dim; row++) {
        const probability = block.vectors[row * dim + eigen] ** 2;
        for (let spin = 0; spin < n; spin++)
          magnetizations[eigen * n + spin] +=
            probability * (states[row] & (1 << spin) ? 0.5 : -0.5);
      }
    return { ...block, magnetizations };
  });
  const lines: (SpinLine & { contributions: number[] })[] = [];
  for (let k = 0; k < n; k++) {
    const low = blocks[k],
      high = blocks[k + 1],
      dl = low.states.length,
      dh = high.states.length;
    const highIndex = new Map(high.states.map((state, i) => [state, i]));
    // Apply I+ to the lower-sector eigenvectors once; then rotate to the higher
    // eigenbasis. This retains cross terms between indistinguishable transitions.
    const raised = new Float64Array(dh * dl);
    for (let row = 0; row < dl; row++)
      for (let spin = 0; spin < n; spin++)
        if (!(low.states[row] & (1 << spin))) {
          const target = highIndex.get(low.states[row] | (1 << spin))!;
          for (let l = 0; l < dl; l++)
            raised[target * dl + l] += low.vectors[row * dl + l];
        }
    for (let h = 0; h < dh; h++)
      for (let l = 0; l < dl; l++) {
        let amplitude = 0;
        for (let row = 0; row < dh; row++)
          amplitude += high.vectors[row * dh + h] * raised[row * dl + l];
        const strength = amplitude * amplitude;
        if (strength > 1e-12) {
          const changes = spins.map((_, spin) =>
            Math.max(
              0,
              high.magnetizations[h * n + spin] -
                low.magnetizations[l * n + spin],
            ),
          );
          const changeSum = changes.reduce((sum, v) => sum + v, 0);
          lines.push({
            ppm: center + (high.values[h] - low.values[l]) / frequencyMHz,
            weight: strength,
            contributions: changes.map((v) => (strength * v) / changeSum),
          });
        }
      }
  }
  const sum = lines.reduce((total, line) => total + line.weight, 0),
    merged = new Map<number, SpinLine & { contributions: number[] }>();
  for (const line of lines) {
    const key = Math.round(line.ppm * frequencyMHz * 1e6) / 1e6;
    const existing = merged.get(key);
    const weight = (line.weight * n) / sum;
    if (existing) {
      existing.weight += weight;
      line.contributions.forEach((v, i) => (existing.contributions[i] += v));
    } else
      merged.set(key, {
        ppm: line.ppm,
        weight,
        contributions: [...line.contributions],
      });
  }
  return [...merged.values()]
    .map(({ ppm, weight, contributions }) => {
      const largest = Math.max(...contributions);
      return {
        ppm,
        weight,
        siteIds: spins.flatMap((spin, i) =>
          contributions[i] >= largest * 0.95 ? [spin.id] : [],
        ),
      };
    })
    .sort((a, b) => b.ppm - a.ppm);
}
