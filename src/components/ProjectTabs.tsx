import { useRef, useState } from "react";
import { FileText, Plus, RotateCcw, X } from "lucide-react";
import type { WorkspaceDocument } from "../features/workspaceDocuments";
import "./ProjectTabs.css";

export interface ProjectTabsProps {
  documents: WorkspaceDocument[];
  activeDocumentId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, name: string) => void;
  onReopen?: () => void;
  closedCount?: number;
  disabled?: boolean;
}
export function ProjectTabs({
  documents,
  activeDocumentId,
  onActivate,
  onClose,
  onNew,
  onRename,
  onReopen,
  closedCount = 0,
  disabled = false,
}: ProjectTabsProps) {
  const [editing, E] = useState<string | null>(null),
    [name, N] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  function beginRename(d: WorkspaceDocument) {
    if (!onRename || disabled) return;
    N(d.project.name);
    E(d.id);
  }
  function finishRename() {
    if (editing && name.trim()) onRename?.(editing, name.trim());
    E(null);
  }
  return (
    <div className="project-tabs-bar" data-testid="project-tabs">
      <div
        className="project-tabs-list"
        role="tablist"
        aria-label="Open projects"
      >
        {documents.map((d, index) => (
          <div
            key={d.id}
            className={`project-tab ${d.id === activeDocumentId ? "is-active" : ""}`}
            role="presentation"
          >
            {editing === d.id ? (
              <input
                className="project-tab-name"
                aria-label="Project name"
                value={name}
                maxLength={200}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => N(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    finishRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    E(null);
                    buttons.current.get(d.id)?.focus();
                  }
                }}
              />
            ) : (
              <button
                className="project-tab-activate"
                role="tab"
                aria-selected={d.id === activeDocumentId}
                tabIndex={d.id === activeDocumentId ? 0 : -1}
                disabled={disabled}
                title={
                  onRename
                    ? `${d.project.name} · Double-click to rename`
                    : d.project.name
                }
                data-document-id={d.id}
                ref={(node) => {
                  if (node) buttons.current.set(d.id, node);
                  else buttons.current.delete(d.id);
                }}
                onClick={() => onActivate(d.id)}
                onDoubleClick={() => beginRename(d)}
                onKeyDown={(e) => {
                  if (e.key === "F2") {
                    e.preventDefault();
                    beginRename(d);
                    return;
                  }
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? documents.length - 1
                        : (index +
                            (e.key === "ArrowRight" ? 1 : -1) +
                            documents.length) %
                          documents.length;
                  onActivate(documents[next].id);
                  buttons.current.get(documents[next].id)?.focus();
                }}
              >
                <FileText size={14} />
                <span>{d.project.name}</span>
                {d.isDemo && <small>Example</small>}
              </button>
            )}
            <button
              className="project-tab-close"
              aria-label={`Close ${d.project.name}`}
              title="Close project · available in recently closed"
              disabled={disabled}
              onClick={() => {
                E(null);
                onClose(d.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="project-tabs-actions">
        <button
          className="project-new-tab"
          onClick={onNew}
          disabled={disabled}
          aria-label="New project"
          title="New blank project"
        >
          <Plus size={15} />
          <span>New</span>
        </button>
        {onReopen && closedCount > 0 && (
          <button
            className="project-reopen-tab"
            onClick={onReopen}
            disabled={disabled}
            aria-label="Reopen last closed project"
            title={`Reopen last closed project · ${closedCount} available`}
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
