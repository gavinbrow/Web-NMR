import { X, Download, MousePointer2, LoaderCircle } from "lucide-react";
import type {
  ProcessingRecipe,
  BaselineMethod,
  ManualBaselineMethod,
} from "../model";
const methods: [BaselineMethod, string][] = [
  ["whittaker", "Whittaker Smoother"],
  ["polynomial", "Polynomial Fit"],
  ["bernstein", "Bernstein Polynomial Fit"],
  ["ablative", "Ablative"],
  ["splines", "Splines"],
  ["pcbc", "PcBc · independent adaptation"],
  ["arpls", "Improved arPLS"],
  ["snip", "SNIP"],
  ["apbk", "apbk-inspired · independent adaptation"],
];
export function BaselineDialog({
  draft,
  onChange,
  view,
  loading,
  error,
  scope,
  onScope,
  selectedCount,
  stackCount,
  onApply,
  onClose,
  onManual,
  onExtract,
}: {
  draft: ProcessingRecipe;
  onChange: (r: ProcessingRecipe) => void;
  view: [number, number];
  loading: boolean;
  error: string;
  scope: "active" | "selected" | "all";
  onScope: (s: "active" | "selected" | "all") => void;
  selectedCount: number;
  stackCount: number;
  onApply: () => void;
  onClose: () => void;
  onManual: () => void;
  onExtract: () => void;
}) {
  const field = (
    key: keyof ProcessingRecipe,
    label: string,
    fallback: number,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="field" key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={(draft[key] as number) ?? fallback}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n))
            onChange({ ...draft, [key]: Math.max(min, Math.min(max, n)) });
        }}
      />
    </label>
  );
  return (
    <div
      className="baseline-dialog"
      role="dialog"
      aria-label="Baseline Correction"
    >
      <div className="modal-title">
        <div>
          <span className="eyebrow">PROCESSING · BLUE CURVE PREVIEW</span>
          <h2>Baseline Correction</h2>
        </div>
        <button
          aria-label="Close baseline dialog"
          className="icon-button"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <label className="field">
        Correction
        <select
          value={draft.baseline}
          onChange={(e) => {
            onChange({
              ...draft,
              baseline: e.target.value as ProcessingRecipe["baseline"],
            });
            if (e.target.value === "manual") onManual();
          }}
        >
          <option value="auto">Automatic</option>
          <option value="manual">Manual points</option>
          <option value="none">None</option>
        </select>
      </label>
      {draft.baseline === "auto" && (
        <label className="field">
          Method
          <select
            value={draft.baselineMethod ?? "bernstein"}
            onChange={(e) =>
              onChange({
                ...draft,
                baselineMethod: e.target.value as BaselineMethod,
              })
            }
          >
            {methods.map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft.baseline === "manual" && (
        <>
          <label className="field">
            Manual method
            <select
              value={draft.manualBaselineMethod ?? "segments"}
              onChange={(e) =>
                onChange({
                  ...draft,
                  manualBaselineMethod: e.target.value as ManualBaselineMethod,
                })
              }
            >
              {[
                ["segments", "Segments"],
                ["splines", "Splines"],
                ["polynomial", "Polynomial Fit"],
                ["whittaker", "Whittaker Smoother"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary full-width" onClick={onManual}>
            <MousePointer2 size={14} />
            Place points on the spectrum
          </button>
          <p className="muted-small">
            {draft.baselineAnchors.length} points · click the baseline; at least
            2 points required.
          </p>
          <button
            className="text-button"
            onClick={() => onChange({ ...draft, baselineAnchors: [] })}
          >
            Clear points
          </button>
        </>
      )}
      {(draft.baseline === "manual"
        ? draft.manualBaselineMethod === "polynomial"
        : ["polynomial", "bernstein", "pcbc"].includes(
            draft.baselineMethod ?? "bernstein",
          )) && field("baselineOrder", "Polynomial order", 3, 1, 12)}
      {["whittaker", "arpls", "apbk"].includes(draft.baselineMethod ?? "") ||
      (draft.baseline === "manual" &&
        draft.manualBaselineMethod === "whittaker")
        ? field("baselineSmoothness", "Smoothness · log₁₀ λ", 6, 0, 12, 0.5)
        : null}
      {draft.baseline === "auto" &&
        [
          "polynomial",
          "bernstein",
          "whittaker",
          "splines",
          "pcbc",
          "arpls",
          "apbk",
        ].includes(draft.baselineMethod ?? "bernstein") &&
        field("baselineMedianWindow", "Baseline sample window", 9, 3, 101)}
      {draft.baseline === "auto" &&
        ["whittaker", "ablative", "arpls", "apbk"].includes(
          draft.baselineMethod ?? "",
        ) &&
        field("baselineIterations", "Iterations", 20, 1, 100)}
      {["snip", "ablative"].includes(draft.baselineMethod ?? "") &&
        field(
          "baselineSnipWindow",
          draft.baselineMethod === "snip"
            ? "SNIP half-window"
            : "Peak shaving half-window",
          40,
          1,
          500,
        )}
      {draft.baseline === "auto" &&
        ["whittaker", "arpls", "apbk"].includes(draft.baselineMethod ?? "") &&
        field(
          "baselineRatio",
          "Convergence tolerance",
          1e-6,
          1e-9,
          0.1,
          0.000001,
        )}
      <div className="section-title">Regions</div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={!!draft.baselineRegion}
          onChange={(e) =>
            onChange({
              ...draft,
              baselineRegion: e.target.checked ? [...view] : undefined,
            })
          }
        />
        Run on a region
      </label>
      {draft.baselineRegion && (
        <>
          <button
            className="secondary full-width"
            onClick={() => onChange({ ...draft, baselineRegion: [...view] })}
          >
            Get region from zoom
          </button>
          <div className="two-fields">
            {[0, 1].map((i) => (
              <label className="field" key={i}>
                {i === 0 ? "From (ppm)" : "To (ppm)"}
                <input
                  type="number"
                  step=".01"
                  value={draft.baselineRegion![i]}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (Number.isFinite(n)) {
                      const r = [...draft.baselineRegion!] as [number, number];
                      r[i] = n;
                      onChange({ ...draft, baselineRegion: r });
                    }
                  }}
                />
              </label>
            ))}
          </div>
        </>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={!!draft.baselineExcludedRegions?.length}
          onChange={(e) =>
            onChange({
              ...draft,
              baselineExcludedRegions: e.target.checked
                ? [[view[0], view[0] - (view[0] - view[1]) * 0.05]]
                : [],
            })
          }
        />
        Exclude blind regions
      </label>
      {draft.baselineExcludedRegions?.map((r, index) => (
        <div className="two-fields" key={index}>
          {[0, 1].map((i) => (
            <label className="field" key={i}>
              {i ? "Excluded to (ppm)" : "Excluded from (ppm)"}
              <input
                type="number"
                value={r[i]}
                step=".01"
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isFinite(n))
                    onChange({
                      ...draft,
                      baselineExcludedRegions:
                        draft.baselineExcludedRegions!.map((a, j) =>
                          j === index
                            ? (a.map((v, k) => (k === i ? n : v)) as [
                                number,
                                number,
                              ])
                            : a,
                        ),
                    });
                }}
              />
            </label>
          ))}
          <button
            aria-label="Remove excluded region"
            className="icon-button"
            onClick={() =>
              onChange({
                ...draft,
                baselineExcludedRegions: draft.baselineExcludedRegions!.filter(
                  (_, i) => i !== index,
                ),
              })
            }
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {!!draft.baselineExcludedRegions?.length && (
        <button
          className="text-button"
          onClick={() =>
            onChange({
              ...draft,
              baselineExcludedRegions: [
                ...draft.baselineExcludedRegions!,
                [view[0], view[1]],
              ],
            })
          }
        >
          Add blind region
        </button>
      )}
      <label className="field">
        Apply to
        <select
          value={scope}
          onChange={(e) => onScope(e.target.value as typeof scope)}
        >
          <option value="active">Active spectrum</option>
          <option value="selected">Selected spectra ({selectedCount})</option>
          <option value="all">
            {stackCount} spectra in{" "}
            {stackCount > 1 ? "stack / workspace" : "workspace"}
          </option>
        </select>
      </label>
      {["pcbc", "apbk"].includes(draft.baselineMethod ?? "") && (
        <p className="inline-warning">
          Independent joint phase and baseline adaptation. The vendor’s
          proprietary implementation is not reproduced.
        </p>
      )}
      <p className="baseline-preview-status">
        {loading ? (
          <>
            <LoaderCircle size={13} className="spin" />
            Updating blue baseline…
          </>
        ) : (
          error ||
          "Blue curve shows the baseline to subtract. Apply keeps the correction."
        )}
      </p>
      <div className="processing-buttons">
        <button
          className="secondary"
          onClick={onExtract}
          disabled={loading || !!error}
        >
          <Download size={13} />
          Extract
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={onApply}
          disabled={
            loading ||
            !!error ||
            (draft.baseline === "manual" && draft.baselineAnchors.length < 2)
          }
        >
          Apply
        </button>
      </div>
    </div>
  );
}
