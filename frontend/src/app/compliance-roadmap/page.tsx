"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Loader2,
  MapPinned,
  Plus,
  Save,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Task } from "gantt-task-react";
import { ViewMode } from "gantt-task-react";

import {
  getComplianceRoadmap,
  getDownloadUrl,
  listAssignableMembers,
  listDocuments,
  listWorkspaces,
  patchComplianceRoadmap,
  type ComplianceRoadmapPhase,
  type ComplianceRoadmapTask,
  type FileItem,
  type FolderItem,
  type Workspace,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import "gantt-task-react/dist/index.css";

const Gantt = dynamic(
  () => import("gantt-task-react").then((m) => m.Gantt),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
        Loading chart…
      </div>
    ),
  },
);

function sortPhases(phases: ComplianceRoadmapPhase[]): ComplianceRoadmapPhase[] {
  return [...phases].sort((a, b) => a.order - b.order);
}

function defaultDateRange(): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function newTask(): ComplianceRoadmapTask {
  const { start, end } = defaultDateRange();
  return {
    id: crypto.randomUUID(),
    title: "New task",
    description: "",
    start,
    end,
    file_paths: [],
    links: [],
    assignee_email: null,
  };
}

function newPhase(order: number): ComplianceRoadmapPhase {
  return {
    id: crypto.randomUUID(),
    name: "New phase",
    order,
    tasks: [newTask()],
  };
}

function parseRoadmapDate(s: string): Date {
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function roadmapToGanttTasks(phases: ComplianceRoadmapPhase[]): Task[] {
  const sorted = sortPhases(phases);
  const out: Task[] = [];
  for (const ph of sorted) {
    const taskRows = ph.tasks.map((t) => ({
      start: parseRoadmapDate(t.start),
      end: parseRoadmapDate(t.end),
    }));
    let projStart: Date;
    let projEnd: Date;
    if (taskRows.length) {
      projStart = new Date(Math.min(...taskRows.map((r) => r.start.getTime())));
      projEnd = new Date(Math.max(...taskRows.map((r) => r.end.getTime())));
    } else {
      projStart = new Date();
      projEnd = new Date(projStart);
      projEnd.setDate(projEnd.getDate() + 7);
    }
    out.push({
      id: ph.id,
      type: "project",
      name: ph.name,
      start: projStart,
      end: projEnd,
      progress: 0,
      isDisabled: true,
    });
    for (const t of ph.tasks) {
      out.push({
        id: t.id,
        type: "task",
        name: t.title,
        start: parseRoadmapDate(t.start),
        end: parseRoadmapDate(t.end),
        progress: 0,
        project: ph.id,
      });
    }
  }
  return out;
}

function movePhase(
  phases: ComplianceRoadmapPhase[],
  phaseId: string,
  dir: -1 | 1,
): ComplianceRoadmapPhase[] {
  const sorted = sortPhases(phases);
  const idx = sorted.findIndex((p) => p.id === phaseId);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= sorted.length) return phases;
  const arr = sorted.map((p) => ({ ...p }));
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  return arr.map((p, i) => ({ ...p, order: i }));
}

function moveTask(
  phase: ComplianceRoadmapPhase,
  taskId: string,
  dir: -1 | 1,
): ComplianceRoadmapPhase {
  const tasks = [...phase.tasks];
  const idx = tasks.findIndex((t) => t.id === taskId);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= tasks.length) return phase;
  [tasks[idx], tasks[j]] = [tasks[j], tasks[idx]];
  return { ...phase, tasks };
}

type FilePickerProps = {
  workspaceId: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

function FilePickerModal({ workspaceId, onClose, onPick }: FilePickerProps) {
  const [path, setPath] = useState("/");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { folders: f, files: fl } = await listDocuments(workspaceId, path);
      setFolders(f);
      setFiles(fl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to list files");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const segments = path.replace(/\/$/, "").split("/").filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[min(520px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">Pick workspace file</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-zinc-100"
            onClick={() => setPath("/")}
          >
            /
          </button>
          {segments.map((seg, i) => {
            const prefix = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={prefix} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-zinc-400" />
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 hover:bg-zinc-100"
                  onClick={() => setPath(prefix)}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : (
            <ul className="space-y-0.5">
              {folders.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-50"
                    onClick={() => setPath(f.path)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-amber-600/90" />
                    {f.name}
                    <ChevronDown className="ml-auto h-3.5 w-3.5 -rotate-90 text-zinc-400" />
                  </button>
                </li>
              ))}
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100"
                    onClick={() => {
                      onPick(file.path);
                      onClose();
                    }}
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="ml-auto truncate text-xs text-zinc-400">{file.path}</span>
                  </button>
                </li>
              ))}
              {!folders.length && !files.length && (
                <p className="py-8 text-center text-sm text-zinc-500">This folder is empty.</p>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type PanelView = "table" | "gantt";

const PHASE_ACCENTS: { rail: string; head: string; badge: string }[] = [
  { rail: "border-l-violet-600", head: "bg-violet-50/50", badge: "bg-violet-100 text-violet-800" },
  { rail: "border-l-sky-600", head: "bg-sky-50/60", badge: "bg-sky-100 text-sky-900" },
  { rail: "border-l-amber-500", head: "bg-amber-50/60", badge: "bg-amber-100 text-amber-900" },
  { rail: "border-l-emerald-600", head: "bg-emerald-50/50", badge: "bg-emerald-100 text-emerald-900" },
  { rail: "border-l-rose-500", head: "bg-rose-50/50", badge: "bg-rose-100 text-rose-900" },
];

export default function ComplianceRoadmapPage() {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [phases, setPhases] = useState<ComplianceRoadmapPhase[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [panelView, setPanelView] = useState<PanelView>("table");
  const [picker, setPicker] = useState<{ phaseId: string; taskId: string } | null>(null);
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [assignableMembers, setAssignableMembers] = useState<string[]>([]);

  const canView = user?.role === "INVARIANT" || user?.role === "ADMIN" || user?.role === "CLIENT";
  const canEdit = user?.role === "INVARIANT" || user?.role === "ADMIN";

  useEffect(() => {
    if (!user) return;
    if (user.role === "CLIENT") {
      setPanelView("gantt");
    } else {
      setPanelView("table");
    }
  }, [user]);

  const loadRoadmap = useCallback(async () => {
    if (!workspaceId || !canView) return;
    setLoading(true);
    setLoadError("");
    try {
      const data = await getComplianceRoadmap(workspaceId);
      const next = sortPhases(data.phases);
      setPhases(next.length ? next : []);
      setUpdatedAt(data.updated_at);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load roadmap";
      setLoadError(msg);
      setPhases([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canView]);

  useEffect(() => {
    if (authLoading || !user || !canView) return;
    let cancelled = false;
    void (async () => {
      try {
        const ws = await listWorkspaces();
        if (cancelled) return;
        setWorkspaces(ws);
        if (ws.length) setWorkspaceId((prev) => prev || ws[0].id);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load workspaces");
      }
      try {
        const members = await listAssignableMembers();
        if (!cancelled) setAssignableMembers(members.filter((m) => m.allowed).map((m) => m.email));
      } catch {
        if (!cancelled) setAssignableMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, canView]);

  useEffect(() => {
    if (!workspaceId || !canView) return;
    queueMicrotask(() => void loadRoadmap());
  }, [workspaceId, canView, loadRoadmap]);

  const ganttTasks = useMemo(() => roadmapToGanttTasks(phases), [phases]);

  const save = async () => {
    if (!workspaceId || !canEdit) return;
    setSaving(true);
    try {
      const body = { phases: sortPhases(phases) };
      const out = await patchComplianceRoadmap(workspaceId, body);
      setPhases(sortPhases(out.phases));
      setUpdatedAt(out.updated_at);
      toast.success("Roadmap saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openFile = async (filePath: string) => {
    if (!workspaceId) return;
    try {
      const { url } = await getDownloadUrl(workspaceId, filePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open file");
    }
  };

  const onGanttDateChange = (task: Task) => {
    if (task.type !== "task") return true;
    const start = task.start.toISOString().slice(0, 10);
    const end = task.end.toISOString().slice(0, 10);
    setPhases((prev) =>
      prev.map((ph) => ({
        ...ph,
        tasks: ph.tasks.map((t) => (t.id === task.id ? { ...t, start, end } : t)),
      })),
    );
    return true;
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm">
        <MapPinned className="mx-auto h-10 w-10 text-zinc-400" />
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">Compliance roadmap</h1>
        <p className="mt-2 text-sm text-zinc-600">
          This area is only available to Invariant consultants and workspace admins.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none pb-10">
      <div className="flex flex-col gap-3 border-b border-zinc-200 pb-3 md:flex-row md:items-end md:justify-between lg:gap-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
            Compliance roadmap
          </h1>
          <p className="mt-0.5 text-sm text-zinc-600">
            Phased tasks, workspace file links, and timeline. Saved to workspace storage.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <span className="shrink-0">Workspace</span>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPanelView("table")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors",
                panelView === "table"
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
              )}
            >
              <Table2 className="h-4 w-4" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setPanelView("gantt")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors",
                panelView === "gantt"
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
              )}
            >
              <MapPinned className="h-4 w-4" />
              Gantt
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !workspaceId}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            ) : (
              <span className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
                Read-only view
              </span>
            )}
          </div>
        </div>
      </div>

      {updatedAt && (
        <p className="mt-2 text-xs text-zinc-500">
          Last saved: {new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}

      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      ) : panelView === "gantt" ? (
        <div className="mt-4 w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          {ganttTasks.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              Add a phase in table view to see the Gantt chart.
            </p>
          ) : (
            <div className="w-full min-w-[720px]">
              <Gantt
                tasks={ganttTasks}
                viewMode={ViewMode.Week}
                onDateChange={canEdit ? onGanttDateChange : undefined}
                listCellWidth="200px"
                columnWidth={60}
                ganttHeight={440}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-500 md:hidden">
            Tip: scroll horizontally to see the full timeline on small screens.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                const sorted = sortPhases(phases);
                const nextOrder = sorted.length ? Math.max(...sorted.map((p) => p.order)) + 1 : 0;
                setPhases([...phases, newPhase(nextOrder)]);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
            >
              <Plus className="h-4 w-4" />
              Add phase
            </button>
          )}

          {sortPhases(phases).map((phase, phaseIdx) => {
            const accent = PHASE_ACCENTS[phaseIdx % PHASE_ACCENTS.length];
            return (
            <div
              key={phase.id}
              className={cn(
                "overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm border-l-4",
                accent.rail,
              )}
            >
              <div
                className={cn(
                  "flex flex-col gap-2.5 border-b border-zinc-100 px-4 py-2.5 sm:flex-row sm:items-center",
                  accent.head,
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold",
                    accent.badge,
                  )}
                >
                  {phaseIdx + 1}
                </span>
                <input
                  value={phase.name}
                  onChange={(e) =>
                    setPhases((prev) =>
                      prev.map((p) => (p.id === phase.id ? { ...p, name: e.target.value } : p)),
                    )
                  }
                  disabled={!canEdit}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-600"
                  placeholder="Phase name"
                />
                {canEdit && <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    disabled={phaseIdx === 0}
                    onClick={() => setPhases((p) => movePhase(p, phase.id, -1))}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    disabled={phaseIdx >= sortPhases(phases).length - 1}
                    onClick={() => setPhases((p) => movePhase(p, phase.id, 1))}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPhases((prev) =>
                        prev.map((p) =>
                          p.id === phase.id ? { ...p, tasks: [...p.tasks, newTask()] } : p,
                        ),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Task
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Delete this phase and all its tasks?")) return;
                      setPhases((prev) => prev.filter((p) => p.id !== phase.id));
                    }}
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                    aria-label="Delete phase"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>}
              </div>

              <div className="divide-y divide-zinc-100">
                {phase.tasks.map((task, taskIdx) => (
                  <div key={task.id} className="bg-white px-4 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          value={task.title}
                          onChange={(e) =>
                            setPhases((prev) =>
                              prev.map((p) =>
                                p.id === phase.id
                                  ? {
                                      ...p,
                                      tasks: p.tasks.map((t) =>
                                        t.id === task.id ? { ...t, title: e.target.value } : t,
                                      ),
                                    }
                                  : p,
                              ),
                            )
                          }
                          disabled={!canEdit}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-600"
                          placeholder="Task title"
                        />
                        <textarea
                          value={task.description}
                          onChange={(e) =>
                            setPhases((prev) =>
                              prev.map((p) =>
                                p.id === phase.id
                                  ? {
                                      ...p,
                                      tasks: p.tasks.map((t) =>
                                        t.id === task.id ? { ...t, description: e.target.value } : t,
                                      ),
                                    }
                                  : p,
                              ),
                            )
                          }
                          rows={2}
                          disabled={!canEdit}
                          className="w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 disabled:bg-zinc-50 disabled:text-zinc-600"
                          placeholder="Description"
                        />
                        <div className="flex flex-wrap gap-2">
                          <label className="flex items-center gap-1 text-xs text-zinc-600">
                            Start
                            <input
                              type="date"
                              value={task.start.slice(0, 10)}
                              onChange={(e) =>
                                setPhases((prev) =>
                                  prev.map((p) =>
                                    p.id === phase.id
                                      ? {
                                          ...p,
                                          tasks: p.tasks.map((t) =>
                                            t.id === task.id ? { ...t, start: e.target.value } : t,
                                          ),
                                        }
                                      : p,
                                  ),
                                )
                              }
                              disabled={!canEdit}
                              className="rounded border border-zinc-200 px-2 py-1 text-sm disabled:bg-zinc-50 disabled:text-zinc-600"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-zinc-600">
                            End
                            <input
                              type="date"
                              value={task.end.slice(0, 10)}
                              onChange={(e) =>
                                setPhases((prev) =>
                                  prev.map((p) =>
                                    p.id === phase.id
                                      ? {
                                          ...p,
                                          tasks: p.tasks.map((t) =>
                                            t.id === task.id ? { ...t, end: e.target.value } : t,
                                          ),
                                        }
                                      : p,
                                  ),
                                )
                              }
                              disabled={!canEdit}
                              className="rounded border border-zinc-200 px-2 py-1 text-sm disabled:bg-zinc-50 disabled:text-zinc-600"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-zinc-600">
                            Assignee
                            <select
                              value={task.assignee_email ?? ""}
                              onChange={(e) =>
                                setPhases((prev) =>
                                  prev.map((p) =>
                                    p.id === phase.id
                                      ? {
                                          ...p,
                                          tasks: p.tasks.map((t) =>
                                            t.id === task.id ? { ...t, assignee_email: e.target.value || null } : t,
                                          ),
                                        }
                                      : p,
                                  ),
                                )
                              }
                              disabled={!canEdit}
                              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 disabled:bg-zinc-50 disabled:text-zinc-600"
                            >
                              <option value="">Unassigned</option>
                              {assignableMembers.map((email) => (
                                <option key={email} value={email}>
                                  {email}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                      <div className="w-full shrink-0 space-y-2 lg:w-64">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Linked files
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {task.file_paths.map((fp) => (
                            <button
                              key={fp}
                              type="button"
                              onClick={() => void openFile(fp)}
                              className="max-w-full truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-900 hover:bg-zinc-100"
                              title={fp}
                            >
                              {fp.split("/").pop() || fp}
                            </button>
                          ))}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setPicker({ phaseId: phase.id, taskId: task.id })}
                              className="rounded-md border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
                            >
                              + File
                            </button>
                          )}
                        </div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Links
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {task.links.map((link) => (
                            <a
                              key={link}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-full truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-zinc-100"
                            >
                              {link.replace(/^https?:\/\//, "").slice(0, 40)}
                              {link.length > 40 ? "…" : ""}
                            </a>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input
                            value={linkDraft[task.id] ?? ""}
                            onChange={(e) =>
                              setLinkDraft((d) => ({ ...d, [task.id]: e.target.value }))
                            }
                            placeholder="https://…"
                            disabled={!canEdit}
                            className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs disabled:bg-zinc-50 disabled:text-zinc-600"
                            onKeyDown={(e) => {
                              if (!canEdit) return;
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const raw = (linkDraft[task.id] ?? "").trim();
                              if (!raw) return;
                              let url = raw;
                              if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                              setPhases((prev) =>
                                prev.map((p) =>
                                  p.id === phase.id
                                    ? {
                                        ...p,
                                        tasks: p.tasks.map((t) =>
                                          t.id === task.id
                                            ? { ...t, links: [...t.links, url] }
                                            : t,
                                        ),
                                      }
                                    : p,
                                ),
                              );
                              setLinkDraft((d) => ({ ...d, [task.id]: "" }));
                            }}
                          />
                        </div>
                        {canEdit && <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                            disabled={taskIdx === 0}
                            onClick={() =>
                              setPhases((prev) =>
                                prev.map((p) =>
                                  p.id === phase.id ? moveTask(p, task.id, -1) : p,
                                ),
                              )
                            }
                          >
                            Task ↑
                          </button>
                          <button
                            type="button"
                            className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                            disabled={taskIdx >= phase.tasks.length - 1}
                            onClick={() =>
                              setPhases((prev) =>
                                prev.map((p) =>
                                  p.id === phase.id ? moveTask(p, task.id, 1) : p,
                                ),
                              )
                            }
                          >
                            Task ↓
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPhases((prev) =>
                                prev.map((p) =>
                                  p.id === phase.id
                                    ? { ...p, tasks: p.tasks.filter((t) => t.id !== task.id) }
                                    : p,
                                ),
                              )
                            }
                            className="ml-auto text-xs text-red-600 hover:underline"
                          >
                            Remove task
                          </button>
                        </div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
          })}

          {!phases.length && !loadError && (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 py-10 text-center text-sm text-zinc-600">
              No phases yet. Add a phase to start your compliance roadmap.
            </p>
          )}
        </div>
      )}

      {picker && workspaceId && (
        <FilePickerModal
          workspaceId={workspaceId}
          onClose={() => setPicker(null)}
          onPick={(filePath) => {
            setPhases((prev) =>
              prev.map((ph) => {
                if (ph.id !== picker.phaseId) return ph;
                return {
                  ...ph,
                  tasks: ph.tasks.map((t) => {
                    if (t.id !== picker.taskId) return t;
                    if (t.file_paths.includes(filePath)) return t;
                    return { ...t, file_paths: [...t.file_paths, filePath] };
                  }),
                };
              }),
            );
          }}
        />
      )}
    </div>
  );
}
