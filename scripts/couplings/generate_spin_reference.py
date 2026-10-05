import numpy as np,json
from pathlib import Path
cases=[{'name':'ABC','shifts':[1.2,1.215,1.25],'couplings':[[0,1,-12],[0,2,8],[1,2,3]],'field':400}, {'name':'ABX','shifts':[3.52,3.58,1.1],'couplings':[[0,1,-14],[0,2,6],[1,2,9]],'field':600}]
for case in cases:
 n=len(case['shifts']);dim=2**n;center=np.mean(case['shifts']);mat=np.zeros((dim,dim));raiseop=np.zeros_like(mat)
 for s in range(dim):
  mat[s,s]=sum((d-center)*case['field']*(.5 if s&(1<<i) else -.5) for i,d in enumerate(case['shifts']))
  for a,b,j in case['couplings']:
   same=bool(s&(1<<a))==bool(s&(1<<b))
   mat[s,s]+=j*(.25 if same else -.25)
   if not same: mat[s^(1<<a)^(1<<b),s]+=j/2
  for i in range(n):
   if not s&(1<<i): raiseop[s|(1<<i),s]+=1
 values,vectors=np.linalg.eigh(mat);transition=vectors.T@raiseop@vectors
 lines=[]
 for h in range(dim):
  for l in range(dim):
   intensity=transition[h,l]**2
   if intensity>1e-12:lines.append({'ppm':center+(values[h]-values[l])/case['field'],'weight':intensity})
 total=sum(l['weight'] for l in lines)
 for l in lines:l['weight']*=n/total
 case['lines']=sorted(lines,key=lambda l:-l['ppm'])
Path('src/prediction/spinSystem.fixtures.json').write_text(json.dumps(cases,indent=2)+'\n')
