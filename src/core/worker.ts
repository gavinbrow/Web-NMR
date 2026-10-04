import { importEntriesAsync } from "./imports";
import { autoPhase, processSpectrum, processWithBaseline } from "./numerics";
import type { ImportEntry, Spectrum } from "../model";
import { processTwoD, autoPhaseTwoD } from "./twoDProcessing";

type Request =
  | { id: number; type: "import"; entries: ImportEntry[] }
  | {
      id: number;
      type: "process" | "phase" | "processBaseline" | "processTwoD";
      spectrum: Spectrum;
    }
  | { id: number; type: "phaseTwoD"; spectrum: Spectrum; axis: "F2" | "F1" };
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
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const result =
      request.type === "import"
        ? await importEntriesAsync(request.entries)
        : request.type === "processTwoD"
          ? processTwoD(request.spectrum)
          : request.type === "phaseTwoD"
            ? autoPhaseTwoD(request.spectrum, request.axis)
            : request.type === "process"
              ? processSpectrum(request.spectrum)
              : request.type === "processBaseline"
                ? processWithBaseline(request.spectrum)
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
