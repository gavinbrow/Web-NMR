#!/usr/bin/env python3
"""Reproducibly extract upstream CASCADE tensors; no TensorFlow/model retraining.
Requires Python numpy+h5py. Usage: python convert_weights.py /path/to/CASCADE
"""
import argparse, hashlib, json, pickle
from pathlib import Path
import h5py
import numpy as np

REVISION = 'c44c3c41e59acc909a00d0a2414dd9af5dc775b0'
# Pin original files before opening pickle/HDF5. Filled from the vendored upstream.
EXPECTED_SOURCE_HASHES = {
    'carbon-expnn-ff': 'f1030c5c1d5e59bb7d162faaca2720a1401b151145f4b598c81582da256a39d4',
    'proton-dftnn': '256c7c334c386105aac0532a6d25d5ec14c7e28c2238a9308fc15ff6a3a80b01',
}
SOURCES = {
    'carbon-expnn-ff': ('code/predicting_model/C/ExpNN-ff/best_model.hdf5', '13C', 0.04),
    'proton-dftnn': ('code/predicting_model/H/DFTNN/best_model_H_DFTNN.hdf5', '1H', 0.1),
}

class LegacyState:
    def __setstate__(self, state): self.__dict__.update(state)

class PreprocessorUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {
            ('nfp.preprocessing.preprocessor', 'MolAPreprocessor'),
            ('nfp.preprocessing.features', 'Tokenizer'),
            ('nfp.preprocessing.features', 'atom_features'),
            ('nfp.preprocessing.features', 'bond_features_v1'),
        }
        if (module, name) in allowed: return LegacyState
        raise pickle.UnpicklingError(f'Unexpected pickle global {module}.{name}')

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('upstream', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2] / 'public/cascade')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    pp_path = args.upstream / 'cascade-Jupyternotebook-SMILES/models/cascade/preprocessor.p'
    pp_bytes = pp_path.read_bytes()
    if sha(pp_bytes) != 'e9160321e192de2a5ddf706be7b048a634b79e8d928feea6b1558151349bcb21':
        raise ValueError('Unrecognized CASCADE preprocessor checksum')
    pp = PreprocessorUnpickler(pp_path.open('rb')).load()['preprocessor']
    for identifier, (source, nucleus, delta) in SOURCES.items():
        original = args.upstream / source
        if sha(original.read_bytes()) != EXPECTED_SOURCE_HASHES[identifier]:
            raise ValueError(f'Unrecognized original CASCADE weights for {identifier}')
        specs, chunks, offset = [], [], 0
        with h5py.File(original, 'r') as file:
            model_config = json.loads(file.attrs['model_config'])
            configs = {layer['config']['name']: layer['config'] for layer in model_config['config']['layers']}
            for layer_name in ['atom_embedding', 'atomwise_shift'] + [f'dense_{i}' for i in range(1,26)]:
                datasets = {}
                file['model_weights'][layer_name].visititems(lambda name, value: datasets.__setitem__(name.split('/')[-1].split(':')[0], value[...]) if isinstance(value, h5py.Dataset) else None)
                for name, value in sorted(datasets.items()):
                    array = np.asarray(value, dtype='<f4')
                    chunk = array.tobytes(order='C')
                    specs.append({'name': f'{layer_name}/{name}', 'shape': list(array.shape), 'byteOffset': offset, 'byteLength': len(chunk)})
                    chunks.append(chunk); offset += len(chunk)
            activations = {f'dense_{i}': configs[f'dense_{i}']['activation'] for i in range(1,26)}
        binary = b''.join(chunks)
        (args.output / f'{identifier}.bin').write_bytes(binary)
        manifest = {
            'format': 'cascade-float32-v1', 'id': identifier, 'nucleus': nucleus,
            'lineage': 'experimental carbon / MMFF geometries' if nucleus=='13C' else 'DFT proton shifts / DFT geometries',
            'source': source, 'sourceSha256': sha(original.read_bytes()), 'upstreamRevision': REVISION,
            'upstreamRepository': 'https://github.com/patonlab/CASCADE',
            'citation': 'https://doi.org/10.1039/D1SC03343C', 'license': 'MIT',
            'weightsFile': f'{identifier}.bin', 'weightsSha256': sha(binary), 'weightsByteLength': len(binary),
            'features': {'atomTokens': {str(k): v for k,v in pp.atom_tokenizer._data.items()}, 'atomClasses': pp.atom_tokenizer.num_classes+1, 'explicitHs': pp.explicit_hs, 'cutoffAngstrom': pp.cutoff, 'maxNeighbors': pp.n_neighbors, 'rbfDimension':256, 'rbfDelta':delta, 'rbfMu':0},
            'activations': activations, 'tensors': specs,
        }
        (args.output / f'{identifier}.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(identifier, len(binary), manifest['sourceSha256'], manifest['weightsSha256'])
    (args.output / 'LICENSE-CASCADE.txt').write_text((args.upstream/'LICENSE').read_text())

if __name__=='__main__': main()
