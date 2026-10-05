import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Molecule} from 'openchemlib'
import {runPrediction} from './engine'
import type {LookupTable,LookupLoader} from './engine'
import {lookupBucket} from './hose'
import {moleculeGraph} from './molecule'
const tables=new Map<string,LookupTable>()
const lookup:LookupLoader=async(nucleus,code)=> {
  const key=`${nucleus}/${lookupBucket(code).toString(16).padStart(2,'0')}`
  if(!tables.has(key))tables.set(key,JSON.parse(gunzipSync(readFileSync(new URL(`../../public/prediction/${key}.json.gz`,import.meta.url))).toString()))
  return tables.get(key)?.[code]
}
describe('local environment prediction',()=> {
  it('uses measured ethanol environments, combines implicit H by parent and reports evidence',async()=> {
    const result=await runPrediction({smiles:'CCO',nucleus:'1H'},lookup)
    expect(result.missingAtomCount).toBe(0)
    expect(result.targetAtomCount).toBe(6)
    expect(result.shifts.map(s=>[s.atomIndex,s.hydrogenCount])).toEqual([[0,3],[1,2],[2,1]])
    expect(result.shifts[0].shiftPpm).toBe(Math.fround(1.2918704))
    expect(result.shifts[1].shiftPpm).toBe(Math.fround(4.1095157))
    expect(result.shifts.every(s=>s.sampleCount>0 && s.radius>0 && s.minPpm<=s.shiftPpm && s.maxPpm>=s.shiftPpm)).toBe(true)
  })
  it('preserves the negative reference range for tetramethylsilane',async()=> {
    const result=await runPrediction({smiles:'C[Si](C)(C)C',nucleus:'1H'},lookup)
    expect(result.shifts).toHaveLength(4)
    expect(result.shifts.some(s=>s.minPpm<0)).toBe(true)
    expect(result.shifts.reduce((n,s)=>n+s.hydrogenCount,0)).toBe(12)
  })
  it('retains negative mean shifts from a matched reference',async()=> {
    const result=await runPrediction({smiles:'C',nucleus:'1H'},async()=>[-0.4,-0.2,0,10])
    expect(result.shifts[0].shiftPpm).toBe(-0.2)
    expect(result.shifts[0].hydrogenCount).toBe(4)
  })
  it('omits unmatched atoms without an arbitrary fallback',async()=> {
    const result=await runPrediction({smiles:'CCO',nucleus:'13C'},async()=>undefined)
    expect(result.shifts).toEqual([])
    expect(result.missingAtomCount).toBe(2)
    expect(result.warnings.some(w=>w.includes('no matching'))).toBe(true)
  })
  it('keeps the original molfile order when an explicit H occurs before heavy atoms',()=> {
    const molecule=new Molecule(8,8)
    const hydrogen=molecule.addAtom(1)
    const oxygen=molecule.addAtom(8)
    const carbon=molecule.addAtom(6)
    molecule.addBond(hydrogen,oxygen)
    molecule.addBond(oxygen,carbon)
    const molfile=molecule.toMolfile()
    const graph=moleculeGraph({molfile})
    // Molfile serialization orders according to its original atom lines.
    const lines=molfile.split(/\r?\n/)
    const elements=lines.slice(4,4+Number(lines[3].slice(0,3))).map(l=>l.slice(31,34).trim())
    for(const atom of graph.atoms)if(atom.atomIndex!==undefined)expect(atom.element).toBe(elements[atom.atomIndex])
    expect(graph.atoms.filter(a=>a.parentIndex!==undefined).every(a=>elements[a.parentIndex!]==='C')).toBe(true)
  })
  it('stops a canceled prediction',async()=> {
    const controller=new AbortController();controller.abort()
    await expect(runPrediction({smiles:'CCO',nucleus:'1H'},lookup,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'})
  })
  it('rejects an invalid or empty input structure',async()=> {
    await expect(runPrediction({smiles:'',nucleus:'13C'},lookup)).rejects.toThrow('Draw a molecule')
    await expect(runPrediction({smiles:'C1CC',nucleus:'13C'},lookup)).rejects.toThrow()
  })
})

it('uses Kekulé valence with separate aromatic flags for caffeine molfile prediction',async()=> {
  const smiles='Cn1c(=O)c2c(ncn2C)n(C)c1=O'
  const original=moleculeGraph({smiles})
  const molecule=Molecule.fromSmiles(smiles)
  const aromaticBonds=original.bonds.filter(b=>b[2]===4).map(([a,b])=>[a,b] as [number,number])
  const parsed=moleculeGraph({molfile:molecule.toMolfile(),aromaticBonds})
  expect(parsed.atoms).toHaveLength(original.atoms.length)
  expect(parsed.bonds).toEqual(original.bonds)
  const direct=await runPrediction({smiles,nucleus:'1H'},lookup)
  const imported=await runPrediction({molfile:molecule.toMolfile(),aromaticBonds,nucleus:'1H'},lookup)
  expect(imported.shifts).toEqual(direct.shifts)
})
