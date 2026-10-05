# FullSSPrUCe feature port

`buildCouplingFeatures(ensemble)` prepares the published default ETKDG coupling
model's tensors from genuine RDKit explicit-H conformers:

- `atomFeatures`: Float32, `[1,64,94]`.
- `pairFeatures`: Float32, `[1,119,64,64]`, channels first.
- `couplingTypes`: Int32, `[1,64,64]`, raw upstream codes (`-2` for
  diagonal/padding, `-1` for unclassified, `0..11` for the checkpoint's
  twelve coupling classes). The model adds two before embedding.
- Original atom indices and hydrogen attachment mappings are retained.

The 94 atom features match the upstream order, enum sets, and exact constants,
including its carbon electronegativity value of 2.26. MMFF atom typing is done
on a copied molecule, and atom descriptors come from that typed copy, matching
`feat_tensor_atom`'s sequence without altering the source graph.

The 119 channels comprise 4 bond-order channels, 20 ensemble distance Gaussian
bins, 36 inverse distance powers, 26 mean-distance Gaussian filters, and 33
mean-angle Gaussian filters. Means are arithmetic, as in the original default
geometry generator. CASCADE's separate Boltzmann weights are not used here.
Distance pairs beyond four bonds use corrected RDKit bounds; the conformer
Gaussian bins become zero at those pairs. Upper-triangle-only angle storage,
including the original zero sentinel transformed by Gaussian filters, is
preserved exactly. Padding is zero for features, rather than populating
Gaussian values for nonexistent atoms.

The conformer ensemble uses ETKDGv3/MMFF94 with a reproducible seed and pruning.
The published predictor accepts supplied conformers (`use_confs=True`), which
is the mode reproduced by the feature port. Its automatic geometry-generation
mode also optimizes with MMFF, but has different seed/pruning/iteration defaults.

The numerical reference fixtures execute the unchanged published functions
from commit `de4fcad693eccca469b12e3505d8c3d8fe2458d5` using the actual shipped
WASM coordinates. Every element of the padded 94/119 tensors and all coupling
type codes is tested. Native RDKit is pinned to 2025.09.1, matching the browser
binary: later RDKit versions change some distance-bound heuristics and must not
be mixed when claiming exact feature parity. Tests cover ethanol, butane,
aspirin, a chiral alcohol with stereotopic hydrogens, and a charged zwitterion.

To regenerate fixtures, install Python dependencies and the actual tinygraph
source from `https://github.com/thejonaslab/tinygraph` (revision
`c7b4b57fc9b298a78ce93498b17233413574d8e9`). The PyPI package of that name is
unrelated. With native `rdkit==2025.9.1`, run
`python scripts/couplings/create-feature-fixtures.py <upstream checkout> <checkpoint meta JSON>`.
If using the preexisting developer environments from this task, invoke:

```
FULLSSPRUCE_DEPENDENCY_SITE=/tmp/web-nmr-spin-venv/lib/python3.14/site-packages \
/tmp/webnmr-conformer-build/venv/bin/python scripts/couplings/create-feature-fixtures.py
```

`FULLSSPRUCE_DEPENDENCY_SITE` is optional; it reuses development-only
PyTorch/SciPy dependencies after the pinned RDKit/NumPy have loaded. It has no
role in the deployed app. `.npz` outputs under `/tmp` are also available for
native PyTorch versus browser ONNX checks of actual molecule tensors.
Set `WEBNMR_FEATURE_CASE=butane` (or another existing case name) to independently
regenerate just that reference case and preserve all other fixture entries and
their `.npz` files.

Source references:
- https://github.com/thejonaslab/fullsspruce-public/blob/de4fcad693eccca469b12e3505d8c3d8fe2458d5/fullsspruce/featurize/atom_features.py
- https://github.com/thejonaslab/fullsspruce-public/blob/de4fcad693eccca469b12e3505d8c3d8fe2458d5/fullsspruce/featurize/molecule_features.py
- https://github.com/thejonaslab/fullsspruce-public/blob/de4fcad693eccca469b12e3505d8c3d8fe2458d5/fullsspruce/geom_util.py
