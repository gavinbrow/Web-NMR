import { Molecule } from 'openchemlib'
import type { HoseGraph, HoseAtom } from './hose'
import type { PredictionInput } from './types'
import {aromaticInputBonds} from './aromatic-input'
import isotopeMasses from './isotope-masses.json'
/** Chemistry parsing/valence/aromaticity uses OpenChemLib; HOSE labeling itself follows CDK. */
export function moleculeGraph(input:Pick<PredictionInput,'molfile'|'smiles'|'aromaticBonds'>):HoseGraph {
  if(!input.molfile?.trim() && !input.smiles?.trim())throw new Error('Draw a molecule or enter a SMILES structure first.')
  const mol=input.molfile?.trim() ? Molecule.fromMolfile(input.molfile) : Molecule.fromSmiles(input.smiles!.trim())
  if(!mol.getAllAtoms())throw new Error('The structure contains no atoms.')
  if(mol.getAllAtoms()>250)throw new Error('Local prediction supports structures with up to 250 drawn atoms.')
  // Assign original input ordering before OpenChemLib moves plain explicit H to the end.
  for(let i=0;i<mol.getAllAtoms();i++)mol.setAtomMapNo(i,i+1,false)
  mol.ensureHelperArrays(Molecule.cHelperRings)
  const atoms:HoseAtom[]=[]
  for(let i=0;i<mol.getAllAtoms();i++) {
    const element=mol.getAtomLabel(i)
    const mass=(isotopeMasses as Record<string,number>)[element]
    if(!mass)throw new Error(`CDK HOSE prediction does not support the atom label ${element}.`)
    atoms.push({element,atomicNumber:mol.getAtomicNo(i),charge:mol.getAtomCharge(i),mass,atomIndex:mol.getAtomMapNo(i)-1})
  }
  const bonds:number[][]=[]
  const inputBonds=aromaticInputBonds(input)
  for(const [a,b] of input.aromaticBonds??[]) {
    if(!Number.isInteger(a) || !Number.isInteger(b) || a<0 || b<0 || a===b || a>=atoms.length || b>=atoms.length)throw new Error('The molecule has an invalid aromatic bond reference.')
    inputBonds.set(a<b?`${a}:${b}`:`${b}:${a}`,4)
  }
  for(let i=0;i<mol.getAllBonds();i++) {
    const a=mol.getAtomMapNo(mol.getBondAtom(0,i))-1
    const b=mol.getAtomMapNo(mol.getBondAtom(1,i))-1
    const key=a<b?`${a}:${b}`:`${b}:${a}`
    const order=inputBonds.get(key)??(mol.isAromaticBond(i)?4:mol.getBondOrder(i))
    if(order<1 || order>4)throw new Error('Prediction requires ordinary single, double, triple or aromatic bonds.')
    bonds.push([mol.getBondAtom(0,i),mol.getBondAtom(1,i),order])
  }
  const originalCount=atoms.length
  for(let i=0;i<originalCount;i++) {
    const hydrogens=mol.getImplicitHydrogens(i)
    if(hydrogens<0 || hydrogens>8)throw new Error('The structure has an unsupported hydrogen valence.')
    for(let h=0;h<hydrogens;h++) {
      bonds.push([i,atoms.length,1])
      atoms.push({element:'H',atomicNumber:1,charge:0,mass:1,parentIndex:atoms[i].atomIndex})
    }
  }
  return {atoms,bonds}
}
