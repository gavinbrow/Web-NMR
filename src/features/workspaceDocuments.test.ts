import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultRecipe,
  type KineticsConfiguration,
  type Spectrum,
} from "../model";
import { encodeProject, decodeProject } from "./project";
import {
  WORKSPACE_RECOVERY_KEY,
  activateDocument,
  addDocument,
  captureDocument,
  clearWorkspaceRecovery,
  closeDocument,
  deleteWorkspaceDocument,
  hasWorkspaceRecovery,
  createBlankProject,
  createWorkspace,
  createWorkspaceDocument,
  loadWorkspaceRecovery,
  renameDocument,
  reopenDocument,
  saveWorkspaceRecovery,
  validateWorkspaceDocuments,
} from "./workspaceDocuments";

const storage = vi.hoisted(() => ({
  entries: new Map<string, unknown>(),
  failSet: false,
  activeWrites: 0,
  maxWrites: 0,
}));
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(storage.entries.get(key)),
  set: async (key: string, value: unknown) => {
    storage.activeWrites++;
    storage.maxWrites = Math.max(storage.maxWrites, storage.activeWrites);
    try {
      await Promise.resolve();
      if (storage.failSet) throw new Error("Quota exceeded");
      storage.entries.set(key, structuredClone(value));
    } finally {
      storage.activeWrites--;
    }
  },
  del: async (key: string) => {
    storage.entries.delete(key);
  },
  update: async (key: string, updater: (old: unknown) => unknown) => {
    storage.activeWrites++;
    storage.maxWrites = Math.max(storage.maxWrites, storage.activeWrites);
    try {
      await Promise.resolve();
      if (storage.failSet) throw new Error("Quota exceeded");
      storage.entries.set(
        key,
        structuredClone(updater(structuredClone(storage.entries.get(key)))),
      );
    } finally {
      storage.activeWrites--;
    }
  },
}));
function populated(name: string) {
  const p = createBlankProject(name);
  const data = {
    x: new Float64Array([4, 3, 2]),
    real: new Float64Array([1, 2.123456789012, 3]),
    imag: new Float64Array([4, 5, 6]),
  };
  const s: Spectrum = {
    id: name + "-s",
    label: name + " spectrum",
    color: "#b33",
    nucleus: "1H",
    frequencyMHz: 400,
    sourceFormat: "Test",
    metadata: {},
    data,
    original: data,
    recipe: { ...defaultRecipe(), ph0: 42 },
    referenceOffset: 0.1,
    peaks: [],
    integrals: [],
    multiplets: [],
    integralScale: 1,
    gain: 2,
    visible: true,
    history: ["Imported", "Processed"],
    revision: 2,
  };
  p.spectra = [s];
  p.activeId = s.id;
  p.view = [4.1, 2.1];
  p.stacks = [{ id: "stack", label: "Stack", spectrumIds: [s.id] }];
  p.activeStackId = "stack";
  return p;
}
beforeEach(async () => {
  storage.failSet = false;
  await clearWorkspaceRecovery();
  storage.entries.clear();
  storage.maxWrites = 0;
});
describe("project document tabs", () => {
  it("captures each project's arrays, processing, stack and session independently across switching", () => {
    let w = createWorkspace(populated("A"), {
      id: "a",
      session: { tab: "Processing", undo: [1] },
    });
    w = addDocument(
      w,
      createWorkspaceDocument(populated("B"), {
        id: "b",
        session: { tab: "Kinetics" },
      }),
    );
    w = activateDocument(w, "a");
    const edited = {
      ...w.documents[0].project,
      view: [3.8, 2.5] as [number, number],
    };
    w = captureDocument(w, "a", edited, { tab: "Analysis", undo: [1, 2] });
    expect(w.documents[0].project.view).toEqual([3.8, 2.5]);
    expect(w.documents[1].project.view).toEqual([4.1, 2.1]);
    expect(w.documents[0].session).toEqual({ tab: "Analysis", undo: [1, 2] });
    expect(w.documents[1].session).toEqual({ tab: "Kinetics" });
    expect(w.documents[0].project.spectra[0].recipe.ph0).toBe(42);
    expect(w.documents[1].project.spectra[0].history).toEqual([
      "Imported",
      "Processed",
    ]);
    expect(w.documents[0].project.stacks?.[0].spectrumIds).toEqual(["A-s"]);
  });
  it("renames, closes and reopens projects without losing their state; last close leaves a blank tab", () => {
    let w = createWorkspace(populated("A"), { id: "a" });
    w = addDocument(w, createWorkspaceDocument(populated("B"), { id: "b" }));
    w = renameDocument(w, "b", "  Reaction B  ");
    w = closeDocument(w, "b");
    expect(w.activeDocumentId).toBe("a");
    expect(w.closedDocuments[0].project.name).toBe("Reaction B");
    w = reopenDocument(w);
    expect(w.activeDocumentId).toBe("b");
    expect(w.closedDocuments).toHaveLength(0);
    w = closeDocument(closeDocument(w, "a"), "b");
    expect(w.documents).toHaveLength(1);
    expect(w.documents[0].project.spectra).toHaveLength(0);
    expect(w.closedDocuments).toHaveLength(2);
    validateWorkspaceDocuments(w);
  });
  it("refuses duplicate IDs and invalid active projects", () => {
    const w = createWorkspace(populated("A"), { id: "a" });
    expect(() => addDocument(w, w.documents[0])).toThrow("already open");
    expect(() =>
      validateWorkspaceDocuments({ ...w, activeDocumentId: "missing" }),
    ).toThrow("Active project");
    expect(() =>
      validateWorkspaceDocuments({ ...w, closedDocuments: [w.documents[0]] }),
    ).toThrow("duplicate");
  });
});
describe("workspace recovery", () => {
  it("permanently deletes individual and closed projects, and ignores later stale autosaves", async () => {
    let w = createWorkspace(populated("A"), { id: "a" });
    w = addDocument(w, createWorkspaceDocument(populated("B"), { id: "b" }));
    const stale = w;
    w = closeDocument(w, "a");
    w = deleteWorkspaceDocument(w, "a");
    expect(w.closedDocuments).toHaveLength(0);
    expect(await saveWorkspaceRecovery(w)).toBe(true);
    expect(await saveWorkspaceRecovery(stale)).toBe(true);
    const recovered = (await loadWorkspaceRecovery())!;
    expect(recovered.documents.map((d) => d.id)).toEqual(["b"]);
    expect(recovered.deletedDocumentIds).toContain("a");
    const empty = deleteWorkspaceDocument(recovered, "b");
    expect(hasWorkspaceRecovery(empty)).toBe(false);
    expect(await saveWorkspaceRecovery(empty)).toBe(true);
    expect(await loadWorkspaceRecovery()).toBeNull();
    await saveWorkspaceRecovery(stale);
    expect(await loadWorkspaceRecovery()).toBeNull();
    await clearWorkspaceRecovery();
    await saveWorkspaceRecovery(stale);
    expect(await loadWorkspaceRecovery()).toBeNull();
  });
  it("round-trips all open and closed projects, typed arrays and opaque editor sessions", async () => {
    let w = createWorkspace(populated("A"), {
      id: "a",
      session: { undo: [{ project: populated("History") }] },
    });
    w = addDocument(
      w,
      createWorkspaceDocument(populated("B"), { id: "b", isDemo: false }),
    );
    w = closeDocument(w, "a");
    expect(await saveWorkspaceRecovery(w)).toBe(true);
    const recovered = await loadWorkspaceRecovery();
    expect(recovered).toEqual({ ...w, deletedDocumentIds: [] });
    expect(recovered!.documents[0].project.spectra[0].data.real).toBeInstanceOf(
      Float64Array,
    );
    expect(recovered!.documents[0].project.spectra[0].data.real).not.toBe(
      w.documents[0].project.spectra[0].data.real,
    );
  });
  it("migrates valid legacy recovery after a successful new write", async () => {
    storage.entries.set("web-nmr-recovery-v1", populated("Legacy"));
    const w = await loadWorkspaceRecovery();
    expect(w!.documents[0].project.name).toBe("Legacy");
    expect(storage.entries.has(WORKSPACE_RECOVERY_KEY)).toBe(true);
    expect(storage.entries.has("web-nmr-recovery-v1")).toBe(false);
  });
  it("keeps legacy recovery when migration cannot write and rejects corrupt workspace data", async () => {
    storage.entries.set("web-nmr-recovery-v1", populated("Legacy"));
    storage.failSet = true;
    expect((await loadWorkspaceRecovery())!.documents[0].project.name).toBe(
      "Legacy",
    );
    expect(storage.entries.has("web-nmr-recovery-v1")).toBe(true);
    storage.failSet = false;
    storage.entries.set(WORKSPACE_RECOVERY_KEY, { version: 2 });
    expect(await loadWorkspaceRecovery()).toBeNull();
  });
  it("serializes concurrent saves so the latest document state wins", async () => {
    const first = createWorkspace(populated("First"), { id: "a" });
    const last = renameDocument(first, "a", "Last");
    expect(
      await Promise.all([
        saveWorkspaceRecovery(first),
        saveWorkspaceRecovery(last),
      ]),
    ).toEqual([true, true]);
    expect(storage.maxWrites).toBe(1);
    expect((await loadWorkspaceRecovery())!.documents[0].project.name).toBe(
      "Last",
    );
    await clearWorkspaceRecovery();
    expect(await loadWorkspaceRecovery()).toBeNull();
  });
});
describe("portable project kinetics configuration", () => {
  const config: KineticsConfiguration = {
    targets: [
      {
        id: "reactant",
        label: "Reactant",
        color: "#1689e9",
        from: 4.24,
        to: 4,
        protons: 2,
        model: "decay",
      },
      {
        id: "product",
        label: "Product",
        color: "#e64445",
        from: 3.9,
        to: 3.6,
        protons: 3,
        model: "growth",
      },
    ],
    activeTargetId: "product",
    mode: "ratio",
    standardFrom: 2.15,
    standardTo: 2,
    standardProtons: 1,
    standardConcentration: 1,
    concentrationUnit: "mM",
    excludedIds: [],
    view: "spectra",
    seriesSource: "document",
  };
  it("round-trips kinetic targets and supports legacy projects without settings", async () => {
    const p = populated("A");
    p.kinetics = config;
    expect((await decodeProject(await encodeProject(p))).kinetics).toEqual(
      config,
    );
    expect(
      (await decodeProject(await encodeProject(createBlankProject()))).kinetics,
    ).toBeUndefined();
  });
  it("rejects corrupt targets and invalid measurement settings", async () => {
    for (const kinetics of [
      { ...config, activeTargetId: "missing" },
      { ...config, targets: [config.targets[0], config.targets[0]] },
      { ...config, targets: [{ ...config.targets[0], protons: 0 }] },
      { ...config, targets: [{ ...config.targets[0], color: "<script>" }] },
      { ...config, standardTo: config.standardFrom },
      { ...config, standardConcentration: NaN },
      { ...config, seriesSource: "unknown" },
    ]) {
      const p = populated("A");
      p.kinetics = kinetics as KineticsConfiguration;
      await expect(encodeProject(p)).rejects.toThrow("kinetic");
    }
  });
  it("retains an explicitly saved kinetics subset and its source after reopening", async () => {
    const p = populated("Selection");
    p.kinetics = {
      ...config,
      seriesSource: "custom",
      seriesSpectrumIds: [p.spectra[0].id],
    };
    expect((await decodeProject(await encodeProject(p))).kinetics).toEqual(
      p.kinetics,
    );
  });
});
