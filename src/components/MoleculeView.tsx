import { useMemo, type CSSProperties } from "react";
import {
  moleculeBounds,
  moleculeImplicitHydrogens,
  moleculeDisplayBondOrders,
} from "../features/molecule";
import type { MoleculeDocument } from "../features/molecule";
import "./MoleculeEditor.css";

export interface MoleculeViewProps {
  molecule: MoleculeDocument | null;
  selectedAtomIds?: string[];
  highlightedAtomIds?: string[];
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
  highlightedAtomIds = [],
  onSelectAtom,
  showAtomNumbers = true,
}: Omit<MoleculeViewProps, "className" | "style">) {
  const orders = useMemo(
    () =>
      molecule
        ? moleculeDisplayBondOrders(molecule)
        : new Map<string, number>(),
    [molecule],
  );
  const hydrogens = useMemo(
    () =>
      molecule
        ? moleculeImplicitHydrogens(molecule, orders)
        : new Map<string, number>(),
    [molecule, orders],
  );
  if (!molecule) return null;
  const selected = new Set(selectedAtomIds);
  const highlighted = new Set(highlightedAtomIds);
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
        // The inner line of a ring bond faces the ring centre, as in chemical drawings.
        const queue = [{ id: a.id, path: [a.id] }];
        const visited = new Set([a.id]);
        let cycle: string[] | null = null;
        while (queue.length && !cycle) {
          const current = queue.shift()!;
          if (current.path.length > 8) continue;
          for (const edge of molecule.bonds) {
            if (edge.id === bond.id) continue;
            const next =
              edge.from === current.id
                ? edge.to
                : edge.to === current.id
                  ? edge.from
                  : null;
            if (!next) continue;
            if (next === b.id) {
              cycle = [...current.path, next];
              break;
            }
            if (!visited.has(next)) {
              visited.add(next);
              queue.push({ id: next, path: [...current.path, next] });
            }
          }
        }
        const center = cycle?.reduce(
          (sum, id) => ({
            x: sum.x + atoms.get(id)!.x / cycle!.length,
            y: sum.y + atoms.get(id)!.y / cycle!.length,
          }),
          { x: 0, y: 0 },
        );
        const inward = center
          ? Math.sign((center.x - a.x) * nx + (center.y - a.y) * ny) || 1
          : 1;
        const line = (offset: number, dashed = false, shorten = 0) => (
          <line
            key={offset}
            x1={x1 + nx * offset + ux * shorten}
            y1={y1 + ny * offset + uy * shorten}
            x2={x2 + nx * offset - ux * shorten}
            y2={y2 + ny * offset - uy * shorten}
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
                {line(0)}
                {orders.get(bond.id) === 2 &&
                  line(inward * 5, false, cycle ? 7 : 2)}
              </>
            ) : bond.order === 3 ? (
              <>
                {line(-4)}
                {line(0)}
                {line(4)}
              </>
            ) : bond.order === 2 ? (
              <>
                {line(cycle ? 0 : -2.5)}
                {line(cycle ? inward * 5 : 2.5, false, cycle ? 7 : 0)}
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
        const hCount = atom.element === "H" ? 0 : (hydrogens.get(atom.id) ?? 0);
        const neighbors = molecule.bonds
          .filter((b) => b.from === atom.id || b.to === atom.id)
          .map((b) => atoms.get(b.from === atom.id ? b.to : b.from)!);
        const hydrogenOnLeft =
          neighbors.length > 0 &&
          neighbors.reduce((sum, a) => sum + a.x - atom.x, 0) > 8;
        return (
          <g
            key={atom.id}
            className={`molecule-atom ${selected.has(atom.id) ? "is-selected" : ""} ${highlighted.has(atom.id) ? "is-highlighted" : ""}`}
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
            {highlighted.has(atom.id) && (
              <circle
                className="molecule-atom-highlight"
                data-testid="predicted-atom-highlight"
                cx={atom.x}
                cy={atom.y}
                r={16}
              />
            )}
            {label && (
              <>
                <text
                  className="molecule-element"
                  x={atom.x}
                  y={atom.y + 1}
                  fill={atomColors[atom.element] ?? "#303944"}
                >
                  {atom.element}
                </text>
                {hCount > 0 && (
                  <text
                    className="molecule-element molecule-hydrogen"
                    x={atom.x + (hydrogenOnLeft ? -12 : 12)}
                    y={atom.y + 1}
                    fill={atomColors[atom.element] ?? "#303944"}
                    style={{ textAnchor: hydrogenOnLeft ? "end" : "start" }}
                  >
                    H
                    {hCount > 1 && (
                      <tspan className="molecule-hydrogen-count" dy="5">
                        {hCount}
                      </tspan>
                    )}
                  </text>
                )}
              </>
            )}
            {atom.isotope && (
              <text className="molecule-isotope" x={atom.x - 12} y={atom.y - 7}>
                {atom.isotope}
              </text>
            )}
            {charge && (
              <text
                className="molecule-charge"
                x={atom.x + (label && hCount && !hydrogenOnLeft ? 29 : 10)}
                y={atom.y - 8}
              >
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
  highlightedAtomIds,
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
            highlightedAtomIds={highlightedAtomIds}
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
