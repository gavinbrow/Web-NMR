/** Preserve explicitly aromatic input bonds that a parser may kekulize using a different model.
 * This reads notation flags only; OpenChemLib remains responsible for structure validation.
 */
export function aromaticInputBonds(input:{molfile?:string;smiles?:string}):Map<string,number> {
  const result=new Map<string,number>()
  const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`
  if(input.molfile) {
    const lines=input.molfile.split(/\r?\n/)
    if(lines[3]?.includes('V2000')) {
      const atomCount=Number(lines[3].slice(0,3));const bondCount=Number(lines[3].slice(3,6))
      for(const line of lines.slice(4+atomCount,4+atomCount+bondCount)) {
        if(Number(line.slice(6,9))===4)result.set(key(Number(line.slice(0,3))-1,Number(line.slice(3,6))-1),4)
      }
    }else {
      let inBonds=false
      for(const line of lines) {
        if(line.includes('BEGIN BOND')) {inBonds=true;continue}
        if(line.includes('END BOND')) {inBonds=false;continue}
        if(inBonds) {const fields=line.trim().split(/\s+/);if(fields[3]==='4')result.set(key(Number(fields[4])-1,Number(fields[5])-1),4)}
      }
    }
    return result
  }
  const smiles=input.smiles??''
  const aromatic:boolean[]=[]
  const branches:number[]=[]
  const rings=new Map<string,{atom:number;order?:number}>()
  let current:number|undefined
  let order:number|undefined
  const connect=(a:number,b:number,bondOrder?:number)=> {
    if(aromatic[a]&&aromatic[b])result.set(key(a,b),bondOrder??4)
    else if(bondOrder===4)result.set(key(a,b),4)
  }
  for(let i=0;i<smiles.length;i++) {
    const c=smiles[i]
    if(c==='(') {branches.push(current!);continue}
    if(c===')') {current=branches.pop();continue}
    if(c==='.') {current=undefined;order=undefined;continue}
    if(c==='-' || c==='=' || c==='#' || c===':') {order=({'-':1,'=':2,'#':3,':':4} as Record<string,number>)[c];continue}
    if(/[0-9]/.test(c)||c==='%') {
      let ring=c
      if(c==='%') {ring=smiles.slice(i+1,i+3);i+=2}
      const start=rings.get(ring)
      if(start && current!==undefined) {connect(start.atom,current,order??start.order);rings.delete(ring)}
      else if(current!==undefined)rings.set(ring,{atom:current,order})
      order=undefined;continue
    }
    let symbol:string|undefined
    if(c==='[') {
      const end=smiles.indexOf(']',i+1)
      symbol=smiles.slice(i+1,end).match(/^\d*([A-Z][a-z]?|[bcnops]|se|as|\*)/)?.[1]
      i=end
    }else if(/[A-Z]/.test(c)) {
      symbol=c
      if(/[a-z]/.test(smiles[i+1]??'') && ['Cl','Br','Si','Na','Li','Al','Ca'].includes(c+smiles[i+1]))symbol+=smiles[++i]
    }else if(/[bcnops]/.test(c))symbol=c
    if(symbol) {
      const atom=aromatic.length;aromatic.push(symbol===symbol.toLowerCase())
      if(current!==undefined)connect(current,atom,order)
      current=atom;order=undefined
    }
  }
  return result
}
