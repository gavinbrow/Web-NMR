import { get, update } from "idb-keyval";
import { uid, type Project } from "../model";
import { defaultProperties } from "./appearance";
import { validateProject, loadRecovery, clearRecovery } from "./project";

export interface WorkspaceDocument {
  id: string;
  project: Project;
  isDemo?: boolean;
  /** App owns this snapshot's shape and must narrow it before restoring UI state. */
  session?: unknown;
}
export interface WorkspaceDocuments {
  version: 1;
  documents: WorkspaceDocument[];
  activeDocumentId: string;
  /** Recently closed documents can be reopened without a save confirmation. */
  closedDocuments: WorkspaceDocument[];
  savedAt: string;
  /** Retained in local recovery so an older browser tab cannot resurrect deleted projects. */
  deletedDocumentIds?: string[];
}
export const WORKSPACE_RECOVERY_KEY = "web-nmr-workspace-recovery-v1";
export const MAX_OPEN_DOCUMENTS = 24;
export const MAX_CLOSED_DOCUMENTS = 5;
const now = () => new Date().toISOString();
function stamp(w: WorkspaceDocuments): WorkspaceDocuments {
  return { ...w, savedAt: now() };
}

export function createBlankProject(name = "Untitled project"): Project {
  return {
    version: 1,
    name,
    spectra: [],
    activeId: null,
    view: null,
    displayMode: "single",
    normalization: "none",
    stacks: [],
    activeStackId: null,
    properties: defaultProperties(),
    savedAt: now(),
  };
}
export function createWorkspaceDocument(
  project: Project,
  options: { id?: string; isDemo?: boolean; session?: unknown } = {},
): WorkspaceDocument {
  return {
    id: options.id ?? uid(),
    project,
    ...("isDemo" in options ? { isDemo: options.isDemo } : {}),
    ...("session" in options ? { session: options.session } : {}),
  };
}
export function createWorkspace(
  project: Project = createBlankProject(),
  options: Parameters<typeof createWorkspaceDocument>[1] = {},
): WorkspaceDocuments {
  const document = createWorkspaceDocument(project, options);
  return {
    version: 1,
    documents: [document],
    activeDocumentId: document.id,
    closedDocuments: [],
    savedAt: now(),
  };
}
export function captureDocument(
  w: WorkspaceDocuments,
  id: string,
  project: Project,
  session?: unknown,
  isDemo?: boolean,
): WorkspaceDocuments {
  if (!w.documents.some((d) => d.id === id))
    throw new Error("This project tab is no longer open.");
  return stamp({
    ...w,
    documents: w.documents.map((d) =>
      d.id === id
        ? {
            ...d,
            project,
            ...(session !== undefined ? { session } : {}),
            ...(isDemo !== undefined ? { isDemo } : {}),
          }
        : d,
    ),
  });
}
export function activateDocument(
  w: WorkspaceDocuments,
  id: string,
): WorkspaceDocuments {
  if (!w.documents.some((d) => d.id === id))
    throw new Error("This project tab is no longer open.");
  return stamp({ ...w, activeDocumentId: id });
}
export function addDocument(
  w: WorkspaceDocuments,
  document: WorkspaceDocument,
): WorkspaceDocuments {
  if (w.documents.length >= MAX_OPEN_DOCUMENTS)
    throw new Error(
      `Close a project before opening more than ${MAX_OPEN_DOCUMENTS} tabs.`,
    );
  if (w.documents.some((d) => d.id === document.id))
    throw new Error("This project tab is already open.");
  return stamp({
    ...w,
    documents: [...w.documents, document],
    closedDocuments: w.closedDocuments.filter((d) => d.id !== document.id),
    activeDocumentId: document.id,
  });
}
export function renameDocument(
  w: WorkspaceDocuments,
  id: string,
  name: string,
): WorkspaceDocuments {
  const label = name.trim();
  if (!label || label.length > 200)
    throw new Error("Enter a project name between 1 and 200 characters.");
  const document = w.documents.find((d) => d.id === id);
  if (!document) throw new Error("This project tab is no longer open.");
  return captureDocument(w, id, { ...document.project, name: label });
}
export function closeDocument(
  w: WorkspaceDocuments,
  id: string,
): WorkspaceDocuments {
  const index = w.documents.findIndex((d) => d.id === id);
  if (index < 0) return w;
  const closed = w.documents[index],
    documents = w.documents.filter((d) => d.id !== id);
  if (!documents.length)
    documents.push(createWorkspaceDocument(createBlankProject()));
  return stamp({
    ...w,
    documents,
    activeDocumentId:
      w.activeDocumentId === id
        ? documents[Math.min(index, documents.length - 1)].id
        : w.activeDocumentId,
    closedDocuments: [
      closed,
      ...w.closedDocuments.filter((d) => d.id !== id),
    ].slice(0, MAX_CLOSED_DOCUMENTS),
  });
}
export function reopenDocument(
  w: WorkspaceDocuments,
  id = w.closedDocuments[0]?.id,
): WorkspaceDocuments {
  const document = w.closedDocuments.find((d) => d.id === id);
  return document ? addDocument(w, document) : w;
}
export function deleteWorkspaceDocument(
  w: WorkspaceDocuments,
  id: string,
): WorkspaceDocuments {
  const index = w.documents.findIndex((d) => d.id === id);
  const documents = w.documents.filter((d) => d.id !== id);
  if (!documents.length)
    documents.push(createWorkspaceDocument(createBlankProject()));
  return stamp({
    ...w,
    documents,
    closedDocuments: w.closedDocuments.filter((d) => d.id !== id),
    activeDocumentId: documents.some((d) => d.id === w.activeDocumentId)
      ? w.activeDocumentId
      : documents[Math.max(0, Math.min(index, documents.length - 1))].id,
    deletedDocumentIds: [...new Set([...(w.deletedDocumentIds ?? []), id])],
  });
}
/** A blank replacement tab is never offered as a project to recover. */
export function hasWorkspaceRecovery(w: WorkspaceDocuments): boolean {
  return [...w.documents, ...w.closedDocuments].some(
    (d) =>
      d.project.spectra.length > 0 || d.project.name !== "Untitled project",
  );
}
function filterDeleted(
  w: WorkspaceDocuments,
  deleted: string[],
): WorkspaceDocuments {
  const removed = new Set(deleted);
  const documents = w.documents.filter((d) => !removed.has(d.id));
  if (!documents.length)
    documents.push(createWorkspaceDocument(createBlankProject()));
  return {
    ...w,
    documents,
    closedDocuments: w.closedDocuments.filter((d) => !removed.has(d.id)),
    activeDocumentId: documents.some((d) => d.id === w.activeDocumentId)
      ? w.activeDocumentId
      : documents[0].id,
    deletedDocumentIds: deleted,
  };
}
export function validateWorkspaceDocuments(
  value: unknown,
): asserts value is WorkspaceDocuments {
  const w = value as WorkspaceDocuments;
  if (
    !w ||
    w.version !== 1 ||
    !Array.isArray(w.documents) ||
    w.documents.length < 1 ||
    w.documents.length > MAX_OPEN_DOCUMENTS ||
    !Array.isArray(w.closedDocuments) ||
    w.closedDocuments.length > MAX_CLOSED_DOCUMENTS ||
    typeof w.savedAt !== "string" ||
    !Number.isFinite(Date.parse(w.savedAt))
  )
    throw new Error("Invalid saved workspace.");
  const ids = new Set<string>();
  if (
    w.deletedDocumentIds !== undefined &&
    (!Array.isArray(w.deletedDocumentIds) ||
      w.deletedDocumentIds.some(
        (id) => typeof id !== "string" || !id || id.length > 128,
      ))
  )
    throw new Error("Invalid deleted project identities.");
  for (const d of [...w.documents, ...w.closedDocuments]) {
    if (
      !d ||
      typeof d.id !== "string" ||
      !d.id ||
      d.id.length > 128 ||
      ids.has(d.id) ||
      (d.isDemo !== undefined && typeof d.isDemo !== "boolean")
    )
      throw new Error("Invalid or duplicate project tab.");
    ids.add(d.id);
    validateProject(d.project);
    // Opaque session data never bypasses project validation. App restores only known fields.
  }
  if (!w.documents.some((d) => d.id === w.activeDocumentId))
    throw new Error("Active project tab does not exist.");
}

let recoveryWrites: Promise<unknown> = Promise.resolve();
/** Serial writes prevent an older autosave from replacing a newer workspace. */
export function saveWorkspaceRecovery(
  workspace: WorkspaceDocuments,
): Promise<boolean> {
  const write = recoveryWrites.then(async () => {
    try {
      validateWorkspaceDocuments(workspace);
      // IndexedDB's atomic update also serializes this merge across browser tabs.
      await update<WorkspaceDocuments>(WORKSPACE_RECOVERY_KEY, (previous) => {
        const deleted = [
          ...new Set([
            ...(previous?.deletedDocumentIds ?? []),
            ...(workspace.deletedDocumentIds ?? []),
          ]),
        ];
        return filterDeleted(workspace, deleted);
      });
      await clearRecovery();
      return true;
    } catch {
      return false;
    }
  });
  recoveryWrites = write;
  return write;
}
/** A valid old single-project recovery is migrated only after the new write succeeds. */
export async function loadWorkspaceRecovery(): Promise<WorkspaceDocuments | null> {
  try {
    await recoveryWrites;
    const value = await get<unknown>(WORKSPACE_RECOVERY_KEY);
    if (value) {
      validateWorkspaceDocuments(value);
      const filtered = filterDeleted(value, value.deletedDocumentIds ?? []);
      return hasWorkspaceRecovery(filtered) ? filtered : null;
    }
    const legacy = await loadRecovery();
    if (!legacy) return null;
    const migrated = createWorkspace(legacy);
    await saveWorkspaceRecovery(migrated);
    return migrated;
  } catch {
    return null;
  }
}
export async function clearWorkspaceRecovery(): Promise<void> {
  const clear = recoveryWrites.then(async () => {
    try {
      // Starting with the example clears spectra but keeps deletion identities.
      // A separate, older browser tab must never restore a project already deleted.
      await update<WorkspaceDocuments | undefined>(
        WORKSPACE_RECOVERY_KEY,
        (previous) => {
          const deleted = previous?.deletedDocumentIds ?? [];
          return deleted.length
            ? filterDeleted(createWorkspace(), deleted)
            : undefined;
        },
      );
      await clearRecovery();
    } catch {
      /* Storage may be unavailable. */
    }
  });
  recoveryWrites = clear;
  await clear;
}
