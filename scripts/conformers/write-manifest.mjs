import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = new URL('../../public/prediction/conformers/', import.meta.url);
const files = {};
for (const name of ['WebNMRConformers.mjs', 'WebNMRConformers.wasm']) {
  const bytes = await readFile(new URL(name, base));
  files[name] = {bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')};
}
await writeFile(new URL('manifest.json',base),JSON.stringify({
  schemaVersion:1,rdkitVersion:'2025.09.1',
  rdkitCommit:'237a1d9027c800784afed8788540f38a3aa595f8',
  emscriptenVersion:'4.0.10',method:'ETKDGv3/MMFF94',
  defaults:{numConformers:10,randomSeed:61453,pruneRmsThresh:.5,maxMMFFIterations:500,temperatureK:298.15},
  files,
},null,2)+'\n');
