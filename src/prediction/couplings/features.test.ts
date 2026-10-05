import { describe, expect, it, beforeAll } from 'vitest';
import { unzlibSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildCouplingFeatures } from './features';
import { parseEnsemble } from '../conformers/ensemble';
import type { ConformerModule } from '../conformers/types';
import fixtures from './feature-fixtures.json';
function floatArray(encoded: string) {
  const bytes = unzlibSync(Uint8Array.from(Buffer.from(encoded,'base64')));
  return new Float32Array(bytes.slice().buffer);
}
function intArray(encoded: string) {
  const bytes = unzlibSync(Uint8Array.from(Buffer.from(encoded,'base64')));
  return new Int32Array(bytes.slice().buffer);
}
function assertFloatParity(actual: Float32Array, expected: Float32Array) {
  expect(actual.length).toBe(expected.length);
  let maximum = 0, maximumIndex = -1;
  for (let i = 0; i < actual.length; i++) {
    const delta = Math.abs(actual[i]-expected[i]);
    if (delta > maximum) { maximum = delta; maximumIndex = i; }
  }
  expect(maximum,`maximum feature difference at flattened index ${maximumIndex}`).toBeLessThan(0.000003);
}
let module: ConformerModule;
beforeAll(async () => {
  const glueUrl = new URL('../../../public/prediction/conformers/WebNMRConformers.mjs', import.meta.url);
  const { default: initialize } = await import(/* @vite-ignore */ glueUrl.href);
  module = await initialize({ wasmBinary: await readFile(fileURLToPath(new URL('WebNMRConformers.wasm',glueUrl))) });
});
describe('published FullSSPrUCe coupling feature parity', () => {
  for (const fixture of fixtures.cases) {
    it(`matches unchanged native Python functions for real WASM ${fixture.name}`, () => {
      const ensemble = parseEnsemble(module.generate(fixture.molfile,10,0xF00D,()=>{}));
      const result = buildCouplingFeatures(ensemble);
      expect(result.atomCount).toBe(ensemble.atomicNumbers.length);
      assertFloatParity(result.atomFeatures,floatArray(fixture.atomFeaturesZlibBase64));
      assertFloatParity(result.pairFeatures,floatArray(fixture.pairFeaturesZlibBase64));
      expect([...result.couplingTypes]).toEqual([...intArray(fixture.couplingTypesZlibBase64)]);
      // All three inputs must pad to 64 exactly; padded atoms must have zero
      // geometry features and the explicit unobserved coupling type.
      for (let atom = result.atomCount; atom < 64; atom++) {
        expect(result.atomFeatures.subarray(atom*94,(atom+1)*94).every((v)=>v===0)).toBe(true);
        expect(result.couplingTypes.subarray(atom*64,(atom+1)*64).every((v)=>v===-2)).toBe(true);
      }
    });
  }
  it('averages coupling geometry arithmetically regardless of CASCADE weights', () => {
    const fixture = fixtures.cases.find((fixture)=>fixture.name==='butane')!;
    const ensemble = parseEnsemble(module.generate(fixture.molfile,10,0xF00D,()=>{}));
    expect(ensemble.conformers.length).toBeGreaterThan(1);
    const baseline = buildCouplingFeatures(ensemble);
    ensemble.conformers.forEach((conformer,i)=>{ conformer.weight = i===0 ? 1 : 0; });
    expect(buildCouplingFeatures(ensemble).pairFeatures).toEqual(baseline.pairFeatures);
  });
  it('preserves upstream asymmetric angle channels', () => {
    const fixture = fixtures.cases[0];
    const ensemble = parseEnsemble(module.generate(fixture.molfile,10,0xF00D,()=>{}));
    const {pairFeatures} = buildCouplingFeatures(ensemble);
    // First angle channel has mu=0, sigma=.1: unset lower-triangle angles
    // become 1, as they do in the published Python implementation.
    for (let i = 1; i < ensemble.atomicNumbers.length; i++) {
      for (let j = 0; j < i; j++) expect(pairFeatures[86*64*64+i*64+j]).toBe(1);
    }
  });
  it('rejects molecules outside the trained element and tensor dimensions', () => {
    const ensemble = parseEnsemble(module.generate(fixtures.cases[0].molfile,10,0xF00D,()=>{}));
    const unsupported = structuredClone(ensemble); unsupported.atomDescriptors[0].atomicNumber=35;
    expect(()=>buildCouplingFeatures(unsupported)).toThrow('supports H');
    const oversized = structuredClone(ensemble); oversized.atomicNumbers=Array(65).fill(6);
    expect(()=>buildCouplingFeatures(oversized)).toThrow('at most 64');
  });
});
