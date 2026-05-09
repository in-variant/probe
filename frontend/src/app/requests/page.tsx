"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";

import {
  createDocumentRequest,
  cancelDocumentRequest,
  fulfillDocumentRequest,
  listDocumentRequests,
  listWorkspaces,
  type DocumentRequest,
  type Workspace,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 15;

type StatusFilter = "all" | "open" | "fulfilled" | "cancelled";

function formatRequestDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today at ${time}`;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "open")
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80";
  if (s === "fulfilled")
    return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80";
  if (s === "cancelled") return "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200";
  return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
}

export default function RequestsPage() {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [desiredPath, setDesiredPath] = useState("");
  const [busy, setBusy] = useState(false);

  const canCreate = user?.role === "INVARIANT" || user?.role === "ADMIN";
  const canFulfill = user?.role === "CLIENT" || user?.role === "ADMIN";

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const list = await listDocumentRequests(workspaceId);
      setRequests(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const ws = await listWorkspaces();
        if (cancelled) return;
        setWorkspaces(ws);
        if (ws.length) {
          setWorkspaceId((prev) => prev || ws[0].id);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load workspaces");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!workspaceId) return;
    queueMicrotask(() => void refresh());
  }, [workspaceId, refresh]);

  useEffect(() => {
    setPage(0);
  }, [workspaceId, search, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${r.title} ${r.body} ${r.desired_path} ${r.created_by_email} ${r.stored_path ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [requests, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !title.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createDocumentRequest(workspaceId, {
        title: title.trim(),
        body: body.trim(),
        desired_path: desiredPath.trim() || undefined,
      });
      setTitle("");
      setBody("");
      setDesiredPath("");
      setModalOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create request");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    if (!workspaceId || !window.confirm("Cancel this request?")) return;
    setBusy(true);
    try {
      await cancelDocumentRequest(workspaceId, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setBusy(false);
    }
  }

  async function handleFulfill(id: string, fileList: FileList | null) {
    if (!workspaceId || !fileList?.length) return;
    setBusy(true);
    try {
      await fulfillDocumentRequest(workspaceId, id, fileList[0]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="flex min-h-[16rem] items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;

  return (
    <div className="min-h-0 w-full max-w-6xl mx-auto space-y-3 px-1 sm:px-0">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-white">
              <Inbox className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900">
                Document requests
                <span className="ml-1.5 text-sm font-normal text-zinc-400">({filtered.length})</span>
              </h1>
              <p className="mt-0.5 max-w-xl text-xs leading-snug text-zinc-500">
                Invariant raises requests; clients upload into the workspace and knowledge base.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {workspaces.length > 0 && (
              <select
                value={workspaceId}
                onChange={(ev) => setWorkspaceId(ev.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/60"
                aria-label="Workspace"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                disabled={!workspaceId || busy}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                New request
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, notes, path, requester…"
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "open", "fulfilled", "cancelled"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                  statusFilter === s
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {modalOpen && canCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-request-title"
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
              <h2 id="new-request-title" className="text-base font-semibold text-zinc-900">
                New request
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Workspace: {workspaceName}</p>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/50"
                required
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Description / notes"
                rows={4}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/50"
              />
              <input
                value={desiredPath}
                onChange={(e) => setDesiredPath(e.target.value)}
                placeholder="Desired path (optional), e.g. docs/ or reports/spec.pdf"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/50"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !workspaceId}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading requests…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            No requests match your filters for this workspace.
          </p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Requester</th>
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <tr key={r.id} className="align-top border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/80">
                      <td className="max-w-[min(28rem,40vw)] px-4 py-2.5">
                        <p className="font-medium text-zinc-900">{r.title}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{formatRequestDate(r.created_at)}</p>
                        {r.body ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-600">{r.body}</p>
                        ) : null}
                        {r.status === "fulfilled" && r.stored_path ? (
                          <p className="mt-1 text-[11px] text-emerald-700">Saved: {r.stored_path}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-800">
                        <span className="text-sm">{r.created_by_name || r.created_by_email}</span>
                        <span className="mt-0.5 block text-[11px] text-zinc-500">{r.created_by_email}</span>
                      </td>
                      <td className="max-w-[10rem] px-3 py-2.5">
                        <span className="block truncate text-xs text-zinc-600" title={r.desired_path || "—"}>
                          {r.desired_path || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize",
                            statusBadge(r.status),
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-2">
                          {r.status === "open" && canFulfill && (
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
                              <Upload className="h-3.5 w-3.5" />
                              Upload
                              <input
                                type="file"
                                className="hidden"
                                disabled={busy}
                                onChange={(ev) => void handleFulfill(r.id, ev.target.files)}
                              />
                            </label>
                          )}
                          {r.status === "open" && canCreate && (
                            <button
                              type="button"
                              onClick={() => void handleCancel(r.id)}
                              disabled={busy}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-zinc-100 md:hidden">
              {slice.map((r) => (
                <div key={r.id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900">{r.title}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{formatRequestDate(r.created_at)}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize",
                        statusBadge(r.status),
                      )}
                    >
                      {r.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    <span className="font-medium text-zinc-700">From:</span> {r.created_by_email}
                  </p>
                  {r.desired_path ? (
                    <p className="text-[11px] text-zinc-600">
                      <span className="font-medium text-zinc-700">Path:</span> {r.desired_path}
                    </p>
                  ) : null}
                  {r.body ? <p className="text-xs leading-snug text-zinc-700">{r.body}</p> : null}
                  {r.status === "fulfilled" && r.stored_path ? (
                    <p className="text-xs text-emerald-700">Saved: {r.stored_path}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {r.status === "open" && canFulfill && (
                      <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-800">
                        <Upload className="h-3.5 w-3.5" />
                        Upload file
                        <input
                          type="file"
                          className="hidden"
                          disabled={busy}
                          onChange={(ev) => void handleFulfill(r.id, ev.target.files)}
                        />
                      </label>
                    )}
                    {r.status === "open" && canCreate && (
                      <button
                        type="button"
                        onClick={() => void handleCancel(r.id)}
                        disabled={busy}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-col items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2 sm:flex-row">
                <p className="text-[11px] text-zinc-500">
                  Page {safePage + 1} of {pageCount} · {filtered.length} total
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-40"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
