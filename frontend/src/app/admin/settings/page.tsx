"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Database, Loader2, Shield } from "lucide-react";

import { MembersSettingsSection } from "@/components/admin/members-settings-section";
import {
  ADMIN_WIPE_CHROMA_PHRASE,
  adminReindexWorkspace,
  adminWipeChroma,
  getKnowledgeBaseStatus,
  listWorkspaces,
  type KnowledgeBaseStatus,
  type Workspace,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

function AdminSettingsContent() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "rag" ? "rag" : "members";

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [kbStatus, setKbStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [ragBusy, setRagBusy] = useState(false);
  const [ragMessage, setRagMessage] = useState("");

  const [wipeStep, setWipeStep] = useState<"none" | "explain" | "confirm">("none");
  const [wipeTyped, setWipeTyped] = useState("");
  const [reindexOpen, setReindexOpen] = useState(false);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
      setWorkspaceId((current) => {
        if (current && list.some((w) => w.id === current)) return current;
        return list[0]?.id ?? "";
      });
    } catch {
      setWorkspaces([]);
    }
  }, []);

  const refreshKb = useCallback(async () => {
    if (!workspaceId) {
      setKbStatus(null);
      return;
    }
    try {
      setKbStatus(await getKnowledgeBaseStatus(workspaceId));
    } catch {
      setKbStatus(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!loading && user?.role === "ADMIN") {
      void refreshWorkspaces();
    }
  }, [loading, user?.role, refreshWorkspaces]);

  useEffect(() => {
    void refreshKb();
    if (!workspaceId) return;
    const t = setInterval(() => void refreshKb(), 5000);
    return () => clearInterval(t);
  }, [workspaceId, refreshKb]);

  async function runReindex() {
    if (!workspaceId) return;
    setRagBusy(true);
    setRagMessage("");
    try {
      const r = await adminReindexWorkspace(workspaceId);
      setRagMessage(`Reindex queued: ${r.enqueued} file job(s).`);
      await refreshKb();
    } catch (e) {
      setRagMessage(e instanceof Error ? e.message : "Reindex failed");
    } finally {
      setRagBusy(false);
      setReindexOpen(false);
    }
  }

  async function runWipe() {
    if (wipeTyped !== ADMIN_WIPE_CHROMA_PHRASE) return;
    setRagBusy(true);
    setRagMessage("");
    try {
      const r = await adminWipeChroma(wipeTyped);
      setRagMessage(`Removed ${r.deleted_collections} Chroma collection(s). GCS and workspace files were not changed.`);
      setWipeStep("none");
      setWipeTyped("");
      await refreshKb();
    } catch (e) {
      setRagMessage(e instanceof Error ? e.message : "Wipe failed");
    } finally {
      setRagBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Checking access...
      </div>
    );
  }

  if (user?.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <Shield className="mx-auto h-8 w-8 text-zinc-400" />
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">Admin access required</h1>
        <p className="mt-2 text-sm text-zinc-500">Your account can continue using the normal Probe workspace UI.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">Admin settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Members and knowledge-base maintenance for this deployment.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/admin/settings?tab=members"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === "members" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            Members
          </a>
          <a
            href="/admin/settings?tab=rag"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === "rag" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            Knowledge base / vectors
          </a>
        </div>
      </div>

      {tab === "members" && <MembersSettingsSection />}

      {tab === "rag" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Knowledge base (Chroma)</h2>
              <p className="text-sm text-zinc-500">
                Operations affect only the vector index on this server. Workspace files and GCS blobs are not deleted.
              </p>
            </div>
          </div>

          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">Workspace</label>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="mt-1 w-full max-w-md rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.id})
              </option>
            ))}
          </select>

          {kbStatus && (
            <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              <p>
                State: <span className="font-medium">{kbStatus.knowledge_base.state}</span> · Indexed chunks:{" "}
                <span className="font-medium">{kbStatus.knowledge_base.indexed_chunk_count}</span> · Queue depth:{" "}
                <span className="font-medium">{kbStatus.knowledge_base.queue_depth}</span>
              </p>
            </div>
          )}

          {ragMessage && (
            <p
              className={`mt-3 text-sm ${ragMessage.includes("failed") || ragMessage.toLowerCase().includes("error") ? "text-red-600" : "text-emerald-700"}`}
            >
              {ragMessage}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={ragBusy || !workspaceId}
              onClick={() => setReindexOpen(true)}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Reinitialize knowledge base (reindex workspace)
            </button>
            <button
              type="button"
              disabled={ragBusy}
              onClick={() => {
                setWipeStep("explain");
                setWipeTyped("");
              }}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
            >
              Delete local Chroma database
            </button>
          </div>
        </section>
      )}

      {reindexOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">Reindex workspace?</h3>
            <p className="mt-2 text-sm text-zinc-600">
              This drops the Chroma collection for the selected workspace and enqueues a full reindex from workspace files.
              GCS and file contents are unchanged.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReindexOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ragBusy}
                onClick={() => void runReindex()}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {ragBusy ? "Working…" : "Reindex"}
              </button>
            </div>
          </div>
        </div>
      )}

      {wipeStep === "explain" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">Delete local Chroma database</h3>
            <p className="mt-2 text-sm text-zinc-600">
              This removes all vector collections on this instance only. Your workspace files, Google Drive imports, and
              GCS storage are not modified. Search and citations may be empty until workspaces reindex.
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Under heavy indexing, wiping can race with workers; prefer low traffic when possible.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWipeStep("none")}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setWipeStep("confirm")}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {wipeStep === "confirm" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">Confirm deletion</h3>
            <p className="mt-2 text-sm text-zinc-600">
              Type <span className="font-mono font-semibold text-zinc-900">{ADMIN_WIPE_CHROMA_PHRASE}</span> to confirm.
            </p>
            <input
              value={wipeTyped}
              onChange={(e) => setWipeTyped(e.target.value)}
              autoComplete="off"
              className="mt-3 w-full rounded-xl border border-zinc-200 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-400"
              placeholder={ADMIN_WIPE_CHROMA_PHRASE}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setWipeStep("none");
                  setWipeTyped("");
                }}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ragBusy || wipeTyped !== ADMIN_WIPE_CHROMA_PHRASE}
                onClick={() => void runWipe()}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {ragBusy ? "Working…" : "Delete vectors"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[12rem] items-center justify-center text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      }
    >
      <AdminSettingsContent />
    </Suspense>
  );
}
