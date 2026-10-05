import { parseEnsemble } from './ensemble';
import type { ConformerEnsemble, ConformerModule, ConformerOptions, ConformerProgress } from './types';
let loading: Promise<ConformerModule> | undefined;
export function conformerAssetBase(): string {
  return new URL(`${import.meta.env.BASE_URL}prediction/conformers/`, globalThis.location.origin).href;
}
async function loadModule(): Promise<ConformerModule> {
  if (loading) return loading;
  loading = (async () => {
    const base = conformerAssetBase();
    const moduleUrl = `${base}WebNMRConformers.mjs`;
    const { default: initialize } = await import(/* @vite-ignore */ moduleUrl);
    return initialize({ locateFile: (name: string) => `${base}${name}` });
  })();
  try { return await loading; } catch (error) { loading = undefined; throw error; }
}
/** Runs on the caller's thread. Use generateConformers for UI-safe cancellation. */
export async function generateConformersInCurrentThread(molfile: string, options: ConformerOptions = {}): Promise<ConformerEnsemble> {
  const count = options.numConformers ?? 10;
  const seed = options.randomSeed ?? 0xF00D;
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Request 1 to 10 conformers.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) throw new Error('Conformer seed must be a nonnegative 32-bit integer.');
  if (options.signal?.aborted) throw new DOMException('Conformer generation canceled.', 'AbortError');
  options.onProgress?.({ stage: 'loading', completed: 0, total: count });
  const module = await loadModule();
  if (options.signal?.aborted) throw new DOMException('Conformer generation canceled.', 'AbortError');
  try {
    return parseEnsemble(module.generate(molfile, count, seed, (stage, completed, total) => {
      options.onProgress?.({ stage: stage as ConformerProgress['stage'], completed, total });
    }));
  } catch (error) {
    // Emscripten can throw a numeric pointer for C++ exceptions. Retrieve the
    // message when available; preserve explicit JS failures otherwise.
    if (error instanceof Error) throw error;
    throw new Error('RDKit could not generate MMFF94 conformers for this molecule.');
  }
}
