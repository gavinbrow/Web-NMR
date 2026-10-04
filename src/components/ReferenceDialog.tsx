import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  solventReferences,
  solventShifts,
  referenceNucleus,
} from "../features/reference";
import "./ReferenceDialog.css";

export interface ReferenceAxis {
  label: string;
  nucleus: string;
  observed: number;
}
interface Props {
  axes: ReferenceAxis[];
  onClose: () => void;
  onApply: (observed: number[], targets: number[], annotation: string) => void;
  onTune?: (
    axis: number,
    observed: number,
    width: number,
    absolute: boolean,
  ) => number | undefined;
}
export function ReferenceDialog({ axes, onClose, onApply, onTune }: Props) {
  const dialog = useRef<HTMLFormElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [observed] = useState(axes.map((a) => a.observed));
  const [targets, setTargets] = useState(axes.map((a) => a.observed));
  const [axis, setAxis] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [autoTune, setAutoTune] = useState(false);
  const [width, setWidth] = useState(0.1);
  const [absolute, setAbsolute] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const nucleus = referenceNucleus(axes[axis].nucleus);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const input = dialog.current?.querySelector<HTMLInputElement>(
      'input[aria-label="New reference shift ppm"]',
    );
    input?.focus();
    input?.select();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),a[href]",
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      before?.focus();
    };
  }, []);
  const changeTarget = (value: number) => {
    setTargets((v) => v.map((n, i) => (i === axis ? value : n)));
    setSelected("");
  };
  const apply = () => {
    if (
      !targets.every(Number.isFinite) ||
      !Number.isFinite(width) ||
      width <= 0
    )
      return;
    const positions = [...observed];
    if (autoTune && onTune) {
      const peak = onTune(axis, positions[axis], width, absolute);
      if (peak === undefined) {
        setError(
          "No resolved peak in the tuning range. Turn off Auto tuning to reference this position manually.",
        );
        return;
      }
      positions[axis] = peak;
    }
    onApply(positions, targets, annotation.trim());
  };
  const rows = solventReferences.filter((s) =>
    `${s.name} ${s.formula}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="reference-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={dialog}
        className={`reference-dialog ${expanded ? "expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Reference spectrum"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <header>
          <strong>
            Reference {axes.length === 1 ? "spectrum" : "2D spectrum"}
          </strong>
          <button
            type="button"
            className="icon-button"
            title="Close reference dialog (Esc)"
            aria-label="Close reference dialog"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        {axes.length > 1 && (
          <div className="reference-axis-tabs">
            {axes.map((a, i) => (
              <button
                type="button"
                key={a.label}
                className={axis === i ? "active" : ""}
                onClick={() => {
                  setAxis(i);
                  setSelected("");
                  setError("");
                }}
              >
                {a.label} · {a.nucleus}
              </button>
            ))}
          </div>
        )}
        <div className="reference-body">
          <div className="reference-controls">
            <div className="reference-shifts">
              <label>
                <span>Old shift</span>
                <output>
                  {observed[axis].toFixed(5)} <small>ppm</small>
                </output>
              </label>
              <label>
                <span>New shift</span>
                <input
                  type="number"
                  aria-label="New reference shift ppm"
                  step="0.0001"
                  value={targets[axis]}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    Number.isFinite(e.target.valueAsNumber) &&
                    changeTarget(e.target.valueAsNumber)
                  }
                />
                <small>ppm</small>
              </label>
            </div>
            <fieldset className="reference-tuning">
              <legend>
                <label>
                  <input
                    type="checkbox"
                    checked={autoTune}
                    onChange={(e) => {
                      setAutoTune(e.target.checked);
                      setError("");
                    }}
                    disabled={!onTune}
                  />{" "}
                  Auto tuning
                </label>
              </legend>
              <label>
                Range width{" "}
                <input
                  aria-label="Reference tuning range width"
                  type="number"
                  min=".0001"
                  step=".01"
                  disabled={!autoTune}
                  value={width}
                  onChange={(e) =>
                    Number.isFinite(e.target.valueAsNumber) &&
                    setWidth(e.target.valueAsNumber)
                  }
                />
                <small>ppm</small>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={absolute}
                  disabled={!autoTune}
                  onChange={(e) => setAbsolute(e.target.checked)}
                />{" "}
                Use absolute values
              </label>
            </fieldset>
          </div>
          <label className="reference-annotation">
            Annotation
            <input
              aria-label="Reference annotation"
              value={annotation}
              maxLength={200}
              onChange={(e) => setAnnotation(e.target.value)}
            />
          </label>
          {axes.length > 1 && (
            <p className="reference-summary">
              {axes.map((a, i) => (
                <span key={a.label}>
                  {a.label}: {observed[i].toFixed(4)} → {targets[i].toFixed(4)}{" "}
                  ppm
                </span>
              ))}
            </p>
          )}
          {expanded && (
            <section
              className="reference-solvents"
              aria-label="Solvent and standard list"
            >
              <div className="reference-list-heading">
                <strong>Solvents & standards · {axes[axis].nucleus}</strong>
                <label>
                  <Search size={13} />
                  <input
                    aria-label="Find solvent or standard"
                    placeholder="Find solvent…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="reference-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Signal</th>
                      <th>Shift (ppm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const shifts = solventShifts(s, axes[axis].nucleus);
                      return shifts.length ? (
                        shifts.map((shift, i) => (
                          <tr
                            key={`${s.id}-${i}`}
                            onClick={() => {
                              setTargets((v) =>
                                v.map((n, j) => (j === axis ? shift : n)),
                              );
                              setSelected(`${s.id}-${i}`);
                              setAnnotation(
                                `${s.formula} · ${shift.toFixed(3)} ppm`,
                              );
                              setError("");
                            }}
                            className={
                              selected === `${s.id}-${i}` ? "selected" : ""
                            }
                          >
                            <td>
                              <button
                                type="button"
                                title={
                                  s.note ??
                                  `Use ${s.name} at ${shift.toFixed(3)} ppm`
                                }
                              >
                                {s.name}
                              </button>
                            </td>
                            <td>{s.formula}</td>
                            <td>{shift.toFixed(3)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr key={s.id} className="unavailable">
                          <td>{s.name}</td>
                          <td>{s.formula}</td>
                          <td title={s.note ?? "No preset for this nucleus"}>
                            —
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="reference-source">
                {nucleus === "other"
                  ? "Enter a manual shift for this nucleus. "
                  : "Choose a residual solvent line; values vary with temperature and sample conditions. "}
                <a
                  href="https://www.stoltz2.caltech.edu/publications/103-2010.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Shift reference
                </a>
                {nucleus === "1H" && " · D₂O: HDO near 25 °C."}
              </p>
            </section>
          )}
          {error && (
            <p className="reference-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            OK
          </button>
          <button
            type="button"
            className={`secondary reference-expand ${expanded ? "active" : ""}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Solvents" : "Solvents / standards"}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </footer>
      </form>
    </div>
  );
}
