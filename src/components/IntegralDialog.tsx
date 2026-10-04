import { useEffect, useRef, useState } from "react";
import type { Integral, Spectrum } from "../model";
import { displayedIntegralValue } from "../features/integrals";
export function IntegralDialog({
  spectrum,
  integral,
  stack,
  onClose,
  onApply,
}: {
  spectrum: Spectrum;
  integral: Integral;
  stack: boolean;
  onClose: () => void;
  onApply: (
    from: number,
    to: number,
    label: string,
    value: number,
    all: boolean,
    normalize: boolean,
  ) => void;
}) {
  const [from, F] = useState(integral.from),
    [to, T] = useState(integral.to),
    [label, L] = useState(integral.label),
    [value, V] = useState(displayedIntegralValue(spectrum, integral)),
    [all, A] = useState(false),
    [normalize, R] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>("button,input") ?? [],
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
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="modal integral-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Integral"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2>Edit Integral</h2>
          <button aria-label="Close integral editor" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="field">
          Label
          <input
            aria-label="Integral label"
            value={label}
            onChange={(e) => L(e.target.value)}
          />
        </label>
        <div className="two-fields">
          <label className="field">
            From (ppm)
            <input
              aria-label="Integral from ppm"
              type="number"
              step="0.001"
              value={from}
              onChange={(e) => F(e.target.valueAsNumber)}
            />
          </label>
          <label className="field">
            To (ppm)
            <input
              aria-label="Integral to ppm"
              type="number"
              step="0.001"
              value={to}
              onChange={(e) => T(e.target.valueAsNumber)}
            />
          </label>
        </div>
        <label className="field">
          Normalized value / nuclides count
          <input
            aria-label="Normalized integral value"
            type="number"
            min="0.01"
            step="0.1"
            value={value}
            onChange={(e) => {
              V(e.target.valueAsNumber);
              R(true);
            }}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => R(e.target.checked)}
          />
          Use this integral as the normalization reference
        </label>
        <p className="muted-small">
          Set the value of a known signal. All other integral values follow this
          reference, including after phase and baseline correction.
        </p>
        {stack && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => A(e.target.checked)}
            />
            Apply to matching integrals in every stack member
          </label>
        )}
        <div className="processing-buttons">
          <button
            className="primary"
            disabled={
              ![from, to, value].every(Number.isFinite) ||
              from === to ||
              value <= 0
            }
            onClick={() => onApply(from, to, label, value, all, normalize)}
          >
            OK
          </button>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
