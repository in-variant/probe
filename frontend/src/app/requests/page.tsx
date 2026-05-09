"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";

import {
  assignDocumentRequest,
  cancelDocumentRequest,
  createDocumentRequest,
  deleteDocumentRequest,
  createRequestComment,
  fulfillDocumentRequest,
  getDownloadUrl,
  listDocumentRequests,
  listAssignableMembers,
  listRequestComments,
  replyToRequestComment,
  type DocumentRequest,
  type MemberRoleRecord,
  type RequestComment,
  type Workspace,
  listWorkspaces,
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
    const time = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    if (sameDay) return `Today at ${time}`;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
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
  if (s === "cancelled")
    return "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200";
  return "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200";
}

function initials(name: string, email: string): string {
  const src = name || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// ─── Detail modal ──────────────────────────────────────────────

function RequestDetailModal({
  req,
  workspaceId,
  members,
  canCreate,
  canFulfill,
  userEmail,
  onClose,
  onRefresh,
}: {
  req: DocumentRequest;
  workspaceId: string;
  members: MemberRoleRecord[];
  canCreate: boolean;
  canFulfill: boolean;
  userEmail: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"details" | "comments">("details");
  const [comments, setComments] = useState<RequestComment[]>(
    req.comments ?? [],
  );
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ workspaceId: string; path: string } | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        assigneeRef.current &&
        !assigneeRef.current.contains(e.target as Node)
      )
        setAssigneeOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const { comments: list } = await listRequestComments(
        workspaceId,
        req.id,
      );
      setComments(list);
    } catch {
      /* silent */
    } finally {
      setLoadingComments(false);
    }
  }, [workspaceId, req.id]);

  const handleTabChange = useCallback(
    (t: "details" | "comments") => {
      setTab(t);
      if (t === "comments") void fetchComments();
    },
    [fetchComments],
  );

  async function handleAddComment() {
    if (!newComment.trim()) return;
    setBusy(true);
    try {
      await createRequestComment(workspaceId, req.id, newComment.trim());
      setNewComment("");
      await fetchComments();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(commentId: string) {
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await replyToRequestComment(
        workspaceId,
        req.id,
        commentId,
        replyText.trim(),
      );
      setReplyText("");
      setReplyingTo(null);
      await fetchComments();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(email: string | null) {
    setBusy(true);
    try {
      await assignDocumentRequest(workspaceId, req.id, email);
      setAssigneeOpen(false);
      onRefresh();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const result = await fulfillDocumentRequest(workspaceId, req.id, files[0]);
      setUploadResult({ workspaceId, path: result.stored_path });
      onRefresh();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function openUploadedFile(path: string) {
    try {
      const { url } = await getDownloadUrl(workspaceId, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* silent */
    }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel this request?")) return;
    setBusy(true);
    try {
      await cancelDocumentRequest(workspaceId, req.id);
      onRefresh();
      onClose();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Permanently delete this request?")) return;
    setBusy(true);
    try {
      await deleteDocumentRequest(workspaceId, req.id);
      onRefresh();
      onClose();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  const isRequestor =
    userEmail.toLowerCase() === req.created_by_email.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        className="flex h-[60vh] min-h-[28rem] max-h-[60vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-zinc-900">
                {req.title}
              </h2>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize",
                  statusBadge(req.status),
                )}
              >
                {req.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              By {req.created_by_name || req.created_by_email} ·{" "}
              {formatRequestDate(req.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Assignee row */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-2.5">
          <span className="text-xs font-medium text-zinc-500">Assignee</span>
          <div className="relative" ref={assigneeRef}>
            <button
              type="button"
              onClick={() => setAssigneeOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              {req.assignee_email ? (
                <>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600">
                    {initials(req.assignee_name ?? "", req.assignee_email)}
                  </span>
                  {req.assignee_email}
                </>
              ) : (
                <>
                  <User className="h-3.5 w-3.5 text-zinc-400" />
                  Unassigned
                </>
              )}
              <ChevronDown className="h-3 w-3 text-zinc-400" />
            </button>
            {assigneeOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => void handleAssign(null)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50"
                >
                  <User className="h-3.5 w-3.5" />
                  Unassigned
                </button>
                {members.map((m) => (
                  <button
                    key={m.email}
                    type="button"
                    onClick={() => void handleAssign(m.email)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50",
                      m.email === req.assignee_email
                        ? "bg-zinc-50 font-medium text-zinc-900"
                        : "text-zinc-700",
                    )}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600">
                      {initials("", m.email)}
                    </span>
                    <span className="truncate">{m.email}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                      {m.role}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100">
          {(["details", "comments"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleTabChange(t)}
              className={cn(
                "px-5 py-2.5 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "border-b-2 border-zinc-900 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-700",
              )}
            >
              {t === "comments" && (
                <MessageSquare className="mr-1.5 inline h-3.5 w-3.5" />
              )}
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "details" && (
            <div className="space-y-4">
              {req.body ? (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500">
                    Description
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                    {req.body}
                  </p>
                </div>
              ) : null}
              {req.desired_path ? (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500">
                    Desired path
                  </h3>
                  <p className="mt-1 font-mono text-sm text-zinc-700">
                    {req.desired_path}
                  </p>
                </div>
              ) : null}
              {req.status === "fulfilled" && req.stored_path ? (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500">
                    Stored at
                  </h3>
                  <p className="mt-1 font-mono text-sm text-emerald-700">
                    {req.stored_path}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openUploadedFile(req.stored_path!)}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Open uploaded file
                    </button>
                    <a
                      href={`/document-editor?workspace=${encodeURIComponent(workspaceId)}&file=${encodeURIComponent(req.stored_path)}`}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Open in workspace editor
                    </a>
                  </div>
                </div>
              ) : null}

              {/* Upload area */}
              {req.status === "open" && canFulfill && (
                <div className="rounded-xl border-2 border-dashed border-zinc-200 p-6 text-center">
                  <Upload className="mx-auto h-8 w-8 text-zinc-300" />
                  <p className="mt-2 text-sm font-medium text-zinc-700">
                    Upload a file to fulfill this request
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Click below to select a file
                  </p>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    <Upload className="h-4 w-4" />
                    Choose file
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      disabled={busy}
                      onChange={(ev) => void handleUpload(ev.target.files)}
                    />
                  </label>
                </div>
              )}
              {uploadResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <p className="font-medium">Upload complete</p>
                  <p className="mt-0.5 font-mono">{uploadResult.path}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300 bg-white px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-100"
                      onClick={() => void openUploadedFile(uploadResult.path)}
                    >
                      Open file
                    </button>
                    <a
                      href={`/document-editor?workspace=${encodeURIComponent(uploadResult.workspaceId)}&file=${encodeURIComponent(uploadResult.path)}`}
                      className="rounded-md border border-emerald-300 bg-white px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-100"
                    >
                      Open in workspace editor
                    </a>
                  </div>
                </div>
              )}

              {/* Cancel / Delete */}
              {(req.status === "open" && canCreate || isRequestor) && (
                <div className="flex items-center gap-2 pt-1">
                  {req.status === "open" && canCreate && (
                    <button
                      type="button"
                      onClick={() => void handleCancel()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Cancel request
                    </button>
                  )}
                  {isRequestor && (
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete request
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "comments" && (
            <div className="space-y-4">
              {loadingComments ? (
                <div className="flex items-center justify-center py-6 text-sm text-zinc-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : comments.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-400">
                  No comments yet. Start the conversation.
                </p>
              ) : (
                <div className="space-y-3">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600">
                          {initials(c.author_name, c.author_email)}
                        </span>
                        <span className="text-xs font-medium text-zinc-800">
                          {c.author_name || c.author_email}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {formatRequestDate(c.created_at)}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700">
                        {c.body}
                      </p>

                      {/* Replies */}
                      {c.replies?.length > 0 && (
                        <div className="mt-2 space-y-2 border-l-2 border-zinc-200 pl-3">
                          {c.replies.map((r) => (
                            <div key={r.id}>
                              <div className="flex items-center gap-2">
                                <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600">
                                  {initials(r.author_name, r.author_email)}
                                </span>
                                <span className="text-[11px] font-medium text-zinc-700">
                                  {r.author_name || r.author_email}
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  {formatRequestDate(r.created_at)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-zinc-600">
                                {r.body}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply toggle */}
                      {replyingTo === c.id ? (
                        <div className="mt-2 flex gap-2">
                          <input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Write a reply…"
                            className="flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs outline-none focus:border-zinc-300"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleReply(c.id);
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void handleReply(c.id)}
                            disabled={busy || !replyText.trim()}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                          >
                            <Send className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyText("");
                            }}
                            className="text-[11px] text-zinc-500 hover:text-zinc-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReplyingTo(c.id)}
                          className="mt-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-700"
                        >
                          Reply
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* New comment */}
              <div className="flex gap-2 pt-2">
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment…"
                  className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-300"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleAddComment();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleAddComment()}
                  disabled={busy || !newComment.trim()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────

export default function RequestsPage() {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [members, setMembers] = useState<MemberRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] =
    useState<DocumentRequest | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [desiredPath, setDesiredPath] = useState("");
  const [createAssignee, setCreateAssignee] = useState("");
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
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load");
      }
      try {
        const assignable = await listAssignableMembers();
        if (!cancelled) setMembers(assignable.filter((m) => m.allowed));
      } catch {
        /* fallback to empty assignable list */
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

  const uniqueAssignees = useMemo(() => {
    const set = new Set<string>();
    for (const r of requests) {
      if (r.assignee_email) set.add(r.assignee_email);
    }
    return Array.from(set).sort();
  }, [requests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned") {
          if (r.assignee_email) return false;
        } else if (r.assignee_email !== assigneeFilter) {
          return false;
        }
      }
      if (!q) return true;
      const hay =
        `${r.title} ${r.body} ${r.desired_path} ${r.created_by_email} ${r.assignee_email ?? ""} ${r.stored_path ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [requests, search, statusFilter, assigneeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

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
        assignee_email: createAssignee || undefined,
      });
      setTitle("");
      setBody("");
      setDesiredPath("");
      setCreateAssignee("");
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

  async function handleDeleteFromList(id: string) {
    if (!workspaceId || !window.confirm("Permanently delete this request?")) return;
    setBusy(true);
    try {
      await deleteDocumentRequest(workspaceId, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
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

  async function handleDetailRefresh() {
    if (!workspaceId) return;
    try {
      const list = await listDocumentRequests(workspaceId);
      setRequests(list);
      if (selectedRequest) {
        const updated = list.find((r) => r.id === selectedRequest.id);
        if (updated) setSelectedRequest(updated);
      }
    } catch {
      /* silent — main list will show the error on next load */
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

  const workspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;

  return (
    <div className="min-h-0 w-full max-w-6xl mx-auto space-y-3 px-1 sm:px-0">
      {/* Header card */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-white">
              <Inbox className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900">
                Document requests
                <span className="ml-1.5 text-sm font-normal text-zinc-400">
                  ({filtered.length})
                </span>
              </h1>
              <p className="mt-0.5 max-w-xl text-xs leading-snug text-zinc-500">
                Invariant raises requests; clients upload into the workspace and
                knowledge base.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {workspaces.length > 0 && (
              <select
                value={workspaceId}
                onChange={(ev) => { setWorkspaceId(ev.target.value); setPage(0); }}
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
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                New request
              </button>
            )}
          </div>
        </div>

        {/* Filters row */}
        <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search requests…"
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Status filter */}
            <div className="flex gap-1">
              {(["all", "open", "fulfilled", "cancelled"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatusFilter(s); setPage(0); }}
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
            {/* Assignee filter */}
            <select
              value={assigneeFilter}
              onChange={(e) => { setAssigneeFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 outline-none"
              aria-label="Filter by assignee"
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {uniqueAssignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* New request modal */}
      {modalOpen && canCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-request-title"
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
              <h2
                id="new-request-title"
                className="text-base font-semibold text-zinc-900"
              >
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
            <p className="mt-2 text-xs text-zinc-500">
              Workspace: {workspaceName}
            </p>
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
              <select
                value={createAssignee}
                onChange={(e) => setCreateAssignee(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/50"
              >
                <option value="">Assign to… (optional)</option>
                {members.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.email} ({m.role})
                  </option>
                ))}
              </select>
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

      {/* Detail modal */}
      {selectedRequest && (
        <RequestDetailModal
          req={selectedRequest}
          workspaceId={workspaceId}
          members={members}
          canCreate={canCreate}
          canFulfill={canFulfill}
          userEmail={user?.email ?? ""}
          onClose={() => setSelectedRequest(null)}
          onRefresh={handleDetailRefresh}
        />
      )}

      {/* Table */}
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
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 font-medium">Request</th>
                    <th className="px-3 py-2 font-medium">Assignee</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRequest(r)}
                      className="cursor-pointer align-top border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/80"
                    >
                      <td className="max-w-[min(28rem,40vw)] px-4 py-2.5">
                        <p className="font-medium text-zinc-900">{r.title}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {r.created_by_name || r.created_by_email} ·{" "}
                          {formatRequestDate(r.created_at)}
                        </p>
                        {r.body ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-600">
                            {r.body}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.assignee_email ? (
                          <div className="flex items-center gap-1.5">
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600">
                              {initials(
                                r.assignee_name ?? "",
                                r.assignee_email,
                              )}
                            </span>
                            <span className="text-xs text-zinc-700">
                              {r.assignee_email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
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
                        <div
                          className="flex flex-col items-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.status === "open" && canFulfill && (
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
                              <Upload className="h-3.5 w-3.5" />
                              Upload
                              <input
                                type="file"
                                className="hidden"
                                disabled={busy}
                                onChange={(ev) =>
                                  void handleFulfill(r.id, ev.target.files)
                                }
                              />
                            </label>
                          )}
                          {r.status === "open" && canCreate && (
                            <button
                              type="button"
                              onClick={() => void handleCancel(r.id)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                            >
                              <Ban className="h-3 w-3" />
                              Cancel
                            </button>
                          )}
                          {user?.email?.toLowerCase() === r.created_by_email.toLowerCase() && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteFromList(r.id)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-zinc-100 md:hidden">
              {slice.map((r) => (
                <div
                  key={r.id}
                  className="cursor-pointer space-y-2 p-3"
                  onClick={() => setSelectedRequest(r)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900">
                        {r.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {formatRequestDate(r.created_at)}
                      </p>
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
                  {r.assignee_email && (
                    <p className="text-[11px] text-zinc-600">
                      <span className="font-medium text-zinc-700">
                        Assigned:
                      </span>{" "}
                      {r.assignee_email}
                    </p>
                  )}
                  {r.body ? (
                    <p className="text-xs leading-snug text-zinc-700">
                      {r.body}
                    </p>
                  ) : null}
                  <div
                    className="flex flex-wrap gap-2 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.status === "open" && canFulfill && (
                      <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-800">
                        <Upload className="h-3.5 w-3.5" />
                        Upload file
                        <input
                          type="file"
                          className="hidden"
                          disabled={busy}
                          onChange={(ev) =>
                            void handleFulfill(r.id, ev.target.files)
                          }
                        />
                      </label>
                    )}
                    {r.status === "open" && canCreate && (
                      <button
                        type="button"
                        onClick={() => void handleCancel(r.id)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                    )}
                    {user?.email?.toLowerCase() === r.created_by_email.toLowerCase() && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteFromList(r.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
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
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
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
