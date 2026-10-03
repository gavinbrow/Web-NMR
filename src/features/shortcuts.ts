export type ShortcutCommand =
  | "open"
  | "save"
  | "undo"
  | "redo"
  | "zoom"
  | "integral"
  | "multiplet"
  | "peakThreshold"
  | "peak"
  | "reference"
  | "graphicReference"
  | "baseline"
  | "manualPhase"
  | "integralManager"
  | "multipletManager"
  | "gainUp"
  | "gainDown"
  | "pan"
  | "panLeft"
  | "panRight"
  | "zoomBack"
  | "zoomForward"
  | "cancel"
  | "delete";
export interface ShortcutDefinition {
  id: ShortcutCommand;
  label: string;
  keys: string;
  source: string;
}
const base = "https://mestrelab.com/downloads/mnova/manuals/latest/";
/** Verified Mnova 17 standard keys. Mod means Command on macOS, Control otherwise. */
export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "baseline",
    label: "Baseline correction",
    keys: "B",
    source: base + "baseline-correction.html",
  },
  {
    id: "open",
    label: "Open files",
    keys: "Mod+O",
    source: base + "1d-processing.html",
  },
  {
    id: "save",
    label: "Save project",
    keys: "Mod+S",
    source: base + "shortcuts.html",
  },
  { id: "undo", label: "Undo", keys: "Mod+Z", source: base + "undo-redo.html" },
  { id: "redo", label: "Redo", keys: "Mod+Y", source: base + "undo-redo.html" },
  {
    id: "zoom",
    label: "Horizontal zoom",
    keys: "Z",
    source: base + "zooming.html",
  },
  {
    id: "integral",
    label: "Manual integration",
    keys: "I",
    source: base + "integration.html",
  },
  {
    id: "multiplet",
    label: "Manual multiplet",
    keys: "J",
    source: base + "shortcuts.html",
  },
  {
    id: "peakThreshold",
    label: "Peaks in a region",
    keys: "K",
    source: base + "peak-picking.html",
  },
  {
    id: "peak",
    label: "Peak by peak",
    keys: "Mod+K",
    source: base + "peak-picking.html",
  },
  {
    id: "reference",
    label: "Reference",
    keys: "L",
    source: base + "nmr-reference.html",
  },
  {
    id: "graphicReference",
    label: "Graphic reference",
    keys: "R",
    source: base + "nmr-reference.html",
  },
  {
    id: "manualPhase",
    label: "Manual phase correction",
    keys: "Shift+P",
    source: base + "phase-correction.html",
  },
  {
    id: "integralManager",
    label: "Integral manager",
    keys: "Shift+I",
    source: base + "integration.html",
  },
  {
    id: "multipletManager",
    label: "Multiplet manager",
    keys: "Shift+J",
    source: base + "multiplet-analysis.html",
  },
  {
    id: "gainUp",
    label: "Increase intensity",
    keys: "+",
    source: base + "increasing-decreasing-intensity.html",
  },
  {
    id: "gainDown",
    label: "Decrease intensity",
    keys: "−",
    source: base + "increasing-decreasing-intensity.html",
  },
  {
    id: "pan",
    label: "Pan while held",
    keys: "Space",
    source: base + "zooming.html",
  },
  {
    id: "panLeft",
    label: "Pan left",
    keys: "Alt+←",
    source: base + "zooming.html",
  },
  {
    id: "panRight",
    label: "Pan right",
    keys: "Alt+→",
    source: base + "zooming.html",
  },
  {
    id: "zoomBack",
    label: "Previous zoom",
    keys: "Shift+←",
    source: base + "zooming.html",
  },
  {
    id: "zoomForward",
    label: "Next zoom",
    keys: "Shift+→",
    source: base + "zooming.html",
  },
  {
    id: "cancel",
    label: "Finish current tool",
    keys: "Escape",
    source: base + "nmr-processing-tutorial.html",
  },
  {
    id: "delete",
    label: "Delete selection",
    keys: "Delete",
    source: base + "shortcuts.html",
  },
];
export function shortcutCommand(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
): ShortcutCommand | null {
  const key = event.key.toLowerCase(),
    mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    if (key === "z") return event.shiftKey ? "redo" : "undo"; // Shift+Z is an additional browser-friendly alias.
    if (!event.shiftKey && key === "y") return "redo";
    if (!event.shiftKey && key === "o") return "open";
    if (!event.shiftKey && key === "s") return "save";
    if (!event.shiftKey && key === "k") return "peak";
    return null;
  }
  if (event.altKey && !mod && !event.shiftKey)
    return key === "arrowleft"
      ? "panLeft"
      : key === "arrowright"
        ? "panRight"
        : null;
  if (event.altKey) return null;
  if (event.shiftKey)
    return (
      (
        {
          p: "manualPhase",
          i: "integralManager",
          j: "multipletManager",
          arrowleft: "zoomBack",
          arrowright: "zoomForward",
          "+": "gainUp",
        } as Record<string, ShortcutCommand>
      )[key] || null
    );
  return (
    (
      {
        z: "zoom",
        b: "baseline",
        i: "integral",
        j: "multiplet",
        k: "peakThreshold",
        l: "reference",
        r: "graphicReference",
        "+": "gainUp",
        "=": "gainUp",
        "-": "gainDown",
        " ": "pan",
        escape: "cancel",
        delete: "delete",
        backspace: "delete",
      } as Record<string, ShortcutCommand>
    )[key] || null
  );
}
export function isTextEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest('input,textarea,select,[contenteditable="true"]'))
  );
}
