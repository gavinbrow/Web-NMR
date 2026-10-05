#!/usr/bin/env python3
"""Generate fixed-conformer CASCADE parity fixtures using independent Python Keras.
Usage: python generate_reference.py /path/to/NMR-Predict
Requires tensorflow, keras, h5py, numpy, rdkit. Does not modify reference repo.
"""
import argparse, json, os, sys, types
from pathlib import Path
os.environ['TF_CPP_MIN_LOG_LEVEL']='3'
sys.dont_write_bytecode=True
import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('reference_repo', type=Path)
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[2]/'src/prediction/cascade/reference-fixtures.json')
args=parser.parse_args()
package=types.ModuleType('cascade_reference')
package.__path__=[str(args.reference_repo/'backend/app/engines/cascade_nfp')]
sys.modules['cascade_reference']=package
from cascade_reference.model import build_cascade_model
from cascade_reference.preprocessor import load_preprocessor_from_legacy_pickle
from cascade_reference.sequence import assemble_batch
import keras, tensorflow as tf

upstream=args.reference_repo/'backend/vendor/cascade/CASCADE'
pp=load_preprocessor_from_legacy_pickle(str(upstream/'cascade-Jupyternotebook-SMILES/models/cascade/preprocessor.p'))
models={}
for nucleus,source in [('13C','C/ExpNN-ff/best_model.hdf5'),('1H','H/DFTNN/best_model_H_DFTNN.hdf5')]:
 model=build_cascade_model(pp.atom_classes)
 model.load_weights(str(upstream/'code/predicting_model'/source))
 models[nucleus]=model

cases=[('ethanol','CCO'),('acetone','CC(=O)C'),('benzene','c1ccccc1'),('fluoroethane','CCF'),('L-lactic-acid','C[C@@H](O)C(=O)O'),('chloromethane','CCl')]
fixtures=[]
for name,smiles in cases:
 mol=Chem.AddHs(Chem.MolFromSmiles(smiles))
 params=AllChem.ETKDGv3();params.randomSeed=0xF00D;params.pruneRmsThresh=-1.0
 confs=list(AllChem.EmbedMultipleConfs(mol,numConfs=2,params=params))
 energies=AllChem.MMFFOptimizeMoleculeConfs(mol,maxIters=500,mmffVariant='MMFF94')
 entry={'name':name,'smiles':smiles,'atomicNumbers':[a.GetAtomicNum() for a in mol.GetAtoms()],'conformers':[]}
 for conf_id,(_,energy) in zip(confs,energies):
  clone=Chem.Mol(mol);conf=mol.GetConformer(conf_id);clone.RemoveAllConformers();clone.AddConformer(conf,assignId=True)
  coords=conf.GetPositions().tolist()
  predictions={}; features={}
  for nucleus,z,delta in [('13C',6,.04),('1H',1,.1)]:
   target=np.array([a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum()==z],dtype=int)
   feat=pp.construct(clone,target)
   batch=assemble_batch([feat])
   k=np.arange(256)
   batch['distance_rbf']=np.exp(-(np.atleast_2d(feat['distance']).T-delta*k)**2/delta).astype(np.float32)
   # H uses unmodified app.engines.cascade_nfp RBF; C has ExpNN-ff upstream delta.
   values=models[nucleus].predict_on_batch(batch).reshape(-1)
   predictions[nucleus]={'atomIndices':target.tolist(),'shiftsPpm':values.tolist()}
   features[nucleus]={'atomTokens':feat['atom'].tolist(),'receivers':feat['connectivity'][:,0].tolist(),'senders':feat['connectivity'][:,1].tolist(),'distances':feat['distance'].tolist(),'rbfFirstEdge':batch['distance_rbf'][0].tolist()}
  entry['conformers'].append({'coordinates':coords,'energyKcal':float(energy),'predictions':predictions,'features':features})
 fixtures.append(entry)
 print(name,len(entry['atomicNumbers']),predictions)
result={'reference':'NMR-Predict cascade_nfp Keras3 port; carbon RBF delta matches upstream ExpNN-ff graph_network.py','kerasVersion':keras.__version__,'tensorflowVersion':tf.__version__,'rdkitVersion':Chem.rdBase.rdkitVersion,'fixtureCount':len(fixtures),'fixtures':fixtures}
args.output.write_text(json.dumps(result,indent=2)+'\n')
