import type { PredictionInput,PredictionOptions,PredictionResult,PredictionProgress } from './types'
export type { PredictionInput,PredictionOptions,PredictionResult,PredictionProgress,PredictedAtomShift,PredictionNucleus } from './types'
let worker:Worker|undefined
let nextId=0
const requests=new Map<number,{resolve:(result:PredictionResult)=>void;reject:(error:Error)=>void;progress?:((progress:PredictionProgress)=>void);cleanup:()=>void}>()
function getWorker():Worker {
  if(worker)return worker
  worker=new Worker(new URL('./prediction.worker.ts',import.meta.url),{type:'module'})
  worker.onmessage=({data})=> {
    const request=requests.get(data.id)
    if(!request)return
    if(data.type==='progress') {request.progress?.(data.progress);return}
    requests.delete(data.id);request.cleanup()
    if(data.type==='result')request.resolve(data.result)
    else {const error=new Error(data.message);error.name=data.name??'Error';request.reject(error)}
  }
  worker.onerror=()=> {
    for(const request of requests.values()) {request.cleanup();request.reject(new Error('The local prediction worker could not run. Reload the page and try again.'))}
    requests.clear();worker?.terminate();worker=undefined
  }
  return worker
}
/** All structure calculations and shift lookups run in a browser worker.
 * Network requests load only static same-origin table chunks, never molecule data.
 */
export function predictMolecule(input:PredictionInput,options:PredictionOptions={}):Promise<PredictionResult> {
  if(options.signal?.aborted)return Promise.reject(new DOMException('Prediction canceled.','AbortError'))
  return new Promise((resolve,reject)=> {
    const id=++nextId
    const currentWorker=getWorker()
    const abort=()=> {
      currentWorker.postMessage({id,type:'cancel'})
      const request=requests.get(id)
      if(request) {requests.delete(id);request.cleanup();reject(new DOMException('Prediction canceled.','AbortError'))}
    }
    requests.set(id,{resolve,reject,progress:options.onProgress,cleanup:()=>options.signal?.removeEventListener('abort',abort)})
    options.signal?.addEventListener('abort',abort,{once:true})
    currentWorker.postMessage({id,type:'predict',input})
  })
}
