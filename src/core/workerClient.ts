import type {
  ComplexData,
  ImportEntry,
  ImportResult,
  Spectrum,
} from "../model";
let worker: Worker | undefined,
  sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error) job.reject(new Error(event.data.error));
      else job.resolve(event.data.result);
    };
    worker.onerror = (event) => {
      for (const job of pending.values())
        job.reject(new Error(event.message || "Numerical worker stopped."));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}
function request<T>(
  type: string,
  payload: Record<string, unknown>,
  transfers: Transferable[] = [],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    try {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      getWorker().postMessage({ id, type, ...payload }, transfers);
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}
export async function importBrowserFiles(files: File[]): Promise<ImportResult> {
  let size = 0;
  for (const f of files) size += f.size;
  if (size > 256 * 1024 * 1024)
    throw new Error("Upload exceeds the 256 MB local import limit.");
  const entries: ImportEntry[] = await Promise.all(
    files.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      data: await file.arrayBuffer(),
    })),
  );
  return request<ImportResult>(
    "import",
    { entries },
    entries.map((e) => e.data),
  );
}
export function processAsync(spectrum: Spectrum): Promise<ComplexData> {
  return request<ComplexData>("process", { spectrum });
}
export function autoPhaseAsync(
  spectrum: Spectrum,
): Promise<{ ph0: number; ph1: number }> {
  return request("phase", { spectrum });
}
