export interface DecoderModule { HEAPU8: Uint8Array; _malloc(size:number):number; _free(pointer:number):void; _decode(pointer:number,length:number,count:number):number }
export default function init(options:{wasmBinary?:Uint8Array;locateFile?:(path:string)=>string}):Promise<DecoderModule>;
