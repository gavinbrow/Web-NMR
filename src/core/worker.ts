import { importEntries } from "./imports";
import { autoPhase, processSpectrum } from "./numerics";
import type { ImportEntry, Spectrum } from "../model";

type Request =
  | { id: number; type: "import"; entries: ImportEntry[] }
  | { id: number; type: "process" | "phase"; spectrum: Spectrum };
function outputBuffers(
  value: unknown,
  found = new Set<ArrayBuffer>(),
): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  } else if (value && typeof value === "object")
    for (const child of Object.values(value)) outputBuffers(child, found);
  return [...found];
}
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const result =
      request.type === "import"
        ? importEntries(request.entries)
        : request.type === "process"
          ? processSpectrum(request.spectrum)
          : autoPhase(request.spectrum);
    self.postMessage(
      { id: request.id, result },
      { transfer: outputBuffers(result) },
    );
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
