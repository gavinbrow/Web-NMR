export type Coordinates = [number, number, number][];
export interface Conformer {
  id: number;
  coordinates: Coordinates;
  energyKcal: number;
  weight: number;
  converged: boolean;
}
export interface AtomDescriptor {
  atomicNumber: number;
  totalValence: number;
  aromatic: boolean;
  hybridization: number;
  formalCharge: number;
  defaultValence: number;
  ringSizes: number[];
  chiralTag: number;
  mmffAtomType: number;
}
export interface ConformerEnsemble {
  rdkitVersion: string;
  method: "ETKDGv3/MMFF94";
  randomSeed: number;
  originalAtomCount: number;
  atomicNumbers: number[];
  /** 0 denotes natural/default isotope. Hydrogen 2/3 are D/T, not 1H sites. */
  atomIsotopes: number[];
  /** Original zero-based molfile atom index, or -1 for a newly added hydrogen. */
  originalAtomIndices: number[];
  /** Explicit-H parent index in atomicNumbers, or -1 for nonhydrogens. */
  hydrogenParents: number[];
  /** Geometry-aligned isotope-substitution keys. Empty for non-H atoms.
   * Enantiomeric replacement keys collapse only for an achiral source graph. */
  hydrogenSiteKeys: string[];
  /** Sparse natural/1H pairs within the learned J domain (2–4 bonds).
   * Keys replace both sites with the same virtual isotope and preserve
   * magnetic nonequivalence, unlike grouping only by individual site keys. */
  hydrogenPairEquivalence: { atomIndices: [number, number]; key: string }[];
  hydrogenIdentityMethod: "3D isotope replacement / canonical isomeric SMILES";
  hydrogenAlignmentWarnings: string[];
  atomDescriptors: AtomDescriptor[];
  bonds: [number, number, number][];
  /** RDKit bounds: lower below the diagonal, upper above it (angstroms).
   * GetMoleculeBoundsMatrix(set15bounds=true,scaleVDW=false,doTriangleSmoothing=true). */
  boundsMatrix: number[][];
  conformers: Conformer[];
}
export interface ConformerProgress {
  stage: "loading" | "embedding" | "optimizing" | "complete";
  completed: number;
  total: number;
}
export interface ConformerOptions {
  numConformers?: number;
  randomSeed?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ConformerProgress) => void;
}
export interface ConformerModule {
  generate(
    molfile: string,
    count: number,
    seed: number,
    progress: (stage: string, completed: number, total: number) => void,
  ): string;
}
