# Browser conformer runtime

The shipped WebAssembly implements RDKit 2025.09.1 ETKDGv3 and MMFF94 directly.
It does not use OpenChemLib-generated geometry, a coordinate heuristic, a
remote service, or the limited RDKit.js package.

`generateConformers(molfile, {signal, onProgress, numConformers, randomSeed})`
returns an explicit-hydrogen ensemble sorted by MMFF94 energy. Original
molfile atom order is retained. `originalAtomIndices` is -1 only for appended
hydrogens, and `hydrogenParents` identifies hydrogen attachments.
`atomIsotopes` retains isotope mass numbers (0 is natural/default; hydrogen
2/3 is D/T and must not become a 1H site). `hydrogenSiteKeys` identifies each
actual 3D hydrogen site by isotope substitution and canonical isomeric SMILES.
Original whole-molecule chirality decides whether globally mirrored replacement
keys collapse for enantiotopic equivalence. Physical alignment always uses the
uncollapsed keys, so enantiotopic sites retain their relative identities for
coupling calculations. Same-parent, same-isotope stereotopic hydrogen coordinates are
permuted across conformers to agree with the first
energy-sorted conformer's physical site identity, before model averaging.
This preserves atom order and prevents mixing Ha/Hb when ETKDG swaps the
unlabeled prochiral H positions. It assigns no pro-R/pro-S nomenclature.
Original explicit-H atom slots and original indices remain fixed; their
coordinates are aligned by physical site using the same method. Distinct
isotopes never swap. The substitution marker is chosen to differ from all
existing hydrogen isotopes, so a source D/T atom cannot erase a replacement's
stereochemical distinction. Conformers whose isotope keys cannot be aligned
produce an explicit stereochemistry error rather than mixing different sites. Coordinates
are in angstroms and energies in kcal/mol. At most ten conformers are embedded;
RMS pruning can yield fewer. The seed defaults to `0xF00D`, pruning is 0.5 Å,
optimization runs up to 500 iterations, and normalized Boltzmann weights use
`R = 0.001987 kcal/(mol K)` and `T = 298.15 K` to match the reference backend.
An unconverged MMFF optimization is retained and marked `converged: false`,
matching the reference's use of the returned energy. Missing MMFF parameters
or embedding failure produces an explicit error without substitute geometry.

`hydrogenPairEquivalence` is a sparse array of `{atomIndices: [a,b], key}` for
natural/1H pairs separated by two to four bonds, within the 64-atom learned J
domain. Replacing both sites with the same virtual isotope gives a canonical
pair key. These keys average physically symmetry-related J values while
retaining different pair relationships in magnetically nonequivalent AA′BB′
systems. Grouping by individual chemical site equivalence alone cannot do this.

A dedicated worker isolates each calculation; aborting terminates it, including
synchronous embedding/optimization. Static glue and WASM are loaded from the
app's own origin. Molecule data never leaves the browser. A direct-thread API
is available in `runtime.ts` for callers already running in a worker.

## Rebuilding

Run `bash scripts/conformers/build-wasm.sh`. The default disposable build
checkout is `/tmp/webnmr-conformer-build`; override it with
`WEBNMR_CONFORMER_BUILD_ROOT`. Python 3, Git, curl, tar, and a native C++ compiler
are required for the build tools. The script pins RDKit's release commit,
Emscripten 4.0.10, Boost 1.85.0 and Eigen 3.4.0. Source archives are hash checked.
Only the disposable RDKit checkout is patched to add the bridge target.
Deployment uses the generated `.mjs` and `.wasm` files under
`public/prediction/conformers`, with their licenses and checksum manifest.
End users need no Python, compiler, package manager, or chemistry backend.

## Verification

`npm test -- src/prediction/conformers/conformers.test.ts` executes the actual
shipped WASM. The fixtures come from native RDKit 2025.09.1 using the same
molfile round trip, atom order, seed, pruning, and MMFF settings. Tests compare
atom/hydrogen mapping, conformer count, energies and every pairwise distance,
including defined chiral centers, a symmetric molecule with multiple CH2
sites, explicit isotope-defined chirality, a terminal alkene, and a flexible
ensemble. Both isotope-derived site keys and stereochemical handedness are
checked against native RDKit. Regenerate fixtures
with Python and `rdkit==2025.9.1` using
`scripts/conformers/create-fixtures.py`. A geometry comparison is invariant to
rigid rotation/translation; it does not require platform-specific Cartesian
orientations to match bit-for-bit.
`mapping.test.ts` additionally runs the actual drawing/SMILES import, molfile
export, cleaning and coordinate-edit paths into WASM, checking original atom
slots, explicit H retention, isotope-defined chirality and both alkene geometries.

Upstream source/documentation:
- https://github.com/rdkit/rdkit/tree/Release_2025_09_1/Code/GraphMol/DistGeomHelpers
- https://github.com/rdkit/rdkit/tree/Release_2025_09_1/Code/GraphMol/ForceFieldHelpers/MMFF
- https://github.com/rdkit/rdkit/blob/Release_2025_09_1/Code/MinimalLib/docker/Dockerfile_3_rdkit_build
- https://emscripten.org/docs/compiling/WebAssembly.html
