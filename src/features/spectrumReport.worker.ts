import {
  buildSpectrumWorkbook,
  type SpectrumReportOptions,
  type SpectrumReportFigure,
} from "./spectrumReport";
import type { Spectrum } from "../model";
self.onmessage = (
  event: MessageEvent<{
    spectrum: Spectrum;
    options: SpectrumReportOptions;
    figure?: SpectrumReportFigure;
  }>,
) => {
  try {
    const bytes = buildSpectrumWorkbook(
      event.data.spectrum,
      event.data.options,
      event.data.figure,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
