"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Settings,
  Trash2,
  FolderOpen,
  ArrowUpDown,
  ChevronDown,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate, formatRelativeDate } from "@/lib/utils";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  type Workspace,
} from "@/lib/api";

type StatusFilter = "all" | "active" | "on-hold" | "completed";
type SortKey = "updated_at" | "name" | "created_at";

const STATUS_CONFIG: Record<string, { label: string; style: string }> = {
  active: { label: "Active", style: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
  "on-hold": { label: "On Hold", style: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  completed: { label: "Completed", style: "bg-sky-50 text-sky-700 ring-1 ring-sky-100" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.active;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", config.style)}>
      {config.label}
    </span>
  );
}

// ── Workspace Settings Drawer ────────────────────────────────────

function WorkspaceSettingsDrawer({
  workspace,
  onClose,
  onSaved,
  onDeleted,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [status, setStatus] = useState(workspace.status);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const hasChanges = name.trim() !== workspace.name || status !== workspace.status;

  async function handleSave() {
    if (!hasChanges || !name.trim()) return;
    setError("");
    setSaving(true);
    try {
      const updates: { name?: string; status?: string } = {};
      if (name.trim() !== workspace.name) updates.name = name.trim();
      if (status !== workspace.status) updates.status = status;
      await updateWorkspace(workspace.id, updates);
      onSaved();
    } catch (err) {
      if (err instanceof Error && err.message.includes("409")) {
        setError("A workspace with this name already exists");
      } else {
        toast.error("Failed to save workspace settings");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      toast.success("Workspace deleted");
      onDeleted();
      onClose();
    } catch {
      toast.error("Failed to delete workspace");
    } finally {
      setDeleting(false);
    }
  }

  const totalItems = workspace.file_count + workspace.folder_count;

  return (
    <>
      <button
        onClick={onClose}
        className="fixed inset-0 z-40 bg-zinc-900/25 transition-opacity pointer-events-auto opacity-100"
      />
      <aside className="fixed inset-0 z-50 h-dvh w-full animate-slide-in-right bg-white shadow-xl sm:inset-auto sm:right-0 sm:top-0 sm:max-w-[520px] sm:border-l sm:border-zinc-200">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Workspace settings</p>
              <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                <FolderOpen className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold tracking-[-0.02em] text-zinc-900">{workspace.name}</h3>
                <p className="font-mono text-xs text-zinc-400">{workspace.slug}</p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-5 text-sm sm:px-5">
            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="text-xs text-zinc-500">Name</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(""); }}
                  className={cn(
                    "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none",
                    error
                      ? "border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                      : "border-zinc-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
                  )}
                />
                {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
              </div>

              {/* Slug (read-only) */}
              <div>
                <label className="text-xs text-zinc-500">Slug</label>
                <p className="mt-1 font-mono text-sm text-zinc-600">{workspace.slug}</p>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs text-zinc-500">Status</label>
                <div className="mt-1.5 flex gap-2">
                  {(["active", "on-hold", "completed"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        status === s
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-zinc-200 text-zinc-500 hover:bg-zinc-50",
                      )}
                    >
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Files</label>
                  <p className="mt-1 text-sm text-zinc-800">{workspace.file_count}</p>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Folders</label>
                  <p className="mt-1 text-sm text-zinc-800">{workspace.folder_count}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Created</label>
                  <p className="mt-1 text-sm text-zinc-800">{formatDate(workspace.created_at)}</p>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Last Modified</label>
                  <p className="mt-1 text-sm text-zinc-800">{formatDate(workspace.updated_at)}</p>
                </div>
              </div>

              {/* Danger zone */}
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <p className="text-xs font-medium text-rose-700">Danger Zone</p>
                <p className="mt-1 text-xs text-rose-600/80">
                  Deleting this workspace will permanently remove all files and folders inside it.
                </p>
                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Workspace
                  </button>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Confirm Delete"}
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-4 sm:px-5">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || !name.trim() || saving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Workspace Card ───────────────────────────────────────────────

function WorkspaceCard({
  workspace,
  onSettings,
}: {
  workspace: Workspace;
  onSettings: (ws: Workspace) => void;
}) {
  const router = useRouter();
  const totalItems = workspace.file_count + workspace.folder_count;

  return (
    <div
      className={cn(
        "group relative cursor-pointer rounded-xl border border-zinc-200 bg-white p-5 transition-all duration-200",
        "hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5",
      )}
      onClick={() => router.push(`/workspaces/${workspace.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-[-0.02em] text-zinc-900">{workspace.name}</h3>
              <p className="mt-0.5 truncate font-mono text-xs text-zinc-400">{workspace.slug}</p>
            </div>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onSettings(workspace);
          }}
          className={cn(
            "rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600",
            "sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100",
          )}
          title="Workspace settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4">
        <StatusBadge status={workspace.status} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
        <span>Updated {formatRelativeDate(workspace.updated_at)}</span>
      </div>

      <div className="mt-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-blue-400 transition-all"
            style={{ width: `${Math.min(100, totalItems * 5)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Create Workspace Modal ───────────────────────────────────────

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setLoading(true);
    try {
      await createWorkspace(name.trim(), status);
      onCreated();
      onClose();
    } catch (err) {
      setLoading(false);
      if (err instanceof Error && err.message.includes("409")) {
        setError("A workspace with this name already exists");
      } else {
        setError("Failed to create workspace");
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm animate-fade-in sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-6 shadow-xl animate-slide-down sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-zinc-900">New Workspace</h2>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder="My Workspace"
              className={cn(
                "mt-1.5 w-full rounded-lg border bg-white px-4 py-2.5 text-sm outline-none transition-colors",
                error
                  ? "border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  : "border-zinc-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
              )}
            />
            {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Status</label>
            <div className="mt-1.5 flex gap-2">
              {(["active", "on-hold", "completed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    status === s
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50",
                  )}
                >
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">Cancel</button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Workspaces View ─────────────────────────────────────────

export function WorkspacesView() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<Workspace | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await listWorkspaces();
      setWorkspaces(data);
    } catch {
      toast.error("Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  useEffect(() => {
    if (!sortDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortDropdownOpen]);

  const filtered = useMemo(() => {
    let result = workspaces;
    if (statusFilter !== "all") {
      result = result.filter((ws) => ws.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((ws) => ws.name.toLowerCase().includes(q) || ws.slug.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "created_at") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return result;
  }, [workspaces, statusFilter, search, sortKey]);

  const SORT_LABELS: Record<SortKey, string> = {
    updated_at: "Last updated",
    name: "Name",
    created_at: "Created",
  };

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "on-hold", label: "On Hold" },
    { key: "completed", label: "Completed" },
  ];

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
        <div className="border-b border-zinc-200/70 px-4 pb-3 pt-5 md:px-6 md:pt-6">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-zinc-100" />
          <div className="mt-4 h-8 w-96 animate-pulse rounded-xl bg-zinc-100" />
        </div>
        <div className="px-4 pb-10 pt-5 md:px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-14 min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white lg:mb-0">
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="border-b border-zinc-200/70 bg-white/70 px-4 pb-3 pt-5 md:px-6 md:pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-medium text-zinc-900">Workspaces</h1>
              <p className="mt-0.5 text-sm text-zinc-500">
                {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-28 bg-transparent text-sm text-zinc-700 outline-none placeholder:text-zinc-400 sm:w-44"
                />
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition cursor-pointer hover:bg-blue-700 active:bg-blue-800"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Workspace</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>

          {/* Filter + Sort row */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="inline-flex overflow-x-auto overflow-hidden rounded-full border border-zinc-200 bg-white">
              {STATUS_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-medium transition-colors",
                    statusFilter === key
                      ? "bg-blue-50 text-blue-700"
                      : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {SORT_LABELS[sortKey]}
                <ChevronDown className="h-3 w-3" />
              </button>
              {sortDropdownOpen && (
                <div className="animate-slide-down absolute right-0 top-9 z-10 w-36 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                  {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setSortKey(key); setSortDropdownOpen(false); }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-xs",
                        sortKey === key ? "bg-blue-50 font-medium text-blue-700" : "text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-xs text-zinc-400" aria-live="polite">
            {filtered.length} of {workspaces.length} shown
          </p>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-6">
          {filtered.length === 0 && workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="rounded-2xl border-2 border-dashed border-zinc-300 p-12 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100">
                  <FolderOpen className="h-8 w-8 text-zinc-400" />
                </div>
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-zinc-900">No workspaces yet</h3>
                <p className="mt-1 text-sm text-zinc-500">Create your first workspace to start organizing documents.</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> Create Workspace
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 text-sm text-zinc-500">No workspaces match your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((ws) => (
                <WorkspaceCard
                  key={ws.id}
                  workspace={ws}
                  onSettings={(ws) => setSettingsTarget(ws)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchWorkspaces}
        />
      )}

      {/* Settings drawer */}
      {settingsTarget && (
        <WorkspaceSettingsDrawer
          workspace={settingsTarget}
          onClose={() => setSettingsTarget(null)}
          onSaved={() => {
            fetchWorkspaces();
            setSettingsTarget(null);
          }}
          onDeleted={fetchWorkspaces}
        />
      )}
    </div>
  );
}
