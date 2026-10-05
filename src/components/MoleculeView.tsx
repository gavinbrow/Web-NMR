import type { CSSProperties } from "react";
import { moleculeBounds } from "../features/molecule";
import type { MoleculeDocument } from "../features/molecule";
import "./MoleculeEditor.css";

export interface MoleculeViewProps {
  molecule: MoleculeDocument | null;
  selectedAtomIds?: string[];
  onSelectAtom?: (atomId: string, additive?: boolean) => void;
  showAtomNumbers?: boolean;
  className?: string;
  style?: CSSProperties;
}
const atomColors: Record<string, string> = {
  O: "#d44649",
  N: "#356fc2",
  S: "#a88518",
  P: "#b87125",
  F: "#309466",
  Cl: "#309466",
  Br: "#a34c32",
  I: "#8450ac",
};
export function MoleculeGlyphs({
  molecule,
  selectedAtomIds = [],
  onSelectAtom,
  showAtomNumbers = true,
}: Omit<MoleculeViewProps, "className" | "style">) {
  if (!molecule) return null;
  const selected = new Set(selectedAtomIds);
  const atoms = new Map(molecule.atoms.map((atom) => [atom.id, atom]));
  return (
    <g className="molecule-glyphs">
      {molecule.bonds.map((bond) => {
        const a = atoms.get(bond.from),
          b = atoms.get(bond.to);
        if (!a || !b) return null;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy) || 1;
        const ux = dx / length,
          uy = dy / length,
          nx = -uy,
          ny = ux;
        const hasLabel = (atom: typeof a) =>
          atom.element !== "C" ||
          atom.charge !== 0 ||
          Boolean(atom.isotope) ||
          !molecule.bonds.some(
            (edge) => edge.from === atom.id || edge.to === atom.id,
          );
        const trimA = hasLabel(a) ? 11 : 0,
          trimB = hasLabel(b) ? 11 : 0;
        const x1 = a.x + ux * trimA,
          y1 = a.y + uy * trimA,
          x2 = b.x - ux * trimB,
          y2 = b.y - uy * trimB;
        const line = (offset: number, dashed = false) => (
          <line
            key={offset}
            x1={x1 + nx * offset}
            y1={y1 + ny * offset}
            x2={x2 + nx * offset}
            y2={y2 + ny * offset}
            strokeDasharray={dashed ? "4 3" : undefined}
          />
        );
        return (
          <g key={bond.id} className="molecule-bond">
            {selected.has(a.id) && selected.has(b.id) && (
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="molecule-bond-selection"
              />
            )}
            {bond.stereo === "wedge" ? (
              <polygon
                points={`${x1},${y1} ${x2 + nx * 5},${y2 + ny * 5} ${x2 - nx * 5},${y2 - ny * 5}`}
              />
            ) : bond.stereo === "dash" ? (
              Array.from({ length: 7 }, (_, i) => {
                const t = (i + 1) / 8,
                  half = t * 5,
                  x = x1 + (x2 - x1) * t,
                  y = y1 + (y2 - y1) * t;
                return (
                  <line
                    key={i}
                    x1={x - nx * half}
                    y1={y - ny * half}
                    x2={x + nx * half}
                    y2={y + ny * half}
                  />
                );
              })
            ) : bond.aromatic ? (
              <>
                {line(-2.5)}
                {line(2.5, true)}
              </>
            ) : bond.order === 3 ? (
              <>
                {line(-4)}
                {line(0)}
                {line(4)}
              </>
            ) : bond.order === 2 ? (
              <>
                {line(-2.5)}
                {line(2.5)}
              </>
            ) : (
              line(0)
            )}
          </g>
        );
      })}
      {molecule.atoms.map((atom) => {
        const isolated = !molecule.bonds.some(
          (b) => b.from === atom.id || b.to === atom.id,
        );
        const label =
          atom.element !== "C" ||
          atom.charge !== 0 ||
          Boolean(atom.isotope) ||
          isolated;
        const charge = atom.charge
          ? `${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ""}${atom.charge > 0 ? "+" : "−"}`
          : "";
        const selectable = Boolean(onSelectAtom);
        return (
          <g
            key={atom.id}
            className={`molecule-atom ${selected.has(atom.id) ? "is-selected" : ""}`}
            role={selectable ? "button" : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={
              selectable
                ? `${atom.element}, atom ${atom.index}${charge ? `, charge ${charge}` : ""}`
                : undefined
            }
            aria-pressed={selectable ? selected.has(atom.id) : undefined}
            onClick={
              selectable
                ? (event) => {
                    event.stopPropagation();
                    onSelectAtom?.(
                      atom.id,
                      event.shiftKey || event.metaKey || event.ctrlKey,
                    );
                  }
                : undefined
            }
            onKeyDown={
              selectable
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectAtom?.(atom.id, event.shiftKey);
                    }
                  }
                : undefined
            }
          >
            <circle
              className="molecule-atom-hit"
              cx={atom.x}
              cy={atom.y}
              r={13}
            />
            {selected.has(atom.id) && (
              <circle
                className="molecule-atom-selection"
                cx={atom.x}
                cy={atom.y}
                r={15}
              />
            )}
            {label && (
              <text
                className="molecule-element"
                x={atom.x}
                y={atom.y + 1}
                fill={atomColors[atom.element] ?? "#303944"}
              >
                {atom.element}
              </text>
            )}
            {atom.isotope && (
              <text className="molecule-isotope" x={atom.x - 12} y={atom.y - 7}>
                {atom.isotope}
              </text>
            )}
            {charge && (
              <text className="molecule-charge" x={atom.x + 10} y={atom.y - 8}>
                {charge}
              </text>
            )}
            {showAtomNumbers && (
              <text
                className="molecule-atom-number"
                x={atom.x + (label ? 0 : 10)}
                y={atom.y + (label ? 21 : 16)}
              >
                {atom.index}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
export function MoleculeView({
  molecule,
  selectedAtomIds,
  onSelectAtom,
  showAtomNumbers = true,
  className = "",
  style,
}: MoleculeViewProps) {
  const bounds = moleculeBounds(molecule, 32);
  return (
    <div className={`molecule-view ${className}`} style={style}>
      {molecule?.atoms.length ? (
        <svg
          role={onSelectAtom ? "group" : "img"}
          aria-label="Molecular structure; click an atom to select its assignment"
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        >
          <MoleculeGlyphs
            molecule={molecule}
            selectedAtomIds={selectedAtomIds}
            onSelectAtom={onSelectAtom}
            showAtomNumbers={showAtomNumbers}
          />
        </svg>
      ) : (
        <span className="molecule-view-empty">No structure</span>
      )}
    </div>
  );
}
