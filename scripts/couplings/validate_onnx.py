#!/usr/bin/env python3
"""Compare all fixed64 mean/std ONNX outputs to original PyTorch fixtures.
Requires numpy+onnxruntime. Usage: python validate_onnx.py
"""
import hashlib,json,time
from pathlib import Path
import numpy as np
import onnxruntime as ort
root=Path(__file__).resolve().parents[2]
fixtures_dir=Path(__file__).resolve().parent/'fixtures'
reference=json.loads((fixtures_dir/'reference.json').read_text())
assets=root/'public/prediction/couplings'
manifest=json.loads((assets/'fullsspruce-etkdg-coupling.json').read_text())
parts=[];offset=0
for chunk in manifest['weightsChunks']:
 data=(assets/chunk['file']).read_bytes()
 assert chunk['byteOffset']==offset and chunk['byteLength']==len(data)
 assert hashlib.sha256(data).hexdigest()==chunk['sha256']
 parts.append(data);offset+=len(data)
model_bytes=b''.join(parts)
assert len(model_bytes)==manifest['weightsByteLength']==28383464
assert hashlib.sha256(model_bytes).hexdigest()==manifest['weightsSha256']=='58b7f73427439c05fdd4c9689801bb2fe2d34ac960f818ebba122f731a0d91f4'
session=ort.InferenceSession(model_bytes,providers=['CPUExecutionProvider'])
report={'runtime':ort.__version__,'provider':'CPUExecutionProvider','reference':reference['reference'],'cases':[]}
for fixture in reference['fixtures']:
 raw=(fixtures_dir/fixture['file']).read_bytes()
 arrays={key:np.frombuffer(raw,dtype='<i4' if key=='couplingTypes' else '<f4',count=spec['elementCount'],offset=spec['byteOffset']) for key,spec in fixture['arrays'].items()}
 inputs={'adj':arrays['pairFeatures'].reshape(1,119,64,64),'vect_feat':arrays['atomFeatures'].reshape(1,64,94),'coupling_types':arrays['couplingTypes'].astype(np.int64).reshape(1,64,64)}
 start=time.time();mu,std=session.run(None,inputs)
 mu_error=float(np.max(np.abs(mu.reshape(-1)-arrays['meanMatrixHz'])))
 std_error=float(np.max(np.abs(std.reshape(-1)-arrays['stdMatrixHz'])))
 if mu_error>=.001 or std_error>=.001: raise ValueError(f'{fixture["name"]}: ONNX parity failed {mu_error}, {std_error}')
 report['cases'].append({'name':fixture['name'],'meanMaxErrorHz':mu_error,'stdMaxErrorHz':std_error,'elapsedMs':(time.time()-start)*1000})
report['status']='PASS';report['outputComparisons']=len(report['cases'])*4096*2
report['maximumMeanErrorHz']=max(case['meanMaxErrorHz'] for case in report['cases'])
report['maximumStdErrorHz']=max(case['stdMaxErrorHz'] for case in report['cases'])
(fixtures_dir/'native-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
