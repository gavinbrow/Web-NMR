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
import { LearnedCouplingControls } from "./LearnedCouplingControls";
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
  const experiment = p.setup.experiment ?? p.setup.nucleus;
  const isTwoD = experiment === "HSQC" || experiment === "COSY";
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
    if (
      patch.molecule ||
      patch.nucleus ||
      patch.engine ||
      patch.numConformers ||
      patch.experiment ||
      patch.hsqcEdited !== undefined ||
      patch.cosyMinJHz !== undefined
    )
      setResult(null);
    setError("");
    const next = { ...p.setup, ...patch };
    if (patch.engine && (next.splitting ?? "first-order") !== "none")
      next.splitting =
        patch.engine === "cascade" ? "spin-system" : "first-order";
    if (patch.molecule) {
      next.spinCouplingOverrides = [];
      const ids = new Set(patch.molecule.atoms.map((a) => a.id));
      next.couplingOverrides = (next.couplingOverrides ?? []).filter(
        (c) => ids.has(c.atomIdA) && ids.has(c.atomIdB),
      );
    }
    p.onChange(next);
  };
  const selectExperiment = (
    value: NonNullable<PredictionSetup["experiment"]>,
  ) => {
    const nucleus = value === "13C" ? "13C" : "1H";
    settings({
      experiment: value,
      nucleus,
      frequencyMHz:
        nucleus === p.setup.nucleus
          ? p.setup.frequencyMHz
          : nucleus === "13C"
            ? 100.6
            : 400,
    });
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
    // Each prediction uses its own compact atom numbering. Keep IDs and input
    // order intact, so existing spectra and peak assignments remain independent.
    molecule.atoms.forEach((a, i) => {
      a.index = i + 1;
    });
    molecule.nextAtomIndex = molecule.atoms.length + 1;
    p.onChange(setup);
    setRunning(true);
    setError("");
    setProgress("Preparing molecule…");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const aromaticBonds = exportPredictionAromaticBonds(molecule);
      const input = {
        engine: setup.engine,
        numConformers: setup.numConformers,
        splitting:
          setup.splitting ??
          (setup.engine === "cascade" ? "spin-system" : "first-order"),
        spinCouplingOverrides: setup.spinCouplingOverrides,
        molfile: exportMoleculeMolfile(molecule),
        aromaticBonds,
        nucleus: setup.nucleus,
        frequencyMHz: setup.frequencyMHz,
        lineWidthHz: setup.lineWidthHz,
      };
      const options = {
        signal: controller.signal,
        onProgress: (value: import("../prediction/types").PredictionProgress) =>
          setProgress(value.message),
      };
      const selectedExperiment = setup.experiment ?? setup.nucleus;
      const output =
        selectedExperiment === "HSQC" || selectedExperiment === "COSY"
          ? await (
              await import("../prediction/twoDClient")
            ).predictTwoDMolecule(
              {
                ...input,
                experiment: selectedExperiment,
                molecule,
                hsqcEdited: setup.hsqcEdited,
                cosyMinJHz: setup.cosyMinJHz,
                couplingOverrides: setup.couplingOverrides,
              },
              options,
            )
          : await predictMolecule(input, options);
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
        <select
          aria-label="Prediction engine"
          title="Choose local prediction method"
          disabled={running}
          value={p.setup.engine ?? "cdk-hose-nmrshiftdb"}
          onChange={(e) =>
            settings({ engine: e.target.value as PredictionSetup["engine"] })
          }
        >
          <option value="cdk-hose-nmrshiftdb">CDK lookup</option>
          <option value="cascade">CASCADE · 3D</option>
        </select>
        <div
          className="prediction-nucleus-switch"
          role="group"
          aria-label="Prediction experiment"
        >
          {(["1H", "13C", "HSQC", "COSY"] as const).map((value) => (
            <button
              key={value}
              disabled={running}
              aria-pressed={experiment === value}
              title={
                value === "HSQC"
                  ? "Predict directly bonded proton–carbon correlations"
                  : value === "COSY"
                    ? "Predict coupled proton–proton correlations"
                    : `Predict ${value} spectrum`
              }
              onClick={() => selectExperiment(value)}
            >
              {value === "1H" ? "¹H" : value === "13C" ? "¹³C" : value}
            </button>
          ))}
        </div>
        {!isTwoD && p.setup.nucleus === "1H" ? (
          <button
            className={`prediction-splitting-toggle ${(p.setup.splitting ?? "first-order") !== "none" ? "active" : ""}`}
            disabled={running}
            aria-pressed={(p.setup.splitting ?? "first-order") !== "none"}
            title="Toggle signal splitting. CASCADE uses learned J values; choose exact or first-order simulation in Settings."
            onClick={() =>
              settings({
                splitting:
                  (p.setup.splitting ?? "first-order") !== "none"
                    ? "none"
                    : p.setup.engine === "cascade"
                      ? "spin-system"
                      : "first-order",
              })
            }
          >
            <Waves size={15} />
            <span>
              {(p.setup.splitting ?? "first-order") !== "none"
                ? "Splitting on"
                : "Unsplit"}
            </span>
          </button>
        ) : !isTwoD ? (
          <small
            className="prediction-decoupled"
            title="Carbon spectra are simulated with proton decoupling"
          >
            ¹H decoupled
          </small>
        ) : null}
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
          {running
            ? "Predicting…"
            : `Predict ${isTwoD ? experiment : "spectrum"}`}
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
            {p.setup.nucleus === "1H" && experiment !== "HSQC" && (
              <div className="prediction-splitting-settings">
                {!isTwoD && (
                  <label>
                    Signal splitting
                    <select
                      aria-label="Prediction signal splitting"
                      disabled={running}
                      value={p.setup.splitting ?? "first-order"}
                      onChange={(e) =>
                        settings({
                          splitting: e.target
                            .value as PredictionSetup["splitting"],
                        })
                      }
                    >
                      {p.setup.engine === "cascade" && (
                        <option value="spin-system">
                          Learned J · exact spin simulation
                        </option>
                      )}
                      <option value="first-order">
                        {p.setup.engine === "cascade"
                          ? "Learned J · first order"
                          : "Typical J · first order"}
                      </option>
                      <option value="none">Unsplit chemical shifts</option>
                    </select>
                  </label>
                )}
                {!isTwoD &&
                  p.setup.engine === "cascade" &&
                  p.setup.splitting === "spin-system" && (
                    <p className="prediction-splitting-note">
                      Exact second-order display for systems up to 10 protons;
                      larger systems automatically use learned-J first-order
                      splitting.
                    </p>
                  )}
                {experiment === "COSY" && (
                  <p className="prediction-splitting-note">
                    COSY cross-peaks use{" "}
                    {p.setup.engine === "cascade"
                      ? "learned signed"
                      : "editable typical"}{" "}
                    proton J couplings. Display intensities are approximate.
                  </p>
                )}
                {p.setup.engine === "cascade" ? (
                  <LearnedCouplingControls
                    result={result}
                    setup={p.setup}
                    disabled={running}
                    onChange={settings}
                  />
                ) : (
                  (isTwoD ||
                    (p.setup.splitting ?? "first-order") !== "none") && (
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
                              No automatic couplings between distinct
                              carbon-bound proton groups were found.
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
                                onClick={() =>
                                  setCoupling(c.atomIdA, c.atomIdB)
                                }
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
                              onClick={() =>
                                settings({ couplingOverrides: [] })
                              }
                            >
                              <RotateCcw size={12} /> Reset all J estimates
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )
                )}
              </div>
            )}
            <label>
              Prediction method
              <select
                aria-label="Prediction method"
                value={p.setup.engine ?? "cdk-hose-nmrshiftdb"}
                disabled={running}
                onChange={(e) =>
                  settings({
                    engine: e.target.value as PredictionSetup["engine"],
                  })
                }
              >
                <option value="cdk-hose-nmrshiftdb">
                  CDK · experimental environment lookup
                </option>
                <option value="cascade">CASCADE · 3D neural network</option>
              </select>
            </label>
            {p.setup.engine === "cascade" && (
              <PredictionNumber
                label="Conformers"
                value={p.setup.numConformers ?? 10}
                min={1}
                max={10}
                disabled={running}
                onChange={(numConformers) =>
                  settings({ numConformers: Math.floor(numConformers) })
                }
              />
            )}
            <label>
              Experiment
              <select
                aria-label="Prediction experiment"
                value={experiment}
                disabled={running}
                onChange={(e) =>
                  selectExperiment(
                    e.target.value as NonNullable<
                      PredictionSetup["experiment"]
                    >,
                  )
                }
              >
                <option value="1H">¹H proton</option>
                <option value="13C">¹³C carbon</option>
                <option value="HSQC">HSQC · ¹H–¹³C</option>
                <option value="COSY">COSY · ¹H–¹H</option>
              </select>
            </label>
            {experiment === "HSQC" && (
              <label className="prediction-check">
                <input
                  type="checkbox"
                  checked={p.setup.hsqcEdited ?? false}
                  disabled={running}
                  onChange={(e) => settings({ hsqcEdited: e.target.checked })}
                />
                Multiplicity-edited HSQC · CH₂ opposite sign
              </label>
            )}
            {experiment === "COSY" && (
              <PredictionNumber
                label="Minimum |J| (Hz)"
                value={p.setup.cosyMinJHz ?? 0.5}
                min={0}
                max={100}
                disabled={running}
                onChange={(cosyMinJHz) => settings({ cosyMinJHz })}
              />
            )}
            <div className="prediction-field-pair">
              <PredictionNumber
                label={isTwoD ? "¹H frequency (MHz)" : "Frequency (MHz)"}
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
                <strong>
                  {p.setup.engine === "cascade"
                    ? "CASCADE · local 3D neural network"
                    : "CDK environment lookup"}
                </strong>
                <span>
                  {p.setup.engine === "cascade"
                    ? "ETKDGv3/MMFF94 conformers and original CASCADE weights. Undefined stereocenters use one reproducible representative stereoisomer, stated in the spectrum comments. Its conformers are Boltzmann-weighted."
                    : "Experimental nmrshiftdb environments. Database matches determine the shifts."}
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
              {running ? "Predicting…" : `Predict ${experiment}`}
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
              {isTwoD ? (
                <>
                  {experiment === "HSQC"
                    ? "Directly bonded ¹H–¹³C pairs form HSQC cross-peaks. CH₂ sites remain separate when the shift model resolves them."
                    : "Coupled ¹H sites form symmetric COSY cross-peaks and a diagonal. Exchangeable proton couplings are omitted."}{" "}
                  Predicted 1D traces are included in the same document. Contour
                  intensities and widths are approximate; pulse-sequence
                  transfer and relaxation are not simulated.
                </>
              ) : (
                <>
                  Predictions create a new spectrum in the list on the left.
                  {p.setup.engine === "cascade"
                    ? "Chemical shifts come from local CASCADE neural inference and an ensemble of 3D conformers."
                    : "Chemical shifts come from experimental reference matches."}{" "}
                  {p.setup.engine === "cascade"
                    ? "Proton splitting uses learned signed J values, with exact second-order simulation available."
                    : "Proton splitting uses editable typical J estimates."}{" "}
                  Carbon signals are proton-decoupled. Automatic integrals show
                  modeled nucleus counts, with raw simulated areas retained
                  separately.
                </>
              )}
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
                  {result.twoD ? (
                    `${result.twoD.experiment} · ${result.twoD.correlations.filter((c) => c.kind !== "diagonal").length} correlations`
                  ) : (
                    <>
                      {result.shifts.length}{" "}
                      {result.engine === "cascade"
                        ? "atom shifts predicted"
                        : "environments matched"}
                    </>
                  )}
                  <ChevronDown size={14} />
                </button>
                {[
                  ...new Set([
                    ...result.warnings,
                    ...(result.splitting?.warnings ?? []),
                    ...(result.twoD?.warnings ?? []),
                  ]),
                ].map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {details && result.twoD && (
                  <div className="prediction-match-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Atom pair</th>
                          <th>F2 / ppm</th>
                          <th>F1 / ppm</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.twoD.correlations.map((c) => {
                          const atom = (id: string, label?: string) => {
                            const a = p.setup.molecule?.atoms.find(
                              (a) => a.id === id,
                            );
                            return (
                              label ?? `${a?.element ?? ""}${a?.index ?? ""}`
                            );
                          };
                          return (
                            <tr key={c.id}>
                              <td>
                                {atom(c.atomIdX, c.protonLabelX)} ↔{" "}
                                {atom(c.atomIdY, c.protonLabelY)}
                              </td>
                              <td>{c.xPpm.toFixed(3)}</td>
                              <td>{c.yPpm.toFixed(3)}</td>
                              <td>{c.kind}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {details && !result.twoD && (
                  <div className="prediction-match-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Atom</th>
                          <th>δ / ppm</th>
                          <th>Pattern</th>
                          <th>
                            {result.engine === "cascade" ? "Model" : "Radius"}
                          </th>
                          <th>
                            {result.engine === "cascade"
                              ? "Conformers"
                              : "Matches"}
                          </th>
                          <th>
                            {result.engine === "cascade"
                              ? "Conformer spread / ppm"
                              : "Range / ppm"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.shifts.map((s, i) => (
                          <tr key={i}>
                            <td>
                              {p.setup.molecule?.atoms[s.atomIndex]?.element}
                              {p.setup.molecule?.atoms[s.atomIndex]?.index}
                              {s.atomLabel ? ` ${s.atomLabel}` : ""}
                            </td>
                            <td>{s.shiftPpm.toFixed(3)}</td>
                            <td
                              title={
                                result.spinSystem?.display.mode ===
                                "spin-system"
                                  ? "Collective second-order spin transitions"
                                  : "First-order pattern"
                              }
                            >
                              {result.splitting?.signals.find(
                                (signal) => signal.atomIndex === s.atomIndex,
                              )?.kind ?? "s"}
                            </td>
                            <td>
                              {result.engine === "cascade" ? "3D" : s.radius}
                            </td>
                            <td>{s.sampleCount}</td>
                            <td>
                              {result.engine === "cascade"
                                ? s.conformerStdDevPpm?.toFixed(3)
                                : `${s.minPpm.toFixed(2)}–${s.maxPpm.toFixed(2)}`}
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
