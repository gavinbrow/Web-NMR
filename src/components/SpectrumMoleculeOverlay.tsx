import { useRef } from "react";
import { Crosshair, GripHorizontal, Pencil, X } from "lucide-react";
import { MoleculeView } from "./MoleculeView";
import type { SpectrumMolecule } from "../features/predictionSetup";
import "./SpectrumMoleculeOverlay.css";

export function SpectrumMoleculeOverlay(p: {
  value: SpectrumMolecule;
  selectedAtomIds: string[];
  hoveredAtomIds?: string[];
  assigning: boolean;
  onSelectAtom: (id: string, multi?: boolean) => void;
  onChange: (value: SpectrumMolecule) => void;
  onAssign: () => void;
  onEdit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number } | null>(
      null,
    );
  const selected = p.value.document.atoms.filter((a) =>
    p.selectedAtomIds.includes(a.id),
  );
  const assigned = p.value.assignments.filter((a) =>
    a.atomIds.some((id) => p.selectedAtomIds.includes(id)),
  );
  return (
    <div
      ref={host}
      className={`spectrum-molecule ${p.assigning ? "assigning" : ""}`}
      style={{
        left: `clamp(8px, ${p.value.position.x * 100}%, calc(100% - ${p.value.position.width}px - 8px))`,
        top: `clamp(8px, ${p.value.position.y * 100}%, calc(100% - ${p.value.position.height}px - 8px))`,
        width: p.value.position.width,
        height: p.value.position.height,
      }}
      aria-label="Molecule on spectrum"
      data-shortcuts="molecule"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerUp={() => {
        if (!host.current || drag.current) return;
        const { width, height } = host.current.getBoundingClientRect();
        if (
          Math.abs(width - p.value.position.width) > 2 ||
          Math.abs(height - p.value.position.height) > 2
        )
          p.onChange({
            ...p.value,
            position: { ...p.value.position, width, height },
          });
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
          const d = drag.current;
          if (!d || !host.current) return;
          const parent = host.current.parentElement!.getBoundingClientRect();
          host.current.style.left = `${Math.max(0, Math.min(parent.width - host.current.offsetWidth - 8, d.left + e.clientX - d.x))}px`;
          host.current.style.top = `${Math.max(0, Math.min(parent.height - host.current.offsetHeight - 8, d.top + e.clientY - d.y))}px`;
        }}
        onPointerUp={() => {
          if (!drag.current || !host.current) return;
          const r = host.current.getBoundingClientRect(),
            parent = host.current.parentElement!.getBoundingClientRect();
          drag.current = null;
          p.onChange({
            ...p.value,
            position: {
              ...p.value.position,
              x: Math.max(
                0,
                Math.min(1, (r.left - parent.left) / parent.width),
              ),
              y: Math.max(0, Math.min(1, (r.top - parent.top) / parent.height)),
            },
          });
        }}
      >
        <GripHorizontal size={13} />
        <span>Molecule</span>
        <button
          title="Edit molecule in Prediction"
          aria-label="Edit attached molecule"
          onClick={p.onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          title="Hide molecule · restore from Prediction"
          aria-label="Hide molecule"
          onClick={() => p.onChange({ ...p.value, visible: false })}
        >
          <X size={13} />
        </button>
      </div>
      <div className="spectrum-molecule-drawing">
        <MoleculeView
          molecule={p.value.document}
          selectedAtomIds={p.selectedAtomIds}
          highlightedAtomIds={p.hoveredAtomIds}
          onSelectAtom={p.onSelectAtom}
          showAtomNumbers
        />
      </div>
      <div className="spectrum-molecule-assignment">
        <span>
          {selected.length
            ? selected.map((a) => `${a.element}${a.index}`).join(", ")
            : "Select atoms · Shift adds more"}
        </span>
        <button
          disabled={!selected.length}
          className={p.assigning ? "active" : ""}
          title="Choose atoms, then click a spectrum peak to assign them"
          onClick={p.onAssign}
        >
          <Crosshair size={13} />
          {p.assigning ? "Click peak…" : "Assign peak"}
        </button>
      </div>
      {!!assigned.length && (
        <div className="spectrum-molecule-values">
          {assigned.map((a) => (
            <button
              key={a.id}
              title="Remove this atom-to-peak assignment"
              onClick={() =>
                p.onChange({
                  ...p.value,
                  assignments: p.value.assignments.filter((v) => v.id !== a.id),
                })
              }
            >
              {a.ppm.toFixed(3)}
              {a.ppmF1 !== undefined ? ` / ${a.ppmF1.toFixed(3)}` : ""} ppm{" "}
              <X size={10} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
