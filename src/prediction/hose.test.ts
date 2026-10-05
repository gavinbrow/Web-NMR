import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {generateHoseCode,hoseLookupKeys,lookupBucket} from './hose'
import {moleculeGraph} from './molecule'
import protonFixtures from './proton-fixtures.json'
import carbonFixtures from './carbon-fixtures.json'
describe('CDK 2.9 JVM parity',()=> {
  for(const fixture of [...protonFixtures,...carbonFixtures]) {
    it(`${fixture.nucleus} ${fixture.smiles}: six-sphere codes and real table lookup`,()=> {
      const parsed=moleculeGraph({smiles:fixture.smiles})
      expect(parsed.atoms.map(a=>a.element)).toEqual(fixture.atoms.map(a=>a.element))
      for(const p of fixture.predictions) {
        expect(generateHoseCode(parsed,p.atom)).toBe(p.hose)
        const hose=generateHoseCode(fixture,p.atom)
        expect(hose).toBe(p.hose)
        let match:{values:number[];radius:number}|undefined
        for(const key of hoseLookupKeys(hose)) {
          const data=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/prediction/${fixture.nucleus}/${lookupBucket(key.code).toString(16).padStart(2,'0')}.json.gz`,import.meta.url))).toString()) as Record<string,number[]>
          if(data[key.code]) {match={values:data[key.code],radius:key.radius};break}
        }
        expect(match?.radius??-1).toBe(p.radius)
        if(match) {expect(match.values[1]).toBe(Math.fround(p.shift));expect(match.values[0]).toBe(Math.fround(p.min));expect(match.values[2]).toBe(Math.fround(p.max));expect(match.values[3]).toBeGreaterThan(0)}
      }
    })
  }
})
