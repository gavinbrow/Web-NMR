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
  autoPhaseAsync,
  processBaselineAsync,
} from "./core/workerClient";
import {
  detectPeaks,
  integrate,
  analyzeMultiplet,
  autoMultiplets,
} from "./core/numerics";
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
import {
  fitKinetics,
  measureKinetics,
  kineticsPoints as measuredPoints,
} from "./features/kinetics";
import {
  defaultProperties,
  type SpectrumProperties,
} from "./features/appearance";
import {
  shiftSpectrum,
  strongestPosition,
  sharedIntegral,
} from "./features/stacks";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { BaselineDialog } from "./components/BaselineDialog";
import type { SpectrumStack } from "./model";
import { SpectrumPlot, dataStats } from "./components/SpectrumPlot";
import {
  displayedIntegralValue,
  normalizeIntegral as calibrateIntegral,
  recalibrateIntegrals,
  autodetectIntegralCounts,
} from "./features/integrals";
import { IntegralDialog } from "./components/IntegralDialog";
import { visibleGrid, contourPath } from "./features/contours";
import { TwoDPlot } from "./components/TwoDPlot";
import { KineticsChart } from "./components/KineticsChart";

type WorkspaceSnapshot = {
  spectra: Spectrum[];
  stacks: SpectrumStack[];
  activeId: string;
  activeStackId: string | null;
  mode: Project["displayMode"];
};
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
function MiniTwoD({ spectrum: s }: { spectrum: Spectrum }) {
  const paths = useMemo(() => {
    const m = s.twoD!,
      g = visibleGrid(m, [m.x[0], m.x.at(-1)!], [m.y[0], m.y.at(-1)!], 65);
    let max = 0;
    for (const value of m.real) max = Math.max(max, Math.abs(value));
    const xp = (x: number) => 2 + ((m.x[0] - x) / (m.x[0] - m.x.at(-1)!)) * 146,
      yp = (y: number) => 2 + ((m.y[0] - y) / (m.y[0] - m.y.at(-1)!)) * 44;
    return [
      contourPath(g, max * 0.025, xp, yp),
      contourPath(g, -max * 0.025, xp, yp),
    ];
  }, [s.twoD]);
  return (
    <svg viewBox="0 0 150 48" aria-hidden="true">
      <path d={paths[0]} stroke={s.color} fill="none" strokeWidth=".5" />
      <path d={paths[1]} stroke="#287cb2" fill="none" strokeWidth=".5" />
    </svg>
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
  const [stacks, setStacks] = useState<SpectrumStack[]>([]),
    [activeStackId, setActiveStackId] = useState<string | null>(null),
    [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [properties, setProperties] = useState(defaultProperties),
    [propertiesOpen, setPropertiesOpen] = useState(false),
    [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      integralId?: string;
      spectrumId?: string;
    } | null>(null);
  const [integralEdit, setIntegralEdit] = useState<{
    spectrumId: string;
    integralId: string;
  } | null>(null);
  const [baselineOpen, setBaselineOpen] = useState(false),
    [baselineSource, setBaselineSource] = useState<Spectrum["data"] | null>(
      null,
    ),
    [baselineCurve, setBaselineCurve] = useState<Spectrum["data"] | null>(null),
    [baselineLoading, setBaselineLoading] = useState(false),
    [baselineError, setBaselineError] = useState("");
  const [navigatorWidth, setNavigatorWidth] = useState(184),
    [inspectorWidth, setInspectorWidth] = useState(280),
    [resultsHeight, setResultsHeight] = useState(198),
    [ribbonHeight, setRibbonHeight] = useState(99);
  const [alignFrom, setAlignFrom] = useState(4.24),
    [alignTo, setAlignTo] = useState(4),
    [alignTarget, setAlignTarget] = useState(4.12),
    [shiftValue, setShiftValue] = useState(0),
    [handAlign, setHandAlign] = useState(false),
    [massIntegral, setMassIntegral] = useState(true);
  const [kinMode, setKinMode] = useState<"area" | "ratio" | "concentration">(
      "area",
    ),
    [stdFrom, setStdFrom] = useState(2.15),
    [stdTo, setStdTo] = useState(2),
    [targetProtons, setTargetProtons] = useState(1),
    [stdProtons, setStdProtons] = useState(1),
    [stdConcentration, setStdConcentration] = useState(1),
    [concentrationUnit, setConcentrationUnit] = useState("mM");
  const selectionAnchor = useRef<string>("");
  const baselineJob = useRef(0);
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
    [navigatorOpen, setNavigatorOpen] = useState(() => window.innerWidth > 620),
    [inspectorOpen, setInspectorOpen] = useState(false),
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
    [minDistance, setMinDistance] = useState(0),
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
  const undoRef = useRef<WorkspaceSnapshot[]>([]),
    redoRef = useRef<WorkspaceSnapshot[]>([]),
    [historyVersion, setHistoryVersion] = useState(0);
  const viewHistory = useRef<[number, number][]>([]),
    viewForward = useRef<[number, number][]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    svgExport = useRef<(() => string) | null>(null),
    twoDFull = useRef<(() => void) | null>(null),
    job = useRef(0),
    navigatorList = useRef<HTMLDivElement>(null);
  const active = spectra.find((s) => s.id === activeId) ?? spectra[0];
  const activeStack = stacks.find((s) => s.id === activeStackId);
  const stackMembers = activeStack
    ? activeStack.spectrumIds
        .map((id) => spectra.find((s) => s.id === id))
        .filter((s): s is Spectrum => !!s)
    : [];
  const activeProperties = useMemo(
    () => ({ ...properties, ...active?.properties }),
    [properties, active?.properties],
  );
  const displayedActive = useMemo(
    () =>
      active
        ? {
            ...active,
            data:
              baselineOpen && baselineSource
                ? baselineSource
                : (preview ?? active.data),
            recipe:
              preview || baselineOpen || tool === "baseline"
                ? draft
                : active.recipe,
          }
        : undefined,
    [active, preview, tool, draft, baselineOpen, baselineSource],
  );
  const plottedSpectra = useMemo(
    () =>
      (activeStack ? stackMembers : spectra).map((s) =>
        s.id === active?.id ? displayedActive! : s,
      ),
    [spectra, active?.id, displayedActive, activeStack],
  );
  const project = (): Project => ({
    version: 1,
    stacks,
    activeStackId,
    properties,
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
    stacks,
    activeStackId,
    properties,
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
      setSelectedIntegral((id) =>
        active.integrals.some((i) => i.id === id)
          ? id
          : (active.integrals[0]?.id ?? ""),
      );
    }
    setComponent("real");
  }, [activeId, active?.revision]);
  function snapshot(): WorkspaceSnapshot {
    return { spectra, stacks, activeId, activeStackId, mode };
  }
  function applySnapshot(v: WorkspaceSnapshot) {
    setSpectra(v.spectra);
    setStacks(v.stacks);
    setActiveId(v.activeId);
    setActiveStackId(v.activeStackId);
    setSelectedStackId(v.activeStackId);
    setMode(v.mode);
    setPreview(null);
    setBaselineOpen(false);
    setSelected([]);
    setFitEnabled(false);
  }
  function commit(next: Spectrum[], nextStacks = stacks) {
    undoRef.current.push(snapshot());
    if (undoRef.current.length > 25) undoRef.current.shift();
    redoRef.current = [];
    setHistoryVersion((n) => n + 1);
    setSpectra(next);
    setStacks(nextStacks);
  }
  function changeActive(fn: (s: Spectrum) => Spectrum) {
    if (!active || busy) return;
    commit(spectra.map((s) => (s.id === active.id ? fn(s) : s)));
  }
  function undo() {
    if (busy) return;
    const previous = undoRef.current.pop();
    if (previous) {
      redoRef.current.push(snapshot());
      applySnapshot(previous);
      setPreview(null);
      setHistoryVersion((n) => n + 1);
      notify("Edit undone");
    }
  }
  function redo() {
    if (busy) return;
    const next = redoRef.current.pop();
    if (next) {
      undoRef.current.push(snapshot());
      applySnapshot(next);
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
    if (active?.twoD) {
      twoDFull.current?.();
      return;
    }
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
  function selectSpectrum(
    id: string,
    multi = false,
    range = false,
    preserveStack = false,
  ) {
    if (busy) return;
    if (!preserveStack) {
      setActiveStackId(null);
      setSelectedStackId(null);
      setMode("single");
    }
    setBaselineOpen(false);
    baselineJob.current++;
    if (range) {
      const ids = spectra
        .filter((s) => s.label.toLowerCase().includes(filter.toLowerCase()))
        .map((s) => s.id);
      const a = ids.indexOf(selectionAnchor.current || activeId),
        b = ids.indexOf(id);
      setSelected(a < 0 ? [id] : ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (multi)
      setSelected((a) =>
        a.includes(id) ? a.filter((v) => v !== id) : [...a, id],
      );
    else {
      setSelected([id]);
      selectionAnchor.current = id;
    }
    const next = spectra.find((s) => s.id === id);
    if (
      next &&
      active &&
      (next.nucleus !== active.nucleus || !!next.twoD !== !!active.twoD)
    ) {
      setView(extent(next.data, next.referenceOffset));
      setPlotGain(1);
    }
    setActiveId(id);
    setPreview(null);
  }
  function toolMode(t: Tool, p?: Panel) {
    if (busy) return;
    if (active?.twoD && !["select", "zoom", "pan"].includes(t)) {
      notify("Choose a 1D spectrum for this analysis tool.");
      return;
    }
    setTool(t);
    if (p) {
      setPanel(p);
    }
    if (t === "integral") setTable("Integrals");
    if (t === "multiplet") setTable("Multiplets");
    if (t === "peak") setTable("Peaks");
  }
  function restore(p: Project) {
    setSpectra(p.spectra);
    setStacks(p.stacks ?? []);
    setActiveStackId(p.activeStackId ?? null);
    setSelectedStackId(p.activeStackId ?? null);
    setProperties({ ...defaultProperties(), ...p.properties });
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
          "No supported spectra found. Open the experiment folder or a ZIP.",
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
      setActiveStackId(null);
      setSelectedStackId(null);
      setSelected([first.id]);
      if (isDemo) setStacks([]);
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
    if (!active || busy || active.twoD) return;
    const targets =
      kind === "preview"
        ? [active]
        : scope === "all"
          ? activeStack
            ? stackMembers
            : spectra
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
      for (const s of targets.filter((s) => !s.twoD)) {
        const updated = {
          ...s,
          recipe: { ...recipe, baselineAnchors: [...recipe.baselineAnchors] },
        };
        const processed = await processBaselineAsync(updated);
        const data = processed.data;

        if (ticket !== job.current) return;
        if (kind === "preview") {
          setPreview(data);
          notify("Preview ready. Apply to keep these changes.");
        } else {
          results.set(
            s.id,
            recalibrateIntegrals(
              {
                ...updated,
                data,
                peaks: [],
                multiplets: [],
                history: [
                  ...s.history,
                  `${new Date().toLocaleTimeString()} · Processing: ${recipe.transform ? "FT · " : ""}phase ${recipe.ph0.toFixed(1)}°/${recipe.ph1.toFixed(1)}° · baseline ${recipe.baseline}${recipe.baseline !== "none" ? " / " + (recipe.baseline === "manual" ? recipe.manualBaselineMethod : recipe.baselineMethod) : ""}${processed.effectivePhase ? ` · joint phase ${processed.effectivePhase.ph0.toFixed(1)}°/${processed.effectivePhase.ph1.toFixed(1)}°` : ""}`,
                ],
                revision: s.revision + 1,
              },
              s.integrals.map((i) => ({
                ...i,
                area: integrate(data, s.referenceOffset, i.from, i.to),
              })),
            ),
          );
        }
      }
      if (kind === "apply") {
        commit(spectra.map((s) => results.get(s.id) ?? s));
        setDraft(recipe);
        setPreview(null);
        setTool("select");
        setBaselineOpen(false);
        baselineJob.current++;
        setBaselineCurve(null);
        setBaselineSource(null);
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
    setBaselineOpen(false);
    baselineJob.current++;
    setBaselineCurve(null);
    setBaselineSource(null);
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
    if (!active || busy || active.twoD) return;
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
  function openBaseline(manual = false) {
    if (!active || busy || active.twoD) return;
    setTab("Processing");
    setPanel("baseline");
    setComponent("real");
    setPreview(null);
    setDraft({
      ...active.recipe,
      baseline: manual ? "manual" : "auto",
      baselineMethod: active.recipe.baselineMethod ?? "bernstein",
      baselineAnchors: [...active.recipe.baselineAnchors],
    });
    setTool(manual ? "baseline" : "select");
    setInspectorOpen(false);
    setBaselineCurve(null);
    setBaselineSource(null);
    setBaselineOpen(true);
    setBaselineError("");
  }
  function manualBaseline() {
    openBaseline(true);
  }
  useEffect(() => {
    if (!baselineOpen || !active) return;
    const ticket = ++baselineJob.current;
    setBaselineLoading(true);
    const timer = setTimeout(() => {
      const recipe =
        draft.baseline === "manual" && draft.baselineAnchors.length < 2
          ? { ...draft, baseline: "none" as const }
          : draft;
      void processBaselineAsync({ ...active, recipe })
        .then((result) => {
          if (ticket !== baselineJob.current) return;
          setBaselineSource(result.source);
          setBaselineCurve(result.baseline);
          setBaselineError("");
          setBaselineLoading(false);
        })
        .catch((e) => {
          if (ticket !== baselineJob.current) return;
          setBaselineError(err(e));
          setBaselineLoading(false);
        });
    }, 160);
    return () => {
      clearTimeout(timer);
      baselineJob.current++;
    };
  }, [baselineOpen, draft, active]);
  function autoPeaks(from?: number, to?: number) {
    if (!active || busy || active.twoD) return;
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
    notify(`${peaks.length} lines picked`);
  }
  function addIntegral(from = regionFrom, to = regionTo) {
    if (!active || busy || active.twoD) return;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      notify("Choose a region with two different limits.");
      return;
    }
    if (activeStack && massIntegral) {
      try {
        const id = uid(),
          label = `I${active.integrals.length + 1}`;
        const updates = new Map(
          stackMembers.map((s) => [
            s.id,
            sharedIntegral(s, from, to, id, label),
          ]),
        );
        commit(spectra.map((s) => updates.get(s.id) ?? s));
        setSelectedIntegral(id);
        setKinFrom(Math.max(from, to));
        setKinTo(Math.min(from, to));
        setFitEnabled(false);
        setTable("Integrals");
        notify(`Shared integral added to ${updates.size} stack members`);
      } catch (e) {
        notify(err(e));
      }
      return;
    }
    const limits = extent(active.data, active.referenceOffset);
    if (Math.min(from, to) < limits[1] || Math.max(from, to) > limits[0]) {
      notify("Integral limits must be inside the spectrum.");
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
    notify("Integral added · click or right-click its label to edit");
  }
  function addMultiplet(from = regionFrom, to = regionTo) {
    if (!active || busy || active.twoD) return;
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
          (active.data.x.length *
            Math.min(0.002, (view[0] - view[1]) * 0.005)) /
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
      ...shiftSpectrum(s, delta),
      history: [
        ...s.history,
        `Reference · ${fmt(clickedPpm)} → ${fmt(targetPpm)} ppm`,
      ],
    }));
    zoom([view[0] + delta, view[1] + delta]);
    notify(`Reference shifted by ${delta.toFixed(4)} ppm`);
  }
  function autoIntegrals() {
    if (!active || busy || active.twoD) return;
    const regions = autoMultiplets(active).map(({ from, to }) => ({
      from,
      to,
    }));
    changeActive((s) =>
      recalibrateIntegrals(
        s,
        regions.map((r, i) => ({
          ...r,
          id: uid(),
          label: `I${i + 1}`,
          area: integrate(s.data, s.referenceOffset, r.from, r.to),
        })),
      ),
    );
    setTable("Integrals");
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
    changeActive((s) => calibrateIntegral(s, i.id, normalValue));
    notify("Integral reporting scale updated");
  }
  function selectPlotIntegral(spectrumId: string, integralId: string) {
    if (busy) return;
    setActiveId(spectrumId);
    setSelectedIntegral(integralId);
    setSelected([]);
    setSelectedStackId(null);
  }
  function editPlotIntegral(spectrumId: string, integralId: string) {
    selectPlotIntegral(spectrumId, integralId);
    setIntegralEdit({ spectrumId, integralId });
    setContextMenu(null);
  }
  function resizeIntegral(
    spectrumId: string,
    integralId: string,
    from: number,
    to: number,
  ) {
    if (busy || !Number.isFinite(from) || !Number.isFinite(to) || from === to)
      return;
    const source = spectra.find((s) => s.id === spectrumId);
    if (!source) return;
    const shared =
      !!activeStack &&
      massIntegral &&
      stackMembers.every((s) => s.integrals.some((i) => i.id === integralId));
    const ids = new Set(shared ? stackMembers.map((s) => s.id) : [spectrumId]);
    const bounds = [...ids].map((id) => spectra.find((s) => s.id === id)!);
    if (
      bounds.some(
        (s) =>
          Math.min(from, to) < extent(s.data, s.referenceOffset)[1] ||
          Math.max(from, to) > extent(s.data, s.referenceOffset)[0],
      )
    ) {
      notify("Integral limits must be inside every selected spectrum.");
      return;
    }
    commit(
      spectra.map((s) =>
        ids.has(s.id)
          ? recalibrateIntegrals(
              s,
              s.integrals.map((i) =>
                i.id === integralId
                  ? {
                      ...i,
                      from: Math.max(from, to),
                      to: Math.min(from, to),
                      area: integrate(s.data, s.referenceOffset, from, to),
                    }
                  : i,
              ),
            )
          : s,
      ),
    );
  }
  function deletePlotIntegral(spectrumId: string, integralId?: string) {
    commit(
      spectra.map((s) =>
        s.id === spectrumId
          ? recalibrateIntegrals(
              s,
              integralId ? s.integrals.filter((i) => i.id !== integralId) : [],
            )
          : s,
      ),
    );
    setSelectedIntegral("");
    setContextMenu(null);
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
      integralCalibration: undefined,
      integralScale: 1,
      id: uid(),
      label: active.label + " copy",
      color: colors[spectra.length % colors.length],
      peaks: active.peaks.map((p) => ({ ...p, id: uid() })),
      integrals: active.integrals.map((p) => ({ ...p, id: uid() })),
      multiplets: active.multiplets.map((p) => ({ ...p, id: uid() })),
    };
    commit(
      [...spectra, s],
      activeStack
        ? stacks.map((st) =>
            st.id === activeStack.id
              ? { ...st, spectrumIds: [...st.spectrumIds, s.id] }
              : st,
          )
        : stacks,
    );
    setActiveId(s.id);
    notify("Spectrum duplicated for independent processing");
  }
  function deleteSpectrum(id: string) {
    if (busy) return;
    const next = spectra.filter((s) => s.id !== id);
    const nextStacks = stacks
      .map((st) => ({
        ...st,
        spectrumIds: st.spectrumIds.filter((v) => v !== id),
        referenceId:
          st.referenceId === id
            ? st.spectrumIds.find((v) => v !== id)
            : st.referenceId,
      }))
      .filter((st) => st.spectrumIds.length);
    commit(next, nextStacks);
    const group = nextStacks.find((st) => st.id === activeStackId);
    if (activeStackId && !group) {
      setActiveStackId(null);
      setSelectedStackId(null);
      setMode("single");
    }
    if (id === activeId)
      setActiveId(group?.spectrumIds[0] ?? next[0]?.id ?? "");
    setSelected((a) => a.filter((v) => v !== id));
    notify("Spectrum removed · Undo to restore");
  }
  function moveSpectrum(id: string, direction: number) {
    if (busy) return;
    if (activeStack) {
      const ids = [...activeStack.spectrumIds],
        i = ids.indexOf(id),
        j = i + direction;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      commit(
        spectra,
        stacks.map((st) =>
          st.id === activeStack.id ? { ...st, spectrumIds: ids } : st,
        ),
      );
      return;
    }
    const next = [...spectra],
      i = next.findIndex((s) => s.id === id),
      j = i + direction;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }
  function createStack() {
    const members = spectra.filter((s) => selected.includes(s.id));
    if (members.some((s) => s.twoD)) {
      notify("Select 1D spectra for stacking and kinetics.");
      return;
    }
    if (members.length < 2) {
      notify("Shift-click at least two spectra, then click Stack selected.");
      return;
    }
    if (new Set(members.map((s) => s.nucleus)).size > 1) {
      notify("Choose spectra with the same observed nucleus for one stack.");
      return;
    }
    const st: SpectrumStack = {
      id: uid(),
      label: `Stack ${stacks.length + 1}`,
      spectrumIds: members.map((s) => s.id),
      referenceId: members[0].id,
    };
    commit(spectra, [...stacks, st]);
    if (navigatorList.current) navigatorList.current.scrollTop = 0;
    openStack(st);
    setSelected([]);
    notify(`Created ${st.label} with ${members.length} spectra`);
  }
  function openStack(st: SpectrumStack) {
    if (busy) return;
    baselineJob.current++;
    setBaselineOpen(false);
    setActiveStackId(st.id);
    setSelectedStackId(st.id);
    setActiveId(st.spectrumIds[0]);
    setSelected([]);
    setMode("stack");
    setTab("Stack");
    setPanel("stack");
    setInspectorOpen(false);
    setTool("select");
    setPreview(null);
    setFitEnabled(false);
    setHandAlign(false);
    const s = spectra.find((s) => s.id === st.spectrumIds[0]);
    if (s) setView(extent(s.data, s.referenceOffset));
  }
  function shiftMember(id: string, delta: number) {
    if (busy) return;
    commit(spectra.map((s) => (s.id === id ? shiftSpectrum(s, delta) : s)));
    setActiveId(id);
    setSelected([id]);
    setFitEnabled(false);
  }
  function alignMembers() {
    if (!activeStack) return;
    try {
      const updates = new Map(
        stackMembers.map((s) => [
          s.id,
          shiftSpectrum(
            s,
            alignTarget - strongestPosition(s, alignFrom, alignTo),
          ),
        ]),
      );
      commit(spectra.map((s) => updates.get(s.id) ?? s));
      setFitEnabled(false);
      notify(
        `Aligned ${updates.size} spectra to ${alignTarget.toFixed(4)} ppm`,
      );
    } catch (e) {
      notify(err(e));
    }
  }
  function resizePanel(
    e: React.PointerEvent,
    which: "navigator" | "inspector" | "results" | "ribbon",
  ) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start =
      which === "navigator" || which === "inspector" ? e.clientX : e.clientY;
    const value =
      which === "navigator"
        ? navigatorWidth
        : which === "inspector"
          ? inspectorWidth
          : which === "results"
            ? resultsHeight
            : ribbonHeight;
    const move = (ev: PointerEvent) => {
      const delta =
        (which === "navigator" || which === "inspector"
          ? ev.clientX
          : ev.clientY) - start;
      const next =
        value + delta * (which === "inspector" || which === "results" ? -1 : 1);
      if (which === "navigator")
        setNavigatorWidth(Math.max(145, Math.min(440, next)));
      else if (which === "inspector")
        setInspectorWidth(Math.max(220, Math.min(520, next)));
      else if (which === "results")
        setResultsHeight(
          Math.max(100, Math.min(window.innerHeight * 0.55, next)),
        );
      else setRibbonHeight(Math.max(76, Math.min(170, next)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }
  function applyProperties(
    p: SpectrumProperties,
    label: string,
    color: string,
    metadata: Spectrum["metadata"],
    all: boolean,
  ) {
    if (!active || busy) return;
    const ids = all && activeStack ? activeStack.spectrumIds : [active.id];
    commit(
      spectra.map((s) =>
        ids.includes(s.id)
          ? {
              ...s,
              properties: p,
              ...(s.id === active.id ? { label, color, metadata } : {}),
            }
          : s,
      ),
    );
    notify("Spectrum properties applied");
  }
  function exportKinetics() {
    exportKineticsCSV(kineticsPoints, fitResult.fit ?? undefined, {
      measurements: kineticMeasurements,
      options: kineticOptions,
      stackLabel: activeStack?.label,
    });
  }
  function enterTab(t: Tab) {
    if (busy) return;
    if (
      active?.twoD &&
      (t === "Kinetics" || t === "Stack" || t === "Processing")
    ) {
      notify(
        "Open a 1D spectrum for this workflow. 2D contour controls are on the spectrum.",
      );
      return;
    }
    setTab(t);
    if (t === "Stack") {
      setPanel("stack");
      if (activeStack) setMode("stack");
    }
    if (t === "Export") setPanel("export");
    if (t === "Processing") {
      setPanel("phase");
      if (active && !active.original.imag && active.fid)
        setDraft((d) => ({ ...d, transform: true }));
    }
    if (t === "Home" || t === "Analysis") setPanel("overview");
    setInspectorOpen(false);
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
      [
        s.id,
        s.revision,
        s.referenceOffset,
        s.timeMinutes,
        s.nucleus,
        s.label,
      ].join(":"),
    )
    .join("|");
  const kineticOptions = useMemo(
    () => ({
      from: kinFrom,
      to: kinTo,
      mode: kinMode,
      standardFrom: stdFrom,
      standardTo: stdTo,
      targetProtons,
      standardProtons: stdProtons,
      standardConcentration: stdConcentration,
      concentrationUnit,
      excludedIds: excluded,
      spectrumIds:
        activeStack?.spectrumIds ??
        spectra.filter((s) => !s.twoD).map((s) => s.id),
      nucleus: active?.nucleus,
    }),
    [
      kinFrom,
      kinTo,
      kinMode,
      stdFrom,
      stdTo,
      targetProtons,
      stdProtons,
      stdConcentration,
      concentrationUnit,
      excluded,
      activeStack,
      spectra,
      active?.nucleus,
    ],
  );
  const kineticMeasurements = useMemo(
    () => measureKinetics(spectra, kineticOptions),
    [measurementSignature, kineticOptions],
  );
  const kineticsPoints: KineticPoint[] = useMemo(
    () => measuredPoints(kineticMeasurements),
    [kineticMeasurements],
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
        if (integralEdit) setIntegralEdit(null);
        else if (propertiesOpen) setPropertiesOpen(false);
        else if (contextMenu) setContextMenu(null);
        else if (help) setHelp(false);
        else cancelPreview();
        return;
      }
      if (busy || propertiesOpen || integralEdit) return;
      if (baselineOpen && k !== "b") return;
      if (e.shiftKey && k === "p") {
        e.preventDefault();
        enterTab("Processing");
        setPanel("phase");
        setInspectorOpen(true);
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
      } else if (k === "b") {
        e.preventDefault();
        openBaseline();
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
    baselineOpen,
    propertiesOpen,
    contextMenu,
    integralEdit,
    activeStack,
  ]);
  const processActions = (
    <>
      <div className="ribbon-group">
        <RibbonButton
          icon={Sparkles}
          label="Auto phase"
          onClick={autoPhase}
          disabled={
            !active ||
            !!active.twoD ||
            (!active.data.imag && !active.fid) ||
            !!busy
          }
        />
        <RibbonButton
          icon={SlidersHorizontal}
          label="Manual phase"
          shortcut="⇧ P"
          active={panel === "phase"}
          onClick={() => {
            setPanel("phase");
            setInspectorOpen(true);
          }}
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
          label="Baseline correction"
          shortcut="B"
          onClick={() => openBaseline()}
          disabled={!active || !!active.twoD || !!busy}
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
          disabled={!active || !!active.twoD}
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
          disabled={!active || !!active.twoD}
        />
        <RibbonButton
          icon={Settings2}
          label="Integral controls"
          onClick={() => {
            setPanel("integral");
            setInspectorOpen((v) => !v);
          }}
        />
        <RibbonButton
          icon={FileText}
          label="Integral table"
          onClick={() => {
            setTable("Integrals");
            setTableOpen((v) => !v);
          }}
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
          icon={Sparkles}
          label="Auto multiplets"
          disabled={!active || !!active.twoD}
          onClick={() => {
            if (!active) return;
            const ms = autoMultiplets(active);
            changeActive((s) => ({
              ...s,
              multiplets: ms,
              history: [
                ...s.history,
                `Auto multiplets · ${ms.length} suggested groups`,
              ],
            }));
            setTable("Multiplets");
            notify(`${ms.length} multiplets analyzed · review assignments`);
          }}
        />
        <RibbonButton
          icon={Trash2}
          label="Clear analysis"
          onClick={() =>
            changeActive((s) => ({
              ...s,
              peaks: [],
              integrals: [],
              integralCalibration: undefined,
              integralScale: 1,
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
      onPointerDown={(e) => {
        const el = e.target as HTMLElement;
        if (
          !el.closest(
            ".spectrum-card,.context-menu,.modal,.baseline-dialog,input,button,select,.resizer,.spectrum-plot",
          )
        ) {
          setSelected([]);
          setSelectedStackId(null);
        }
        if (!el.closest(".context-menu")) setContextMenu(null);
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
      <div
        className="ribbon"
        style={{ height: ribbonHeight }}
        inert={busy ? true : undefined}
      >
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
                label="Stack selected"
                disabled={selected.length < 2}
                onClick={createStack}
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
              <span className="group-label">Stack</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={BarChart3}
                label="Mass integral"
                onClick={() => {
                  setMassIntegral(true);
                  toolMode("integral", "integral");
                }}
                disabled={!activeStack}
              />
              <RibbonButton
                icon={ListFilter}
                label="Align spectra"
                onClick={() => {
                  setPanel("stack");
                  setInspectorOpen(true);
                }}
                disabled={!activeStack}
              />
              <RibbonButton
                icon={Activity}
                label="Kinetics"
                onClick={() => enterTab("Kinetics")}
                disabled={!activeStack}
              />
              <span className="group-label">Analysis</span>
            </div>
            <div className="ribbon-group">
              <RibbonButton
                icon={Maximize2}
                label="Auto normalize all"
                active={normalization === "maximum"}
                onClick={() => {
                  setNormalization("maximum");
                  setPlotGain(1);
                  const ids = new Set(
                    (activeStack ? stackMembers : spectra).map((s) => s.id),
                  );
                  commit(
                    spectra.map((s) => (ids.has(s.id) ? { ...s, gain: 1 } : s)),
                  );
                  notify("All spectrum heights normalized");
                }}
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
                onClick={() => exportKinetics()}
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
                disabled={!!active?.twoD}
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
                  setStacks([]);
                  setActiveStackId(null);
                  setSelectedStackId(null);
                  setSelected([]);
                  setBaselineOpen(false);
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
      <div
        className="resizer horizontal ribbon-resizer"
        role="separator"
        aria-label="Resize ribbon"
        onPointerDown={(e) => resizePanel(e, "ribbon")}
      />
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
          <aside
            className="navigator"
            style={{ width: navigatorWidth, minWidth: navigatorWidth }}
            inert={busy ? true : undefined}
          >
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
            <div className="navigator-selection-bar">
              <span>
                {selected.length
                  ? `${selected.length} selected`
                  : "Shift-click to select"}
              </span>
              <button
                title="Create a stack from selected spectra"
                disabled={selected.length < 2}
                onClick={createStack}
              >
                <Layers size={13} />
                Stack
              </button>
            </div>
            <div
              ref={navigatorList}
              className="spectrum-list"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  setSelected([]);
                  setSelectedStackId(null);
                }
              }}
            >
              {stacks.map((st) => (
                <div
                  key={st.id}
                  className={`spectrum-card stack-card ${selectedStackId === st.id ? "multi-selected" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    openStack(st);
                    setContextMenu({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <button
                    className="spectrum-select"
                    onClick={() => openStack(st)}
                  >
                    <div className="card-caption">
                      <Layers size={14} />
                      <span>{st.label}</span>
                    </div>
                    <div className="stack-thumbnail">
                      {st.spectrumIds.slice(0, 4).map((id) => {
                        const sp = spectra.find((s) => s.id === id);
                        return sp ? <MiniTrace key={id} spectrum={sp} /> : null;
                      })}
                    </div>
                    <div className="card-meta">
                      <span>NMR stack</span>
                      <span>{st.spectrumIds.length} spectra</span>
                    </div>
                  </button>
                  <div className="card-actions">
                    <button
                      className="icon-button"
                      aria-label={`Remove ${st.label}`}
                      onClick={() => {
                        commit(
                          spectra,
                          stacks.filter((s) => s.id !== st.id),
                        );
                        if (activeStackId === st.id) {
                          setActiveStackId(null);
                          setSelectedStackId(null);
                          setMode("single");
                        }
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
              {visibleSpectra.map((s, i) => (
                <div
                  key={s.id}
                  className={`spectrum-card ${selected.includes(s.id) ? "multi-selected" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    selectSpectrum(s.id);
                    setContextMenu({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <button
                    className="spectrum-select"
                    title="Click to select; Shift-click for a range; Ctrl/Cmd-click to toggle"
                    onClick={(e) =>
                      selectSpectrum(s.id, e.ctrlKey || e.metaKey, e.shiftKey)
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
                      {s.twoD ? (
                        <MiniTwoD spectrum={s} />
                      ) : (
                        <MiniTrace spectrum={s} />
                      )}
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
        {navigatorOpen && (
          <div
            className="resizer vertical navigator-resizer"
            role="separator"
            aria-label="Resize spectra navigator"
            onPointerDown={(e) => resizePanel(e, "navigator")}
          />
        )}
        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="breadcrumbs">
              <span>{isDemo ? "Example project" : projectName}</span>
              <ChevronRight size={12} />
              <strong>
                {activeStack
                  ? `${activeStack.label} · ${active?.label}`
                  : (active?.label ?? "No spectrum")}
              </strong>
            </div>
            <div className="view-options">
              {activeStack && (
                <select
                  aria-label="Active stack member"
                  value={active?.id}
                  onChange={(e) =>
                    selectSpectrum(e.target.value, false, false, true)
                  }
                >
                  {stackMembers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                disabled={!!active?.twoD}
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
                <option value="real">
                  {active?.twoD
                    ? `${active.twoD.experiment} · ${active.twoD.mode} contours`
                    : "Real spectrum"}
                </option>
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
                  <p>
                    {activeStack
                      ? `${activeStack.label} · ${stackMembers.length} spectra`
                      : "Measure the same signal across your time series."}
                  </p>
                </div>
                <button className="secondary" onClick={() => exportKinetics()}>
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
              <div className="kinetics-controls internal-standard-controls">
                <Field label="Comparison">
                  <select
                    value={kinMode}
                    onChange={(e) => {
                      setKinMode(e.target.value as typeof kinMode);
                      setFitEnabled(false);
                    }}
                  >
                    <option value="area">Raw signal area</option>
                    <option value="ratio">Internal standard ratio</option>
                    <option value="concentration">
                      Internal standard concentration
                    </option>
                  </select>
                </Field>
                {kinMode !== "area" && (
                  <>
                    <NumberField
                      label="Standard from (ppm)"
                      value={stdFrom}
                      onChange={setStdFrom}
                      step={0.01}
                    />
                    <NumberField
                      label="Standard to (ppm)"
                      value={stdTo}
                      onChange={setStdTo}
                      step={0.01}
                    />
                    <NumberField
                      label="Target proton count"
                      value={targetProtons}
                      min={1}
                      onChange={(n) => setTargetProtons(Math.max(1, n))}
                      step={1}
                    />
                    <NumberField
                      label="Standard proton count"
                      value={stdProtons}
                      min={1}
                      onChange={(n) => setStdProtons(Math.max(1, n))}
                      step={1}
                    />
                  </>
                )}
                {kinMode === "concentration" && (
                  <>
                    <NumberField
                      label="Standard concentration"
                      value={stdConcentration}
                      min={0.000001}
                      onChange={(n) =>
                        setStdConcentration(Math.max(0.000001, n))
                      }
                    />
                    <Field label="Units">
                      <select
                        value={concentrationUnit}
                        onChange={(e) => setConcentrationUnit(e.target.value)}
                      >
                        <option>mM</option>
                        <option>M</option>
                        <option>µM</option>
                      </select>
                    </Field>
                  </>
                )}
              </div>
              {activeStack && (
                <Field label="Shared integral region">
                  <select
                    value=""
                    onChange={(e) => {
                      const i = active?.integrals.find(
                        (i) => i.id === e.target.value,
                      );
                      if (i) {
                        setKinFrom(i.from);
                        setKinTo(i.to);
                        setFitEnabled(false);
                      }
                    }}
                  >
                    <option value="">
                      Choose an integral from this stack…
                    </option>
                    {active?.integrals.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label} · {fmt(i.from)}–{fmt(i.to)} ppm
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <KineticsChart
                points={kineticsPoints}
                fit={fitResult.fit}
                label={
                  kinMode === "area"
                    ? "Integrated area"
                    : kinMode === "ratio"
                      ? "Internal standard ratio"
                      : `Concentration (${concentrationUnit})`
                }
              />
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
                      <th>Target area</th>
                      <th>Standard area</th>
                      <th>
                        {kinMode === "area"
                          ? "Measurement"
                          : kinMode === "ratio"
                            ? "Ratio"
                            : `Concentration (${concentrationUnit})`}
                      </th>
                      <th>Status</th>
                      <th>Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeStack
                      ? stackMembers
                      : spectra.filter(
                          (s) => !s.twoD && s.nucleus === active?.nucleus,
                        )
                    ).map((s) => {
                      const p = kineticsPoints.find((v) => v.id === s.id);
                      const measurement = kineticMeasurements.find(
                        (m) => m.id === s.id,
                      );
                      return (
                        <tr key={s.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Include ${s.label} in fit`}
                              disabled={!!measurement?.error}
                              checked={
                                !excluded.includes(s.id) && !measurement?.error
                              }
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
                            {measurement?.targetArea?.toPrecision(6) ?? "—"}
                          </td>
                          <td>
                            {measurement?.standardArea?.toPrecision(6) ?? "—"}
                          </td>
                          <td>{measurement?.value?.toPrecision(6) ?? "—"}</td>
                          <td className="measurement-status">
                            {measurement?.error ??
                              (measurement?.included ? "Included" : "Excluded")}
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
              <div
                className="spectrum-page"
                style={{
                  width: `${activeProperties.paperWidth}%`,
                  height: `${activeProperties.paperHeight}%`,
                  transform: `translate(${activeProperties.paperX}px,${activeProperties.paperY}px)`,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  setContextMenu({ x: e.clientX, y: e.clientY });
                }}
              >
                {active.twoD ? (
                  <TwoDPlot
                    spectrum={active}
                    tool={tool}
                    grid={grid}
                    properties={activeProperties}
                    exportRef={svgExport}
                    fullRef={twoDFull}
                  />
                ) : (
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
                    onSelect={(id, multi) =>
                      selectSpectrum(id, multi, false, !!activeStack)
                    }
                    onDeselect={() => {
                      setSelected([]);
                      setSelectedStackId(null);
                      setSelectedIntegral("");
                    }}
                    selected={selected}
                    properties={activeProperties}
                    baseline={baselineOpen ? baselineCurve : null}
                    handAlign={handAlign && !!activeStack}
                    onShift={shiftMember}
                    selectedIntegral={selectedIntegral}
                    onIntegralSelect={selectPlotIntegral}
                    onIntegralEdit={editPlotIntegral}
                    onIntegralResize={resizeIntegral}
                    onIntegralMenu={(spectrumId, integralId, x, y) => {
                      selectPlotIntegral(spectrumId, integralId);
                      setContextMenu({ x, y, spectrumId, integralId });
                    }}
                    onFit={full}
                    exportRef={svgExport}
                  />
                )}
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
            <div
              className={`results-panel ${!tableOpen ? "collapsed" : ""}`}
              style={
                tableOpen
                  ? { height: resultsHeight, minHeight: resultsHeight }
                  : undefined
              }
            >
              {tableOpen && (
                <div
                  className="resizer horizontal results-resizer"
                  role="separator"
                  aria-label="Resize results table"
                  onPointerDown={(e) => resizePanel(e, "results")}
                />
              )}
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
                                {displayedIntegralValue(active, i).toFixed(3)}
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove integral ${i.label}`}
                                  onClick={() =>
                                    changeActive((s) =>
                                      recalibrateIntegrals(
                                        s,
                                        s.integrals.filter(
                                          (a) => a.id !== i.id,
                                        ),
                                      ),
                                    )
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
                disabled={
                  !!active?.twoD && !["select", "zoom", "pan"].includes(t)
                }
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
          <aside
            className="inspector"
            style={{ width: inspectorWidth, minWidth: inspectorWidth }}
            inert={busy ? true : undefined}
          >
            <div
              className="resizer vertical inspector-resizer"
              role="separator"
              aria-label="Resize inspector"
              onPointerDown={(e) => resizePanel(e, "inspector")}
            />
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
                          {activeStack ? "Entire stack" : "All spectra"} (
                          {activeStack ? stackMembers.length : spectra.length})
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
                          Press B to choose a baseline method. The blue curve
                          previews the fitted baseline on the uncorrected
                          spectrum.
                        </p>
                        <button
                          className="primary full-width"
                          onClick={() => openBaseline()}
                        >
                          Baseline correction · B
                        </button>
                        <button
                          className="secondary full-width"
                          onClick={manualBaseline}
                        >
                          Manual baseline points
                        </button>
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
                    {panel === "integral" && activeStack && (
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={massIntegral}
                          onChange={(e) => setMassIntegral(e.target.checked)}
                        />
                        Integrate all {stackMembers.length} stack members
                      </label>
                    )}
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
                          Unnormalized values are relative to the first signal.
                          A known integral fixes the reporting scale; raw areas
                          stay available in the table.
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
                    {!activeStack ? (
                      <p className="panel-description">
                        Shift-click the spectra you want in the navigator, then
                        click Stack selected.
                      </p>
                    ) : (
                      <>
                        <Field label="Stack name">
                          <input
                            value={activeStack.label}
                            onChange={(e) =>
                              setStacks((a) =>
                                a.map((st) =>
                                  st.id === activeStack.id
                                    ? { ...st, label: e.target.value }
                                    : st,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Field label="Active member">
                          <select
                            value={active?.id}
                            onChange={(e) =>
                              selectSpectrum(e.target.value, false, false, true)
                            }
                          >
                            {stackMembers.map((s) => (
                              <option value={s.id} key={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <button
                          className="secondary full-width"
                          onClick={() => {
                            setMassIntegral(true);
                            toolMode("integral", "integral");
                          }}
                        >
                          Mass integral across stack
                        </button>
                        <div className="section-title">Align spectra</div>
                        <div className="two-fields">
                          <NumberField
                            label="Reference from (ppm)"
                            value={alignFrom}
                            onChange={setAlignFrom}
                            step={0.01}
                          />
                          <NumberField
                            label="Reference to (ppm)"
                            value={alignTo}
                            onChange={setAlignTo}
                            step={0.01}
                          />
                        </div>
                        <NumberField
                          label="Reference target (ppm)"
                          value={alignTarget}
                          onChange={setAlignTarget}
                          step={0.001}
                        />
                        <button
                          className="primary full-width"
                          onClick={alignMembers}
                        >
                          Align all to reference peak
                        </button>
                        <button
                          className="secondary full-width"
                          onClick={() => {
                            try {
                              const ref =
                                stackMembers.find(
                                  (s) => s.id === activeStack.referenceId,
                                ) ?? stackMembers[0];
                              setAlignTarget(
                                strongestPosition(ref, alignFrom, alignTo),
                              );
                              notify(
                                "Reference position copied. Click Align all to apply.",
                              );
                            } catch (e) {
                              notify(err(e));
                            }
                          }}
                        >
                          Use first spectrum as reference
                        </button>
                        <NumberField
                          label="Move active spectrum by (ppm)"
                          value={shiftValue}
                          onChange={setShiftValue}
                          step={0.001}
                        />
                        <button
                          className="secondary full-width"
                          onClick={() =>
                            active && shiftMember(active.id, shiftValue)
                          }
                        >
                          Apply ppm shift
                        </button>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={handAlign}
                            onChange={(e) => {
                              setHandAlign(e.target.checked);
                              setTool("select");
                            }}
                          />
                          Drag individual spectra horizontally
                        </label>
                        <button
                          className="secondary full-width"
                          onClick={() => enterTab("Kinetics")}
                        >
                          Use this stack in kinetics
                        </button>
                      </>
                    )}
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
                      disabled={!!active.twoD}
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
          {active?.twoD
            ? `${active.twoD.width.toLocaleString()} × ${active.twoD.height.toLocaleString()} 2D`
            : `${active?.data.real.length.toLocaleString()} points`}
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
              Supported here: Bruker 1D and processed 2D (including NOESY),
              supported JCAMP-DX, CSV and TSV. Import the complete experiment
              folder or ZIP, including pdata.
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
      {contextMenu && (
        <div
          className="context-menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 190, contextMenu.x)),
            top: Math.max(
              8,
              Math.min(
                window.innerHeight - (contextMenu.integralId ? 390 : 230),
                contextMenu.y,
              ),
            ),
          }}
        >
          {contextMenu.integralId && contextMenu.spectrumId && (
            <>
              <button
                role="menuitem"
                onClick={() =>
                  editPlotIntegral(
                    contextMenu.spectrumId!,
                    contextMenu.integralId!,
                  )
                }
              >
                Edit Integral…
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setTable("Integrals");
                  setTableOpen(true);
                  setContextMenu(null);
                }}
              >
                Show Table of Integrals
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  deletePlotIntegral(
                    contextMenu.spectrumId!,
                    contextMenu.integralId,
                  )
                }
              >
                Delete Integral
              </button>
              <button
                role="menuitem"
                onClick={() => deletePlotIntegral(contextMenu.spectrumId!)}
              >
                Delete All
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  try {
                    const id = contextMenu.spectrumId;
                    commit(
                      spectra.map((s) =>
                        s.id === id ? autodetectIntegralCounts(s) : s,
                      ),
                    );
                  } catch (e) {
                    notify(err(e));
                    setContextMenu(null);
                    return;
                  }
                  setContextMenu(null);
                  notify(
                    "Tentative nuclide counts estimated · review and normalize against a known signal",
                  );
                }}
              >
                Autodetect Nuclides Count…
              </button>
              <hr />
            </>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setPropertiesOpen(true);
              setContextMenu(null);
            }}
          >
            Properties…
          </button>
          <button
            role="menuitem"
            onClick={() => {
              openBaseline();
              setContextMenu(null);
            }}
          >
            Baseline correction… <kbd>B</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              full();
              setContextMenu(null);
            }}
          >
            Full spectrum
          </button>
          <button
            role="menuitem"
            disabled={selected.length < 2}
            onClick={() => {
              createStack();
              setContextMenu(null);
            }}
          >
            Stack selected spectra
          </button>
          <button
            role="menuitem"
            onClick={() => {
              duplicate();
              setContextMenu(null);
            }}
          >
            Duplicate spectrum
          </button>
        </div>
      )}
      {integralEdit &&
        (() => {
          const s = spectra.find((v) => v.id === integralEdit.spectrumId),
            i = s?.integrals.find((v) => v.id === integralEdit.integralId);
          return s && i ? (
            <IntegralDialog
              spectrum={s}
              integral={i}
              stack={!!activeStack}
              onClose={() => setIntegralEdit(null)}
              onApply={(from, to, label, value, all, normalize) => {
                const ids = new Set(
                  all && activeStack
                    ? stackMembers
                        .filter((v) => v.integrals.some((k) => k.id === i.id))
                        .map((v) => v.id)
                    : [s.id],
                );
                if (
                  !Number.isFinite(value) ||
                  value <= 0 ||
                  from === to ||
                  [...ids].some((id) => {
                    const b = extent(
                      spectra.find((v) => v.id === id)!.data,
                      spectra.find((v) => v.id === id)!.referenceOffset,
                    );
                    return (
                      Math.min(from, to) < b[1] || Math.max(from, to) > b[0]
                    );
                  })
                ) {
                  notify("Enter valid limits and a positive normalized value.");
                  return;
                }
                try {
                  commit(
                    spectra.map((v) =>
                      ids.has(v.id)
                        ? ((updated: Spectrum) =>
                            normalize
                              ? calibrateIntegral(updated, i.id, value)
                              : updated)(
                            recalibrateIntegrals(
                              v,
                              v.integrals.map((k) =>
                                k.id === i.id
                                  ? {
                                      ...k,
                                      from: Math.max(from, to),
                                      to: Math.min(from, to),
                                      label,
                                      area: integrate(
                                        v.data,
                                        v.referenceOffset,
                                        from,
                                        to,
                                      ),
                                    }
                                  : k,
                              ),
                            ),
                          )
                        : v,
                    ),
                  );
                } catch (e) {
                  notify(err(e));
                  return;
                }
                setIntegralEdit(null);
                notify(
                  "Integral updated; normalization retained during processing",
                );
              }}
            />
          ) : null;
        })()}
      {propertiesOpen && active && (
        <PropertiesDialog
          spectrum={active}
          initial={activeProperties}
          stack={!!activeStack}
          onApply={applyProperties}
          onClose={() => setPropertiesOpen(false)}
          onDefault={(p) => {
            setProperties(p);
            notify("Default spectrum properties updated");
          }}
        />
      )}
      {baselineOpen && active && (
        <BaselineDialog
          draft={draft}
          onChange={setDraft}
          view={view}
          loading={baselineLoading}
          error={baselineError}
          scope={scope}
          onScope={setScope}
          selectedCount={selected.length}
          stackCount={activeStack ? stackMembers.length : spectra.length}
          onApply={() => void process("apply")}
          onClose={cancelPreview}
          onManual={() => setTool("baseline")}
          onExtract={() => {
            if (baselineCurve)
              exportSpectrumCSV({
                ...active,
                label: active.label + " baseline model",
                data: baselineCurve,
                peaks: [],
                integrals: [],
                multiplets: [],
              });
          }}
        />
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
                ["B", "Baseline correction dialog"],
                ["Shift + click", "Select spectra range"],
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
              supports the defined 1D profile. Bruker processed 2D and raw
              States/States-TPPI magnitude data are supported. Native Mnova
              projects and other raw 2D modes are not read here.
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
