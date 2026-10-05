import type { ConformerEnsemble, ConformerOptions } from './types';
export type { AtomDescriptor, Conformer, ConformerEnsemble, ConformerOptions, ConformerProgress, Coordinates } from './types';
export { boltzmannWeights, RT_KCAL } from './ensemble';
/** Real RDKit geometry generation in an isolated browser worker. Canceling
 * terminates its synchronous WASM computation immediately. No molecule is sent
 * over the network; only same-origin static JS/WASM assets are fetched. */
export function generateConformers(molfile: string, options: ConformerOptions = {}): Promise<ConformerEnsemble> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Conformer generation canceled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./conformers.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const cleanup = () => { finished = true; worker.terminate(); options.signal?.removeEventListener('abort', abort); };
    const abort = () => { if (finished) return; cleanup(); reject(new DOMException('Conformer generation canceled.', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { options.onProgress?.(data.progress); return; }
      cleanup();
      if (data.type === 'result') resolve(data.ensemble);
      else reject(new Error(data.message));
    };
    worker.onerror = () => { cleanup(); reject(new Error('The browser could not start the RDKit conformer worker.')); };
    worker.postMessage({ molfile, options: { numConformers: options.numConformers, randomSeed: options.randomSeed } });
  });
}
