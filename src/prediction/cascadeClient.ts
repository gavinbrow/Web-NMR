import type {
  PredictionInput,
  PredictionOptions,
  PredictionResult,
} from "./types";
/** Dedicated worker keeps synchronous geometry and neural inference off the UI.
 * Terminating it cancels even a running C++ force-field calculation immediately. */
export function predictCascade(
  input: PredictionInput,
  options: PredictionOptions = {},
): Promise<PredictionResult> {
  if (options.signal?.aborted)
    return Promise.reject(
      new DOMException("Prediction canceled.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cascade.worker.ts", import.meta.url), {
      type: "module",
    });
    let finished = false;
    const cleanup = () => {
      finished = true;
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (!finished) {
        cleanup();
        reject(new DOMException("Prediction canceled.", "AbortError"));
      }
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        options.onProgress?.(data.progress);
        return;
      }
      cleanup();
      if (data.type === "result") resolve(data.result);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("The local CASCADE prediction worker could not run."));
    };
    worker.postMessage(input);
  });
}
