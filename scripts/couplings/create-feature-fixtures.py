"""Compare browser input preparation with unchanged published Python functions.

Install thejonaslab/tinygraph (not the unrelated PyPI tinygraph package),
NumPy/PyTorch/RDKit/SciPy/pandas/networkx/tqdm in a development environment.
The upstream checkout is never edited. Reuses actual shipped WASM coordinates,
so geometry-generator platform differences cannot hide a feature-port mistake.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import types
import zlib
import numpy as np
from rdkit import Chem
import rdkit.Chem.AllChem
from rdkit import rdBase
assert rdBase.rdkitVersion == '2025.09.1', 'Use native RDKit matching the WASM build.'
# Optional reuse of development-only PyTorch/scipy dependencies. RDKit and
# NumPy have already loaded from the pinned environment above.
if os.environ.get('FULLSSPRUCE_DEPENDENCY_SITE'):
    sys.path.append(os.environ['FULLSSPRUCE_DEPENDENCY_SITE'])

ROOT=Path(__file__).resolve().parents[2]
UPSTREAM=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/web-nmr-fullsspruce')
META=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/fullsspruce-coupling-meta.json')
# Avoid package __init__ eagerly loading unrelated prediction services.
pkg=types.ModuleType('fullsspruce'); pkg.__path__=[str(UPSTREAM/'fullsspruce')]
sys.modules['fullsspruce']=pkg
from fullsspruce import geom_util
from fullsspruce.featurize import atom_features, molecule_features, netdataio

meta=json.loads(META.read_text())
node_code=r'''
import init from './public/prediction/conformers/WebNMRConformers.mjs';
import fs from 'node:fs';
const m=await init({wasmBinary:fs.readFileSync('./public/prediction/conformers/WebNMRConformers.wasm')});
const f=JSON.parse(fs.readFileSync('./src/prediction/conformers/parity-fixtures.json'));
const names=process.env.WEBNMR_FEATURE_CASE ? [process.env.WEBNMR_FEATURE_CASE] : ['ethanol','butane','aspirin','chiral-butanol-stereotopic-H','glycine-zwitterion'];
const data=f.cases.filter(c=>names.includes(c.name)).map(c=>({name:c.name,molfile:c.molfile,ensemble:JSON.parse(m.generate(c.molfile,10,0xF00D,()=>{}))}));
console.log(JSON.stringify(data));
'''
inputs=json.loads(subprocess.check_output(['node','--input-type=module','-e',node_code],cwd=ROOT,text=True))
def compressed(array):
    return base64.b64encode(zlib.compress(array.tobytes(),9)).decode()
cases=[]
for case in inputs:
    e=case['ensemble']
    mol=Chem.AddHs(Chem.MolFromMolBlock(case['molfile'],removeHs=False))
    mol.RemoveAllConformers()
    for conformer in e['conformers']:
        conf=Chem.Conformer(mol.GetNumAtoms())
        for i,xyz in enumerate(conformer['coordinates']): conf.SetAtomPosition(i,xyz)
        mol.AddConformer(conf,assignId=True)
    generator=geom_util.ConformerGeometryGenerator(
      ['mean_distance_mat','mean_angle_mat','conf_gauss_bins'],
      {'max_bonds':4,'mean_mask_choice':'rdkit','g_params':geom_util.DEFAULT_GAUSS_BINS},False)
    geometry=generator.get_features(mol,None)
    assert geometry is not None
    record={'rdmol':mol,**geometry}
    vect=atom_features.feat_tensor_atom(mol,**meta['dataset_hparams']['feat_vect_args']).numpy()
    pair=molecule_features.feat_tensor_mol_geom(record,**meta['dataset_hparams']['feat_mol_geom_args']).numpy().transpose(2,0,1)
    adj=molecule_features.feat_mol_adj_std(mol,**meta['dataset_hparams']['adj_args']).numpy()
    combined=np.concatenate([adj,pair],axis=0)
    n=mol.GetNumAtoms()
    assert vect.shape==(n,94) and combined.shape==(119,n,n)
    padded_atoms=np.zeros((1,64,94),dtype='<f4'); padded_atoms[0,:n]=vect
    padded_pairs=np.zeros((1,119,64,64),dtype='<f4'); padded_pairs[0,:,:n,:n]=combined
    types_encoded=netdataio.coupling_types(mol,64,**meta['passthrough_config']['coupling_types_encoded']).astype('<i4')[None]
    npz=Path('/tmp')/f"web-nmr-coupling-features-{case['name']}.npz"
    np.savez_compressed(npz,adj=padded_pairs,vect_feat=padded_atoms,types=types_encoded,
      atomicNumbers=np.asarray(e['atomicNumbers'],dtype=np.int32),atomCount=np.asarray(n),
      coordinates=np.asarray([c['coordinates'] for c in e['conformers']]),
      originalAtomIndices=np.asarray(e['originalAtomIndices'],dtype=np.int32),
      hydrogenParents=np.asarray(e['hydrogenParents'],dtype=np.int32))
    cases.append({'name':case['name'],'molfile':case['molfile'],'ensemble':e,
      'atomFeaturesZlibBase64':compressed(padded_atoms),
      'pairFeaturesZlibBase64':compressed(padded_pairs),
      'couplingTypesZlibBase64':compressed(types_encoded)})
    print(f'Native FullSSPrUCe features: {case["name"]}, {n} explicit-H atoms -> {npz}')
output=ROOT/'src/prediction/couplings/feature-fixtures.json'
if os.environ.get('WEBNMR_FEATURE_CASE'):
    previous=json.loads(output.read_text())['cases']
    replacements={case['name']:case for case in cases}
    cases=[replacements.pop(case['name'],case) for case in previous]+list(replacements.values())
output.write_text(json.dumps({'upstreamCommit':'de4fcad693eccca469b12e3505d8c3d8fe2458d5','cases':cases},indent=2)+'\n')
print(f'Wrote native feature parity fixtures: {output}')
