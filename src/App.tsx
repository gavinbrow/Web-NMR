import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  FolderOpen,
  GripVertical,
  Hand,
  Layers,
  ListFilter,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Waves,
  X,
  ZoomIn,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { colors, defaultRecipe, extent, uid } from "./model";
import type {
  Spectrum,
  Tool,
  Tab,
  Project,
  ProcessingRecipe,
  KineticPoint,
} from "./model";
import {
  importBrowserFiles,
  processAsync,
  autoPhaseAsync,
} from "./core/workerClient";
import { detectPeaks, integrate, analyzeMultiplet } from "./core/numerics";
import { createDemoSpectra } from "./features/demo";
import { droppedFiles } from "./features/dropFiles";
import {
  downloadProject,
  loadProject,
  saveRecovery,
  loadRecovery,
  clearRecovery,
} from "./features/project";
import {
  exportSpectrumCSV,
  exportAnalysisCSV,
  exportJCAMP,
  exportFigureSVG,
  exportKineticsCSV,
} from "./features/export";
import { fitKinetics } from "./features/kinetics";
import { SpectrumPlot, dataStats } from "./components/SpectrumPlot";
import { KineticsChart } from "./components/KineticsChart";

type Table =
  "Peaks" | "Integrals" | "Multiplets" | "Spectra" | "Acquisition" | "History";
type Panel =
  | "overview"
  | "phase"
  | "apodization"
  | "baseline"
  | "reference"
  | "peaks"
  | "integral"
  | "multiplet"
  | "stack"
  | "export";
const tabs: Tab[] = [
  "File",
  "Home",
  "Processing",
  "Analysis",
  "Stack",
  "Kinetics",
  "Export",
];
const toolText: Record<Tool, string> = {
  select: "Select",
  zoom: "Zoom",
  pan: "Pan",
  reference: "Reference",
  peak: "Pick peaks",
  integral: "Integrate",
  multiplet: "Multiplet",
  baseline: "Baseline points",
};
const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
function RibbonButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`ribbon-button ${active ? "is-active" : ""}`}
      title={`${label}${shortcut ? " · " + shortcut : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={23} strokeWidth={1.65} />
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(
    () => setText(Number.isFinite(value) ? String(value) : ""),
    [value],
  );
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setText(Number.isFinite(value) ? String(value) : "")}
      />
    </Field>
  );
}
function MiniTrace({ spectrum: s }: { spectrum: Spectrum }) {
  const path = useMemo(() => {
    let d = "";
    const y = s.data.real,
      n = y.length,
      max = dataStats(s.data).max;
    for (let b = 0; b < 146; b++) {
      let lo = Infinity,
        hi = -Infinity;
      for (
        let i = Math.floor((b * n) / 146);
        i < Math.floor(((b + 1) * n) / 146);
        i++
      ) {
        lo = Math.min(lo, y[i]);
        hi = Math.max(hi, y[i]);
      }
      if (!Number.isFinite(lo)) continue;
      const x = b + 2;
      d += `${d ? "L" : "M"}${x},${40 - (hi / max) * 34}L${x},${40 - (lo / max) * 34}`;
    }
    return d;
  }, [s.data]);
  return (
    <svg viewBox="0 0 150 48" aria-hidden="true">
      <path d={path} stroke={s.color} fill="none" strokeWidth=".9" />
      <line x1="2" x2="148" y1="44" y2="44" stroke="#d8dde3" />
    </svg>
  );
}

export default function App() {
  const initial = useMemo(() => createDemoSpectra(), []);
  const [spectra, setSpectra] = useState<Spectrum[]>(initial),
    [activeId, setActiveId] = useState(initial[0]?.id ?? ""),
    [selected, setSelected] = useState<string[]>([]);
  const [projectName, setProjectName] = useState("Reaction monitoring"),
    [isDemo, setIsDemo] = useState(true),
    [tab, setTab] = useState<Tab>("Analysis"),
    [tool, setTool] = useState<Tool>("zoom"),
    [panel, setPanel] = useState<Panel>("overview");
  const [view, setView] = useState<[number, number]>([10, -0.5]),
    [mode, setMode] = useState<Project["displayMode"]>("single"),
    [normalization, setNormalization] =
      useState<Project["normalization"]>("none");
  const [plotGain, setPlotGain] = useState(1),
    [component, setComponent] = useState<"real" | "imag" | "magnitude" | "fid">(
      "real",
    ),
    [grid, setGrid] = useState(true),
    [showPeaks, setShowPeaks] = useState(true),
    [showIntegrals, setShowIntegrals] = useState(true);
  const [table, setTable] = useState<Table>("Integrals"),
    [tableOpen, setTableOpen] = useState(false),
    [navigatorOpen, setNavigatorOpen] = useState(true),
    [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 620),
    [filter, setFilter] = useState("");
  const [toast, setToast] = useState(""),
    [busy, setBusy] = useState(""),
    [help, setHelp] = useState(false),
    [warnings, setWarnings] = useState<string[]>([]),
    [dragOver, setDragOver] = useState(false),
    [cursor, setCursor] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProcessingRecipe>(defaultRecipe()),
    [preview, setPreview] = useState<Spectrum["data"] | null>(null),
    [scope, setScope] = useState<"active" | "selected" | "all">("active");
  const [threshold, setThreshold] = useState(3),
    [minDistance, setMinDistance] = useState(0.012),
    [negative, setNegative] = useState(false),
    [clickedPpm, setClickedPpm] = useState(0),
    [targetPpm, setTargetPpm] = useState(0);
  const [regionFrom, setRegionFrom] = useState(4.24),
    [regionTo, setRegionTo] = useState(4),
    [normalValue, setNormalValue] = useState(1),
    [selectedIntegral, setSelectedIntegral] = useState("");
  const [kinPicking, setKinPicking] = useState(false);
  const [kinFrom, setKinFrom] = useState(4.24),
    [kinTo, setKinTo] = useState(4),
    [kinModel, setKinModel] = useState<"decay" | "growth" | "linear">("decay"),
    [excluded, setExcluded] = useState<string[]>([]),
    [fitEnabled, setFitEnabled] = useState(false);
  const [recovery, setRecovery] = useState<Project | null>(null),
    [ready, setReady] = useState(false),
    [saveState, setSaveState] = useState("Local workspace");
  const undoRef = useRef<Spectrum[][]>([]),
    redoRef = useRef<Spectrum[][]>([]),
    [historyVersion, setHistoryVersion] = useState(0);
  const viewHistory = useRef<[number, number][]>([]),
    viewForward = useRef<[number, number][]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    svgExport = useRef<(() => string) | null>(null),
    job = useRef(0);
  const active = spectra.find((s) => s.id === activeId) ?? spectra[0];
  const displayedActive = useMemo(
    () =>
      active
        ? {
            ...active,
            data: preview ?? active.data,
            recipe: preview || tool === "baseline" ? draft : active.recipe,
          }
        : undefined,
    [active, preview, tool, draft],
  );
  const plottedSpectra = useMemo(
    () => spectra.map((s) => (s.id === active?.id ? displayedActive! : s)),
    [spectra, active?.id, displayedActive],
  );
  const project = (): Project => ({
    version: 1,
    name: projectName,
    spectra,
    activeId: active?.id ?? null,
    view,
    displayMode: mode,
    normalization,
    savedAt: new Date().toISOString(),
  });
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let cancelled = false;
    loadRecovery()
      .then((p) => {
        if (cancelled) return;
        if (p) setRecovery(p);
        else setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready || isDemo) return;
    const timer = setTimeout(() => {
      setSaveState("Saving locally…");
      saveRecovery(project())
        .then((ok) =>
          setSaveState(
            ok ? "Saved locally" : "Autosave unavailable · save project",
          ),
        )
        .catch(() => setSaveState("Autosave unavailable · save project"));
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    spectra,
    activeId,
    view,
    mode,
    normalization,
    projectName,
    ready,
    isDemo,
  ]);
  useEffect(() => {
    if (active) {
      setDraft({
        ...active.recipe,
        baselineAnchors: [...active.recipe.baselineAnchors],
      });
      setPreview(null);
      setScope("active");
      setSelectedIntegral(active.integrals[0]?.id ?? "");
    }
    setComponent("real");
  }, [activeId, active?.revision]);
  function commit(next: Spectrum[]) {
    undoRef.current.push(spectra);
    if (undoRef.current.length > 25) undoRef.current.shift();
    redoRef.current = [];
    setHistoryVersion((n) => n + 1);
    setSpectra(next);
  }
  function changeActive(fn: (s: Spectrum) => Spectrum) {
    if (!active || busy) return;
    commit(spectra.map((s) => (s.id === active.id ? fn(s) : s)));
  }
  function undo() {
    if (busy) return;
    const previous = undoRef.current.pop();
    if (previous) {
      redoRef.current.push(spectra);
      setSpectra(previous);
      setPreview(null);
      setHistoryVersion((n) => n + 1);
      notify("Edit undone");
    }
  }
  function redo() {
    if (busy) return;
    const next = redoRef.current.pop();
    if (next) {
      undoRef.current.push(spectra);
      setSpectra(next);
      setPreview(null);
      setHistoryVersion((n) => n + 1);
      notify("Edit restored");
    }
  }
  function zoom(v: [number, number]) {
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[0] - v[1] < 1e-8)
      return;
    viewHistory.current.push(view);
    if (viewHistory.current.length > 40) viewHistory.current.shift();
    viewForward.current = [];
    setView(v);
  }
  function full() {
    if (active) {
      zoom(extent(active.data, active.referenceOffset));
      setPlotGain(1);
    }
  }
  function previousView() {
    const last = viewHistory.current.pop();
    if (last) {
      viewForward.current.push(view);
      setView(last);
    }
  }
  function nextView() {
    const next = viewForward.current.pop();
    if (next) {
      viewHistory.current.push(view);
      setView(next);
    }
  }
  function selectSpectrum(id: string, multi = false) {
    if (busy) return;
    if (multi) {
      setSelected((a) =>
        a.includes(id) ? a.filter((v) => v !== id) : [...a, id],
      );
      return;
    }
    const next = spectra.find((s) => s.id === id);
    if (next && active && next.nucleus !== active.nucleus) {
      setView(extent(next.data, next.referenceOffset));
      setPlotGain(1);
    }
    setActiveId(id);
    setPreview(null);
  }
  function toolMode(t: Tool, p?: Panel) {
    if (busy) return;
    setTool(t);
    if (p) {
      setPanel(p);
      setInspectorOpen(true);
    }
    if (t === "integral") setTable("Integrals");
    if (t === "multiplet") setTable("Multiplets");
    if (t === "peak") setTable("Peaks");
  }
  function restore(p: Project) {
    setSpectra(p.spectra);
    setActiveId(p.activeId ?? p.spectra[0]?.id ?? "");
    setProjectName(p.name);
    setView(p.view ?? [10, -0.5]);
    setMode(p.displayMode);
    setNormalization(p.normalization);
    setIsDemo(false);
    setPreview(null);
    setSelected([]);
    undoRef.current = [];
    redoRef.current = [];
    setHistoryVersion((n) => n + 1);
    setRecovery(null);
    setReady(true);
    notify(`Opened ${p.name}`);
  }
  async function openFiles(files: File[]) {
    if (!files.length || busy) return;
    const ticket = ++job.current;
    setBusy("Reading spectra…");
    try {
      const portable = files.find((f) =>
        f.name.toLowerCase().endsWith(".webnmr"),
      );
      if (portable) {
        const p = await loadProject(portable);
        if (ticket === job.current) restore(p);
        return;
      }
      const result = await importBrowserFiles(files);
      if (ticket !== job.current) return;
      setWarnings(result.warnings);
      if (!result.spectra.length) {
        notify(
          "No supported 1D spectra found. Open the experiment folder or a ZIP.",
        );
        return;
      }
      const next = isDemo ? result.spectra : [...spectra, ...result.spectra];
      if (isDemo) {
        undoRef.current = [];
        redoRef.current = [];
        setHistoryVersion((n) => n + 1);
        setSpectra(next);
      } else commit(next);
      const first = result.spectra[0];
      setActiveId(first.id);
      setView(extent(first.data, first.referenceOffset));
      setIsDemo(false);
      setProjectName(isDemo ? "Untitled project" : projectName);
      setMode("single");
      setPreview(null);
      setTab("Analysis");
      setPanel("overview");
      setTool("zoom");
      setPlotGain(1);
      setReady(true);
      notify(
        `${result.spectra.length} spectrum${result.spectra.length === 1 ? "" : "s"} imported`,
      );
    } catch (e) {
      if (ticket !== job.current) return;
      setWarnings([err(e)]);
      notify(err(e));
    } finally {
      if (ticket === job.current) setBusy("");
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
      if (projectInput.current) projectInput.current.value = "";
    }
  }
  async function process(kind: "preview" | "apply", recipe = draft) {
    if (!active || busy) return;
    const targets =
      kind === "preview"
        ? [active]
        : scope === "all"
          ? spectra
          : scope === "selected"
            ? spectra.filter((s) => selected.includes(s.id))
            : [active];
    if (!targets.length) {
      notify("Select spectra in the navigator first.");
      return;
    }
    const ticket = ++job.current;
    setBusy(
      kind === "preview"
        ? "Preparing preview…"
        : `Processing ${targets.length} spectrum${targets.length === 1 ? "" : "s"}…`,
    );
    try {
      const results: Map<string, Spectrum> = new Map();
      for (const s of targets) {
        const updated = {
          ...s,
          recipe: { ...recipe, baselineAnchors: [...recipe.baselineAnchors] },
        };
        const data = await processAsync(updated);
        if (ticket !== job.current) return;
        if (kind === "preview") {
          setPreview(data);
          notify("Preview ready. Apply to keep these changes.");
        } else {
          results.set(s.id, {
            ...updated,
            data,
            peaks: [],
            multiplets: [],
            integrals: s.integrals.map((i) => ({
              ...i,
              area: integrate(data, s.referenceOffset, i.from, i.to),
            })),
            history: [
              ...s.history,
              `${new Date().toLocaleTimeString()} · Processing: ${recipe.transform ? "FT · " : ""}phase ${recipe.ph0.toFixed(1)}°/${recipe.ph1.toFixed(1)}° · baseline ${recipe.baseline}`,
            ],
            revision: s.revision + 1,
          });
        }
      }
      if (kind === "apply") {
        commit(spectra.map((s) => results.get(s.id) ?? s));
        setDraft(recipe);
        setPreview(null);
        setTool("select");
        notify(
          "Processing applied. Integrals updated; peak and multiplet results cleared.",
        );
      }
    } catch (e) {
      notify(err(e));
    } finally {
      if (ticket === job.current) setBusy("");
    }
  }
  function cancelPreview() {
    if (busy === "Saving project…") return;
    job.current++;
    setBusy("");
    setPreview(null);
    if (active)
      setDraft({
        ...active.recipe,
        baselineAnchors: [...active.recipe.baselineAnchors],
      });
    setTool("select");
    setKinPicking(false);
    notify("Preview canceled");
  }
  async function autoPhase() {
    if (!active || busy) return;
    setPanel("phase");
    setInspectorOpen(true);
    setBusy("Finding phase correction…");
    const ticket = ++job.current;
    try {
      const sourceRecipe = {
        ...draft,
        transform: draft.transform || (!active.original.imag && !!active.fid),
      };
      const result = await autoPhaseAsync({ ...active, recipe: sourceRecipe });
      if (ticket !== job.current) return;
      const recipe = { ...sourceRecipe, ...result };
      setDraft(recipe);
      setBusy("");
      await process("preview", recipe);
    } catch (e) {
      if (ticket !== job.current) return;
      setBusy("");
      notify(err(e));
    }
  }
  function manualBaseline() {
    if (!active || busy) return;
    setComponent("real");
    toolMode("baseline", "baseline");
    setDraft((d) => ({ ...d, baseline: "manual" }));
    void process("preview", { ...draft, baseline: "none" });
  }
  function autoPeaks(from?: number, to?: number) {
    if (!active || busy) return;
    const picked = detectPeaks(
      active.data,
      active.referenceOffset,
      threshold,
      minDistance,
      negative,
    );
    const peaks =
      from === undefined
        ? picked
        : picked.filter(
            (p) => p.ppm >= Math.min(from, to!) && p.ppm <= Math.max(from, to!),
          );
    changeActive((s) => ({
      ...s,
      peaks:
        from === undefined
          ? peaks
          : [
              ...s.peaks.filter(
                (p) =>
                  p.ppm < Math.min(from, to!) || p.ppm > Math.max(from, to!),
              ),
              ...peaks,
            ],
      history: [...s.history, `Peak picking · ${peaks.length} peaks`],
    }));
    setTable("Peaks");
    setTableOpen(true);
    notify(`${peaks.length} peaks picked`);
  }
  function addIntegral(from = regionFrom, to = regionTo) {
    if (!active || busy) return;
    if (from === to) {
      notify("Choose a region with two different limits.");
      return;
    }
    const area = integrate(active.data, active.referenceOffset, from, to);
    const integral = {
      id: uid(),
      from: Math.max(from, to),
      to: Math.min(from, to),
      area,
      label: `I${active.integrals.length + 1}`,
    };
    changeActive((s) => ({
      ...s,
      integrals: [...s.integrals, integral],
      history: [...s.history, `Integral · ${fmt(from)}–${fmt(to)} ppm`],
    }));
    setSelectedIntegral(integral.id);
    setTable("Integrals");
    setTableOpen(true);
    notify("Integral added");
  }
  function addMultiplet(from = regionFrom, to = regionTo) {
    if (!active || busy) return;
    const m = analyzeMultiplet(
      active.data,
      active.referenceOffset,
      from,
      to,
      active.frequencyMHz,
    );
    changeActive((s) => ({
      ...s,
      multiplets: [
        ...s.multiplets,
        { ...m, label: `M${s.multiplets.length + 1}` },
      ],
    }));
    setTable("Multiplets");
    setTableOpen(true);
    notify(`Multiplet added · ${m.kind} · review overlapping signals`);
  }
  function region(a: number, b: number) {
    if (kinPicking) {
      setKinFrom(Math.max(a, b));
      setKinTo(Math.min(a, b));
      setKinPicking(false);
      setFitEnabled(false);
      setTab("Kinetics");
      setInspectorOpen(false);
      setTool("select");
      notify("Region measured across the time series");
      return;
    }
    setRegionFrom(Math.max(a, b));
    setRegionTo(Math.min(a, b));
    if (tool === "integral") addIntegral(a, b);
    if (tool === "multiplet") addMultiplet(a, b);
    if (tool === "peak") autoPeaks(a, b);
  }
  function point(ppm: number, value: number) {
    if (!active || busy) return;
    if (tool === "reference") {
      setClickedPpm(ppm);
      setPanel("reference");
      setInspectorOpen(true);
    } else if (tool === "baseline") {
      setDraft((d) => ({
        ...d,
        baseline: "manual",
        baselineAnchors: [...d.baselineAnchors, { ppm, value }].sort(
          (a, b) => a.ppm - b.ppm,
        ),
      }));
      setPanel("baseline");
    } else if (tool === "peak") {
      let best = 0,
        distance = Infinity;
      for (let i = 0; i < active.data.x.length; i++) {
        const d = Math.abs(active.data.x[i] + active.referenceOffset - ppm);
        if (d < distance) {
          distance = d;
          best = i;
        }
      }
      const radius = Math.max(
        2,
        Math.floor(
          (active.data.x.length * Math.min(0.012, (view[0] - view[1]) * 0.01)) /
            Math.abs(
              active.data.x[0] - active.data.x[active.data.x.length - 1],
            ),
        ),
      );
      const a = Math.max(0, best - radius),
        b = Math.min(active.data.real.length - 1, best + radius);
      for (let i = a; i <= b; i++)
        if (active.data.real[i] > active.data.real[best]) best = i;
      const pk = {
        id: uid(),
        ppm: active.data.x[best] + active.referenceOffset,
        height: active.data.real[best],
      };
      changeActive((s) => ({ ...s, peaks: [...s.peaks, pk] }));
      setTable("Peaks");
      notify(`Peak at ${pk.ppm.toFixed(3)} ppm`);
    }
  }
  function reference() {
    if (!active || busy) return;
    const delta = targetPpm - clickedPpm;
    changeActive((s) => ({
      ...s,
      referenceOffset: s.referenceOffset + delta,
      recipe: {
        ...s.recipe,
        pivotPpm: s.recipe.pivotPpm + delta,
        baselineAnchors: s.recipe.baselineAnchors.map((a) => ({
          ...a,
          ppm: a.ppm + delta,
        })),
      },
      revision: s.revision + 1,
      peaks: s.peaks.map((p) => ({ ...p, ppm: p.ppm + delta })),
      integrals: s.integrals.map((i) => ({
        ...i,
        from: i.from + delta,
        to: i.to + delta,
      })),
      multiplets: s.multiplets.map((m) => ({
        ...m,
        from: m.from + delta,
        to: m.to + delta,
        center: m.center + delta,
      })),
      history: [
        ...s.history,
        `Reference · ${fmt(clickedPpm)} → ${fmt(targetPpm)} ppm`,
      ],
    }));
    zoom([view[0] + delta, view[1] + delta]);
    notify(`Reference shifted by ${delta.toFixed(4)} ppm`);
  }
  function autoIntegrals() {
    if (!active || busy) return;
    const peaks = detectPeaks(
      active.data,
      active.referenceOffset,
      threshold,
      minDistance,
      negative,
    );
    const regions: { from: number; to: number }[] = [];
    for (const p of [...peaks].sort((a, b) => a.ppm - b.ppm)) {
      const last = regions[regions.length - 1];
      if (last && p.ppm - 0.04 <= last.from) last.from = p.ppm + 0.04;
      else regions.push({ from: p.ppm + 0.04, to: p.ppm - 0.04 });
    }
    changeActive((s) => ({
      ...s,
      integrals: regions.map((r, i) => ({
        ...r,
        id: uid(),
        label: `I${i + 1}`,
        area: integrate(s.data, s.referenceOffset, r.from, r.to),
      })),
    }));
    setTable("Integrals");
    setTableOpen(true);
    notify(
      `${regions.length} suggested integral regions. Review boundaries before reporting.`,
    );
  }
  function normalizeIntegral() {
    if (!active) return;
    const i = active.integrals.find((a) => a.id === selectedIntegral);
    if (!i || Math.abs(i.area) < 1e-15) {
      notify("Choose a nonzero integral first.");
      return;
    }
    changeActive((s) => ({ ...s, integralScale: normalValue / i.area }));
    notify("Integral reporting scale updated");
  }
  function gain(factor: number) {
    if (busy) return;
    if (mode === "single")
      setPlotGain((v) => Math.max(0.01, Math.min(100, v * factor)));
    else if (active)
      setSpectra((a) =>
        a.map((s) =>
          s.id === active.id
            ? { ...s, gain: Math.max(0.01, Math.min(100, s.gain * factor)) }
            : s,
        ),
      );
  }
  function duplicate() {
    if (!active || busy) return;
    const s = {
      ...active,
      id: uid(),
      label: active.label + " copy",
      color: colors[spectra.length % colors.length],
      peaks: active.peaks.map((p) => ({ ...p, id: uid() })),
      integrals: active.integrals.map((p) => ({ ...p, id: uid() })),
      multiplets: active.multiplets.map((p) => ({ ...p, id: uid() })),
    };
    commit([...spectra, s]);
    setActiveId(s.id);
    notify("Spectrum duplicated for independent processing");
  }
  function deleteSpectrum(id: string) {
    if (busy) return;
    const next = spectra.filter((s) => s.id !== id);
    commit(next);
    if (id === activeId) setActiveId(next[0]?.id ?? "");
    notify("Spectrum removed · Undo to restore");
  }
  function moveSpectrum(id: string, direction: number) {
    if (busy) return;
    const next = [...spectra],
      i = next.findIndex((s) => s.id === id),
      j = i + direction;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }
  function enterTab(t: Tab) {
    if (busy) return;
    setTab(t);
    if (t === "Stack") {
      setPanel("stack");
      setMode("stack");
    }
    if (t === "Export") setPanel("export");
    if (t === "Processing") {
      setPanel("phase");
      if (active && !active.original.imag && active.fid)
        setDraft((d) => ({ ...d, transform: true }));
    }
    if (t === "Home" || t === "Analysis") setPanel("overview");
    setInspectorOpen(t !== "Kinetics");
  }
  async function saveProject() {
    if (busy) return;
    setBusy("Saving project…");
    try {
      await downloadProject(project());
      notify("Project downloaded");
    } catch (e) {
      notify(err(e));
    } finally {
      setBusy("");
    }
  }
  function getFigure() {
    const s = svgExport.current?.();
    if (!s) throw new Error("No figure available");
    return s;
  }
  async function png() {
    try {
      const svg = getFigure();
      const img = new Image(),
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width * 2;
        c.height = img.height * 2;
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => {
          if (blob) {
            const u = URL.createObjectURL(blob),
              a = document.createElement("a");
            a.href = u;
            a.download = active!.label + ".png";
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          }
          URL.revokeObjectURL(url);
        }, "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        notify("Could not create PNG. Export SVG instead.");
      };
      img.src = url;
    } catch (e) {
      notify(err(e));
    }
  }
  function printFigure() {
    try {
      const html = getFigure();
      const w = window.open("", "_blank");
      if (!w) {
        notify("Allow pop-ups to print or save a PDF.");
        return;
      }
      w.document.write(
        "<html><head><title>Web NMR figure</title><style>body{margin:30px}svg{width:100%;height:auto}@page{size:landscape;margin:12mm}</style></head><body>" +
          html +
          "</body></html>",
      );
      w.document.close();
      w.focus();
      w.print();
    } catch (e) {
      notify(err(e));
    }
  }
  const measurementSignature = spectra
    .map((s) =>
      [s.id, s.revision, s.referenceOffset, s.timeMinutes, s.nucleus].join(":"),
    )
    .join("|");
  const kineticsPoints: KineticPoint[] = useMemo(
    () =>
      spectra
        .filter(
          (s) => s.timeMinutes !== undefined && s.nucleus === active?.nucleus,
        )
        .map((s) => ({
          id: s.id,
          time: s.timeMinutes!,
          value: integrate(s.data, s.referenceOffset, kinFrom, kinTo),
          included: !excluded.includes(s.id),
        }))
        .sort((a, b) => a.time - b.time),
    [measurementSignature, active?.nucleus, kinFrom, kinTo, excluded],
  );
  const fitResult = useMemo(() => {
    if (!fitEnabled) return { fit: null, error: "" };
    try {
      return { fit: fitKinetics(kineticsPoints, kinModel), error: "" };
    } catch (e) {
      return { fit: null, error: err(e) };
    }
  }, [kineticsPoints, kinModel, fitEnabled]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        (e.altKey && e.ctrlKey)
      )
        return;
      const command = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (command && k === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (command && k === "s") {
        e.preventDefault();
        void saveProject();
        return;
      }
      if (command && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (command && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (help) setHelp(false);
        else cancelPreview();
        return;
      }
      if (busy) return;
      if (e.shiftKey && k === "p") {
        e.preventDefault();
        enterTab("Processing");
        setPanel("phase");
        return;
      }
      if (e.shiftKey && k === "i") {
        e.preventDefault();
        setTable("Integrals");
        setTableOpen(true);
        toolMode("integral", "integral");
        return;
      }
      if (e.shiftKey && k === "j") {
        e.preventDefault();
        setTable("Multiplets");
        setTableOpen(true);
        toolMode("multiplet", "multiplet");
        return;
      }
      if (e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        previousView();
        return;
      }
      if (e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        nextView();
        return;
      }
      if (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step =
          (view[0] - view[1]) * 0.1 * (e.key === "ArrowLeft" ? 1 : -1);
        zoom([view[0] + step, view[1] + step]);
        return;
      }
      if (command && k === "k") {
        e.preventDefault();
        toolMode("peak", "peaks");
        return;
      }
      if (e.key === "+" && !command && !e.altKey) {
        e.preventDefault();
        gain(1.1);
        return;
      }
      if (command || e.altKey || e.shiftKey) return;
      if (k === "z") {
        e.preventDefault();
        toolMode("zoom");
      } else if (k === "i") {
        e.preventDefault();
        toolMode("integral", "integral");
      } else if (k === "j") {
        e.preventDefault();
        toolMode("multiplet", "multiplet");
      } else if (k === "k") {
        e.preventDefault();
        toolMode("peak", "peaks");
      } else if (k === "l" || k === "r") {
        e.preventDefault();
        toolMode("reference", "reference");
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        gain(1.1);
      } else if (e.key === "-") {
        e.preventDefault();
        gain(1 / 1.1);
      } else if (e.code === "Space") {
        e.preventDefault();
      } else if (e.key === "F1" || k === "?") {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    spectra,
    activeId,
    view,
    mode,
    tool,
    help,
    busy,
    projectName,
    normalization,
    selected,
    draft,
    scope,
  ]);
  const processActions = (
    <>
      <div className="ribbon-group">
        <RibbonButton
          icon={Sparkles}
          label="Auto phase"
          onClick={autoPhase}
          disabled={!active || (!active.data.imag && !active.fid) || !!busy}
        />
        <RibbonButton
          icon={SlidersHorizontal}
          label="Manual phase"
          shortcut="⇧ P"
          active={panel === "phase"}
          onClick={() => setPanel("phase")}
        />
        <span className="group-label">Phase</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={Waves}
          label="Apodization"
          active={panel === "apodization"}
          onClick={() => {
            setPanel("apodization");
            setInspectorOpen(true);
            if (active?.fid) setDraft((d) => ({ ...d, transform: true }));
          }}
        />
        <RibbonButton
          icon={Activity}
          label="Fourier transform"
          onClick={() => {
            const r = { ...draft, transform: true };
            setDraft(r);
            void process("preview", r);
          }}
          disabled={!active?.fid || !!busy}
        />
        <span className="group-label">FID & transform</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={Sparkles}
          label="Auto baseline"
          onClick={() => {
            const r = { ...draft, baseline: "auto" as const };
            setDraft(r);
            setPanel("baseline");
            void process("preview", r);
          }}
          disabled={!active || !!busy}
        />
        <RibbonButton
          icon={Settings2}
          label="Manual baseline"
          active={tool === "baseline"}
          onClick={manualBaseline}
        />
        <span className="group-label">Baseline</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={RotateCcw}
          label="Reset processing"
          onClick={() => {
            if (active) {
              const r = {
                ...defaultRecipe(),
                transform: active.recipe.transform,
                window: "none" as const,
              };
              setDraft(r);
              void process("preview", r);
            }
          }}
        />
        <span className="group-label">Recipe</span>
      </div>
    </>
  );
  const analysisActions = (
    <>
      <div className="ribbon-group">
        <RibbonButton
          icon={ListFilter}
          label="Reference"
          shortcut="L / R"
          active={tool === "reference"}
          onClick={() => toolMode("reference", "reference")}
        />
        <span className="group-label">Calibration</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={Sparkles}
          label="Auto peaks"
          onClick={() => autoPeaks()}
          disabled={!active}
        />
        <RibbonButton
          icon={Activity}
          label="Manual peaks"
          shortcut="K"
          active={tool === "peak"}
          onClick={() => toolMode("peak", "peaks")}
        />
        <span className="group-label">Peak picking</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={BarChart3}
          label="Integrals"
          shortcut="I"
          active={tool === "integral"}
          onClick={() => toolMode("integral", "integral")}
        />
        <RibbonButton
          icon={Sparkles}
          label="Auto integrals"
          onClick={autoIntegrals}
          disabled={!active}
        />
        <span className="group-label">Integration</span>
      </div>
      <div className="ribbon-group">
        <RibbonButton
          icon={Waves}
          label="Multiplets"
          shortcut="J"
          active={tool === "multiplet"}
          onClick={() => toolMode("multiplet", "multiplet")}
        />
        <RibbonButton
          icon={Trash2}
          label="Clear analysis"
          onClick={() =>
            changeActive((s) => ({
              ...s,
              peaks: [],
              integrals: [],
              multiplets: [],
            }))
          }
        />
        <span className="group-label">Multiplet analysis</span>
      </div>
    </>
  );
  const visibleSpectra = spectra.filter((s) =>
    s.label.toLowerCase().includes(filter.toLowerCase()),
  );
  void historyVersion;
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void droppedFiles(e.dataTransfer)
          .then(openFiles)
          .catch((e) => notify(err(e)));
      }}
    >
      <input
        ref={fileInput}
        className="hidden-input"
        type="file"
        multiple
        accept=".zip,.csv,.tsv,.txt,.dx,.jdx,.jcamp,.webnmr,.fid,acqus,procs,1r,1i,fid"
        onChange={(e) => void openFiles(Array.from(e.target.files ?? []))}
      />
      <input
        ref={folderInput}
        className="hidden-input"
        type="file"
        multiple
        {...({
          webkitdirectory: "",
          directory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => void openFiles(Array.from(e.target.files ?? []))}
      />
      <input
        ref={projectInput}
        className="hidden-input"
        type="file"
        accept=".webnmr"
        onChange={(e) => void openFiles(Array.from(e.target.files ?? []))}
      />
      <header className="topbar">
        <div className="brand">
          <Waves size={25} />
          <strong>Web NMR</strong>
          <span className="brand-divider" />
        </div>
        <nav aria-label="Ribbon tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => enterTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="local-badge">
            <ShieldCheck size={13} />
            Local processing
          </span>
          <button
            className="icon-button light"
            title="Keyboard shortcuts & help"
            aria-label="Keyboard shortcuts and help"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      <div className="ribbon" inert={busy ? true : undefined}>
        <div className="ribbon-group file-group">
          <RibbonButton
            icon={FolderOpen}
            label="Open files"
            shortcut="⌘ O"
            onClick={() => fileInput.current?.click()}
          />
          <RibbonButton
            icon={Save}
            label="Save project"
            shortcut="⌘ S"
            onClick={() => {
              void saveProject();
            }}
          />
          <span className="group-label">Project</span>
        </div>
        {tab === "Processing" ? (
          processActions
        ) : tab === "Analysis" ? (
          analysisActions
        ) : tab === "Stack" ? (
          <>
            <div className="ribbon-group">
              <RibbonButton
                icon={Layers}
                label="Stacked"
                active={mode === "stack"}
                onClick={() => setMode("stack")}
              />
              <RibbonButton
                icon={Waves}
                label="Overlay"
                active={mode === "overlay"}
                onClick={() => setMode("overlay")}
              />
              <RibbonButton
                icon={FileText}
                label="Active only"
                active={mode === "single"}
                onClick={() => setMode("single")}
              />
              <span className="group-label">Display</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Maximize2}
                label="Normalize"
                active={normalization !== "none"}
                onClick={() =>
                  setNormalization((n) =>
                    n === "maximum" ? "none" : "maximum",
                  )
                }
              />
              <RibbonButton
                icon={Plus}
                label="Gain +"
                shortcut="+"
                onClick={() => gain(1.1)}
              />
              <RibbonButton
                icon={Minus}
                label="Gain −"
                shortcut="−"
                onClick={() => gain(1 / 1.1)}
              />
              <span className="group-label">Height</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton icon={Copy} label="Duplicate" onClick={duplicate} />
              <RibbonButton
                icon={ArrowUp}
                label="Move up"
                onClick={() => active && moveSpectrum(active.id, -1)}
              />
              <RibbonButton
                icon={ArrowDown}
                label="Move down"
                onClick={() => active && moveSpectrum(active.id, 1)}
              />
              <span className="group-label">Members</span>
            </div>
          </>
        ) : tab === "Kinetics" ? (
          <>
            <div className="ribbon-group">
              <RibbonButton
                icon={Layers}
                label="Show stack"
                onClick={() => enterTab("Stack")}
              />
              <RibbonButton
                icon={BarChart3}
                label="Measure region"
                onClick={() => {
                  setTool("integral");
                  setPanel("integral");
                  setTab("Analysis");
                  setKinPicking(true);
                  setInspectorOpen(false);
                  notify(
                    "Drag across the signal to measure it across the time series.",
                  );
                }}
              />
              <span className="group-label">Time series</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Activity}
                label="Fit curve"
                active={fitEnabled}
                onClick={() => setFitEnabled(true)}
              />
              <RibbonButton
                icon={Download}
                label="Export kinetics"
                onClick={() =>
                  exportKineticsCSV(kineticsPoints, fitResult.fit ?? undefined)
                }
              />
              <span className="group-label">Analysis</span>
            </div>
          </>
        ) : tab === "Export" ? (
          <>
            <div className="ribbon-group">
              <RibbonButton
                icon={FileImage}
                label="SVG figure"
                onClick={() => {
                  try {
                    exportFigureSVG(getFigure(), active?.label ?? "spectrum");
                  } catch (e) {
                    notify(err(e));
                  }
                }}
              />
              <RibbonButton
                icon={FileImage}
                label="PNG image"
                onClick={() => void png()}
              />
              <RibbonButton
                icon={FileText}
                label="Print / PDF"
                onClick={printFigure}
              />
              <span className="group-label">Figure</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Download}
                label="Spectrum CSV"
                onClick={() => active && exportSpectrumCSV(active)}
              />
              <RibbonButton
                icon={Download}
                label="JCAMP-DX"
                onClick={() => active && exportJCAMP(active)}
              />
              <RibbonButton
                icon={Save}
                label="Save project"
                onClick={() => void saveProject()}
              />
              <span className="group-label">Data</span>
            </div>
          </>
        ) : tab === "File" ? (
          <>
            <div className="ribbon-group">
              <RibbonButton
                icon={FolderOpen}
                label="Open folder"
                onClick={() => folderInput.current?.click()}
              />
              <RibbonButton
                icon={Upload}
                label="Open project"
                onClick={() => projectInput.current?.click()}
              />
              <RibbonButton
                icon={Waves}
                label="Example project"
                onClick={() => {
                  const d = createDemoSpectra();
                  setSpectra(d);
                  undoRef.current = [];
                  redoRef.current = [];
                  setHistoryVersion((n) => n + 1);
                  setActiveId(d[0].id);
                  setIsDemo(true);
                  setProjectName("Reaction monitoring");
                  setView([10, -0.5]);
                  setMode("single");
                  setReady(true);
                }}
              />
              <span className="group-label">Open</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Copy}
                label="Duplicate spectrum"
                onClick={duplicate}
              />
              <RibbonButton
                icon={Trash2}
                label="Remove spectrum"
                onClick={() => active && deleteSpectrum(active.id)}
              />
              <span className="group-label">Manage</span>
            </div>
          </>
        ) : (
          <>
            <div className="ribbon-group">
              <RibbonButton
                icon={MousePointer2}
                label="Select"
                active={tool === "select"}
                onClick={() => toolMode("select")}
              />
              <RibbonButton
                icon={ZoomIn}
                label="Zoom"
                shortcut="Z"
                active={tool === "zoom"}
                onClick={() => toolMode("zoom")}
              />
              <RibbonButton
                icon={Hand}
                label="Pan"
                shortcut="Space"
                active={tool === "pan"}
                onClick={() => toolMode("pan")}
              />
              <RibbonButton
                icon={Maximize2}
                label="Full spectrum"
                onClick={full}
              />
              <span className="group-label">Navigation</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Plus}
                label="Height +"
                onClick={() => gain(1.1)}
              />
              <RibbonButton
                icon={Minus}
                label="Height −"
                onClick={() => gain(1 / 1.1)}
              />
              <RibbonButton
                icon={RotateCcw}
                label="Fit height"
                onClick={() => setPlotGain(1)}
              />
              <span className="group-label">Display</span>
            </div>
          </>
        )}
        <div className="ribbon-end">
          <div>
            <button
              className="icon-button"
              title="Undo edit"
              aria-label="Undo edit"
              onClick={undo}
              disabled={!undoRef.current.length}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              title="Redo edit"
              aria-label="Redo edit"
              onClick={redo}
              disabled={!redoRef.current.length}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <span>Undo / redo</span>
        </div>
      </div>
      <div className="documentbar">
        <button
          className="icon-button"
          title="Toggle spectra navigator"
          aria-label="Toggle spectra navigator"
          onClick={() => setNavigatorOpen((v) => !v)}
        >
          <Layers size={16} />
        </button>
        <span className="document-tab">
          <FileText size={15} />
          <input
            value={projectName}
            aria-label="Project name"
            onChange={(e) => {
              setProjectName(e.target.value);
              setIsDemo(false);
            }}
          />
          {isDemo && <span className="demo-pill">DEMO</span>}
        </span>
        <div className="document-actions">
          <span>{spectra.length} spectra</span>
          <button
            className="icon-button"
            title="Toggle inspector"
            aria-label="Toggle inspector"
            onClick={() => setInspectorOpen((v) => !v)}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </div>
      <div className="workbench">
        {navigatorOpen && (
          <aside className="navigator" inert={busy ? true : undefined}>
            <div className="panel-header">
              <span>Spectra</span>
              <button
                className="icon-button"
                aria-label="Open files from navigator"
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={16} />
              </button>
            </div>
            <label className="search-field">
              <Search size={13} />
              <input
                placeholder="Find a spectrum…"
                aria-label="Find spectrum"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <div className="spectrum-list">
              {visibleSpectra.map((s, i) => (
                <div
                  key={s.id}
                  className={`spectrum-card ${s.id === active?.id ? "active" : ""} ${selected.includes(s.id) ? "multi-selected" : ""}`}
                >
                  <button
                    className="spectrum-select"
                    title="Click to activate; Ctrl/Cmd-click to select for batch processing"
                    onClick={(e) =>
                      selectSpectrum(s.id, e.ctrlKey || e.metaKey)
                    }
                  >
                    <div className="card-caption">
                      <span
                        className="trace-dot"
                        style={{ background: s.color }}
                      />
                      <span>
                        {i + 1}. {s.label}
                      </span>
                    </div>
                    <div className="thumbnail">
                      <MiniTrace spectrum={s} />
                    </div>
                    <div className="card-meta">
                      <span>{s.nucleus}</span>
                      <span>
                        {s.timeMinutes === undefined
                          ? s.sourceFormat
                          : `${s.timeMinutes} min`}
                      </span>
                    </div>
                  </button>
                  <div className="card-actions">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.label}`}
                      checked={selected.includes(s.id)}
                      onChange={() => selectSpectrum(s.id, true)}
                    />
                    <button
                      className="icon-button"
                      aria-label={`${s.visible ? "Hide" : "Show"} ${s.label}`}
                      onClick={() =>
                        setSpectra((a) =>
                          a.map((v) =>
                            v.id === s.id ? { ...v, visible: !v.visible } : v,
                          ),
                        )
                      }
                    >
                      {s.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${s.label}`}
                      onClick={() => deleteSpectrum(s.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="navigator-footer">
              <button
                className="secondary"
                onClick={() => folderInput.current?.click()}
              >
                <FolderOpen size={14} /> Open folder
              </button>
              <small>Bruker · ZIP · JCAMP · CSV</small>
            </div>
          </aside>
        )}
        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="breadcrumbs">
              <span>{isDemo ? "Example project" : projectName}</span>
              <ChevronRight size={12} />
              <strong>{active?.label ?? "No spectrum"}</strong>
            </div>
            <div className="view-options">
              <select
                aria-label="Spectrum component"
                value={component}
                onChange={(e) => {
                  const c = e.target.value as typeof component;
                  if (c === "fid" && !active?.fid) {
                    notify("This spectrum has no original FID.");
                    return;
                  }
                  if (c === "imag" && !active?.data.imag) {
                    notify("No imaginary component is available.");
                    return;
                  }
                  setComponent(c);
                }}
              >
                <option value="real">Real spectrum</option>
                <option value="imag">Imaginary</option>
                <option value="magnitude">Magnitude</option>
                <option value="fid">FID</option>
              </select>
              <button
                className={`icon-button ${grid ? "on" : ""}`}
                title="Toggle grid"
                aria-label="Toggle grid"
                onClick={() => setGrid((v) => !v)}
              >
                <GripVertical size={16} />
              </button>
            </div>
          </div>
          {isDemo && (
            <div className="demo-banner">
              <span>
                <Sparkles size={14} /> Explore a synthetic reaction series. Open
                your own data to begin.
              </span>
              <button onClick={() => fileInput.current?.click()}>
                Open NMR files <ArrowRight size={13} />
              </button>
            </div>
          )}
          {tab === "Kinetics" ? (
            <div className="kinetics-workspace">
              <div className="kinetics-heading">
                <div>
                  <span className="eyebrow">REACTION MONITORING</span>
                  <h1>Kinetics</h1>
                  <p>Measure the same signal across your time series.</p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    exportKineticsCSV(
                      kineticsPoints,
                      fitResult.fit ?? undefined,
                    )
                  }
                >
                  <Download size={15} />
                  Export data
                </button>
              </div>
              <div className="kinetics-controls">
                <NumberField
                  label="Region from (ppm)"
                  value={kinFrom}
                  onChange={(n) => {
                    setKinFrom(n);
                    setFitEnabled(false);
                  }}
                  step={0.01}
                />
                <NumberField
                  label="Region to (ppm)"
                  value={kinTo}
                  onChange={(n) => {
                    setKinTo(n);
                    setFitEnabled(false);
                  }}
                  step={0.01}
                />
                <Field label="Model">
                  <select
                    value={kinModel}
                    onChange={(e) =>
                      setKinModel(e.target.value as typeof kinModel)
                    }
                  >
                    <option value="decay">Exponential decay</option>
                    <option value="growth">Exponential growth</option>
                    <option value="linear">Linear</option>
                  </select>
                </Field>
                <button className="primary" onClick={() => setFitEnabled(true)}>
                  <Activity size={16} /> Fit curve
                </button>
              </div>
              <KineticsChart points={kineticsPoints} fit={fitResult.fit} />
              {fitResult.error && (
                <p className="inline-warning">{fitResult.error}</p>
              )}
              {fitResult.fit && (
                <div className="fit-stats">
                  <div>
                    <small>R²</small>
                    <strong>{fitResult.fit.rSquared.toFixed(5)}</strong>
                  </div>
                  <div>
                    <small>RMSE</small>
                    <strong>{fitResult.fit.rmse.toPrecision(4)}</strong>
                  </div>
                  {fitResult.fit.halfLife !== undefined && (
                    <div>
                      <small>Half-life</small>
                      <strong>
                        {fitResult.fit.halfLife.toFixed(2)} <span>min</span>
                      </strong>
                    </div>
                  )}
                  {Object.entries(fitResult.fit.parameters).map(
                    ([key, value]) => (
                      <div key={key}>
                        <small>{key}</small>
                        <strong>{value.toPrecision(4)}</strong>
                      </div>
                    ),
                  )}
                </div>
              )}
              <p className="kinetics-note">
                Uses signed integrals of the processed real spectrum. Display
                gain and stack normalization do not affect these values. A fit
                describes the trend; quantitative concentration requires
                acquisition calibration.
              </p>
              <div className="kinetics-table">
                <table>
                  <thead>
                    <tr>
                      <th>Include</th>
                      <th>Spectrum</th>
                      <th>Time (min)</th>
                      <th>Raw area</th>
                      <th>Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spectra.map((s) => {
                      const p = kineticsPoints.find((v) => v.id === s.id);
                      return (
                        <tr key={s.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Include ${s.label} in fit`}
                              checked={!excluded.includes(s.id)}
                              onChange={() =>
                                setExcluded((a) =>
                                  a.includes(s.id)
                                    ? a.filter((v) => v !== s.id)
                                    : [...a, s.id],
                                )
                              }
                            />
                          </td>
                          <td>{s.label}</td>
                          <td>
                            <input
                              type="number"
                              aria-label={`Time for ${s.label}`}
                              value={s.timeMinutes ?? ""}
                              placeholder="Set time"
                              step=".5"
                              onChange={(e) => {
                                const n = e.target.valueAsNumber;
                                setSpectra((a) =>
                                  a.map((v) =>
                                    v.id === s.id
                                      ? {
                                          ...v,
                                          timeMinutes: Number.isFinite(n)
                                            ? n
                                            : undefined,
                                        }
                                      : v,
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td>
                            {p ? p.value.toPrecision(6) : "Set time to measure"}
                          </td>
                          <td>
                            {fitResult.fit && p
                              ? fmt(
                                  fitResult.fit.residuals[
                                    kineticsPoints.indexOf(p)
                                  ],
                                  5,
                                )
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : active && displayedActive ? (
            <div className="page-stage">
              <div className="spectrum-page">
                <SpectrumPlot
                  spectra={plottedSpectra}
                  active={displayedActive}
                  view={view}
                  mode={mode}
                  normalization={normalization}
                  tool={tool}
                  gain={plotGain}
                  component={component}
                  grid={grid}
                  showPeaks={showPeaks}
                  showIntegrals={showIntegrals}
                  onRegion={region}
                  onPoint={point}
                  onCursor={setCursor}
                  onZoom={zoom}
                  onGain={gain}
                  onSelect={selectSpectrum}
                  onFit={full}
                  exportRef={svgExport}
                />
              </div>
              {preview && (
                <div className="preview-badge">
                  <Eye size={14} />
                  Processing preview{" "}
                  <button onClick={() => void process("apply")}>Apply</button>
                  <button onClick={cancelPreview}>Cancel</button>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-workspace">
              <Waves size={44} />
              <h1>Your NMR workspace</h1>
              <p>
                Open an experiment folder or ZIP to process and analyze a
                spectrum.
              </p>
              <button
                className="primary"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} />
                Open files
              </button>
              <button
                className="secondary"
                onClick={() => folderInput.current?.click()}
              >
                Open Bruker folder
              </button>
            </div>
          )}
          {tab !== "Kinetics" && (
            <div className={`results-panel ${!tableOpen ? "collapsed" : ""}`}>
              <div className="results-tabs">
                {(
                  [
                    "Peaks",
                    "Integrals",
                    "Multiplets",
                    "Spectra",
                    "Acquisition",
                    "History",
                  ] as Table[]
                ).map((t) => (
                  <button
                    key={t}
                    className={table === t ? "active" : ""}
                    onClick={() => {
                      setTable(t);
                      setTableOpen(true);
                    }}
                  >
                    {t}
                    {active &&
                      ["Peaks", "Integrals", "Multiplets"].includes(t) && (
                        <span>
                          {t === "Peaks"
                            ? active.peaks.length
                            : t === "Integrals"
                              ? active.integrals.length
                              : active.multiplets.length}
                        </span>
                      )}
                  </button>
                ))}
                <div className="results-tools">
                  {active &&
                    ["Peaks", "Integrals", "Multiplets"].includes(table) && (
                      <button
                        className="icon-button"
                        aria-label="Export current analysis table"
                        onClick={() =>
                          exportAnalysisCSV(
                            active,
                            table.toLowerCase() as
                              "peaks" | "integrals" | "multiplets",
                          )
                        }
                      >
                        <Download size={14} />
                      </button>
                    )}
                  <button
                    className="icon-button"
                    aria-label={
                      tableOpen
                        ? "Collapse results table"
                        : "Expand results table"
                    }
                    onClick={() => setTableOpen((v) => !v)}
                  >
                    {tableOpen ? <ChevronDown size={16} /> : <ChevronUpIcon />}
                  </button>
                </div>
              </div>
              {tableOpen && (
                <div className="results-body">
                  {active &&
                    (table === "Peaks" ? (
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>δ (ppm)</th>
                            <th>Height (a.u.)</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.peaks.map((p, i) => (
                            <tr key={p.id}>
                              <td>{i + 1}</td>
                              <td>
                                <button
                                  className="table-link"
                                  onClick={() =>
                                    zoom([p.ppm + 0.12, p.ppm - 0.12])
                                  }
                                >
                                  {p.ppm.toFixed(4)}
                                </button>
                              </td>
                              <td>{p.height.toPrecision(6)}</td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove peak ${i + 1}`}
                                  onClick={() =>
                                    changeActive((s) => ({
                                      ...s,
                                      peaks: s.peaks.filter(
                                        (a) => a.id !== p.id,
                                      ),
                                    }))
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : table === "Integrals" ? (
                      <table>
                        <thead>
                          <tr>
                            <th>Label</th>
                            <th>From (ppm)</th>
                            <th>To (ppm)</th>
                            <th>Raw area</th>
                            <th>Normalized</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {active.integrals.map((i) => (
                            <tr
                              key={i.id}
                              className={
                                i.id === selectedIntegral ? "selected-row" : ""
                              }
                              onClick={() => setSelectedIntegral(i.id)}
                            >
                              <td>
                                <input
                                  aria-label={`Integral label ${i.label}`}
                                  value={i.label}
                                  onChange={(e) =>
                                    changeActive((s) => ({
                                      ...s,
                                      integrals: s.integrals.map((a) =>
                                        a.id === i.id
                                          ? { ...a, label: e.target.value }
                                          : a,
                                      ),
                                    }))
                                  }
                                />
                              </td>
                              <td>{i.from.toFixed(3)}</td>
                              <td>{i.to.toFixed(3)}</td>
                              <td>{i.area.toPrecision(6)}</td>
                              <td className="normalized-value">
                                {(i.area * active.integralScale).toFixed(3)}
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove integral ${i.label}`}
                                  onClick={() =>
                                    changeActive((s) => ({
                                      ...s,
                                      integrals: s.integrals.filter(
                                        (a) => a.id !== i.id,
                                      ),
                                    }))
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : table === "Multiplets" ? (
                      <table>
                        <thead>
                          <tr>
                            <th>Label</th>
                            <th>Center (ppm)</th>
                            <th>Pattern</th>
                            <th>J (Hz)</th>
                            <th>Lines</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {active.multiplets.map((m) => (
                            <tr key={m.id}>
                              <td>{m.label}</td>
                              <td>{m.center.toFixed(4)}</td>
                              <td>
                                <select
                                  value={m.kind}
                                  aria-label={`Pattern ${m.label}`}
                                  onChange={(e) =>
                                    changeActive((s) => ({
                                      ...s,
                                      multiplets: s.multiplets.map((v) =>
                                        v.id === m.id
                                          ? { ...v, kind: e.target.value }
                                          : v,
                                      ),
                                    }))
                                  }
                                >
                                  {[
                                    "s",
                                    "d",
                                    "t",
                                    "q",
                                    "dd",
                                    "dt",
                                    "td",
                                    "m",
                                  ].map((k) => (
                                    <option key={k}>{k}</option>
                                  ))}
                                  {![
                                    "s",
                                    "d",
                                    "t",
                                    "q",
                                    "dd",
                                    "dt",
                                    "td",
                                    "m",
                                  ].includes(m.kind) && (
                                    <option>{m.kind}</option>
                                  )}
                                </select>
                              </td>
                              <td>
                                {m.couplingsHz
                                  .map((j) => j.toFixed(2))
                                  .join(", ") || "—"}
                              </td>
                              <td>{m.peakCount}</td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove multiplet ${m.label}`}
                                  onClick={() =>
                                    changeActive((s) => ({
                                      ...s,
                                      multiplets: s.multiplets.filter(
                                        (a) => a.id !== m.id,
                                      ),
                                    }))
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : table === "Spectra" ? (
                      <table>
                        <thead>
                          <tr>
                            <th>Show</th>
                            <th>Spectrum</th>
                            <th>Nucleus</th>
                            <th>Gain</th>
                            <th>Time (min)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spectra.map((s) => (
                            <tr
                              key={s.id}
                              className={
                                s.id === active.id ? "selected-row" : ""
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  checked={s.visible}
                                  aria-label={`Show ${s.label}`}
                                  onChange={(e) =>
                                    setSpectra((a) =>
                                      a.map((v) =>
                                        v.id === s.id
                                          ? { ...v, visible: e.target.checked }
                                          : v,
                                      ),
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  className="table-link"
                                  onClick={() => selectSpectrum(s.id)}
                                >
                                  {s.label}
                                </button>
                              </td>
                              <td>{s.nucleus}</td>
                              <td>{s.gain.toFixed(2)}×</td>
                              <td>{s.timeMinutes ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : table === "Acquisition" ? (
                      <table>
                        <tbody>
                          {Object.entries(active.metadata).map(([k, v]) => (
                            <tr key={k}>
                              <th>{k}</th>
                              <td>{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <ol className="history-list">
                        {active.history.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    ))}
                  {active &&
                    ((table === "Peaks" && !active.peaks.length) ||
                      (table === "Integrals" && !active.integrals.length) ||
                      (table === "Multiplets" &&
                        !active.multiplets.length)) && (
                      <div className="table-empty">
                        {table === "Peaks"
                          ? "Pick peaks automatically or use K to select a region."
                          : table === "Integrals"
                            ? "Press I, then drag across a signal to add an integral."
                            : "Press J, then drag around a group of peaks."}
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </main>
        {tab !== "Kinetics" && (
          <div className="tool-rail">
            {(
              [
                { t: "select", i: MousePointer2, key: "" },
                { t: "zoom", i: ZoomIn, key: "Z" },
                { t: "pan", i: Hand, key: "Space" },
                { t: "peak", i: Activity, key: "K" },
                { t: "integral", i: BarChart3, key: "I" },
                { t: "multiplet", i: Waves, key: "J" },
                { t: "reference", i: ListFilter, key: "R" },
              ] as { t: Tool; i: LucideIcon; key: string }[]
            ).map(({ t, i: Icon, key }) => (
              <button
                className={tool === t ? "active" : ""}
                key={t}
                aria-label={`${toolText[t]} tool`}
                title={`${toolText[t]} ${key && "(" + key + ")"}`}
                onClick={() =>
                  toolMode(
                    t,
                    t === "reference"
                      ? "reference"
                      : t === "peak"
                        ? "peaks"
                        : t === "integral"
                          ? "integral"
                          : t === "multiplet"
                            ? "multiplet"
                            : undefined,
                  )
                }
              >
                <Icon size={18} />
              </button>
            ))}
            <span />
            <button
              title="Full spectrum"
              aria-label="Full spectrum"
              onClick={full}
            >
              <Maximize2 size={17} />
            </button>
            <button
              title="Previous view · Shift Left"
              aria-label="Previous view"
              onClick={previousView}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              title="Increase height"
              aria-label="Increase height"
              onClick={() => gain(1.1)}
            >
              <Plus size={17} />
            </button>
            <button
              title="Decrease height"
              aria-label="Decrease height"
              onClick={() => gain(1 / 1.1)}
            >
              <Minus size={17} />
            </button>
          </div>
        )}
        {inspectorOpen && (
          <aside className="inspector" inert={busy ? true : undefined}>
            <div className="panel-header">
              <span>
                {panel === "overview"
                  ? "Spectrum"
                  : panel === "phase"
                    ? "Phase correction"
                    : panel === "apodization"
                      ? "Apodization & FT"
                      : panel === "baseline"
                        ? "Baseline correction"
                        : panel === "reference"
                          ? "Reference"
                          : panel === "peaks"
                            ? "Peak picking"
                            : panel === "integral"
                              ? "Integration"
                              : panel === "multiplet"
                                ? "Multiplet analysis"
                                : panel === "stack"
                                  ? "Stack display"
                                  : "Export"}
              </span>
              <button
                className="icon-button"
                aria-label="Close inspector"
                onClick={() => setInspectorOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="inspector-body">
              {active &&
                (panel === "overview" ? (
                  <>
                    <div className="inspector-summary">
                      <span
                        className="trace-dot"
                        style={{ background: active.color }}
                      />
                      <strong>{active.label}</strong>
                    </div>
                    <Field label="Spectrum name">
                      <input
                        value={active.label}
                        onChange={(e) =>
                          changeActive((s) => ({ ...s, label: e.target.value }))
                        }
                      />
                    </Field>
                    <div className="two-fields">
                      <Field label="Observed nucleus">
                        <input
                          value={active.nucleus}
                          onChange={(e) =>
                            changeActive((s) => ({
                              ...s,
                              nucleus: e.target.value,
                            }))
                          }
                        />
                      </Field>
                      <NumberField
                        label="Frequency (MHz)"
                        value={active.frequencyMHz}
                        min={0}
                        step={0.01}
                        onChange={(n) =>
                          changeActive((s) => ({
                            ...s,
                            frequencyMHz: Math.max(0, n),
                          }))
                        }
                      />
                    </div>
                    {active.frequencyMHz === 0 && (
                      <p className="inline-warning">
                        Enter the observed frequency to calculate J couplings.
                        The ppm axis is preserved.
                      </p>
                    )}
                    <div className="metadata-grid">
                      <div>
                        <small>Nucleus</small>
                        <b>{active.nucleus}</b>
                      </div>
                      <div>
                        <small>Frequency</small>
                        <b>{active.frequencyMHz.toFixed(2)} MHz</b>
                      </div>
                      <div>
                        <small>Points</small>
                        <b>{active.data.real.length.toLocaleString()}</b>
                      </div>
                      <div>
                        <small>Source</small>
                        <b>{active.sourceFormat}</b>
                      </div>
                    </div>
                    <div className="section-title">Display</div>
                    <Field label="View">
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as typeof mode)}
                      >
                        <option value="single">Active spectrum</option>
                        <option value="stack">Stacked spectra</option>
                        <option value="overlay">Overlaid spectra</option>
                      </select>
                    </Field>
                    <div className="two-fields">
                      <NumberField
                        label="Left (ppm)"
                        value={view[0]}
                        onChange={(n) => n > view[1] && zoom([n, view[1]])}
                      />
                      <NumberField
                        label="Right (ppm)"
                        value={view[1]}
                        onChange={(n) => n < view[0] && zoom([view[0], n])}
                      />
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={showPeaks}
                        onChange={(e) => setShowPeaks(e.target.checked)}
                      />
                      Peak labels
                    </label>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={showIntegrals}
                        onChange={(e) => setShowIntegrals(e.target.checked)}
                      />
                      Integral labels
                    </label>
                    <button className="secondary full-width" onClick={full}>
                      <Maximize2 size={14} />
                      Full spectrum
                    </button>
                    <div className="inspector-tip">
                      <MousePointer2 size={16} />
                      <p>
                        <b>Direct interaction</b>
                        <br />
                        Press Z to zoom, I to integrate, or J to analyze a
                        multiplet. Hold Space to pan.
                      </p>
                    </div>
                  </>
                ) : panel === "phase" ||
                  panel === "apodization" ||
                  panel === "baseline" ? (
                  <>
                    <Field label="Apply to">
                      <select
                        value={scope}
                        onChange={(e) =>
                          setScope(e.target.value as typeof scope)
                        }
                      >
                        <option value="active">Active spectrum</option>
                        <option value="selected">
                          Selected spectra ({selected.length})
                        </option>
                        <option value="all">
                          Entire stack ({spectra.length})
                        </option>
                      </select>
                    </Field>
                    {panel === "phase" ? (
                      <>
                        <p className="panel-description">
                          Adjust the phase to make peaks absorptive. Preview the
                          result, then apply.
                        </p>
                        {!active.data.imag && !active.fid && (
                          <p className="inline-warning">
                            Only a real spectrum is available. Import the
                            imaginary component or raw FID to correct phase.
                          </p>
                        )}
                        <NumberField
                          label="Zero order PH0 (°)"
                          value={draft.ph0}
                          onChange={(n) => setDraft((d) => ({ ...d, ph0: n }))}
                          step={1}
                        />
                        <input
                          aria-label="Zero order phase slider"
                          type="range"
                          min="-180"
                          max="180"
                          step=".5"
                          value={draft.ph0}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              ph0: Number(e.target.value),
                            }))
                          }
                        />
                        <NumberField
                          label="First order PH1 (°)"
                          value={draft.ph1}
                          onChange={(n) => setDraft((d) => ({ ...d, ph1: n }))}
                          step={1}
                        />
                        <input
                          aria-label="First order phase slider"
                          type="range"
                          min="-360"
                          max="360"
                          value={draft.ph1}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              ph1: Number(e.target.value),
                            }))
                          }
                        />
                        <NumberField
                          label="Pivot (ppm)"
                          value={draft.pivotPpm}
                          onChange={(n) => {
                            const x = (preview ?? active.data).x,
                              span = x[0] - x[x.length - 1] || 1;
                            setDraft((d) => ({
                              ...d,
                              pivotPpm: n,
                              ph0: d.ph0 - (d.ph1 * (n - d.pivotPpm)) / span,
                            }));
                          }}
                          step={0.01}
                        />
                        <button
                          className="secondary full-width"
                          disabled={
                            !!busy || (!active.data.imag && !active.fid)
                          }
                          onClick={autoPhase}
                        >
                          <Sparkles size={14} />
                          Find phase automatically
                        </button>
                      </>
                    ) : panel === "apodization" ? (
                      <>
                        <p className="panel-description">
                          Window the original FID before Fourier transform.
                          Changing the recipe always starts from the source.
                        </p>
                        {!active.fid && (
                          <p className="inline-warning">
                            No raw FID available. Open the experiment folder to
                            use apodization.
                          </p>
                        )}
                        <Field label="Window function">
                          <select
                            value={draft.window}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                window: e.target
                                  .value as ProcessingRecipe["window"],
                              }))
                            }
                          >
                            <option value="none">None</option>
                            <option value="exponential">Exponential</option>
                            <option value="gaussian">Gaussian</option>
                            <option value="sinebell">Sine bell</option>
                          </select>
                        </Field>
                        <NumberField
                          label="Line broadening (Hz)"
                          value={draft.lbHz}
                          min={0}
                          onChange={(n) =>
                            setDraft((d) => ({ ...d, lbHz: Math.max(0, n) }))
                          }
                          step={0.1}
                        />
                        {draft.window === "gaussian" && (
                          <NumberField
                            label="Gaussian width (Hz)"
                            value={draft.gaussianHz}
                            min={0}
                            onChange={(n) =>
                              setDraft((d) => ({
                                ...d,
                                gaussianHz: Math.max(0, n),
                              }))
                            }
                          />
                        )}
                        <Field label="Zero fill">
                          <select
                            value={draft.zeroFill}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                zeroFill: Number(e.target.value),
                              }))
                            }
                          >
                            {[1, 2, 4, 8].map((n) => (
                              <option key={n} value={n}>
                                {n}× points
                              </option>
                            ))}
                          </select>
                        </Field>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={draft.digitalFilter}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                digitalFilter: e.target.checked,
                              }))
                            }
                          />
                          Correct Bruker group delay
                        </label>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={draft.transform}
                            disabled={!active.fid}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                transform: e.target.checked,
                              }))
                            }
                          />
                          Transform raw FID
                        </label>
                      </>
                    ) : (
                      <>
                        <p className="panel-description">
                          Automatic correction estimates a smooth baseline.
                          Manual correction interpolates between points you
                          click.
                        </p>
                        <Field label="Method">
                          <select
                            value={draft.baseline}
                            onChange={(e) => {
                              const b = e.target
                                .value as ProcessingRecipe["baseline"];
                              setDraft((d) => ({ ...d, baseline: b }));
                              if (b === "manual") manualBaseline();
                            }}
                          >
                            <option value="none">None</option>
                            <option value="auto">
                              Automatic smooth baseline
                            </option>
                            <option value="manual">Manual anchor points</option>
                          </select>
                        </Field>
                        {draft.baseline === "manual" && (
                          <>
                            <button
                              className="secondary full-width"
                              onClick={manualBaseline}
                            >
                              <MousePointer2 size={14} />
                              Place baseline points
                            </button>
                            <p className="muted-small">
                              {draft.baselineAnchors.length} anchors · at least
                              2 recommended
                            </p>
                            <button
                              className="text-button"
                              onClick={() =>
                                setDraft((d) => ({ ...d, baselineAnchors: [] }))
                              }
                            >
                              Clear anchors
                            </button>
                          </>
                        )}
                      </>
                    )}
                    <div className="processing-buttons">
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => void process("preview")}
                      >
                        <Eye size={14} />
                        Preview
                      </button>
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() => void process("apply")}
                      >
                        <Check size={14} />
                        Apply
                      </button>
                    </div>
                    <button
                      className="text-button full-width"
                      onClick={cancelPreview}
                    >
                      Cancel / restore current result
                    </button>
                  </>
                ) : panel === "reference" ? (
                  <>
                    <p className="panel-description">
                      Click the reference signal on the spectrum, then enter its
                      known chemical shift.
                    </p>
                    <NumberField
                      label="Observed position (ppm)"
                      value={clickedPpm}
                      onChange={setClickedPpm}
                      step={0.0001}
                    />
                    <NumberField
                      label="Reference position (ppm)"
                      value={targetPpm}
                      onChange={setTargetPpm}
                      step={0.0001}
                    />
                    <Field label="Common reference">
                      <select
                        value=""
                        onChange={(e) => setTargetPpm(Number(e.target.value))}
                      >
                        <option value="" disabled>
                          Choose a signal…
                        </option>
                        <option value="0">TMS / DSS · 0.00 ppm</option>
                        <option value="7.26">CDCl₃ · ¹H 7.26 ppm</option>
                        <option value="2.5">DMSO-d₆ · ¹H 2.50 ppm</option>
                        <option value="3.31">CD₃OD · ¹H 3.31 ppm</option>
                        <option value="77.16">CDCl₃ · ¹³C 77.16 ppm</option>
                        <option value="39.52">DMSO-d₆ · ¹³C 39.52 ppm</option>
                      </select>
                    </Field>
                    <button className="primary full-width" onClick={reference}>
                      <Check size={14} />
                      Apply reference
                    </button>
                    <p className="muted-small">
                      Current offset: {active.referenceOffset.toFixed(4)} ppm.
                      Peak and region positions move with the spectrum.
                    </p>
                  </>
                ) : panel === "peaks" ? (
                  <>
                    <p className="panel-description">
                      Auto pick the spectrum, or press K and drag across a
                      region. Ctrl/Cmd+K selects peak-by-peak mode.
                    </p>
                    <NumberField
                      label="Threshold (% of maximum)"
                      value={threshold}
                      min={0.01}
                      max={100}
                      onChange={(n) =>
                        setThreshold(Math.max(0.01, Math.min(100, n)))
                      }
                    />
                    <input
                      aria-label="Peak threshold slider"
                      type="range"
                      min=".1"
                      max="30"
                      step=".1"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                    />
                    <NumberField
                      label="Minimum spacing (ppm)"
                      value={minDistance}
                      min={0}
                      step={0.001}
                      onChange={(n) => setMinDistance(Math.max(0, n))}
                    />
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={negative}
                        onChange={(e) => setNegative(e.target.checked)}
                      />
                      Include negative peaks
                    </label>
                    <button
                      className="primary full-width"
                      onClick={() => autoPeaks()}
                    >
                      <Sparkles size={14} />
                      Pick peaks automatically
                    </button>
                    <button
                      className="secondary full-width"
                      onClick={() => toolMode("peak", "peaks")}
                    >
                      Pick peaks manually
                    </button>
                  </>
                ) : panel === "integral" || panel === "multiplet" ? (
                  <>
                    <p className="panel-description">
                      {panel === "integral"
                        ? "Drag across a signal to integrate it, or enter exact region limits."
                        : "Drag around a multiplet for a basic first-order pattern and J estimate."}
                    </p>
                    <div className="two-fields">
                      <NumberField
                        label="From (ppm)"
                        value={regionFrom}
                        onChange={setRegionFrom}
                        step={0.01}
                      />
                      <NumberField
                        label="To (ppm)"
                        value={regionTo}
                        onChange={setRegionTo}
                        step={0.01}
                      />
                    </div>
                    <button
                      className="primary full-width"
                      onClick={() =>
                        panel === "integral" ? addIntegral() : addMultiplet()
                      }
                    >
                      <Plus size={14} />
                      Add {panel === "integral" ? "integral" : "multiplet"}
                    </button>
                    {panel === "integral" ? (
                      <>
                        <div className="section-title">Normalize integrals</div>
                        <Field label="Reference integral">
                          <select
                            value={selectedIntegral}
                            onChange={(e) =>
                              setSelectedIntegral(e.target.value)
                            }
                          >
                            {active.integrals.length === 0 && (
                              <option value="">Create an integral first</option>
                            )}
                            {active.integrals.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.label} · {i.from.toFixed(2)}–
                                {i.to.toFixed(2)} ppm
                              </option>
                            ))}
                          </select>
                        </Field>
                        <NumberField
                          label="Set this integral to"
                          value={normalValue}
                          min={0}
                          step={0.5}
                          onChange={setNormalValue}
                        />
                        <button
                          className="secondary full-width"
                          onClick={normalizeIntegral}
                        >
                          Normalize
                        </button>
                        <p className="muted-small">
                          Raw signed areas are preserved. Normalized values are
                          for reporting.
                        </p>
                      </>
                    ) : (
                      <p className="inline-warning">
                        Inspect overlap and second-order signals manually. A
                        spacing estimate alone does not establish a spin system.
                      </p>
                    )}
                  </>
                ) : panel === "stack" ? (
                  <>
                    <Field label="Display mode">
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as typeof mode)}
                      >
                        <option value="stack">Stacked</option>
                        <option value="overlay">Overlay</option>
                        <option value="single">Active only</option>
                      </select>
                    </Field>
                    <Field label="Auto normalization">
                      <select
                        value={normalization}
                        onChange={(e) =>
                          setNormalization(
                            e.target.value as typeof normalization,
                          )
                        }
                      >
                        <option value="none">Common intensity scale</option>
                        <option value="maximum">Equal maximum height</option>
                        <option value="area">Equal absolute area</option>
                      </select>
                    </Field>
                    <div className="section-title">Active trace</div>
                    <Field label="Name">
                      <input
                        value={active.label}
                        onChange={(e) =>
                          changeActive((s) => ({ ...s, label: e.target.value }))
                        }
                      />
                    </Field>
                    <NumberField
                      label="Individual display gain"
                      value={active.gain}
                      min={0.01}
                      max={100}
                      step={0.1}
                      onChange={(n) =>
                        setSpectra((a) =>
                          a.map((s) =>
                            s.id === active.id
                              ? { ...s, gain: Math.max(0.01, Math.min(100, n)) }
                              : s,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label="Individual trace gain"
                      type="range"
                      min=".1"
                      max="5"
                      step=".1"
                      value={active.gain}
                      onChange={(e) =>
                        setSpectra((a) =>
                          a.map((s) =>
                            s.id === active.id
                              ? { ...s, gain: Number(e.target.value) }
                              : s,
                          ),
                        )
                      }
                    />
                    <Field label="Trace color">
                      <input
                        type="color"
                        aria-label="Trace color"
                        value={active.color}
                        onChange={(e) =>
                          setSpectra((a) =>
                            a.map((s) =>
                              s.id === active.id
                                ? { ...s, color: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                    </Field>
                    <div className="processing-buttons">
                      <button className="secondary" onClick={() => gain(2)}>
                        ×2
                      </button>
                      <button className="secondary" onClick={() => gain(0.5)}>
                        ÷2
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          setSpectra((a) =>
                            a.map((s) =>
                              s.id === active.id ? { ...s, gain: 1 } : s,
                            ),
                          )
                        }
                      >
                        Reset
                      </button>
                    </div>
                    <div className="inspector-tip">
                      <ShieldCheck size={17} />
                      <p>
                        Gain and normalization change the drawing. Integral
                        areas and kinetic measurements use the original
                        processed amplitudes.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="panel-description">
                      Figure exports use the current view. Data exports contain
                      every point.
                    </p>
                    <button
                      className="primary full-width"
                      onClick={() => exportFigureSVG(getFigure(), active.label)}
                    >
                      <FileImage size={15} />
                      SVG figure
                    </button>
                    <button
                      className="secondary full-width"
                      onClick={() => void png()}
                    >
                      <FileImage size={15} />
                      PNG image · 2× resolution
                    </button>
                    <button
                      className="secondary full-width"
                      onClick={printFigure}
                    >
                      <FileText size={15} />
                      Print / Save PDF
                    </button>
                    <div className="section-title">Numerical data</div>
                    <button
                      className="secondary full-width"
                      onClick={() => exportSpectrumCSV(active)}
                    >
                      <Download size={14} />
                      Full spectrum CSV
                    </button>
                    <button
                      className="secondary full-width"
                      onClick={() => exportJCAMP(active)}
                    >
                      <Download size={14} />
                      JCAMP-DX
                    </button>
                    <button
                      className="secondary full-width"
                      onClick={() => void saveProject()}
                    >
                      <Save size={14} />
                      Portable project (.webnmr)
                    </button>
                    <p className="muted-small">
                      Projects preserve source arrays, processing settings, and
                      analysis. Files stay in your browser.
                    </p>
                  </>
                ))}
            </div>
            <div className="inspector-bottom">
              <span
                className="trace-dot"
                style={{ background: active?.color ?? "#888" }}
              />
              {active?.nucleus ?? "—"}
              <span>{toolText[tool]}</span>
            </div>
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <span className="status-left">
          <span className="status-dot" />
          {busy || saveState}
        </span>
        <span>
          {active?.nucleus}{" "}
          {cursor !== null && component !== "fid"
            ? ` · δ ${cursor.toFixed(4)} ppm`
            : ""}
        </span>
        <span>
          {active?.data.real.length.toLocaleString()} points
          <span className="status-divider">|</span>
          {scope === "active"
            ? "Active spectrum"
            : scope === "selected"
              ? `${selected.length} selected`
              : "Entire stack"}
          <span className="status-divider">|</span>
          {selected.length > 0
            ? `${selected.length} selected`
            : "Local · no uploads"}
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
          {busy !== "Saving project…" && (
            <button
              className="icon-button"
              aria-label="Cancel processing"
              onClick={cancelPreview}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <Upload size={40} />
          <strong>Drop NMR files here</strong>
          <span>Bruker ZIP · JCAMP-DX · CSV · Web NMR project</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Import report"
          >
            <div className="modal-title">
              <h2>Import report</h2>
              <button
                className="icon-button"
                aria-label="Close import report"
                onClick={() => setWarnings([])}
              >
                <X size={18} />
              </button>
            </div>
            <ul className="warning-list">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>
              Supported here: Bruker 1D, supported JCAMP-DX, CSV and TSV. True
              2D processing is a later extension.
            </p>
            <button className="primary" onClick={() => setWarnings([])}>
              Continue
            </button>
          </div>
        </div>
      )}
      {recovery && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Recover workspace"
          >
            <div className="modal-title">
              <h2>Resume your workspace?</h2>
            </div>
            <p>
              <b>{recovery.name}</b> · {recovery.spectra.length} spectra
              <br />
              Last saved {new Date(recovery.savedAt).toLocaleString()}
            </p>
            <div className="processing-buttons">
              <button className="primary" onClick={() => restore(recovery)}>
                Recover workspace
              </button>
              <button
                className="secondary"
                onClick={() => {
                  void clearRecovery();
                  setRecovery(null);
                  setReady(true);
                }}
              >
                Start with example
              </button>
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">
              <div>
                <span className="eyebrow">QUICK REFERENCE</span>
                <h2>Familiar tools, familiar keys</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close help"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="shortcuts-grid">
              {[
                ["Z", "Horizontal zoom"],
                ["Space + drag", "Pan spectrum"],
                ["I", "Manual integration"],
                ["J", "Manual multiplet"],
                ["K", "Peak picking in a region"],
                ["⌘ / Ctrl + K", "Peak by peak"],
                ["L / R", "Reference signal"],
                ["Shift + P", "Manual phase correction"],
                ["Shift + I", "Integral manager"],
                ["Shift + J", "Multiplet manager"],
                ["+ / −", "Increase / decrease height"],
                ["Shift + ← / →", "Previous / next zoom"],
                ["Alt + ← / →", "Pan by a fixed amount"],
                ["⌘ / Ctrl + O", "Open files"],
                ["⌘ / Ctrl + S", "Save project"],
                ["⌘ / Ctrl + Z", "Undo"],
                ["⌘ / Ctrl + Y", "Redo"],
                ["Esc", "Cancel preview / select"],
              ].map(([key, label]) => (
                <div key={key}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <p className="muted-small">
              Core mappings follow Mnova 17. This version supports horizontal
              zoom; Mnova's alternate zoom modes and two-click graphic reference
              are simplified. Shortcuts pause while you type.
            </p>
            <div className="section-title">Bring your data</div>
            <p>
              Use <b>Open folder</b> for a complete Bruker experiment, or ZIP it
              and use <b>Open files</b>. Processed data are preferred when
              available. CSV needs two numeric columns (ppm, intensity); JCAMP
              supports the defined 1D profile. Native Mnova projects and raw 2D
              experiments are not read here.
            </p>
            <a
              href="https://mestrelab.com/downloads/mnova/manuals/latest/shortcuts.html"
              target="_blank"
              rel="noreferrer"
            >
              Mnova documentation ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
function ChevronUpIcon() {
  return <ChevronLeft size={16} style={{ transform: "rotate(90deg)" }} />;
}
