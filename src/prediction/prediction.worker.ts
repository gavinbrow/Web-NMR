import { runPrediction } from './engine'
import { localLookup } from './data'
import type { PredictionInput } from './types'
const controllers=new Map<number,AbortController>()
self.addEventListener('message',async (event:MessageEvent<{id:number;type:'predict'|'cancel';input?:PredictionInput}>)=> {
  const {id,type,input}=event.data
  if(type==='cancel') {controllers.get(id)?.abort();return}
  const controller=new AbortController()
  controllers.set(id,controller)
  try {
    const result=await runPrediction(input!,localLookup,{signal:controller.signal,onProgress:progress=>self.postMessage({id,type:'progress',progress})})
    self.postMessage({id,type:'result',result})
  }catch(error) {
    self.postMessage({id,type:'error',name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:'Local prediction failed.'})
  }finally{controllers.delete(id)}
})
