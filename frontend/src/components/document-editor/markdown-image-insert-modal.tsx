"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ImageIcon, Link2, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { DriveFileBrowser } from "@/components/google-drive-picker";
import { cn } from "@/lib/utils";
import { createFolder, getDownloadUrl, uploadFilesWithProgress } from "@/lib/api";

export const MARKDOWN_IMAGE_UPLOAD_DIR = "uploads/images";

const LOCAL_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp";

const ALLOW_IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

const IMAGE_MIME = /^image\//i;

function isAllowedLocalImage(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t) {
    if (t === "application/pdf" || t.includes("word") || t.includes("document")) return false;
    if (t.startsWith("image/")) return true;
    return false;
  }
  return ALLOW_IMAGE_EXT.test(file.name);
}

function uniqueImageFileName(original: string): string {
  const safe = original.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "image";
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  return `${base}-${Date.now().toString(36)}${ext || ".png"}`;
}

type Tab = "local" | "url" | "drive";

export type MarkdownImageInsertPayload = {
  workspacePath: string;
  displaySrc: string;
  alt: string;
};

type Props = {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  /** After the file exists in the workspace and is ready to insert into the editor. */
  onReady: (payload: MarkdownImageInsertPayload) => void;
  /** Optional: refresh file tree in parent. */
  onUploaded?: () => void;
};

export function MarkdownImageInsertModal({
  workspaceId,
  open,
  onClose,
  onReady,
  onUploaded,
}: Props) {
  const [tab, setTab] = useState<Tab>("local");
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadIndeterminate, setUploadIndeterminate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setTab("local");
    setUrlDraft("");
    setBusy(false);
    setError("");
    setUploadProgress(null);
    setUploadIndeterminate(false);
  }, []);

  const ensureImageUploadFolders = useCallback(async () => {
    try {
      await createFolder(workspaceId, "uploads", "/");
    } catch {
      /* 409: already exists */
    }
    try {
      await createFolder(workspaceId, "images", "uploads");
    } catch {
      /* 409 */
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    void ensureImageUploadFolders();
  }, [open, ensureImageUploadFolders]);

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const finishWithPath = async (workspacePath: string, alt: string) => {
    const { url } = await getDownloadUrl(workspaceId, workspacePath);
    onReady({ workspacePath, displaySrc: url, alt });
    onUploaded?.();
    reset();
    onClose();
  };

  const uploadLocalFiles = async (files: File[]) => {
    const imageFiles = files.filter(isAllowedLocalImage);
    if (imageFiles.length === 0) {
      toast.error("Choose a supported image (PNG, JPEG, GIF, WebP, SVG, AVIF, or BMP)");
      return;
    }
    const renamed = imageFiles.map((f) => new File([f], uniqueImageFileName(f.name), { type: f.type }));
    setBusy(true);
    setError("");
    setUploadProgress(0);
    setUploadIndeterminate(false);
    try {
      await ensureImageUploadFolders();
      const { promise } = uploadFilesWithProgress(
        workspaceId,
        renamed,
        MARKDOWN_IMAGE_UPLOAD_DIR,
        "uploaded",
        (loaded, total) => {
          if (total > 0) setUploadProgress(Math.round((100 * loaded) / total));
          else setUploadIndeterminate(true);
        },
      );
      const { uploaded } = await promise;
      const first = uploaded[0];
      if (!first?.path) throw new Error("Upload did not return a path");
      await finishWithPath(first.path, first.name);
      toast.success("Image inserted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setUploadProgress(null);
      setUploadIndeterminate(false);
    }
  };

  const importFromUrl = async () => {
    const raw = urlDraft.trim();
    if (!raw) {
      toast.error("Enter an image URL");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    } catch {
      toast.error("Invalid URL");
      return;
    }
    setBusy(true);
    setError("");
    setUploadProgress(0);
    setUploadIndeterminate(false);
    try {
      const res = await fetch(parsed.toString(), { mode: "cors" });
      if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
      const blob = await res.blob();
      const nameHint = parsed.pathname.split("/").filter(Boolean).pop() || "image.png";
      const looksImage =
        IMAGE_MIME.test(blob.type) ||
        (blob.type === "application/octet-stream" && ALLOW_IMAGE_EXT.test(nameHint));
      if (!looksImage) {
        throw new Error("URL did not return a supported image type");
      }
      const file = new File([blob], uniqueImageFileName(nameHint), {
        type: blob.type && blob.type !== "application/octet-stream" ? blob.type : "image/png",
      });
      if (!isAllowedLocalImage(file)) {
        throw new Error("Downloaded file is not an allowed image format");
      }
      await ensureImageUploadFolders();
      const { promise } = uploadFilesWithProgress(
        workspaceId,
        [file],
        MARKDOWN_IMAGE_UPLOAD_DIR,
        "uploaded",
        (loaded, total) => {
          if (total > 0) setUploadProgress(Math.round((100 * loaded) / total));
          else setUploadIndeterminate(true);
        },
      );
      const { uploaded } = await promise;
      const first = uploaded[0];
      if (!first?.path) throw new Error("Upload did not return a path");
      await finishWithPath(first.path, first.name);
      toast.success("Image inserted");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message.includes("Failed to fetch") || e.message.includes("NetworkError")
            ? "Could not load URL (blocked by browser CORS). Download the file and use Local upload instead."
            : e.message
          : "Import failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      setUploadProgress(null);
      setUploadIndeterminate(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-zinc-700" />
            <h2 className="text-base font-semibold text-zinc-900">Insert image</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b border-zinc-200 px-2">
          {(
            [
              { key: "local" as const, label: "This device", icon: Upload },
              { key: "url" as const, label: "URL", icon: Link2 },
              { key: "drive" as const, label: "Google Drive", icon: null },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => {
                setTab(key);
                setError("");
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors sm:text-sm",
                tab === key ? "border-violet-600 text-violet-700" : "border-transparent text-zinc-500 hover:text-zinc-700",
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-xs text-zinc-500">
            Files are saved under <span className="font-mono text-zinc-700">{MARKDOWN_IMAGE_UPLOAD_DIR}/</span> in this
            workspace.
          </p>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === "local" && (
            <div className="mt-4 space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept={LOCAL_IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files;
                  e.target.value = "";
                  if (list?.length) void uploadLocalFiles(Array.from(list));
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) void uploadLocalFiles(Array.from(e.dataTransfer.files));
                }}
                className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/80 py-10 transition-colors hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                ) : (
                  <Upload className="h-8 w-8 text-zinc-400" />
                )}
                <span className="mt-2 text-sm font-medium text-zinc-700">
                  {busy ? "Uploading…" : "Choose image"}
                </span>
                <span className="mt-1 text-xs text-zinc-500">or drag and drop onto this window from your file manager</span>
                {busy && uploadProgress !== null && (
                  <div className="mt-4 w-full max-w-[220px] px-2">
                    {uploadIndeterminate ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-500" />
                      </div>
                    ) : (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-[width] duration-150"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    )}
                    <p className="mt-1 text-center text-[10px] text-zinc-500">
                      {uploadIndeterminate ? "Uploading…" : `${uploadProgress}%`}
                    </p>
                  </div>
                )}
              </button>
            </div>
          )}

          {tab === "url" && (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-zinc-600">Image URL</label>
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://…"
                disabled={busy}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void importFromUrl()}
                className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </span>
                ) : (
                  "Download & insert"
                )}
              </button>
              {busy && tab === "url" && uploadProgress !== null && (
                <div className="mt-2">
                  {uploadIndeterminate ? (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-500" />
                    </div>
                  ) : (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-violet-500 transition-[width] duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "drive" && (
            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
              <DriveFileBrowser
                workspaceId={workspaceId}
                currentPath={MARKDOWN_IMAGE_UPLOAD_DIR}
                imagesOnly
                onImportComplete={(detail) => {
                  if (!detail?.imported?.length) {
                    toast.message("Import finished", { description: "Select files and use Import selected." });
                    return;
                  }
                  const img = detail.imported.find((f) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.path));
                  const pick = img ?? detail.imported[0];
                  if (!pick) return;
                  setBusy(true);
                  setError("");
                  void (async () => {
                    try {
                      await finishWithPath(pick.path, pick.name);
                      toast.success("Image inserted");
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Failed to insert";
                      setError(msg);
                      toast.error(msg);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              />
            </div>
          )}
        </div>

        {busy && tab !== "local" && (
          <div className="flex items-center justify-center gap-2 border-t border-zinc-100 py-3 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Working…
          </div>
        )}
      </div>
    </div>
  );
}
