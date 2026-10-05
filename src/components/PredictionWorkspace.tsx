import { useEffect, useRef, useState } from "react";
import { Atom, Check, ChevronDown, LoaderCircle, Play, X } from "lucide-react";
import { MoleculeEditor } from "./MoleculeEditor";
import {
  exportMoleculeMolfile,
  exportPredictionAromaticBonds,
  type MoleculeDocument,
} from "../features/molecule";
import type { PredictionSetup } from "../features/predictionSetup";
import type { PredictionResult } from "../prediction/types";
import { predictMolecule } from "../prediction/client";
import "./PredictionWorkspace.css";

interface Props {
  setup: PredictionSetup;
  onChange: (setup: PredictionSetup) => void;
  onPredict: (
    result: PredictionResult,
    setup: PredictionSetup,
    molecule: MoleculeDocument,
  ) => void;
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
    [details, setDetails] = useState(false);
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
    p.onChange({ ...p.setup, ...patch });
  };
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
      setResult(output);
      p.onPredict(output, setup, molecule);
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
        <Atom size={19} />
        <strong>Prediction</strong>
        <span>Draw a structure, import SMILES, then predict.</span>
        <small>All calculations stay in your browser</small>
      </div>
      <div className="prediction-layout">
        <div className="prediction-editor">
          <MoleculeEditor
            value={p.setup.molecule}
            onChange={(molecule) => settings({ molecule })}
          />
        </div>
        <aside className="prediction-settings" aria-label="Prediction settings">
          <h2>Predict a spectrum</h2>
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
                Experimental nmrshiftdb environments. Database matches determine
                the shifts.
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
            Predictions create a new spectrum in the list on the left. Signals
            are unsplit; this engine does not calculate coupling constants.
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
              {details && (
                <div className="prediction-match-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Atom</th>
                        <th>δ / ppm</th>
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
      </div>
    </section>
  );
}
