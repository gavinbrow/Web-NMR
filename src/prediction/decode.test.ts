import {describe,it,expect} from 'vitest'
import {gzipSync,strToU8} from 'fflate'
import {decodeLookupChunk} from './decode'
describe('static lookup transport',()=> {
  const reference={'H-1;C(':[-0.4,-0.2,0.5,12]}
  it('decodes raw compressed .gz assets',()=> {
    expect(decodeLookupChunk(gzipSync(strToU8(JSON.stringify(reference))))).toEqual(reference)
  })
  it('accepts bytes already decompressed by HTTP Content-Encoding',()=> {
    expect(decodeLookupChunk(strToU8(JSON.stringify(reference)))).toEqual(reference)
  })
  it('rejects an HTML fallback instead of pretending prediction succeeded',()=> {
    expect(()=>decodeLookupChunk(strToU8('<!doctype html>'))).toThrow()
  })
})
