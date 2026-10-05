import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  Play,
  X,
  Settings2,
  ShieldCheck,
  Waves,
  Plus,
  RotateCcw,
} from "lucide-react";
import { MoleculeEditor } from "./MoleculeEditor";
import {
  exportMoleculeMolfile,
  exportPredictionAromaticBonds,
  type MoleculeDocument,
} from "../features/molecule";
import type { PredictionSetup } from "../features/predictionSetup";
import type { PredictionResult } from "../prediction/types";
import { predictMolecule } from "../prediction/client";
import { estimateProtonCouplings } from "../features/predictionSplitting";
import "./PredictionWorkspace.css";

interface Props {
  setup: PredictionSetup;
  onChange: (setup: PredictionSetup) => void;
  onPredict: (
    result: PredictionResult,
    setup: PredictionSetup,
    molecule: MoleculeDocument,
  ) => Promise<PredictionResult>;
  onAttach: () => void;
  canAttach: boolean;
  previousResult?: PredictionResult | null;
}
function PredictionNumber(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(p.value));
  useEffect(() => setText(String(p.value)), [p.value]);
  return (
    <label>
      {p.label}
      <input
        aria-label={`Prediction ${p.label}`}
        type="number"
        min={p.min}
        max={p.max}
        step="0.1"
        disabled={p.disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && n >= p.min && n <= p.max) p.onChange(n);
        }}
        onBlur={() => setText(String(p.value))}
      />
    </label>
  );
}
export default function PredictionWorkspace(p: Props) {
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState<PredictionResult | null>(
      p.previousResult ?? null,
    ),
    [details, setDetails] = useState(false),
    [couplingsOpen, setCouplingsOpen] = useState(false),
    [manualA, setManualA] = useState(""),
    [manualB, setManualB] = useState(""),
    [manualJ, setManualJ] = useState(7),
    [settingsOpen, setSettingsOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  const settings = (patch: Partial<PredictionSetup>) => {
    setResult(null);
    setError("");
    const next = { ...p.setup, ...patch };
    if (patch.molecule) {
      const ids = new Set(patch.molecule.atoms.map((a) => a.id));
      next.couplingOverrides = (next.couplingOverrides ?? []).filter(
        (c) => ids.has(c.atomIdA) && ids.has(c.atomIdB),
      );
    }
    p.onChange(next);
  };
  const couplingModel = useMemo(() => {
    if (!p.setup.molecule?.atoms.length || p.setup.nucleus !== "1H")
      return null;
    try {
      return estimateProtonCouplings(
        p.setup.molecule,
        p.setup.couplingOverrides,
      );
    } catch {
      return null;
    }
  }, [p.setup.molecule, p.setup.nucleus, p.setup.couplingOverrides]);
  const setCoupling = (atomIdA: string, atomIdB: string, jHz?: number) => {
    const overrides = (p.setup.couplingOverrides ?? []).filter(
      (c) =>
        !(
          (c.atomIdA === atomIdA && c.atomIdB === atomIdB) ||
          (c.atomIdA === atomIdB && c.atomIdB === atomIdA)
        ),
    );
    if (jHz !== undefined) overrides.push({ atomIdA, atomIdB, jHz });
    settings({ couplingOverrides: overrides });
  };
  const disabledCouplings = (p.setup.couplingOverrides ?? []).filter(
    (c) => c.jHz === 0,
  );
  async function predict() {
    if (!p.setup.molecule?.atoms.length || running) return;
    const setup = structuredClone(p.setup),
      molecule = setup.molecule!;
    setRunning(true);
    setError("");
    setProgress("Preparing molecule…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const aromaticBonds = exportPredictionAromaticBonds(molecule);
      const output = await predictMolecule(
        {
          molfile: exportMoleculeMolfile(molecule),
          aromaticBonds,
          nucleus: setup.nucleus,
          frequencyMHz: setup.frequencyMHz,
          lineWidthHz: setup.lineWidthHz,
        },
        {
          signal: controller.signal,
          onProgress: (value) => setProgress(value.message),
        },
      );
      if (controller.signal.aborted) return;
      setResult(await p.onPredict(output, setup, molecule));
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === controller) {
        setRunning(false);
        abort.current = null;
      }
    }
  }
  return (
    <section
      className="prediction-workspace"
      aria-label="NMR prediction workspace"
      data-shortcuts="molecule"
    >
      <div className="prediction-heading">
        <strong>Molecule editor</strong>
        <small>
          <ShieldCheck size={13} /> Client-side prediction
        </small>
        <div
          className="prediction-nucleus-switch"
          role="group"
          aria-label="Prediction nucleus"
        >
          {(["1H", "13C"] as const).map((nucleus) => (
            <button
              key={nucleus}
              disabled={running}
              aria-pressed={p.setup.nucleus === nucleus}
              onClick={() =>
                settings({
                  nucleus,
                  frequencyMHz: nucleus === "13C" ? 100.6 : 400,
                })
              }
            >
              {nucleus === "1H" ? "¹H" : "¹³C"}
            </button>
          ))}
        </div>
        {p.setup.nucleus === "1H" ? (
          <button
            className={`prediction-splitting-toggle ${p.setup.splitting === "first-order" ? "active" : ""}`}
            disabled={running}
            aria-pressed={p.setup.splitting === "first-order"}
            title="Toggle approximate first-order splitting. Edit J values in Settings."
            onClick={() =>
              settings({
                splitting:
                  p.setup.splitting === "first-order" ? "none" : "first-order",
              })
            }
          >
            <Waves size={15} />
            <span>
              {p.setup.splitting === "first-order" ? "Splitting on" : "Unsplit"}
            </span>
          </button>
        ) : (
          <small
            className="prediction-decoupled"
            title="Carbon spectra are simulated with proton decoupling"
          >
            ¹H decoupled
          </small>
        )}
        <button
          className="primary prediction-header-run"
          disabled={!p.setup.molecule?.atoms.length || running}
          onClick={() => void predict()}
          title="Predict chemical shifts and add a new spectrum"
        >
          {running ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Play size={14} />
          )}
          {running ? "Predicting…" : "Predict spectrum"}
        </button>
        <button
          className={`prediction-settings-toggle ${settingsOpen ? "active" : ""}`}
          aria-label="Prediction settings"
          aria-expanded={settingsOpen}
          title="Splitting, J couplings, frequency, linewidth, and match details"
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <Settings2 size={16} />
          <span>Settings</span>
        </button>
      </div>
      <div className="prediction-layout">
        <div className="prediction-editor">
          <MoleculeEditor
            value={p.setup.molecule}
            onChange={(molecule) => settings({ molecule })}
          />
        </div>
        {settingsOpen && (
          <div
            className="prediction-settings-scrim"
            onClick={() => setSettingsOpen(false)}
          />
        )}
        {settingsOpen && (
          <aside
            className="prediction-settings"
            aria-label="Prediction settings"
          >
            <div className="prediction-settings-heading">
              <h2>Prediction settings</h2>
              <button
                className="icon-button"
                aria-label="Close prediction settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            {p.setup.nucleus === "1H" && (
              <div className="prediction-splitting-settings">
                <label>
                  Signal splitting
                  <select
                    aria-label="Prediction signal splitting"
                    disabled={running}
                    value={p.setup.splitting ?? "none"}
                    onChange={(e) =>
                      settings({
                        splitting: e.target.value as "none" | "first-order",
                      })
                    }
                  >
                    <option value="first-order">
                      Estimate first-order multiplets
                    </option>
                    <option value="none">Unsplit chemical shifts</option>
                  </select>
                </label>
                {p.setup.splitting === "first-order" && (
                  <>
                    <p className="prediction-splitting-note">
                      Typical J estimates. OH/NH exchange, unresolved CH₂
                      protons, and second-order effects can change the real
                      pattern.
                    </p>
                    <button
                      className="prediction-coupling-heading"
                      aria-expanded={couplingsOpen}
                      onClick={() => setCouplingsOpen(!couplingsOpen)}
                    >
                      <Waves size={14} /> Edit J couplings{" "}
                      <small>{couplingModel?.couplings.length ?? 0}</small>
                      <ChevronDown size={13} />
                    </button>
                    {couplingsOpen && (
                      <div className="prediction-couplings">
                        {!couplingModel && (
                          <p>Draw a valid structure to estimate couplings.</p>
                        )}
                        {couplingModel && !couplingModel.couplings.length && (
                          <p>
                            No automatic couplings between distinct carbon-bound
                            proton groups were found.
                          </p>
                        )}
                        {couplingModel?.couplings.map((c) => (
                          <div
                            className="prediction-coupling-row"
                            key={`${c.atomIdA}:${c.atomIdB}`}
                          >
                            <span
                              title={`${c.rule} · ${c.hydrogensA}H / ${c.hydrogensB}H`}
                            >
                              <strong>
                                {c.labelA} ↔ {c.labelB}
                              </strong>
                              <small>
                                {c.source === "manual"
                                  ? "Manual J"
                                  : c.rule.split(" · ")[0]}
                              </small>
                            </span>
                            <PredictionNumber
                              label={`J ${c.labelA}–${c.labelB} (Hz)`}
                              value={c.jHz}
                              min={0}
                              max={100}
                              disabled={running}
                              onChange={(j) =>
                                setCoupling(c.atomIdA, c.atomIdB, j)
                              }
                            />
                            <button
                              className="icon-button"
                              disabled={running}
                              title={
                                c.source === "manual"
                                  ? "Restore the estimate for this pair"
                                  : "Remove this coupling"
                              }
                              aria-label={
                                c.source === "manual"
                                  ? `Restore J for ${c.labelA}–${c.labelB}`
                                  : `Remove J for ${c.labelA}–${c.labelB}`
                              }
                              onClick={() =>
                                setCoupling(
                                  c.atomIdA,
                                  c.atomIdB,
                                  c.source === "manual" ? undefined : 0,
                                )
                              }
                            >
                              {c.source === "manual" ? (
                                <RotateCcw size={13} />
                              ) : (
                                <X size={13} />
                              )}
                            </button>
                          </div>
                        ))}
                        {disabledCouplings.map((c) => (
                          <div
                            className="prediction-coupling-removed"
                            key={`${c.atomIdA}:${c.atomIdB}`}
                          >
                            <span>
                              {
                                couplingModel?.sites.find(
                                  (s) => s.atomId === c.atomIdA,
                                )?.label
                              }{" "}
                              ↔{" "}
                              {
                                couplingModel?.sites.find(
                                  (s) => s.atomId === c.atomIdB,
                                )?.label
                              }{" "}
                              · removed
                            </span>
                            <button
                              disabled={running}
                              onClick={() => setCoupling(c.atomIdA, c.atomIdB)}
                              title="Restore automatic estimate"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                        {couplingModel && couplingModel.sites.length > 1 && (
                          <div className="prediction-manual-coupling">
                            <strong>Add a manual coupling</strong>
                            <div className="prediction-manual-sites">
                              <select
                                aria-label="Manual coupling first atom"
                                disabled={running}
                                value={manualA}
                                onChange={(e) => setManualA(e.target.value)}
                              >
                                <option value="">Atom A</option>
                                {couplingModel.sites.map((s) => (
                                  <option key={s.atomId} value={s.atomId}>
                                    {s.label} · {s.hydrogens}H
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Manual coupling second atom"
                                disabled={running}
                                value={manualB}
                                onChange={(e) => setManualB(e.target.value)}
                              >
                                <option value="">Atom B</option>
                                {couplingModel.sites
                                  .filter((s) => s.atomId !== manualA)
                                  .map((s) => (
                                    <option key={s.atomId} value={s.atomId}>
                                      {s.label} · {s.hydrogens}H
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div className="prediction-manual-j">
                              <PredictionNumber
                                label="Manual J (Hz)"
                                value={manualJ}
                                min={0.1}
                                max={100}
                                disabled={running}
                                onChange={setManualJ}
                              />
                              <button
                                disabled={
                                  running ||
                                  !manualA ||
                                  !manualB ||
                                  manualA === manualB
                                }
                                onClick={() => {
                                  const a = couplingModel.sites.find(
                                      (s) => s.atomId === manualA,
                                    ),
                                    b = couplingModel.sites.find(
                                      (s) => s.atomId === manualB,
                                    );
                                  if (!a || !b) return;
                                  if (
                                    a.parent === b.parent ||
                                    a.symmetry === b.symmetry
                                  ) {
                                    setError(
                                      "Equivalent or same-atom proton groups are treated as one site. Their mutual splitting is unresolved in this model.",
                                    );
                                    return;
                                  }
                                  setCoupling(manualA, manualB, manualJ);
                                }}
                              >
                                <Plus size={13} /> Add
                              </button>
                            </div>
                          </div>
                        )}
                        {!!p.setup.couplingOverrides?.length && (
                          <button
                            className="prediction-reset-couplings"
                            disabled={running}
                            onClick={() => settings({ couplingOverrides: [] })}
                          >
                            <RotateCcw size={12} /> Reset all J estimates
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <label>
              Experiment
              <select
                value={p.setup.nucleus}
                disabled={running}
                onChange={(e) =>
                  settings({
                    nucleus: e.target.value as "1H" | "13C",
                    frequencyMHz: e.target.value === "13C" ? 100.6 : 400,
                  })
                }
              >
                <option value="1H">¹H proton</option>
                <option value="13C">¹³C carbon</option>
              </select>
            </label>
            <div className="prediction-field-pair">
              <PredictionNumber
                label="Frequency (MHz)"
                value={p.setup.frequencyMHz}
                min={10}
                max={2000}
                disabled={running}
                onChange={(frequencyMHz) => settings({ frequencyMHz })}
              />
              <PredictionNumber
                label="Linewidth (Hz)"
                value={p.setup.lineWidthHz}
                min={0.1}
                max={100}
                disabled={running}
                onChange={(lineWidthHz) => settings({ lineWidthHz })}
              />
            </div>
            <label>
              Spectrum title
              <input
                placeholder="Predicted spectrum"
                maxLength={500}
                value={p.setup.title}
                disabled={running}
                onChange={(e) => settings({ title: e.target.value })}
              />
            </label>
            <div className="prediction-engine">
              <Check size={15} />
              <div>
                <strong>CDK environment lookup</strong>
                <span>
                  Experimental nmrshiftdb environments. Database matches
                  determine the shifts.
                </span>
              </div>
            </div>
            <button
              className="primary prediction-run"
              disabled={!p.setup.molecule?.atoms.length || running}
              onClick={() => void predict()}
              title="Predict chemical shifts and add a new spectrum to this project"
            >
              {running ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Play size={16} />
              )}{" "}
              {running ? "Predicting…" : `Predict ${p.setup.nucleus}`}
            </button>
            {running && (
              <div className="prediction-progress" role="status">
                <span>{progress}</span>
                <button
                  className="icon-button"
                  aria-label="Cancel prediction"
                  onClick={() => {
                    abort.current?.abort();
                    setRunning(false);
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {error && (
              <div className="prediction-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="secondary"
              disabled={
                !p.setup.molecule?.atoms.length || !p.canAttach || running
              }
              onClick={p.onAttach}
              title="Place this molecule on the active spectrum, then assign its atoms to peaks"
            >
              Place on current spectrum
            </button>
            <p className="prediction-note">
              Predictions create a new spectrum in the list on the left.
              Chemical shifts come from reference matches; optional proton
              splitting uses editable J estimates. Carbon signals are
              proton-decoupled.
            </p>
            <a
              className="prediction-attribution"
              href="/prediction/about.html"
              target="_blank"
              rel="noreferrer"
            >
              Reference data, licenses & source
            </a>
            {result && (
              <div className="prediction-result">
                <button
                  className="prediction-details"
                  onClick={() => setDetails(!details)}
                >
                  <Check size={15} />
                  {result.shifts.length} environments matched
                  <ChevronDown size={14} />
                </button>
                {result.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {result.splitting?.warnings.map((w, i) => (
                  <p key={`splitting-${i}`}>{w}</p>
                ))}
                {details && (
                  <div className="prediction-match-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Atom</th>
                          <th>δ / ppm</th>
                          <th>Pattern</th>
                          <th>Radius</th>
                          <th>Matches</th>
                          <th>Range / ppm</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.shifts.map((s, i) => (
                          <tr key={i}>
                            <td>
                              {p.setup.molecule?.atoms[s.atomIndex]?.element}
                              {p.setup.molecule?.atoms[s.atomIndex]?.index}
                            </td>
                            <td>{s.shiftPpm.toFixed(3)}</td>
                            <td title="Approximate first-order pattern">
                              {result.splitting?.signals.find(
                                (signal) => signal.atomIndex === s.atomIndex,
                              )?.kind ?? "s"}
                            </td>
                            <td>{s.radius}</td>
                            <td>{s.sampleCount}</td>
                            <td>
                              {s.minPpm.toFixed(2)}–{s.maxPpm.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      {running && (
        <div className="prediction-status">
          <LoaderCircle className="spin" size={13} />
          <span>{progress}</span>
          <button
            onClick={() => {
              abort.current?.abort();
              setRunning(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && !settingsOpen && (
        <div className="prediction-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
