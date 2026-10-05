/** TypeScript adaptation of CDK 2.9 HOSECodeGenerator and CanonicalLabeler.
 * Copyright (C) 1997-2007 Christoph Steinbeck; 2008 Egon Willighagen;
 * 2014 Mark B Vine; 2001-2007 Oliver Horlacher. LGPL-2.1-or-later.
 * Algorithm and ranking constants follow CDK's default (non-legacy) mode.
 */
export interface HoseAtom {
  element: string
  atomicNumber: number
  charge: number
  mass: number
  atomIndex?: number
  parentIndex?: number
}
export interface HoseGraph { atoms: HoseAtom[]; bonds: number[][] }
interface Neighbor { atom: number; order: number }
interface Node {
  symbol: string; atom: number | null; source: Node | null; bond: number
  degree: number; score: number; ranking: number; sortOrder: number; stopper: boolean
}
const ranks = new Map(['C','O','N','S','P','Si','B','F','Cl','Br',';','I','#','&',','].map((s,i)=>[s,[9000,8900,8800,8700,8600,8500,8400,8300,8200,8100,8000,7900,1200,1100,1000][i]]))
const bondRanks = [0,0,200000,300000,100000]
const bondSymbols = ['', '', '=', '%', '*']
const delimiters = ['(', '/', '/', ')', '/', '/']
export function adjacency(graph: HoseGraph): Neighbor[][] {
  const neighbors: Neighbor[][] = graph.atoms.map(()=>[])
  for (const [a,b,order] of graph.bonds) {
    neighbors[a].push({atom:b,order}); neighbors[b].push({atom:a,order})
  }
  return neighbors
}
function compareBig(a: bigint,b: bigint) { return a < b ? -1 : a > b ? 1 : 0 }
function primeNumbers(count: number): bigint[] {
  const result: bigint[]=[]
  for(let n=2;result.length<count;n++) {
    if(result.every(p=>Number(p)*Number(p)>n || n%Number(p)!==0)) result.push(BigInt(n))
  }
  return result
}
/** Exactly mirrors CDK's stable invariant ranking, tie breaking and signed long products. */
export function canonicalLabels(graph: HoseGraph, neighbors=adjacency(graph)): number[] {
  if(!graph.atoms.length) return []
  const primes=primeNumbers(2*graph.atoms.length+2)
  const byAtom=graph.atoms.map((a,i)=>({atom:i,last:0n,current:BigInt(`${neighbors[i].length}${neighbors[i].length}${a.atomicNumber}0${Math.abs(a.charge)}0`),prime:0n}))
  const vector=[...byAtom]
  for(let iteration=0;iteration<graph.atoms.length*20+100;iteration++) {
    vector.sort((a,b)=>compareBig(a.current,b.current))
    vector.sort((a,b)=>compareBig(a.last,b.last))
    let rank=1
    const rankings=vector.map((v,i)=> {
      if(i && (v.current!==vector[i-1].current || v.last!==vector[i-1].last)) rank++
      return rank
    })
    vector.forEach((v,i)=> {v.current=BigInt(rankings[i]);v.prime=primes[rankings[i]-1]})
    const partition=rank===vector.length || vector.every(v=>v.current===v.last)
    if(partition && rank===vector.length) return byAtom.map(v=>Number(v.current))
    if(partition) {
      let tie=0; let found=false
      vector.forEach((v,i)=> {
        v.current*=2n;v.prime=primes[Number(v.current)-1]
        if(i && !found && v.current===vector[i-1].current) {tie=i-1;found=true}
      })
      vector[tie].current--; vector[tie].prime=primes[Number(vector[tie].current)-1]
    }
    for(const v of vector) {
      v.last=v.current
      v.current=neighbors[v.atom].reduce((p,n)=>BigInt.asIntN(64,p*byAtom[n.atom].prime),1n)
    }
  }
  throw new Error('CDK canonical labeling did not converge for this structure.')
}
function chargeCode(charge: number): string {
  return !charge ? '' : charge===-1 ? '-' : charge===1 ? '+' : `'${charge>0?'+':''}${charge}'`
}
function node(graph:HoseGraph,neighbors:Neighbor[][],atom:number|null,source:Node|null,bond:number,score=0):Node {
  return {symbol:atom===null?',':graph.atoms[atom].element,atom,source,bond,degree:atom===null?0:neighbors[atom].length,score,ranking:0,sortOrder:1,stopper:false}
}
export function generateHoseCode(graph:HoseGraph,root:number,radius=6):string {
  if(radius!==6) throw new Error('This predictor uses six-sphere HOSE environments.')
  const neighbors=adjacency(graph)
  const labels=canonicalLabels(graph,neighbors)
  const source=node(graph,neighbors,root,null,0)
  let nodes=neighbors[root].filter(n=>graph.atoms[n.atom].element!=='H').map(n=>node(graph,neighbors,n.atom,source,n.order))
  const spheres:Node[][]=[]
  for(let sphere=0;sphere<=radius;sphere++) {
    nodes.sort((a,b)=>(a.atom===null?-Infinity:labels[a.atom])-(b.atom===null?-Infinity:labels[b.atom]))
    spheres.push(nodes)
    const next:Node[]=[]
    for(const n of nodes) {
      if('&;#:,'.includes(n.symbol) || n.atom===null || n.symbol==='H') continue
      if(neighbors[n.atom].length===1) next.push(node(graph,neighbors,null,n,0,n.score))
      else for(const neighbor of neighbors[n.atom]) {
        if(neighbor.atom!==n.source?.atom) next.push(node(graph,neighbors,neighbor.atom,n,neighbor.order,n.score))
      }
    }
    nodes=next
    if(next.length>100000) throw new Error('Structure is too densely connected for a six-sphere HOSE calculation.')
  }
  for(let f=0;f<radius;f++) for(const n of spheres[radius-f]) if(n.source) n.source.ranking+=n.degree
  for(let f=0;f<radius;f++) {
    for(const n of spheres[f]) {
      n.score+=(ranks.get(n.symbol) ?? 800000-(n.atom===null?0:graph.atoms[n.atom].mass)) + bondRanks[n.bond] + n.ranking
    }
    spheres[f].sort((a,b)=>(b.source?.sortOrder??1)-(a.source?.sortOrder??1) || b.score-a.score)
    spheres[f].forEach((n,i)=>n.sortOrder=spheres[f].length-i)
  }
  const visited=new Set<number>()
  let code=`${graph.atoms[root].element}-${neighbors[root].length}${chargeCode(graph.atoms[root].charge)};`
  for(let f=0;f<radius;f++) {
    let branch=spheres[f][0]?.source?.atom
    for(const n of spheres[f]) {
      if(!n.source?.stopper && n.source?.atom!==branch) {branch=n.source?.atom;code+=','}
      if(!n.source?.stopper && n.source?.atom===branch) {
        code+=bondSymbols[n.bond]
        if(n.atom!==null) {
          if(visited.has(n.atom)) {code+='&';n.stopper=true}
          else code+=({Si:'Q',Cl:'X',Br:'Y'} as Record<string,string>)[n.symbol]??n.symbol
          code+=chargeCode(graph.atoms[n.atom].charge)
        }
      }
      if(n.atom!==null)visited.add(n.atom)
      if(n.source?.stopper)n.stopper=true
    }
    code+=delimiters[f]
  }
  return code
}
/** Java StringTokenizer deliberately skips empty spheres; match that behavior. */
export function hoseLookupKeys(hose:string):{code:string;radius:number}[] {
  const tokens=hose.split(/[()/]/).filter(Boolean)
  const result=[]
  for(let radius=6;radius>0;radius--) {
    let code=''
    for(let k=0;k<radius;k++)code+=(tokens[k]??'')+delimiters[k]
    result.push({code,radius})
  }
  return result
}
export function lookupBucket(code:string):number {
  let hash=2166136261
  for(let i=0;i<code.length;i++)hash=Math.imul(hash^code.charCodeAt(i),16777619)>>>0
  return hash%256
}
