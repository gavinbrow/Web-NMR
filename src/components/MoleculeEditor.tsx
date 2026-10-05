import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Copy,
  Eraser,
  Expand,
  Hand,
  Maximize2,
  MousePointer2,
  Redo2,
  RotateCw,
  Shrink,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  HelpCircle,
  ClipboardPaste,
  Scissors,
  FolderOpen,
} from "lucide-react";
import {
  addMoleculeAtom,
  addMoleculeBond,
  cleanMolecule,
  emptyMolecule,
  exportMoleculeMolfile,
  exportMoleculeSmiles,
  importMolecule,
  moleculeBounds,
  moleculeChanged,
  moleculeElements,
  moleculeValenceWarnings,
  removeMoleculeAtoms,
  validateMolecule,
  type MoleculeDocument,
  type MoleculeBond,
} from "../features/molecule";
import {
  bondEndpoint,
  drawingHit,
  drawBond,
  drawChain,
  drawingFragment,
  mergeDrawing,
  moveDrawingAtoms,
  placeDrawingRing,
  type DrawingPoint,
  type DrawingHit,
} from "../features/moleculeDrawing";
import { MoleculeGlyphs } from "./MoleculeView";
import "./MoleculeEditor.css";
export interface MoleculeEditorProps {
  value: MoleculeDocument | null;
  onChange: (doc: MoleculeDocument | null) => void;
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
  | "chain"
  | "ring"
  | "charge-plus"
  | "charge-minus";
type Gesture = {
  kind: "draw" | "move" | "pan" | "box";
  start: DrawingPoint;
  current: DrawingPoint;
  client: DrawingPoint;
  original: MoleculeDocument;
  pan: DrawingPoint;
  hit: DrawingHit;
  ids: string[];
  tool: Tool;
};
const bondModes: { label: string; properties: Partial<MoleculeBond> }[] = [
  {
    label: "Single bond (1)",
    properties: { order: 1, aromatic: false, stereo: "none" },
  },
  {
    label: "Double bond (2)",
    properties: { order: 2, aromatic: false, stereo: "none" },
  },
  {
    label: "Triple bond (3)",
    properties: { order: 3, aromatic: false, stereo: "none" },
  },
  {
    label: "Aromatic bond",
    properties: { order: 1, aromatic: true, stereo: "none" },
  },
  {
    label: "Solid wedge bond",
    properties: { order: 1, aromatic: false, stereo: "wedge" },
  },
  {
    label: "Dashed wedge bond",
    properties: { order: 1, aromatic: false, stereo: "dash" },
  },
];
function BondIcon({ mode = 0 }: { mode?: number }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      {mode === 4 ? (
        <path d="M4 20 17 3 21 7Z" fill="currentColor" stroke="none" />
      ) : mode === 5 ? (
        Array.from({ length: 6 }, (_, i) => (
          <path
            key={i}
            d={`M${4 + i * 2.3 - i * 0.3} ${20 - i * 2.8 - i * 0.3}l${i * 0.75 + 1} ${i * 0.75 + 1}`}
          />
        ))
      ) : (
        <>
          {mode !== 2 && mode !== 3 ? <path d="M5 19 19 5" /> : null}
          {mode === 1 || mode === 2 ? <path d="M3 16 16 3" /> : null}
          {mode === 2 ? (
            <>
              <path d="M6 19 19 6" />
              <path d="M9 22 22 9" />
            </>
          ) : null}
          {mode === 3 ? (
            <>
              <path d="M4 18 18 4" />
              <path d="M8 21 21 8" strokeDasharray="3 3" />
            </>
          ) : null}
        </>
      )}
    </svg>
  );
}
function RingIcon({
  size = 6,
  aromatic = false,
}: {
  size?: number;
  aromatic?: boolean;
}) {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <polygon
        points={Array.from(
          { length: size },
          (_, i) =>
            `${14 + 10 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / size)},${14 + 10 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / size)}`,
        ).join(" ")}
      />
      {aromatic && <circle cx="14" cy="14" r="5" />}
    </svg>
  );
}
function ToolButton({
  label,
  active,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`molecule-tool ${active ? "active" : ""} ${className}`}
      data-tooltip={label}
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
  const empty = useRef(emptyMolecule()),
    doc = value ?? empty.current;
  const [tool, setTool] = useState<Tool>("bond"),
    [element, setElement] = useState("C"),
    [bondMode, setBondMode] = useState(0),
    [ringSize, setRingSize] = useState(6),
    [aromaticRing, setAromaticRing] = useState(true);
  const [selection, setSelection] = useState<string[]>([]),
    [selectedBond, setSelectedBond] = useState<string | null>(null);
  const selected = selectedAtomIds ?? selection;
  const [undo, setUndo] = useState<MoleculeDocument[]>([]),
    [redo, setRedo] = useState<MoleculeDocument[]>([]);
  const [preview, setPreview] = useState<MoleculeDocument | null>(null),
    previewRef = useRef<MoleculeDocument | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null),
    gestureRef = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<DrawingPoint | null>(null),
    [hoverHit, setHoverHit] = useState<DrawingHit>({});
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } }),
    viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ width: 800, height: 500 }),
    [space, setSpace] = useState(false),
    [numbers, setNumbers] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [palette, setPalette] = useState<"bonds" | "elements" | null>(null),
    [dialog, setDialog] = useState<
      "import" | "export" | "help" | "atom" | null
    >(null);
  const [format, setFormat] = useState<"smiles" | "molfile">("smiles"),
    [text, setText] = useState(""),
    [quick, setQuick] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [atomEdit, setAtomEdit] = useState({
    id: "",
    element: "C",
    charge: 0,
    isotope: "",
  });
  const svg = useRef<SVGSVGElement>(null),
    root = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    lastDoc = useRef(doc.id),
    clipboard = useRef<MoleculeDocument | null>(null);
  const select = (ids: string[]) => {
    setSelection(ids);
    onSelectAtoms?.(ids);
  };
  const fit = (molecule = doc) => {
    const b = moleculeBounds(molecule, 28);
    setView({
      pan: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      zoom: Math.min(
        1.25,
        Math.max(0.15, (size.width - 180) / b.width),
        Math.max(0.15, (size.height - 75) / b.height),
      ),
    });
  };
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      setSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (lastDoc.current !== doc.id) {
      lastDoc.current = doc.id;
      setUndo([]);
      setRedo([]);
      select([]);
      setSelectedBond(null);
      fit(doc);
    }
  }, [doc.id]);
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = canvas.getBoundingClientRect(),
        v = viewRef.current;
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        const z = Math.max(
            0.15,
            Math.min(4, v.zoom * Math.exp(-e.deltaY * 0.0018)),
          ),
          dx = e.clientX - r.left - r.width / 2,
          dy = e.clientY - r.top - r.height / 2;
        setView({
          zoom: z,
          pan: {
            x: v.pan.x + dx / v.zoom - dx / z,
            y: v.pan.y + dy / v.zoom - dy / z,
          },
        });
      } else {
        setView({
          ...v,
          pan: {
            x: v.pan.x + e.deltaY / v.zoom,
            y: v.pan.y + e.deltaX / v.zoom,
          },
        });
      }
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!palette) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!(e.target as Element).closest(".molecule-palette-anchor"))
        setPalette(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [palette]);
  useEffect(() => {
    if (!dialog) return;
    const panel = root.current?.querySelector<HTMLElement>(".molecule-dialog");
    const focusable = panel?.querySelector<HTMLElement>(
      "textarea, select, button",
    );
    focusable?.focus();
    return () => svg.current?.focus();
  }, [dialog]);
  const commit = (next: MoleculeDocument) => {
    if (next === doc) return;
    const errors = validateMolecule(next);
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    setUndo((h) => [...h.slice(-99), doc]);
    setRedo([]);
    setError("");
    setNotice("");
    lastDoc.current = next.id;
    onChange(next);
  };
  const undoChange = () => {
    const prev = undo.at(-1);
    if (!prev) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, doc]);
    lastDoc.current = prev.id;
    onChange(prev);
    select([]);
    setSelectedBond(null);
  };
  const redoChange = () => {
    const next = redo.at(-1);
    if (!next) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, doc]);
    lastDoc.current = next.id;
    onChange(next);
    select([]);
    setSelectedBond(null);
  };
  const setPreviewDoc = (next: MoleculeDocument | null) => {
    previewRef.current = next;
    setPreview(next);
  };
  const point = (e: { clientX: number; clientY: number }): DrawingPoint => {
    const r = svg.current!.getBoundingClientRect(),
      v = viewRef.current;
    return {
      x: v.pan.x + (e.clientX - r.left - r.width / 2) / v.zoom,
      y: v.pan.y + (e.clientY - r.top - r.height / 2) / v.zoom,
    };
  };
  const hit = (p: DrawingPoint) => drawingHit(doc, p, 12 / view.zoom);
  const clearGesture = () => {
    gestureRef.current = null;
    setGesture(null);
    setPreviewDoc(null);
  };
  const activate = (next: Tool) => {
    clearGesture();
    setTool(next);
    setPalette(null);
    setError("");
    svg.current?.focus();
  };
  const openAtom = (id: string) => {
    const a = doc.atoms.find((a) => a.id === id);
    if (!a) return;
    setAtomEdit({
      id: a.id,
      element: a.element,
      charge: a.charge,
      isotope: a.isotope ? String(a.isotope) : "",
    });
    setError("");
    setDialog("atom");
  };
  const editElement = (ids: string[], symbol: string) => {
    commit(
      moleculeChanged({
        ...doc,
        atoms: doc.atoms.map((a) =>
          ids.includes(a.id) ? { ...a, element: symbol } : a,
        ),
      }),
    );
  };
  const remove = () => {
    if (selectedBond) {
      commit(
        moleculeChanged({
          ...doc,
          bonds: doc.bonds.filter((b) => b.id !== selectedBond),
        }),
      );
    } else if (selected.length) commit(removeMoleculeAtoms(doc, selected));
    select([]);
    setSelectedBond(null);
  };
  const charge = (amount: number) => {
    if (selected.length)
      commit(
        moleculeChanged({
          ...doc,
          atoms: doc.atoms.map((a) =>
            selected.includes(a.id)
              ? { ...a, charge: Math.max(-8, Math.min(8, a.charge + amount)) }
              : a,
          ),
        }),
      );
    else activate(amount > 0 ? "charge-plus" : "charge-minus");
  };
  const drawPreview = (g: Gesture, p: DrawingPoint, free = false) => {
    if (g.tool === "chain")
      return drawChain(g.original, g.start, p, g.hit.atomId);
    const end = bondEndpoint(g.original, g.start, p, g.hit.atomId, free);
    return drawBond(
      g.original,
      g.start,
      end,
      g.hit.atomId,
      g.tool === "element" ? element : "C",
      g.tool === "element" ? {} : bondModes[bondMode].properties,
    );
  };
  const pointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    e.currentTarget.focus();
    setPalette(null);
    const p = point(e),
      h = hit(p),
      atom = doc.atoms.find((a) => a.id === h.atomId),
      bond = doc.bonds.find((b) => b.id === h.bondId);
    if (tool === "erase" && !space) {
      if (atom) commit(removeMoleculeAtoms(doc, [atom.id]));
      else if (bond)
        commit(
          moleculeChanged({
            ...doc,
            bonds: doc.bonds.filter((b) => b.id !== bond.id),
          }),
        );
      select([]);
      return;
    }
    if ((tool === "charge-plus" || tool === "charge-minus") && !space) {
      if (atom)
        commit(
          moleculeChanged({
            ...doc,
            atoms: doc.atoms.map((a) =>
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
    if (tool === "ring" && !space) {
      commit(placeDrawingRing(doc, p, ringSize, aromaticRing, h));
      return;
    }
    if (tool === "bond" && bond && !space) {
      const props = bondModes[bondMode].properties;
      commit(
        addMoleculeBond(
          doc,
          bond.from,
          bond.to,
          bondMode === 0 && bond.stereo === "none" && !bond.aromatic
            ? {
                ...props,
                order: bond.order === 1 ? 2 : bond.order === 2 ? 3 : 1,
              }
            : props,
        ),
      );
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    let g: Gesture = {
      kind: "draw",
      tool,
      start: atom ? { x: atom.x, y: atom.y } : p,
      current: p,
      client: { x: e.clientX, y: e.clientY },
      original: doc,
      pan: view.pan,
      hit: h,
      ids: [],
    };
    if (space || tool === "pan" || e.button === 1) g = { ...g, kind: "pan" };
    else if (tool === "select") {
      if (atom || bond) {
        const ids = atom ? [atom.id] : [bond!.from, bond!.to];
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const next = additive
          ? Array.from(new Set([...selected, ...ids]))
          : ids.every((id) => selected.includes(id))
            ? selected
            : ids;
        select(next);
        setSelectedBond(bond?.id ?? null);
        g = { ...g, kind: "move", ids: next };
      } else {
        if (!e.shiftKey) select([]);
        setSelectedBond(null);
        g = { ...g, kind: "box", ids: e.shiftKey ? selected : [] };
      }
    }
    gestureRef.current = g;
    setGesture(g);
    if (g.kind === "draw" && tool !== "element")
      setPreviewDoc(drawPreview(g, p, e.altKey));
  };
  const pointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = point(e),
      g = gestureRef.current;
    setHover(p);
    setHoverHit(hit(p));
    if (!g) return;
    const next = { ...g, current: p };
    if (g.kind === "pan")
      setView((v) => ({
        ...v,
        pan: {
          x: g.pan.x - (e.clientX - g.client.x) / v.zoom,
          y: g.pan.y - (e.clientY - g.client.y) / v.zoom,
        },
      }));
    if (g.kind === "move")
      setPreviewDoc(
        moveDrawingAtoms(g.original, g.ids, {
          x: p.x - g.start.x,
          y: p.y - g.start.y,
        }),
      );
    if (g.kind === "draw") setPreviewDoc(drawPreview(g, p, e.altKey));
    gestureRef.current = next;
    setGesture(next);
  };
  const pointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    const p = point(e),
      distance = Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y);
    if (g.kind === "draw") {
      if (g.tool === "element" && distance < 5) {
        if (g.hit.atomId) editElement([g.hit.atomId], element);
        else if (g.hit.bondId) {
          const b = doc.bonds.find((b) => b.id === g.hit.bondId)!;
          const a = addMoleculeAtom(doc, element, p.x, p.y);
          let n = moleculeChanged({
            ...a.document,
            bonds: a.document.bonds.filter((bond) => bond.id !== b.id),
          });
          n = addMoleculeBond(n, b.from, a.atom.id);
          commit(addMoleculeBond(n, a.atom.id, b.to));
        } else commit(addMoleculeAtom(doc, element, p.x, p.y).document);
      } else commit(drawPreview(g, p, e.altKey));
    } else if (g.kind === "move" && distance > 3)
      commit(
        moveDrawingAtoms(g.original, g.ids, {
          x: p.x - g.start.x,
          y: p.y - g.start.y,
        }),
      );
    else if (g.kind === "box") {
      const x1 = Math.min(g.start.x, p.x),
        x2 = Math.max(g.start.x, p.x),
        y1 = Math.min(g.start.y, p.y),
        y2 = Math.max(g.start.y, p.y);
      select(
        Array.from(
          new Set([
            ...g.ids,
            ...doc.atoms
              .filter((a) => a.x >= x1 && a.x <= x2 && a.y >= y1 && a.y <= y2)
              .map((a) => a.id),
          ]),
        ),
      );
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    clearGesture();
  };
  const copy = async (cut = false) => {
    try {
      const fragment = selected.length ? drawingFragment(doc, selected) : doc;
      clipboard.current = fragment;
      await navigator.clipboard.writeText(exportMoleculeMolfile(fragment));
      if (cut) remove();
      else setNotice("Structure copied. Paste adds a new fragment.");
    } catch {
      setError("Use Export to copy the structure text.");
    }
  };
  const pasteText = (input: string) => {
    try {
      const fragment = importMolecule(
        input,
        /V2000|V3000|M  END/.test(input) ? "molfile" : "smiles",
      );
      const b = moleculeBounds(fragment, 0);
      const offset = doc.atoms.length
        ? {
            x: view.pan.x - b.x - b.width / 2 + 90,
            y: view.pan.y - b.y - b.height / 2 + 65,
          }
        : { x: view.pan.x, y: view.pan.y };
      const next = mergeDrawing(doc, fragment, offset);
      commit(next);
      select(next.atoms.slice(doc.atoms.length).map((a) => a.id));
      setTool("select");
      setNotice("Structure pasted. Drag the selection to position it.");
    } catch (f) {
      setError(
        f instanceof Error ? f.message : "Could not paste this structure.",
      );
    }
  };
  const paste = async () => {
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      if (clipboard.current) {
        commit(mergeDrawing(doc, clipboard.current, { x: 90, y: 65 }));
      } else {
        setDialog("import");
        setText("");
        setError("Paste your structure here.");
      }
    }
  };
  const keyboard = (e: KeyboardEvent<HTMLDivElement>) => {
    if (dialog && e.key === "Tab") {
      const fields = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          ".molecule-dialog button:not(:disabled), .molecule-dialog input, .molecule-dialog select, .molecule-dialog textarea",
        ) ?? [],
      );
      const current = fields.indexOf(
        window.document.activeElement as HTMLElement,
      );
      if (
        fields.length &&
        ((e.shiftKey && current <= 0) ||
          (!e.shiftKey && current === fields.length - 1))
      ) {
        e.preventDefault();
        fields[e.shiftKey ? fields.length - 1 : 0].focus();
      }
    }
    const input = (e.target as HTMLElement).matches("input,textarea,select");
    if (e.key === "Escape") {
      e.stopPropagation();
      setDialog(null);
      setPalette(null);
      clearGesture();
      select([]);
      setTool("select");
      setExpanded(false);
      return;
    }
    if (input) return;
    const cmd = e.metaKey || e.ctrlKey,
      key = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      setSpace(true);
      return;
    }
    if (cmd) {
      if (["z", "y", "a", "c", "v", "x", "l", "o", "s"].includes(key))
        e.preventDefault();
      if (key === "z") e.shiftKey ? redoChange() : undoChange();
      if (key === "y") redoChange();
      if (key === "a") {
        select(doc.atoms.map((a) => a.id));
        setTool("select");
        setSelectedBond(null);
      }
      if (key === "c") void copy();
      if (key === "x") void copy(true);
      if (key === "v") void paste();
      if (key === "l") clean();
      if (key === "o") {
        setDialog("import");
        setText("");
        setError("");
      }
      if (key === "s") openExport();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove();
      return;
    }
    if (/^[123]$/.test(e.key)) {
      setBondMode(Number(e.key) - 1);
      activate("bond");
      return;
    }
    if (key === "v") {
      activate("select");
      return;
    }
    if (key === "e") {
      activate("erase");
      return;
    }
    if (key === "t") {
      setRingSize(6);
      setAromaticRing(true);
      activate("ring");
      return;
    }
    if (key === "+" || key === "=") {
      charge(1);
      return;
    }
    if (key === "-") {
      charge(-1);
      return;
    }
    const symbol: keyof typeof shortcutElements =
      key as keyof typeof shortcutElements;
    const nextElement = shortcutElements[symbol];
    if (nextElement) {
      if (hoverHit.atomId) editElement([hoverHit.atomId], nextElement);
      else if (selected.length) editElement(selected, nextElement);
      else {
        setElement(nextElement);
        activate("element");
      }
    }
  };
  const clean = () => {
    try {
      const next = cleanMolecule(doc);
      commit(next);
      fit(next);
    } catch (f) {
      setError(f instanceof Error ? f.message : "Could not arrange structure.");
    }
  };
  const openExport = (f: "smiles" | "molfile" = format) => {
    try {
      setFormat(f);
      setText(
        f === "smiles" ? exportMoleculeSmiles(doc) : exportMoleculeMolfile(doc),
      );
      setError("");
      setDialog("export");
    } catch (f) {
      setError(f instanceof Error ? f.message : "Could not export.");
    }
  };
  const importText = (input = text, f = format) => {
    try {
      const next = importMolecule(input, f);
      commit(next);
      select([]);
      setSelectedBond(null);
      fit(next);
      setDialog(null);
      setQuick("");
      setTool("bond");
      setNotice("Structure imported. Ready to edit.");
    } catch (f) {
      setError(
        f instanceof Error ? f.message : "Check your structure and try again.",
      );
    }
  };
  const warnings = moleculeValenceWarnings(doc),
    display = preview ?? doc;
  let ghost: MoleculeDocument | null = null;
  if (hover && !gesture && tool === "ring")
    ghost = placeDrawingRing(doc, hover, ringSize, aromaticRing, hoverHit);
  const hoverAtom = doc.atoms.find((a) => a.id === hoverHit.atomId),
    hoverBond = doc.bonds.find((b) => b.id === hoverHit.bondId);
  const names: Record<Tool, string> = {
    select: "Select",
    pan: "Pan",
    erase: "Erase",
    element: `${element} atom`,
    bond: bondModes[bondMode].label.replace(/ \(.*\)/, ""),
    chain: "Carbon chain",
    ring: aromaticRing ? "Benzene" : `${ringSize}-membered ring`,
    "charge-plus": "Positive charge",
    "charge-minus": "Negative charge",
  };
  return (
    <div
      ref={root}
      className={`molecule-editor ${compact ? "compact" : ""} ${expanded ? "is-expanded" : ""} ${size.height < 360 ? "is-shallow" : ""} ${size.height < 460 ? "is-short" : ""}`}
      data-shortcuts="molecule"
      onKeyDown={keyboard}
      onKeyUp={(e) => {
        if (e.code === "Space") setSpace(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setSpace(false);
          setHoverHit({});
        }
      }}
    >
      <div
        className="molecule-topbar"
        role="toolbar"
        aria-label="Structure actions"
      >
        <ToolButton
          label="Clear canvas (undo available)"
          disabled={!doc.atoms.length}
          onClick={() => {
            commit(emptyMolecule());
            select([]);
          }}
        >
          <Trash2 size={18} />
        </ToolButton>
        <button
          className="molecule-text-tool"
          onClick={() => {
            setDialog("import");
            setText("");
            setError("");
          }}
          data-tooltip="Import SMILES or a molfile"
        >
          <FolderOpen size={18} />
          <span>Import</span>
        </button>
        <ToolButton
          label="Export structure (⌘/Ctrl S)"
          disabled={!doc.atoms.length}
          onClick={() => openExport("smiles")}
        >
          <ArrowDownToLine size={18} />
        </ToolButton>
        <span className="molecule-separator" />
        <ToolButton
          label="Undo (⌘/Ctrl Z)"
          disabled={!undo.length}
          onClick={undoChange}
        >
          <Undo2 size={18} />
        </ToolButton>
        <ToolButton
          label="Redo (⌘/Ctrl Shift Z)"
          disabled={!redo.length}
          onClick={redoChange}
        >
          <Redo2 size={18} />
        </ToolButton>
        <span className="molecule-separator" />
        <ToolButton
          label="Copy selection (⌘/Ctrl C)"
          disabled={!doc.atoms.length}
          onClick={() => void copy()}
        >
          <Copy size={18} />
        </ToolButton>
        <ToolButton
          label="Cut selection (⌘/Ctrl X)"
          disabled={!selected.length}
          onClick={() => void copy(true)}
        >
          <Scissors size={18} />
        </ToolButton>
        <ToolButton
          label="Paste structure (⌘/Ctrl V)"
          onClick={() => void paste()}
        >
          <ClipboardPaste size={18} />
        </ToolButton>
        <span className="molecule-separator" />
        <button
          className="molecule-text-tool"
          disabled={!doc.atoms.length}
          onClick={clean}
          data-tooltip="Arrange bonds and rings (⌘/Ctrl L)"
        >
          <Sparkles size={18} />
          <span>Clean up</span>
        </button>
        <span className="molecule-top-spacer" />
        <ToolButton label="Fit structure to canvas" onClick={() => fit()}>
          <Maximize2 size={18} />
        </ToolButton>
        <ToolButton
          label="Drawing help and shortcuts"
          onClick={() => setDialog("help")}
        >
          <HelpCircle size={18} />
        </ToolButton>
        <ToolButton
          label={expanded ? "Exit expanded editor" : "Expand molecule editor"}
          active={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Shrink size={18} /> : <Expand size={18} />}
        </ToolButton>
      </div>
      <form
        className="molecule-smilesbar"
        onSubmit={(e) => {
          e.preventDefault();
          importText(quick, "smiles");
        }}
      >
        <span>SMILES</span>
        <input
          aria-label="Quick SMILES import"
          placeholder="Paste a SMILES string to draw a structure…"
          spellCheck={false}
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        <button disabled={!quick.trim()} type="submit">
          Insert <span>↵</span>
        </button>
      </form>
      <div className="molecule-editor-body">
        <svg
          ref={svg}
          className={`molecule-canvas tool-${space ? "pan" : tool}`}
          aria-label="Molecule drawing canvas"
          tabIndex={0}
          viewBox={`${view.pan.x - size.width / 2 / view.zoom} ${view.pan.y - size.height / 2 / view.zoom} ${size.width / view.zoom} ${size.height / view.zoom}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerLeave={() => {
            if (!gesture) {
              setHover(null);
              setHoverHit({});
            }
          }}
          onPointerCancel={clearGesture}
          onDoubleClick={(e) => {
            const h = hit(point(e));
            if (h.atomId && tool === "select") openAtom(h.atomId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const h = hit(point(e));
            if (h.atomId) openAtom(h.atomId);
            else {
              select([]);
              setTool("select");
            }
          }}
        >
          <MoleculeGlyphs
            molecule={display}
            selectedAtomIds={selected}
            showAtomNumbers={numbers}
            showStereoCenters
          />
          {ghost && (
            <g className="molecule-ring-ghost">
              {ghost.bonds
                .filter((b) => !doc.bonds.some((old) => old.id === b.id))
                .map((b) => {
                  const a = ghost.atoms.find((a) => a.id === b.from)!,
                    c = ghost.atoms.find((a) => a.id === b.to)!;
                  return (
                    <line key={b.id} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />
                  );
                })}
            </g>
          )}
          {(!gesture || gesture.kind === "draw") && hoverAtom && (
            <circle
              className="molecule-hover-ring"
              cx={hoverAtom.x}
              cy={hoverAtom.y}
              r={12 / view.zoom}
            />
          )}
          {!gesture && hoverBond && (
            <line
              className="molecule-hover-bond"
              x1={doc.atoms.find((a) => a.id === hoverBond.from)!.x}
              y1={doc.atoms.find((a) => a.id === hoverBond.from)!.y}
              x2={doc.atoms.find((a) => a.id === hoverBond.to)!.x}
              y2={doc.atoms.find((a) => a.id === hoverBond.to)!.y}
            />
          )}
          {gesture?.kind === "box" && (
            <rect
              className="molecule-selection-box"
              x={Math.min(gesture.start.x, gesture.current.x)}
              y={Math.min(gesture.start.y, gesture.current.y)}
              width={Math.abs(gesture.start.x - gesture.current.x)}
              height={Math.abs(gesture.start.y - gesture.current.y)}
            />
          )}
        </svg>
        <div
          className="molecule-leftbar"
          role="toolbar"
          aria-label="Drawing tools"
        >
          <div className="molecule-tool-card">
            <ToolButton
              label="Select and move (V)"
              active={tool === "select"}
              onClick={() => activate("select")}
            >
              <MousePointer2 size={21} />
            </ToolButton>
            <ToolButton
              label="Pan canvas (hold Space)"
              active={tool === "pan"}
              onClick={() => activate("pan")}
            >
              <Hand size={21} />
            </ToolButton>
            <ToolButton
              label="Erase atoms and bonds (E)"
              active={tool === "erase"}
              onClick={() => activate("erase")}
            >
              <Eraser size={21} />
            </ToolButton>
          </div>
          <div className="molecule-tool-card molecule-palette-anchor">
            <div className="molecule-bond-split">
              <ToolButton
                label={bondModes[bondMode].label}
                active={tool === "bond"}
                onClick={() => activate("bond")}
              >
                <BondIcon mode={bondMode} />
              </ToolButton>
              <button
                className="molecule-palette-toggle"
                aria-label="Choose bond type"
                aria-expanded={palette === "bonds"}
                onClick={() => setPalette(palette === "bonds" ? null : "bonds")}
              >
                <ChevronDown size={10} />
              </button>
            </div>
            {palette === "bonds" && (
              <div
                className="molecule-bond-palette"
                role="toolbar"
                aria-label="Bond types"
              >
                {bondModes.map((m, i) => (
                  <button
                    key={m.label}
                    aria-label={m.label}
                    className={bondMode === i ? "chosen" : ""}
                    onClick={() => {
                      setBondMode(i);
                      activate("bond");
                    }}
                  >
                    <BondIcon mode={i} />
                    <span>{m.label}</span>
                    {bondMode === i && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
            <ToolButton
              label="Draw a carbon chain (drag)"
              active={tool === "chain"}
              onClick={() => activate("chain")}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="m2 15 5-7 5 7 5-7 5 7" />
              </svg>
            </ToolButton>
            <ToolButton
              label="Increase atom charge (+)"
              active={tool === "charge-plus"}
              onClick={() => charge(1)}
            >
              <span className="molecule-charge-icon">
                A<sup>+</sup>
              </span>
            </ToolButton>
            <ToolButton
              label="Decrease atom charge (−)"
              active={tool === "charge-minus"}
              onClick={() => charge(-1)}
            >
              <span className="molecule-charge-icon">
                A<sup>−</sup>
              </span>
            </ToolButton>
          </div>
        </div>
        <div className="molecule-rightbar" role="toolbar" aria-label="Elements">
          <div className="molecule-tool-card molecule-palette-anchor">
            {["C", "N", "O", "S", "P", "F", "Cl", "Br", "H"].map((symbol) => (
              <ToolButton
                key={symbol}
                label={`Draw or replace with ${symbol}`}
                active={tool === "element" && element === symbol}
                onClick={() => {
                  if (selected.length) editElement(selected, symbol);
                  setElement(symbol);
                  activate("element");
                }}
              >
                <span className={`element-${symbol}`}>{symbol}</span>
              </ToolButton>
            ))}
            <button
              className="molecule-tool"
              aria-label="More elements"
              data-tooltip="More elements"
              onClick={() =>
                setPalette(palette === "elements" ? null : "elements")
              }
            >
              ···
            </button>
            {palette === "elements" && (
              <div
                className="molecule-element-palette"
                role="toolbar"
                aria-label="Additional elements"
              >
                {moleculeElements.map((symbol) => (
                  <ToolButton
                    key={symbol}
                    label={`Choose ${symbol}`}
                    onClick={() => {
                      if (selected.length) editElement(selected, symbol);
                      setElement(symbol);
                      activate("element");
                    }}
                  >
                    <span className={`element-${symbol}`}>{symbol}</span>
                  </ToolButton>
                ))}
              </div>
            )}
          </div>
        </div>
        {!doc.atoms.length && !gesture && (
          <div className="molecule-empty-guide">
            <div className="molecule-empty-mark">
              <RingIcon aromatic />
            </div>
            <strong>Your molecule starts here</strong>
            <span>
              Click or drag to draw bonds.
              <br />
              Choose an atom on the right or a ring below.
            </span>
            <button
              onClick={() => {
                setDialog("import");
                setText("");
                setError("");
              }}
            >
              Import a structure instead
            </button>
          </div>
        )}
        <div
          className="molecule-ringbar"
          role="toolbar"
          aria-label="Ring templates"
        >
          <ToolButton
            label="Benzene ring (T)"
            active={tool === "ring" && aromaticRing}
            onClick={() => {
              setRingSize(6);
              setAromaticRing(true);
              activate("ring");
            }}
          >
            <RingIcon aromatic />
          </ToolButton>
          {[6, 5, 3, 4, 7, 8].map((n) => (
            <ToolButton
              key={n}
              label={`${n}-membered carbon ring`}
              active={tool === "ring" && ringSize === n && !aromaticRing}
              onClick={() => {
                setRingSize(n);
                setAromaticRing(false);
                activate("ring");
              }}
            >
              <RingIcon size={n} />
            </ToolButton>
          ))}
        </div>
        <div className="molecule-canvas-controls">
          <ToolButton
            label="Zoom out"
            onClick={() =>
              setView((v) => ({ ...v, zoom: Math.max(0.15, v.zoom / 1.2) }))
            }
          >
            <ZoomOut size={17} />
          </ToolButton>
          <button
            className="molecule-zoom-value"
            onClick={() => setView((v) => ({ ...v, zoom: 1 }))}
            data-tooltip="Reset zoom to 100%"
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <ToolButton
            label="Zoom in"
            onClick={() =>
              setView((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.2) }))
            }
          >
            <ZoomIn size={17} />
          </ToolButton>
        </div>
        {selected.length > 0 && tool === "select" && (
          <div className="molecule-selection-actions">
            <span>{selected.length} selected</span>
            <ToolButton
              label="Rotate selection 90°"
              onClick={() => {
                const atoms = doc.atoms.filter((a) => selected.includes(a.id)),
                  cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length,
                  cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
                commit(
                  moleculeChanged({
                    ...doc,
                    atoms: doc.atoms.map((a) =>
                      selected.includes(a.id)
                        ? { ...a, x: cx - (a.y - cy), y: cy + a.x - cx }
                        : a,
                    ),
                  }),
                );
              }}
            >
              <RotateCw size={16} />
            </ToolButton>
            <ToolButton label="Delete selection" onClick={remove}>
              <Trash2 size={16} />
            </ToolButton>
            <ToolButton
              label="Deselect"
              onClick={() => {
                select([]);
                setSelectedBond(null);
              }}
            >
              <X size={16} />
            </ToolButton>
          </div>
        )}
      </div>
      <div
        className={`molecule-statusbar ${error || warnings.length ? "has-warning" : ""}`}
        aria-live="polite"
      >
        <span className="molecule-active-tool">
          {names[space ? "pan" : tool]}
        </span>
        <span className="molecule-status-message">
          {error ||
            notice ||
            warnings[0] ||
            (tool === "bond"
              ? "Click to extend · drag to connect · 1 / 2 / 3 for bond order"
              : tool === "ring"
                ? "Click to place · click an atom to attach · click a bond to fuse"
                : tool === "element"
                  ? `Click an atom to replace it · drag to attach ${element}`
                  : tool === "select"
                    ? "Drag to select or move · Shift adds selection · double-click an atom to edit"
                    : "Space to pan · scroll to zoom")}
        </span>
        <label className="molecule-number-toggle">
          <input
            type="checkbox"
            checked={numbers}
            onChange={(e) => setNumbers(e.target.checked)}
          />
          Numbers
        </label>
        <span className="molecule-count">{doc.atoms.length} atoms</span>
        <span
          className="molecule-stereo-legend"
          title="Stereocenters: amber means undefined (CASCADE chooses one representative configuration); teal means defined by the drawing."
        >
          * Stereo
        </span>
      </div>
      {dialog && (
        <div
          className="molecule-dialog-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section
            className="molecule-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === "atom"
                ? "Atom properties"
                : dialog === "help"
                  ? "Drawing help"
                  : dialog === "import"
                    ? "Import structure"
                    : "Export structure"
            }
          >
            <div className="molecule-dialog-heading">
              <strong>
                {dialog === "atom"
                  ? "Atom properties"
                  : dialog === "help"
                    ? "Drawing a molecule"
                    : dialog === "import"
                      ? "Import structure"
                      : "Export structure"}
              </strong>
              <ToolButton
                label="Close structure dialog"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </ToolButton>
            </div>
            {dialog === "help" ? (
              <>
                <p>
                  Start with a bond, an atom, or a ring. The drawing stays
                  entirely in your browser.
                </p>
                <dl className="molecule-help">
                  <dt>Draw bonds</dt>
                  <dd>
                    Click empty space for a bond, click its end to extend, or
                    drag between atoms. Nearby atoms snap together.
                  </dd>
                  <dt>Build rings</dt>
                  <dd>
                    Choose a ring below, then click to place. Click an atom to
                    attach or a bond to fuse a ring.
                  </dd>
                  <dt>Edit atoms</dt>
                  <dd>
                    Choose an element and click an atom. Hover an atom and type
                    C, N, O, S, P, F, L (Cl), B (Br), I or H. Double-click for
                    charge and isotope.
                  </dd>
                  <dt>Select & move</dt>
                  <dd>
                    V selects. Drag around atoms or move selected atoms. Shift
                    adds to selection. Delete removes.
                  </dd>
                  <dt>Navigate</dt>
                  <dd>
                    Hold Space to pan. Scroll to zoom around the pointer. Fit
                    centers the structure.
                  </dd>
                  <dt>Shortcuts</dt>
                  <dd>
                    1 / 2 / 3: bond order · T: benzene · E: erase · ⌘/Ctrl Z:
                    undo · ⌘/Ctrl L: clean up · ⌘/Ctrl C / V: copy / paste ·
                    Esc: cancel.
                  </dd>
                </dl>
              </>
            ) : dialog === "atom" ? (
              <>
                <p>
                  Atom {doc.atoms.find((a) => a.id === atomEdit.id)?.index}. Its
                  assignment number stays the same when edited.
                </p>
                <div className="molecule-atom-fields">
                  <label>
                    Element
                    <select
                      value={atomEdit.element}
                      onChange={(e) =>
                        setAtomEdit({ ...atomEdit, element: e.target.value })
                      }
                    >
                      {[
                        ...new Set([...moleculeElements, atomEdit.element]),
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Charge
                    <input
                      type="number"
                      min="-8"
                      max="8"
                      step="1"
                      value={atomEdit.charge}
                      onChange={(e) =>
                        setAtomEdit({
                          ...atomEdit,
                          charge: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                  <label>
                    Isotope mass
                    <input
                      type="number"
                      min="1"
                      max="300"
                      placeholder="Natural"
                      value={atomEdit.isotope}
                      onChange={(e) =>
                        setAtomEdit({ ...atomEdit, isotope: e.target.value })
                      }
                    />
                  </label>
                </div>
                <button
                  className="molecule-primary"
                  onClick={() => {
                    const next = moleculeChanged({
                      ...doc,
                      atoms: doc.atoms.map((a) =>
                        a.id === atomEdit.id
                          ? {
                              ...a,
                              element: atomEdit.element,
                              charge: atomEdit.charge,
                              isotope: atomEdit.isotope
                                ? Number(atomEdit.isotope)
                                : undefined,
                            }
                          : a,
                      ),
                    });
                    const errors = validateMolecule(next);
                    if (errors.length) {
                      setError(errors[0]);
                      return;
                    }
                    commit(next);
                    setDialog(null);
                  }}
                >
                  Apply changes
                </button>
              </>
            ) : (
              <>
                <p>
                  {dialog === "import"
                    ? "Paste a SMILES string or open a structure file. Import replaces the drawing; Undo restores it."
                    : "Copy or download the structure for other chemistry software."}
                </p>
                <div className="molecule-format-tabs">
                  <button
                    className={format === "smiles" ? "active" : ""}
                    onClick={() => {
                      setFormat("smiles");
                      if (dialog === "export") openExport("smiles");
                    }}
                  >
                    SMILES
                  </button>
                  <button
                    className={format === "molfile" ? "active" : ""}
                    onClick={() => {
                      setFormat("molfile");
                      if (dialog === "export") openExport("molfile");
                    }}
                  >
                    Molfile
                  </button>
                </div>
                <textarea
                  aria-label={
                    format === "smiles"
                      ? "SMILES structure"
                      : "Molfile structure"
                  }
                  autoFocus
                  spellCheck={false}
                  value={text}
                  readOnly={dialog === "export"}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    format === "smiles"
                      ? "e.g. CC(=O)Oc1ccccc1C(=O)O"
                      : "Paste a V2000 or V3000 molfile"
                  }
                />
                <div className="molecule-dialog-actions">
                  {dialog === "import" ? (
                    <>
                      <button onClick={() => fileInput.current?.click()}>
                        <FolderOpen size={16} />
                        Open file
                      </button>
                      <button
                        className="molecule-primary"
                        disabled={!text.trim()}
                        onClick={() => importText()}
                      >
                        <Check size={16} />
                        Import structure
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(text);
                            setNotice("Structure copied.");
                            setDialog(null);
                          } catch {
                            setError(
                              "Select the text and copy using your keyboard.",
                            );
                          }
                        }}
                      >
                        <Copy size={16} />
                        Copy
                      </button>
                      <button
                        className="molecule-primary"
                        onClick={() => {
                          const url = URL.createObjectURL(
                              new Blob([text], { type: "text/plain" }),
                            ),
                            a = window.document.createElement("a");
                          a.href = url;
                          a.download =
                            format === "smiles"
                              ? "structure.smi"
                              : "structure.mol";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <ArrowDownToLine size={16} />
                        Download
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {error && (
              <div className="molecule-dialog-error" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".mol,.sdf,.smi,.smiles,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
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
          e.target.value = "";
        }}
      />
    </div>
  );
}
const shortcutElements: Record<string, string> = {
  c: "C",
  n: "N",
  o: "O",
  s: "S",
  p: "P",
  f: "F",
  l: "Cl",
  b: "Br",
  i: "I",
  h: "H",
};
