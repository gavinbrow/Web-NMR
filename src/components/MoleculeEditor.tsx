import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Copy,
  Eraser,
  Hand,
  Hexagon,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  addMoleculeAtom,
  addMoleculeBond,
  addMoleculeRing,
  cleanMolecule,
  emptyMolecule,
  exportMoleculeMolfile,
  exportMoleculeSmiles,
  importMolecule,
  moleculeBondLength,
  moleculeBounds,
  moleculeChanged,
  moleculeElements,
  moleculeValenceWarnings,
  removeMoleculeAtoms,
  validateMolecule,
} from "../features/molecule";
import type { MoleculeDocument, MoleculeBond } from "../features/molecule";
import { MoleculeGlyphs } from "./MoleculeView";
import "./MoleculeEditor.css";

export interface MoleculeEditorProps {
  value: MoleculeDocument | null;
  onChange: (document: MoleculeDocument | null) => void;
  selectedAtomIds?: string[];
  onSelectAtoms?: (ids: string[]) => void;
  compact?: boolean;
}
type Tool =
  | "select"
  | "pan"
  | "erase"
  | "element"
  | "bond"
  | "ring"
  | "charge-plus"
  | "charge-minus";
type Point = { x: number; y: number };
type Gesture = {
  kind: "bond" | "move" | "pan" | "box";
  start: Point;
  current: Point;
  atomId?: string;
  ids?: string[];
  original: MoleculeDocument;
  pan: Point;
};
const bondModes: {
  label: string;
  symbol: string;
  properties: Partial<MoleculeBond>;
}[] = [
  {
    label: "Single bond",
    symbol: "—",
    properties: { order: 1, aromatic: false, stereo: "none" },
  },
  {
    label: "Double bond",
    symbol: "═",
    properties: { order: 2, aromatic: false, stereo: "none" },
  },
  {
    label: "Triple bond",
    symbol: "≡",
    properties: { order: 3, aromatic: false, stereo: "none" },
  },
  {
    label: "Aromatic bond",
    symbol: "╌",
    properties: { order: 1, aromatic: true, stereo: "none" },
  },
  {
    label: "Wedge bond",
    symbol: "◀",
    properties: { order: 1, aromatic: false, stereo: "wedge" },
  },
  {
    label: "Dashed wedge bond",
    symbol: "⋰",
    properties: { order: 1, aromatic: false, stereo: "dash" },
  },
];
function ToolButton({
  label,
  active,
  children,
  onClick,
  disabled,
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`molecule-tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function MoleculeEditor({
  value,
  onChange,
  selectedAtomIds,
  onSelectAtoms,
  compact = false,
}: MoleculeEditorProps) {
  const empty = useRef(emptyMolecule());
  const document = value ?? empty.current;
  const [tool, setTool] = useState<Tool>("bond");
  const [element, setElement] = useState("C");
  const [bondMode, setBondMode] = useState(0);
  const [ringSize, setRingSize] = useState(6);
  const [aromaticRing, setAromaticRing] = useState(true);
  const [internalSelection, setInternalSelection] = useState<string[]>([]);
  const selected = selectedAtomIds ?? internalSelection;
  const [selectedBond, setSelectedBond] = useState<string | null>(null);
  const [undo, setUndo] = useState<MoleculeDocument[]>([]);
  const [redo, setRedo] = useState<MoleculeDocument[]>([]);
  const [preview, setPreview] = useState<MoleculeDocument | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [showNumbers, setShowNumbers] = useState(true);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dialog, setDialog] = useState<"import" | "export" | null>(null);
  const [format, setFormat] = useState<"smiles" | "molfile">("smiles");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom((current) =>
        Math.min(4, Math.max(0.2, current * (event.deltaY < 0 ? 1.12 : 0.89))),
      );
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);
  const display = preview ?? document;
  const warnings = moleculeValenceWarnings(display);
  const select = (ids: string[]) => {
    setInternalSelection(ids);
    onSelectAtoms?.(ids);
  };
  const commit = (next: MoleculeDocument) => {
    if (next === document) return;
    const issues = validateMolecule(next);
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    setUndo((history) => [...history.slice(-79), document]);
    setRedo([]);
    setError("");
    setNotice("");
    onChange(next);
  };
  const undoChange = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, document]);
    onChange(previous);
    select([]);
    setSelectedBond(null);
  };
  const redoChange = () => {
    const next = redo.at(-1);
    if (!next) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, document]);
    onChange(next);
    select([]);
    setSelectedBond(null);
  };
  const fit = (molecule = document) => {
    const bounds = moleculeBounds(molecule, 60);
    setPan({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    setZoom(
      Math.max(0.2, Math.min(2, 740 / bounds.width, 430 / bounds.height)),
    );
  };
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x, y: p.y };
  };
  const nearAtom = (p: Point, exclude?: string) =>
    document.atoms
      .filter((a) => a.id !== exclude)
      .map((a) => ({ atom: a, distance: Math.hypot(a.x - p.x, a.y - p.y) }))
      .sort((a, b) => a.distance - b.distance)
      .find((a) => a.distance < 15 / Math.max(zoom, 0.6))?.atom;
  const nearBond = (p: Point) =>
    document.bonds.find((bond) => {
      const a = document.atoms.find((a) => a.id === bond.from),
        b = document.atoms.find((a) => a.id === bond.to);
      if (!a || !b) return false;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      return (
        Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) <
        7 / Math.max(zoom, 0.6)
      );
    });
  const startGesture = (next: Gesture) => {
    gestureRef.current = next;
    setGesture(next);
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event),
      atom = nearAtom(p),
      bond = !atom ? nearBond(p) : undefined;
    const base = { start: p, current: p, original: document, pan };
    if (tool === "pan" || spaceDown || event.button === 1) {
      startGesture({ ...base, kind: "pan" });
      return;
    }
    if (tool === "erase") {
      if (atom) {
        commit(removeMoleculeAtoms(document, [atom.id]));
        select(selected.filter((id) => id !== atom.id));
      } else if (bond)
        commit(
          moleculeChanged({
            ...document,
            bonds: document.bonds.filter((b) => b.id !== bond.id),
          }),
        );
      return;
    }
    if (tool === "charge-plus" || tool === "charge-minus") {
      if (atom)
        commit(
          moleculeChanged({
            ...document,
            atoms: document.atoms.map((a) =>
              a.id === atom.id
                ? {
                    ...a,
                    charge: Math.max(
                      -8,
                      Math.min(8, a.charge + (tool === "charge-plus" ? 1 : -1)),
                    ),
                  }
                : a,
            ),
          }),
        );
      return;
    }
    if (tool === "ring") {
      commit(
        addMoleculeRing(document, p.x, p.y, ringSize, aromaticRing, atom?.id),
      );
      return;
    }
    if (tool === "element") {
      if (atom)
        commit(
          moleculeChanged({
            ...document,
            atoms: document.atoms.map((a) =>
              a.id === atom.id ? { ...a, element } : a,
            ),
          }),
        );
      else if (bond) {
        const added = addMoleculeAtom(document, element, p.x, p.y);
        let next = moleculeChanged({
          ...added.document,
          bonds: added.document.bonds.filter((b) => b.id !== bond.id),
        });
        next = addMoleculeBond(next, bond.from, added.atom.id);
        commit(addMoleculeBond(next, added.atom.id, bond.to));
      } else commit(addMoleculeAtom(document, element, p.x, p.y).document);
      return;
    }
    if (tool === "bond") {
      if (bond) {
        commit(
          addMoleculeBond(
            document,
            bond.from,
            bond.to,
            bondModes[bondMode].properties,
          ),
        );
        return;
      }
      startGesture({
        ...base,
        kind: "bond",
        atomId: atom?.id,
        start: atom ? { x: atom.x, y: atom.y } : p,
      });
      return;
    }
    if (atom || bond) {
      const ids = atom ? [atom.id] : [bond!.from, bond!.to];
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const nextIds = additive
        ? [...new Set([...selected, ...ids])]
        : ids.every((id) => selected.includes(id))
          ? selected
          : ids;
      select(nextIds);
      setSelectedBond(bond?.id ?? null);
      startGesture({ ...base, kind: "move", ids: nextIds });
    } else {
      if (!event.shiftKey) select([]);
      setSelectedBond(null);
      startGesture({
        ...base,
        kind: "box",
        ids: event.shiftKey ? selected : [],
      });
    }
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = gestureRef.current;
    if (!active) return;
    const p = point(event),
      next = { ...active, current: p };
    if (active.kind === "pan") {
      // Screen displacement stays stable while the viewBox changes during panning.
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(
        rect.width / (800 / zoom),
        rect.height / (520 / zoom),
      );
      const movement = {
        x: event.movementX / (scale || 1),
        y: event.movementY / (scale || 1),
      };
      setPan((previous) => ({
        x: previous.x - movement.x,
        y: previous.y - movement.y,
      }));
    } else if (active.kind === "move") {
      const dx = p.x - active.start.x,
        dy = p.y - active.start.y;
      setPreview(
        moleculeChanged({
          ...active.original,
          atoms: active.original.atoms.map((a) =>
            active.ids?.includes(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a,
          ),
        }),
      );
    }
    gestureRef.current = next;
    setGesture(next);
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const active = gestureRef.current;
    if (!active) return;
    const p = point(event);
    if (
      active.kind === "move" &&
      preview &&
      Math.hypot(p.x - active.start.x, p.y - active.start.y) > 0.5
    )
      commit(preview);
    if (active.kind === "box") {
      const x1 = Math.min(active.start.x, p.x),
        x2 = Math.max(active.start.x, p.x),
        y1 = Math.min(active.start.y, p.y),
        y2 = Math.max(active.start.y, p.y);
      select([
        ...new Set([
          ...(active.ids ?? []),
          ...document.atoms
            .filter((a) => a.x >= x1 && a.x <= x2 && a.y >= y1 && a.y <= y2)
            .map((a) => a.id),
        ]),
      ]);
    }
    if (active.kind === "bond") {
      let next = document,
        from = active.atomId;
      if (!from) {
        const added = addMoleculeAtom(
          next,
          "C",
          active.start.x,
          active.start.y,
        );
        next = added.document;
        from = added.atom.id;
      }
      let target = nearAtom(p, from);
      if (!target) {
        const distance = Math.hypot(p.x - active.start.x, p.y - active.start.y);
        let angle =
          distance > 12
            ? Math.atan2(p.y - active.start.y, p.x - active.start.x)
            : -Math.PI / 6;
        if (distance <= 12 && active.atomId) {
          const attached = document.bonds.find(
            (b) => b.from === from || b.to === from,
          );
          const neighbor = document.atoms.find(
            (a) =>
              a.id === (attached?.from === from ? attached.to : attached?.from),
          );
          if (neighbor)
            angle =
              Math.atan2(
                active.start.y - neighbor.y,
                active.start.x - neighbor.x,
              ) +
              Math.PI / 3;
        }
        if (!event.altKey)
          angle = (Math.round(angle / (Math.PI / 6)) * Math.PI) / 6;
        const length =
          distance > 12 && event.altKey ? distance : moleculeBondLength;
        const endpoint = {
          x: active.start.x + Math.cos(angle) * length,
          y: active.start.y + Math.sin(angle) * length,
        };
        target = nearAtom(endpoint, from);
        if (!target) {
          const added = addMoleculeAtom(next, "C", endpoint.x, endpoint.y);
          next = added.document;
          target = added.atom;
        }
      }
      commit(
        addMoleculeBond(next, from, target.id, bondModes[bondMode].properties),
      );
    }
    gestureRef.current = null;
    setGesture(null);
    setPreview(null);
  };
  const deleteSelection = () => {
    if (selectedBond) {
      commit(
        moleculeChanged({
          ...document,
          bonds: document.bonds.filter((b) => b.id !== selectedBond),
        }),
      );
      select([]);
    } else if (selected.length) {
      commit(removeMoleculeAtoms(document, selected));
      select([]);
    }
    setSelectedBond(null);
  };
  const adjustCharge = (amount: number) => {
    if (selected.length)
      commit(
        moleculeChanged({
          ...document,
          atoms: document.atoms.map((a) =>
            selected.includes(a.id)
              ? { ...a, charge: Math.max(-8, Math.min(8, a.charge + amount)) }
              : a,
          ),
        }),
      );
    else setTool(amount > 0 ? "charge-plus" : "charge-minus");
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches("input, textarea, select"))
      return;
    if (event.code === "Space") {
      event.preventDefault();
      setSpaceDown(true);
    }
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoChange();
      else undoChange();
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoChange();
    }
    if (command && event.key.toLowerCase() === "a") {
      event.preventDefault();
      select(document.atoms.map((a) => a.id));
      setTool("select");
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    }
    if (event.key === "Escape") {
      setDialog(null);
      select([]);
      setTool("select");
    }
    if (!command && /^[123]$/.test(event.key)) {
      setBondMode(Number(event.key) - 1);
      setTool("bond");
    }
    if (
      !command &&
      moleculeElements.includes(
        event.key.toUpperCase() as (typeof moleculeElements)[number],
      )
    ) {
      setElement(event.key.toUpperCase());
      setTool("element");
    }
  };
  const openExport = (nextFormat: "smiles" | "molfile" = "smiles") => {
    setError("");
    setFormat(nextFormat);
    try {
      setText(
        nextFormat === "smiles"
          ? exportMoleculeSmiles(document)
          : exportMoleculeMolfile(document),
      );
      setDialog("export");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This structure could not be exported.",
      );
    }
  };
  const doImport = () => {
    try {
      const imported = importMolecule(text, format);
      commit(imported);
      select([]);
      fit(imported);
      setDialog(null);
      setNotice(
        "Structure imported. Atom numbers start at 1 for the new structure.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Check the structure text and try again.",
      );
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: "text/plain" }),
      url = URL.createObjectURL(blob),
      anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = format === "smiles" ? "structure.smi" : "structure.mol";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div
      data-shortcuts="molecule"
      className={`molecule-editor ${compact ? "compact" : ""}`}
      onKeyDown={keyboard}
      onKeyUp={(event) => {
        if (event.code === "Space") setSpaceDown(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setSpaceDown(false);
      }}
    >
      <div className="molecule-topbar">
        <div className="molecule-editor-brand">
          <span className="molecule-brand-mark">
            <Hexagon size={16} />
          </span>
          <strong>Structure writer</strong>
          <span className="molecule-brand-note">Web NMR</span>
        </div>
        <div className="molecule-toolbar-group">
          <ToolButton
            label="Undo (⌘/Ctrl Z)"
            onClick={undoChange}
            disabled={!undo.length}
          >
            <Undo2 size={17} />
          </ToolButton>
          <ToolButton
            label="Redo (⌘/Ctrl Shift Z)"
            onClick={redoChange}
            disabled={!redo.length}
          >
            <Redo2 size={17} />
          </ToolButton>
          <span className="molecule-separator" />
          <button
            type="button"
            className="molecule-text-tool"
            onClick={() => {
              try {
                const cleaned = cleanMolecule(document);
                commit(cleaned);
                fit(cleaned);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Could not arrange structure.",
                );
              }
            }}
            disabled={!document.atoms.length}
          >
            <Sparkles size={15} />
            Clean
          </button>
          <button
            type="button"
            className="molecule-text-tool"
            onClick={() => {
              setDialog("import");
              setText("");
              setError("");
            }}
          >
            <ArrowDownToLine size={15} />
            Import
          </button>
          <button
            type="button"
            className="molecule-text-tool"
            onClick={() => openExport()}
            disabled={!document.atoms.length}
          >
            <ArrowUpFromLine size={15} />
            Export
          </button>
        </div>
      </div>
      <div className="molecule-editor-body">
        <div
          className="molecule-leftbar"
          role="toolbar"
          aria-label="Drawing tools"
        >
          <ToolButton
            label="Select and move atoms (drag to select)"
            active={tool === "select"}
            onClick={() => setTool("select")}
          >
            <MousePointer2 size={19} />
          </ToolButton>
          <ToolButton
            label="Pan canvas (or hold Space)"
            active={tool === "pan"}
            onClick={() => setTool("pan")}
          >
            <Hand size={19} />
          </ToolButton>
          <ToolButton
            label="Erase atom or bond"
            active={tool === "erase"}
            onClick={() => setTool("erase")}
          >
            <Eraser size={19} />
          </ToolButton>
          <span className="molecule-separator" />
          {bondModes.map((mode, i) => (
            <ToolButton
              key={mode.label}
              label={mode.label}
              active={tool === "bond" && bondMode === i}
              onClick={() => {
                setBondMode(i);
                setTool("bond");
              }}
            >
              <span className={`molecule-bond-icon bond-${i}`}>
                {mode.symbol}
              </span>
            </ToolButton>
          ))}
          <span className="molecule-separator" />
          <ToolButton
            label="Increase atom charge"
            active={tool === "charge-plus"}
            onClick={() => adjustCharge(1)}
          >
            <Plus size={19} />
          </ToolButton>
          <ToolButton
            label="Decrease atom charge"
            active={tool === "charge-minus"}
            onClick={() => adjustCharge(-1)}
          >
            <Minus size={19} />
          </ToolButton>
          <ToolButton
            label="Delete selection"
            onClick={deleteSelection}
            disabled={!selected.length && !selectedBond}
          >
            <Trash2 size={17} />
          </ToolButton>
        </div>
        <div className="molecule-canvas-wrap">
          <svg
            ref={svg}
            className={`molecule-canvas tool-${spaceDown ? "pan" : tool}`}
            aria-label="Molecule drawing canvas"
            tabIndex={0}
            viewBox={`${pan.x - 400 / zoom} ${pan.y - 260 / zoom} ${800 / zoom} ${520 / zoom}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => {
              gestureRef.current = null;
              setGesture(null);
              setPreview(null);
            }}
          >
            <MoleculeGlyphs
              molecule={display}
              selectedAtomIds={selected}
              showAtomNumbers={showNumbers}
            />
            {gesture?.kind === "bond" && (
              <line
                className="molecule-drawing-preview"
                x1={gesture.start.x}
                y1={gesture.start.y}
                x2={gesture.current.x}
                y2={gesture.current.y}
              />
            )}
            {gesture?.kind === "box" && (
              <rect
                className="molecule-selection-box"
                x={Math.min(gesture.start.x, gesture.current.x)}
                y={Math.min(gesture.start.y, gesture.current.y)}
                width={Math.abs(gesture.current.x - gesture.start.x)}
                height={Math.abs(gesture.current.y - gesture.start.y)}
              />
            )}
          </svg>
          {!document.atoms.length && (
            <div className="molecule-empty-guide">
              <Hexagon size={36} strokeWidth={1.2} />
              <strong>Draw your molecule</strong>
              <span>
                Drag to draw a bond, choose an element, or place a ring.
              </span>
              <button
                type="button"
                onClick={() => {
                  setDialog("import");
                  setText("");
                  setError("");
                }}
              >
                Import SMILES or a molfile <ChevronDown size={13} />
              </button>
            </div>
          )}
          <div className="molecule-canvas-controls">
            <ToolButton
              label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
            >
              <ZoomOut size={16} />
            </ToolButton>
            <span>{Math.round(zoom * 100)}%</span>
            <ToolButton
              label="Zoom in"
              onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
            >
              <ZoomIn size={16} />
            </ToolButton>
            <ToolButton label="Fit structure to canvas" onClick={() => fit()}>
              <RotateCcw size={15} />
            </ToolButton>
          </div>
        </div>
        <div className="molecule-rightbar" role="toolbar" aria-label="Elements">
          <span className="molecule-toolbar-caption">ATOMS</span>
          {moleculeElements.map((symbol) => (
            <ToolButton
              key={symbol}
              label={`Draw or replace with ${symbol}`}
              active={tool === "element" && element === symbol}
              onClick={() => {
                setElement(symbol);
                setTool("element");
              }}
            >
              <span className={`element-${symbol}`}>{symbol}</span>
            </ToolButton>
          ))}
        </div>
      </div>
      <div
        className="molecule-ringbar"
        role="toolbar"
        aria-label="Ring templates"
      >
        <span className="molecule-toolbar-caption">RINGS</span>
        <ToolButton
          label="Benzene ring"
          active={tool === "ring" && aromaticRing}
          onClick={() => {
            setRingSize(6);
            setAromaticRing(true);
            setTool("ring");
          }}
        >
          <span className="molecule-ring-template">
            <Hexagon size={23} />
            <span className="molecule-aromatic-circle" />
          </span>
        </ToolButton>
        {[3, 4, 5, 6, 7, 8].map((size) => (
          <ToolButton
            key={size}
            label={`${size}-membered carbon ring`}
            active={tool === "ring" && ringSize === size && !aromaticRing}
            onClick={() => {
              setRingSize(size);
              setAromaticRing(false);
              setTool("ring");
            }}
          >
            <svg width="25" height="25" viewBox="0 0 26 26" aria-hidden="true">
              <polygon
                points={Array.from(
                  { length: size },
                  (_, i) =>
                    `${13 + 10 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / size)},${13 + 10 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / size)}`,
                ).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <text
                x="13"
                y="16"
                textAnchor="middle"
                fontSize="8"
                fill="currentColor"
              >
                {size}
              </text>
            </svg>
          </ToolButton>
        ))}
        <span className="molecule-ringbar-spacer" />
        <label className="molecule-number-toggle">
          <input
            type="checkbox"
            checked={showNumbers}
            onChange={(event) => setShowNumbers(event.target.checked)}
          />
          Atom numbers
        </label>
      </div>
      <div className="molecule-statusbar" aria-live="polite">
        <span>
          {error ||
            notice ||
            warnings[0] ||
            (tool === "bond"
              ? "Drag bonds · click a bond to change its type · Alt for free angles"
              : tool === "ring"
                ? "Click to place a ring · click an atom to attach it"
                : tool === "element"
                  ? `Click to place ${element} or replace an atom`
                  : tool === "select"
                    ? "Drag to move · Shift to add selection · Delete to erase"
                    : "Click an atom or bond to edit")}
        </span>
        <span>
          {document.atoms.length} atoms · {document.bonds.length} bonds
          {selected.length ? ` · ${selected.length} selected` : ""}
        </span>
      </div>
      {dialog && (
        <div
          className="molecule-dialog-backdrop"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <section
            className="molecule-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === "import" ? "Import structure" : "Export structure"
            }
          >
            <div className="molecule-dialog-heading">
              <strong>
                {dialog === "import" ? "Import structure" : "Export structure"}
              </strong>
              <ToolButton
                label="Close structure dialog"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </ToolButton>
            </div>
            <p>
              {dialog === "import"
                ? "Paste SMILES or a molfile. Import replaces the current drawing and starts a new set of atom numbers."
                : "Copy or download your structure for use in other chemistry software."}
            </p>
            <label className="molecule-format-label">
              Format
              <select
                value={format}
                onChange={(event) => {
                  const next = event.target.value as "smiles" | "molfile";
                  setFormat(next);
                  setError("");
                  if (dialog === "export") openExport(next);
                }}
              >
                <option value="smiles">SMILES</option>
                <option value="molfile">MDL molfile</option>
              </select>
            </label>
            <textarea
              aria-label={
                format === "smiles" ? "SMILES structure" : "Molfile structure"
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
              readOnly={dialog === "export"}
              autoFocus
              spellCheck={false}
              placeholder={
                format === "smiles"
                  ? "Example: CC(=O)Oc1ccccc1C(=O)O"
                  : "Paste the contents of a .mol file"
              }
            />
            {error && (
              <div className="molecule-dialog-error" role="alert">
                {error}
              </div>
            )}
            <div className="molecule-dialog-actions">
              {dialog === "import" ? (
                <>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <ArrowDownToLine size={15} />
                    Open .mol file
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={doImport}
                    disabled={!text.trim()}
                  >
                    <Check size={15} />
                    Import structure
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(text);
                        setNotice("Structure copied.");
                      } catch {
                        setError(
                          "Select the structure text and copy it with your keyboard.",
                        );
                      }
                    }}
                  >
                    <Copy size={15} />
                    Copy
                  </button>
                  <button type="button" className="primary" onClick={download}>
                    <ArrowDownToLine size={15} />
                    Download {format === "smiles" ? ".smi" : ".mol"}
                  </button>
                </>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".mol,.sdf,.smi,.smiles,text/plain"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setText((await file.text()).split("$$$$")[0]);
                  setFormat(
                    /\.(smi|smiles)$/i.test(file.name) ? "smiles" : "molfile",
                  );
                  setError("");
                } catch {
                  setError("Could not read this file.");
                }
                event.target.value = "";
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
