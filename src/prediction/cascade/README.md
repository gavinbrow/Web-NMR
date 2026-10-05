CASCADE browser neural inference
===============================

This is a float32 tensor-operation port of Paton Lab CASCADE, upstream revision
`c44c3c41e59acc909a00d0a2414dd9af5dc775b0`. No model training or statistical
substitution is performed. Original embedding and Dense tensors are extracted
from upstream HDF5 files without quantization. Optimizer state is discarded.

- Carbon: `code/predicting_model/C/ExpNN-ff/best_model.hdf5`, trained against
  experimental carbon shifts and MMFF conformers. Gaussian RBF delta = 0.04.
- Proton: `code/predicting_model/H/DFTNN/best_model_H_DFTNN.hdf5`, trained against
  DFT proton shifts and DFT geometries. Gaussian RBF delta = 0.1. Using MMFF
  conformers for this model introduces an unvalidated geometry-domain change.

The 3-block network receives explicit-H atom tokens and spatial atom pairs under
5 Å, capped at 100 neighbors. Each edge has 256 Gaussian radial features. It
predicts shifts for every individual H/C atom; atom identity is not collapsed
by attachment or assumed magnetic equivalence. An ensemble is averaged with
Boltzmann weights using R = 0.001987 kcal/(mol K) and T = 298.15 K by default.
Ensemble standard deviation measures conformer variation, not calibrated error.

`inferCascadeEnsemble` imports TensorFlow.js lazily. Browser WASM is preferred;
CPU is the fallback. Models and WASM are local static assets in `public/cascade`;
all input structures, conformers, and predictions stay in the browser. Neither
Python nor any prediction endpoint is used at runtime. Weight assets are checked
against pinned SHA-256 values before tensor construction. Unsupported elements
are rejected rather than mapped silently to the upstream unknown token.

Rebuild assets with `scripts/cascade/convert_weights.py /path/to/patonlab/CASCADE`
using Python numpy+h5py. See `scripts/cascade/generate_reference.py` for the
independent Python Keras/reference-feature fixture generation. The CASCADE MIT
license is distributed in `public/cascade/LICENSE-CASCADE.txt`.

Numerical validation (2026-10-04): six molecules and two fixed conformers per
molecule produce 24 H/C graph evaluations and 98 atom comparisons against the
independent Python Keras reference. CPU and browser WASM maximum absolute error
is 0.0000152588 ppm. The packaged browser worker reports no external resources,
98 cached weight tensors, and zero tensors after disposal. Runtime tests cover
exact preprocessing, ensemble weights, individual H identities, cancellation,
and rejection of altered weights. These checks establish numerical port parity;
experimental accuracy of the proton model on force-field geometry is not newly
validated. The development harness is
`/scripts/cascade/browser-validation.html`.

Cite Guan et al., Chemical Science (2021), DOI 10.1039/D1SC03343C.
https://github.com/patonlab/CASCADE
