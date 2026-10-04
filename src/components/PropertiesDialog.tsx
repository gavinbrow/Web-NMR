import { useEffect, useRef, useState } from "react";
import { X, Save, Upload, RotateCcw } from "lucide-react";
import type { Spectrum } from "../model";
import {
  defaultProperties,
  validProperties,
  type SpectrumProperties,
} from "../features/appearance";

type Section =
  | "General"
  | "Grid"
  | "1D"
  | "Scales"
  | "Horizontal"
  | "Vertical"
  | "Peaks"
  | "Integrals"
  | "Multiplets"
  | "Stack"
  | "Geometry"
  | "Metadata";
type Definition = [keyof SpectrumProperties, string, string[]?];
const sections: Record<Exclude<Section, "Metadata">, Definition[]> = {
  General: [
    ["background", "Background color"],
    ["backgroundOpacity", "Background opacity (%)"],
    ["title", "Show title"],
    ["titleText", "Title text (blank uses file title)"],
    [
      "titleFont",
      "Title font",
      ["Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"],
    ],
    ["titleSize", "Title font size"],
    ["titleColor", "Title color"],
    ["titleAlignment", "Alignment", ["left", "center", "right"]],
    ["titlePosition", "Position", ["inside", "outside"]],
    ["titleX", "Horizontal offset (px)"],
    ["titleY", "Vertical offset (px)"],
  ],
  Grid: [
    ["gridVertical", "Show vertical"],
    ["gridHorizontal", "Show horizontal"],
    ["gridBaseline", "Show zero baseline"],
    ["gridFrame", "Show frame"],
    ["gridOver", "Draw grid over traces"],
    ["gridColor", "Grid color"],
    ["gridWidth", "Grid line width"],
  ],
  "1D": [
    ["lineStyle", "Style", ["line", "dots", "sticks"]],
    ["lineWidth", "Line width"],
    ["lineOpacity", "Trace opacity (%)"],
  ],
  Scales: [
    ["scaleColor", "Scale color"],
    ["scaleWidth", "Line width"],
    [
      "scaleFont",
      "Font",
      ["Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"],
    ],
    ["scaleSize", "Font size"],
    ["scaleMargin", "Scale margin (px)"],
  ],
  Horizontal: [
    ["horizontal", "Show horizontal scale"],
    ["horizontalLabel", "Show label"],
    ["horizontalText", "Label"],
    ["horizontalUnits", "Units", ["ppm", "Hz"]],
    ["horizontalDecimals", "Maximum decimal places"],
    ["horizontalAutoTicks", "Automatic primary ticks"],
    ["horizontalTicks", "Primary tick count"],
    ["horizontalMinorTicks", "Secondary ticks"],
    ["horizontalPosition", "Position", ["bottom", "top", "both"]],
  ],
  Vertical: [
    ["vertical", "Show vertical scale"],
    ["verticalLabel", "Show label"],
    ["verticalText", "Label"],
    ["verticalDecimals", "Decimal places"],
    ["verticalTicks", "Primary tick count"],
    ["verticalMinorTicks", "Secondary ticks"],
    ["verticalPosition", "Position", ["left", "right", "both"]],
  ],
  Peaks: [
    ["peakTicks", "Show ticks"],
    ["peakLabels", "Show labels"],
    ["peakDecimals", "Decimals"],
    ["peakUnits", "Units", ["ppm", "Hz"]],
    ["peakPosition", "Label position", ["top", "curve"]],
    ["peakUseTraceColor", "Use curve color"],
    ["peakColor", "Label color"],
    ["peakWidth", "Tick line width"],
    ["peakSize", "Font size"],
    [
      "peakFont",
      "Font",
      ["Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"],
    ],
  ],
  Integrals: [
    ["integrals", "Show integrals"],
    ["integralLabels", "Show labels"],
    ["integralCurves", "Show cumulative curves"],
    ["integralBaseline", "Show baseline"],
    ["integralDecimals", "Decimals"],
    ["integralColor", "Color"],
    ["integralWidth", "Line width"],
    ["integralSize", "Font size"],
    [
      "integralFont",
      "Font",
      ["Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"],
    ],
    ["integralLabelPosition", "Label position", ["segment", "curve"]],
    ["integralOrientation", "Label orientation", ["horizontal", "vertical"]],
    ["integralMethodSymbol", "Show calculation method symbol"],
    ["integralMargin", "Label margin (%)"],
    ["integralPosition", "Curve position (%)"],
    ["integralHeight", "Maximum height (%)"],
  ],
  Multiplets: [
    ["multipletLabels", "Show labels"],
    ["multipletShiftDecimals", "Shift decimals"],
    ["multipletJDecimals", "J decimals"],
    ["multipletSize", "Font size"],
    [
      "multipletFont",
      "Font",
      ["Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"],
    ],
    ["multipletPosition", "Position (%)"],
    ["multipletWidth", "Line width"],
    ["multipletBox", "Show box"],
    ["multipletBackground", "Background color"],
    ["multipletOpacity", "Background opacity (%)"],
    ["multipletFormat", "Label", ["name", "shift", "full"]],
    ["multipletJTree", "Show first-order J tree"],
  ],
  Stack: [
    ["stackLabels", "Show trace names"],
    ["stackSpacing", "Vertical spacing (%)"],
    ["stackHorizontalOffset", "Horizontal displacement (px per trace)"],
  ],
  Geometry: [
    ["paperWidth", "Spectrum width (% of page)"],
    ["paperHeight", "Spectrum height (% of page)"],
    ["paperX", "Horizontal offset (px)"],
    ["paperY", "Vertical offset (px)"],
  ],
};
export function PropertiesDialog({
  spectrum,
  initial,
  stack,
  onApply,
  onClose,
  onDefault,
}: {
  spectrum: Spectrum;
  initial: SpectrumProperties;
  stack: boolean;
  onApply: (
    p: SpectrumProperties,
    label: string,
    color: string,
    metadata: Spectrum["metadata"],
    all: boolean,
  ) => void;
  onClose: () => void;
  onDefault: (p: SpectrumProperties) => void;
}) {
  const [section, setSection] = useState<Section>("General"),
    [draft, setDraft] = useState(initial),
    [label, setLabel] = useState(spectrum.label),
    [color, setColor] = useState(spectrum.color),
    [metadata, setMetadata] = useState(spectrum.metadata),
    [all, setAll] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not([type="file"]):not(:disabled),select:not(:disabled)',
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog.current?.addEventListener("keydown", trap);
    return () => {
      dialog.current?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  const apply = () => onApply(draft, label, color, metadata, all);
  function number(key: keyof SpectrumProperties, n: number) {
    if (!Number.isFinite(n)) return;
    let min = 0,
      max = 100;
    if (/Decimals/.test(key)) max = 8;
    else if (/Ticks/.test(key)) {
      min = 1;
      max = 20;
    } else if (/Width/.test(key) && key !== "paperWidth") {
      min = 0.2;
      max = 8;
    } else if (/Size/.test(key)) {
      min = 6;
      max = 36;
    } else if (
      [
        "titleX",
        "titleY",
        "paperX",
        "paperY",
        "stackHorizontalOffset",
      ].includes(key)
    ) {
      min = -300;
      max = 300;
    } else if (key === "stackSpacing") {
      min = 20;
      max = 150;
    } else if (key === "paperWidth" || key === "paperHeight") {
      min = 30;
      max = 100;
    }
    setDraft((p) => ({ ...p, [key]: Math.max(min, Math.min(max, n)) }));
  }
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal properties-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Spectrum Properties"
      >
        <div className="modal-title">
          <div>
            <span className="eyebrow">SPECTRUM APPEARANCE</span>
            <h2>Properties</h2>
          </div>
          <button
            aria-label="Close properties"
            className="icon-button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="properties-layout">
          <nav aria-label="Property sections">
            {[...Object.keys(sections), "Metadata"].map((s) => (
              <button
                key={s}
                className={section === s ? "active" : ""}
                onClick={() => setSection(s as Section)}
              >
                {s}
              </button>
            ))}
          </nav>
          <div className="properties-fields">
            {section === "General" && (
              <label className="field">
                Spectrum name
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            )}
            {section === "1D" && (
              <label className="field">
                Trace color
                <input
                  type="color"
                  aria-label="Properties trace color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
            )}
            {section !== "Metadata" &&
              sections[section].map(([key, name, choices]) =>
                typeof draft[key] === "boolean" ? (
                  <label key={key} className="check-field">
                    <input
                      type="checkbox"
                      checked={draft[key] as boolean}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, [key]: e.target.checked }))
                      }
                    />
                    {name}
                  </label>
                ) : (
                  <label key={key} className="field">
                    {name}
                    {choices ? (
                      <select
                        value={String(draft[key])}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, [key]: e.target.value }))
                        }
                      >
                        {choices.map((c) => (
                          <option
                            key={c}
                            disabled={c === "Hz" && spectrum.frequencyMHz <= 0}
                          >
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          typeof draft[key] === "number"
                            ? "number"
                            : /color|background/i.test(key)
                              ? "color"
                              : "text"
                        }
                        step={/Width/.test(key) ? ".1" : "1"}
                        value={draft[key] as string | number}
                        onChange={(e) =>
                          typeof draft[key] === "number"
                            ? number(key, e.target.valueAsNumber)
                            : setDraft((p) => ({ ...p, [key]: e.target.value }))
                        }
                      />
                    )}
                  </label>
                ),
              )}
            {section === "Metadata" && (
              <>
                <p className="panel-description">
                  Acquisition parameters remain part of the original data. Add
                  or edit report metadata here.
                </p>
                {Object.entries(metadata).map(([key, v]) => (
                  <label className="field" key={key}>
                    {key}
                    <input
                      value={v}
                      onChange={(e) =>
                        setMetadata((m) => ({ ...m, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <button
                  className="secondary"
                  onClick={() =>
                    setMetadata((m) => ({
                      ...m,
                      ["Comment " +
                      (Object.keys(m).filter((k) => k.startsWith("Comment"))
                        .length +
                        1)]: "",
                    }))
                  }
                >
                  Add comment
                </button>
              </>
            )}
            {section === "Stack" && (
              <p className="muted-small">
                Horizontal displacement changes the drawing. Use Align spectra
                to change their calibrated ppm positions.
              </p>
            )}
            {section === "General" && (
              <p className="muted-small">
                These controls match the core 1D spectrum sections in Mnova.
                Plugin-specific prediction, fitting and assignment settings
                become available when those analyses are supported.
              </p>
            )}
          </div>
        </div>
        {error && <p className="inline-warning">{error}</p>}
        <div className="properties-footer">
          <div>
            <button
              className="secondary"
              onClick={() => {
                setDraft(defaultProperties());
                setError("");
              }}
            >
              <RotateCcw size={14} />
              Restore
            </button>
            <button className="secondary" onClick={() => onDefault(draft)}>
              Set as default
            </button>
            <button
              className="icon-button"
              title="Load properties"
              onClick={() => input.current?.click()}
            >
              <Upload size={16} />
            </button>
            <button
              className="icon-button"
              title="Save properties"
              onClick={() => {
                const a = document.createElement("a");
                const u = URL.createObjectURL(
                  new Blob([JSON.stringify(draft, null, 2)], {
                    type: "application/json",
                  }),
                );
                a.href = u;
                a.download = "Spectrum properties.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 1000);
              }}
            >
              <Save size={16} />
            </button>
          </div>
          <div>
            {stack && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setAll(e.target.checked)}
                />
                All stack members
              </label>
            )}
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="secondary" onClick={apply}>
              Apply
            </button>
            <button
              className="primary"
              onClick={() => {
                apply();
                onClose();
              }}
            >
              OK
            </button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept=".json"
          className="hidden-input"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              const p = JSON.parse(await f.text());
              if (!validProperties(p))
                throw new Error(
                  "This is not a valid spectrum properties file.",
                );
              setDraft({ ...defaultProperties(), ...p });
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </div>
    </div>
  );
}
