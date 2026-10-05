import type { AtomDescriptor, ConformerEnsemble } from '../conformers';
import config from './feature-config.json';
import type { CouplingFeatures } from './types';
export const MAX_COUPLING_ATOMS = 64;
export const ATOM_FEATURE_COUNT = 94;
export const PAIR_CHANNEL_COUNT = 119;
const atomicNumbers = [1,6,7,8,9,15,16,17];
// Match upstream enums, intentionally excluding RDKit SP2D (5).
const hybridizations = [0,1,2,3,4,6,7,8];
const mmffTypes = [1,2,3,4,5,6,7,8,9,10,11,12,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,32,33,37,38,39,40,42,43,44,46,48,59,62,63,64,65,66,70,71,72,74,75,78];
// Carbon=2.26 is the value used in the published model's feature source.
const electronegativities: Record<number, number> = {1:2.20,6:2.26,7:3.04,8:3.44,9:3.98,15:2.19,16:2.58,17:3.16};
const oneHot = (value: number, values: readonly number[]) => values.map((v) => Number(value === v));
export type { CouplingFeatures } from './types';
export function atomFeatureVector(atom: AtomDescriptor): number[] {
  if (!(atom.atomicNumber in electronegativities)) {
    throw new Error('The coupling model supports H, C, N, O, F, P, S, and Cl.');
  }
  const features = [
    ...oneHot(atom.atomicNumber, atomicNumbers), atom.totalValence,
    ...oneHot(atom.totalValence,[1,2,3,4,5,6]), Number(atom.aromatic),
    ...oneHot(atom.hybridization, hybridizations), ...oneHot(atom.formalCharge,[-1,0,1]),
    ...oneHot(atom.defaultValence,[1,2,3,4,5,6]),
    ...[3,4,5,6,7].map((size) => Number(atom.ringSizes.includes(size))),
    ...oneHot(atom.chiralTag,[0,1,2,3]), electronegativities[atom.atomicNumber],
    ...oneHot(atom.mmffAtomType, mmffTypes),
  ];
  if (features.length !== ATOM_FEATURE_COUNT) throw new Error('Coupling atom feature schema mismatch.');
  return features;
}
function shortestPaths(n: number, bonds: [number,number,number][]) {
  const paths = new Float64Array(n*n).fill(Infinity);
  for (let i = 0; i < n; i++) paths[i*n+i] = 0;
  for (const [a,b] of bonds) paths[a*n+b] = paths[b*n+a] = 1;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    paths[i*n+j] = Math.min(paths[i*n+j], paths[i*n+k]+paths[k*n+j]);
  }
  return paths;
}
function gaussian(value: number, mu: number, sigma: number) {
  return Math.exp(-((value-mu)**2)/(2*sigma**2));
}
/** Published FullSSPrUCe featurization of a real explicit-H conformer ensemble.
 * Conformers are averaged arithmetically, as in upstream's default Geometry;
 * the CASCADE Boltzmann weights do not apply to this separate learned model. */
export function buildCouplingFeatures(ensemble: ConformerEnsemble): CouplingFeatures {
  const n = ensemble.atomicNumbers.length;
  if (!n || n > MAX_COUPLING_ATOMS) throw new Error('The coupling model supports at most 64 atoms including hydrogens.');
  if (!ensemble.conformers.length || ensemble.atomDescriptors.length !== n || ensemble.boundsMatrix.length !== n) {
    throw new Error('Coupling inference requires a complete RDKit conformer ensemble.');
  }
  const atomFeatures = new Float32Array(MAX_COUPLING_ATOMS*ATOM_FEATURE_COUNT);
  ensemble.atomDescriptors.forEach((atom,i) => atomFeatures.set(atomFeatureVector(atom),i*ATOM_FEATURE_COUNT));
  const pairFeatures = new Float32Array(PAIR_CHANNEL_COUNT*MAX_COUPLING_ATOMS*MAX_COUPLING_ATOMS);
  const couplingTypes = new Int32Array(MAX_COUPLING_ATOMS*MAX_COUPLING_ATOMS).fill(-2);
  const stride = MAX_COUPLING_ATOMS*MAX_COUPLING_ATOMS;
  const setPair = (channel: number, i: number, j: number, value: number) => {
    pairFeatures[channel*stride+i*MAX_COUPLING_ATOMS+j] = value;
  };
  const neighbors: number[][] = Array.from({length:n},()=>[]);
  for (const [i,j,order] of ensemble.bonds) {
    neighbors[i].push(j); neighbors[j].push(i);
    const channel = [1,1.5,2,3].indexOf(order);
    if (channel >= 0) { setPair(channel,i,j,1); setPair(channel,j,i,1); }
  }
  const paths = shortestPaths(n,ensemble.bonds);
  const distances = new Float64Array(n*n);
  const gaussBins = new Float64Array(20*n*n);
  const angles = new Float64Array(n*n);
  const confCount = ensemble.conformers.length;
  for (const conformer of ensemble.conformers) {
    const xyz = conformer.coordinates;
    if (xyz.length !== n) throw new Error('Coupling conformer atom count mismatch.');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const d = Math.hypot(xyz[i][0]-xyz[j][0],xyz[i][1]-xyz[j][1],xyz[i][2]-xyz[j][2]);
      distances[i*n+j] += d/confCount;
      if (paths[i*n+j] <= config.geometry.maxBonds) {
        config.geometry.gaussBins.forEach(([mu,sigma],bin) => {
          gaussBins[bin*n*n+i*n+j] += gaussian(d,mu,sigma)/confCount;
        });
      }
    }
  }
  // Upstream loops centers in atom order and overwrites repeated neighbor pairs.
  // It stores angles ONLY in the upper triangle; preserving that convention is
  // required for weight parity even though distances are symmetric.
  for (let center = 0; center < n; center++) {
    const ns = neighbors[center];
    for (let a = 0; a < ns.length; a++) for (let b = a+1; b < ns.length; b++) {
      const i = Math.min(ns[a],ns[b]), j = Math.max(ns[a],ns[b]);
      let average = 0;
      for (const conformer of ensemble.conformers) {
        const xyz = conformer.coordinates;
        const v = xyz[i].map((value,k) => value-xyz[center][k]);
        const w = xyz[j].map((value,k) => value-xyz[center][k]);
        const cosine = v.reduce((sum,value,k) => sum+value*w[k],0)/(Math.hypot(...v)*Math.hypot(...w));
        average += Math.acos(Math.max(-1,Math.min(1,cosine)))/confCount;
      }
      angles[i*n+j] = average;
    }
  }
  let far = 0, close = 1000;
  for (const row of ensemble.boundsMatrix) for (const value of row) {
    if (value < 1000) far = Math.max(far,value);
    if (value > 0) close = Math.min(close,value);
  }
  const unknown = far+2*close;
  const corrected = (value: number) => value === 1000 ? unknown : value;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (paths[i*n+j] > config.geometry.maxBonds) {
      distances[i*n+j] = (corrected(ensemble.boundsMatrix[i][j])+corrected(ensemble.boundsMatrix[j][i]))/2;
    }
    const d = distances[i*n+j];
    let channel = 4;
    for (let bin = 0; bin < 20; bin++) setPair(channel++,i,j,gaussBins[bin*n*n+i*n+j]);
    for (const power of config.geometryArguments.feat_r_pow) setPair(channel++,i,j,Math.min(2,(d+Number(i === j))**power));
    for (const [mu,sigma] of config.geometryArguments.feat_r_gaussian_filters) setPair(channel++,i,j,gaussian(d,mu,sigma));
    for (const [mu,sigma] of config.geometryArguments.feat_angle_gaussian_filters) setPair(channel++,i,j,gaussian(angles[i*n+j],mu,sigma));
    if (channel !== PAIR_CHANNEL_COUNT) throw new Error('Coupling pair feature schema mismatch.');
    if (i === j) continue;
    const a = ensemble.atomicNumbers[i], b = ensemble.atomicNumbers[j];
    const kind = a === 1 && b === 1 ? 'HH' : a === 6 && b === 6 ? 'CC' : (a === 1 && b === 6) || (a === 6 && b === 1) ? 'CH' : '';
    const type = config.couplingTypesLut.findIndex(([k,distance]) => k === kind && distance === paths[i*n+j]);
    couplingTypes[i*MAX_COUPLING_ATOMS+j] = type;
  }
  if (pairFeatures.some((value) => !Number.isFinite(value))) throw new Error('Nonfinite coupling model features.');
  return {atomCount:n,maxAtoms:64,atomFeatures,pairFeatures,couplingTypes,
    atomicNumbers:ensemble.atomicNumbers,originalAtomIndices:ensemble.originalAtomIndices,hydrogenParents:ensemble.hydrogenParents};
}
