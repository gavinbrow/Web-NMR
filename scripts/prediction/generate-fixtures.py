#!/usr/bin/env python3
"""Run the original JVM predictor jars to produce independently generated fixtures.
Usage: python3 scripts/prediction/generate-fixtures.py /path/to/cdk /path/to/jdk/bin
"""
import json, pathlib, subprocess, sys, tempfile
root=pathlib.Path(__file__).resolve().parents[2]
source=pathlib.Path(sys.argv[1]); java=pathlib.Path(sys.argv[2])
smiles=['CCO','CC(=O)C','c1ccccc1','CCOC(=O)C','COc1ccccc1','c1ccncc1','C1CCCCC1','C[Si](C)(C)C','C[NH3+]','CC#N','c1cc[nH]c1','CC(=O)Oc1ccccc1C(=O)O','Cn1c(=O)c2c(ncn2C)n(C)c1=O','c1ccc2ccccc2c1','CC(=O)Nc1ccc(O)cc1','CCOCC','CC(=O)O','C[C@H](N)C(=O)O','O=[N+]([O-])c1ccccc1','Clc1ccccc1','C1CCOC1','C1CCC2CCCCC2C1','C','N']
with tempfile.TemporaryDirectory() as compiled:
    subprocess.run([str(java/'javac'),'-cp',str(source/'cdk-2.9.jar')+':'+str(source/'predictorh.jar'),'-d',compiled,str(root/'scripts/prediction/Reference.java')],check=True)
    for nucleus,suffix,name in [('1H','h','proton'),('13C','c','carbon')]:
        output=subprocess.check_output([str(java/'java'),'-Xmx2g','-cp',compiled+':'+str(source/'cdk-2.9.jar')+':'+str(source/('predictor'+suffix+'.jar')),'Reference',nucleus,*smiles])
        (root/('src/prediction/'+name+'-fixtures.json')).write_text(json.dumps(json.loads(output),separators=(',',':'))+'\n')
