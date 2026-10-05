/// <reference types="vite/client" />
import {decodeLookupChunk} from './decode'
import { lookupBucket } from './hose'
import { DATASET_VERSION } from './engine'
import type { LookupTable,LookupLoader } from './engine'
import type { PredictionNucleus } from './types'
const cache=new Map<string,LookupTable>()
const inflight=new Map<string,Promise<LookupTable>>()
const maxCachedChunks=64
let active=0
const queue:(()=>void)[]=[]
async function loadChunk(nucleus:PredictionNucleus,bucket:number):Promise<LookupTable> {
  const key=`${nucleus}/${bucket.toString(16).padStart(2,'0')}`
  const previous=cache.get(key)
  if(previous) {cache.delete(key);cache.set(key,previous);return previous}
  const pending=inflight.get(key)
  if(pending)return pending
  const task=(async()=> {
    if(active>=4)await new Promise<void>(resolve=>queue.push(resolve))
    active++
    try {
      const url=new URL(`${import.meta.env.BASE_URL}prediction/${key}.json.gz`,self.location.origin).href
      let browserCache:Cache|undefined
      try {browserCache=await caches.open(`web-nmr-prediction-${DATASET_VERSION}`)}catch {/* private browsing/cache unavailable */}
      let response=await browserCache?.match(url)
      if(!response) {
        response=await fetch(url,{cache:'force-cache',credentials:'same-origin'})
        if(!response.ok)throw new Error(`The local ${nucleus} reference data could not be loaded (${response.status}).`)
        try {await browserCache?.put(url,response.clone())}catch {/* HTTP caching remains available */}
      }
      const compressed=new Uint8Array(await response.arrayBuffer())
      const data=decodeLookupChunk(compressed)
      cache.set(key,data)
      while(cache.size>maxCachedChunks)cache.delete(cache.keys().next().value!)
      return data
    } finally {active--;queue.shift()?.()}
  })()
  inflight.set(key,task)
  try{return await task}finally{inflight.delete(key)}
}
export const localLookup:LookupLoader=async (nucleus,code,signal)=> {
  if(signal?.aborted)throw new DOMException('Prediction canceled.','AbortError')
  const table=await loadChunk(nucleus,lookupBucket(code))
  return Object.hasOwn(table,code)?table[code]:undefined
}
