import type { Spectrum } from "../model";
import {
  spectrumReportSnapshot,
  validateSpectrumReportSize,
  type SpectrumReportOptions,
  type SpectrumReportFigure,
} from "./spectrumReport";

export function buildSpectrumWorkbookAsync(
  s: Spectrum,
  options: SpectrumReportOptions,
  figure?: SpectrumReportFigure,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    validateSpectrumReportSize(s, options);
    if (signal?.aborted) {
      reject(new DOMException("Export cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(
      new URL("./spectrumReport.worker.ts", import.meta.url),
      { type: "module" },
    );
    const close = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      close();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ bytes?: Uint8Array; error?: string }>,
    ) => {
      close();
      if (event.data.bytes) resolve(event.data.bytes);
      else
        reject(new Error(event.data.error || "Could not build Excel report."));
    };
    worker.onerror = () => {
      close();
      reject(new Error("Could not build Excel report."));
    };
    try {
      worker.postMessage({
        spectrum: spectrumReportSnapshot(s),
        options,
        figure,
      });
    } catch (error) {
      close();
      reject(error);
    }
  });
}
export async function rasterizeSpectrumSVG(
  svg: string,
): Promise<SpectrumReportFigure> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Could not render the spectrum figure."));
      image.src = url;
    });
    if (!image.width || !image.height || image.width * image.height > 8_000_000)
      throw new Error(
        "Spectrum figure dimensions are unavailable or too large.",
      );
    const scale = Math.min(
        2,
        Math.sqrt(8_000_000 / (image.width * image.height)),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image rendering is unavailable.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not export the PNG fallback.")),
        "image/png",
      ),
    );
    return {
      svg,
      png: new Uint8Array(await png.arrayBuffer()),
      width: image.width,
      height: image.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
