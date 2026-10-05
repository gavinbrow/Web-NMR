import { useRef } from "react";
import { Atom, GripHorizontal, X } from "lucide-react";
import type { Spectrum } from "../model";
import { spectrumText } from "../features/spectrumText";
import { MoleculeView } from "./MoleculeView";
import "./SpectrumMoleculeOverlay.css";

/** A movable comparison panel leaves the full plot at its original size. */
export function StackStructures(p: {
  spectra: Spectrum[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  return (
    <section
      ref={host}
      className="spectrum-molecule stack-structures"
      aria-label="Stack structure comparison"
      data-shortcuts="molecule"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className="spectrum-molecule-bar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = host.current!.getBoundingClientRect(),
            parent = host.current!.parentElement!.getBoundingClientRect();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: r.left - parent.left,
            top: r.top - parent.top,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current,
            h = host.current;
          if (!d || !h) return;
          const parent = h.parentElement!.getBoundingClientRect();
          h.style.left = `${Math.max(8, Math.min(parent.width - h.offsetWidth - 8, d.left + e.clientX - d.x))}px`;
          h.style.top = `${Math.max(8, Math.min(parent.height - h.offsetHeight - 8, d.top + e.clientY - d.y))}px`;
          h.style.right = "auto";
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <GripHorizontal size={13} />
        <Atom size={13} />
        <span>Compare structures · {p.spectra.length}</span>
        <button
          aria-label="Hide stack structures"
          title="Hide structures"
          onClick={p.onClose}
        >
          <X size={13} />
        </button>
      </div>
      <div className="stack-structure-grid">
        {p.spectra.map((s) => {
          const text = spectrumText(s);
          return (
            <button
              key={s.id}
              className={`stack-structure-card ${s.id === p.activeId ? "is-active" : ""}`}
              aria-label={`Compare structure: ${s.label}`}
              aria-pressed={s.id === p.activeId}
              title={`${text.title}${text.comments ? "\n" + text.comments : ""}\nClick to activate this spectrum`}
              onClick={() => p.onSelect(s.id)}
            >
              <div className="stack-structure-heading">
                <i style={{ background: s.color }} />
                <span>{text.title}</span>
              </div>
              <MoleculeView
                molecule={s.molecule!.document}
                showAtomNumbers
                showStereoCenters
                stereoMolfile={s.prediction?.stereoSelection?.molfile}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
