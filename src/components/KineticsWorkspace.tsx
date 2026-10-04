import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Download,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import type {
  KineticFit,
  KineticPoint,
  Spectrum,
  SpectrumStack,
} from "../model";
import type {
  KineticMeasurement,
  KineticsMeasurementOptions,
} from "../features/kinetics";
import { NmrToolIcon } from "./NmrToolIcon";
import { KineticsChart } from "./KineticsChart";
import "./KineticsWorkspace.css";

interface Props {
  spectra: Spectrum[];
  stacks: SpectrumStack[];
  activeStackId: string | null;
  activeId: string;
  seriesLabel: string;
  settings: KineticsMeasurementOptions;
  onSettingsChange: (patch: Partial<KineticsMeasurementOptions>) => void;
  onSeriesChange: (id: string) => void;
  model: KineticFit["model"];
  onModelChange: (model: KineticFit["model"]) => void;
  measurements: KineticMeasurement[];
  points: KineticPoint[];
  fit: KineticFit | null;
  fitError: string;
  onFit: () => void;
  onExport: () => void;
  onTimeChange: (id: string, time: number | undefined) => void;
  onIncludeChange: (id: string) => void;
  onSelect: (id: string) => void;
  view: "curve" | "spectra";
  onViewChange: (view: "curve" | "spectra") => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  picking: "target" | "standard" | null;
  onPick: (which: "target" | "standard") => void;
  onCancelPick: () => void;
  spectrum: ReactNode;
  spectrumTools: ReactNode;
}

const number = (n?: number) =>
  n === undefined
    ? "—"
    : (Math.abs(n) < 0.0001 && n !== 0) || Math.abs(n) >= 100000
      ? n.toExponential(3)
      : Number(n.toPrecision(5)).toString();
const ppm = (n: number) => Number(n.toFixed(3)).toString();
const modeLabel = {
  area: "Signal area",
  ratio: "Standard ratio",
  concentration: "Concentration",
};
const modelLabel = {
  decay: "Exponential decay",
  growth: "Exponential growth",
  linear: "Linear",
};

function NumericInput({
  label,
  value,
  onChange,
  min,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toPrecision(7))}
        aria-label={label}
        min={min}
        step={step}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

export function KineticsWorkspace(p: Props) {
  const [tableOpen, setTableOpen] = useState(false);
  const setupButton = useRef<HTMLButtonElement>(null);
  const setupPanel = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const included = p.points.filter((point) => point.included).length;
  const missingTimes = p.measurements.filter(
    (row) => row.time === undefined,
  ).length;
  const invalid = p.measurements.filter((row) => row.error).length;
  const label =
    p.settings.mode === "area"
      ? "Integrated area"
      : p.settings.mode === "ratio"
        ? "Internal standard ratio"
        : `Concentration (${p.settings.concentrationUnit || "mM"})`;
  const active = p.spectra.find((s) => s.id === p.activeId);
  const enoughPoints = included >= (p.model === "linear" ? 2 : 4);

  useEffect(() => {
    if (!p.settingsOpen) return;
    setupPanel.current?.querySelector<HTMLElement>("button")?.focus();
    const closeOnOutside = (e: PointerEvent) => {
      if (
        !setupPanel.current?.contains(e.target as Node) &&
        !setupButton.current?.contains(e.target as Node)
      )
        p.onSettingsOpenChange(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        p.onSettingsOpenChange(false);
        setupButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [p.settingsOpen, p.onSettingsOpenChange]);

  function pick(which: "target" | "standard") {
    p.onSettingsOpenChange(false);
    p.onPick(which);
  }
  function showTimes() {
    setTableOpen(true);
    requestAnimationFrame(() =>
      tableRef.current
        ?.querySelector<HTMLInputElement>('input[placeholder="Set time"]')
        ?.focus(),
    );
  }

  return (
    <section
      className="kinetics-workspace kinetics-studio"
      aria-label="Kinetics workspace"
    >
      <header className="kinetics-studio-header">
        <div className="kinetics-studio-title">
          <NmrToolIcon kind="kinetics" size={25} />
          <div>
            <h1>Kinetics</h1>
            <p>
              {p.seriesLabel} · {p.spectra.length} spectra
            </p>
          </div>
        </div>
        <div className="kinetics-header-actions">
          <button
            className="secondary"
            onClick={p.onExport}
            aria-label="Export kinetics data"
          >
            <Download size={14} />
            <span>Export</span>
          </button>
          <button
            ref={setupButton}
            className={`secondary ${p.settingsOpen ? "is-active" : ""}`}
            aria-expanded={p.settingsOpen}
            aria-controls="kinetics-setup"
            onClick={() => p.onSettingsOpenChange(!p.settingsOpen)}
          >
            <SlidersHorizontal size={14} />
            Setup
          </button>
        </div>
      </header>

      <div className="kinetics-command-bar">
        <div
          className="kinetics-view-switch"
          role="tablist"
          aria-label="Kinetics views"
        >
          <button
            role="tab"
            aria-selected={p.view === "curve"}
            onClick={() => {
              p.onViewChange("curve");
              p.onCancelPick();
            }}
          >
            <NmrToolIcon kind="kinetics" size={17} />
            Curve
          </button>
          <button
            role="tab"
            aria-selected={p.view === "spectra"}
            onClick={() => p.onViewChange("spectra")}
          >
            <NmrToolIcon kind="stack" size={17} />
            Spectra
          </button>
        </div>
        <button
          className="kinetics-region-chip"
          onClick={() => pick("target")}
          title="Draw the target region on the spectra"
        >
          <i />
          {ppm(p.settings.from)}–{ppm(p.settings.to)} ppm
        </button>
        {p.settings.mode !== "area" && (
          <button
            className="kinetics-region-chip standard"
            onClick={() => pick("standard")}
            title="Draw the internal standard region"
          >
            <i />
            Standard {ppm(p.settings.standardFrom ?? 0)}–
            {ppm(p.settings.standardTo ?? 0)}
          </button>
        )}
        <span className="kinetics-mode-label">
          {modeLabel[p.settings.mode]}
        </span>
        <button
          className="primary kinetics-fit-button"
          onClick={p.onFit}
          disabled={!enoughPoints}
          title={
            !enoughPoints
              ? `Set times and include at least ${p.model === "linear" ? 2 : 4} points`
              : `Fit ${modelLabel[p.model].toLowerCase()}`
          }
        >
          <NmrToolIcon kind="fitCurve" size={17} />
          Fit curve
        </button>
      </div>

      <div
        className="kinetics-plot-area"
        role="tabpanel"
        aria-label={
          p.view === "curve" ? "Kinetics curve" : "Time series spectra"
        }
      >
        {p.view === "curve" ? (
          <>
            <div className="kinetics-plot-caption">
              <span>
                {label}{" "}
                <span className="kinetics-point-count">
                  · {included} included points
                </span>
              </span>
              <div className="kinetics-legend">
                <span>
                  <i />
                  Measurements
                </span>
                {p.fit && (
                  <span className="fit">
                    <i />
                    {modelLabel[p.model]}
                  </span>
                )}
              </div>
            </div>
            {p.points.length ? (
              <KineticsChart
                points={p.points}
                fit={p.fit}
                label={label}
                onSelect={(id) => {
                  p.onSelect(id);
                  setTableOpen(true);
                }}
                activeId={p.activeId}
              />
            ) : (
              <div className="kinetics-empty">
                <NmrToolIcon kind="kinetics" size={48} />
                <h2>
                  {!p.spectra.length
                    ? "Choose a time series"
                    : missingTimes
                      ? "Add times to plot your measurements"
                      : "Check your measurement regions"}
                </h2>
                <p>
                  {!p.spectra.length
                    ? "Open 1D spectra or choose a stack in Setup."
                    : missingTimes
                      ? "Your signal areas are ready. Enter an acquisition time for each spectrum to see the curve."
                      : (p.measurements.find((row) => row.error)?.error ??
                        "Select a signal region to begin.")}
                </p>
                <div>
                  {missingTimes > 0 && (
                    <button className="primary" onClick={showTimes}>
                      <Table2 size={15} />
                      Set time points
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={() => {
                      p.onViewChange("spectra");
                      p.onCancelPick();
                    }}
                  >
                    <NmrToolIcon kind="stack" size={17} />
                    View spectra
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="kinetics-spectrum-toolbar">
              {p.spectrumTools}
              <span>
                {p.picking
                  ? `Drag across the ${p.picking === "target" ? "target signal" : "internal standard"}.`
                  : "Z to zoom · I to measure · scroll to adjust height"}
              </span>
              {p.picking && (
                <button
                  className="kinetics-cancel-pick"
                  onClick={p.onCancelPick}
                >
                  <X size={13} />
                  Cancel
                </button>
              )}
            </div>
            <div className="kinetics-spectrum-stage">{p.spectrum}</div>
          </>
        )}
      </div>

      {p.fitError && (
        <div className="kinetics-fit-error" role="status">
          {p.fitError}
          <button onClick={() => p.onSettingsOpenChange(true)}>
            Change model
          </button>
        </div>
      )}
      {p.fit && (
        <div className="kinetics-results-strip" aria-label="Fit results">
          <span>
            R² <b>{p.fit.rSquared.toFixed(5)}</b>
          </span>
          <span>
            RMSE <b>{number(p.fit.rmse)}</b>
          </span>
          {p.fit.parameters.rate !== undefined && (
            <span>
              Rate <b>{number(p.fit.parameters.rate)} min⁻¹</b>
            </span>
          )}
          {p.fit.halfLife !== undefined && (
            <span>
              Half-life <b>{number(p.fit.halfLife)} min</b>
            </span>
          )}
          {p.fit.model === "linear" && (
            <span>
              Slope <b>{number(p.fit.parameters.slope)} / min</b>
            </span>
          )}
          <details>
            <summary>
              Parameters <ChevronDown size={12} />
            </summary>
            <div>
              {Object.entries(p.fit.parameters).map(([key, value]) => (
                <span key={key}>
                  {key}
                  <b>{number(value)}</b>
                </span>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="kinetics-data-bar">
        <button
          aria-expanded={tableOpen}
          aria-controls="kinetics-data"
          onClick={() => setTableOpen((open) => !open)}
        >
          <Table2 size={14} />
          Time points & measurements<span>{p.spectra.length}</span>
          <ChevronDown size={13} className={tableOpen ? "rotated" : ""} />
        </button>
        <div>
          {missingTimes > 0 && (
            <button className="kinetics-attention" onClick={showTimes}>
              {missingTimes} need times
            </button>
          )}
          {invalid > missingTimes && (
            <span className="kinetics-attention">
              {invalid - missingTimes} need review
            </span>
          )}
          <small>Display gain does not change measurements</small>
        </div>
      </div>
      {tableOpen && (
        <div
          ref={tableRef}
          id="kinetics-data"
          className="kinetics-table kinetics-data-table"
        >
          <table>
            <thead>
              <tr>
                <th>Use</th>
                <th>Spectrum</th>
                <th>Time (min)</th>
                <th>Target area</th>
                {p.settings.mode !== "area" && <th>Standard area</th>}
                <th>{modeLabel[p.settings.mode]}</th>
                <th>Status</th>
                {p.fit && <th>Residual</th>}
              </tr>
            </thead>
            <tbody>
              {p.spectra.map((s) => {
                const row = p.measurements.find((m) => m.id === s.id);
                const index = p.points.findIndex((point) => point.id === s.id);
                return (
                  <tr
                    key={s.id}
                    className={s.id === p.activeId ? "kinetics-active-row" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Include ${s.label} in fit`}
                        disabled={!!row?.error}
                        checked={!!row?.included && !row.error}
                        onChange={() => p.onIncludeChange(s.id)}
                      />
                    </td>
                    <td>
                      <button
                        className="kinetics-spectrum-link"
                        onClick={() => p.onSelect(s.id)}
                      >
                        <i style={{ background: s.color }} />
                        {s.label}
                      </button>
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Time for ${s.label}`}
                        value={s.timeMinutes ?? ""}
                        placeholder="Set time"
                        step="0.5"
                        onChange={(e) =>
                          p.onTimeChange(
                            s.id,
                            Number.isFinite(e.target.valueAsNumber)
                              ? e.target.valueAsNumber
                              : undefined,
                          )
                        }
                      />
                    </td>
                    <td>{number(row?.targetArea)}</td>
                    {p.settings.mode !== "area" && (
                      <td>{number(row?.standardArea)}</td>
                    )}
                    <td className="kinetics-measurement">
                      {number(row?.value)}
                    </td>
                    <td
                      className={`measurement-status ${row?.error ? "has-error" : ""}`}
                      title={row?.error}
                    >
                      {row?.error
                        ? row.time === undefined
                          ? "Set time"
                          : row.error
                        : row?.included
                          ? "Included"
                          : "Excluded"}
                    </td>
                    {p.fit && (
                      <td>
                        {index >= 0 ? number(p.fit.residuals[index]) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {p.settingsOpen && (
        <div
          ref={setupPanel}
          id="kinetics-setup"
          className="kinetics-setup"
          role="dialog"
          aria-label="Kinetics setup"
        >
          <div className="kinetics-setup-heading">
            <h2>Kinetics setup</h2>
            <button
              className="icon-button"
              aria-label="Close kinetics setup"
              onClick={() => {
                p.onSettingsOpenChange(false);
                setupButton.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="kinetics-setup-body">
            <section>
              <h3>Time series</h3>
              <label className="field">
                <span>Spectra to measure</span>
                <select
                  aria-label="Spectra to measure"
                  value={p.activeStackId ?? ""}
                  onChange={(e) => p.onSeriesChange(e.target.value)}
                >
                  <option value="">
                    All {p.settings.nucleus ?? "1D"} spectra
                  </option>
                  {p.stacks.map((stack) => (
                    <option key={stack.id} value={stack.id}>
                      {stack.label} · {stack.spectrumIds.length} spectra
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section>
              <div className="kinetics-section-heading">
                <h3>Target signal</h3>
                <button onClick={() => pick("target")}>
                  <NmrToolIcon kind="integral" size={17} />
                  Draw region
                </button>
              </div>
              <div className="kinetics-field-pair">
                <NumericInput
                  label="Target from (ppm)"
                  value={p.settings.from}
                  onChange={(from) => p.onSettingsChange({ from })}
                />
                <NumericInput
                  label="Target to (ppm)"
                  value={p.settings.to}
                  onChange={(to) => p.onSettingsChange({ to })}
                />
              </div>
              {!!active?.integrals.length && (
                <label className="field">
                  <span>Use an existing integral</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const integral = active.integrals.find(
                        (i) => i.id === e.target.value,
                      );
                      if (integral)
                        p.onSettingsChange({
                          from: integral.from,
                          to: integral.to,
                        });
                    }}
                  >
                    <option value="">Choose integral…</option>
                    {active.integrals.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label} · {ppm(i.from)}–{ppm(i.to)} ppm
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
            <section>
              <h3>Comparison</h3>
              <label className="field">
                <span>Measurement</span>
                <select
                  aria-label="Measurement"
                  value={p.settings.mode}
                  onChange={(e) =>
                    p.onSettingsChange({
                      mode: e.target
                        .value as KineticsMeasurementOptions["mode"],
                    })
                  }
                >
                  <option value="area">Raw signal area</option>
                  <option value="ratio">Internal standard ratio</option>
                  <option value="concentration">
                    Internal standard concentration
                  </option>
                </select>
              </label>
              {p.settings.mode !== "area" && (
                <>
                  <div className="kinetics-section-heading">
                    <h4>Internal standard</h4>
                    <button onClick={() => pick("standard")}>
                      <NmrToolIcon kind="integral" size={17} />
                      Draw region
                    </button>
                  </div>
                  <div className="kinetics-field-pair">
                    <NumericInput
                      label="Standard from (ppm)"
                      value={p.settings.standardFrom ?? 0}
                      onChange={(standardFrom) =>
                        p.onSettingsChange({ standardFrom })
                      }
                    />
                    <NumericInput
                      label="Standard to (ppm)"
                      value={p.settings.standardTo ?? 0}
                      onChange={(standardTo) =>
                        p.onSettingsChange({ standardTo })
                      }
                    />
                  </div>
                  <div className="kinetics-field-pair">
                    <NumericInput
                      label="Target proton count"
                      min={1}
                      step={1}
                      value={p.settings.targetProtons ?? 1}
                      onChange={(targetProtons) =>
                        p.onSettingsChange({
                          targetProtons: Math.max(1, targetProtons),
                        })
                      }
                    />
                    <NumericInput
                      label="Standard proton count"
                      min={1}
                      step={1}
                      value={p.settings.standardProtons ?? 1}
                      onChange={(standardProtons) =>
                        p.onSettingsChange({
                          standardProtons: Math.max(1, standardProtons),
                        })
                      }
                    />
                  </div>
                </>
              )}
              {p.settings.mode === "concentration" && (
                <div className="kinetics-field-pair">
                  <NumericInput
                    label="Standard concentration"
                    min={0.000001}
                    value={p.settings.standardConcentration ?? 1}
                    onChange={(standardConcentration) =>
                      p.onSettingsChange({
                        standardConcentration: Math.max(
                          0.000001,
                          standardConcentration,
                        ),
                      })
                    }
                  />
                  <label className="field">
                    <span>Units</span>
                    <select
                      aria-label="Concentration units"
                      value={p.settings.concentrationUnit}
                      onChange={(e) =>
                        p.onSettingsChange({
                          concentrationUnit: e.target.value,
                        })
                      }
                    >
                      <option>mM</option>
                      <option>M</option>
                      <option>µM</option>
                    </select>
                  </label>
                </div>
              )}
              <p className="kinetics-setup-note">
                {p.settings.mode === "area"
                  ? "Areas use the processed real spectrum. Display normalization is excluded."
                  : "The target / standard area ratio is corrected for proton count. Concentrations require suitable quantitative acquisition."}
              </p>
            </section>
            <section>
              <h3>Curve fit</h3>
              <label className="field">
                <span>Model</span>
                <select
                  aria-label="Model"
                  value={p.model}
                  onChange={(e) =>
                    p.onModelChange(e.target.value as KineticFit["model"])
                  }
                >
                  <option value="decay">Exponential decay</option>
                  <option value="growth">Exponential growth</option>
                  <option value="linear">Linear</option>
                </select>
              </label>
              <p className="kinetics-setup-note">
                {p.model === "linear"
                  ? "At least 2 included points at different times."
                  : "At least 4 included points at different times. Offset is fitted."}
              </p>
            </section>
          </div>
          <div className="kinetics-setup-footer">
            <span>Changes update the plot</span>
            <button
              className="primary"
              onClick={() => p.onSettingsOpenChange(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
