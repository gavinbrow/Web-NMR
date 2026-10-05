import {gunzipSync,strFromU8} from 'fflate'
import type {LookupTable} from './engine'
/** Some static hosts mark .gz as Content-Encoding:gzip; browsers then decompress
 * transparently. Accept both the original gzip asset and an HTTP-decoded body. */
export function decodeLookupChunk(bytes:Uint8Array):LookupTable {
  const json=bytes[0]===0x1f && bytes[1]===0x8b ? gunzipSync(bytes) : bytes
  const decoded:unknown=JSON.parse(strFromU8(json))
  if(!decoded || typeof decoded!=='object' || Array.isArray(decoded))throw new Error('The bundled prediction reference chunk is invalid.')
  return decoded as LookupTable
}
