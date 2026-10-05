#!/usr/bin/env python3
"""Fixed upstream-feature fixtures and original PyTorch coupling outputs.
Usage: python generate_reference.py /path/to/fullsspruce /tmp/features-*.npz
Requires torch+numpy, no modification of upstream tree. Binary fixture layout
contains adj(f32),atoms(f32),types(i32),mean(f32),std(f32), all little endian.
"""
import argparse, hashlib, json, sys, types
from pathlib import Path
import numpy as np
import torch

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('upstream',type=Path);parser.add_argument('fixtures',type=Path,nargs='+')
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent/'fixtures')
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
root=args.upstream/'fullsspruce'
source=root/'default_predict_models/default_coupling_ETKDG_model.chk'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='0a847ed10df34094fd3b052ae5e74428c85be38f244aeb0941e2e87dc73f09d3'
for name,path in [('fullsspruce',root),('fullsspruce.model',root/'model')]:
 pkg=types.ModuleType(name);pkg.__path__=[str(path)];sys.modules[name]=pkg
import fullsspruce.model.coupling
net=torch.load(source,weights_only=False,map_location='cpu').eval()
fixtures=[]
for source in args.fixtures:
 data=np.load(source)
 name=source.stem.removeprefix('web-nmr-coupling-features-')
 adj=data['adj'].astype('<f4');atom=data['vect_feat'].astype('<f4');ctype=data['types'].astype('<i4')
 with torch.no_grad():
  output=net(torch.from_numpy(adj),torch.from_numpy(atom),torch.ones((1,64)),torch.zeros(1,dtype=torch.int64),None,passthrough_coupling_types_encoded=torch.from_numpy(ctype.astype(np.int64)))
 mu=output['coupling_mu'].numpy().astype('<f4');std=output['coupling_std'].numpy().astype('<f4')
 arrays={'pairFeatures':adj,'atomFeatures':atom,'couplingTypes':ctype,'meanMatrixHz':mu,'stdMatrixHz':std}
 raw=b'';specs={}
 for key,array in arrays.items():
  specs[key]={'byteOffset':len(raw),'elementCount':array.size,'dtype':str(array.dtype)}
  raw+=array.tobytes(order='C')
 filename=name+'.bin';(args.output/filename).write_bytes(raw)
 entry={'name':name,'file':filename,'sha256':hashlib.sha256(raw).hexdigest(),'arrays':specs,
 'atomCount':int(data['atomCount']),'maxAtoms':64,'atomicNumbers':data['atomicNumbers'].tolist(),
 'originalAtomIndices':data['originalAtomIndices'].tolist(),'hydrogenParents':data['hydrogenParents'].tolist()}
 fixtures.append(entry)
 n=entry['atomCount'];sample=[]
 for i in range(n):
  for j in range(i+1,n):
   if data['atomicNumbers'][i]==1 and data['atomicNumbers'][j]==1 and ctype[0,i,j] in [1,2,3]:
    sample.append((i,j,float(mu[0,i,j,0]),float(std[0,i,j,0])))
 print(name,sample[:10])
result={'reference':'Original upstream FullSSPrUCe PyTorch checkpoint, unmodified upstream RDKit featurization','torchVersion':torch.__version__,'fixtures':fixtures}
(args.output/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
