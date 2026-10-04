import { useEffect, useRef, useState } from "react";
import type { Spectrum } from "../model";
import {
  defaultSpectrumReportOptions,
  spectrumReportFilename,
  spectrumReportSnapshot,
  validateSpectrumReportSize,
  type SpectrumReportOptions,
} from "../features/spectrumReport";
import {
  buildSpectrumWorkbookAsync,
  rasterizeSpectrumSVG,
} from "../features/spectrumReportClient";
import "./SpectrumExportDialog.css";

export interface SpectrumExportDialogProps {
  spectrum: Spectrum;
  showPeaks?: boolean;
  showMultiplets?: boolean;
  getSVG: () => string | Promise<string>;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}
type Download = { name: string; url: string; label: string };
export function SpectrumExportDialog({
  spectrum,
  showPeaks = false,
  showMultiplets = false,
  getSVG,
  onClose,
  onSuccess,
}: SpectrumExportDialogProps) {
  const [options, setOptions] = useState(() =>
    defaultSpectrumReportOptions(spectrum, showPeaks, showMultiplets),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [downloads, setDownloads] = useState<Download[]>([]);
  const dialog = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | undefined>(undefined),
    urls = useRef<string[]>([]),
    mounted = useRef(true);
  const callbacks = useRef({ onClose, onSuccess });
  callbacks.current = { onClose, onSuccess };
  useEffect(() => {
    mounted.current = true;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        abort.current?.abort();
        callbacks.current.onClose();
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),a[href]",
            ) || [],
          ),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => {
      mounted.current = false;
      abort.current?.abort();
      const pendingURLs = [...urls.current];
      window.setTimeout(() => pendingURLs.forEach(URL.revokeObjectURL), 30000);
      window.removeEventListener("keydown", keyboard, true);
      before?.focus();
    };
  }, []);
  const change = (key: keyof SpectrumReportOptions, value: boolean) =>
    setOptions((previous) => ({ ...previous, [key]: value }));
  const exportReport = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setDownloads([]);
    urls.current.forEach(URL.revokeObjectURL);
    urls.current = [];
    try {
      validateSpectrumReportSize(spectrum, options);
      // Snapshot the currently corrected values before any asynchronous image/ZIP work.
      const snapshot = structuredClone(spectrumReportSnapshot(spectrum)),
        selected = { ...options };
      const svg =
        selected.includeFigure || selected.standaloneSVG
          ? await getSVG()
          : undefined;
      if (controller.signal.aborted) return;
      const figure = selected.includeFigure
        ? await rasterizeSpectrumSVG(svg!)
        : undefined;
      if (controller.signal.aborted) return;
      const bytes = await buildSpectrumWorkbookAsync(
        snapshot,
        selected,
        figure,
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      const output: Download[] = [
        {
          label: "Download Excel report",
          name: spectrumReportFilename(snapshot, "xlsx"),
          url: URL.createObjectURL(
            new Blob([bytes as Uint8Array<ArrayBuffer>], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }),
          ),
        },
      ];
      if (selected.standaloneSVG && svg)
        output.push({
          label: "Download spectrum SVG",
          name: spectrumReportFilename(snapshot, "svg"),
          url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
        });
      urls.current = output.map((file) => file.url);
      setDownloads(output);
      for (const file of output) {
        const link = document.createElement("a");
        link.href = file.url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      callbacks.current.onSuccess?.(
        "Excel spectrum report is ready. Download links remain available.",
      );
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const check = (
    key: keyof SpectrumReportOptions,
    label: string,
    disabled = false,
  ) => (
    <label className="spectrum-report-check">
      <input
        type="checkbox"
        checked={options[key]}
        disabled={busy || disabled}
        onChange={(event) => change(key, event.target.checked)}
      />
      {label}
    </label>
  );
  return (
    <div
      className="spectrum-report-backdrop"
      onClick={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div
        ref={dialog}
        className="spectrum-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spectrum-report-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="spectrum-report-title">Export spectrum report</h2>
          <button
            aria-label="Close export dialog"
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
          >
            ×
          </button>
        </header>
        <div className="spectrum-report-content">
          <p className="spectrum-report-name">
            {String(spectrum.metadata.title || spectrum.label)}
          </p>
          <p className="spectrum-report-help">
            Excel includes the full corrected{" "}
            {spectrum.twoD ? "2D matrix" : "spectrum"}, analysis, and the
            spectrum graphic. Numerical values use your current processing and
            reference.
          </p>
          <fieldset disabled={busy}>
            <legend>Analysis</legend>
            {spectrum.twoD ? (
              <p className="spectrum-report-help">
                The matrix retains both ppm axes. 1D integrals, peaks and
                multiplets are not exported as 2D measurements.
              </p>
            ) : (
              <>
                {check(
                  "includeIntegrals",
                  `Integral regions and normalized values (${spectrum.integrals.length})`,
                )}
                {check(
                  "includePeaks",
                  `Picked peaks (${spectrum.peaks.length})`,
                )}
                {check(
                  "includeMultiplets",
                  `Multiplet analysis (${spectrum.multiplets.length})`,
                )}
              </>
            )}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Report contents</legend>
            {check("includeFigure", "Spectrum graphic: SVG with PNG fallback")}
            {check("standaloneSVG", "Also download the standalone SVG")}
            {check(
              "includeProcessing",
              "Processing settings and source information",
            )}
            {check(
              "includeImaginary",
              spectrum.twoD
                ? "Include available imaginary matrix planes"
                : "Include imaginary spectrum values",
              spectrum.twoD
                ? !spectrum.twoD.imagF2 &&
                    !spectrum.twoD.imagF1 &&
                    !spectrum.twoD.imagBoth
                : !spectrum.data.imag,
            )}
          </fieldset>
          <p className="spectrum-report-help">
            Numeric sheets retain full resolution and exclude display gain. The
            graphic matches your current view. Modern Excel uses SVG; older
            viewers use the PNG fallback.
          </p>
          {busy && (
            <p className="spectrum-report-status" role="status">
              Building Excel report…
            </p>
          )}
          {error && (
            <p className="spectrum-report-error" role="alert">
              {error}
            </p>
          )}
          {downloads.length > 0 && (
            <div className="spectrum-report-downloads" role="status">
              <strong>Report ready</strong>
              <span>If a download did not start, use these links:</span>
              {downloads.map((file) => (
                <a key={file.name} href={file.url} download={file.name}>
                  {file.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <footer>
          <button
            className="spectrum-report-secondary"
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
          >
            {downloads.length ? "Done" : "Cancel"}
          </button>
          <button
            className="spectrum-report-primary"
            disabled={busy}
            onClick={exportReport}
          >
            {busy
              ? "Exporting…"
              : downloads.length
                ? "Export again"
                : "Export Excel report"}
          </button>
        </footer>
      </div>
    </div>
  );
}
