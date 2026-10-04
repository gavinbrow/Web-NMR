import { useEffect, useRef, useState } from "react";
import { X, LoaderCircle } from "lucide-react";
import type {
  Spectrum,
  TwoDProcessingRecipe,
  TwoDSpectrum,
  ProcessingRecipe,
  BaselineMethod,
} from "../model";
import { processTwoDAsync, autoPhaseTwoDAsync } from "../core/workerClient";
import "./TwoDProcessingDialog.css";
export type TwoDPanel = "phase" | "apodization" | "baseline" | "transform";
const methods: [BaselineMethod, string][] = [
  ["bernstein", "Bernstein polynomial"],
  ["polynomial", "Polynomial"],
  ["whittaker", "Whittaker smoother"],
  ["splines", "Splines"],
  ["ablative", "Ablative"],
  ["pcbc", "PcBc · independent adaptation"],
  ["arpls", "arPLS"],
  ["snip", "SNIP"],
  ["apbk", "apbk-inspired · independent adaptation"],
];
interface Props {
  spectrum: Spectrum;
  panel: TwoDPanel;
  recipe: TwoDProcessingRecipe;
  onRecipe: (r: TwoDProcessingRecipe) => void;
  onPreview: (m: TwoDSpectrum | null) => void;
  onApply: (r: TwoDProcessingRecipe) => void;
  onClose: () => void;
  onPickBaseline: () => void;
}
export function TwoDProcessingDialog(p: Props) {
  const [axis, setAxis] = useState<"f2" | "f1">("f2"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]);
  const epoch = useRef(0),
    running = useRef(false),
    pending = useRef<{ recipe: TwoDProcessingRecipe; epoch: number } | null>(
      null,
    ),
    callbacks = useRef(p);
  callbacks.current = p;
  useEffect(() => {
    const id = ++epoch.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      pending.current = { recipe: p.recipe, epoch: id };
      if (running.current) return;
      running.current = true;
      void (async () => {
        try {
          while (pending.current) {
            const next = pending.current;
            pending.current = null;
            try {
              const result = await processTwoDAsync({
                ...callbacks.current.spectrum,
                twoDRecipe: next.recipe,
              });
              if (next.epoch === epoch.current) {
                callbacks.current.onPreview(result.data);
                setWarnings(result.warnings);
                setError("");
              }
            } catch (e) {
              if (next.epoch === epoch.current) {
                setError(e instanceof Error ? e.message : String(e));
                callbacks.current.onPreview(null);
              }
            }
            if (next.epoch === epoch.current) setLoading(false);
          }
        } finally {
          running.current = false;
        }
      })();
    }, 160);
    return () => {
      clearTimeout(timer);
      epoch.current++;
      pending.current = null;
    };
  }, [p.recipe, p.spectrum.id]);
  const r = p.recipe[axis];
  const change = (patch: Partial<ProcessingRecipe>) =>
    p.onRecipe({
      ...p.recipe,
      ...(["window", "lbHz", "gaussianHz", "zeroFill"].some(
        (key) => key in patch,
      )
        ? { transform: true }
        : {}),
      [axis]: { ...r, ...patch },
    });
  async function phase() {
    setLoading(true);
    try {
      const found = await autoPhaseTwoDAsync(
        { ...p.spectrum, twoDRecipe: p.recipe },
        axis === "f2" ? "F2" : "F1",
      );
      p.onRecipe({ ...p.recipe, [axis]: { ...r, ...found } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }
  const num = (
    label: string,
    key:
      | "lbHz"
      | "gaussianHz"
      | "pivotPpm"
      | "baselineOrder"
      | "baselineSmoothness"
      | "baselineIterations",
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={`${axis.toUpperCase()} ${label}`}
        type="number"
        step={key === "pivotPpm" ? 0.001 : 1}
        value={r[key] ?? 0}
        onChange={(e) => {
          if (Number.isFinite(e.target.valueAsNumber))
            change({ [key]: e.target.valueAsNumber });
        }}
      />
    </label>
  );
  return (
    <div
      className="two-d-processing"
      role="dialog"
      aria-label={`2D ${p.panel} processing`}
    >
      <header>
        <strong>
          2D{" "}
          {p.panel === "phase"
            ? "Phase correction"
            : p.panel === "baseline"
              ? "Baseline correction"
              : p.panel === "transform"
                ? "Fourier transform"
                : "Apodization"}
        </strong>
        <button onClick={p.onClose} aria-label="Close 2D processing">
          <X size={16} />
        </button>
      </header>
      <div className="two-d-processing-body">
        <div className="two-d-axis-tabs">
          <button
            className={axis === "f2" ? "selected" : ""}
            onClick={() => setAxis("f2")}
          >
            F2 · {p.spectrum.nucleus}
          </button>
          <button
            className={axis === "f1" ? "selected" : ""}
            onClick={() => setAxis("f1")}
          >
            F1 · {p.spectrum.twoD!.nucleusF1}
          </button>
        </div>
        {p.spectrum.twoDRaw && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={p.recipe.transform}
              onChange={(e) =>
                p.onRecipe({ ...p.recipe, transform: e.target.checked })
              }
            />
            Reprocess from raw 2D data
          </label>
        )}
        {p.panel === "phase" ? (
          <>
            <label className="field">
              <span>Zero order · {r.ph0.toFixed(1)}°</span>
              <input
                type="range"
                min="-180"
                max="180"
                step=".2"
                value={r.ph0}
                aria-label={`${axis.toUpperCase()} zero order phase`}
                onChange={(e) => change({ ph0: +e.target.value })}
              />
            </label>
            <label className="field">
              <span>First order · {r.ph1.toFixed(1)}°</span>
              <input
                type="range"
                min="-720"
                max="720"
                step=".5"
                value={r.ph1}
                aria-label={`${axis.toUpperCase()} first order phase`}
                onChange={(e) => change({ ph1: +e.target.value })}
              />
            </label>
            <div className="two-d-processing-pair">
              <label className="field">
                <span>Zero order (°)</span>
                <input
                  type="number"
                  value={r.ph0}
                  onChange={(e) =>
                    Number.isFinite(e.target.valueAsNumber) &&
                    change({ ph0: e.target.valueAsNumber })
                  }
                />
              </label>
              <label className="field">
                <span>First order (°)</span>
                <input
                  type="number"
                  value={r.ph1}
                  onChange={(e) =>
                    Number.isFinite(e.target.valueAsNumber) &&
                    change({ ph1: e.target.valueAsNumber })
                  }
                />
              </label>
            </div>
            {num("Pivot (ppm)", "pivotPpm")}
            <button
              className="secondary full-width"
              disabled={loading}
              onClick={() => void phase()}
            >
              Auto phase {axis.toUpperCase()}
            </button>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={p.recipe.reconstructImaginary}
                onChange={(e) =>
                  p.onRecipe({
                    ...p.recipe,
                    reconstructImaginary: e.target.checked,
                  })
                }
              />
              Reconstruct missing imaginary data
            </label>
            <small>
              Reconstruction uses a Hilbert approximation. Review phase manually
              for signed COSY/NOESY peaks.
            </small>
          </>
        ) : p.panel === "baseline" ? (
          <>
            <label className="field">
              <span>Method · {axis.toUpperCase()}</span>
              <select
                value={r.baseline}
                aria-label={`${axis.toUpperCase()} baseline mode`}
                onChange={(e) =>
                  change({
                    baseline: e.target.value as ProcessingRecipe["baseline"],
                  })
                }
              >
                <option value="none">None</option>
                <option value="auto">Automatic</option>
                <option value="manual">Manual plane from points</option>
              </select>
            </label>
            {r.baseline === "auto" && (
              <>
                <label className="field">
                  <span>Algorithm</span>
                  <select
                    aria-label={`${axis.toUpperCase()} baseline algorithm`}
                    value={r.baselineMethod}
                    onChange={(e) =>
                      change({
                        baselineMethod: e.target.value as BaselineMethod,
                      })
                    }
                  >
                    {methods.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {num("Polynomial order", "baselineOrder")}
                {num("Smoothness", "baselineSmoothness")}
                {num("Iterations", "baselineIterations")}
              </>
            )}
            {r.baseline === "manual" && (
              <>
                <button
                  className="secondary full-width"
                  onClick={p.onPickBaseline}
                >
                  Pick baseline points on spectrum
                </button>
                <small>
                  {p.recipe.baselinePoints?.length ?? 0} points · choose at
                  least three non-collinear points in empty regions.
                </small>
                <button
                  className="secondary"
                  onClick={() =>
                    p.onRecipe({ ...p.recipe, baselinePoints: [] })
                  }
                >
                  Clear points
                </button>
              </>
            )}
            <small>
              Correction runs along {axis.toUpperCase()}. Configure both
              dimensions for a two-axis correction.
            </small>
          </>
        ) : (
          <>
            <fieldset
              disabled={!p.spectrum.twoDRaw}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <label className="field">
                <span>Window · {axis.toUpperCase()}</span>
                <select
                  value={r.window}
                  aria-label={`${axis.toUpperCase()} window`}
                  onChange={(e) =>
                    change({
                      window: e.target.value as ProcessingRecipe["window"],
                      transform: true,
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="exponential">Exponential</option>
                  <option value="gaussian">Gaussian</option>
                  <option value="sinebell">Sine bell</option>
                </select>
              </label>
              {num("Line broadening (Hz)", "lbHz")}
              {r.window === "gaussian" &&
                num("Gaussian width (Hz)", "gaussianHz")}
              <label className="field">
                <span>Zero filling · {axis.toUpperCase()}</span>
                <select
                  value={r.zeroFill}
                  aria-label={`${axis.toUpperCase()} zero filling`}
                  onChange={(e) =>
                    change({ zeroFill: +e.target.value, transform: true })
                  }
                >
                  {[1, 2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={p.recipe.digitalFilter}
                  onChange={(e) =>
                    p.onRecipe({ ...p.recipe, digitalFilter: e.target.checked })
                  }
                />
                Correct digital filter
              </label>
              {p.spectrum.twoDRaw?.acquisitionMode === "Echo-Antiecho" && (
                <label className="field">
                  <span>Echo / antiecho row order</span>
                  <select
                    aria-label="Echo antiecho order"
                    value={p.recipe.echoAntiEchoOrder ?? "echo-first"}
                    onChange={(e) =>
                      p.onRecipe({
                        ...p.recipe,
                        echoAntiEchoOrder: e.target.value as
                          "echo-first" | "antiecho-first",
                      })
                    }
                  >
                    <option value="antiecho-first">Antiecho first</option>
                    <option value="echo-first">
                      Echo first · Bruker examples
                    </option>
                  </select>
                  <small>
                    Choose the opposite order if the indirect dimension is
                    mirrored.
                  </small>
                </label>
              )}
            </fieldset>
            {!p.spectrum.twoDRaw && (
              <small>
                This document contains processed planes only. Import the full
                experiment folder to change the time-domain window or Fourier
                transform.
              </small>
            )}
          </>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={p.recipe.magnitude}
            onChange={(e) =>
              p.onRecipe({ ...p.recipe, magnitude: e.target.checked })
            }
          />
          Magnitude spectrum
        </label>
        {loading && (
          <small className="two-d-processing-status">
            <LoaderCircle size={13} className="spin" />
            Updating preview…
          </small>
        )}
        {error && (
          <p className="two-d-processing-error" role="alert">
            {error}
          </p>
        )}
        {warnings.map((w, i) => (
          <small key={i}>{w}</small>
        ))}
      </div>
      <footer>
        <button className="secondary" onClick={p.onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={loading || !!error}
          onClick={() => p.onApply(p.recipe)}
        >
          Apply
        </button>
      </footer>
    </div>
  );
}
