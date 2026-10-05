import { runCascadePrediction } from "./cascadeAdapter";
import type { PredictionInput } from "./types";
self.addEventListener(
  "message",
  async (event: MessageEvent<PredictionInput>) => {
    try {
      const result = await runCascadePrediction(event.data, {
        onProgress: (progress) =>
          self.postMessage({ type: "progress", progress }),
      });
      self.postMessage({ type: "result", result });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
