"""Regenerate native RDKit parity cases (requires rdkit==2025.9.1).

The molfile round trip is deliberate: browser input is a drawn molfile, not a
canonical SMILES. Both reference and WASM retain its original atom ordering.
"""
import json
from pathlib import Path
from rdkit import Chem, rdBase
from rdkit.Chem import AllChem
assert rdBase.rdkitVersion == '2025.09.1'
def stereo_smiles(source, cid=None, hydrogen=None, second_hydrogen=None):
    marked=Chem.Mol(source)
    for atom in marked.GetAtoms(): atom.SetAtomMapNum(0)
    if hydrogen is not None:
        atom=marked.GetAtomWithIdx(hydrogen)
        marker=max([2]+[a.GetIsotope()+1 for a in marked.GetAtoms() if a.GetAtomicNum()==1])
        atom.SetIsotope(marker)
        if second_hydrogen is not None: marked.GetAtomWithIdx(second_hydrogen).SetIsotope(marker)
    if cid is not None: Chem.AssignStereochemistryFrom3D(marked,confId=cid,replaceExistingTags=True)
    marked=Chem.RemoveHs(marked)
    original=Chem.MolToSmiles(marked)
    for atom in marked.GetAtoms():
        if atom.GetChiralTag() in [Chem.ChiralType.CHI_TETRAHEDRAL_CW,Chem.ChiralType.CHI_TETRAHEDRAL_CCW]: atom.InvertChirality()
    return original,Chem.MolToSmiles(marked)

def align_hydrogens(mol, original_count, sorted_ids):
    achiral=len(set(stereo_smiles(mol)))==1
    def key(h,cid):
        smiles=stereo_smiles(mol,cid,h)
        return min(smiles) if achiral else smiles[0]
    reference=[key(a.GetIdx(),sorted_ids[0]) if a.GetAtomicNum()==1 else '' for a in mol.GetAtoms()]
    physical=[stereo_smiles(mol,sorted_ids[0],a.GetIdx())[0] if a.GetAtomicNum()==1 else '' for a in mol.GetAtoms()]
    for cid in sorted_ids[1:]:
        conf=mol.GetConformer(cid)
        for parent in mol.GetAtoms():
            groups={}
            for atom in parent.GetNeighbors():
                if atom.GetAtomicNum()==1: groups.setdefault(atom.GetIsotope(),[]).append(atom.GetIdx())
            for group in groups.values():
                keys=[stereo_smiles(mol,cid,h)[0] for h in group]
                positions=[conf.GetAtomPosition(h) for h in group]
                available=list(range(len(group)))
                for h in group:
                    k=next(k for k in available if keys[k]==physical[h])
                    available.remove(k); conf.SetAtomPosition(h,positions[k])
    return reference

def pair_equivalence(mol, cid):
    if mol.GetNumAtoms()>64: return []
    achiral=len(set(stereo_smiles(mol)))==1
    distances=Chem.GetDistanceMatrix(mol)
    result=[]
    hydrogens=[a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum()==1 and a.GetIsotope()<2]
    for i,a in enumerate(hydrogens):
        for b in hydrogens[i+1:]:
            if not 2<=distances[a,b]<=4: continue
            keys=stereo_smiles(mol,cid,a,b)
            result.append({'atomIndices':[a,b],'key':min(keys) if achiral else keys[0]})
    return result

cases = []
for name, smiles in [
    ('ethanol', 'CCO'),
    ('butane', 'CCCC'),
    ('aspirin', 'CC(=O)Oc1ccccc1C(=O)O'),
    ('alanine-R', 'N[C@@H](C)C(=O)O'),
    ('chiral-butanol-stereotopic-H', 'CC[C@@H](O)C'),
    ('glycine-zwitterion', '[NH3+]CC(=O)[O-]'),
    ('symmetric-multi-CH2', 'C[C@H](O)CC[C@@H](O)C'),
    ('explicit-isotopic-chiral', '[2H][C@H](C)[C@H](O)C'),
    ('terminal-alkene', 'C=CC'),
    ('cyclohexane', 'C1CCCCC1'),
    ('explicit-hydrogen', '[H]OC'),
    ('explicit-chiral-CH2', 'CC[C@H](O)C'),
    ('mapped-chiral-CH2', 'CC[C@H](O)C'),
    ('AAprimeBBprime-para-chlorotoluene', 'Cc1ccc(Cl)cc1'),
]:
    source = Chem.MolFromSmiles(smiles, sanitize=True)
    if name == 'mapped-chiral-CH2':
        for atom in source.GetAtoms(): atom.SetAtomMapNum(100+atom.GetIdx()*7)
    if name in ['explicit-hydrogen','explicit-chiral-CH2']:
        source = Chem.AddHs(source)
    AllChem.Compute2DCoords(source)
    block = Chem.MolToMolBlock(source)
    mol = Chem.MolFromMolBlock(block, removeHs=False)
    original_count = mol.GetNumAtoms()
    mol = Chem.AddHs(mol)
    typing_mol = Chem.Mol(mol)
    properties = AllChem.MMFFGetMoleculeProperties(typing_mol, mmffVariant='MMFF94')
    descriptors = [{'atomicNumber':a.GetAtomicNum(), 'totalValence':a.GetTotalValence(),
      'aromatic':a.GetIsAromatic(), 'hybridization':int(a.GetHybridization()),
      'formalCharge':a.GetFormalCharge(), 'defaultValence':Chem.GetPeriodicTable().GetDefaultValence(a.GetAtomicNum()),
      'ringSizes':[size for size in range(3,8) if a.IsInRingSize(size)],
      'chiralTag':int(a.GetChiralTag()), 'mmffAtomType':properties.GetMMFFAtomType(a.GetIdx())}
      for a in typing_mol.GetAtoms()]
    bonds = [[b.GetBeginAtomIdx(),b.GetEndAtomIdx(),b.GetBondTypeAsDouble()] for b in mol.GetBonds()]
    bounds = AllChem.GetMoleculeBoundsMatrix(mol, set15bounds=True, scaleVDW=False, doTriangleSmoothing=True).tolist()
    p = AllChem.ETKDGv3()
    p.randomSeed = 0xF00D
    p.pruneRmsThresh = .5
    p.numThreads = 1
    ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=10, params=p))
    results = AllChem.MMFFOptimizeMoleculeConfs(mol, numThreads=1, maxIters=500)
    sorted_pairs=sorted(zip(ids,results),key=lambda x:x[1][1])
    site_keys=align_hydrogens(mol,original_count,[cid for cid,result in sorted_pairs])
    pair_keys=pair_equivalence(mol,sorted_pairs[0][0])
    for cid,_ in sorted_pairs:
        assert pair_equivalence(mol,cid)==pair_keys, f'Physical pair identity changed between conformers: {name}'
    conformers = []
    for cid, (status, energy) in sorted_pairs:
        conformers.append({'id':cid, 'energyKcal':energy, 'converged':status==0,
                           'coordinates':mol.GetConformer(cid).GetPositions().tolist()})
    cases.append({'name':name, 'smiles':smiles, 'molfile':block,
                  'originalAtomCount':original_count,
                  'atomicNumbers':[a.GetAtomicNum() for a in mol.GetAtoms()],
                  'atomIsotopes':[a.GetIsotope() for a in mol.GetAtoms()],
                  'originalAtomIndices':[i if i<original_count else -1 for i in range(mol.GetNumAtoms())],
                  'hydrogenParents':[next(iter(a.GetNeighbors())).GetIdx() if a.GetAtomicNum()==1 else -1 for a in mol.GetAtoms()],
                  'hydrogenSiteKeys':site_keys, 'hydrogenPairEquivalence':pair_keys, 'hydrogenIdentityMethod':'3D isotope replacement / canonical isomeric SMILES', 'hydrogenAlignmentWarnings':[], 'atomDescriptors':descriptors, 'bonds':bonds, 'boundsMatrix':bounds, 'conformers':conformers})
output = Path(__file__).resolve().parents[2] / 'src/prediction/conformers/parity-fixtures.json'
output.write_text(json.dumps({'rdkitVersion':rdBase.rdkitVersion,'unsupportedMMFFMolfile':Chem.MolToMolBlock(Chem.MolFromSmiles('[Fe]')),'cases':cases},indent=2)+'\n')
print(f'Wrote {len(cases)} native conformer fixtures to {output}')
