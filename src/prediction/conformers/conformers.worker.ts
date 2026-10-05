import { generateConformersInCurrentThread } from './runtime';
import type { ConformerOptions } from './types';
self.onmessage = async ({ data }: MessageEvent<{molfile: string; options: Pick<ConformerOptions, 'numConformers' | 'randomSeed'>}>) => {
  try {
    const ensemble = await generateConformersInCurrentThread(data.molfile, {
      ...data.options,
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'result', ensemble });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
