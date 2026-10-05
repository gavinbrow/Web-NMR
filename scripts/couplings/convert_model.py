#!/usr/bin/env python3
"""Export original FullSSPrUCe ETKDG coupling model to fixed64, float32 ONNX.
Usage: python convert_model.py /path/to/fullsspruce-public
Requires pytorch, numpy and onnx. The upstream checkpoint is trusted only after
its SHA256 matches the pinned original below. No retraining or quantization.
"""
import argparse, hashlib, json, sys, types, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
import numpy as np
import torch
from chunk_model import write_model_chunks

UPSTREAM_REVISION='de4fcad693eccca469b12e3505d8c3d8fe2458d5'
SOURCE_SHA='0a847ed10df34094fd3b052ae5e74428c85be38f244aeb0941e2e87dc73f09d3'

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('upstream',type=Path)
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[2]/'public/prediction/couplings')
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
source=args.upstream/'fullsspruce/default_predict_models/default_coupling_ETKDG_model.chk'
digest=hashlib.sha256(source.read_bytes()).hexdigest()
if SOURCE_SHA and digest!=SOURCE_SHA: raise ValueError('Unrecognized upstream coupling model checksum')
# Avoid package __init__ imports unrelated to this pretrained model.
for name,path in [('fullsspruce',args.upstream/'fullsspruce'),('fullsspruce.model',args.upstream/'fullsspruce/model')]:
 pkg=types.ModuleType(name);pkg.__path__=[str(path)];sys.modules[name]=pkg
import fullsspruce.model.coupling
model=torch.load(source,map_location='cpu',weights_only=False).eval()

class CouplingExport(torch.nn.Module):
 def __init__(self,net): super().__init__();self.net=net
 def forward(self,adj,vect_feat,coupling_types):
  out=self.net(adj,vect_feat,torch.ones((1,64)),torch.zeros(1,dtype=torch.int64),None,passthrough_coupling_types_encoded=coupling_types)
  return out['coupling_mu'],out['coupling_std']

wrapper=CouplingExport(model).eval()
inputs=(torch.zeros((1,119,64,64)),torch.zeros((1,64,94)),torch.full((1,64,64),-2,dtype=torch.int64))
with tempfile.TemporaryDirectory(prefix='fullsspruce-export-') as temporary:
 output=Path(temporary)/'fullsspruce-etkdg-coupling.onnx'
 with torch.no_grad():
  torch.onnx.export(wrapper,inputs,output,input_names=['adj','vect_feat','coupling_types'],output_names=['coupling_mu','coupling_std'],opset_version=17,dynamo=False,do_constant_folding=True)
  zero_mu,zero_std=wrapper(*inputs)
 onnx_bytes=output.read_bytes()
chunks=write_model_chunks(onnx_bytes,args.output)
manifest={
 'format':'fullsspruce-onnx-chunks-v2','id':'fullsspruce-etkdg-coupling',
 'sourceRepository':'https://github.com/thejonaslab/fullsspruce-public',
 'upstreamRevision':UPSTREAM_REVISION,
 'sourceFile':'fullsspruce/default_predict_models/default_coupling_ETKDG_model.chk',
 'sourceSha256':digest,'weightsChunks':chunks,'weightsSha256':hashlib.sha256(onnx_bytes).hexdigest(),
 'weightsByteLength':len(onnx_bytes),'floatPrecision':'float32','onnxOpset':17,
 'licenseDeclaration':'MIT (upstream setup.py)',
 'citation':'https://doi.org/10.1039/D3SC01930F',
 'architecture':'Decode14:8edge/vertexGRUsteps,256features,10bootstrapheads,14typeembeddings',
 'inputShapes':{'adj':[1,119,64,64],'vect_feat':[1,64,94],'coupling_types':[1,64,64]},
 'outputShapes':{'coupling_mu':[1,64,64,1],'coupling_std':[1,64,64,1]},
 'maxExplicitAtoms':64,'trainedTypes':['1J_CH','2J_HH','3J_HH','4J_HH'],
 'couplingTypes':{'-2':'padding/diagonal','-1':'other','0':'1J_CH','1':'2J_HH','2':'3J_HH','3':'4J_HH','4':'5J_HH','5':'6J_HH','6':'7J_HH','7':'2J_CH','8':'3J_CH','9':'1J_CC','10':'2J_CC','11':'3J_CC'},
 'uncertainty':'sqrt(unbiased variance across10bootstrap heads +1e-5),Hz',
 'zeroInputReference':{'couplingTypeCode':-2,'meanHz':float(zero_mu[0,0,0,0]),'stdHz':float(zero_std[0,0,0,0])},
}
(args.output/'fullsspruce-etkdg-coupling.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Remove legacy deployment output when upgrading an existing asset directory.
(args.output/'fullsspruce-etkdg-coupling.onnx').unlink(missing_ok=True)
print(json.dumps(manifest,indent=2))
